package com.nora.chat;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface ChatMemberRepository extends JpaRepository<ChatMember, ChatMember.Key> {

    List<ChatMember> findByConversationId(UUID conversationId);

    List<ChatMember> findByUserIdAndConversationIdIn(UUID userId, Collection<UUID> conversationIds);

    long countByConversationId(UUID conversationId);

    /** Quien sale de la sala deja también los grupos y mensajes directos de esa sala. */
    @Modifying
    @Query("delete from ChatMember m where m.userId = :userId and m.conversationId in (select c.id from ChatConversation c where c.roomId = :roomId)")
    int deleteUserInRoom(UUID userId, UUID roomId);

    List<ChatMember> findByConversationIdIn(Collection<UUID> conversationIds);

    /** Todas las personas de la sala pasan a tener su fila de lectura en la conversación general, en una sola sentencia (sirve para salas grandes). */
    @Modifying
    @Query(value = "insert into chat_members (conversation_id, user_id, role, muted, pinned, last_read_at, joined_at) "
            + "select :conv, rm.user_id, 'MEMBER', false, false, :readUntil, now() from room_members rm where rm.room_id = :room on conflict do nothing", nativeQuery = true)
    int ensureRoomMembers(UUID conv, UUID room, java.time.Instant readUntil);
}
