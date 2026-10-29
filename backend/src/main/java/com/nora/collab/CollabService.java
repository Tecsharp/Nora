package com.nora.collab;

import com.nora.collab.CollabDtos.*;
import com.nora.collab.CollabRepository.DocRow;
import com.nora.common.ApiException;
import com.nora.file.FileService;
import com.nora.folder.FolderService;
import com.nora.folder.RoomFolder;
import com.nora.file.FileService.FileDto;
import com.nora.room.Room;
import com.nora.room.RoomMemberRepository;
import com.nora.room.RoomMember;
import com.nora.room.RoomRepository;
import com.nora.room.RoomService;
import com.nora.user.Role;
import com.nora.user.UserRepository;
import com.nora.ws.RoomEvent;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Documentos colaborativos de una sala. El servidor no interpreta el contenido (es un CRDT Yjs): guarda y reparte
 * bytes. Solo entiende el formato "nativo" JSON/HTML al importar y exportar archivos de oficina.
 */
@Service
public class CollabService {

    public static final int MAX_UPDATE_BYTES = 1_500_000;
    public static final int MAX_SNAPSHOT_BYTES = 24 * 1024 * 1024;
    private static final int MAX_NATIVE_BYTES = 40 * 1024 * 1024;

    private static final Map<String, Kind> KIND_OF_EXT = Map.ofEntries(
            Map.entry("docx", Kind.DOC), Map.entry("odt", Kind.DOC), Map.entry("doc", Kind.DOC), Map.entry("rtf", Kind.DOC),
            Map.entry("xlsx", Kind.SHEET), Map.entry("ods", Kind.SHEET), Map.entry("xls", Kind.SHEET), Map.entry("csv", Kind.SHEET), Map.entry("tsv", Kind.SHEET),
            Map.entry("pptx", Kind.SLIDES), Map.entry("odp", Kind.SLIDES), Map.entry("ppt", Kind.SLIDES), Map.entry("excalidraw", Kind.BOARD));
    private static final Map<Kind, List<String>> EXPORT_FORMATS = Map.of(
            Kind.DOC, List.of("docx", "odt", "pdf"), Kind.SHEET, List.of("xlsx", "ods", "csv", "pdf"), Kind.SLIDES, List.of("pptx", "odp", "pdf"), Kind.BOARD, List.of("excalidraw"));
    private static final Map<String, String> MIME = Map.ofEntries(
            Map.entry("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), Map.entry("odt", "application/vnd.oasis.opendocument.text"),
            Map.entry("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), Map.entry("ods", "application/vnd.oasis.opendocument.spreadsheet"),
            Map.entry("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"), Map.entry("odp", "application/vnd.oasis.opendocument.presentation"),
            Map.entry("csv", "text/csv"), Map.entry("pdf", "application/pdf"), Map.entry("excalidraw", "application/json"));

    private static final String BLANK_BOARD = "{\"type\":\"excalidraw\",\"version\":2,\"source\":\"nora\",\"elements\":[],\"appState\":{},\"files\":{}}";
    private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();
    private static final java.util.Set<String> BOARD_STATE_KEYS = java.util.Set.of("viewBackgroundColor", "gridSize");
    private static final int MAX_BOARD_ELEMENTS = 50_000;
    private static final int MAX_THUMB_BYTES = 200_000;
    private static final String BLANK_DOC = "{\"kind\":\"DOC\",\"html\":\"\"}";
    private static final String BLANK_SHEET = "{\"kind\":\"SHEET\",\"sheets\":[{\"id\":\"s1\",\"name\":\"Hoja 1\",\"rows\":100,\"cols\":26,\"cells\":{},\"colWidths\":{},\"merges\":[]}]}";
    private static final String BLANK_SLIDES = "{\"kind\":\"SLIDES\",\"width\":13.333,\"height\":7.5,\"slides\":[{\"id\":\"p1\",\"bg\":\"#ffffff\",\"elements\":["
            + "{\"id\":\"t1\",\"type\":\"text\",\"x\":8,\"y\":30,\"w\":84,\"h\":20,\"text\":\"Título de la presentación\",\"fontSize\":44,\"bold\":true,\"italic\":false,\"color\":\"#111827\",\"align\":\"center\"},"
            + "{\"id\":\"t2\",\"type\":\"text\",\"x\":8,\"y\":54,\"w\":84,\"h\":12,\"text\":\"Subtítulo\",\"fontSize\":24,\"bold\":false,\"italic\":false,\"color\":\"#6b7280\",\"align\":\"center\"}]}]}";

    /** Resultado de comprobar el acceso a un documento. */
    public record Access(DocRow doc, boolean canEdit) {}

    public record ExportResult(byte[] data, String filename, String mime, FileDto saved) {}

    private final CollabRepository repo;
    private final RoomService rooms;
    private final RoomRepository roomRepo;
    private final RoomMemberRepository members;
    private final UserRepository users;
    private final FileService files;
    private final FolderService folders;
    private final ConverterClient converter;
    private final ApplicationEventPublisher events;

    public CollabService(CollabRepository repo, RoomService rooms, RoomRepository roomRepo, RoomMemberRepository members, UserRepository users,
                         FileService files, FolderService folders, ConverterClient converter, ApplicationEventPublisher events) {
        this.repo = repo;
        this.rooms = rooms;
        this.roomRepo = roomRepo;
        this.members = members;
        this.users = users;
        this.files = files;
        this.folders = folders;
        this.converter = converter;
        this.events = events;
    }

    // ---- acceso ----

    private DocRow docIn(Room room, UUID docId) {
        DocRow d = repo.find(docId).orElseThrow(() -> ApiException.notFound("Documento no encontrado"));
        if (!d.roomId().equals(room.getId())) throw ApiException.notFound("Documento no encontrado");
        return d;
    }

    /** Comprobación para el canal en tiempo real: sala abierta, participante y permiso de edición. */
    @Transactional(readOnly = true)
    public Access access(UUID userId, UUID docId) {
        DocRow d = repo.find(docId).orElseThrow(() -> ApiException.notFound("Documento no encontrado"));
        Room room = roomRepo.findById(d.roomId()).orElseThrow(() -> ApiException.notFound("Sala no encontrada"));
        if (room.isExpired()) throw new ApiException(HttpStatus.GONE, "La sala ha expirado");
        if (!members.existsById(new RoomMember.Key(room.getId(), userId))) throw ApiException.forbidden("No participas en esta sala");
        Role sys = users.findById(userId).map(u -> u.getRole()).orElse(Role.USER);
        return new Access(d, rooms.canWrite(room, userId, sys));
    }

    // ---- CRUD ----

    @Transactional(readOnly = true)
    public List<DocDto> list(Room room, UUID userId, Role sys) {
        boolean canEdit = rooms.canWrite(room, userId, sys);
        return repo.list(room.getId()).stream().map(r -> dto(r.doc(), r.createdByName(), canEdit)).toList();
    }

    @Transactional(readOnly = true)
    public DocDto get(Room room, UUID docId, UUID userId, Role sys) {
        DocRow d = docIn(room, docId);
        return dto(d, repo.creatorName(d.createdBy()), rooms.canWrite(room, userId, sys));
    }

    private static final Map<Kind, String> DEFAULT_EXT = Map.of(Kind.DOC, "docx", Kind.SHEET, "xlsx", Kind.SLIDES, "pptx", Kind.BOARD, "excalidraw");

    /** Crea un documento nuevo: nace ya como archivo de la sala (en la carpeta indicada), así todos lo ven en Archivos y lo abren con un clic. */
    public DocDto create(Room room, UUID userId, Kind kind, String name, UUID folderId) {
        if (kind == null) throw ApiException.badRequest("Indica el tipo de documento");
        String seed = switch (kind) { case DOC -> BLANK_DOC; case SHEET -> BLANK_SHEET; case SLIDES -> BLANK_SLIDES; case BOARD -> BLANK_BOARD; };
        String title = clean(name);
        String ext = DEFAULT_EXT.get(kind);
        byte[] blank = kind == Kind.BOARD ? utf8(seed) : converter.export(kind.name(), ext, utf8(seed), 0); // lento: fuera de transacción
        folders.requireIn(room.getId(), RoomFolder.Kind.FILE, folderId); // Archivos y Pizarra comparten carpetas
        FileDto file = files.saveGenerated(room.getId(), userId, title + "." + ext, MIME.get(ext), blank, folderId);
        UUID id = UUID.randomUUID();
        repo.insert(id, room.getId(), kind.name(), title, userId, file.id(), ext, seed, null);
        repo.markSaved(id, 0, userId);
        return created(room, id);
    }

    /** Abre un archivo de oficina de la sala para editarlo: lo convierte una sola vez y lo deja listo para sembrar. */
    public DocDto fromFile(Room room, UUID userId, Role sys, UUID fileId, UUID boardFolderId) {
        FileDto file = files.info(room.getId(), fileId);
        String ext = file.name().contains(".") ? file.name().substring(file.name().lastIndexOf('.') + 1).toLowerCase() : "";
        Kind kind = KIND_OF_EXT.get(ext);
        if (kind == null) throw ApiException.badRequest("Este tipo de archivo no se puede editar");
        var existing = repo.findBySource(room.getId(), fileId);
        boolean canWrite = rooms.canWrite(room, userId, sys);
        String base = file.name().contains(".") ? file.name().substring(0, file.name().lastIndexOf('.')) : file.name();
        if (existing.isPresent()) {
            DocRow d = existing.get();
            if (!d.name().equals(clean(base))) repo.rename(d.id(), clean(base)); // el nombre del archivo manda
            return dto(repo.find(d.id()).orElseThrow(), repo.creatorName(d.createdBy()), canWrite);
        }
        if (!canWrite) throw ApiException.forbidden("Aún no se ha abierto para editar: pide a alguien con permiso de edición que lo abra primero");
        if (file.sizeBytes() > MAX_NATIVE_BYTES) throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "El archivo es demasiado grande para editarlo");
        byte[] content = files.readAll(room.getId(), fileId);
        String seed = kind == Kind.BOARD ? normalizeBoard(content) : converter.importFile(content, ext); // lento: fuera de transacción
        UUID id = UUID.randomUUID();
        try {
            repo.insert(id, room.getId(), kind.name(), clean(base), userId, fileId, ext, seed, null);
        } catch (org.springframework.dao.DuplicateKeyException e) {
            return repo.findBySource(room.getId(), fileId).map(d -> dto(d, repo.creatorName(d.createdBy()), true)).orElseThrow();
        }
        return created(room, id);
    }

    private DocDto created(Room room, UUID id) {
        DocRow d = repo.find(id).orElseThrow();
        DocDto dto = dto(d, repo.creatorName(d.createdBy()), true);
        events.publishEvent(new RoomEvent(room.getId(), "doc.created", dto));
        return dto;
    }

    @Transactional
    public DocDto rename(Room room, UUID docId, UUID userId, Role sys, String name) {
        DocRow d = docIn(room, docId);
        if (!d.createdBy().equals(userId) && !rooms.canModerate(room, userId, sys)) throw ApiException.forbidden("No puedes renombrar este documento");
        String title = clean(name);
        repo.rename(docId, title);
        if (d.sourceFileId() != null && d.sourceExt() != null) {
            try {
                files.rename(room.getId(), d.sourceFileId(), title + "." + d.sourceExt()); // el documento y su archivo se llaman igual
            } catch (ApiException ignored) { /* el archivo ya no existe */ }
        }
        DocDto dto = dto(repo.find(docId).orElseThrow(), repo.creatorName(d.createdBy()), true);
        events.publishEvent(new RoomEvent(room.getId(), "doc.renamed", dto));
        return dto;
    }

    /** Mueve una pizarra a otra carpeta (null = raíz): en realidad mueve su archivo, así que se ve igual en Archivos y en Pizarra. */
    @Transactional
    public DocDto move(Room room, UUID docId, UUID userId, Role sys, UUID folderId) {
        DocRow d = docIn(room, docId);
        if (!"BOARD".equals(d.kind())) throw ApiException.badRequest("Solo las pizarras se organizan en carpetas aquí");
        folders.requireIn(room.getId(), RoomFolder.Kind.FILE, folderId);
        if (d.sourceFileId() == null) throw ApiException.badRequest("Esta pizarra no tiene archivo");
        files.update(room.getId(), d.sourceFileId(), userId, true, true, folderId, null);
        DocDto dto = dto(repo.find(docId).orElseThrow(), repo.creatorName(d.createdBy()), true);
        events.publishEvent(new RoomEvent(room.getId(), "doc.moved", dto));
        return dto;
    }

    @Transactional
    public void delete(Room room, UUID docId, UUID userId, Role sys) {
        DocRow d = docIn(room, docId);
        if (!d.createdBy().equals(userId) && !rooms.canModerate(room, userId, sys)) throw ApiException.forbidden("No puedes borrar este documento");
        repo.delete(docId);
        events.publishEvent(new RoomEvent(room.getId(), "doc.deleted", Map.of("id", docId)));
    }

    /** Si se borra el archivo (o su carpeta), el documento colaborativo que lo editaba deja de tener sentido. */
    @org.springframework.transaction.event.TransactionalEventListener(phase = org.springframework.transaction.event.TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    void onRoomEvent(RoomEvent e) {
        java.util.Collection<UUID> fileIds = List.of();
        if ("file.deleted".equals(e.type()) && e.data() instanceof Map<?, ?> m && m.get("id") instanceof UUID id) fileIds = List.of(id);
        else if ("folder.deleted".equals(e.type()) && e.data() instanceof Map<?, ?> m && m.get("files") instanceof List<?> l) fileIds = l.stream().filter(UUID.class::isInstance).map(UUID.class::cast).toList();
        for (UUID docId : repo.idsBySource(e.roomId(), fileIds)) {
            repo.delete(docId);
            events.publishEvent(new RoomEvent(e.roomId(), "doc.deleted", Map.of("id", docId)));
        }
    }

    // ---- estado y siembra ----

    @Transactional(readOnly = true)
    public StateDto state(Room room, UUID docId) {
        docIn(room, docId);
        var s = repo.state(docId).orElseThrow(() -> ApiException.notFound("Documento no encontrado"));
        Base64.Encoder b64 = Base64.getEncoder();
        return new StateDto(s.seq(), s.snapshot() == null ? null : b64.encodeToString(s.snapshot()), s.snapshotSeq(),
                s.updates().stream().map(u -> new UpdateDto(u.seq(), b64.encodeToString(u.data()))).toList(), s.seedState());
    }

    /** Un solo cliente recibe el contenido inicial para escribirlo en el documento compartido. */
    @Transactional
    public SeedClaim claimSeed(Room room, UUID docId, UUID userId) {
        docIn(room, docId);
        return repo.claimSeed(docId, userId).map(c -> new SeedClaim(true, c)).orElse(new SeedClaim(false, null));
    }

    @Transactional
    public void finishSeed(Room room, UUID docId, UUID userId) {
        docIn(room, docId);
        if (!repo.finishSeed(docId, userId)) throw ApiException.conflict("Ya no tienes la siembra de este documento");
        events.publishEvent(new RoomEvent(room.getId(), "doc.seeded", Map.of("id", docId)));
    }

    // ---- cambios (canal en tiempo real) ----

    @Transactional
    public long appendUpdate(UUID docId, UUID userId, byte[] data) {
        if (data.length > MAX_UPDATE_BYTES) throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "El cambio es demasiado grande");
        return repo.appendUpdate(docId, userId, data);
    }

    /** Compacta los cambios hasta upToSeq en una instantánea enviada por un cliente que los tiene todos aplicados. */
    @Transactional
    public boolean saveSnapshot(Room room, UUID docId, long upToSeq, byte[] snapshot) {
        docIn(room, docId);
        if (snapshot.length == 0 || snapshot.length > MAX_SNAPSHOT_BYTES) throw ApiException.badRequest("Instantánea no válida");
        return repo.saveSnapshot(docId, upToSeq, snapshot);
    }

    // ---- versiones ----

    @Transactional
    public VersionDto addVersion(Room room, UUID docId, UUID userId, String label, long seq, byte[] snapshot) {
        docIn(room, docId);
        if (snapshot.length == 0 || snapshot.length > MAX_SNAPSHOT_BYTES) throw ApiException.badRequest("Instantánea no válida");
        String l = label == null || label.isBlank() ? null : label.trim().substring(0, Math.min(80, label.trim().length()));
        UUID id = repo.addVersion(docId, userId, l, seq, snapshot);
        return new VersionDto(id, java.time.Instant.now(), users.findById(userId).map(u -> u.getDisplayName()).orElse("—"), l, seq);
    }

    @Transactional(readOnly = true)
    public List<VersionDto> versions(Room room, UUID docId) {
        docIn(room, docId);
        return repo.versions(docId).stream().map(v -> new VersionDto(v.id(), v.createdAt(), v.createdByName(), v.label(), v.seq())).toList();
    }

    @Transactional(readOnly = true)
    public byte[] versionSnapshot(Room room, UUID docId, UUID versionId) {
        docIn(room, docId);
        return repo.versionSnapshot(docId, versionId).orElseThrow(() -> ApiException.notFound("Versión no encontrada"));
    }

    // ---- exportación ----

    /**
     * Convierte el contenido enviado por el editor (formato nativo) al formato pedido.
     * save: none = solo devolverlo; overwrite = sustituir el archivo original; new = guardarlo como archivo nuevo.
     */
    public ExportResult export(Room room, UUID docId, UUID userId, Role sys, String format, String save, int active, long seq, byte[] nativeJson) {
        DocRow d = docIn(room, docId);
        Kind kind = Kind.valueOf(d.kind());
        boolean toFile = "file".equals(save);
        if (toFile) format = d.sourceExt() != null && EXPORT_FORMATS.get(kind).contains(d.sourceExt()) ? d.sourceExt() : DEFAULT_EXT.get(kind);
        if (!EXPORT_FORMATS.get(kind).contains(format)) throw ApiException.badRequest("Formato no admitido para este tipo de documento");
        if (nativeJson.length == 0 || nativeJson.length > MAX_NATIVE_BYTES) throw ApiException.badRequest("Contenido no válido");
        boolean writes = !"none".equals(save);
        if (writes && !rooms.canWrite(room, userId, sys)) throw ApiException.forbidden("Tu rol en esta sala es de solo lectura");
        byte[] out = kind == Kind.BOARD ? utf8(normalizeBoard(nativeJson)) : converter.export(kind.name(), format, nativeJson, active);
        String filename = d.name().replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_") + "." + format;
        String mime = MIME.getOrDefault(format, "application/octet-stream");
        if (!writes) return new ExportResult(out, filename, mime, null);
        FileDto saved;
        if (toFile) {
            boolean same = d.sourceFileId() != null && format.equals(d.sourceExt()) && fileExists(room, d.sourceFileId());
            if (same) {
                saved = files.replaceContent(room.getId(), d.sourceFileId(), out);
            } else { // formato antiguo (.doc, .xls, .ppt, .tsv…) o archivo desaparecido: se guarda como archivo nuevo y el documento pasa a usarlo
                UUID folder = d.sourceFileId() == null ? null : sourceFolder(room, d.sourceFileId());
                saved = files.saveGenerated(room.getId(), userId, filename, mime, out, folder);
                repo.relink(docId, saved.id(), format);
            }
            repo.markSaved(docId, seq, userId);
            events.publishEvent(new RoomEvent(room.getId(), "doc.saved", dto(repo.find(docId).orElseThrow(), repo.creatorName(d.createdBy()), true)));
        } else if ("new".equals(save)) {
            UUID folder = d.sourceFileId() == null ? null : sourceFolder(room, d.sourceFileId());
            saved = files.saveGenerated(room.getId(), userId, filename, mime, out, folder);
        } else {
            throw ApiException.badRequest("Modo de guardado no válido");
        }
        return new ExportResult(null, filename, mime, saved);
    }

    private boolean fileExists(Room room, UUID fileId) {
        try {
            files.info(room.getId(), fileId);
            return true;
        } catch (ApiException e) {
            return false;
        }
    }

    private UUID sourceFolder(Room room, UUID fileId) {
        try {
            return files.info(room.getId(), fileId).folderId();
        } catch (ApiException e) {
            return null; // el archivo original ya no existe
        }
    }

    public static boolean editable(String ext) {
        return KIND_OF_EXT.containsKey(ext == null ? "" : ext.toLowerCase());
    }

    /**
     * Pizarra (formato .excalidraw): se valida que sea un JSON con una lista de elementos y se conserva solo lo que Nora usa
     * (elementos, imágenes y el fondo/cuadrícula); el resto del estado de la vista de quien la guardó se descarta.
     */
    private static String normalizeBoard(byte[] raw) {
        try {
            var n = JSON.readTree(raw);
            if (n == null || !n.isObject() || !n.path("elements").isArray()) throw ApiException.badRequest("No es un archivo de pizarra válido");
            if (n.path("elements").size() > MAX_BOARD_ELEMENTS) throw ApiException.badRequest("La pizarra tiene demasiados elementos");
            var out = JSON.createObjectNode();
            out.put("type", "excalidraw");
            out.put("version", 2);
            out.put("source", "nora");
            out.set("elements", n.get("elements"));
            var state = JSON.createObjectNode();
            n.path("appState").fields().forEachRemaining(e -> { if (BOARD_STATE_KEYS.contains(e.getKey()) && !e.getValue().isContainerNode()) state.set(e.getKey(), e.getValue()); });
            out.set("appState", state);
            out.set("files", n.path("files").isObject() ? n.get("files") : JSON.createObjectNode());
            return JSON.writeValueAsString(out);
        } catch (java.io.IOException e) {
            throw ApiException.badRequest("No es un archivo de pizarra válido");
        }
    }

    // ---- miniatura de la pizarra ----

    @Transactional
    public void saveThumb(Room room, UUID docId, byte[] data) {
        docIn(room, docId);
        boolean jpeg = data.length > 3 && (data[0] & 0xff) == 0xff && (data[1] & 0xff) == 0xd8;
        boolean png = data.length > 8 && (data[0] & 0xff) == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G';
        boolean webp = data.length > 12 && data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F' && data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P';
        if (data.length == 0 || data.length > MAX_THUMB_BYTES || !(jpeg || png || webp)) throw ApiException.badRequest("Miniatura no válida");
        repo.saveThumb(docId, data);
        DocRow d = repo.find(docId).orElseThrow();
        events.publishEvent(new RoomEvent(room.getId(), "doc.thumb", dto(d, repo.creatorName(d.createdBy()), true)));
    }

    @Transactional(readOnly = true)
    public byte[] thumb(Room room, UUID docId) {
        docIn(room, docId);
        return repo.thumb(docId).orElseThrow(() -> ApiException.notFound("Sin miniatura"));
    }

    // ---- utilidades ----

    private static String clean(String name) {
        String n = name == null ? "" : name.replaceAll("\\p{Cntrl}", "").trim();
        if (n.isEmpty()) throw ApiException.badRequest("El nombre no puede estar vacío");
        return n.substring(0, Math.min(120, n.length()));
    }

    private DocDto dto(DocRow d, String creatorName, boolean canEdit) {
        return new DocDto(d.id(), d.kind(), d.name(), d.createdBy(), creatorName, d.createdAt(), d.updatedAt(), d.sourceFileId(), d.sourceExt(), canEdit,
                d.seq(), d.savedSeq(), d.savedAt(), d.savedBy() == null ? null : repo.creatorName(d.savedBy()), d.thumbAt(), d.folderId());
    }

    static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }
}
