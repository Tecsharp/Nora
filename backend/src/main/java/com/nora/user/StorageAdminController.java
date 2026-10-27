package com.nora.user;

import com.nora.file.StorageCleaner;
import com.nora.file.StorageCleaner.Stats;
import com.nora.file.StorageCleaner.SweepResult;
import org.springframework.web.bind.annotation.*;

/** Estado del almacenamiento y limpieza manual de objetos huérfanos (solo administradores). */
@RestController
@RequestMapping("/api/admin/storage")
public class StorageAdminController {

    private final StorageCleaner cleaner;

    public StorageAdminController(StorageCleaner cleaner) {
        this.cleaner = cleaner;
    }

    @GetMapping
    public Stats stats() {
        return cleaner.stats();
    }

    /** Reintenta los borrados pendientes y borra los objetos sin archivo asociado con más de `graceMinutes` de antigüedad. */
    @PostMapping("/sweep")
    public SweepResult sweep(@RequestParam(required = false) Long graceMinutes) throws Exception {
        cleaner.retryPending();
        return cleaner.sweepOrphans(graceMinutes == null ? null : Math.max(0, graceMinutes));
    }
}
