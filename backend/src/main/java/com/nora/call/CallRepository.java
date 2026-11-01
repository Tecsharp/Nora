package com.nora.call;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface CallRepository extends JpaRepository<Call, UUID> {

    Optional<Call> findByCode(String code);

    List<Call> findByRoomIdAndEndedAtIsNullOrderByCreatedAtDesc(UUID roomId);

    long countByRoomIdAndEndedAtIsNull(UUID roomId);

    /** Las programadas desde el calendario no cuentan para el máximo de llamadas abiertas a la vez. */
    long countByRoomIdAndEndedAtIsNullAndScheduledAtIsNull(UUID roomId);

    @Query("select c from Call c where c.roomId = :roomId and c.endedAt is not null order by c.endedAt desc")
    List<Call> recent(UUID roomId, Pageable page);

    List<Call> findByEndedAtIsNull();
}
