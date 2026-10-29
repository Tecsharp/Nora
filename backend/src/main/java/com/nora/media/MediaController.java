package com.nora.media;

import com.nora.auth.AuthPrincipal;
import com.nora.common.ApiException;
import com.nora.config.AppProperties;
import com.nora.file.FileService;
import com.nora.file.ObjectStorage;
import com.nora.file.RoomFile;
import com.nora.room.Room;
import com.nora.room.RoomService;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/**
 * Reproducción de audio y vídeo de los archivos de la sala. Un reproductor del navegador no puede enviar la cabecera Authorization, así que
 * quien participa pide una dirección firmada y de vida corta ({@code POST …/files/{id}/stream}) y la reproduce; el servidor atiende
 * peticiones por tramos (Range) para poder saltar dentro del vídeo. Solo se sirven tipos de audio/vídeo conocidos, nunca algo ejecutable.
 */
@RestController
public class MediaController {

    private static final long TTL_SECONDS = 6 * 3600;
    private static final Map<String, String> TYPES = Map.ofEntries(
            Map.entry("mp4", "video/mp4"), Map.entry("m4v", "video/mp4"), Map.entry("webm", "video/webm"), Map.entry("mov", "video/quicktime"),
            Map.entry("ogv", "video/ogg"), Map.entry("mkv", "video/x-matroska"),
            Map.entry("mp3", "audio/mpeg"), Map.entry("m4a", "audio/mp4"), Map.entry("aac", "audio/aac"), Map.entry("wav", "audio/wav"),
            Map.entry("ogg", "audio/ogg"), Map.entry("oga", "audio/ogg"), Map.entry("opus", "audio/ogg"), Map.entry("flac", "audio/flac"), Map.entry("weba", "audio/webm"),
            // imágenes rasterizadas (nunca SVG: serviría de vector para scripts)
            Map.entry("png", "image/png"), Map.entry("jpg", "image/jpeg"), Map.entry("jpeg", "image/jpeg"), Map.entry("gif", "image/gif"), Map.entry("webp", "image/webp"), Map.entry("avif", "image/avif"), Map.entry("bmp", "image/bmp"));

    private final RoomService rooms;
    private final FileService files;
    private final ObjectStorage storage;
    private final SecretKeySpec key;

    public MediaController(RoomService rooms, FileService files, ObjectStorage storage, AppProperties props) {
        this.rooms = rooms;
        this.files = files;
        this.storage = storage;
        this.key = new SecretKeySpec((props.jwt().secret() + "|nora-media").getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    private static String ext(String name) {
        int i = name.lastIndexOf('.');
        return i < 0 ? "" : name.substring(i + 1).toLowerCase();
    }

    @PostMapping("/api/rooms/{code}/files/{fileId}/stream")
    public Map<String, Object> issue(@AuthenticationPrincipal AuthPrincipal p, @PathVariable String code, @PathVariable UUID fileId) {
        Room room = rooms.requireMember(p.userId(), code);
        RoomFile f = files.meta(room.getId(), fileId);
        String type = TYPES.get(ext(f.getOriginalName()));
        if (type == null) throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Ese archivo no es de audio, vídeo o imagen que el navegador pueda mostrar");
        long exp = Instant.now().getEpochSecond() + TTL_SECONDS;
        String body = room.getId() + "." + fileId + "." + exp;
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(body.getBytes(StandardCharsets.UTF_8)) + "." + sign(body);
        return Map.of("url", "/api/media/" + token, "contentType", type, "expiresInSeconds", TTL_SECONDS, "name", f.getOriginalName(), "size", f.getSizeBytes());
    }

    @GetMapping("/api/media/{token}")
    public ResponseEntity<StreamingResponseBody> serve(@PathVariable String token, @RequestHeader(value = HttpHeaders.RANGE, required = false) String range) throws Exception {
        UUID roomId;
        UUID fileId;
        try {
            int dot = token.indexOf('.');
            String body = new String(Base64.getUrlDecoder().decode(token.substring(0, dot)), StandardCharsets.UTF_8);
            if (!MessageDigest.isEqual(sign(body).getBytes(StandardCharsets.UTF_8), token.substring(dot + 1).getBytes(StandardCharsets.UTF_8))) throw new IllegalArgumentException();
            String[] parts = body.split("\\.");
            if (Long.parseLong(parts[2]) < Instant.now().getEpochSecond()) throw ApiException.forbidden("El enlace de reproducción caducó");
            roomId = UUID.fromString(parts[0]);
            fileId = UUID.fromString(parts[1]);
        } catch (ApiException e) {
            throw e;
        } catch (RuntimeException e) {
            throw ApiException.forbidden("Enlace de reproducción no válido");
        }
        RoomFile f = files.meta(roomId, fileId);
        String type = TYPES.get(ext(f.getOriginalName()));
        if (type == null) throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Tipo no reproducible");
        long size = f.getSizeBytes();
        long start = 0;
        long end = size - 1;
        boolean partial = false;
        if (range != null && range.startsWith("bytes=") && !range.contains(",")) {
            String[] r = range.substring(6).split("-", -1);
            try {
                if (r[0].isEmpty()) {
                    long n = Long.parseLong(r[1]);
                    start = Math.max(0, size - n);
                } else {
                    start = Long.parseLong(r[0]);
                    if (!r[1].isEmpty()) end = Math.min(end, Long.parseLong(r[1]));
                }
                partial = true;
            } catch (NumberFormatException e) {
                partial = false;
            }
            if (partial && (start > end || start >= size)) {
                return ResponseEntity.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE).header(HttpHeaders.CONTENT_RANGE, "bytes */" + size).build();
            }
        }
        final long from = start;
        final long len = end - start + 1;
        StreamingResponseBody out = os -> {
            try (InputStream in = partial(from, len, size) ? storage.getRange(f.getObjectKey(), from, len) : storage.get(f.getObjectKey())) {
                in.transferTo(os);
            } catch (Exception e) {
                // el reproductor cortó la conexión (saltó a otro punto): normal
            }
        };
        ResponseEntity.BodyBuilder b = ResponseEntity.status(partial ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK)
                .contentType(MediaType.parseMediaType(type))
                .contentLength(len)
                .header(HttpHeaders.ACCEPT_RANGES, "bytes")
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=3600")
                .header("X-Content-Type-Options", "nosniff")
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline");
        if (partial) b.header(HttpHeaders.CONTENT_RANGE, "bytes " + start + "-" + end + "/" + size);
        return b.body(out);
    }

    private static boolean partial(long from, long len, long size) { return !(from == 0 && len == size); }

    private String sign(String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
