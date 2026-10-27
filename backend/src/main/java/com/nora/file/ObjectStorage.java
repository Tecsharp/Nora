package com.nora.file;

import com.nora.config.AppProperties;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Almacén de archivos en un directorio (volumen Docker privado montado solo en el backend).
 * Las claves las genera el servidor ("rooms/{uuid}/{uuid}"); aun así se comprueba que nunca salgan del directorio base.
 */
@Component
public class ObjectStorage {

    private static final Logger log = LoggerFactory.getLogger(ObjectStorage.class);

    private final Path base;

    public ObjectStorage(AppProperties props) throws IOException {
        this.base = Path.of(props.storage().dir()).toAbsolutePath().normalize();
        Files.createDirectories(base);
    }

    private Path resolve(String key) {
        Path p = base.resolve(key).normalize();
        if (!p.startsWith(base)) throw new IllegalArgumentException("Clave de objeto no válida");
        return p;
    }

    public void put(String key, InputStream in, long size) throws IOException {
        Path target = resolve(key);
        Files.createDirectories(target.getParent());
        Path tmp = Files.createTempFile(target.getParent(), ".upload-", ".tmp");
        try {
            Files.copy(in, tmp, StandardCopyOption.REPLACE_EXISTING);
            Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE);
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    public InputStream get(String key) throws IOException {
        return Files.newInputStream(resolve(key));
    }

    public void delete(String key) {
        try {
            Path p = resolve(key);
            Files.deleteIfExists(p);
            Path dir = p.getParent();
            if (dir != null && !dir.equals(base)) {
                try (var s = Files.list(dir)) {
                    if (s.findAny().isEmpty()) Files.deleteIfExists(dir);
                }
            }
        } catch (Exception e) {
            log.error("No se pudo borrar el objeto {}", key, e);
        }
    }
}
