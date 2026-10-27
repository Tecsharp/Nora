package com.nora.config;

import com.nora.auth.AuthService;
import com.nora.user.Role;
import com.nora.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/** Crea el administrador inicial a partir de NORA_ADMIN_EMAIL / NORA_ADMIN_PASSWORD si todavía no existe ninguno. */
@Component
public class AdminBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    private final AppProperties props;
    private final UserRepository users;
    private final AuthService auth;

    public AdminBootstrap(AppProperties props, UserRepository users, AuthService auth) {
        this.props = props;
        this.users = users;
        this.auth = auth;
    }

    @Override
    public void run(ApplicationArguments args) {
        var admin = props.admin();
        if (admin.email() == null || admin.email().isBlank() || admin.password() == null || admin.password().isBlank()) {
            if (users.countByRole(Role.ADMIN) == 0) {
                log.warn("No hay administrador: define NORA_ADMIN_EMAIL y NORA_ADMIN_PASSWORD");
            }
            return;
        }
        if (users.countByRole(Role.ADMIN) > 0) return;
        if (admin.password().length() < 10) {
            throw new IllegalStateException("NORA_ADMIN_PASSWORD debe tener al menos 10 caracteres");
        }
        var u = auth.createUser(admin.email(), admin.name(), admin.password(), Role.ADMIN);
        // El administrador no tiene límites por defecto.
        u.setStorageQuotaBytes(null);
        u.setMaxFileSizeBytes(null);
        u.setMaxRoomMinutes(null);
        u.setMaxActiveRooms(null);
        u.setMaxParticipants(null);
        users.save(u);
        log.info("Administrador inicial creado: {}", u.getEmail());
    }
}
