package com.nora.ws;

import java.util.UUID;

/** Evento para todas las sesiones (pestañas/dispositivos) de un usuario. */
public record UserEvent(UUID userId, String type, Object data) {}
