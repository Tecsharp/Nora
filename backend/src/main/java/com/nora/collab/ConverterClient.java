package com.nora.collab;

import com.nora.common.ApiException;
import com.nora.config.AppProperties;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Cliente del servicio interno de conversión (LibreOffice). Sin él la edición colaborativa sigue funcionando para documentos nuevos. */
@Component
public class ConverterClient {

    private static final Logger log = LoggerFactory.getLogger(ConverterClient.class);

    private final AppProperties.Converter cfg;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public ConverterClient(AppProperties props) {
        this.cfg = props.converter();
    }

    public boolean enabled() {
        return cfg != null && cfg.url() != null && !cfg.url().isBlank();
    }

    /** Archivo de oficina -> JSON nativo del editor. */
    public String importFile(byte[] file, String ext) {
        return new String(call("/v1/import?ext=" + enc(ext), file, "application/octet-stream"), StandardCharsets.UTF_8);
    }

    /** JSON nativo del editor -> archivo en el formato pedido. */
    public byte[] export(String kind, String format, byte[] nativeJson, int active) {
        return call("/v1/export?kind=" + enc(kind) + "&format=" + enc(format) + "&active=" + active, nativeJson, "application/json");
    }

    private byte[] call(String path, byte[] body, String contentType) {
        if (!enabled()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "La conversión de archivos de oficina no está activada en este servidor");
        try {
            var req = HttpRequest.newBuilder(URI.create(cfg.url() + path)).timeout(Duration.ofSeconds(150))
                    .header("Content-Type", contentType).header("X-Converter-Token", cfg.token() == null ? "" : cfg.token())
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
            HttpResponse<byte[]> res = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
            if (res.statusCode() == 200) return res.body();
            String msg = new String(res.body(), StandardCharsets.UTF_8);
            log.warn("El conversor respondió {}: {}", res.statusCode(), msg);
            if (res.statusCode() == 400 || res.statusCode() == 413) throw ApiException.badRequest("No se puede convertir este archivo (formato no admitido o demasiado grande)");
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "No se pudo convertir el archivo. Puede estar dañado o ser de una versión no compatible.");
        } catch (ApiException e) {
            throw e;
        } catch (java.net.ConnectException | java.net.http.HttpConnectTimeoutException e) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "El servicio de conversión no está disponible");
        } catch (Exception e) {
            log.warn("Fallo al llamar al conversor: {}", e.toString());
            throw new ApiException(HttpStatus.BAD_GATEWAY, "El servicio de conversión no respondió a tiempo");
        }
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }
}
