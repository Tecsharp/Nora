package com.nora.file;

import com.nora.config.AppProperties;
import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import java.io.InputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/** Acceso al bucket privado de MinIO. Nunca se generan URLs prefirmadas: todo pasa por la API. */
@Component
public class ObjectStorage {

    private static final Logger log = LoggerFactory.getLogger(ObjectStorage.class);

    private final MinioClient client;
    private final String bucket;

    public ObjectStorage(AppProperties props) {
        var s = props.storage();
        this.client = MinioClient.builder().endpoint(s.endpoint()).credentials(s.accessKey(), s.secretKey()).build();
        this.bucket = s.bucket();
    }

    private volatile boolean ready;

    @EventListener(ApplicationReadyEvent.class)
    void onReady() {
        try {
            ensureBucket();
        } catch (Exception e) {
            log.warn("MinIO no disponible todavía; se reintentará en el primer uso: {}", e.getMessage());
        }
    }

    private synchronized void ensureBucket() throws Exception {
        if (ready) return;
        if (!client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build())) {
            client.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
            log.info("Bucket creado: {}", bucket);
        }
        ready = true;
    }

    public void put(String key, InputStream in, long size) throws Exception {
        ensureBucket();
        client.putObject(PutObjectArgs.builder().bucket(bucket).object(key)
                .stream(in, size, -1).contentType("application/octet-stream").build());
    }

    public InputStream get(String key) throws Exception {
        return client.getObject(GetObjectArgs.builder().bucket(bucket).object(key).build());
    }

    public void delete(String key) {
        try {
            client.removeObject(RemoveObjectArgs.builder().bucket(bucket).object(key).build());
        } catch (Exception e) {
            log.error("No se pudo borrar el objeto {}", key, e);
        }
    }
}
