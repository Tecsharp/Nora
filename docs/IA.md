# IA con DeepSeek

Nora puede ofrecer ayuda de IA (resumir, mejorar, traducir, extraer tareas, crear eventos desde texto…) usando **DeepSeek**. Viene **desactivada**: mientras no se active a mano, la
interfaz no muestra ninguna función de IA.

## Activarla

En el `.env` del servidor (se crea con `./setup.sh`; las variables ya vienen ahí, apagadas):

```
NORA_AI_ENABLED=true
NORA_DEEPSEEK_API_KEY=sk-…        # clave de https://platform.deepseek.com
NORA_DEEPSEEK_MODEL=deepseek-chat # o deepseek-reasoner
NORA_AI_USER_LIMIT_PER_HOUR=60    # usos por persona y hora
```

y `docker compose up -d`. En Administración → Ajustes se ve si está activa. Sin clave o con `NORA_AI_ENABLED=false` todo sigue como antes.

## Qué se envía y qué no

- La **clave solo vive en el servidor**; el navegador nunca la ve.
- Solo se llama a DeepSeek cuando alguien **pulsa un botón de IA**, y se envía únicamente el texto que esa persona decide procesar (la selección, la nota, el chat, la lista de comentarios…). Nada se envía solo.
- El servidor no guarda ni registra ese contenido. DeepSeek es un servicio externo: quien administra Nora debe tener claro qué se puede enviar fuera.
- Límites: texto máximo (`NORA_AI_MAX_INPUT_CHARS`, 30 000), respuesta máxima (`NORA_AI_MAX_OUTPUT_TOKENS`), usos por hora por persona y 3 peticiones simultáneas.

## Dónde aparece

| Herramienta | Qué hace la IA |
| --- | --- |
| Notas y Documentos | Mejorar, corregir, acortar, ampliar, cambiar el tono, continuar, traducir, resumir, puntos clave, explicar, acta de reunión, instrucción libre. Actúa sobre la selección o todo el texto y puede reemplazar o insertar debajo. |
| Chat | Resume la conversación (decisiones y pendientes). |
| Acciones | Genera tareas desde un texto (notas de reunión) y la descripción + checklist de una tarea. |
| Votaciones | Propone opciones a partir de la pregunta y resume el resultado. |
| Calendario | Crea un evento desde una frase («mañana a las 5 reunión con Ana»). |
| Media Review | Resume los comentarios en una lista de cambios. |

## Técnica

`POST /api/ai/run {task, text, language?, instruction?, now?}` responde en streaming (`text/event-stream`: `{"d": trozo}` … `{"done": true}` o `{"error": mensaje}`).
Las instrucciones de cada tarea viven en el servidor (`AiService`): el texto del usuario va siempre como datos entre `<texto>…</texto>` y nunca puede reescribir la instrucción.
`GET /api/ai/status` dice si está activa (el frontend lo consulta al iniciar sesión).
