package com.nora.chat;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class ChatDtos {
    private ChatDtos() {}

    public record MemberDto(UUID userId, String role) {}

    public record LastMessage(UUID id, UUID authorId, String authorName, String kind, String text, Instant createdAt) {}

    /** Una conversación vista por una persona concreta: su rol, si la silenció y cuántos mensajes tiene sin leer. */
    public record ConvDto(UUID id, String kind, String name, String description, String color, UUID createdBy, String postPolicy, String addPolicy,
                          Instant createdAt, Instant lastMessageAt, LastMessage last, List<MemberDto> members, String role, boolean muted,
                          boolean pinned, long unread, Instant lastReadAt, UUID otherUserId) {}

    /** Lo que se cita al responder (autor y un trozo del texto), para que se vea aunque el mensaje original no esté cargado. */
    public record ReplyPreview(UUID id, String authorName, String text) {}

    public record MessageDto(UUID id, UUID conv, UUID authorId, String authorName, String kind, String text, UUID replyTo, ReplyPreview reply,
                             Map<String, List<String>> reactions, boolean edited, Instant createdAt, Instant updatedAt) {}

    /** Una ventana de mensajes y si hay más hacia atrás o hacia delante (para ir a un mensaje antiguo sin cargar todo lo de en medio). */
    public record WindowDto(List<MessageDto> items, boolean hasOlder, boolean hasNewer) {}

    public record SearchDto(List<MessageDto> items, boolean more) {}

    public record CreateGroup(String name, String description, String color, List<UUID> members) {}

    public record UpdateGroup(String name, String description, String color, String postPolicy, String addPolicy) {}

    public record AddMembers(List<UUID> userIds) {}

    public record SetRole(String role) {}

    public record Prefs(Boolean muted, Boolean pinned) {}

    public record OpenDm(UUID userId) {}

    public record SendMessage(String text, UUID replyTo) {}

    public record Edit(String text) {}

    public record React(String emoji) {}
}
