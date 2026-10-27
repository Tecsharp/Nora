import type { Room, User } from './api'

export type RoomRole = 'OWNER' | 'MODERATOR' | 'MEMBER' | 'VIEWER'

export const ROLE_LABEL: Record<RoomRole, string> = {
  OWNER: 'Propietario',
  MODERATOR: 'Moderador',
  MEMBER: 'Colaborador',
  VIEWER: 'Lector',
}

export const ROLE_HINT: Record<RoomRole, string> = {
  OWNER: 'Control total de la sala',
  MODERATOR: 'Gestiona el contenido de cualquiera',
  MEMBER: 'Sube y edita su propio contenido',
  VIEWER: 'Solo ve y descarga',
}

/** Roles que el propietario puede asignar. */
export const ASSIGNABLE: RoomRole[] = ['MODERATOR', 'MEMBER', 'VIEWER']

/** Puede gestionar el contenido de otras personas (propietario, moderador o administrador del sistema). */
export const isStaff = (room: Room, user: User | null | undefined) =>
  user?.role === 'ADMIN' || room.role === 'OWNER' || room.role === 'MODERATOR'

/** Puede subir y crear contenido (todos menos los lectores). */
export const canWrite = (room: Room, user: User | null | undefined) => user?.role === 'ADMIN' || room.role !== 'VIEWER'
