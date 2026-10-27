#!/usr/bin/env node
// Verificación de punta a punta de la limpieza de Garage, sobre una instalación real con Docker Compose:
//   - borrar un archivo, una carpeta o cerrar una sala elimina sus objetos de Garage,
//   - una sala que expira se limpia sola (tarea automática),
//   - si Garage no responde al borrar, el borrado queda pendiente y se completa cuando vuelve,
//   - un objeto huérfano (sin fila en la base de datos) lo detecta y borra la limpieza.
//
// Uso (desde la carpeta del proyecto, con Nora en marcha):
//   NORA_ADMIN_EMAIL=... NORA_ADMIN_PASSWORD=... node scripts/verify-garage-cleanup.mjs
// Variables opcionales: BASE (por defecto http://localhost:29817), SKIP_EXPIRY=1 (omite la espera de ~1 min de la expiración).
// Crea salas de prueba con la cuenta de administrador y las elimina al terminar. Para el fallo de Garage hace
// `docker compose stop garage` / `start garage` unos segundos.
import { execSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://localhost:29817'
const J = { 'Content-Type': 'application/json' }
let fails = 0
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sql = (q) => execSync(`docker compose exec -T db psql -U nora -d nora -tAc "${q}"`).toString().trim()
const api = async (t, path, method = 'GET', body) => {
  const r = await fetch(BASE + '/api' + path, { method, headers: { ...J, ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }
}
const login = async (e, p) => (await api(null, '/auth/login', 'POST', { email: e, password: p })).body.accessToken
const A = await login(process.env.NORA_ADMIN_EMAIL, process.env.NORA_ADMIN_PASSWORD)
if (!A) { console.error('Define NORA_ADMIN_EMAIL y NORA_ADMIN_PASSWORD'); process.exit(2) }
const U = A // el administrador crea y borra las salas de prueba
const stats = async () => (await api(A, '/admin/storage')).body
const waitStats = async (pred, ms = 20000) => { const t = Date.now(); let s; while (Date.now() - t < ms) { s = await stats(); if (pred(s)) return s; await sleep(500) } return s }
const upload = async (t, code, name, size, folderId) => {
  const s = await api(t, `/rooms/${code}/uploads`, 'POST', { name, size, fingerprint: name + size + Math.random(), folderId })
  const r = await fetch(`${BASE}/api/rooms/${code}/uploads/${s.body.id}/parts/1`, { method: 'PUT', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(size, 7) })
  if (r.status !== 204) throw new Error('part ' + r.status)
  return (await api(t, `/rooms/${code}/uploads/${s.body.id}/complete`, 'POST')).body
}
const newRoom = async (name) => (await api(U, '/rooms', 'POST', { name, minutes: 60 })).body.code
for (const r of ((await api(U, '/rooms')).body ?? []).filter((r) => /^(verificacion|expira|garage-caido|huerfano)/.test(r.name))) await api(U, `/rooms/${r.code}`, 'DELETE')
await sleep(1500)
const base = await waitStats((s) => s.pendingDeletions === 0)
console.log(`   estado inicial: ${base.objects} objetos, ${base.bytes} bytes, ${base.dbFiles} archivos en BD, ${base.pendingDeletions} borrados pendientes`)

// 1) borrar un archivo
let code = await newRoom('verificacion')
const f1 = await upload(U, code, 'uno.bin', 100_000), f2 = await upload(U, code, 'dos.bin', 200_000)
let s = await stats(); ok(s.objects === base.objects + 2 && s.bytes === base.bytes + 300_000, `tras subir 2 archivos: +2 objetos y +300000 bytes (objetos ${s.objects})`)
await api(U, `/rooms/${code}/files/${f1.id}`, 'DELETE')
s = await waitStats((x) => x.objects === base.objects + 1); ok(s.objects === base.objects + 1 && s.bytes === base.bytes + 200_000, 'borrar un archivo elimina su objeto de Garage')

// 2) borrar una carpeta con contenido
const folder = (await api(U, `/rooms/${code}/folders?kind=FILE`, 'POST', { name: 'carpeta' })).body
await upload(U, code, 'a.bin', 50_000, folder.id); await upload(U, code, 'b.bin', 60_000, folder.id)
s = await stats(); ok(s.objects === base.objects + 3, 'dentro de la carpeta hay 2 objetos más')
await api(U, `/rooms/${code}/folders/${folder.id}`, 'DELETE')
s = await waitStats((x) => x.objects === base.objects + 1); ok(s.objects === base.objects + 1, 'borrar la carpeta elimina los objetos de su contenido')

// 3) cerrar la sala
await api(U, `/rooms/${code}`, 'DELETE')
s = await waitStats((x) => x.objects === base.objects); ok(s.objects === base.objects && s.bytes === base.bytes, 'cerrar la sala elimina todos sus objetos')

// 4) sala que expira sola
if (process.env.SKIP_EXPIRY) console.log('   (expiración omitida)')
else {
code = await newRoom('expira'); await upload(U, code, 'e1.bin', 70_000); await upload(U, code, 'e2.bin', 80_000)
s = await stats(); ok(s.objects === base.objects + 2, 'la sala que va a expirar tiene 2 objetos')
sql(`update rooms set expires_at = now() - interval '1 minute' where code = '${code}'`)
console.log('   sala marcada como expirada; esperando a la tarea automática (hasta 100 s)…')
s = await waitStats((x) => x.objects === base.objects, 100000); ok(s.objects === base.objects, 'al expirar, la tarea automática elimina los objetos de Garage')
ok(sql(`select count(*) from rooms where code = '${code}'`) === '0', 'y la sala desaparece de la base de datos')
}

// 5) Garage no responde justo al borrar
code = await newRoom('garage-caido'); const g1 = await upload(U, code, 'g1.bin', 90_000)
s = await stats(); ok(s.objects === base.objects + 1, 'objeto creado para la prueba de fallo')
execSync('docker compose stop garage'); await sleep(1500)
const del = await api(U, `/rooms/${code}/files/${g1.id}`, 'DELETE'); ok(del.status === 204, 'con Garage caído el borrado responde bien (no se bloquea)')
await sleep(2500)
ok(sql(`select count(*) from room_files where id = '${g1.id}'`) === '0', 'la fila de la base de datos ya no existe')
ok(sql('select count(*) from storage_tombstones') === '1', 'el objeto quedó anotado como pendiente de borrar (tombstone)')
execSync('docker compose start garage'); await sleep(10000)
let sw = await api(A, '/admin/storage/sweep?graceMinutes=60', 'POST')
s = await waitStats((x) => x.objects === base.objects && x.pendingDeletions === 0, 20000)
ok(s.objects === base.objects && s.pendingDeletions === 0, `al volver Garage, el borrado pendiente se completa (objetos ${s.objects}, pendientes ${s.pendingDeletions})`)
await api(U, `/rooms/${code}`, 'DELETE')

// 6) huérfano real: objeto sin fila (p. ej. caída del proceso), con la ventana de gracia
code = await newRoom('huerfano'); const h1 = await upload(U, code, 'h1.bin', 55_000)
sql(`delete from room_files where id = '${h1.id}'`)
s = await stats(); ok(s.objects === base.objects + 1 && s.dbFiles === base.dbFiles, 'se simula un huérfano: objeto en Garage sin fila en la base de datos')
sw = await api(A, '/admin/storage/sweep', 'POST'); s = await stats()
ok(sw.body.orphans === 0 && s.objects === base.objects + 1, 'con la ventana de gracia por defecto (60 min) NO se toca un objeto recién creado')
sw = await api(A, '/admin/storage/sweep?graceMinutes=0', 'POST'); s = await waitStats((x) => x.objects === base.objects)
ok(sw.body.orphans === 1 && sw.body.deleted === 1 && s.objects === base.objects, `la limpieza de huérfanos lo detecta y lo borra (${JSON.stringify({ o: sw.body.orphans, d: sw.body.deleted })})`)
await api(U, `/rooms/${code}`, 'DELETE')
const fin = await waitStats((x) => x.objects === base.objects)
ok(fin.objects === base.objects && fin.bytes === base.bytes && fin.pendingDeletions === 0, `estado final = estado inicial (${fin.objects} objetos, ${fin.bytes} bytes, ${fin.pendingDeletions} pendientes)`)
console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK')
process.exit(fails ? 1 : 0)
