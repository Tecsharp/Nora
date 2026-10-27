package com.nora.file;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nora.config.AppProperties;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Deja Garage listo sin intervención del usuario, usando su API de administración (v1):
 * asigna el layout del nodo único, crea el bucket privado y una clave de acceso solo para este backend.
 * Es idempotente: en arranques posteriores solo recupera la clave existente.
 */
class GarageBootstrap {

    record Credentials(String accessKey, String secretKey) {}

    private static final Logger log = LoggerFactory.getLogger(GarageBootstrap.class);
    private static final String KEY_NAME = "nora-backend";

    private final AppProperties.Storage cfg;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final ObjectMapper json = new ObjectMapper();

    GarageBootstrap(AppProperties.Storage cfg) {
        this.cfg = cfg;
    }

    Credentials run() throws Exception {
        String nodeId = call("GET", "/v1/status", null).get("node").asText();
        ensureLayout(nodeId);
        String bucketId = ensureBucket();
        JsonNode key = ensureKey();
        String accessKey = key.get("accessKeyId").asText();
        call("POST", "/v1/bucket/allow", Map.of(
                "bucketId", bucketId,
                "accessKeyId", accessKey,
                "permissions", Map.of("read", true, "write", true, "owner", true)));
        return new Credentials(accessKey, key.get("secretAccessKey").asText());
    }

    private void ensureLayout(String nodeId) throws Exception {
        JsonNode layout = call("GET", "/v1/layout", null);
        if (layout.get("roles").size() > 0) return;
        call("POST", "/v1/layout", List.of(Map.of(
                "id", nodeId, "zone", "nora", "capacity", 1_000_000_000L, "tags", List.of("nora"))));
        call("POST", "/v1/layout/apply", Map.of("version", layout.get("version").asInt() + 1));
        log.info("Garage: layout inicial aplicado");
    }

    private String ensureBucket() throws Exception {
        JsonNode existing = callOrNull("GET", "/v1/bucket?globalAlias=" + cfg.bucket());
        if (existing != null) return existing.get("id").asText();
        JsonNode created = call("POST", "/v1/bucket", Map.of("globalAlias", cfg.bucket()));
        log.info("Garage: bucket '{}' creado", cfg.bucket());
        return created.get("id").asText();
    }

    private JsonNode ensureKey() throws Exception {
        // Se lista (en vez de buscar) porque Garage responde 400 cuando una búsqueda no encuentra nada.
        for (JsonNode k : call("GET", "/v1/key?list", null)) {
            if (KEY_NAME.equals(k.path("name").asText())) {
                JsonNode full = call("GET", "/v1/key?id=" + k.get("id").asText() + "&showSecretKey=true", null);
                if (full.hasNonNull("secretAccessKey")) return full;
            }
        }
        JsonNode created = call("POST", "/v1/key", Map.of("name", KEY_NAME));
        log.info("Garage: clave de acceso creada");
        return created;
    }

    private JsonNode callOrNull(String method, String path) throws Exception {
        HttpResponse<String> res = send(method, path, null);
        if (res.statusCode() == 404) return null;
        return parse(res, path);
    }

    private JsonNode call(String method, String path, Object body) throws Exception {
        return parse(send(method, path, body), path);
    }

    private JsonNode parse(HttpResponse<String> res, String path) throws Exception {
        if (res.statusCode() / 100 != 2) {
            throw new IllegalStateException("Garage " + path + " -> " + res.statusCode() + " " + res.body());
        }
        return res.body().isBlank() ? json.createObjectNode() : json.readTree(res.body());
    }

    private HttpResponse<String> send(String method, String path, Object body) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(cfg.adminEndpoint() + path))
                .timeout(Duration.ofSeconds(15))
                .header("Authorization", "Bearer " + cfg.adminToken());
        if (body != null) {
            b.header("Content-Type", "application/json")
                    .method(method, HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        } else {
            b.method(method, HttpRequest.BodyPublishers.noBody());
        }
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }
}
