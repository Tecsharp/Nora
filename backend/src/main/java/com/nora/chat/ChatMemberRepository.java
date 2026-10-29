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
}
