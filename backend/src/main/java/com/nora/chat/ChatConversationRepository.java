package com.nora.chat;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface ChatConversationRepository extends JpaRepository<ChatConversation, UUID> {

    Optional<ChatConversation> findByRoomIdAndKind(UUID roomId, String kind);

    Optional<ChatConversation> findByRoomIdAndDmKey(UUID roomId, String dmKey);

    Optional<ChatConversation> findByIdAndRoomId(UUID id, UUID roomId);

    long countByRoomIdAndKind(UUID roomId, String kind);

    /** Las de la sala que me tocan: la general, los grupos de los que formo parte y mis mensajes directos. */
    @Query("select c from ChatConversation c where c.roomId = :roomId and (c.kind = 'ROOM' or c.id in (select m.conversationId from ChatMember m where m.userId = :userId))")
    List<ChatConversation> findVisible(UUID roomId, UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from ChatConversation c where c.id = :id")
    Optional<ChatConversation> lockById(UUID id);

    /** La conversación general de la sala, creada una sola vez aunque dos personas la pidan a la vez. */
    @org.springframework.data.jpa.repository.Modifying
    @Query(value = "insert into chat_conversations (id, room_id, kind, description, post_policy, add_policy, created_at, updated_at, last_message_at) "
            + "values (:id, :roomId, 'ROOM', '', 'ALL', 'ADMINS', now(), now(), now()) on conflict do nothing", nativeQuery = true)
    int insertGeneral(UUID id, UUID roomId);
}
