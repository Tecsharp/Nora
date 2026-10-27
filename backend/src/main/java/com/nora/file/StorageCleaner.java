package com.nora.file;

import com.nora.upload.UploadSessionRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Garantiza que los objetos de Garage acaban borrándose:
 * <ol>
 *   <li>Cada borrado se anota (tombstone) en la misma transacción que quita la fila de la base de datos y se intenta
 *       justo después de confirmarla. Si Garage no responde, queda anotado.</li>
 *   <li>Una tarea reintenta los pendientes cada pocos minutos hasta que Garage los borre.</li>
 *   <li>Otra concilia el bucket con la base de datos y borra los objetos sin archivo asociado (huérfanos), por si
 *       algo se perdió (un caído en mitad de una subida, un borrado manual de filas…).</li>
 * </ol>
 */
@Service
public class StorageCleaner {

    private static final Logger log = LoggerFactory.getLogger(StorageCleaner.class);
    private static final int BATCH = 500;

    public record SweepResult(int scanned, int orphans, int deleted, int failed, List<String> keys) {}

    public record Stats(boolean available, long objects, long bytes, long dbFiles, long pendingDeletions, String error) {}

    private final ObjectStorage storage;
    private final StorageTombstoneRepository tombstones;
    private final RoomFileRepository files;
    private final UploadSessionRepository sessions;
    private final long defaultGraceMinutes;

    public StorageCleaner(ObjectStorage storage, StorageTombstoneRepository tombstones, RoomFileRepository files,
                          UploadSessionRepository sessions,
                          @Value("${nora.storage.orphan-grace-minutes:60}") long defaultGraceMinutes) {
        this.storage = storage;
        this.tombstones = tombstones;
        this.files = files;
        this.sessions = sessions;
        this.defaultGraceMinutes = defaultGraceMinutes;
    }

    /** Anota el objeto para borrarlo y lo intenta cuando se confirme la transacción en curso. */
    public void schedule(String key) {
        if (!tombstones.existsById(key)) tombstones.save(new StorageTombstone(key));
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    Thread.ofVirtual().start(() -> attempt(key));
                }
            });
        } else {
            Thread.ofVirtual().start(() -> attempt(key));
        }
    }

    private boolean attempt(String key) {
        try {
            storage.deleteNow(key);
            tombstones.deleteById(key);
            return true;
        } catch (Exception e) {
            log.warn("No se pudo borrar {} de Garage (se reintentará): {}", key, e.getMessage());
            tombstones.findById(key).ifPresent(t -> {
                t.failed(e.getMessage());
                tombstones.save(t);
            });
            return false;
        }
    }

    /** Reintenta los borrados pendientes. */
    @Scheduled(fixedDelay = 120_000, initialDelay = 60_000)
    public int retryPending() {
        int done = 0;
        for (StorageTombstone t : tombstones.findAll()) {
            if (attempt(t.getObjectKey())) done++;
        }
        if (done > 0) log.info("Garage: {} borrados pendientes completados", done);
        return done;
    }

    /** Concilia el bucket con la base de datos. grace = minutos de margen para no tocar subidas recién terminadas. */
    @Scheduled(fixedDelay = 6 * 3_600_000L, initialDelay = 15 * 60_000L)
    public void scheduledSweep() {
        try {
            SweepResult r = sweepOrphans(defaultGraceMinutes);
            if (r.orphans() > 0) log.info("Garage: {} huérfanos encontrados, {} borrados", r.orphans(), r.deleted());
        } catch (Exception e) {
            log.warn("No se pudo conciliar Garage: {}", e.getMessage());
        }
    }

    public SweepResult sweepOrphans(Long graceMinutes) throws Exception {
        Instant cutoff = Instant.now().minus(Duration.ofMinutes(graceMinutes == null ? defaultGraceMinutes : graceMinutes));
        List<ObjectStorage.StoredObject> all = storage.list("rooms/");
        int orphans = 0, deleted = 0, failed = 0;
        List<String> keys = new ArrayList<>();
        for (int i = 0; i < all.size(); i += BATCH) {
            List<ObjectStorage.StoredObject> batch = all.subList(i, Math.min(all.size(), i + BATCH));
            Set<String> known = files.existingKeys(batch.stream().map(ObjectStorage.StoredObject::key).toList());
            for (ObjectStorage.StoredObject o : batch) {
                if (known.contains(o.key()) || o.lastModified().isAfter(cutoff)) continue;
                orphans++;
                keys.add(o.key());
                try {
                    storage.deleteNow(o.key());
                    tombstones.deleteById(o.key());
                    deleted++;
                } catch (Exception e) {
                    failed++;
                    log.warn("No se pudo borrar el huérfano {}: {}", o.key(), e.getMessage());
                }
            }
        }
        return new SweepResult(all.size(), orphans, deleted, failed, keys);
    }

    public Stats stats() {
        long pending = tombstones.count();
        long dbFiles = files.count();
        try {
            List<ObjectStorage.StoredObject> all = storage.list("rooms/");
            return new Stats(true, all.size(), all.stream().mapToLong(ObjectStorage.StoredObject::size).sum(), dbFiles, pending, null);
        } catch (Exception e) {
            return new Stats(false, 0, 0, dbFiles, pending, e.getMessage());
        }
    }
}
