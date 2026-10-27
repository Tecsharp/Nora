package com.nora.folder;

import com.nora.auth.AuthPrincipal;
import com.nora.folder.FolderService.FolderDto;
import com.nora.room.Room;
import com.nora.room.RoomService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/rooms/{code}/folders")
public class FolderController {

    public record CreateRequest(@NotBlank(message = "El nombre es obligatorio") @Size(max = 60, message = "Máximo 60 caracteres") String name,
                                UUID parentId) {}

    public record RenameRequest(@NotBlank(message = "El nombre es obligatorio") @Size(max = 60, message = "Máximo 60 caracteres") String name) {}

    private final FolderService folders;
    private final RoomService rooms;

    public FolderController(FolderService folders, RoomService rooms) {
        this.folders = folders;
        this.rooms = rooms;
    }

    @GetMapping
    public List<FolderDto> list(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code,
                                @RequestParam(defaultValue = "FILE") RoomFolder.Kind kind) {
        Room room = rooms.requireMember(p.userId(), code);
        return folders.list(room.getId(), kind);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public FolderDto create(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code,
                            @RequestParam(defaultValue = "FILE") RoomFolder.Kind kind, @Valid @RequestBody CreateRequest req) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        return folders.create(room.getId(), p.userId(), kind, req.parentId(), req.name());
    }

    @PatchMapping("/{id}")
    public FolderDto rename(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id,
                            @Valid @RequestBody RenameRequest req) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        return folders.rename(room.getId(), id, p.userId(), rooms.canModerate(room, p.userId(), p.role()), req.name());
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        folders.delete(room.getId(), id, p.userId(), rooms.canModerate(room, p.userId(), p.role()));
    }
}
