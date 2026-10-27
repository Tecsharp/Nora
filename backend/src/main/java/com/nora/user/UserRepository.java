package com.nora.user;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, UUID> {
    Optional<User> findByEmail(String email);
    boolean existsByEmail(String email);
    long countByRole(Role role);

    @org.springframework.data.jpa.repository.Query("""
            select u from User u
            where (:q = '' or lower(u.email) like concat('%', :q, '%') escape '!' or lower(u.displayName) like concat('%', :q, '%') escape '!')
              and (:role is null or u.role = :role)
            """)
    org.springframework.data.domain.Page<User> search(@org.springframework.data.repository.query.Param("q") String q,
                                                      @org.springframework.data.repository.query.Param("role") Role role,
                                                      org.springframework.data.domain.Pageable page);
}
