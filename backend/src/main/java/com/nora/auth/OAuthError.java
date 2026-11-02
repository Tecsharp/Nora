package com.nora.auth;

/** Fallo del inicio de sesión con Google; el código se lleva a la pantalla de acceso, que lo explica a la persona. */
public class OAuthError extends RuntimeException {
    private final String code;

    public OAuthError(String code) {
        super(code);
        this.code = code;
    }

    public OAuthError(String code, Throwable cause) {
        super(code, cause);
        this.code = code;
    }

    public String code() { return code; }
}
