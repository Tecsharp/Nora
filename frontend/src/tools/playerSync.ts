/**
 * Motor de sincronización del Reproductor. El servidor guarda «qué suena, en qué posición estaba a la hora X y si está sonando»; aquí se
 * calcula dónde debería ir cada navegador ahora mismo y se corrige la deriva. Los gestos de quien reproduce (play, pausa, saltar) se
 * envían al servidor y los de los demás se aplican con una breve «ventana de silencio» para no devolver el eco.
 */

export interface PlayerItem {
  id: string
  kind: 'youtube' | 'media' | 'file'
  url?: string
  ytId?: string
  fileId?: string
  title: string
}
export interface PlayerState {
  item: PlayerItem | null
  playing: boolean
  position: number
  rate: number
  updatedAt: number
  by: string
  rev: number
  serverNow: number
}

/** Lo que el motor necesita de un reproductor concreto (elemento <video>/<audio> o el iframe de YouTube). */
export interface Adapter {
  play(): Promise<boolean> // false si el navegador lo bloquea hasta que la persona pulse algo
  pause(): void
  seek(t: number): void
  setRate(r: number): void
  time(): number
  duration(): number
  isPlaying(): boolean
  rate(): number
}

export interface Callbacks {
  send: (body: Record<string, unknown>) => void
  state: () => PlayerState
  /** Diferencia entre el reloj del servidor y el de este navegador. */
  offset: () => number
  blocked: (b: boolean) => void
}

const QUIET_MS = 1200
const DRIFT_S = 1.2

export class Sync {
  private adapter: Adapter | null = null
  private quietUntil = 0
  private timer: ReturnType<typeof setInterval> | null = null
  constructor(private cb: Callbacks) {}

  attach(a: Adapter | null) {
    this.adapter = a
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (a) {
      this.timer = setInterval(() => this.tick(), 1500)
      this.apply(true)
    }
  }
  dispose() { this.attach(null) }

  /** Dónde debería estar la reproducción ahora mismo según el servidor. */
  expected(): number {
    const s = this.cb.state()
    if (!s.playing) return s.position
    return s.position + Math.max(0, Date.now() + this.cb.offset() - s.updatedAt) / 1000 * s.rate
  }

  /** Llegó un estado nuevo (o se acaba de preparar el reproductor): se pone igual que el servidor. */
  apply(first = false) {
    const a = this.adapter
    const s = this.cb.state()
    if (!a || !s.item) return
    this.quietUntil = Date.now() + QUIET_MS
    a.setRate(s.rate)
    const want = this.expected()
    if (Math.abs(a.time() - want) > (first ? 0.3 : 0.6)) a.seek(want)
    if (s.playing && !a.isPlaying()) void a.play().then((ok) => this.cb.blocked(!ok))
    else if (!s.playing && a.isPlaying()) a.pause()
  }

  private tick() {
    const a = this.adapter
    const s = this.cb.state()
    if (!a || !s.item || Date.now() < this.quietUntil) return
    if (Math.abs(a.rate() - s.rate) > 0.01) a.setRate(s.rate) // p. ej. se perdió mientras el reproductor aún cargaba
    const want = this.expected()
    if (s.playing && a.isPlaying() && Math.abs(a.time() - want) > DRIFT_S) {
      this.quietUntil = Date.now() + QUIET_MS
      a.seek(want)
    } else if (!s.playing && !a.isPlaying() && Math.abs(a.time() - s.position) > 0.6) {
      this.quietUntil = Date.now() + QUIET_MS
      a.seek(s.position)
    } else if (s.playing && !a.isPlaying()) {
      void a.play().then((ok) => this.cb.blocked(!ok))
    }
  }

  private quiet() { return Date.now() < this.quietUntil }

  // gestos de la persona que usa este reproductor
  userPlay(t: number) { if (!this.quiet() && !this.cb.state().playing) this.cb.send({ action: 'play', position: t }) }
  userPause(t: number) { if (!this.quiet() && this.cb.state().playing) this.cb.send({ action: 'pause', position: t }) }
  userSeek(t: number) { if (!this.quiet() && Math.abs(t - this.expected()) > 0.8) this.cb.send({ action: 'seek', position: t }) }
  userRate(r: number) { if (!this.quiet() && Math.abs(r - this.cb.state().rate) > 0.01) this.cb.send({ action: 'rate', rate: r }) }
  ended() {
    const s = this.cb.state()
    if (s.item) this.cb.send({ action: 'next', from: s.item.id })
  }
}

export class MediaAdapter implements Adapter {
  private off: (() => void)[] = []
  readonly el: HTMLMediaElement
  constructor(el: HTMLMediaElement, sync: Sync) {
    this.el = el
    const on = (ev: string, fn: () => void) => { el.addEventListener(ev, fn); this.off.push(() => el.removeEventListener(ev, fn)) }
    on('play', () => sync.userPlay(el.currentTime))
    on('pause', () => { if (!el.ended) sync.userPause(el.currentTime) })
    on('seeked', () => sync.userSeek(el.currentTime))
    on('ratechange', () => sync.userRate(el.playbackRate))
    on('ended', () => sync.ended())
  }
  dispose() { this.off.forEach((f) => f()) }
  play() { return this.el.play().then(() => true, () => false) }
  pause() { this.el.pause() }
  seek(t: number) { this.el.currentTime = Math.max(0, t) }
  setRate(r: number) { if (this.el.playbackRate !== r) this.el.playbackRate = r }
  time() { return this.el.currentTime }
  duration() { return Number.isFinite(this.el.duration) ? this.el.duration : 0 }
  isPlaying() { return !this.el.paused && !this.el.ended }
  rate() { return this.el.playbackRate }
}

/**
 * YouTube sin cargar su script: el iframe de «youtube-nocookie» habla por postMessage (comandos y eventos). Así la política de seguridad
 * solo necesita permitir el iframe, no ejecutar código de terceros en la página.
 */
export class YouTubeAdapter implements Adapter {
  private t = 0
  private at = Date.now()
  private dur = 0
  private st = -1
  private spd = 1
  private heard = false
  private pending: { func: string; args: unknown[] }[] = [] // comandos dados antes de que el reproductor esté listo
  private hello: ReturnType<typeof setInterval> | null = null
  title = ''
  onTitle: (t: string) => void = () => undefined
  onReady: () => void = () => undefined

  constructor(private frame: HTMLIFrameElement, private sync: Sync) {
    window.addEventListener('message', this.onMessage)
    // hasta que el reproductor contesta, se le sigue diciendo que estamos escuchando
    const say = () => this.post({ event: 'listening', id: 1, channel: 'widget' })
    frame.addEventListener('load', say)
    this.hello = setInterval(() => { if (this.heard && this.hello) { clearInterval(this.hello); this.hello = null } else say() }, 500)
  }
  dispose() {
    window.removeEventListener('message', this.onMessage)
    if (this.hello) clearInterval(this.hello)
  }
  private post(m: object) { try { this.frame.contentWindow?.postMessage(JSON.stringify(m), 'https://www.youtube-nocookie.com') } catch { /* sin ventana */ } }
  private cmd(func: string, args: unknown[] = []) {
    if (!this.heard) {
      this.pending = [...this.pending.filter((p) => p.func !== func), { func, args }]
      return
    }
    this.post({ event: 'command', func, args })
  }

  private onMessage = (e: MessageEvent) => {
    if (e.source !== this.frame.contentWindow || typeof e.data !== 'string') return
    let m: { event?: string; info?: { currentTime?: number; duration?: number; playerState?: number; playbackRate?: number; videoData?: { title?: string } } | number }
    try { m = JSON.parse(e.data) } catch { return }
    if (!m.event) return
    if (!this.heard) {
      this.heard = true
      this.pending.forEach((p) => this.post({ event: 'command', func: p.func, args: p.args }))
      this.pending = []
      this.onReady()
    }
    const info = typeof m.info === 'object' ? m.info : undefined
    if (m.event === 'onStateChange' && typeof m.info === 'number') this.setState(m.info)
    if (!info) return
    if (info.videoData?.title && info.videoData.title !== this.title) { this.title = info.videoData.title; this.onTitle(this.title) }
    if (typeof info.duration === 'number') this.dur = info.duration
    if (typeof info.playbackRate === 'number' && Math.abs(info.playbackRate - this.spd) > 0.01) { this.spd = info.playbackRate; this.sync.userRate(this.spd) }
    if (typeof info.currentTime === 'number') {
      const now = Date.now()
      const predicted = this.st === 1 ? this.t + (now - this.at) / 1000 * this.spd : this.t
      if (Math.abs(info.currentTime - predicted) > (this.st === 1 ? 1.5 : 0.8) && now - this.at < 3000) this.sync.userSeek(info.currentTime)
      this.t = info.currentTime
      this.at = now
    }
    if (typeof info.playerState === 'number') this.setState(info.playerState)
  }
  private setState(s: number) {
    if (s === this.st) return
    this.st = s
    if (s === 1) this.sync.userPlay(this.time())
    else if (s === 2) this.sync.userPause(this.time())
    else if (s === 0) this.sync.ended()
  }

  play() { this.cmd('playVideo'); return new Promise<boolean>((r) => setTimeout(() => r(!this.heard || this.st === 1 || this.st === 3), 1200)) }
  pause() { this.cmd('pauseVideo') }
  seek(t: number) { this.cmd('seekTo', [t, true]); this.t = t; this.at = Date.now() }
  setRate(r: number) { if (this.heard && Math.abs(r - this.spd) <= 0.01) return; this.cmd('setPlaybackRate', [r]) }
  rate() { return this.spd }
  time() { return this.st === 1 ? this.t + (Date.now() - this.at) / 1000 * this.spd : this.t }
  duration() { return this.dur }
  isPlaying() { return this.st === 1 || this.st === 3 }
  setVolume(v: number) { this.cmd('setVolume', [Math.round(v * 100)]) }
}
