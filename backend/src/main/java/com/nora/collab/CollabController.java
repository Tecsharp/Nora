package com.nora.collab;

import com.nora.auth.AuthPrincipal;
import com.nora.collab.CollabDtos.*;
import com.nora.common.ApiException;
import com.nora.room.Room;
import com.nora.room.RoomService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/rooms/{code}/docs")
public class CollabController {

    private final CollabService collab;
    private final RoomService rooms;

    public CollabController(CollabService collab, RoomService rooms) {
        this.collab = collab;
        this.rooms = rooms;
    }

    @GetMapping
    public List<DocDto> list(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        Room room = rooms.requireMember(p.userId(), code);
        return collab.list(room, p.userId(), p.role());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public DocDto create(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @Valid @RequestBody CreateRequest req) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        return collab.create(room, p.userId(), req.kind(), req.name(), req.folderId());
    }

    /** Abre un archivo de oficina de la sala para editarlo (lo convierte la primera vez). */
    @PostMapping("/from-file/{fileId}")
    public DocDto fromFile(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID fileId) {
        Room room = rooms.requireMember(p.userId(), code);
        return collab.fromFile(room, p.userId(), p.role(), fileId);
    }

    @GetMapping("/{id}")
    public DocDto get(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        Room room = rooms.requireMember(p.userId(), code);
        return collab.get(room, id, p.userId(), p.role());
    }

    @PatchMapping("/{id}")
    public DocDto rename(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id, @Valid @RequestBody RenameRequest req) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        return collab.rename(room, id, p.userId(), p.role(), req.name());
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        collab.delete(room, id, p.userId(), p.role());
    }

    @GetMapping("/{id}/state")
    public StateDto state(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        Room room = rooms.requireMember(p.userId(), code);
        return collab.state(room, id);
    }

    @PostMapping("/{id}/seed/claim")
    public SeedClaim claim(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        return collab.claimSeed(room, id, p.userId());
    }

    @PostMapping("/{id}/seed/done")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void seedDone(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        collab.finishSeed(room, id, p.userId());
    }

    /** Compactación: un cliente que ha aplicado todos los cambios hasta upToSeq envía el estado completo. */
    @PutMapping("/{id}/snapshot")
    public Map<String, Boolean> snapshot(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id,
                                         @RequestParam long upToSeq, HttpServletRequest request) throws IOException {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        return Map.of("accepted", collab.saveSnapshot(room, id, upToSeq, readBody(request, CollabService.MAX_SNAPSHOT_BYTES)));
    }

    @GetMapping("/{id}/versions")
    public List<VersionDto> versions(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        Room room = rooms.requireMember(p.userId(), code);
        return collab.versions(room, id);
    }

    @PostMapping("/{id}/versions")
    @ResponseStatus(HttpStatus.CREATED)
    public VersionDto addVersion(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id,
                                 @RequestParam(required = false) String label, @RequestParam long seq, HttpServletRequest request) throws IOException {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        return collab.addVersion(room, id, p.userId(), label, seq, readBody(request, CollabService.MAX_SNAPSHOT_BYTES));
    }

    @GetMapping("/{id}/versions/{versionId}")
    public ResponseEntity<byte[]> version(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id, @PathVariable UUID versionId) {
        Room room = rooms.requireMember(p.userId(), code);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(collab.versionSnapshot(room, id, versionId));
    }

    /** Convierte el contenido del editor (JSON/HTML nativo) y lo devuelve, o lo guarda en la sala (save=file|new). */
    @PostMapping("/{id}/export")
    public ResponseEntity<?> export(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id,
                                    @RequestParam(required = false) String format, @RequestParam(defaultValue = "none") String save,
                                    @RequestParam(defaultValue = "0") int active, @RequestParam(defaultValue = "0") long seq, HttpServletRequest request) throws IOException {
        Room room = rooms.requireMember(p.userId(), code);
        var r = collab.export(room, id, p.userId(), p.role(), format, save, active, seq, readBody(request, 40 * 1024 * 1024));
        if (r.saved() != null) return ResponseEntity.ok(r.saved());
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(r.mime())).contentLength(r.data().length)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(r.filename(), java.nio.charset.StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff").header(HttpHeaders.CACHE_CONTROL, "private, no-store").body(r.data());
    }

    private static byte[] readBody(HttpServletRequest request, int max) throws IOException {
        byte[] data = request.getInputStream().readNBytes(max + 1);
        if (data.length > max) throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "Contenido demasiado grande");
        return data;
    }
}
