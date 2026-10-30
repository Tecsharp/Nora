import type { ComponentType } from 'react'
import { CalendarDays, Clapperboard, ClipboardList, FolderOpen, KanbanSquare, Link2, Monitor, MessageSquare, PenTool, SquareCheckBig, Timer, Tv, Users, type LucideProps } from 'lucide-react'

export interface ToolDef {
  id: string
  label: string
  icon: ComponentType<LucideProps>
  group: 'work' | 'plan' | 'media' | 'live'
  hint: string
}

export const GROUPS: { id: ToolDef['group']; label: string }[] = [
  { id: 'work', label: 'Trabajo' },
  { id: 'plan', label: 'Planificación' },
  { id: 'media', label: 'Medios y enlaces' },
  { id: 'live', label: 'En directo' },
]

export const TOOLS: ToolDef[] = [
  { id: 'files', label: 'Archivos', icon: FolderOpen, group: 'work', hint: 'Sube, organiza y edita documentos' },
  { id: 'board', label: 'Pizarra', icon: PenTool, group: 'work', hint: 'Dibuja y piensa en conjunto' },
  { id: 'notes', label: 'Notas', icon: ClipboardList, group: 'work', hint: 'Notas y portapapeles de la sala' },
  { id: 'actions', label: 'Tablero', icon: KanbanSquare, group: 'plan', hint: 'Tareas con estados y responsables' },
  { id: 'calendar', label: 'Calendario', icon: CalendarDays, group: 'plan', hint: 'Eventos y recordatorios' },
  { id: 'polls', label: 'Votaciones', icon: SquareCheckBig, group: 'plan', hint: 'Decidid entre todos' },
  { id: 'media', label: 'Media Review', icon: Clapperboard, group: 'media', hint: 'Comentarios sobre vídeo, audio e imagen' },
  { id: 'player', label: 'Reproductor', icon: Tv, group: 'media', hint: 'Música y vídeo sincronizados' },
  { id: 'links', label: 'Enlaces', icon: Link2, group: 'media', hint: 'Enlaces útiles con etiquetas' },
  { id: 'chat', label: 'Chat', icon: MessageSquare, group: 'live', hint: 'Conversaciones, grupos y mensajes directos' },
  { id: 'focus', label: 'Foco', icon: Timer, group: 'live', hint: 'Pomodoro compartido' },
  { id: 'attendance', label: 'Asistencia', icon: Monitor, group: 'live', hint: 'Ver y controlar pantallas con permiso' },
]

/** Vista de personas de la sala (no es una herramienta, pero se navega igual). */
export const PEOPLE = { id: 'people', label: 'Personas', icon: Users }
export const OVERVIEW = 'overview'
