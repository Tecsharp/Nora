package com.nora.upload;

import com.nora.auth.AuthPrincipal;
import com.nora.file.FileService;
import com.nora.room.Room;
import com.nora.room.RoomService;
import com.nora.upload.UploadDtos.CreateRequest;
import com.nora.upload.UploadDtos.UploadDto;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/rooms/{code}/uploads")
public class UploadController {

    private final UploadService uploads;
    private final RoomService rooms;

    public UploadController(UploadService uploads, RoomService rooms) {
        this.uploads = uploads;
        this.rooms = rooms;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public UploadDto create(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @Valid @RequestBody CreateRequest req) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        return uploads.create(room.getId(), p.userId(), req);
    }

    @GetMapping
    public List<UploadDto> mine(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        Room room = rooms.requireMember(p.userId(), code);
        return uploads.mine(room.getId(), p.userId());
    }

    @GetMapping("/{id}")
    public UploadDto status(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        Room room = rooms.requireMember(p.userId(), code);
        return uploads.status(room.getId(), p.userId(), id);
    }

    @PutMapping("/{id}/parts/{number}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void part(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id,
                     @PathVariable int number, HttpServletRequest request) throws IOException {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        uploads.putPart(room.getId(), p.userId(), id, number, request.getInputStream());
    }

    @PostMapping("/{id}/complete")
    public FileService.FileDto complete(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        return uploads.complete(room.getId(), p.userId(), id);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void abort(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID id) {
        Room room = rooms.requireMember(p.userId(), code);
        uploads.abort(room.getId(), p.userId(), p.role(), id);
    }
}
