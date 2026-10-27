package com.nora.upload;

import com.nora.common.ApiException;
import com.nora.file.FileService;
import com.nora.file.ObjectStorage;
import com.nora.file.RoomFile;
import com.nora.folder.FolderService;
import com.nora.folder.RoomFolder;
import com.nora.upload.UploadDtos.PartInfo;
import com.nora.upload.UploadDtos.UploadDto;
import com.nora.user.Role;
import com.nora.user.User;
import com.nora.user.UserRepository;
import com.nora.ws.RoomEvent;
import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Subidas por trozos de 8 MiB sobre multipart de S3. El estado (qué trozos llegaron) vive en la base de datos, así que
 * tras un corte de red —o de navegador— el cliente pregunta qué falta y continúa donde se quedó.
 */
@Service
public class UploadService {

    public static final int PART_SIZE = 8 * 1024 * 1024;
    private static final int MAX_PARTS = 10_000;
    private static final int MAX_ACTIVE_PER_USER = 8;
    private static final Duration STALE_AFTER = Duration.ofHours(24);
    private static final Logger log = LoggerFactory.getLogger(UploadService.class);

    private final UploadSessionRepository sessions;
    private final UploadPartRepository parts;
    private final ObjectStorage storage;
    private final FileService files;
    private final UserRepository users;
    private final ApplicationEventPublisher events;
    private final FolderService folders;

    public UploadService(UploadSessionRepository sessions, UploadPartRepository parts, ObjectStorage storage,
                         FileService files, UserRepository users, ApplicationEventPublisher events,
                         FolderService folders) {
        this.folders = folders;
        this.sessions = sessions;
        this.parts = parts;
        this.storage = storage;
        this.files = files;
        this.users = users;
        this.events = events;
    }

    /** Crea la subida, o devuelve la que ya existe para ese mismo archivo (reanudación). */
    @Transactional
    public UploadDto create(UUID roomId, UUID userId, UploadDtos.CreateRequest req) {
        var existing = sessions.findFirstByRoomIdAndUserIdAndFingerprint(roomId, userId, req.fingerprint());
        if (existing.isPresent() && existing.get().getSizeBytes() == req.size()) {
            existing.get().touch();
            return dto(existing.get());
        }
        folders.requireIn(roomId, RoomFolder.Kind.FILE, req.folderId());
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("Usuario no encontrado"));
        if (req.size() > (long) MAX_PARTS * PART_SIZE) throw ApiException.badRequest("Archivo demasiado grande");
        if (user.getMaxFileSizeBytes() != null && req.size() > user.getMaxFileSizeBytes()) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "El archivo supera tu límite por archivo");
        }
        if (user.getStorageQuotaBytes() != null
                && files.usedBytes(userId) + sessions.sumSizeByUser(userId) + req.size() > user.getStorageQuotaBytes()) {
            throw new ApiException(HttpStatus.INSUFFICIENT_STORAGE, "Has agotado tu espacio de almacenamiento");
        }
        if (sessions.countByUserId(userId) >= MAX_ACTIVE_PER_USER) {
            throw ApiException.conflict("Tienes demasiadas subidas en curso; cancela alguna");
        }
        UUID fileId = UUID.randomUUID();
        String key = "rooms/" + roomId + "/" + fileId;
        String s3Id;
        try {
            s3Id = storage.startMultipart(key);
        } catch (Exception e) {
            throw new IllegalStateException("No se pudo iniciar la subida", e);
        }
        String contentType = req.contentType() == null || req.contentType().isBlank() ? "application/octet-stream" : req.contentType();
        UploadSession fresh = new UploadSession(roomId, userId, fileId, FileService.sanitize(req.name()),
                req.fingerprint(), contentType, req.size(), PART_SIZE, s3Id, key);
        fresh.setFolderId(req.folderId());
        UploadSession s = sessions.save(fresh);
        return dto(s);
    }

    @Transactional(readOnly = true)
    public List<UploadDto> mine(UUID roomId, UUID userId) {
        return sessions.findByRoomIdAndUserIdOrderByCreatedAtDesc(roomId, userId).stream().map(this::dto).toList();
    }

    /** Valida un aviso de progreso del cliente: la subida debe ser suya y de la sala en la que está. */
    @Transactional(readOnly = true)
    public java.util.Optional<Map<String, Object>> progressEvent(UUID userId, UUID roomId, UUID uploadId, long loaded) {
        return sessions.findById(uploadId)
                .filter(s -> s.getUserId().equals(userId) && s.getRoomId().equals(roomId))
                .map(s -> Map.of("uploadId", uploadId, "userId", userId, "name", s.getName(),
                        "received", Math.max(0, Math.min(loaded, s.getSizeBytes())), "total", s.getSizeBytes()));
    }

    @Transactional(readOnly = true)
    public UploadDto status(UUID roomId, UUID userId, UUID uploadId) {
        return dto(owned(roomId, userId, uploadId));
    }

    /** Recibe un trozo. Es idempotente: reenviar el mismo número lo sustituye. */
    public void putPart(UUID roomId, UUID userId, UUID uploadId, int number, InputStream body) throws IOException {
        UploadSession s = owned(roomId, userId, uploadId);
        if (number < 1 || number > s.partCount()) throw ApiException.badRequest("Número de trozo no válido");
        int expected = s.expectedPartSize(number);
        byte[] data = body.readNBytes(expected + 1);
        if (data.length != expected) {
            throw ApiException.badRequest("Tamaño de trozo incorrecto: se esperaban " + expected + " bytes");
        }
        String etag;
        try {
            etag = storage.uploadPart(s.getObjectKey(), s.getS3UploadId(), number, data);
        } catch (Exception e) {
            throw new IllegalStateException("No se pudo guardar el trozo", e);
        }
        parts.save(new UploadPart(uploadId, number, etag, expected));
        s.touch();
        sessions.save(s);
        events.publishEvent(new RoomEvent(roomId, "upload.progress", Map.of(
                "uploadId", uploadId, "userId", userId, "name", s.getName(),
                "received", parts.sumReceived(uploadId), "total", s.getSizeBytes())));
    }

    @Transactional
    public FileService.FileDto complete(UUID roomId, UUID userId, UUID uploadId) {
        UploadSession s = owned(roomId, userId, uploadId);
        List<UploadPart> received = parts.findByUploadIdOrderByPartNumber(uploadId);
        if (received.size() != s.partCount()) {
            throw ApiException.conflict("Faltan trozos: " + received.size() + " de " + s.partCount());
        }
        for (int i = 0; i < received.size(); i++) {
            if (received.get(i).getPartNumber() != i + 1) throw ApiException.conflict("Faltan trozos");
        }
        try {
            storage.completeMultipart(s.getObjectKey(), s.getS3UploadId(),
                    received.stream().map(p -> new ObjectStorage.CompletedPart(p.getPartNumber(), p.getEtag())).toList());
        } catch (Exception e) {
            throw new IllegalStateException("No se pudo completar la subida", e);
        }
        RoomFile entity = new RoomFile(s.getFileId(), roomId, userId, s.getName(), s.getContentType(), s.getSizeBytes());
        if (folders.exists(roomId, s.getFolderId())) entity.setFolderId(s.getFolderId()); // la carpeta pudo borrarse mientras tanto
        var dto = files.register(entity);
        sessions.delete(s);
        events.publishEvent(new RoomEvent(roomId, "upload.done", Map.of("uploadId", uploadId, "userId", userId, "name", s.getName())));
        return dto;
    }

    @Transactional
    public void abort(UUID roomId, UUID userId, Role role, UUID uploadId) {
        UploadSession s = sessions.findById(uploadId).filter(x -> x.getRoomId().equals(roomId))
                .orElseThrow(() -> ApiException.notFound("Subida no encontrada"));
        if (!s.getUserId().equals(userId) && role != Role.ADMIN) throw ApiException.forbidden("No puedes cancelar esta subida");
        storage.abortMultipart(s.getObjectKey(), s.getS3UploadId());
        sessions.delete(s);
        events.publishEvent(new RoomEvent(roomId, "upload.aborted", Map.of("uploadId", uploadId, "userId", s.getUserId(), "name", s.getName())));
    }

    /** Al destruir una sala se descartan los multipart pendientes (las filas se borran en cascada). */
    @Transactional
    public void abortAllForRoom(UUID roomId) {
        for (UploadSession s : sessions.findByRoomId(roomId)) storage.abortMultipart(s.getObjectKey(), s.getS3UploadId());
    }

    @Scheduled(fixedDelay = 3_600_000, initialDelay = 120_000)
    @Transactional
    public void purgeStale() {
        for (UploadSession s : sessions.findByUpdatedAtBefore(Instant.now().minus(STALE_AFTER))) {
            storage.abortMultipart(s.getObjectKey(), s.getS3UploadId());
            sessions.delete(s);
            log.info("Subida abandonada eliminada: {} ({})", s.getName(), s.getId());
        }
    }

    private UploadSession owned(UUID roomId, UUID userId, UUID uploadId) {
        UploadSession s = sessions.findById(uploadId).filter(x -> x.getRoomId().equals(roomId))
                .orElseThrow(() -> ApiException.notFound("Subida no encontrada"));
        if (!s.getUserId().equals(userId)) throw ApiException.forbidden("Esta subida no es tuya");
        return s;
    }

    private UploadDto dto(UploadSession s) {
        List<PartInfo> received = new ArrayList<>();
        long bytes = 0;
        for (UploadPart p : parts.findByUploadIdOrderByPartNumber(s.getId())) {
            received.add(new PartInfo(p.getPartNumber(), p.getSizeBytes()));
            bytes += p.getSizeBytes();
        }
        return new UploadDto(s.getId(), s.getName(), s.getFingerprint(), s.getSizeBytes(), s.getPartSize(), s.partCount(), received, bytes);
    }
}
