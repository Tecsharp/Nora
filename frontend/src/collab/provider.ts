import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { api, getAccessToken } from '../api'
import { rt } from '../realtime'

/**
 * Conecta un documento Yjs con el servidor de Nora por el WebSocket de la app.
 *
 * - Al abrir: se suscribe (`doc.join`), descarga instantánea + cambios guardados y se queda recibiendo `doc.update`.
 * - Los cambios locales se agrupan (~120 ms), se envían de uno en uno y se reenvían si no llega el `doc.ack` o si hay
 *   que reconectar. Al ser un CRDT, repetir o reordenar cambios es seguro.
 * - La presencia (cursores, selección) viaja como "awareness": efímera, no se guarda.
 * - Un cliente que ha aplicado todos los cambios hasta cierto número envía de vez en cuando el estado completo para
 *   que el servidor descarte el historial de cambios (compactación) y guarda versiones automáticas.
 */

export type SyncState = 'connecting' | 'syncing' | 'ready' | 'offline' | 'closed'

export interface CollabUser {
  id: string
  name: string
  color: string
}

const b64 = (u: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

const FLUSH_MS = 120
const ACK_TIMEOUT_MS = 8_000
const MAINTENANCE_MS = 20_000
const SNAPSHOT_EVERY_UPDATES = 40
const AUTO_VERSION_MS = 10 * 60_000

/** Sabe hasta qué número de cambio (seq) se han aplicado TODOS en este cliente, sin huecos. */
class SeqTracker {
  contiguous = 0
  private known = new Set<number>()
  reset(base: number) {
    this.contiguous = base
    this.known.clear()
  }
  observe(seq: number) {
    if (seq <= this.contiguous) return
    this.known.add(seq)
    while (this.known.delete(this.contiguous + 1)) this.contiguous++
  }
  get hasGap() {
    return this.known.size > 0
  }
}

export class CollabProvider {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)
  canEdit = false
  state: SyncState = 'connecting'
  error = ''
  /** El servidor aún no tiene el contenido inicial: este cliente debe sembrarlo (ver reclamarSiembra). */
  seedState: 'PENDING' | 'CLAIMED' | 'DONE' = 'DONE'

  private tracker = new SeqTracker()
  private listeners = new Set<() => void>()
  private offs: (() => void)[] = []
  private pending: Uint8Array[] = []
  private inflight: { ref: string; data: Uint8Array; sentAt: number } | null = null
  /** Espera antes de enviar los cambios locales y la presencia. Las pizarras lo bajan para que lo que se mueve se vea casi al instante. */
  flushMs = FLUSH_MS
  awarenessMs = 60
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private ackTimer: ReturnType<typeof setTimeout> | null = null
  private awTimer: ReturnType<typeof setTimeout> | null = null
  private maint: ReturnType<typeof setInterval> | null = null
  private joined = false
  private loading = false
  private gapSince = 0
  private lastSnapshotSeq = 0
  private lastAutoVersion = Date.now()
  private dirtySinceVersion = false
  private destroyed = false
  private refSeq = 0
  private resyncTimer: ReturnType<typeof setTimeout> | null = null
  /** Se avisa cuando el servidor dice que el documento está sembrado por otra persona. */
  onSeeded: (() => void) | null = null
  onDeleted: (() => void) | null = null

  constructor(readonly code: string, readonly docId: string, readonly user: CollabUser) {
    this.awareness.setLocalStateField('user', { id: user.id, name: user.name, color: user.color })
    this.doc.on('update', this.onLocalUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
    this.offs.push(
      rt.on('doc.joined', (d) => d.docId === docId && this.onJoined(d)),
      rt.on('doc.update', (d) => d.docId === docId && this.onRemoteUpdate(d)),
      rt.on('doc.ack', (d) => d.docId === docId && this.onAck(d)),
      rt.on('doc.awareness', (d) => d.docId === docId && this.onRemoteAwareness(d)),
      rt.on('doc.peer.left', (d) => d.docId === docId && removeAwarenessStates(this.awareness, d.clientIds, this)),
      rt.on('doc.error', (d) => d.docId === docId && this.onError(d)),
      rt.on('doc.seeded', (d) => d.id === docId && ((this.seedState = 'DONE'), this.onSeeded?.())),
      rt.on('doc.deleted', (d) => d.id === docId && this.onDeleted?.()),
      rt.onStatus((s) => {
        if (s === 'open') this.join()
        else if (!this.destroyed) {
          this.joined = false
          this.setState('offline')
        }
      }),
    )
    this.maint = setInterval(() => void this.maintenance(), MAINTENANCE_MS)
    if (rt.status === 'open') this.join()
  }

  // ---- suscripciones de la interfaz ----
  subscribe(l: () => void) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  private setState(s: SyncState) {
    if (this.state === s) return
    this.state = s
    this.listeners.forEach((l) => l())
  }
  /** Último cambio del servidor que este cliente ya tiene aplicado (sirve para saber si el archivo de la sala está al día). */
  get seq() {
    return this.tracker.contiguous
  }
  /** Espera a que lo escrito localmente esté confirmado por el servidor (para guardar el archivo con todo incluido). */
  async flushed(maxMs = 8000) {
    const t0 = Date.now()
    while (this.unsaved && Date.now() - t0 < maxMs) await new Promise((r) => setTimeout(r, 100))
  }
  get unsaved() {
    return this.pending.length > 0 || this.inflight !== null
  }

  // ---- conexión ----
  private join() {
    if (this.destroyed) return
    this.setState('connecting')
    rt.notify({ type: 'doc.join', docId: this.docId })
  }

  /** Vuelve a pedir el permiso (p. ej. si el propietario cambió mi rol): el servidor responde con doc.joined. */
  refreshAccess() {
    if (this.joined) rt.notify({ type: 'doc.join', docId: this.docId })
  }

  private onJoined(d: { canEdit: boolean }) {
    if (this.joined) {
      // Respuesta a refreshAccess(): solo cambia el permiso (los cambios ya los recibimos por el canal)
      if (d.canEdit !== this.canEdit) {
        this.canEdit = d.canEdit
        this.listeners.forEach((l) => l())
      }
      return
    }
    this.canEdit = d.canEdit
    this.joined = true
    void this.loadState()
  }

  private onError(d: { message: string; status?: number }) {
    if (d.status === 403 && this.state !== 'closed') {
      this.canEdit = false
      this.listeners.forEach((l) => l())
    }
    this.error = d.message
    if (d.status === 404) this.onDeleted?.()
    this.listeners.forEach((l) => l())
  }

  /** Descarga instantánea + cambios y los aplica. Se repite tras cada reconexión (aplicar dos veces es inocuo). */
  async loadState() {
    if (this.loading || this.destroyed) return
    this.loading = true
    if (this.state !== 'ready') this.setState('syncing') // una recarga en segundo plano no debe desmontar el editor
    try {
      const s = await api<{ seq: number; snapshot: string | null; snapshotSeq: number; updates: { seq: number; data: string }[]; seedState: 'PENDING' | 'CLAIMED' | 'DONE' }>(
        `/rooms/${this.code}/docs/${this.docId}/state`,
      )
      this.doc.transact(() => {
        if (s.snapshot) Y.applyUpdate(this.doc, unb64(s.snapshot), this)
        for (const u of s.updates) Y.applyUpdate(this.doc, unb64(u.data), this)
      }, this)
      if (this.tracker.contiguous < s.snapshotSeq) this.tracker.reset(s.snapshotSeq)
      for (const u of s.updates) this.tracker.observe(u.seq)
      this.lastSnapshotSeq = Math.max(this.lastSnapshotSeq, s.snapshotSeq)
      this.seedState = s.seedState
      this.error = ''
      this.setState('ready')
      // Lo que no llegó a confirmarse antes de cortarse la conexión se vuelve a enviar
      if (this.inflight) this.pending.unshift(this.inflight.data)
      this.inflight = null
      this.scheduleFlush(0)
      this.sendAwareness()
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'No se pudo cargar el documento'
      this.setState('offline')
      if (!this.destroyed) setTimeout(() => ((this.loading = false), void this.loadState()), 3000)
      return
    }
    this.loading = false
  }

  // ---- cambios ----
  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return // vino del servidor
    if (!this.canEdit && this.state === 'ready') return
    this.pending.push(update)
    this.dirtySinceVersion = true
    this.listeners.forEach((l) => l())
    this.scheduleFlush(this.flushMs)
  }

  private scheduleFlush(ms: number) {
    if (this.flushTimer) {
      if (ms > 0) return // ya hay un envío programado
      clearTimeout(this.flushTimer) // «ahora» adelanta al que estuviera esperando
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, ms)
  }

  private flush() {
    if (this.destroyed || !this.joined || this.state !== 'ready' || !this.canEdit) return
    if (this.inflight) {
      // Si el servidor no confirma, se reintenta con el mismo cambio
      if (Date.now() - this.inflight.sentAt > ACK_TIMEOUT_MS) this.send(this.inflight.data, this.inflight.ref)
      else this.scheduleFlush(500)
      return
    }
    if (!this.pending.length) return
    const data = this.pending.length === 1 ? this.pending[0]! : Y.mergeUpdates(this.pending)
    this.pending = []
    this.send(data, `${this.user.id}-${++this.refSeq}`)
  }

  private send(data: Uint8Array, ref: string) {
    this.inflight = { ref, data, sentAt: Date.now() }
    rt.notify({ type: 'doc.update', docId: this.docId, update: b64(data), ref })
    if (this.ackTimer) clearTimeout(this.ackTimer)
    this.ackTimer = setTimeout(() => { // sin confirmación a tiempo: flush() reenvía el mismo cambio
      this.ackTimer = null
      this.flush()
    }, ACK_TIMEOUT_MS + 200)
  }

  private onAck(d: { seq: number; ref: string }) {
    this.tracker.observe(d.seq)
    if (this.inflight?.ref === d.ref) {
      this.inflight = null
      if (this.ackTimer) clearTimeout(this.ackTimer)
      this.ackTimer = null
      this.listeners.forEach((l) => l())
      if (this.pending.length) this.scheduleFlush(0)
    }
  }

  private onRemoteUpdate(d: { seq: number; update: string }) {
    Y.applyUpdate(this.doc, unb64(d.update), this)
    this.tracker.observe(d.seq)
    this.listeners.forEach((l) => l())
    if (this.tracker.hasGap && !this.gapSince) this.gapSince = Date.now()
    if (!this.tracker.hasGap) this.gapSince = 0
    // Un cambio que depende de otro aún no recibido queda pendiente en Yjs: se pide el estado completo enseguida
    if ((this.doc.store.pendingStructs || this.doc.store.pendingDs) && !this.resyncTimer) {
      this.resyncTimer = setTimeout(() => {
        this.resyncTimer = null
        if (this.doc.store.pendingStructs || this.doc.store.pendingDs) void this.loadState()
      }, 1500)
    }
  }

  // ---- presencia ----
  private onAwarenessUpdate = (_c: unknown, origin: unknown) => {
    if (origin === this) return
    if (this.awTimer) return
    this.awTimer = setTimeout(() => {
      this.awTimer = null
      this.sendAwareness()
    }, this.awarenessMs)
  }

  private sendAwareness() {
    if (!this.joined || this.destroyed) return
    const update = encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
    rt.notify({ type: 'doc.awareness', docId: this.docId, update: b64(update), clientId: this.doc.clientID })
  }

  private onRemoteAwareness(d: { update: string }) {
    applyAwarenessUpdate(this.awareness, unb64(d.update), this)
  }

  /** Personas dentro del documento (incluida esta pestaña), a partir de la presencia. */
  peers(): { clientId: number; user: CollabUser; me: boolean }[] {
    const out: { clientId: number; user: CollabUser; me: boolean }[] = []
    this.awareness.getStates().forEach((st, clientId) => {
      const u = (st as { user?: CollabUser }).user
      if (u) out.push({ clientId, user: u, me: clientId === this.doc.clientID })
    })
    return out
  }

  // ---- siembra del contenido inicial ----
  /** Devuelve el contenido inicial si este cliente es el elegido para escribirlo en el documento. */
  async claimSeed(): Promise<string | null> {
    const r = await api<{ granted: boolean; content: string | null }>(`/rooms/${this.code}/docs/${this.docId}/seed/claim`, 'POST')
    return r.granted ? r.content : null
  }

  /** Marca la siembra como terminada: se espera a que el cambio inicial esté guardado antes de avisar. */
  async finishSeed() {
    for (let i = 0; i < 100 && this.unsaved; i++) await new Promise((r) => setTimeout(r, 100))
    await api(`/rooms/${this.code}/docs/${this.docId}/seed/done`, 'POST')
    this.seedState = 'DONE'
    this.listeners.forEach((l) => l())
  }

  // ---- compactación y versiones ----
  /** Quien tiene el menor clientID entre los presentes: es la persona «líder» que hace las tareas de mantenimiento (compactar, versiones, autoguardado). */
  isLeader() {
    let min = Infinity
    this.awareness.getStates().forEach((_s, id) => (min = Math.min(min, id)))
    return min === this.doc.clientID
  }

  private async maintenance() {
    if (this.destroyed || this.state !== 'ready' || !this.canEdit) return
    // Un hueco que no se cierra: se vuelve a descargar el estado
    if (this.gapSince && Date.now() - this.gapSince > 15_000) {
      this.gapSince = 0
      void this.loadState()
      return
    }
    const behind = this.tracker.contiguous - this.lastSnapshotSeq
    if (behind >= SNAPSHOT_EVERY_UPDATES && !this.tracker.hasGap && this.isLeader()) {
      const upTo = this.tracker.contiguous
      try {
        const r = await fetch(`/api/rooms/${this.code}/docs/${this.docId}/snapshot?upToSeq=${upTo}`, {
          method: 'PUT', headers: { Authorization: `Bearer ${getAccessToken() ?? ''}`, 'Content-Type': 'application/octet-stream' }, body: Y.encodeStateAsUpdate(this.doc),
        })
        if (r.ok) this.lastSnapshotSeq = upTo
      } catch { /* se reintenta en la siguiente pasada */ }
    }
    if (this.dirtySinceVersion && Date.now() - this.lastAutoVersion > AUTO_VERSION_MS && this.isLeader()) {
      this.lastAutoVersion = Date.now()
      this.dirtySinceVersion = false
      void this.saveVersion(null).catch(() => {})
    }
  }

  /** Guarda una versión del documento (instantánea completa) que luego se puede restaurar. */
  async saveVersion(label: string | null) {
    const q = new URLSearchParams({ seq: String(this.tracker.contiguous) })
    if (label) q.set('label', label)
    const r = await fetch(`/api/rooms/${this.code}/docs/${this.docId}/versions?${q}`, {
      method: 'POST', headers: { Authorization: `Bearer ${getAccessToken() ?? ''}`, 'Content-Type': 'application/octet-stream' }, body: Y.encodeStateAsUpdate(this.doc),
    })
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? 'No se pudo guardar la versión')
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy')
    if (this.joined) {
      this.sendAwareness()
      rt.notify({ type: 'doc.leave', docId: this.docId })
    }
    this.offs.forEach((o) => o())
    if (this.maint) clearInterval(this.maint)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.ackTimer) clearTimeout(this.ackTimer)
    if (this.resyncTimer) clearTimeout(this.resyncTimer)
    this.setState('closed')
    this.awareness.destroy()
    this.doc.destroy()
  }
}

export const PEER_COLORS = ['#7c6af7', '#2f6fd6', '#e0792b', '#c2416f', '#17897a', '#8a6d1c', '#9a47c9', '#3d8f3d']
export const colorFor = (id: string) => {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PEER_COLORS[h % PEER_COLORS.length]!
}
