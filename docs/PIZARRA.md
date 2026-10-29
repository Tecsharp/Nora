# Pizarra colaborativa (NORAINST-13)

La herramienta **Pizarra** de cada sala es un lienzo infinito para dibujar, esquematizar y pensar entre todos en tiempo real. Usa **Excalidraw** (el componente oficial, licencia MIT) como editor y la infraestructura colaborativa que Nora ya tenía para documentos (WebSocket + Yjs), de modo que la experiencia es la de Excalidraw con las personas de la sala dentro.

## Qué incluye

**Herramientas de dibujo (las de Excalidraw):** selección, mano, rectángulo, rombo, elipse, flecha (recta, curva y en ángulo, ligada a las formas), línea, dibujo libre, texto, imágenes, borrador, marcos, láser y generador de diagramas desde texto (Mermaid, funciona sin Internet); propiedades de cada elemento (trazo, relleno, estilo de trazo y de bordes, grosor, opacidad, tipo y tamaño de fuente, puntas de flecha, capas), agrupar, alinear y distribuir, duplicar, bloquear, copiar y pegar, deshacer/rehacer, zoom y desplazamiento, cuadrícula, ajuste a objetos, buscar en el lienzo, atajos de teclado, modo zen, biblioteca de elementos (se conserva en el navegador y admite `.excalidrawlib`), fondo del lienzo y tema claro/oscuro (va junto al tema de Nora).

**Alinear y centrar elementos:**
- **Imán (activado por defecto)**: al mover, redimensionar o dibujar una figura, un texto o una imagen, se ajusta al **centro y a los bordes** de los demás elementos y aparecen guías (líneas discontinuas), así que las cajas que dibujes quedan alineadas al medio sin esfuerzo. Se enciende y apaga con el botón **Imán** (arriba a la derecha), con la opción «Imán» del menú principal o con **Alt+S**; tu elección se recuerda en el navegador. Mantener **Ctrl/⌘** mientras arrastras lo invierte solo en ese gesto. Con la cuadrícula activa el imán se apaga (como en Excalidraw).
- **Barra «Alinear»**: al seleccionar **dos o más** elementos aparece abajo, en el centro, con izquierda / **centrar horizontalmente** / derecha, superior / **centrar verticalmente** / inferior y, con tres o más, **distribuir** horizontal y verticalmente. Centrar horizontalmente pone todos en la misma línea central vertical (quedan «en columna»); centrar verticalmente, en la misma línea central horizontal (quedan «en fila»). Es el mismo mecanismo de Excalidraw (pulsa sus botones), así que mueve también el texto de dentro de las formas, las flechas ligadas y los grupos, y se deshace con Ctrl+Z. En el diseño de móvil de Excalidraw (pantalla muy estrecha) la barra no se ofrece: se alinea desde el panel de propiedades (icono de la paleta).

**Tamaño del editor:** en la cabecera hay dos botones. **↗↙ «Ocupar toda la ventana»** quita los bordes y el límite de ancho para que el editor llene la ventana del navegador (se recuerda). Con la ventana ampliada o en pantalla completa aparece **⌃ «Ocultar la barra superior»** (nombre, guardar, descargar…) para ganar altura; se vuelve a mostrar con el botón «Barra» que queda junto al imán (en los demás editores, con un asa arriba en el centro), y al volver al tamaño normal la barra reaparece. **⛶ «Pantalla completa»** pone toda la página en pantalla completa del sistema (también sin bordes) y vuelve con el mismo botón o con Esc; al cerrar el editor se sale sola. Se usa la página entera para que los avisos y diálogos de Nora sigan viéndose. Están en todos los editores. En iPhone el navegador no permite pantalla completa y ese botón no aparece.

**Colaboración:**
- Los cambios de cada persona llegan a las demás en décimas de segundo, también el borrado y el deshacer.
- **Cursores con nombre y color**, selecciones ajenas, puntero láser y lista de personas en la pizarra.
- **Seguir a otra persona**: al pulsar su avatar tu vista reproduce la suya (desplazamiento y zoom).
- Permisos de la sala: el lector ve la pizarra en directo, pero no puede dibujar.
- Deshacer es **personal**: cada uno deshace solo lo suyo.
- Funciona con varias pestañas y con cortes de conexión (los cambios se reenvían al reconectar).

**Guardar, exportar e importar:**
| Acción | Dónde | Qué hace |
|---|---|---|
| Autoguardado | siempre | Cada movimiento se guarda al instante en el documento compartido (como Miro) **y**, un segundo después de que haces una pausa (o como mucho cada 10 s mientras dibujas sin parar), se escribe también en su archivo **`.excalidraw`** de Archivos. Lo hace una sola persona (la «líder»), no todas a la vez. Al cerrar se termina de guardar: **en una pizarra no existe «cerrar sin guardar»**, no hay nada que descartar. |
| **Guardar** (Ctrl+S) | cabecera | Fuerza el guardado en el archivo ahora mismo y crea un punto en el historial. El indicador muestra «Guardando…» o «Archivo guardado hace…». |
| **Descargar** | cabecera | `.excalidraw` (pizarra editable), **PNG** (con la escena incrustada: se puede volver a importar), **SVG** (vectorial, también con la escena) y **PDF**. |
| **Guardar una copia en la sala** | menú «⋯» | Guarda un `.excalidraw`, PNG o SVG nuevo en Archivos. |
| **Exportar imagen…** | menú de Excalidraw | El diálogo de Excalidraw (solo selección, fondo, tema oscuro, escala 1×/2×/3×, copiar al portapapeles). |
| **Importar** | galería o menú «⋯» | Lee un `.excalidraw`/`.json`, un PNG o SVG con la escena incrustada o una imagen suelta. Dentro de una pizarra se elige **añadir** (aparece donde estás mirando, ya seleccionado) o **reemplazar todo**; ambas se pueden deshacer. |
| **Historial** | cabecera | Versiones automáticas (cada 10 min) y manuales; restaurar una versión es un cambio más (todos la reciben y se puede deshacer). |
| Abrir desde Archivos | un clic | Cualquier `.excalidraw` de la sala se abre como pizarra colaborativa. |
| Galería | herramienta **Pizarra** | Miniaturas, nueva pizarra, importar, renombrar, mover y borrar. El menú «⋯» de cada tarjeta también permite **descargar** (`.excalidraw`, PNG, SVG o PDF) sin abrir la pizarra, también a los lectores; se descarga lo último guardado en su archivo (el autoguardado se hace en segundos). |
| **Carpetas** | galería | Pestañas «Todas», «Sin carpeta» y una por carpeta, igual que las categorías de Notas: crear, renombrar y borrar carpetas (borrar una carpeta borra sus pizarras y sus archivos `.excalidraw`), mover una pizarra desde el menú «⋯» → «Mover a», y «Nueva pizarra»/«Importar» crean dentro de la carpeta que estás viendo. Todos las ven en vivo. |

Una pizarra, como cualquier otro documento de Nora, **es un archivo de la sala**: «Nueva pizarra» crea `Pizarra sin título.excalidraw` en Archivos; borrar el archivo borra la pizarra y renombrar una renombra la otra.

## Cómo funciona

```
 Excalidraw (navegador A) ──onChange──▶ Y.Map «b:el» (id → elemento) ──▶ WebSocket /ws (doc.update) ──▶ servidor (bytes opacos, orden, permisos)
        ▲                                        ▲                                                            │
        └──reconcileElements◀─────Y.Map observe──┴──────────────────── doc.update de B, C… ◀────────────────┘
```
- **Modelo (`boardModel.ts`)**: un `Y.Map` con un valor por elemento (el JSON del elemento de Excalidraw, entero), otro con las imágenes (`id → dataURL`) y otro con el fondo/cuadrícula. El orden de apilado es el `index` fraccionario que Excalidraw asigna a cada elemento.
- **Escena → Yjs**: cada cambio local se compara con la última versión (`version` + `versionNonce`) ya enviada de cada elemento; solo se escribe lo que cambió, sin espera, y el proveedor lo envía a los 8 ms (los demás documentos agrupan 120 ms). Al arrastrar, los demás ven el movimiento con un retraso de un fotograma más la red. Se clona el elemento antes de guardarlo (Excalidraw lo muta en sitio).
- **Yjs → escena**: solo se reconcilian los elementos que cambiaron (no toda la pizarra) y se aplican en el siguiente fotograma, o a los 50 ms si el navegador no da fotogramas (pestaña oculta o tapada); lo remoto se reconcilia con `reconcileElements` de Excalidraw, la **misma lógica de su colaboración oficial** (gana la versión mayor y se respeta lo que estás editando en ese momento). No pasa por el historial local.
- **Borrado**: los elementos borrados se quedan como lápidas (`isDeleted`) para que el borrado se propague y se pueda restaurar; las de más de una semana se limpian al abrir.
- **Presencia**: cursor, botón, selección y centro/zoom de la vista viajan por el *awareness* del documento (hasta ~60 mensajes/s por persona).
- **Imágenes**: se sincronizan como `dataURL` en un mensaje; si pesan más de ~1,1 M caracteres se reducen (WebP) para la copia compartida (quien la insertó conserva la original).
- **Servidor**: la pizarra es el cuarto tipo de documento (`BOARD`). Valida el `.excalidraw` que entra o sale (JSON con lista de `elementos`, máximo 50 000, y solo conserva elementos, imágenes y fondo/cuadrícula; descarta el estado de la vista de quien lo guardó). No necesita el conversor de oficina. Miniaturas: `PUT/GET /docs/{id}/thumbnail` (JPEG/PNG/WebP ≤ 200 KB, solo quien puede escribir la sube).
- **Sin Internet**: las fuentes de Excalidraw se copian junto a la aplicación (`/excalidraw-assets/`) y se descarta su copia de respaldo en `esm.sh`; la CSP del gateway no se ha relajado.

## Limitaciones conocidas
- **Sin edición simultánea carácter a carácter dentro de un mismo texto**: como en Excalidraw, cada elemento se sincroniza entero; si dos personas editan **el mismo texto a la vez**, gana la última versión (el resto de elementos no tienen conflictos).
- **Fuentes subconjuntadas en SVG**: el navegador bloquea `eval` (CSP), así que el SVG exportado incrusta las fuentes completas en vez de solo los glifos usados (el archivo pesa más, pero se ve igual).
- **Funciones de Excalidraw+ o de servicios externos** no están: compartir por enlace de excalidraw.com, la biblioteca pública (se abre en otra pestaña), el diagrama por IA y las páginas web incrustadas (la opción «Incrustar web» aparece en el menú de herramientas, pero la política de seguridad de Nora no deja cargar sitios externos).
- **Imágenes en modo oscuro**: Excalidraw invierte todo el lienzo en el tema oscuro y corrige las imágenes con `context.filter` del canvas; Safari no lo soporta y una captura oscura aparecía en blanco. Nora incluye un relleno (`canvasFilter.ts`) que emula ese filtro solo en los navegadores que no lo tienen, de modo que las imágenes se ven igual que en Chrome o Firefox y sus colores no se tocan en el archivo guardado. Se comprobó con Chromium simulando la falta del filtro; no se ha probado con un WebKit real.
- **Rendimiento**: probado con cientos de elementos; las pizarras con decenas de miles de elementos o muchas imágenes grandes serán más lentas (el documento completo vive en el navegador).
- El deshacer de Excalidraw es por sesión: después de cerrar y abrir la pizarra no se puede deshacer lo anterior (sí restaurar una versión del historial).
