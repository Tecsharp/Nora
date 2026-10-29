package com.nora.user;

import com.nora.config.SettingsService;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

/** Resumen del sistema y ajustes que decide el administrador. */
@RestController
@RequestMapping("/api/admin")
public class AdminSystemController {

    private final JdbcTemplate jdbc;
    private final SettingsService settings;

    public AdminSystemController(JdbcTemplate jdbc, SettingsService settings) {
        this.jdbc = jdbc;
        this.settings = settings;
    }

    private long one(String sql) {
        Long v = jdbc.queryForObject(sql, Long.class);
        return v == null ? 0 : v;
    }

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("users", one("select count(*) from users"));
        m.put("admins", one("select count(*) from users where role = 'ADMIN'"));
        m.put("disabled", one("select count(*) from users where not enabled"));
        m.put("newUsers7d", one("select count(*) from users where created_at > now() - interval '7 days'"));
        m.put("active24h", one("select count(*) from users where last_login_at > now() - interval '1 day'"));
        m.put("activeRooms", one("select count(*) from rooms where expires_at is null or expires_at > now()"));
        m.put("files", one("select count(*) from room_files"));
        m.put("storageBytes", one("select coalesce(sum(size_bytes), 0) from room_files"));
        m.put("documents", one("select count(*) from collab_docs"));
        m.put("sessions", one("select count(*) from refresh_tokens where not revoked and expires_at > now()"));
        m.put("systemLibraries", one("select count(*) from system_libraries"));
        return m;
    }

    @GetMapping("/settings")
    public Map<String, Object> settings() {
        return settings.view();
    }

    @PutMapping("/settings")
    public Map<String, Object> update(@RequestBody SettingsService.Update req) {
        return settings.update(req);
    }
}
