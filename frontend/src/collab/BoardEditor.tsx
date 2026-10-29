import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CaptureUpdateAction, DefaultSidebar, Excalidraw, MainMenu, Sidebar, convertToExcalidrawElements, exportToBlob, exportToSvg, getCommonBounds, loadFromBlob, reconcileElements, restoreElements, viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { BinaryFileData, Collaborator, ExcalidrawImperativeAPI, SocketId } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ChevronDown, FileDown, Library as LibraryIcon, Magnet, Upload,
  type LucideIcon,
} from 'lucide-react'
import type { CollabProvider } from './provider'
import { BoardStore, MAX_FILE_CHARS, type BoardElement } from './boardModel'
import { blobToDataURL, jpegToPdf, newId, reidElements, shrinkDataURL, type BoardHandle } from './boardIO'
import { useTheme } from '../theme'
import { useToast } from '../toast'
import { api as http } from '../api'
import SystemLibrary, { type SysGroup, type SysItem } from './SystemLibrary'

type LibItem = { id: string; status?: 'published' | 'unpublished'; elements: unknown[]; created?: number; name?: string }
const LOCAL = 'board-local'
const keyOf = (e: { version: number; versionNonce: number }) => `${e.version}:${e.versionNonce}`
const LIBRARY_KEY = 'nora-board-library'

const SNAP_KEY = 'nora-board-snap'
/** El imán (ajustar al centro y a los bordes de los demás elementos) viene activado; se recuerda si alguien lo apaga. */
const readSnap = () => {
  try {
    return localStorage.getItem(SNAP_KEY) !== 'off'
  } catch {
    return true
  }
}
const saveSnap = (on: boolean) => {
  try {
    localStorage.setItem(SNAP_KEY, on ? 'on' : 'off')
  } catch { /* sin almacenamiento: solo dura esta sesión */ }
}

/** Botones de alineación. Los nombres son los de Excalidraw en español: se usan para pulsar su botón nativo, que mueve también el texto ligado, las flechas y los grupos. */
const ALIGN: ({ label: string; icon: LucideIcon; hint?: string } | null)[] = [
  { label: 'Alinear a la izquierda', icon: AlignStartVertical, hint: 'Ctrl+Mayús+←' },
  { label: 'Centrar horizontalmente', icon: AlignCenterVertical, hint: 'quedan en columna, con el mismo centro' },
  { label: 'Alinear a la derecha', icon: AlignEndVertical, hint: 'Ctrl+Mayús+→' },
  null,
  { label: 'Alineación superior', icon: AlignStartHorizontal, hint: 'Ctrl+Mayús+↑' },
  { label: 'Centrar verticalmente', icon: AlignCenterHorizontal, hint: 'quedan en fila, con el mismo centro' },
  { label: 'Alineación inferior', icon: AlignEndHorizontal, hint: 'Ctrl+Mayús+↓' },
]
const DISTRIBUTE: { label: string; icon: LucideIcon }[] = [
  { label: 'Distribuir horizontalmente', icon: AlignHorizontalDistributeCenter },
  { label: 'Distribuir verticalmente', icon: AlignVerticalDistributeCenter },
]

function readLibrary() {
  try {
    return JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '[]') as LibItem[]
  } catch {
    return []
  }
}

interface Props {
  provider: CollabProvider
  editable: boolean
  onHandle: (h: BoardHandle | null) => void
  /** El editor pide importar un archivo (menú de Excalidraw). */
  onImportRequest: () => void
  onSaveCopy: () => void
  /** Con la barra superior del editor oculta: pulsarlo la vuelve a mostrar (el botón sale junto al imán). */
  onShowBar?: () => void
  /** Código de la sala: la biblioteca personal se guarda por persona y sala. */
  roomCode: string
}

/**
 * Pizarra colaborativa: el editor de Excalidraw (el mismo componente, con todas sus herramientas, formas, flechas ligadas,
 * marcos, texto, dibujo libre, imágenes, biblioteca, exportación, etc.) con su escena sincronizada por el canal Yjs de Nora.
 * Los cambios locales se escriben en un Y.Map (un valor por elemento) y los remotos se reconcilian con la lógica de
 * Excalidraw, igual que en su colaboración oficial. Los cursores, selecciones y el puntero láser de los demás llegan por la
 * presencia (awareness) del documento.
 */
export default function BoardEditor({ provider, editable, onHandle, onImportRequest, onSaveCopy, onShowBar, roomCode }: Props) {
  const doc = provider.doc
  const store = useMemo(() => new BoardStore(doc), [doc])
  const toast = useToast()
  const { pref, setPref } = useTheme()
  const dark = pref === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : pref === 'dark'
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const synced = useRef(new Map<string, string>()) // id → versión que ya está en Yjs
  const pending = useRef(new Set<string>()) // imágenes que se están reduciendo para sincronizarlas
  const follow = useRef<string | null>(null)
  const board = useRef<{ pointer?: unknown; button?: string; selectedElementIds?: Record<string, true>; view?: { cx: number; cy: number; zoom: number } }>({})
  const root = useRef<HTMLDivElement>(null)
  const editableRef = useRef(editable)
  editableRef.current = editable
  const snapSeen = useRef<boolean | null>(null)
  const [sel, setSel] = useState({ n: 0, frame: false }) // lo seleccionado: decide si se ofrece la barra de alineación
  const [snap, setSnap] = useState(() => readSnap() && typeof store.meta.get('grid') !== 'number')
  const [sbWidth, setSbWidth] = useState(() => {
    try {
      return Math.min(760, Math.max(260, Number(localStorage.getItem('nora-board-sidebar')) || 302))
    } catch {
      return 302
    }
  })
  const [sbEl, setSbEl] = useState<HTMLElement | null>(null)
  const [phone, setPhone] = useState(false) // diseño de móvil de Excalidraw: sin panel de propiedades a mano, la barra no puede pulsar sus botones

  const initialData = useMemo(() => {
    const grid = typeof store.meta.get('grid') === 'number'
    const els = store.ordered()
    els.forEach((e) => synced.current.set(e.id, keyOf(e)))
    return {
      elements: els as unknown as ExcalidrawElement[],
      appState: { viewBackgroundColor: store.background, gridModeEnabled: grid, objectsSnapModeEnabled: !grid && readSnap() },
      files: Object.fromEntries([...store.files.entries()].map(([id, f]) => [id, f])) as unknown as Record<string, BinaryFileData>,
      scrollToContent: true,
    }
  }, [store])

  // ---- Yjs → escena ----
  useEffect(() => {
    if (!api) return
    let raf = 0
    let fallback: ReturnType<typeof setTimeout> | undefined
    let all = true // la primera vez se reconcilia todo; después solo lo que cambió
    const dirty = new Set<string>()
    const apply = () => {
      cancelAnimationFrame(raf)
      clearTimeout(fallback)
      raf = 0
      fallback = undefined
      const remote = all ? store.ordered() : [...dirty].map((id) => store.elements.get(id)).filter((e): e is BoardElement => !!e)
      const ids = all ? null : [...dirty]
      all = false
      dirty.clear()
      if (!remote.length) return
      const local = api.getSceneElementsIncludingDeleted()
      const reconciled = reconcileElements(local, remote as never, api.getAppState())
      for (const e of reconciled) {
        if (ids && !ids.includes(e.id)) continue
        const r = store.elements.get(e.id)
        if (r && r.version === e.version && r.versionNonce === e.versionNonce) synced.current.set(e.id, keyOf(e))
      }
      api.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER })
    }
    const onElements = (ev: { keysChanged?: Set<string> }, txn: { origin: unknown }) => {
      if (txn.origin === LOCAL) return
      ev.keysChanged?.forEach((k) => dirty.add(k))
      if (!ev.keysChanged) all = true
      // en el siguiente fotograma; si la pestaña está oculta o tapada el navegador no los da, y no se puede quedar sin verse
      if (!raf) raf = requestAnimationFrame(apply)
      if (fallback === undefined) fallback = setTimeout(apply, 50)
    }
    const onFiles = () => {
      const have = api.getFiles()
      const fresh = [...store.files.values()].filter((f) => !have[f.id])
      if (fresh.length) api.addFiles(fresh as unknown as BinaryFileData[])
    }
    const onMeta = () => {
      const bg = store.background
      if (api.getAppState().viewBackgroundColor !== bg) api.updateScene({ appState: { viewBackgroundColor: bg }, captureUpdate: CaptureUpdateAction.NEVER })
    }
    store.elements.observe(onElements)
    store.files.observe(onFiles)
    store.meta.observe(onMeta)
    onFiles()
    // lo que haya llegado entre que se leyó el estado inicial y ahora
    apply()
    return () => {
      store.elements.unobserve(onElements)
      store.files.unobserve(onFiles)
      store.meta.unobserve(onMeta)
      cancelAnimationFrame(raf)
      clearTimeout(fallback)
    }
  }, [api, store])

  // Pizarra en vivo: los cambios y los cursores salen casi sin espera (el resto de documentos agrupa más)
  useEffect(() => {
    const before = { flush: provider.flushMs, aw: provider.awarenessMs }
    provider.flushMs = 8
    provider.awarenessMs = 16
    return () => {
      provider.flushMs = before.flush
      provider.awarenessMs = before.aw
    }
  }, [provider])

  // ---- biblioteca: las del sistema (solo lectura, de todos) + la propia de esta persona en esta sala (se guarda en el servidor) ----
  const [sysGroups, setSysGroups] = useState<SysGroup[]>([])
  const [sysLoading, setSysLoading] = useState(true)
  const libReady = useRef(false)
  const libSaved = useRef('')
  const libTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    if (!api) return
    let alive = true
    void (async () => {
      try {
        const [system, mine] = await Promise.all([
          http<{ id: string; name: string; items: LibItem[] }[]>('/libraries/system'),
          http<{ items: LibItem[] }>(`/rooms/${roomCode}/library`),
        ])
        if (!alive) return
        let own = (mine.items ?? []).map((i) => ({ ...i, status: 'unpublished' as const }))
        if (!own.length) { // primera vez en el servidor: se traen las de este navegador (las que había antes de esta versión)
          own = readLibrary().map((i: LibItem) => ({ ...i, status: 'unpublished' as const }))
        }
        setSysGroups(system.map((l) => ({ id: l.id, name: l.name, items: l.items.map((i) => ({ id: i.id, name: i.name, elements: i.elements })) })))
        libSaved.current = JSON.stringify(mine.items ?? [])
        await api.updateLibrary({ libraryItems: own as never, merge: false, defaultStatus: 'unpublished' }) // las del sistema van en su propia pestaña
        setSysLoading(false)
        libReady.current = true
        if (own.length && !mine.items?.length) saveLibrary(own)
      } catch {
        setSysLoading(false)
        libReady.current = false // sin conexión con el servidor: se queda con lo que haya en el navegador
        const local = readLibrary()
        if (local.length) await api.updateLibrary({ libraryItems: local as never, merge: false, defaultStatus: 'unpublished' }).catch(() => undefined)
      }
    })()
    return () => { alive = false }
  }, [api, roomCode]) // eslint-disable-line react-hooks/exhaustive-deps

  function saveLibrary(items: LibItem[]) {
    const body = JSON.stringify(items)
    if (body === libSaved.current) return
    if (body.length > 100 * 1024 * 1024) return toast('Tu biblioteca de esta sala supera el máximo de 100 MB', 'error')
    clearTimeout(libTimer.current)
    libTimer.current = setTimeout(() => {
      http(`/rooms/${roomCode}/library`, 'PUT', items)
        .then(() => { libSaved.current = body })
        .catch((e) => toast(e instanceof Error ? e.message : 'No se pudo guardar tu biblioteca', 'error'))
    }, 1500)
  }
  useEffect(() => () => clearTimeout(libTimer.current), [])

  /** Añade un elemento de una biblioteca del sistema en el centro de lo que se está viendo (con ids nuevos). */
  const insertSystem = useCallback((item: SysItem) => {
    if (!api) return
    if (!editableRef.current) return toast('Solo lectura: no puedes añadir elementos', 'warning')
    // las bibliotecas (sobre todo las antiguas) pueden traer elementos sin campos que hoy son obligatorios (groupIds, version, index…):
    // se completan igual que hace Excalidraw al cargar un archivo, y se desbloquean para que el elemento insertado se pueda mover
    const fresh = restoreElements(
      reidElements((item.elements as (Record<string, unknown> & { id: string })[]).filter((e) => !e.isDeleted)) as never,
      null,
      { refreshDimensions: false, repairBindings: true },
    ).map((e) => ({ ...e, locked: false })) as unknown as ExcalidrawElement[]
    if (!fresh.length) return
    const s = api.getAppState()
    const c = viewportCoordsToSceneCoords({ clientX: s.offsetLeft + s.width / 2, clientY: s.offsetTop + s.height / 2 }, s)
    const [x1, y1, x2, y2] = getCommonBounds(fresh)
    const dx = c.x - (x1 + x2) / 2
    const dy = c.y - (y1 + y2) / 2
    const placed = fresh.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }))
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...placed] as never,
      // Si el elemento viene agrupado, Excalidraw espera también el grupo exterior en `selectedGroupIds`; sin él la
      // selección queda "a medias" y no se puede deseleccionar ni seleccionar otra cosa.
      appState: {
        selectedElementIds: Object.fromEntries(placed.map((e) => [e.id, true as const])),
        selectedGroupIds: Object.fromEntries(placed.map((e) => e.groupIds[e.groupIds.length - 1]).filter((g): g is string => !!g).map((g) => [g, true as const])),
        editingGroupId: null,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
  }, [api, toast])

  // ---- escena → Yjs ----
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const latest = useRef<{ elements: readonly OrderedExcalidrawElement[]; bg: string; files: Record<string, BinaryFileData> } | null>(null)

  const flush = useCallback(() => {
    timer.current = undefined
    const l = latest.current
    latest.current = null
    if (!l || !editableRef.current) return
    doc.transact(() => {
      for (const el of l.elements) {
        const k = keyOf(el)
        if (synced.current.get(el.id) === k) continue
        store.elements.set(el.id, structuredClone(el) as unknown as BoardElement)
        synced.current.set(el.id, k)
      }
      if (l.bg && l.bg !== store.background) store.meta.set('bg', l.bg)
      for (const [id, f] of Object.entries(l.files)) {
        if (store.files.has(id) || pending.current.has(id)) continue
        if (f.dataURL.length <= MAX_FILE_CHARS) store.files.set(id, { id, mimeType: f.mimeType, dataURL: f.dataURL, created: f.created })
        else {
          // una imagen demasiado grande para un mensaje: se sube reducida (aquí se conserva la original)
          pending.current.add(id)
          void shrinkDataURL(f.dataURL, MAX_FILE_CHARS).then((small) => {
            pending.current.delete(id)
            if (small) doc.transact(() => store.files.set(id, { id, mimeType: small.slice(5, small.indexOf(';')), dataURL: small, created: f.created }), LOCAL)
            else toast('Una imagen es demasiado grande para compartirla con los demás', 'error')
          })
        }
      }
    }, LOCAL)
  }, [doc, store, toast])

  const onChange = useCallback((elements: readonly OrderedExcalidrawElement[], appState: { viewBackgroundColor: string; selectedElementIds: Record<string, true>; objectsSnapModeEnabled: boolean; gridModeEnabled: boolean; openSidebar?: { name: string } | null }, files: Record<string, BinaryFileData>) => {
    if (root.current) {
      const live = elements.filter((e) => !e.isDeleted)
      root.current.dataset.count = String(live.length) // útil para accesibilidad y para las pruebas automáticas
      root.current.dataset.types = live.map((e) => e.type).join(',')
      root.current.dataset.sig = String(Math.round(live.reduce((a, e) => a + e.x + e.y, 0))) // para las pruebas automáticas: cambia cuando algo se mueve
    }
    if (editableRef.current) {
      latest.current = { elements, bg: appState.viewBackgroundColor, files }
      if (!timer.current) timer.current = setTimeout(flush, 0)
    }
    const picked = appState.selectedElementIds
    if (JSON.stringify(picked) !== JSON.stringify(board.current.selectedElementIds ?? {})) {
      board.current.selectedElementIds = picked
      publish()
    }
    if (!appState.openSidebar) setSbEl(null)
    else requestAnimationFrame(() => setSbEl((cur) => document.querySelector<HTMLElement>('.default-sidebar') ?? cur))
    const n = Object.keys(picked).length
    const frame = n > 1 && elements.some((e) => picked[e.id] && (e.type === 'frame' || e.type === 'magicframe'))
    setSel((s) => (s.n === n && s.frame === frame ? s : { n, frame }))
    // la preferencia del imán es lo que se ve en pantalla (con la cuadrícula activa, Excalidraw lo apaga solo y eso no cuenta)
    if (snapSeen.current !== appState.objectsSnapModeEnabled) {
      if (snapSeen.current !== null && !appState.gridModeEnabled) saveSnap(appState.objectsSnapModeEnabled)
      snapSeen.current = appState.objectsSnapModeEnabled
      setSnap(appState.objectsSnapModeEnabled)
    }
  }, [flush]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); flush() }
  }, [flush])

  // ---- presencia: cursores, selecciones, puntero láser y seguimiento ----
  const lastPub = useRef(0)
  const pubTimer = useRef<ReturnType<typeof setTimeout>>()
  const publish = () => {
    const now = Date.now()
    const send = () => {
      lastPub.current = Date.now()
      pubTimer.current = undefined
      provider.awareness.setLocalStateField('board', { ...board.current })
    }
    if (now - lastPub.current > 16) send()
    else if (!pubTimer.current) pubTimer.current = setTimeout(send, 16)
  }

  useEffect(() => {
    if (!api) return
    const read = () => {
      const m = new Map<SocketId, Collaborator>()
      provider.awareness.getStates().forEach((st, clientId) => {
        if (clientId === doc.clientID) return
        const s = st as { user?: { id: string; name: string; color: string }; board?: { pointer?: Collaborator['pointer']; button?: 'up' | 'down'; selectedElementIds?: Record<string, true>; view?: { cx: number; cy: number; zoom: number } } }
        if (!s.user) return
        const sid = String(clientId) as SocketId
        m.set(sid, {
          pointer: s.board?.pointer, button: s.board?.button, selectedElementIds: s.board?.selectedElementIds, username: s.user.name, id: s.user.id, socketId: sid,
          color: { background: s.user.color, stroke: s.user.color },
        })
        if (follow.current === sid && s.board?.view) {
          const v = s.board.view
          const st2 = api.getAppState()
          api.updateScene({ appState: { zoom: { value: v.zoom as never }, scrollX: st2.width / 2 / v.zoom - v.cx, scrollY: st2.height / 2 / v.zoom - v.cy }, captureUpdate: CaptureUpdateAction.NEVER })
        }
      })
      api.updateScene({ collaborators: m })
    }
    provider.awareness.on('change', read)
    read()
    const offFollow = api.onUserFollow(({ action, userToFollow }) => {
      follow.current = action === 'FOLLOW' ? userToFollow.socketId : null
      if (action === 'FOLLOW') read()
    })
    const offScroll = api.onScrollChange((scrollX, scrollY, zoom) => {
      const s = api.getAppState()
      board.current.view = { cx: s.width / 2 / zoom.value - scrollX, cy: s.height / 2 / zoom.value - scrollY, zoom: zoom.value }
      publish()
    })
    return () => {
      provider.awareness.off('change', read)
      offFollow()
      offScroll()
      provider.awareness.setLocalStateField('board', null)
    }
  }, [api, provider, doc]) // eslint-disable-line react-hooks/exhaustive-deps

  // Las lápidas viejas se limpian al abrir
  useEffect(() => {
    if (editable) store.prune()
  }, [store, editable])

  // ---- exportar / importar ----
  const handle = useMemo<BoardHandle | null>(() => {
    if (!api) return null
    const exportBlob: BoardHandle['exportBlob'] = async (kind, opts = {}) => {
      const elements = api.getSceneElements()
      if (!elements.length) throw new Error('La pizarra está vacía')
      const appState = { ...api.getAppState(), exportBackground: opts.background ?? true, exportWithDarkMode: opts.dark ?? false, exportEmbedScene: kind !== 'pdf' }
      const files = api.getFiles()
      const scale = opts.scale ?? 2
      if (kind === 'svg') {
        const svg = await exportToSvg({ elements, appState, files, exportPadding: 20 })
        return new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
      }
      if (kind === 'png') return exportToBlob({ elements, appState, files, mimeType: 'image/png', exportPadding: 20, getDimensions: (w: number, h: number) => ({ width: w * scale, height: h * scale, scale }) })
      const jpeg = await exportToBlob({ elements, appState: { ...appState, exportBackground: true }, files, mimeType: 'image/jpeg', quality: 0.92, exportPadding: 20, getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }) })
      const bmp = await createImageBitmap(jpeg)
      const out = await jpegToPdf(jpeg, bmp.width, bmp.height)
      bmp.close()
      return out
    }
    const thumbnail = async () => {
      const elements = api.getSceneElements()
      if (!elements.length) return null
      return exportToBlob({
        elements, appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false }, files: api.getFiles(),
        mimeType: 'image/jpeg', quality: 0.72, exportPadding: 12, maxWidthOrHeight: 480,
      })
    }
    const insertImage = async (file: File) => {
      const dataURL = await blobToDataURL(file)
      const bmp = await createImageBitmap(file)
      const k = Math.min(1, 640 / Math.max(bmp.width, bmp.height))
      const width = Math.round(bmp.width * k)
      const height = Math.round(bmp.height * k)
      bmp.close()
      const id = newId()
      api.addFiles([{ id, dataURL, mimeType: file.type, created: Date.now() } as unknown as BinaryFileData])
      const s = api.getAppState()
      const c = viewportCoordsToSceneCoords({ clientX: s.offsetLeft + s.width / 2, clientY: s.offsetTop + s.height / 2 }, s)
      const [el] = convertToExcalidrawElements([{ type: 'image', fileId: id as never, x: c.x - width / 2, y: c.y - height / 2, width, height, status: 'saved' } as never])
      api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), el!], appState: { selectedElementIds: { [el!.id]: true } }, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
      return 1
    }
    const importFile: BoardHandle['importFile'] = async (file, mode) => {
      let restored: Awaited<ReturnType<typeof loadFromBlob>> | null = null
      const maybeScene = /\.(excalidraw|json)$/i.test(file.name) || file.type === 'image/png' || file.type === 'image/svg+xml' || file.type === 'application/json'
      if (maybeScene) {
        try {
          restored = await loadFromBlob(file, null, null)
        } catch {
          restored = null
        }
      }
      if (!restored) {
        if (file.type.startsWith('image/')) return insertImage(file)
        throw new Error('No es un archivo de pizarra (.excalidraw) ni una imagen')
      }
      const incoming = restored.elements.filter((e) => !e.isDeleted) as unknown as (ExcalidrawElement & Record<string, unknown>)[]
      if (!incoming.length && mode === 'merge') throw new Error('El archivo no tiene elementos')
      let fresh = reidElements(incoming) as unknown as ExcalidrawElement[]
      const s = api.getAppState()
      if (mode === 'merge' && fresh.length) {
        const [minX, minY] = getCommonBounds(fresh)
        const p = viewportCoordsToSceneCoords({ clientX: s.offsetLeft + 60, clientY: s.offsetTop + 60 }, s)
        fresh = fresh.map((e) => ({ ...e, x: e.x + (p.x - minX), y: e.y + (p.y - minY) }))
      }
      const files = Object.values(restored.files ?? {})
      if (files.length) api.addFiles(files)
      const now = Date.now()
      const dead = mode === 'replace'
        ? api.getSceneElementsIncludingDeleted().map((e) => ({ ...e, isDeleted: true, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: now }))
        : api.getSceneElementsIncludingDeleted()
      api.updateScene({
        elements: [...dead, ...fresh] as never,
        appState: {
          selectedElementIds: Object.fromEntries(fresh.map((e) => [e.id, true as const])),
          selectedGroupIds: Object.fromEntries(fresh.map((e) => e.groupIds[e.groupIds.length - 1]).filter((g): g is string => !!g).map((g) => [g, true as const])),
          editingGroupId: null,
          viewBackgroundColor: mode === 'replace' && restored.appState?.viewBackgroundColor ? restored.appState.viewBackgroundColor : s.viewBackgroundColor,
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      })
      if (fresh.length) api.scrollToContent(fresh, { fitToViewport: true, viewportZoomFactor: 0.8, animate: true })
      return fresh.length
    }
    return { api, exportBlob, thumbnail, importFile, elementCount: () => api.getSceneElements().length }
  }, [api])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const read = () => requestAnimationFrame(() => setPhone(!!el.querySelector('.excalidraw--mobile')))
    const ro = new ResizeObserver(read)
    ro.observe(el)
    read()
    return () => ro.disconnect()
  }, [])

  /** Ensancha la barra lateral de las bibliotecas arrastrando su borde izquierdo (se recuerda el ancho). */
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const box = root.current!.getBoundingClientRect()
    let last = sbWidth
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.min(Math.min(760, box.width - 320), Math.max(260, box.right - ev.clientX)))
      setSbWidth(last)
    }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.body.classList.remove('no-select')
      try {
        localStorage.setItem('nora-board-sidebar', String(last))
      } catch { /* sin almacenamiento */ }
    }
    document.body.classList.add('no-select')
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  /** Imán: igual que Alt+S de Excalidraw (y, como él, apaga la cuadrícula). */
  const toggleSnap = useCallback(() => {
    if (!api) return
    api.updateScene({ appState: { objectsSnapModeEnabled: !api.getAppState().objectsSnapModeEnabled, gridModeEnabled: false }, captureUpdate: CaptureUpdateAction.NEVER })
  }, [api])

  /** Pulsa el botón de alineación de Excalidraw (el panel de propiedades): así se mueven también el texto ligado, las flechas y los grupos. */
  const align = useCallback((label: string) => {
    const btn = root.current?.querySelector<HTMLButtonElement>(`.excalidraw button[aria-label="${label}"]`)
    if (btn) btn.click()
    else toast('No se pudo alinear. Selecciona de nuevo los elementos', 'error')
  }, [toast])

  useEffect(() => {
    onHandle(handle)
    return () => onHandle(null)
  }, [handle, onHandle])

  return (
    <div className="board-editor" ref={root} style={{ ['--nora-sb' as string]: `${sbWidth}px` }}>
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={onChange as never}
        isCollaborating
        handleKeyboardGlobally
        viewModeEnabled={!editable}
        onPointerUpdate={({ pointer, button }) => {
          board.current.pointer = pointer
          board.current.button = button
          publish()
        }}
        onLibraryChange={(items) => {
          const mine = (items as unknown as LibItem[]).filter((i) => i.status !== 'published') // las del sistema no se guardan como propias
          if (libReady.current) saveLibrary(mine)
          else try {
            localStorage.setItem(LIBRARY_KEY, JSON.stringify(mine)) // sin servidor, al menos en este navegador
          } catch { /* sin almacenamiento */ }
        }}
        langCode="es-ES"
        theme={dark ? 'dark' : 'light'}
        aiEnabled={false}
        name="Pizarra"
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true }, toggleTheme: true } }}
        renderTopRightUI={() => (
          <>
            {onShowBar && (
              <button type="button" className="board-chip on show-bar" aria-label="Mostrar la barra superior" title="Mostrar la barra superior" onClick={onShowBar}>
                <ChevronDown size={16} /><span>Barra</span>
              </button>
            )}
            {editable && (
              <button type="button" className={`board-chip ${snap ? 'on' : ''}`} aria-pressed={snap} onClick={toggleSnap}
                title="Imán: al mover o dibujar, los elementos se ajustan al centro y a los bordes de los demás y aparecen guías (Alt+S)">
                <Magnet size={15} /><span>Imán</span>
              </button>
            )}
          </>
        )}
      >
        <DefaultSidebar>
          <DefaultSidebar.TabTriggers>
            <Sidebar.TabTrigger tab="sistema"><span title="Bibliotecas del sistema" aria-label="Bibliotecas del sistema" style={{ display: 'grid', placeItems: 'center' }}><LibraryIcon size={16} /></span></Sidebar.TabTrigger>
          </DefaultSidebar.TabTriggers>
          <Sidebar.Tab tab="sistema"><SystemLibrary loading={sysLoading} groups={sysGroups} dark={dark} onInsert={insertSystem} /></Sidebar.Tab>
        </DefaultSidebar>
        <MainMenu>
          <MainMenu.Item icon={<Upload size={16} />} onSelect={onImportRequest}>Importar archivo…</MainMenu.Item>
          <MainMenu.Item icon={<FileDown size={16} />} onSelect={onSaveCopy}>Guardar copia en la sala…</MainMenu.Item>
          {editable && <MainMenu.Item icon={<Magnet size={16} />} onSelect={toggleSnap} selected={snap} shortcut="Alt+S">Imán: ajustar al centro y bordes</MainMenu.Item>}
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme onSelect={(t) => setPref(t as 'light' | 'dark')} />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
      {sbEl && !phone && createPortal(
        // dentro de la propia barra: así Excalidraw no la cierra al pulsar el asa (lo haría con un clic «fuera»)
        <div className="board-sb-handle" role="separator" aria-orientation="vertical" aria-label="Cambiar el ancho de la barra de bibliotecas" title="Arrastra para cambiar el ancho (doble clic: ancho original)"
          onPointerDown={startResize} onDoubleClick={() => { setSbWidth(302); try { localStorage.removeItem('nora-board-sidebar') } catch { /* nada */ } }} />,
        sbEl,
      )}
      {editable && !phone && sel.n > 1 && !sel.frame && (
        <div className="board-align" role="toolbar" aria-label="Alinear los elementos seleccionados" onMouseDown={(e) => e.preventDefault()}>
          <span className="board-align-title">Alinear</span>
          {ALIGN.map((a, i) => a ? (
            <button key={a.label} type="button" className="board-align-btn" aria-label={a.label} title={a.hint ? `${a.label} (${a.hint})` : a.label} onClick={() => align(a.label)}>
              <a.icon size={17} />
            </button>
          ) : <span key={`sep${i}`} className="board-align-sep" />)}
          {sel.n > 2 && (
            <>
              <span className="board-align-sep" />
              {DISTRIBUTE.map((a) => (
                <button key={a.label} type="button" className="board-align-btn" aria-label={a.label} title={a.label} onClick={() => align(a.label)}><a.icon size={17} /></button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

