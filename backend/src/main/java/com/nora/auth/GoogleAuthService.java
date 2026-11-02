package com.nora.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nora.config.AppProperties;
import com.nora.config.SettingsService;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

/**
 * Inicio de sesión con Google (OAuth 2.0, flujo de código con PKCE y OpenID Connect). El navegador va a Google, vuelve a
 * {@code /api/auth/google/callback} con un código, y es el servidor quien lo canjea (con el secreto del cliente) por la identidad:
 * el id_token llega directo de Google por TLS, así que no hace falta comprobar su firma, solo sus datos (emisor, cliente, vencimiento, nonce).
 */
@Service
public class GoogleAuthService {

    private static final Logger log = LoggerFactory.getLogger(GoogleAuthService.class);
    static final String CALLBACK_PATH = "/api/auth/google/callback";
    private static final Duration FLOW_TTL = Duration.ofMinutes(10);

    private final AppProperties props;
    private final SettingsService settings;
    private final ObjectMapper json;
    private final SecureRandom random = new SecureRandom();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    public GoogleAuthService(AppProperties props, SettingsService settings, ObjectMapper json) {
        this.props = props;
        this.settings = settings;
        this.json = json;
    }

    /** Lo que se guarda en una cookie mientras la persona está en Google: comprueba que quien vuelve es quien salió. */
    public record Flow(String state, String verifier, String nonce, boolean remember) {
        String encode() {
            return state + "." + verifier + "." + nonce + "." + (remember ? "1" : "0");
        }

        static Flow decode(String raw) {
            if (raw == null) return null;
            String[] p = raw.split("\\.");
            if (p.length != 4 || p[0].isBlank() || p[1].isBlank() || p[2].isBlank()) return null;
            return new Flow(p[0], p[1], p[2], p[3].equals("1"));
        }
    }

    public record Start(String url, Flow flow) {}

    public record Identity(String sub, String email, String name) {}

    private void requireEnabled() {
        if (!settings.googleLogin()) throw new OAuthError("disabled_mode");
    }

    /** Dirección a la que Google devuelve a la persona; tiene que estar dada de alta tal cual en la consola de Google. */
    public String redirectUri(HttpServletRequest req) {
        String pub = props.google().publicUrl();
        if (pub != null && !pub.isBlank()) return pub.trim().replaceAll("/+$", "") + CALLBACK_PATH;
        return ServletUriComponentsBuilder.fromRequestUri(req).replacePath(CALLBACK_PATH).replaceQuery(null).build().toUriString();
    }

    public Start start(HttpServletRequest req, boolean remember) {
        requireEnabled();
        Flow flow = new Flow(token(24), token(48), token(24), remember);
        String challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(sha256(flow.verifier()));
        String url = props.google().authUrl() + "?" + form(Map.of(
                "client_id", props.google().clientId(),
                "redirect_uri", redirectUri(req),
                "response_type", "code",
                "scope", "openid email profile",
                "state", flow.state(),
                "nonce", flow.nonce(),
                "code_challenge", challenge,
                "code_challenge_method", "S256",
                "prompt", "select_account"));
        return new Start(url, flow);
    }

    /** Cierra el flujo: comprueba el estado, canjea el código y devuelve quién es la persona (ya verificada por Google). */
    public Identity finish(HttpServletRequest req, String code, String state, String error, Flow flow) {
        requireEnabled();
        if (flow == null || state == null || !MessageDigest.isEqual(flow.state().getBytes(StandardCharsets.UTF_8), state.getBytes(StandardCharsets.UTF_8))) {
            throw new OAuthError("state");
        }
        if (error != null && !error.isBlank()) throw new OAuthError(error.equals("access_denied") ? "cancelled" : "failed");
        if (code == null || code.isBlank()) throw new OAuthError("failed");
        JsonNode token;
        try {
            HttpRequest r = HttpRequest.newBuilder(URI.create(props.google().tokenUrl()))
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .header("Accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(form(Map.of(
                            "code", code,
                            "client_id", props.google().clientId(),
                            "client_secret", props.google().clientSecret(),
                            "redirect_uri", redirectUri(req),
                            "grant_type", "authorization_code",
                            "code_verifier", flow.verifier()))))
                    .build();
            HttpResponse<String> res = http.send(r, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                log.warn("Google rechazó el código ({}): {}", res.statusCode(), res.body());
                throw new OAuthError("failed");
            }
            token = json.readTree(res.body());
        } catch (OAuthError e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new OAuthError("failed", e);
        } catch (Exception e) {
            log.warn("No se pudo hablar con Google: {}", e.toString());
            throw new OAuthError("failed", e);
        }
        return identity(token.path("id_token").asText(""), flow.nonce());
    }

    /** Lee y comprueba los datos del id_token (recibido directamente de Google). */
    Identity identity(String idToken, String nonce) {
        try {
            String[] parts = idToken.split("\\.");
            if (parts.length != 3) throw new OAuthError("failed");
            JsonNode c = json.readTree(Base64.getUrlDecoder().decode(parts[1]));
            String iss = c.path("iss").asText("");
            if (!iss.equals("https://accounts.google.com") && !iss.equals("accounts.google.com") && !tokenUrlIsCustom()) throw new OAuthError("failed");
            if (!props.google().clientId().equals(c.path("aud").asText(""))) throw new OAuthError("failed");
            if (c.path("exp").asLong(0) < Instant.now().getEpochSecond()) throw new OAuthError("failed");
            if (!nonce.equals(c.path("nonce").asText(""))) throw new OAuthError("state");
            String email = c.path("email").asText("").trim();
            String sub = c.path("sub").asText("");
            if (email.isEmpty() || sub.isEmpty() || sub.length() > 64) throw new OAuthError("failed");
            JsonNode ev = c.path("email_verified");
            if (!(ev.isBoolean() ? ev.asBoolean() : "true".equalsIgnoreCase(ev.asText("")))) throw new OAuthError("unverified");
            return new Identity(sub, email, c.path("name").asText(""));
        } catch (OAuthError e) {
            throw e;
        } catch (Exception e) {
            throw new OAuthError("failed", e);
        }
    }

    /** Solo para pruebas con un Google simulado: si el endpoint de tokens no es el de Google, el emisor lo decide quien lo configura. */
    private boolean tokenUrlIsCustom() {
        return !props.google().tokenUrl().startsWith("https://oauth2.googleapis.com/");
    }

    private String token(int bytes) {
        byte[] b = new byte[bytes];
        random.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    private static byte[] sha256(String s) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.US_ASCII));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String form(Map<String, String> p) {
        return p.entrySet().stream()
                .map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8) + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
    }

    static Duration flowTtl() { return FLOW_TTL; }
}
