package com.nora.upload;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

public final class UploadDtos {
    private UploadDtos() {}

    public record CreateRequest(
            @NotBlank @Size(max = 255) String name,
            @Min(1) long size,
            @Size(max = 127) String contentType,
            /** Identifica el archivo en el cliente (nombre+tamaño+fecha) para reanudar la misma subida tras un corte. */
            @NotBlank @Size(max = 160) String fingerprint) {}

    public record PartInfo(int number, int size) {}

    public record UploadDto(UUID id, String name, String fingerprint, long size, int partSize, int partCount,
                            List<PartInfo> received, long receivedBytes) {}
}
