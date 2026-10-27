import type { Elem } from './slidesModel'

type Layout = { id: string; label: string; make: () => Omit<Elem, 'id'>[] }

const title = (o: Partial<Elem> = {}): Omit<Elem, 'id'> => ({ type: 'text', x: 7, y: 8, w: 86, h: 18, html: '<p>Título</p>', fontSize: 40, bold: true, color: '#111827', align: 'left', valign: 'middle', ...o })
const body = (o: Partial<Elem> = {}): Omit<Elem, 'id'> => ({ type: 'text', x: 7, y: 30, w: 86, h: 60, html: '<ul><li><p>Primer punto</p></li><li><p>Segundo punto</p></li><li><p>Tercer punto</p></li></ul>', fontSize: 24, color: '#1f2937', align: 'left', valign: 'top', ...o })

export const LAYOUTS: Layout[] = [
  { id: 'title', label: 'Portada', make: () => [
    title({ x: 10, y: 30, w: 80, h: 22, fontSize: 54, align: 'center', html: '<p>Título de la presentación</p>' }),
    body({ x: 15, y: 56, w: 70, h: 14, fontSize: 24, align: 'center', color: '#4b5563', html: '<p>Subtítulo</p>', valign: 'top' }),
  ] },
  { id: 'content', label: 'Título y contenido', make: () => [title(), body()] },
  { id: 'two', label: 'Dos columnas', make: () => [
    title(), body({ x: 7, w: 41, html: '<ul><li><p>Punto</p></li><li><p>Punto</p></li></ul>' }), body({ x: 52, w: 41, html: '<ul><li><p>Punto</p></li><li><p>Punto</p></li></ul>' }),
  ] },
  { id: 'titleonly', label: 'Solo título', make: () => [title()] },
  { id: 'section', label: 'Encabezado de sección', make: () => [title({ y: 38, h: 24, fontSize: 48, html: '<p>Nueva sección</p>' })] },
  { id: 'blank', label: 'En blanco', make: () => [] },
]
