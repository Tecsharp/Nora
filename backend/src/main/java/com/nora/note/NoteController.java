package com.nora.note;

import com.nora.auth.AuthPrincipal;
import com.nora.common.ApiException;
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
                              @Size(max = 20000, message = "Máximo 20000 caracteres") String content) {}

    public record NoteDto(UUID id, String content, UUID authorId, String authorName, Instant createdAt) {}

    private final RoomNoteRepository notes;
    private final RoomService rooms;
    private final UserRepository users;
    private final ApplicationEventPublisher events;

    public NoteController(RoomNoteRepository notes, RoomService rooms, UserRepository users, ApplicationEventPublisher events) {
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
                .map(n -> new NoteDto(n.getId(), n.getContent(), n.getAuthorId(), names.getOrDefault(n.getAuthorId(), "?"), n.getCreatedAt()))
                .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public NoteDto create(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code,
                          @RequestParam(defaultValue = "NOTE") RoomNote.Kind kind, @Valid @RequestBody NoteRequest req) {
        Room room = rooms.requireMember(p.userId(), code);
        if (notes.countByRoomIdAndKind(room.getId(), kind) >= MAX_ITEMS_PER_KIND) {
            throw ApiException.conflict("Has alcanzado el máximo de elementos; borra alguno antes de añadir más");
        }
        RoomNote n = notes.save(new RoomNote(room.getId(), p.userId(), kind, req.content()));
        String name = users.findById(p.userId()).map(u -> u.getDisplayName()).orElse("?");
        NoteDto dto = new NoteDto(n.getId(), n.getContent(), n.getAuthorId(), name, n.getCreatedAt());
        events.publishEvent(new RoomEvent(room.getId(), "note.added", Map.of("kind", kind, "note", dto)));
        return dto;
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        Room room = rooms.requireMember(p.userId(), code);
        RoomNote n = notes.findById(id).filter(x -> x.getRoomId().equals(room.getId()))
                .orElseThrow(() -> ApiException.notFound("Elemento no encontrado"));
        if (!n.getAuthorId().equals(p.userId()) && !room.getOwnerId().equals(p.userId()) && p.role() != Role.ADMIN) {
            throw ApiException.forbidden("No puedes borrar este elemento");
        }
        notes.delete(n);
        events.publishEvent(new RoomEvent(room.getId(), "note.deleted", Map.of("kind", n.getKind(), "id", n.getId())));
    }
}
