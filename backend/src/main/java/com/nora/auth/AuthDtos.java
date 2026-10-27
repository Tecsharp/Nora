package com.nora.auth;

import com.nora.user.UserDto;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class AuthDtos {
    private AuthDtos() {}

    public record RegisterRequest(
            @NotBlank(message = "El email es obligatorio")
            @Email(message = "Email no válido")
            @Size(max = 254, message = "Email demasiado largo")
            String email,

            @NotBlank(message = "El nombre es obligatorio")
            @Size(min = 2, max = 60, message = "El nombre debe tener entre 2 y 60 caracteres")
            @Pattern(regexp = "^[\\p{L}\\p{N} ._'-]+$", message = "El nombre contiene caracteres no permitidos")
            String displayName,

            @NotBlank(message = "La contraseña es obligatoria")
            @Size(min = 10, max = 72, message = "La contraseña debe tener entre 10 y 72 caracteres")
            @Pattern(regexp = "^(?=.*\\p{Lu})(?=.*\\p{Ll})(?=.*\\d).*$",
                    message = "La contraseña necesita mayúscula, minúscula y número")
            String password) {}

    public record LoginRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Size(max = 72) String password) {}

    public record AuthResponse(String accessToken, long expiresInSeconds, UserDto user) {}
}
