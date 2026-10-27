package com.nora.file;

import com.nora.config.AppProperties;
import io.minio.GetObjectArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import java.io.InputStream;
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

    private final AppProperties.Storage cfg;
    private volatile MinioClient client;

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
                client = MinioClient.builder().endpoint(cfg.endpoint()).region(cfg.region())
                        .credentials(creds.accessKey(), creds.secretKey()).build();
                log.info("Almacenamiento Garage listo (bucket '{}')", cfg.bucket());
            }
            return client;
        }
    }

    public void put(String key, InputStream in, long size) throws Exception {
        client().putObject(PutObjectArgs.builder().bucket(cfg.bucket()).object(key)
                .stream(in, size, -1).contentType("application/octet-stream").build());
    }

    public InputStream get(String key) throws Exception {
        return client().getObject(GetObjectArgs.builder().bucket(cfg.bucket()).object(key).build());
    }

    public void delete(String key) {
        try {
            client().removeObject(RemoveObjectArgs.builder().bucket(cfg.bucket()).object(key).build());
        } catch (Exception e) {
            log.error("No se pudo borrar el objeto {}", key, e);
        }
    }
}
