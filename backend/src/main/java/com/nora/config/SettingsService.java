package com.nora.config;

import com.nora.common.ApiException;
import java.util.HashMap;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Configuración del sistema que decide el administrador en caliente; lo que no está guardado sale de la configuración (variables de entorno). */
@Service
public class SettingsService {

    private final JdbcTemplate jdbc;
    private final AppProperties props;

    public SettingsService(JdbcTemplate jdbc, AppProperties props) {
        this.jdbc = jdbc;
        this.props = props;
    }

    private String get(String key) {
        return jdbc.query("select value from app_settings where key = ?", (r, i) -> r.getString(1), key).stream().findFirst().orElse(null);
    }

    private void put(String key, String value) {
        if (value == null) {
            jdbc.update("delete from app_settings where key = ?", key);
            return;
        }
        jdbc.update("insert into app_settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value", key, value);
    }

    public boolean registrationEnabled() {
        String v = get("registration");
        return v != null ? v.equals("true") : props.allowRegistration();
    }

    /** Cómo se puede entrar. */
    public enum AuthMode {
        PASSWORD, GOOGLE, BOTH;

        static AuthMode parse(String v, AuthMode fallback) {
            if (v == null) return fallback;
            return switch (v.trim().toLowerCase(java.util.Locale.ROOT)) {
                case "password" -> PASSWORD;
                case "google" -> GOOGLE;
                case "both" -> BOTH;
                default -> fallback;
            };
        }
    }

    public boolean googleConfigured() {
        return props.google() != null && props.google().configured();
    }

    /** Lo que eligió el administrador (o el .env), sin tener en cuenta si Google está configurado. */
    public AuthMode authModeSetting() {
        AuthMode env = AuthMode.parse(props.authMode(), AuthMode.PASSWORD);
        return AuthMode.parse(get("authMode"), env);
    }

    /** Lo que de verdad rige: sin Google configurado solo hay contraseña, para no dejar a nadie fuera. */
    public AuthMode authMode() {
        AuthMode m = authModeSetting();
        return googleConfigured() ? m : AuthMode.PASSWORD;
    }

    public boolean passwordLogin() { return authMode() != AuthMode.GOOGLE; }

    public boolean googleLogin() { return authMode() != AuthMode.PASSWORD; }

    private long num(String key, long fallback) {
        try {
            String v = get(key);
            return v == null ? fallback : Long.parseLong(v);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    /** Límites con los que nace una cuenta nueva. */
    public AppProperties.Defaults defaults() {
        var d = props.defaults();
        return new AppProperties.Defaults(num("storageQuotaMb", d.storageQuotaMb()), num("maxFileMb", d.maxFileMb()),
                (int) num("maxRoomMinutes", d.maxRoomMinutes()), (int) num("maxActiveRooms", d.maxActiveRooms()), (int) num("maxParticipants", d.maxParticipants()));
    }

    public Map<String, Object> view() {
        var d = defaults();
        Map<String, Object> m = new HashMap<>();
        m.put("registrationEnabled", registrationEnabled());
        m.put("authMode", authModeSetting().name().toLowerCase(java.util.Locale.ROOT));
        m.put("googleConfigured", googleConfigured());
        m.put("storageQuotaMb", d.storageQuotaMb());
        m.put("maxFileMb", d.maxFileMb());
        m.put("maxRoomMinutes", d.maxRoomMinutes());
        m.put("maxActiveRooms", d.maxActiveRooms());
        m.put("maxParticipants", d.maxParticipants());
        return m;
    }

    public record Update(Boolean registrationEnabled, String authMode, Long storageQuotaMb, Long maxFileMb, Integer maxRoomMinutes, Integer maxActiveRooms, Integer maxParticipants) {}

    public Map<String, Object> update(Update u) {
        if (u.registrationEnabled() != null) put("registration", String.valueOf(u.registrationEnabled()));
        if (u.authMode() != null) {
            AuthMode m = AuthMode.parse(u.authMode(), null);
            if (m == null) throw ApiException.badRequest("Modo de acceso no válido");
            if (m != AuthMode.PASSWORD && !googleConfigured()) throw ApiException.badRequest("Google no está configurado: define NORA_GOOGLE_CLIENT_ID y NORA_GOOGLE_CLIENT_SECRET en .env");
            put("authMode", m.name().toLowerCase(java.util.Locale.ROOT));
        }
        if (u.storageQuotaMb() != null) put("storageQuotaMb", String.valueOf(Math.max(1, u.storageQuotaMb())));
        if (u.maxFileMb() != null) put("maxFileMb", String.valueOf(Math.max(1, u.maxFileMb())));
        if (u.maxRoomMinutes() != null) put("maxRoomMinutes", String.valueOf(Math.max(1, u.maxRoomMinutes())));
        if (u.maxActiveRooms() != null) put("maxActiveRooms", String.valueOf(Math.max(0, u.maxActiveRooms())));
        if (u.maxParticipants() != null) put("maxParticipants", String.valueOf(Math.max(2, u.maxParticipants())));
        return view();
    }
}
