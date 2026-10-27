package com.nora.room;

import com.nora.auth.AuthPrincipal;
import com.nora.room.RoomDtos.*;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {

    private final RoomService rooms;

    public RoomController(RoomService rooms) {
        this.rooms = rooms;
    }

    @GetMapping
    public List<RoomSummary> mine(@AuthenticationPrincipal AuthPrincipal p) {
        return rooms.mine(p.userId());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public RoomDto create(@AuthenticationPrincipal AuthPrincipal p, @Valid @RequestBody CreateRoomRequest req) {
        return rooms.create(p.userId(), req);
    }

    @PostMapping("/join")
    public RoomDto join(@AuthenticationPrincipal AuthPrincipal p, @Valid @RequestBody JoinRoomRequest req) {
        return rooms.join(p.userId(), req.code());
    }

    @GetMapping("/{code}")
    public RoomDto get(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        return rooms.get(p.userId(), code);
    }

    /** Extiende o reduce la duración de la sala (propietario o admin). */
    @PatchMapping("/{code}/expiry")
    public RoomDto expiry(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @Valid @RequestBody ExpiryRequest req) {
        return rooms.adjustExpiry(p.userId(), p.role(), code, req);
    }

    @DeleteMapping("/{code}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void close(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        rooms.close(p.userId(), p.role(), code);
    }
}
