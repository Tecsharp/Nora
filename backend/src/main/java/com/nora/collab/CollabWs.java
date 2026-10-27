package com.nora.collab;

import com.nora.common.ApiException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Reparto en tiempo real de los cambios de un documento colaborativo. Mensajes (JSON sobre el WebSocket de Nora):
 * <pre>
 * cliente → servidor
 *   doc.join       {docId}                          suscribirse
 *   doc.leave      {docId}
 *   doc.update     {docId, update(b64), ref}        cambio Yjs (solo con permiso de edición)
 *   doc.awareness  {docId, update(b64), clientId}   presencia/cursores (efímero, no se guarda)
 * servidor → cliente
 *   doc.joined     {docId, seq, canEdit, peers[]}   confirmación; peers = quién más está dentro
 *   doc.update     {docId, seq, update, userId}     cambio de otra persona
 *   doc.ack        {docId, seq, ref}                el cambio propio quedó guardado
 *   doc.awareness  {docId, update, clientId, userId}
 *   doc.peer.left  {docId, clientIds[]}
 *   doc.error      {docId, message, status}
 * </pre>
 * Los cambios se numeran (seq) y se reparten dentro de un cerrojo por documento, así que todos los clientes los reciben en el mismo orden.
 */
@Component
public class CollabWs {

    /** Quien está conectado (una pestaña). Lo implementa el manejador del WebSocket. */
    public interface Peer {
        String id();
        UUID userId();
        String displayName();
        void send(String type, Object data);
    }

    private static final class Sub {
        final Peer peer;
        boolean canEdit;
        long checkedAt;
        String lastAwareness;
        Long clientId;
        Sub(Peer peer) { this.peer = peer; }
    }

    private static final Logger log = LoggerFactory.getLogger(CollabWs.class);
    private static final long RECHECK_MS = 5_000;

    private final CollabService collab;
    private final Map<UUID, Map<String, Sub>> docs = new ConcurrentHashMap<>();
    private final Map<UUID, Object> locks = new ConcurrentHashMap<>();

    public CollabWs(CollabService collab) {
        this.collab = collab;
    }

    public void join(Peer peer, UUID docId) {
        try {
            var access = collab.access(peer.userId(), docId);
            Sub sub = new Sub(peer);
            sub.canEdit = access.canEdit();
            sub.checkedAt = System.currentTimeMillis();
            Map<String, Sub> subs = docs.computeIfAbsent(docId, k -> new ConcurrentHashMap<>());
            List<Map<String, Object>> peers = new ArrayList<>();
            List<Sub> others = new ArrayList<>();
            synchronized (lock(docId)) {
                subs.put(peer.id(), sub);
                for (Sub s : subs.values()) {
                    if (s == sub) continue;
                    others.add(s);
                    peers.add(Map.of("userId", s.peer.userId(), "displayName", s.peer.displayName()));
                }
            }
            peer.send("doc.joined", Map.of("docId", docId, "seq", access.doc().seq(), "canEdit", access.canEdit(), "peers", peers));
            // Quien entra recibe el último estado de presencia de los demás
            for (Sub s : others) {
                if (s.lastAwareness != null && s.clientId != null) {
                    peer.send("doc.awareness", Map.of("docId", docId, "update", s.lastAwareness, "clientId", s.clientId, "userId", s.peer.userId()));
                }
            }
        } catch (ApiException e) {
            peer.send("doc.error", Map.of("docId", docId, "message", e.getMessage(), "status", e.getStatus().value()));
        }
    }

    public void leave(Peer peer, UUID docId) {
        Map<String, Sub> subs = docs.get(docId);
        if (subs == null) return;
        Sub sub = subs.remove(peer.id());
        if (subs.isEmpty()) {
            docs.remove(docId);
            locks.remove(docId);
        }
        if (sub != null && sub.clientId != null) {
            broadcast(docId, peer.id(), "doc.peer.left", Map.of("docId", docId, "clientIds", List.of(sub.clientId)));
        }
    }

    public void leaveAll(Peer peer) {
        for (UUID docId : new HashSet<>(docs.keySet())) leave(peer, docId);
    }

    public void update(Peer peer, UUID docId, String b64, String ref) {
        Sub sub = sub(peer, docId);
        if (sub == null) return;
        try {
            if (!stillAllowed(sub, docId)) {
                peer.send("doc.error", Map.of("docId", docId, "message", "Tu rol en esta sala es de solo lectura", "status", 403));
                return;
            }
            byte[] data = Base64.getDecoder().decode(b64);
            synchronized (lock(docId)) {
                long seq = collab.appendUpdate(docId, peer.userId(), data);
                peer.send("doc.ack", Map.of("docId", docId, "seq", seq, "ref", ref == null ? "" : ref));
                broadcast(docId, peer.id(), "doc.update", Map.of("docId", docId, "seq", seq, "update", b64, "userId", peer.userId()));
            }
        } catch (ApiException e) {
            peer.send("doc.error", Map.of("docId", docId, "message", e.getMessage(), "status", e.getStatus().value()));
        } catch (IllegalArgumentException e) {
            peer.send("doc.error", Map.of("docId", docId, "message", "Cambio no válido", "status", 400));
        } catch (RuntimeException e) {
            log.warn("No se pudo guardar un cambio del documento {}: {}", docId, e.toString());
            peer.send("doc.error", Map.of("docId", docId, "message", "No se pudo guardar el cambio", "status", 500));
        }
    }

    public void awareness(Peer peer, UUID docId, String b64, long clientId) {
        Sub sub = sub(peer, docId);
        if (sub == null || b64.length() > 20_000) return;
        sub.lastAwareness = b64;
        sub.clientId = clientId;
        broadcast(docId, peer.id(), "doc.awareness", Map.of("docId", docId, "update", b64, "clientId", clientId, "userId", peer.userId()));
    }

    /** Tras confirmar el borrado de un documento se avisa a quien lo tenía abierto. */
    @org.springframework.transaction.event.TransactionalEventListener(phase = org.springframework.transaction.event.TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    void onRoomEvent(com.nora.ws.RoomEvent e) {
        if ("doc.deleted".equals(e.type()) && e.data() instanceof Map<?, ?> m && m.get("id") instanceof UUID id) deleted(id);
    }

    /** El documento se borró: se avisa y se cierran las suscripciones. */
    public void deleted(UUID docId) {
        Map<String, Sub> subs = docs.remove(docId);
        locks.remove(docId);
        if (subs != null) subs.values().forEach((s) -> s.peer.send("doc.error", Map.of("docId", docId, "message", "El documento se ha eliminado", "status", 404)));
    }

    // ---- interno ----

    private Sub sub(Peer peer, UUID docId) {
        Map<String, Sub> subs = docs.get(docId);
        Sub s = subs == null ? null : subs.get(peer.id());
        if (s == null) peer.send("doc.error", Map.of("docId", docId, "message", "No estás dentro de este documento", "status", 400));
        return s;
    }

    /** Vuelve a comprobar el permiso cada pocos segundos: si el propietario te cambia a lector, dejas de poder escribir. */
    private boolean stillAllowed(Sub sub, UUID docId) {
        long now = System.currentTimeMillis();
        if (now - sub.checkedAt > RECHECK_MS) {
            sub.canEdit = collab.access(sub.peer.userId(), docId).canEdit();
            sub.checkedAt = now;
        }
        return sub.canEdit;
    }

    private void broadcast(UUID docId, String exceptPeer, String type, Object data) {
        Map<String, Sub> subs = docs.get(docId);
        if (subs == null) return;
        for (Sub s : new ArrayList<>(subs.values())) {
            if (!s.peer.id().equals(exceptPeer)) s.peer.send(type, data);
        }
    }

    private Object lock(UUID docId) {
        return locks.computeIfAbsent(docId, k -> new Object());
    }

    /** Para pruebas: cuántas personas hay dentro de un documento. */
    int subscribers(UUID docId) {
        Map<String, Sub> subs = docs.get(docId);
        return subs == null ? 0 : subs.size();
    }

    Map<UUID, Integer> snapshot() {
        Map<UUID, Integer> m = new HashMap<>();
        docs.forEach((k, v) -> m.put(k, v.size()));
        return m;
    }
}
