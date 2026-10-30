package com.nora.ws;

import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Traduce los eventos de dominio en mensajes WebSocket. Con @TransactionalEventListener(AFTER_COMMIT) un cliente
 * nunca recibe un aviso de algo que luego se revierte; fuera de transacción se envía de inmediato.
 *
 * Tipos de evento de sala: member.joined, file.added, file.deleted, note.added, note.deleted,
 * upload.progress, upload.done, upload.aborted, room.expiring, room.closed.
 * Tipos de evento de usuario: account.updated, account.disabled.
 */
@Component
public class RealtimeBroadcaster {

    private final NoraWebSocketHandler handler;

    public RealtimeBroadcaster(NoraWebSocketHandler handler) {
        this.handler = handler;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onRoom(RoomEvent e) {
        handler.sendToRoom(e.roomId(), e.type(), e.data());
        if ("room.closed".equals(e.type()) || "room.inactive".equals(e.type())) handler.detachRoom(e.roomId());
        if ("member.removed".equals(e.type()) && e.data() instanceof java.util.Map<?, ?> m && m.get("userId") instanceof java.util.UUID id) handler.evict(e.roomId(), id);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onUser(UserEvent e) {
        handler.sendToUser(e.userId(), e.type(), e.data());
        if ("account.disabled".equals(e.type()) || "account.revoked".equals(e.type()) || "account.deleted".equals(e.type())) handler.closeUser(e.userId());
    }
}
