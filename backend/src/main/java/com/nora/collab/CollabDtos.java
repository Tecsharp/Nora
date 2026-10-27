package com.nora.collab;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class CollabDtos {
    private CollabDtos() {}

    public enum Kind { DOC, SHEET, SLIDES, BOARD }

    public record CreateRequest(Kind kind, @NotBlank(message = "El nombre es obligatorio") @Size(max = 120, message = "Máximo 120 caracteres") String name, UUID folderId) {}

    public record RenameRequest(@NotBlank(message = "El nombre es obligatorio") @Size(max = 120, message = "Máximo 120 caracteres") String name) {}

    public record DocDto(UUID id, String kind, String name, UUID createdBy, String createdByName, Instant createdAt, Instant updatedAt,
                         UUID sourceFileId, String sourceExt, boolean canEdit,
                         long seq, long savedSeq, Instant savedAt, String savedByName, Instant thumbAt) {}

    public record UpdateDto(long seq, String data) {}

    /** Instantánea (base64) + cambios posteriores. Aplicarlos en cualquier orden es seguro (CRDT). */
    public record StateDto(long seq, String snapshot, long snapshotSeq, List<UpdateDto> updates, String seedState) {}

    public record SeedClaim(boolean granted, String content) {}

    public record VersionDto(UUID id, Instant createdAt, String createdByName, String label, long seq) {}
}
