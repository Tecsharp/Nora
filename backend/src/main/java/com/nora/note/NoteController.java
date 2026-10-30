package com.nora.note;

import com.nora.auth.AuthPrincipal;
import com.nora.common.ApiException;
import com.nora.folder.FolderService;
import com.nora.folder.RoomFolder;
import com.nora.room.Room;
import com.nora.room.RoomService;
import com.nora.user.Role;
import com.nora.user.UserRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import com.nora.ws.RoomEvent;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** Notas compartidas y portapapeles de la sala (mismo modelo, distinto tipo). */
@RestController
@RequestMapping("/api/rooms/{code}/notes")
public class NoteController {

    private static final int MAX_ITEMS_PER_KIND = 200;

    public record NoteRequest(@NotBlank(message = "El contenido es obligatorio")
                              @Size(max = 20000, message = "Máximo 20000 caracteres") String content,
                              UUID folderId) {}

    public record NoteDto(UUID id, String content, UUID authorId, String authorName, Instant createdAt, UUID folderId) {}

    private final RoomNoteRepository notes;
    private final RoomService rooms;
    private final UserRepository users;
    private final ApplicationEventPublisher events;
    private final FolderService folders;

    public NoteController(RoomNoteRepository notes, RoomService rooms, UserRepository users, ApplicationEventPublisher events,
                          FolderService folders) {
        this.folders = folders;
        this.notes = notes;
        this.rooms = rooms;
        this.users = users;
        this.events = events;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public List<NoteDto> list(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code,
                              @RequestParam(defaultValue = "NOTE") RoomNote.Kind kind) {
        Room room = rooms.requireMember(p.userId(), code);
        List<RoomNote> items = notes.findByRoomIdAndKindOrderByCreatedAtDesc(room.getId(), kind, PageRequest.of(0, MAX_ITEMS_PER_KIND));
        Map<UUID, String> names = users.findAllById(items.stream().map(RoomNote::getAuthorId).distinct().toList()).stream()
                .collect(Collectors.toMap(u -> u.getId(), u -> u.getDisplayName(), (a, b) -> a));
        return items.stream()
                .map(n -> new NoteDto(n.getId(), n.getContent(), n.getAuthorId(), names.getOrDefault(n.getAuthorId(), "?"), n.getCreatedAt(), n.getFolderId()))
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public NoteDto create(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code,
                          @RequestParam(defaultValue = "NOTE") RoomNote.Kind kind, @Valid @RequestBody NoteRequest req) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        if (notes.countByRoomIdAndKind(room.getId(), kind) >= MAX_ITEMS_PER_KIND) {
            throw ApiException.conflict("Has alcanzado el máximo de elementos; borra alguno antes de añadir más");
        }
        folders.requireIn(room.getId(), RoomFolder.Kind.valueOf(kind.name()), req.folderId());
        RoomNote created = new RoomNote(room.getId(), p.userId(), kind, req.content());
        created.setFolderId(req.folderId());
        RoomNote n = notes.save(created);
        String name = users.findById(p.userId()).map(u -> u.getDisplayName()).orElse("?");
        NoteDto dto = new NoteDto(n.getId(), n.getContent(), n.getAuthorId(), name, n.getCreatedAt(), n.getFolderId());
        events.publishEvent(new RoomEvent(room.getId(), "note.added", Map.of("kind", kind, "note", dto)));
        return dto;
    }

    /** Mueve una nota a otra categoría (folderId null = sin categoría). */
    @PatchMapping("/{id}")
    @Transactional
    public NoteDto move(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id,
                        @RequestBody Map<String, Object> body) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        RoomNote n = notes.findById(id).filter(x -> x.getRoomId().equals(room.getId()))
                .orElseThrow(() -> ApiException.notFound("Elemento no encontrado"));
        // Mover de carpeta lo puede hacer cualquiera que pueda escribir; editar el texto, solo su autor o quien modera
        if (body.containsKey("content") && !n.getAuthorId().equals(p.userId()) && !rooms.canModerate(room, p.userId(), p.role())) {
            throw ApiException.forbidden("No puedes modificar este elemento");
        }
        // Solo se tocan los campos presentes: "folderId" mueve de categoría y "content" edita el texto
        if (body.containsKey("folderId")) {
            UUID folderId = null;
            if (body.get("folderId") != null) {
                try {
                    folderId = UUID.fromString(String.valueOf(body.get("folderId")));
                } catch (IllegalArgumentException e) {
                    throw ApiException.badRequest("Categoría no válida");
                }
            }
            folders.requireIn(room.getId(), RoomFolder.Kind.valueOf(n.getKind().name()), folderId);
            n.setFolderId(folderId);
        }
        if (body.containsKey("content")) {
            if (!(body.get("content") instanceof String text) || text.isBlank()) throw ApiException.badRequest("El contenido es obligatorio");
            if (text.length() > 20000) throw ApiException.badRequest("Máximo 20000 caracteres");
            n.setContent(text);
        }
        String name = users.findById(n.getAuthorId()).map(u -> u.getDisplayName()).orElse("?");
        NoteDto dto = new NoteDto(n.getId(), n.getContent(), n.getAuthorId(), name, n.getCreatedAt(), n.getFolderId());
        events.publishEvent(new RoomEvent(room.getId(), "note.updated", Map.of("kind", n.getKind(), "note", dto)));
        return dto;
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        RoomNote n = notes.findById(id).filter(x -> x.getRoomId().equals(room.getId()))
                .orElseThrow(() -> ApiException.notFound("Elemento no encontrado"));
        if (!n.getAuthorId().equals(p.userId()) && !rooms.canModerate(room, p.userId(), p.role())) {
            throw ApiException.forbidden("No puedes borrar este elemento");
        }
        notes.delete(n);
        events.publishEvent(new RoomEvent(room.getId(), "note.deleted", Map.of("kind", n.getKind(), "id", n.getId())));
    }
}
