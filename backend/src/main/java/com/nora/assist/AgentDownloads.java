package com.nora.assist;

import com.nora.config.AppProperties;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * Dónde se descarga el agente en cada sistema. Sale del .env: un enlace por sistema, o solo el repositorio de GitHub
 * (NORA_AGENT_REPO) y los enlaces a la última Release se arman solos. Los armados se comprueban una vez cada 10 minutos
 * para no ofrecer un botón que lleva a un 404; lo que no se pueda comprobar (sin salida a Internet) se ofrece igualmente.
 */
@Service
public class AgentDownloads {

    private static final Pattern REPO = Pattern.compile("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$");
    private static final Map<String, String> FILES = Map.of("windows", "nora-agent-windows.exe", "macos", "nora-agent-macos.zip", "linux", "nora-agent-linux");
    private static final long TTL_MS = 10 * 60_000;

    private record Checked(boolean exists, long at) {}

    private final AppProperties props;
    private final Map<String, Checked> cache = new ConcurrentHashMap<>();
    private final HttpClient http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).connectTimeout(Duration.ofSeconds(4)).build();

    public AgentDownloads(AppProperties props) {
        this.props = props;
    }

    /** sistema → enlace (cadena vacía si no hay). */
    public Map<String, String> links() {
        var a = props.agent();
        Map<String, String> explicit = Map.of(
                "windows", clean(a == null ? null : a.urlWindows()),
                "macos", clean(a == null ? null : a.urlMacos()),
                "linux", clean(a == null ? null : a.urlLinux()));
        String repo = a == null || a.repo() == null ? "" : a.repo().strip();
        Map<String, String> out = new LinkedHashMap<>();
        for (String os : new String[] {"windows", "macos", "linux"}) {
            String url = explicit.get(os);
            if (url.isEmpty() && REPO.matcher(repo).matches()) {
                String built = "https://github.com/" + repo + "/releases/latest/download/" + FILES.get(os);
                url = exists(built) ? built : "";
            }
            out.put(os, url);
        }
        return out;
    }

    private boolean exists(String url) {
        Checked c = cache.get(url);
        if (c != null && System.currentTimeMillis() - c.at() < TTL_MS) return c.exists();
        boolean ok;
        try {
            int status = http.send(HttpRequest.newBuilder(URI.create(url)).method("HEAD", HttpRequest.BodyPublishers.noBody()).timeout(Duration.ofSeconds(5)).build(),
                    HttpResponse.BodyHandlers.discarding()).statusCode();
            ok = status < 400; // un 404 es «todavía no hay Release»; cualquier otro fallo de red se trata abajo
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return true;
        } catch (Exception e) {
            return true; // no se pudo comprobar: se ofrece igual (el navegador de quien descarga sí tendrá Internet)
        }
        cache.put(url, new Checked(ok, System.currentTimeMillis()));
        return ok;
    }

    /** Solo enlaces http(s): lo que venga del .env no puede ser un javascript: ni nada parecido. */
    private static String clean(String url) {
        String u = url == null ? "" : url.strip();
        return u.startsWith("https://") || u.startsWith("http://") ? u : "";
    }
}
