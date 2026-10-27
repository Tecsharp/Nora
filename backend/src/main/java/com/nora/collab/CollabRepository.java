package com.nora.collab;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** Acceso SQL a los documentos colaborativos (los campos binarios se tratan mejor con JDBC que con JPA). */
@Repository
public class CollabRepository {

    public record DocRow(UUID id, UUID roomId, String kind, String name, UUID createdBy, Instant createdAt, Instant updatedAt,
                         UUID sourceFileId, String sourceExt, long seq, long snapshotSeq, String seedState, long savedSeq, Instant savedAt, UUID savedBy, Instant thumbAt) {}

    public record ListRow(DocRow doc, String createdByName) {}

    public record StateRow(byte[] snapshot, long snapshotSeq, long seq, String seedState, List<Update> updates) {}

    public record Update(long seq, byte[] data) {}

    public record VersionRow(UUID id, Instant createdAt, String createdByName, String label, long seq) {}

    private static final String COLS = "id, room_id, kind, name, created_by, created_at, updated_at, source_file_id, source_ext, seq, snapshot_seq, seed_state, saved_seq, saved_at, saved_by, thumb_at";
    private static final int KEEP_VERSIONS = 40;

    private final JdbcTemplate jdbc;

    public CollabRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static DocRow doc(java.sql.ResultSet r, int i) throws java.sql.SQLException {
        return new DocRow(r.getObject("id", UUID.class), r.getObject("room_id", UUID.class), r.getString("kind"), r.getString("name"),
                r.getObject("created_by", UUID.class), r.getTimestamp("created_at").toInstant(), r.getTimestamp("updated_at").toInstant(),
                r.getObject("source_file_id", UUID.class), r.getString("source_ext"), r.getLong("seq"), r.getLong("snapshot_seq"), r.getString("seed_state"),
                r.getLong("saved_seq"), r.getTimestamp("saved_at") == null ? null : r.getTimestamp("saved_at").toInstant(), r.getObject("saved_by", UUID.class),
                r.getTimestamp("thumb_at") == null ? null : r.getTimestamp("thumb_at").toInstant());
    }

    public void insert(UUID id, UUID roomId, String kind, String name, UUID createdBy, UUID sourceFileId, String sourceExt, String seed) {
        Timestamp now = Timestamp.from(Instant.now());
        jdbc.update("insert into collab_docs (id, room_id, kind, name, created_by, created_at, updated_at, source_file_id, source_ext, seed_content) "
                + "values (?,?,?,?,?,?,?,?,?,?)", id, roomId, kind, name, createdBy, now, now, sourceFileId, sourceExt, seed);
    }

    public Optional<DocRow> find(UUID id) {
        return jdbc.query("select " + COLS + " from collab_docs where id = ?", CollabRepository::doc, id).stream().findFirst();
    }

    public Optional<DocRow> findBySource(UUID roomId, UUID fileId) {
        return jdbc.query("select " + COLS + " from collab_docs where room_id = ? and source_file_id = ? order by created_at limit 1",
                CollabRepository::doc, roomId, fileId).stream().findFirst();
    }

    public List<ListRow> list(UUID roomId) {
        return jdbc.query("select d.id, d.room_id, d.kind, d.name, d.created_by, d.created_at, d.updated_at, d.source_file_id, d.source_ext, d.seq, "
                        + "d.snapshot_seq, d.seed_state, d.saved_seq, d.saved_at, d.saved_by, d.thumb_at, u.display_name from collab_docs d join users u on u.id = d.created_by "
                        + "where d.room_id = ? order by d.updated_at desc",
                (r, i) -> new ListRow(doc(r, i), r.getString("display_name")), roomId);
    }

    public void rename(UUID id, String name) {
        jdbc.update("update collab_docs set name = ?, updated_at = now() where id = ?", name, id);
    }

    /** Documentos que se guardan en alguno de estos archivos (para borrarlos cuando el archivo se borra). */
    public List<UUID> idsBySource(UUID roomId, java.util.Collection<UUID> fileIds) {
        if (fileIds.isEmpty()) return List.of();
        String in = String.join(",", java.util.Collections.nCopies(fileIds.size(), "?"));
        Object[] args = new Object[fileIds.size() + 1];
        args[0] = roomId;
        int i = 1;
        for (UUID f : fileIds) args[i++] = f;
        return jdbc.query("select id from collab_docs where room_id = ? and source_file_id in (" + in + ")", (r, n) -> r.getObject(1, UUID.class), args);
    }

    public void saveThumb(UUID id, byte[] data) {
        jdbc.update("update collab_docs set thumb = ?, thumb_at = now() where id = ?", data, id);
    }

    public Optional<byte[]> thumb(UUID id) {
        return jdbc.query("select thumb from collab_docs where id = ? and thumb is not null", (r, i) -> r.getBytes(1), id).stream().findFirst();
    }

    /** El archivo de la sala contiene el documento hasta el cambio seq. */
    public void markSaved(UUID id, long seq, UUID userId) {
        jdbc.update("update collab_docs set saved_seq = greatest(saved_seq, ?), saved_at = now(), saved_by = ? where id = ?", seq, userId, id);
    }

    /** El documento pasa a guardarse en otro archivo (p. ej. al convertir un .doc antiguo a .docx). */
    public void relink(UUID id, UUID fileId, String ext) {
        jdbc.update("update collab_docs set source_file_id = ?, source_ext = ? where id = ?", fileId, ext, id);
    }

    public void delete(UUID id) {
        jdbc.update("delete from collab_docs where id = ?", id);
    }

    public String creatorName(UUID userId) {
        return jdbc.query("select display_name from users where id = ?", (r, i) -> r.getString(1), userId).stream().findFirst().orElse("?");
    }

    /** Asigna el siguiente número de secuencia y guarda el cambio. Debe llamarse dentro de una transacción. */
    @Transactional
    public long appendUpdate(UUID docId, UUID author, byte[] data) {
        Long seq = jdbc.queryForObject("update collab_docs set seq = seq + 1, updated_at = now() where id = ? returning seq", Long.class, docId);
        if (seq == null) throw new IllegalStateException("Documento inexistente");
        jdbc.update("insert into collab_updates (doc_id, seq, data, author_id, created_at) values (?,?,?,?,now())", docId, seq, data, author);
        return seq;
    }

    @Transactional(readOnly = true)
    public Optional<StateRow> state(UUID docId) {
        var head = jdbc.query("select snapshot, snapshot_seq, seq, seed_state from collab_docs where id = ?",
                (r, i) -> new Object[] {r.getBytes("snapshot"), r.getLong("snapshot_seq"), r.getLong("seq"), r.getString("seed_state")}, docId)
                .stream().findFirst();
        if (head.isEmpty()) return Optional.empty();
        Object[] h = head.get();
        List<Update> ups = jdbc.query("select seq, data from collab_updates where doc_id = ? and seq > ? order by seq",
                (r, i) -> new Update(r.getLong("seq"), r.getBytes("data")), docId, h[1]);
        return Optional.of(new StateRow((byte[]) h[0], (Long) h[1], (Long) h[2], (String) h[3], ups));
    }

    /** Devuelve el contenido inicial solo a quien lo reclama (el primero, o quien ya lo tenía y recarga, o tras 60 s sin terminar). */
    @Transactional
    public Optional<String> claimSeed(UUID docId, UUID userId) {
        return jdbc.query("update collab_docs set seed_state = 'CLAIMED', seed_claimed_by = ?, seed_claimed_at = now() "
                        + "where id = ? and (seed_state = 'PENDING' or (seed_state = 'CLAIMED' and (seed_claimed_by = ? or seed_claimed_at < now() - interval '60 seconds'))) "
                        + "returning coalesce(seed_content, '')",
                (r, i) -> r.getString(1), userId, docId, userId).stream().findFirst();
    }

    public boolean finishSeed(UUID docId, UUID userId) {
        return jdbc.update("update collab_docs set seed_state = 'DONE', seed_content = null where id = ? and seed_state = 'CLAIMED' and seed_claimed_by = ?", docId, userId) > 0;
    }

    /** Compacta: guarda la instantánea y descarta los cambios que ya incluye. */
    @Transactional
    public boolean saveSnapshot(UUID docId, long upToSeq, byte[] snapshot) {
        int n = jdbc.update("update collab_docs set snapshot = ?, snapshot_seq = ? where id = ? and ? > snapshot_seq and ? <= seq", snapshot, upToSeq, docId, upToSeq, upToSeq);
        if (n == 0) return false;
        jdbc.update("delete from collab_updates where doc_id = ? and seq <= ?", docId, upToSeq);
        return true;
    }

    @Transactional
    public UUID addVersion(UUID docId, UUID userId, String label, long seq, byte[] snapshot) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into collab_versions (id, doc_id, created_at, created_by, label, seq, snapshot) values (?,?,now(),?,?,?,?)", id, docId, userId, label, seq, snapshot);
        jdbc.update("delete from collab_versions where doc_id = ? and id not in (select id from collab_versions where doc_id = ? order by created_at desc limit ?)", docId, docId, KEEP_VERSIONS);
        return id;
    }

    public List<VersionRow> versions(UUID docId) {
        return jdbc.query("select v.id, v.created_at, v.label, v.seq, coalesce(u.display_name, '—') as name from collab_versions v left join users u on u.id = v.created_by "
                        + "where v.doc_id = ? order by v.created_at desc",
                (r, i) -> new VersionRow(r.getObject("id", UUID.class), r.getTimestamp("created_at").toInstant(), r.getString("name"), r.getString("label"), r.getLong("seq")), docId);
    }

    public Optional<byte[]> versionSnapshot(UUID docId, UUID versionId) {
        return jdbc.query("select snapshot from collab_versions where id = ? and doc_id = ?", (r, i) -> r.getBytes(1), versionId, docId).stream().findFirst();
    }
}
