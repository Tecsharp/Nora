package com.nora.user;

import com.nora.auth.AuthPrincipal;
import com.nora.common.ApiException;
import com.nora.file.FileService;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/me")
public class MeController {

    private final UserRepository users;
    private final FileService files;

    public MeController(UserRepository users, FileService files) {
        this.users = users;
        this.files = files;
    }

    @GetMapping
    public Map<String, Object> me(@AuthenticationPrincipal AuthPrincipal p) {
        User u = users.findById(p.userId()).orElseThrow(() -> ApiException.notFound("Usuario no encontrado"));
        return Map.of("user", UserDto.of(u), "storageUsedBytes", files.usedBytes(u.getId()));
    }
}
