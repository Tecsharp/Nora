package com.nora.user;

import com.nora.common.ApiException;
import com.nora.file.FileService;
import com.nora.room.RoomService;
import com.nora.upload.UploadService;
import com.nora.ws.UserEvent;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Perfil (nombre, correo, foto) y borrado de cuentas, para la propia persona y para el administrador. */
@Service
public class AccountService {

    public static final int MAX_AVATAR_BYTES = 1_000_000;

    public record Avatar(byte[] content, String contentType) {}

    private final UserRepository users;
    private final JdbcTemplate jdbc;
    private final RoomService rooms;
    private final FileService files;
    private final UploadService uploads;
    private final ApplicationEventPublisher events;

    public AccountService(UserRepository users, JdbcTemplate jdbc, RoomService rooms, FileService files, UploadService uploads, ApplicationEventPublisher events) {
        this.users = users;
        this.jdbc = jdbc;
        this.rooms = rooms;
        this.files = files;
        this.uploads = uploads;
        this.events = events;
    }

    private User user(UUID id) {
        return users.findById(id).orElseThrow(() -> ApiException.notFound("Usuario no encontrado"));
    }

    /** Nombre y/o correo. Cambiar el correo exige haber comprobado la contraseña antes (lo hace el controlador). */
    @Transactional
    public User updateProfile(UUID userId, String displayName, String email) {
        User u = user(userId);
        if (displayName != null) {
            String n = displayName.trim();
            if (n.length() < 2 || n.length() > 60) throw ApiException.badRequest("El nombre debe tener entre 2 y 60 caracteres");
            if (!n.matches("^[\\p{L}\\p{N} ._'-]+$")) throw ApiException.badRequest("El nombre contiene caracteres no permitidos");
            u.setDisplayName(n);
        }
        if (email != null) {
            String e = email.trim().toLowerCase(Locale.ROOT);
            if (!e.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$") || e.length() > 254) throw ApiException.badRequest("Email no válido");
            if (!e.equals(u.getEmail())) {
                if (users.existsByEmail(e)) throw ApiException.conflict("Ya existe una cuenta con ese email");
                u.setEmail(e);
            }
        }
        return users.save(u);
    }

    private static String sniff(byte[] b) {
        if (b.length > 12 && b[0] == (byte) 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return "image/png";
        if (b.length > 3 && b[0] == (byte) 0xFF && b[1] == (byte) 0xD8 && b[2] == (byte) 0xFF) return "image/jpeg";
        if (b.length > 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return "image/webp";
        return null;
    }

    @Transactional
    public User setAvatar(UUID userId, byte[] content) {
        if (content.length == 0) throw ApiException.badRequest("La imagen está vacía");
        if (content.length > MAX_AVATAR_BYTES) throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "La foto no puede pasar de 1 MB");
        String type = sniff(content);
        if (type == null) throw ApiException.badRequest("La foto debe ser PNG, JPEG o WebP");
        User u = user(userId);
        jdbc.update("insert into user_avatars (user_id, content, content_type, updated_at) values (?,?,?,?) "
                + "on conflict (user_id) do update set content = excluded.content, content_type = excluded.content_type, updated_at = excluded.updated_at",
                userId, content, type, Timestamp.from(Instant.now()));
        u.setAvatarVersion(u.getAvatarVersion() + 1);
        return users.save(u);
    }

    @Transactional
    public User removeAvatar(UUID userId) {
        User u = user(userId);
        jdbc.update("delete from user_avatars where user_id = ?", userId);
        u.setAvatarVersion(u.getAvatarVersion() + 1);
        return users.save(u);
    }

    @Transactional(readOnly = true)
    public Avatar avatar(UUID userId) {
        return jdbc.query("select content, content_type from user_avatars where user_id = ?", (r, i) -> new Avatar(r.getBytes(1), r.getString(2)), userId)
                .stream().findFirst().orElseThrow(() -> ApiException.notFound("Sin foto"));
    }

    /**
     * Borra la cuenta y todos sus datos: sus salas (con archivos, notas y pizarras), sus archivos y documentos en las salas de
     * otras personas, su pertenencia a ellas, su foto, sus sesiones y sus bibliotecas. Los objetos del almacén se borran también.
     */
    @Transactional
    public void deleteAccount(UUID userId) {
        User u = user(userId);
        if (u.getRole() == Role.ADMIN && users.countByRole(Role.ADMIN) <= 1) throw ApiException.badRequest("No se puede borrar al único administrador");
        events.publishEvent(new UserEvent(userId, "account.deleted", Map.of("message", "Tu cuenta se ha eliminado")));
        files.deleteAllForUser(userId); // primero lo suyo suelto (también en salas ajenas); luego sus salas enteras
        uploads.abortAllForUser(userId);
        rooms.removeAccountFromRooms(userId);
        users.delete(u); // el resto (miembros, notas, carpetas, documentos, bibliotecas, sesiones, foto…) cae en cascada
        users.flush();
    }

}
