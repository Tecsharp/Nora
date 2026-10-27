package com.nora.auth;

import com.nora.user.Role;
import java.util.UUID;

public record AuthPrincipal(UUID userId, Role role) {}
