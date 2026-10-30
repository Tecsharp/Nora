package com.nora.file;

import com.google.common.collect.HashMultimap;
import com.nora.config.AppProperties;
import io.minio.GetObjectArgs;
import io.minio.ListObjectsArgs;
import io.minio.Result;
import io.minio.messages.Item;
import io.minio.MinioAsyncClient;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import io.minio.messages.Part;
import java.io.InputStream;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Acceso al bucket privado de Garage (API S3). Garage solo es alcanzable desde la red interna
 * y nunca se generan URLs prefirmadas: todo pasa por la API de Nora.
 */
@Component
public class ObjectStorage {

    private static final Logger log = LoggerFactory.getLogger(ObjectStorage.class);

    /** El cliente S3 no expone el multipart de bajo nivel; esta subclase usa sus métodos protegidos (versión fijada en el pom). */
    private static final class MultipartClient extends MinioAsyncClient {
        MultipartClient(MinioAsyncClient base) {
            super(base);
        }

        String create(String bucket, String region, String key) throws Exception {
            return createMultipartUploadAsync(bucket, region, key, HashMultimap.create(), HashMultimap.create())
                    .get().result().uploadId();
        }

        String uploadPart(String bucket, String region, String key, String uploadId, int number, byte[] data) throws Exception {
            return uploadPartAsync(bucket, region, key, data, data.length, uploadId, number,
                    HashMultimap.create(), HashMultimap.create()).get().etag();
        }

        void complete(String bucket, String region, String key, String uploadId, Part[] parts) throws Exception {
            completeMultipartUploadAsync(bucket, region, key, uploadId, parts, HashMultimap.create(), HashMultimap.create()).get();
        }

        void abort(String bucket, String region, String key, String uploadId) throws Exception {
            abortMultipartUploadAsync(bucket, region, key, uploadId, HashMultimap.create(), HashMultimap.create()).get();
        }
    }

    public record CompletedPart(int number, String etag) {}

    private final AppProperties.Storage cfg;
    private volatile MinioClient client;
    private volatile MultipartClient multipart;

    public ObjectStorage(AppProperties props) {
        this.cfg = props.storage();
    }

    /** Al arrancar se prepara Garage en segundo plano; si todavía no está listo se reintenta en el primer uso. */
    @EventListener(ApplicationReadyEvent.class)
    void onReady() {
        Thread.ofVirtual().start(() -> {
            for (int attempt = 1; attempt <= 60; attempt++) {
                try {
                    client();
                    return;
                } catch (Exception e) {
                    log.warn("Garage aún no está listo (intento {}): {}", attempt, e.getMessage());
                    try {
                        Thread.sleep(3000);
                    } catch (InterruptedException ie) {
                        return;
                    }
                }
            }
        });
    }

    private MinioClient client() throws Exception {
        MinioClient c = client;
        if (c != null) return c;
        synchronized (this) {
            if (client == null) {
                var creds = new GarageBootstrap(cfg).run();
                // Con Garage caído las llamadas deben fallar pronto, no quedarse minutos esperando
                var http = io.minio.http.HttpUtils.newDefaultHttpClient(15_000, 120_000, 120_000);
                var async = MinioAsyncClient.builder().endpoint(cfg.endpoint()).region(cfg.region())
                        .credentials(creds.accessKey(), creds.secretKey()).httpClient(http).build();
                multipart = new MultipartClient(async);
                client = MinioClient.builder().endpoint(cfg.endpoint()).region(cfg.region())
                        .credentials(creds.accessKey(), creds.secretKey()).httpClient(http).build();
                log.info("Almacenamiento Garage listo (bucket '{}')", cfg.bucket());
            }
            return client;
        }
    }

    private MultipartClient multipart() throws Exception {
        client();
        return multipart;
    }

    public void put(String key, InputStream in, long size) throws Exception {
        client().putObject(PutObjectArgs.builder().bucket(cfg.bucket()).object(key)
                .stream(in, size, -1).contentType("application/octet-stream").build());
    }

    public InputStream get(String key) throws Exception {
        return client().getObject(GetObjectArgs.builder().bucket(cfg.bucket()).object(key).build());
    }

    /** Un tramo del objeto (para reproducir audio y vídeo con saltos sin bajarlo entero). */
    public InputStream getRange(String key, long offset, long length) throws Exception {
        return client().getObject(GetObjectArgs.builder().bucket(cfg.bucket()).object(key).offset(offset).length(length).build());
    }

    /** Objeto guardado, tal como lo ve Garage. */
    public record StoredObject(String key, long size, java.time.Instant lastModified) {}

    /** Lista los objetos del bucket bajo un prefijo (recorre todas las páginas). */
    public List<StoredObject> list(String prefix) throws Exception {
        List<StoredObject> out = new java.util.ArrayList<>();
        for (Result<Item> r : client().listObjects(ListObjectsArgs.builder().bucket(cfg.bucket()).prefix(prefix).recursive(true).build())) {
            Item i = r.get();
            if (i.isDir()) continue;
            out.add(new StoredObject(i.objectName(), i.size(), i.lastModified() == null ? java.time.Instant.EPOCH : i.lastModified().toInstant()));
        }
        return out;
    }

    /** Borra un objeto y propaga el error (a diferencia de delete, que solo lo registra). Borrar uno inexistente no falla. */
    public void deleteNow(String key) throws Exception {
        client().removeObject(RemoveObjectArgs.builder().bucket(cfg.bucket()).object(key).build());
    }

    public void delete(String key) {
        try {
            client().removeObject(RemoveObjectArgs.builder().bucket(cfg.bucket()).object(key).build());
        } catch (Exception e) {
            log.error("No se pudo borrar el objeto {}", key, e);
        }
    }

    // ---- Multipart (subidas reanudables) ----

    public String startMultipart(String key) throws Exception {
        return multipart().create(cfg.bucket(), cfg.region(), key);
    }

    /** @return el ETag del trozo. Subir dos veces el mismo número sobrescribe el anterior. */
    public String uploadPart(String key, String uploadId, int number, byte[] data) throws Exception {
        return multipart().uploadPart(cfg.bucket(), cfg.region(), key, uploadId, number, data);
    }

    public void completeMultipart(String key, String uploadId, List<CompletedPart> parts) throws Exception {
        Part[] arr = parts.stream().map(p -> new Part(p.number(), p.etag())).toArray(Part[]::new);
        multipart().complete(cfg.bucket(), cfg.region(), key, uploadId, arr);
    }

    public void abortMultipart(String key, String uploadId) {
        try {
            multipart().abort(cfg.bucket(), cfg.region(), key, uploadId);
        } catch (Exception e) {
            log.warn("No se pudo abortar el multipart {}: {}", uploadId, e.getMessage());
        }
    }
}
