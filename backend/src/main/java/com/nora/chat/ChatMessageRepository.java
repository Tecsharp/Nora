package com.nora.chat;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, UUID> {

    @Query("select m from ChatMessage m where m.conversationId = :conv and m.createdAt < :before order by m.createdAt desc")
    List<ChatMessage> findBefore(UUID conv, Instant before, Pageable page);

    Optional<ChatMessage> findByIdAndConversationId(UUID id, UUID conversationId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from ChatMessage m where m.id = :id and m.conversationId = :conv")
    Optional<ChatMessage> lockById(UUID id, UUID conv);

    @Query("select m from ChatMessage m where m.conversationId = :conv order by m.createdAt desc")
    List<ChatMessage> latest(UUID conv, Pageable page);

    /** Mensajes de otras personas posteriores a la última lectura, por conversación: [conversationId, n]. */
    @Query("select m.conversationId, count(m) from ChatMessage m, ChatMember cm where cm.userId = :userId and cm.conversationId = m.conversationId "
            + "and m.conversationId in :convs and m.createdAt > cm.lastReadAt and m.kind = 'TEXT' and (m.authorId is null or m.authorId <> :userId) group by m.conversationId")
    List<Object[]> unreadCounts(UUID userId, Collection<UUID> convs);
}
