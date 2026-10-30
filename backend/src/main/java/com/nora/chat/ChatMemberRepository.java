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

    /**
     * Quién tiene mensajes sin leer desde hace más de `mins` minutos y aún no se le ha avisado: [conversación, persona, sala, tipo, nombre del grupo,
     * cuántos, id del último, autor del último, texto del último, fecha del último].
     */
    @Query(value = "select cm.conversation_id, cm.user_id, c.room_id, c.kind, c.name, count(*), "
            + "(array_agg(m.id order by m.created_at desc))[1], (array_agg(m.author_name order by m.created_at desc))[1], "
            + "(array_agg(m.text order by m.created_at desc))[1], max(m.created_at) "
            + "from chat_members cm join chat_conversations c on c.id = cm.conversation_id join chat_messages m on m.conversation_id = cm.conversation_id "
            + "where cm.muted = false and m.kind = 'TEXT' and (m.author_id is null or m.author_id <> cm.user_id) "
            + "and m.created_at > greatest(cm.last_read_at, coalesce(cm.notified_until, '-infinity'::timestamptz)) "
            + "and m.created_at <= now() - make_interval(mins => :mins) "
            + "group by cm.conversation_id, cm.user_id, c.room_id, c.kind, c.name", nativeQuery = true)
    List<Object[]> unansweredFor(int mins);

    @Modifying
    @Query(value = "update chat_members set notified_until = :until where conversation_id = :conv and user_id = :user", nativeQuery = true)
    int markNotified(UUID conv, UUID user, java.time.Instant until);
}
