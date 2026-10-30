package com.nora.library;

import com.nora.auth.AuthPrincipal;
import com.nora.common.ApiException;
import com.nora.library.LibraryService.*;
import com.nora.room.Room;
import com.nora.room.RoomService;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class LibraryController {

    private final LibraryService libs;
    private final RoomService rooms;

    public LibraryController(LibraryService libs, RoomService rooms) {
        this.libs = libs;
        this.rooms = rooms;
    }

    /** Bibliotecas del sistema: las ve cualquier persona con sesión (salen en la pizarra de todas las salas). */
    @GetMapping("/api/libraries/system")
    public List<SystemLibrary> system() {
        return libs.systemLibraries();
    }

    @GetMapping("/api/admin/libraries")
    public List<Meta> adminList() {
        return libs.systemMetas();
    }

    @PostMapping("/api/admin/libraries")
    @ResponseStatus(HttpStatus.CREATED)
    public Meta adminAdd(@AuthenticationPrincipal AuthPrincipal p, @RequestParam("file") MultipartFile file, @RequestParam(required = false) String name) throws IOException {
        String n = name != null && !name.isBlank() ? name : file.getOriginalFilename();
        return libs.addSystem(p.userId(), n, file.getBytes());
    }

    @DeleteMapping("/api/admin/libraries/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void adminDelete(@PathVariable UUID id) {
        libs.deleteSystem(id);
    }

    @GetMapping("/api/rooms/{code}/library")
    public RoomLibrary mine(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        Room room = rooms.requireMember(p.userId(), code);
        return libs.roomLibrary(room.getId(), p.userId());
    }

    @PutMapping(value = "/api/rooms/{code}/library", consumes = "application/json")
    public RoomLibrary save(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @RequestBody String items) {
        Room room = rooms.requireMember(p.userId(), code);
        return libs.saveRoomLibrary(room.getId(), p.userId(), items);
    }
}
