# Edición colaborativa en tiempo real (NORAINST-10)

Documentos (DOCX/ODT), hojas de cálculo (XLSX/ODS/CSV) y presentaciones (PPTX/ODP) editables por varias personas a la vez dentro de una sala de Nora, con importación y exportación de los formatos de oficina.

Este documento explica **qué se eligió y por qué**, cómo encaja todo, el protocolo, la estrategia de conversión, el plan por fases y — sin adornos — lo que **todavía no hace bien**.

---

## 1. Decisión de diseño en una página

| Pregunta | Decisión |
|---|---|
| Modelo de concurrencia | **Yjs (CRDT)** para los tres tipos. Un único protocolo y un único servidor sirven para texto, celdas y diapositivas. |
| Qué hace el servidor con los cambios | Los trata como **bytes opacos**: les asigna un número de secuencia (`seq`), los guarda, los reparte y valida permisos. No interpreta Yjs (no hay Yjs en Java), así que no hay riesgo de divergencia entre lógica de servidor y de cliente. |
| Formato «nativo» del editor | DOC = HTML de TipTap/ProseMirror · SHEET = mapa de celdas `"fila,col" → {v, f?, s?}` · SLIDES = elementos posicionados en % de la diapositiva · BOARD = un `Y.Map` de elementos de Excalidraw (ver [PIZARRA.md](PIZARRA.md)). |
| Conversión | Un **sidecar** (`converter/`, Node 22 + LibreOffice headless) sin acceso a Internet, solo alcanzable desde el backend con un token. |
| Archivo ↔ documento | **Todo documento es un archivo de la sala.** «Nuevo» crea el archivo (.docx/.xlsx/.pptx) al instante en la carpeta actual; abrir un archivo de oficina con un clic lo edita entre todos. No hay «guardar para que entre otro»: quien tenga acceso a la sala lo ve en Archivos y entra. |
| Guardar | **Guardar escribe el contenido compartido en ese archivo** (Ctrl+S). El estado («Archivo guardado hace 2 min · Ana» / «Sin guardar en el archivo») es compartido por todos. Descargar y «guardar una copia» son botones aparte. |
| Fidelidad | Se importa lo que el editor sabe representar; el archivo original solo cambia cuando alguien pulsa Guardar. |
| Permisos | Los de la sala (propietario/moderador/miembro/espectador). Solo quien puede escribir en la sala puede enviar `doc.update`; se revalida cada 5 s. |

---

## 2. Análisis por tipo de archivo y librerías

### 2.1 Documentos (DOCX / ODT)

| Opción | Pros | Contras | Veredicto |
|---|---|---|---|
| **TipTap (ProseMirror) + Yjs** (`y-prosemirror`) | Esquema estricto, colaboración y cursores maduros, extensible (tablas, imágenes, alineación…), MIT | Modelo propio: no es «Word» (sin saltos de página reales, sin cambios con control de versiones) | **Elegido** para edición |
| Mammoth | DOCX → HTML limpio y semántico | Solo importa (no exporta), descarta estilos/maquetación | No elegido |
| `docx` (npm) | Genera DOCX con control fino | Solo exporta; habría que escribir el mapeo HTML → DOCX a mano | No elegido |
| **LibreOffice headless** (filtro «HTML (StarWriter)») | Lee y escribe DOCX/ODT/DOC/RTF/PDF; mantiene tablas, listas, imágenes, alineación, fuentes | Pesado, arranque lento (se amortiza con un pool de perfiles), HTML intermedio con ruido | **Elegido** como núcleo de conversión |
| CKEditor/OnlyOffice/Collabora | Fidelidad real | Licencias (OnlyOffice/Collabora CODE son AGPL/limitados), mucha infraestructura, no integra con los permisos de Nora | Descartado por licencia y encaje |

Flujo: `DOCX/ODT → LibreOffice → HTML → tidy() → TipTap`, y a la inversa `TipTap → HTML → LibreOffice → DOCX/ODT/PDF`. `tidy()` normaliza alineación, fuentes y estilos que LibreOffice emite como atributos antiguos, e incrusta las imágenes como `data:`.

### 2.2 Hojas de cálculo (XLSX / ODS / CSV)

| Opción | Pros | Contras | Veredicto |
|---|---|---|---|
| Handsontable | Muy completo | Licencia comercial para uso no personal | Descartado |
| Luckysheet / Fortune-sheet | Casi Excel, open source | Su modelo de datos es propio y mutable; integrar CRDT por celda obliga a parchearlo; mantenimiento irregular | Descartado |
| **Rejilla propia virtualizada + `fast-formula-parser`** | Control total del modelo (1 celda = 1 clave en un `Y.Map`), CRDT limpio, solo se pinta lo visible | Hay que construir selección, edición, formato, redimensionado… | **Elegido** |
| SheetJS (community) | Lee muchos formatos | Escritura de estilos limitada en la versión libre | No elegido |
| **exceljs** | Lee y escribe XLSX con estilos, fórmulas, anchos y combinadas | Solo XLSX/CSV | **Elegido** para XLSX |
| LibreOffice | Pasa XLS/ODS ↔ XLSX y exporta PDF | Lento | Solo para ODS/XLS y PDF |

Modelo: `Y.Map` de celdas (`"r,c"`), por lo que dos personas editando celdas distintas **nunca** entran en conflicto y, en la misma celda, gana la última escritura (LWW de Yjs). Las fórmulas se guardan como texto en la celda y **se evalúan en el cliente** (evaluación perezosa con caché; ciclo → `#REF!`). El valor calculado se guarda junto a la fórmula, así XLSX/CSV salen con resultados aunque quien los abra no recalcule.

### 2.3 Presentaciones (PPTX / ODP)

El caso más difícil: no existe un editor colaborativo de diapositivas open source maduro.

| Opción | Pros | Contras | Veredicto |
|---|---|---|---|
| Editor propio (DOM con elementos posicionados) + Yjs | Cada elemento es un `Y.Map` y su texto un `Y.Text`: arrastrar/redimensionar y editar texto se fusionan bien | Hay que escribir el editor y el mapeo de formato | **Elegido** |
| **Parser PPTX propio** (`jszip` + `fast-xml-parser`) | Permite herencia de marcadores de posición y colores de tema, que LibreOffice aplana | Cubre un subconjunto de PPTX | **Elegido** para importar PPTX |
| **pptxgenjs** | Genera PPTX limpios con texto, formas e imágenes | Solo exporta | **Elegido** para exportar PPTX |
| LibreOffice | ODP ↔ PPTX, PDF | Importar PPTX → ODP → modelo propio pierde la herencia | Solo ODP/PDF |

### 2.4 Transporte y sincronización

Se reutiliza el **WebSocket `/ws` de Nora** (un solo canal por pestaña) en vez de añadir Socket.IO o `y-websocket`: ya trae ticket de un solo uso, comprobación de origen, límites de tasa y reconexión. Se añadió un presupuesto de mensajes aparte para `doc.*` (1500/10 s) y un búfer de texto de 2 MB.

---

## 3. Arquitectura unificada

```
 Navegador A ─┐                                         ┌──────────────┐
  TipTap/Hoja/│  WS /ws  (doc.*)      ┌──────────────┐  │  Postgres    │
  Diapositivas│ ───────────────────▶ │  Backend     │─▶│ collab_docs  │
  + Yjs       │ ◀─────────────────── │  Spring Boot │  │ collab_updates│
 Navegador B ─┘  REST /api/rooms/..   │  CollabWs    │  │ collab_versions│
                                      │  CollabService│ └──────────────┘
                                      └──────┬───────┘
                                             │ HTTP interno + X-Converter-Token
                                      ┌──────▼───────┐        ┌─────────┐
                                      │  converter   │        │ Garage  │ ← archivos de la sala
                                      │ Node+LibreOff│        │  (S3)   │   (original / exportados)
                                      └──────────────┘        └─────────┘
```

* **Un «documento colaborativo» (`collab_docs`)** pertenece a una sala y tiene un `kind` (`DOC|SHEET|SLIDES`). Puede nacer en blanco o de un archivo de la sala (`source_file_id`, **único por sala**).
* **Registro de cambios** (`collab_updates`): `(doc_id, seq, data)`. Una **instantánea** (`snapshot`, `snapshot_seq`) subida por un cliente compacta el registro: abrir un documento = instantánea + cambios con `seq` mayor.
* **Orden:** el reparto se hace dentro de un cerrojo por documento, así que el orden de `seq` es el orden de entrega a todos. Cada cliente lleva un contador de huecos; si detecta un hueco o Yjs deja cambios pendientes por dependencias, vuelve a descargar el estado.
* **Confirmación:** `doc.ack{seq,ref}`. Mientras no llegue, el cliente conserva el cambio y lo reenvía (aplicar un cambio Yjs dos veces es inocuo).
* **Sin conexión:** los cambios locales quedan en cola y se envían al reconectar tras volver a descargar el estado. El indicador muestra «Sin conexión / Sincronizando / Todos los cambios guardados».
* **Presencia** (`doc.awareness`): protocolo de awareness de Yjs, solo reenviado, nunca guardado. En documentos: cursor y selección con nombre y color; en hojas: celda seleccionada de cada persona; en diapositivas: elemento seleccionado. `doc.peer.left` limpia los fantasmas.
* **Siembra del contenido importado:** al abrir un archivo, el backend convierte **una vez** y guarda el resultado en `seed_content`. Exactamente **un** cliente lo escribe en el documento Yjs: `POST /seed/claim` hace una reclamación atómica en SQL (`PENDING→CLAIMED→DONE`, caduca a los 60 s si quien reclamó se cae, idempotente para la misma persona) y solo quien reclamó puede llamar a `/seed/done`. Los demás ven «Preparando el documento…» y reciben el contenido por el canal normal. Así no hay contenido duplicado aunque diez personas abran el mismo archivo a la vez.
* **Versiones** (`collab_versions`, se conservan 40): automática cada 10 min si hubo cambios (la hace el cliente «líder» = menor `clientID` presente) y manual con nombre. Restaurar **no** borra historial: se reescribe el contenido como un cambio normal de Yjs (y por tanto se puede deshacer).
* **Deshacer/rehacer:** `Y.UndoManager` (en TipTap vía la extensión de colaboración): cada persona deshace **solo sus cambios**.
* **Guardado y estado del archivo:** `POST /export?save=file&seq=N` convierte el contenido que envía el cliente y **reemplaza el archivo de la sala** (misma entrada); el servidor anota `saved_seq`, `saved_at` y `saved_by` y avisa a todos con el evento `doc.saved`. Un cliente compara su último cambio recibido con `saved_seq` para saber si el archivo está al día. Si el archivo es de un formato antiguo (`.doc`, `.xls`, `.ppt`, `.rtf`, `.tsv`) se escribe un archivo nuevo en el formato moderno y el documento pasa a usarlo; el original no se toca. `save=new` guarda una copia con otro formato; `save=none` solo descarga.
* **Ciclo de vida:** borrar el archivo (o su carpeta) en Archivos borra su documento y avisa a quien lo tenía abierto. Renombrar desde el editor renombra el archivo. Al cerrar con cambios sin guardar y siendo la última persona dentro, el editor ofrece «Guardar y cerrar»; si hay más gente dentro no molesta (el documento compartido conserva todo).

### 3.1 Permisos

| Rol en la sala | Ver | Editar | Exportar/Guardar en sala | Borrar/renombrar |
|---|---|---|---|---|
| Espectador | ✔ (editor en solo lectura, ve cursores) | ✘ | descargar ✔ | ✘ |
| Miembro | ✔ | ✔ | ✔ | solo lo suyo |
| Moderador / propietario | ✔ | ✔ | ✔ | todo |

El servidor decide `canEdit` en `doc.joined`, rechaza `doc.update` sin permiso y **vuelve a comprobar cada 5 s** (si cambian el rol a alguien, el editor pasa a solo lectura sin recargar). No se confía en la interfaz.

---

## 4. Esquema de mensajes

JSON sobre el WebSocket existente. Los cuerpos Yjs viajan en base64.

```
cliente → servidor
  doc.join       {docId}
  doc.leave      {docId}
  doc.update     {docId, update, ref}           # solo con permiso de edición
  doc.awareness  {docId, update, clientId}      # presencia (efímera)

servidor → cliente
  doc.joined     {docId, seq, canEdit, peers[]}
  doc.update     {docId, seq, update, userId}
  doc.ack        {docId, seq, ref}
  doc.awareness  {docId, update, clientId, userId}
  doc.peer.left  {docId, clientIds[]}
  doc.error      {docId, message, status}
  # eventos de sala (para la lista de documentos)
  doc.created / doc.renamed / doc.deleted / doc.seeded / doc.saved{…,savedSeq,savedAt,savedByName}
```

REST (`/api/rooms/{code}/docs`):

| Método y ruta | Uso |
|---|---|
| `GET /`, `POST /` | Listar / crear (`{kind,name,folderId?}`): crea el archivo en blanco en la sala y su documento |
| `POST /from-file/{fileId}` | Abrir un archivo de oficina de la sala (convierte y deja listo para sembrar; idempotente, índice único por archivo). Un lector solo puede abrir lo que ya se abrió para editar |
| `GET/PATCH/DELETE /{id}` | Ficha, renombrar, borrar |
| `GET /{id}/state` | Instantánea + cambios (base64) + estado de siembra |
| `POST /{id}/seed/claim`, `/seed/done` | Siembra del contenido importado |
| `PUT /{id}/snapshot?upToSeq=N` | Compactación (cuerpo binario Yjs) |
| `GET/POST /{id}/versions`, `GET /{id}/versions/{v}` | Historial |
| `POST /{id}/export?save=file|new|none&format=&seq=` | `file` = Guardar en el archivo (formato del propio archivo) · `new` = copia en la sala · `none` = descarga |

API interna del conversor (`converter/`, cabecera `X-Converter-Token`): `POST /v1/import?ext=` (archivo → modelo nativo JSON), `POST /v1/export?kind=&format=` (modelo nativo → archivo). Solo en la red interna de Docker; sin Internet.

---

## 5. Estrategia de conversión y fidelidad

| Tipo | Importa | Exporta | Se conserva | Se pierde / aproxima |
|---|---|---|---|---|
| DOCX/ODT | LO → HTML → `tidy()` | HTML → LO | Títulos, párrafos, negrita/cursiva/subrayado/tachado, sub/superíndice, **fuente y tamaño**, interlineado, sangría, listas, tablas (fusión de celdas y color de fondo), imágenes (con ancho), alineación y color; **gráficos como imagen** | Cabeceras/pies, saltos de página, columnas, notas al pie, campos, cambios controlados, formas flotantes, estilos con nombre. Un gráfico insertado aquí solo se vuelve a editar mientras siga en el documento: en el DOCX es una imagen |
| XLSX | exceljs | exceljs | Valores, **fórmulas**, formato (negrita/cursiva/subrayado/tachado, fuente y tamaño, colores, alineación horizontal y vertical, bordes, formatos numéricos), anchos, combinadas, fila fijada, varias hojas; **los gráficos que se crean aquí viajan como imagen** | Los gráficos, imágenes y tablas dinámicas **que ya traía el XLSX original** (exceljs no los lee: se pierden al guardar encima), formato condicional, validación, macros, ajuste de texto |
| ODS/XLS | LO → XLSX → exceljs | ídem → LO | Lo mismo que XLSX | Lo mismo |
| CSV | Parser propio (comillas, `;`/`,`) | Primera hoja | Valores | Fórmulas como texto, otras hojas |
| PPTX | Parser XML propio (herencia de marcadores de posición, colores de tema) | pptxgenjs | **Texto con formato por fragmentos** (negrita, color, tamaño, fuente, listas, alineación), 14 tipos de forma con relleno/contorno/opacidad/giro, líneas, imágenes, **tablas**, **gráficos nativos** (columnas, barras, líneas, áreas, circular, anillo), notas del orador, fondos, orden | Animaciones, transiciones, SmartArt, vídeo/audio, patrones de diapositiva, formas personalizadas (se aproximan a rectángulos), viñetas heredadas del patrón |
| ODP | LO → PPTX → parser | ídem → LO | Lo mismo que PPTX | Lo mismo |
| PDF | — | LO | Salida de lectura | — |

Principios:
1. **El original no se toca** salvo orden explícita («sobrescribir»). La opción por defecto al guardar es crear un archivo nuevo.
2. **Importar una sola vez** y sembrar con un único cliente (ver §3).
3. Lo que el editor no representa se **descarta de forma visible en este documento**, no en silencio en el código: si la fidelidad es crítica, conserve el original y use «Guardar como nuevo».
4. Límite de 40 MB para editar; imágenes incrustadas en el documento (ver riesgos).

---

## 6. Código de ejemplo (dónde mirar)

| Pieza | Archivo |
|---|---|
| Protocolo y reparto en el servidor | `backend/src/main/java/com/nora/collab/CollabWs.java`, `CollabService.java` |
| Siembra atómica, snapshots, versiones | `CollabRepository.java` (SQL), `db/migration/V7__collab_docs.sql`, `V8__…` |
| Proveedor Yjs ↔ WebSocket (cola, ack, reconexión) | `frontend/src/collab/provider.ts` |
| Editor de documentos | `frontend/src/collab/TextEditor.tsx`, `textExtras.ts` (tamaño de letra, interlineado, sangría, gráfico, buscar/reemplazar) |
| Editor de hojas | `frontend/src/collab/SheetEditor.tsx`, `SheetRibbon.tsx`, `sheetModel.ts`, `refs.ts` (referencias A1, ajuste y copia de fórmulas), `formulas.ts` |
| Editor de diapositivas | `frontend/src/collab/SlidesEditor.tsx`, `SlidesRibbon.tsx`, `SlideRender.tsx`, `slidesModel.ts`, `richtext.ts` (limpieza del HTML compartido) |
| Gráficos y barra de herramientas común | `frontend/src/collab/chart.tsx`, `ui.tsx` |
| Conversión | `converter/src/{lo,doc,sheet,slides,server}.mjs` |

---

## 7. Plan por fases

| Fase | Contenido | Estado |
|---|---|---|
| 1 — MVP | Protocolo `doc.*`, persistencia con `seq`, documentos TipTap + Yjs, cursores, solo lectura, conversor DOCX/ODT/PDF | ✔ |
| 2 — Hojas | Rejilla virtualizada, fórmulas, presencia por celda, XLSX/ODS/CSV | ✔ |
| 3 — Diapositivas | Editor propio, importación PPTX/ODP, exportación PPTX/ODP/PDF, modo presentación | ✔ (subconjunto) |
| 4 — Operación | Compactación, versiones, siembra segura, límites de tasa, revalidación de permisos | ✔ |
| 5 — Herramientas de oficina | Cinta de opciones por tipo (Inicio/Insertar/…): documentos con fuente, tamaño, interlineado, sangría, tablas completas, gráficos, buscar y reemplazar, esquema y zoom · hojas con formato completo, bordes, combinar, insertar/eliminar filas y columnas con ajuste de fórmulas, ordenar, fijar fila, relleno, autosuma, biblioteca de funciones (nombres en español), gráficos, buscar, estadísticas de selección · diapositivas con texto enriquecido, formas, tablas, gráficos, giro, alineación, selección múltiple, guías de alineación, notas y diseños | ✔ |
| 6 — Siguientes | Comentarios y sugerencias · formato condicional y validación de datos en hojas · transiciones y animaciones · ajuste de texto y altura de fila en hojas · pruebas con documentos reales de usuarios | Pendiente |
| 7 — Escala | Varias instancias del backend (hoy el reparto es en memoria: hace falta un bus, p. ej. Postgres `LISTEN/NOTIFY` o Redis) | Pendiente |

---

## 8. Riesgos y limitaciones (honestos)

1. **Fidelidad de conversión.** Un DOCX complejo (columnas, cabeceras, campos, formas) no sobrevive a ida y vuelta. Es una limitación del enfoque «editor propio + LibreOffice», no un bug puntual. Mitigación: el original se conserva y «sobrescribir» es una acción explícita.
2. **PPTX/ODP.** Subconjunto: texto enriquecido, 14 formas, imágenes, tablas, gráficos y notas. Sin animaciones, transiciones ni SmartArt; las formas personalizadas se aproximan. Cada cuadro de texto tiene su propio editor TipTap enlazado a un fragmento Yjs, mientras que el HTML resultante se guarda en el elemento para mostrarlo y exportarlo: si dos personas empiezan a editar exactamente a la vez el mismo cuadro, el texto inicial podría duplicarse (poco probable). Al restaurar una versión, los fragmentos se regeneran desde el HTML.
3. **Fórmulas.** `fast-formula-parser` cubre la gran mayoría de funciones de Excel, pero no todas; las desconocidas muestran un error en vez de un valor falso. Dos personas editando la misma celda: gana la última. **Insertar o eliminar filas/columnas** reescribe las claves de las celdas y ajusta las fórmulas de todo el libro, las combinaciones y los gráficos en una sola transacción; si dos personas insertan filas a la vez en la misma hoja el resultado es la suma de ambos cambios, pero una edición de celda concurrente a esa operación puede quedar desplazada una fila. Ordenar mueve filas con sus fórmulas (se trasladan las referencias relativas a la misma fila). No hay ajuste de texto ni altura de fila variable.
4. **CSV** exporta solo la primera hoja.
5. **Tamaño.** El documento completo vive en memoria del navegador y las imágenes se incrustan en Yjs (base64): documentos con muchas imágenes grandes serán lentos y pesarán en cada instantánea. Límite de 40 MB al abrir.
6. **Confianza en las instantáneas.** El servidor no entiende Yjs, así que acepta la instantánea de un cliente con permiso de edición. Un miembro malicioso puede subir una instantánea vacía o corrupta. Mitigaciones: solo quien puede editar, solo hasta un `seq` ya visto, y el historial de versiones permite recuperar. No protege frente a un miembro editor hostil (eso ya podría borrar el contenido editando).
7. **CSP.** Para que TipTap conserve la alineación importada hay que permitir `style-src-attr 'unsafe-inline'` en el gateway. Es un compromiso aceptado: el HTML pasa por el esquema de ProseMirror, que solo admite atributos conocidos, y los scripts siguen prohibidos.
8. **LibreOffice.** La imagen del conversor pesa ~700 MB y LibreOffice procesa archivos no confiables. Por eso el contenedor es de solo lectura, sin Internet (red interna), usuario sin privilegios, con límite de memoria (1,5 GB), 2 procesos a la vez y 90 s de tiempo máximo por conversión.
9. **Un solo backend.** El reparto en tiempo real es en memoria (como el resto de eventos de Nora). Escalar horizontalmente requiere un bus de mensajes (fase 6).
10. **Imagen Docker del conversor sin construir en el entorno de desarrollo.** El conversor se probó con LibreOffice instalado localmente y el backend/frontend contra él, pero el `Dockerfile` y el servicio de `docker-compose.yml` no se pudieron ejecutar allí: la primera construcción real de la imagen ocurrirá en su servidor.

## 9. Despliegue

```bash
git fetch && git checkout feature/extensionSupportEdit && git pull
./setup.sh                      # añade NORA_CONVERTER_TOKEN a .env si falta (en Windows: setup.ps1)
docker compose up -d --build    # construye el servicio «converter»; las migraciones V7 y V8 se aplican solas
```
