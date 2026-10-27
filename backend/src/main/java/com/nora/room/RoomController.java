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

    /** 200 con la sala; 202 si la sala pide aprobación y la solicitud quedó pendiente. */
    @PostMapping("/join")
    public org.springframework.http.ResponseEntity<Object> join(@AuthenticationPrincipal AuthPrincipal p, @Valid @RequestBody JoinRoomRequest req) {
        JoinResult r = rooms.join(p.userId(), req.code());
        if (r.pending()) {
            return org.springframework.http.ResponseEntity.status(HttpStatus.ACCEPTED)
                    .body(java.util.Map.of("pending", true, "roomName", r.roomName(), "code", req.code().trim().toUpperCase()));
        }
        return org.springframework.http.ResponseEntity.ok(r.room());
    }

    @GetMapping("/{code}/join-status")
    public java.util.Map<String, String> joinStatus(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        return java.util.Map.of("status", rooms.joinStatus(p.userId(), code));
    }

    @DeleteMapping("/{code}/join-request")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void cancelJoin(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        rooms.cancelJoin(p.userId(), code);
    }

    @GetMapping("/{code}/join-requests")
    public List<JoinRequestDto> joinRequests(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        return rooms.joinRequests(p.userId(), p.role(), code);
    }

    @PostMapping("/{code}/join-requests/{userId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void decide(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable java.util.UUID userId,
                       @Valid @RequestBody DecisionRequest req) {
        rooms.decideJoin(p.userId(), p.role(), code, userId, req.approve());
    }

    @PatchMapping("/{code}/settings")
    public RoomDto settings(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @Valid @RequestBody SettingsRequest req) {
        return rooms.updateSettings(p.userId(), p.role(), code, req);
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

    /** Asigna el rol (lector, colaborador o moderador) a otro participante. Solo el propietario. */
    @PatchMapping("/{code}/members/{userId}")
    public ParticipantDto setRole(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code,
                                  @PathVariable java.util.UUID userId, @Valid @RequestBody RoleRequest req) {
        return rooms.setMemberRole(p.userId(), p.role(), code, userId, req.role());
    }

    @DeleteMapping("/{code}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void close(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        rooms.close(p.userId(), p.role(), code);
    }
}
