package com.nora.live;

import com.nora.auth.AuthPrincipal;
import com.nora.room.Room;
import com.nora.room.RoomService;
import com.nora.user.UserRepository;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/rooms/{code}/live")
public class LiveController {

    private final LiveService live;
    private final RoomService rooms;
    private final UserRepository users;

    public LiveController(LiveService live, RoomService rooms, UserRepository users) {
        this.live = live;
        this.rooms = rooms;
        this.users = users;
    }

    /** Estado actual de las herramientas en vivo de la sala. */
    @GetMapping
    public Map<String, Object> state(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code) {
        Room room = rooms.requireMember(p.userId(), code);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("serverNow", System.currentTimeMillis());
        out.put("focus", live.focusState(room.getId()));
        return out;
    }

    @PostMapping("/focus")
    public Map<String, Object> focus(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @RequestBody Map<String, Object> body) {
        Room room = rooms.requireWriter(p.userId(), p.role(), code);
        return live.focusAction(room.getId(), p.userId(), users.findById(p.userId()).orElseThrow().getDisplayName(), body);
    }
}
