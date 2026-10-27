package com.nora.file;

import org.springframework.data.jpa.repository.JpaRepository;

public interface StorageTombstoneRepository extends JpaRepository<StorageTombstone, String> {}
