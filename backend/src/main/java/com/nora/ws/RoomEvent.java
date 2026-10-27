package com.nora.ws;

import java.util.UUID;

/** Evento para todos los conectados a una sala. Se emite tras confirmar la transacción que lo origina. */
public record RoomEvent(UUID roomId, String type, Object data) {}
