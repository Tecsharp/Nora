package com.nora.folder;

import com.nora.common.ApiException;
import com.nora.file.FileService;
import com.nora.note.RoomNoteRepository;
import com.nora.user.Role;
import com.nora.ws.RoomEvent;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Carpetas de archivos y categorías de notas/portapapeles. Todas las operaciones se publican por WebSocket. */
@Service
public class FolderService {

    public record FolderDto(UUID id, String kind, UUID parentId, String name, UUID createdBy, Instant createdAt) {
        static FolderDto of(RoomFolder f) {
            return new FolderDto(f.getId(), f.getKind().name(), f.getParentId(), f.getName(), f.getCreatedBy(), f.getCreatedAt());
        }
    }

    private static final int MAX_FOLDERS = 200;
    private static final int MAX_DEPTH = 6;

    private final RoomFolderRepository folders;
    private final FileService files;
    private final RoomNoteRepository notes;
    private final ApplicationEventPublisher events;

    public FolderService(RoomFolderRepository folders, FileService files, RoomNoteRepository notes, ApplicationEventPublisher events) {
        this.folders = folders;
        this.files = files;
        this.notes = notes;
        this.events = events;
    }

    @Transactional(readOnly = true)
    public List<FolderDto> list(UUID roomId, RoomFolder.Kind kind) {
        return folders.findByRoomIdAndKindOrderByNameAsc(roomId, kind).stream().map(FolderDto::of).toList();
    }

    @Transactional
    public FolderDto create(UUID roomId, UUID userId, RoomFolder.Kind kind, UUID parentId, String rawName) {
        String name = cleanName(rawName);
        List<RoomFolder> all = folders.findByRoomIdAndKindOrderByNameAsc(roomId, kind);
        if (all.size() >= MAX_FOLDERS) throw ApiException.conflict("Has alcanzado el máximo de carpetas");
        if (parentId != null) {
            RoomFolder parent = all.stream().filter(f -> f.getId().equals(parentId)).findFirst()
                    .orElseThrow(() -> ApiException.notFound("La carpeta padre no existe"));
            if (depth(all, parent) >= MAX_DEPTH) throw ApiException.badRequest("Demasiados niveles de carpetas");
        }
        requireUnique(all, parentId, name, null);
        RoomFolder saved = folders.save(new RoomFolder(roomId, kind, parentId, name, userId));
        FolderDto dto = FolderDto.of(saved);
        events.publishEvent(new RoomEvent(roomId, "folder.added", dto));
        return dto;
    }

    @Transactional
    public FolderDto rename(UUID roomId, UUID folderId, UUID userId, boolean staff, String rawName) {
        RoomFolder f = find(roomId, folderId);
        if (!f.getCreatedBy().equals(userId) && !staff) throw ApiException.forbidden("No puedes renombrar esta carpeta");
        String name = cleanName(rawName);
        requireUnique(folders.findByRoomIdAndKindOrderByNameAsc(roomId, f.getKind()), f.getParentId(), name, f.getId());
        f.setName(name);
        FolderDto dto = FolderDto.of(folders.save(f));
        events.publishEvent(new RoomEvent(roomId, "folder.updated", dto));
        return dto;
    }

    /** Borra la carpeta con todo su contenido (subcarpetas, archivos del almacén y notas). */
    @Transactional
    public void delete(UUID roomId, UUID folderId, UUID userId, boolean staff) {
        RoomFolder f = find(roomId, folderId);
        if (!f.getCreatedBy().equals(userId) && !staff) {
            throw ApiException.forbidden("No puedes borrar esta carpeta");
        }
        List<RoomFolder> all = folders.findByRoomIdAndKindOrderByNameAsc(roomId, f.getKind());
        Set<UUID> ids = new HashSet<>(List.of(folderId));
        boolean grew = true;
        while (grew) {
            grew = false;
            for (RoomFolder c : all) {
                if (c.getParentId() != null && ids.contains(c.getParentId()) && ids.add(c.getId())) grew = true;
            }
        }
        List<UUID> deletedFiles = files.deleteInFolders(roomId, ids);
        notes.deleteByRoomIdAndFolderIdIn(roomId, ids);
        folders.deleteById(folderId); // las subcarpetas caen en cascada
        events.publishEvent(new RoomEvent(roomId, "folder.deleted",
                Map.of("id", folderId, "kind", f.getKind(), "ids", new ArrayList<>(ids), "files", deletedFiles)));
    }

    /** Comprueba que la carpeta existe en la sala y es del tipo esperado. */
    @Transactional(readOnly = true)
    public void requireIn(UUID roomId, RoomFolder.Kind kind, UUID folderId) {
        if (folderId == null) return;
        RoomFolder f = find(roomId, folderId);
        if (f.getKind() != kind) throw ApiException.badRequest("Carpeta no válida");
    }

    @Transactional(readOnly = true)
    public boolean exists(UUID roomId, UUID folderId) {
        return folderId != null && folders.existsByIdAndRoomId(folderId, roomId);
    }

    private RoomFolder find(UUID roomId, UUID folderId) {
        return folders.findById(folderId).filter(f -> f.getRoomId().equals(roomId))
                .orElseThrow(() -> ApiException.notFound("Carpeta no encontrada"));
    }

    private static int depth(List<RoomFolder> all, RoomFolder f) {
        Map<UUID, UUID> parents = new java.util.HashMap<>();
        for (RoomFolder x : all) parents.put(x.getId(), x.getParentId()); // HashMap admite padres nulos
        int d = 1;
        for (UUID p = f.getParentId(); p != null && d <= MAX_DEPTH + 1; p = parents.get(p)) d++;
        return d;
    }

    private static void requireUnique(List<RoomFolder> all, UUID parentId, String name, UUID self) {
        boolean dup = all.stream().anyMatch(f -> !f.getId().equals(self)
                && java.util.Objects.equals(f.getParentId(), parentId) && f.getName().equalsIgnoreCase(name));
        if (dup) throw ApiException.conflict("Ya existe una carpeta con ese nombre aquí");
    }

    static String cleanName(String raw) {
        String n = raw == null ? "" : raw.replaceAll("[\\p{Cntrl}/\\\\]", "").trim();
        if (n.isEmpty()) throw ApiException.badRequest("El nombre no puede estar vacío");
        if (n.length() > 60) throw ApiException.badRequest("Máximo 60 caracteres");
        return n;
    }
}
