package com.nora.item;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface RoomItemRepository extends JpaRepository<RoomItem, UUID> {

    @Query("select i from RoomItem i where i.roomId = :roomId and i.tool = :tool order by i.sort asc, i.createdAt asc")
    List<RoomItem> findOrdered(UUID roomId, String tool, Pageable page);

    /** Los más recientes primero (el chat se pagina hacia atrás). */
    @Query("select i from RoomItem i where i.roomId = :roomId and i.tool = :tool and i.createdAt < :before order by i.createdAt desc")
    List<RoomItem> findBefore(UUID roomId, String tool, Instant before, Pageable page);

    long countByRoomIdAndTool(UUID roomId, String tool);

    Optional<RoomItem> findByIdAndRoomIdAndTool(UUID id, UUID roomId, String tool);

    /** Con cerrojo: votos, respuestas a eventos y reacciones se escriben de uno en uno para no pisarse. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from RoomItem i where i.id = :id and i.roomId = :roomId and i.tool = :tool")
    Optional<RoomItem> lockById(UUID id, UUID roomId, String tool);
}
