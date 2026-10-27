package com.nora.file;

import com.nora.auth.AuthPrincipal;
import com.nora.room.Room;
import com.nora.room.RoomService;
import com.nora.file.FileService.FileDto;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
@RequestMapping("/api/rooms/{code}/files")
public class FileController {

    private final FileService files;
    private final RoomService rooms;

    public FileController(FileService files, RoomService rooms) {
        this.files = files;
        this.rooms = rooms;
    }

    @GetMapping
    public List<FileDto> list(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        Room room = rooms.requireMember(p.userId(), code);
        return files.list(room.getId());
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public FileDto upload(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code,
                          @RequestParam("file") MultipartFile file) {
        Room room = rooms.requireMember(p.userId(), code);
        return files.upload(room.getId(), p.userId(), file);
    }

    @GetMapping("/{fileId}")
    public ResponseEntity<StreamingResponseBody> download(@AuthenticationPrincipal AuthPrincipal p,
                                                          @PathVariable String code, @PathVariable UUID fileId) {
        Room room = rooms.requireMember(p.userId(), code);
        FileService.Download d = files.download(room.getId(), fileId);
        StreamingResponseBody body = out -> {
            try (InputStream in = d.stream()) {
                in.transferTo(out);
            }
        };
        return ResponseEntity.ok()
                // Siempre como adjunto y sin sniffing: un archivo subido nunca se ejecuta en el navegador.
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .contentLength(d.file().getSizeBytes())
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(d.file().getOriginalName(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(body);
    }

    @DeleteMapping("/{fileId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID fileId) {
        Room room = rooms.requireMember(p.userId(), code);
        files.delete(room.getId(), fileId, p.userId(), p.role(), room.getOwnerId());
    }
}
