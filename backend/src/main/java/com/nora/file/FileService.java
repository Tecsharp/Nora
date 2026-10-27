package com.nora.file;

import com.nora.common.ApiException;
import com.nora.user.Role;
import com.nora.user.User;
import com.nora.user.UserRepository;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.nora.ws.RoomEvent;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class FileService {

    public record FileDto(UUID id, String name, long sizeBytes, UUID uploaderId, java.time.Instant createdAt, UUID folderId) {
        static FileDto of(RoomFile f) {
            return new FileDto(f.getId(), f.getOriginalName(), f.getSizeBytes(), f.getUploaderId(), f.getCreatedAt(), f.getFolderId());
        }
    }

    public record Download(RoomFile file, InputStream stream) {}

    private final RoomFileRepository files;
    private final ObjectStorage storage;
    private final StorageCleaner cleaner;
    private final UserRepository users;
    private final ApplicationEventPublisher events;

    public FileService(RoomFileRepository files, ObjectStorage storage, StorageCleaner cleaner, UserRepository users, ApplicationEventPublisher events) {
        this.cleaner = cleaner;
        this.files = files;
        this.storage = storage;
        this.users = users;
        this.events = events;
    }

    public long usedBytes(UUID userId) {
        return files.sumSizeByUploader(userId);
    }

    @Transactional(readOnly = true)
    public List<FileDto> list(UUID roomId) {
        return files.findByRoomIdOrderByCreatedAtDesc(roomId).stream().map(FileDto::of).toList();
    }

    @Transactional
    public FileDto upload(UUID roomId, UUID userId, MultipartFile multipart, UUID folderId) {
        if (multipart.isEmpty()) throw ApiException.badRequest("El archivo está vacío");
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("Usuario no encontrado"));
        long size = multipart.getSize();
        if (user.getMaxFileSizeBytes() != null && size > user.getMaxFileSizeBytes()) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE,
                    "El archivo supera tu límite de " + humanSize(user.getMaxFileSizeBytes()));
        }
        if (user.getStorageQuotaBytes() != null && usedBytes(userId) + size > user.getStorageQuotaBytes()) {
            throw new ApiException(HttpStatus.INSUFFICIENT_STORAGE, "Has agotado tu espacio de almacenamiento");
        }
        String contentType = multipart.getContentType() == null ? "application/octet-stream" : multipart.getContentType();
        RoomFile entity = new RoomFile(roomId, userId, sanitize(multipart.getOriginalFilename()),
                contentType.length() > 127 ? "application/octet-stream" : contentType, size);
        entity.setFolderId(folderId);
        try (InputStream in = multipart.getInputStream()) {
            storage.put(entity.getObjectKey(), in, size);
        } catch (Exception e) {
            throw new IllegalStateException("No se pudo guardar el archivo", e);
        }
        try {
            return added(files.saveAndFlush(entity));
        } catch (RuntimeException e) {
            storage.delete(entity.getObjectKey());
            throw e;
        }
    }

    @Transactional(readOnly = true)
    public Download download(UUID roomId, UUID fileId) {
        RoomFile f = find(roomId, fileId);
        try {
            return new Download(f, storage.get(f.getObjectKey()));
        } catch (Exception e) {
            throw new IllegalStateException("No se pudo leer el archivo", e);
        }
    }

    @Transactional
    public void delete(UUID roomId, UUID fileId, UUID userId, boolean staff) {
        RoomFile f = find(roomId, fileId);
        if (!f.getUploaderId().equals(userId) && !staff) {
            throw ApiException.forbidden("No puedes borrar este archivo");
        }
        files.delete(f);
        cleaner.schedule(f.getObjectKey()); // el objeto se borra tras confirmar; si Garage falla, queda anotado
        events.publishEvent(new RoomEvent(roomId, "file.deleted", Map.of("id", f.getId())));
    }

    /** Mueve a otra carpeta (null = raíz) y/o renombra. Solo quien lo subió, el dueño de la sala o un admin. */
    @Transactional
    public FileDto update(UUID roomId, UUID fileId, UUID userId, boolean staff, boolean moveRequested, UUID folderId, String name) {
        RoomFile f = find(roomId, fileId);
        if (!f.getUploaderId().equals(userId) && !staff) {
            throw ApiException.forbidden("No puedes modificar este archivo");
        }
        if (moveRequested) f.setFolderId(folderId);
        if (name != null) f.setOriginalName(sanitize(name));
        FileDto dto = FileDto.of(files.saveAndFlush(f));
        events.publishEvent(new RoomEvent(roomId, "file.updated", dto));
        return dto;
    }

    /** Borra del almacén y de la base de datos los archivos de las carpetas dadas. Devuelve sus ids. */
    @Transactional
    public List<UUID> deleteInFolders(UUID roomId, java.util.Collection<UUID> folderIds) {
        List<RoomFile> doomed = files.findByRoomIdAndFolderIdIn(roomId, folderIds);
        for (RoomFile f : doomed) cleaner.schedule(f.getObjectKey());
        files.deleteAll(doomed);
        return doomed.stream().map(RoomFile::getId).toList();
    }

    /** Registra un archivo cuyo contenido ya está en el almacén (subida reanudable completada). */
    @Transactional
    public FileDto register(RoomFile entity) {
        return added(files.saveAndFlush(entity));
    }

    private FileDto added(RoomFile saved) {
        FileDto dto = FileDto.of(saved);
        events.publishEvent(new RoomEvent(saved.getRoomId(), "file.added", dto));
        return dto;
    }

    @Transactional
    public void deleteAllForRoom(UUID roomId) {
        for (RoomFile f : files.findByRoomIdOrderByCreatedAtDesc(roomId)) {
            cleaner.schedule(f.getObjectKey());
        }
    }

    private RoomFile find(UUID roomId, UUID fileId) {
        RoomFile f = files.findById(fileId).orElseThrow(() -> ApiException.notFound("Archivo no encontrado"));
        if (!f.getRoomId().equals(roomId)) throw ApiException.notFound("Archivo no encontrado");
        return f;
    }

    /** Elimina rutas, caracteres de control y limita la longitud del nombre original. */
    public static String sanitize(String name) {
        if (name == null || name.isBlank()) return "archivo";
        String n = name.replace('\\', '/');
        n = n.substring(n.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "").trim();
        if (n.isEmpty() || n.equals(".") || n.equals("..")) return "archivo";
        return n.length() > 200 ? n.substring(n.length() - 200) : n;
    }

    private static String humanSize(long bytes) {
        double mb = bytes / 1024.0 / 1024.0;
        return mb >= 1024 ? String.format("%.1f GB", mb / 1024) : String.format("%.0f MB", mb);
    }
}
