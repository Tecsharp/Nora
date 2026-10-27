package com.nora.room;

/**
 * Rol de un participante dentro de una sala. El propietario es implícito (no se asigna):
 * <ul>
 *   <li>VIEWER: solo ve y descarga.</li>
 *   <li>MEMBER: además sube, crea carpetas y notas, y gestiona lo suyo.</li>
 *   <li>MODERATOR: además gestiona el contenido de cualquiera.</li>
 * </ul>
 */
public enum RoomRole { VIEWER, MEMBER, MODERATOR }
