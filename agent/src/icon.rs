//! El icono de Nora Agent, dibujado en código (así no hay imágenes que mantener ni empaquetar).

fn inside_round_rect(x: f32, y: f32, s: f32, r: f32) -> bool {
    let cx = x.clamp(r, s - r);
    let cy = y.clamp(r, s - r);
    (x - cx).powi(2) + (y - cy).powi(2) <= r * r
}

/// Una «N» gruesa: dos barras y la diagonal, en coordenadas de 0 a 1.
fn in_n(x: f32, y: f32) -> bool {
    let (l, r, top, bot, t) = (0.30, 0.70, 0.27, 0.73, 0.115);
    if y < top || y > bot { return false; }
    let stems = (x >= l && x <= l + t) || (x >= r - t && x <= r);
    // diagonal de arriba a la izquierda a abajo a la derecha
    let u = (y - top) / (bot - top);
    let dx = l + t * 0.5 + u * (r - l - t);
    stems || (x - dx).abs() <= t * 0.62
}

/// RGBA de `size` × `size` con bordes suavizados (4× de muestreo).
pub fn rgba(size: u32) -> Vec<u8> {
    let s = size as f32;
    let mut out = vec![0u8; (size * size * 4) as usize];
    let n = 4;
    for py in 0..size {
        for px in 0..size {
            let (mut a, mut white) = (0u32, 0u32);
            for sy in 0..n {
                for sx in 0..n {
                    let x = px as f32 + (sx as f32 + 0.5) / n as f32;
                    let y = py as f32 + (sy as f32 + 0.5) / n as f32;
                    if inside_round_rect(x, y, s, s * 0.225) {
                        a += 1;
                        if in_n(x / s, y / s) { white += 1; }
                    }
                }
            }
            let total = (n * n) as f32;
            let t = py as f32 / s;
            // degradado violeta de Nora
            let (r0, g0, b0) = (150.0, 130.0, 255.0);
            let (r1, g1, b1) = (98.0, 80.0, 230.0);
            let (br, bg, bb) = (r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t);
            let w = if a > 0 { white as f32 / a as f32 } else { 0.0 };
            let i = ((py * size + px) * 4) as usize;
            out[i] = (br + (255.0 - br) * w) as u8;
            out[i + 1] = (bg + (255.0 - bg) * w) as u8;
            out[i + 2] = (bb + (255.0 - bb) * w) as u8;
            out[i + 3] = (a as f32 / total * 255.0) as u8;
        }
    }
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &x in data {
        a = (a + x as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

/// PNG sin compresión (bloques «stored» de zlib): sirve para generar el icono de la app de macOS sin depender de nada.
pub fn png(size: u32) -> Vec<u8> {
    let px = rgba(size);
    let mut raw = Vec::with_capacity(px.len() + size as usize);
    for row in px.chunks((size * 4) as usize) {
        raw.push(0);
        raw.extend_from_slice(row);
    }
    let mut z = vec![0x78, 0x01];
    let mut chunks = raw.chunks(65535).peekable();
    while let Some(c) = chunks.next() {
        z.push(if chunks.peek().is_none() { 1 } else { 0 });
        z.extend_from_slice(&(c.len() as u16).to_le_bytes());
        z.extend_from_slice(&(!(c.len() as u16)).to_le_bytes());
        z.extend_from_slice(c);
    }
    z.extend_from_slice(&adler32(&raw).to_be_bytes());
    let mut out = vec![137, 80, 78, 71, 13, 10, 26, 10];
    let mut chunk = |kind: &[u8; 4], data: &[u8]| {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let mut body = kind.to_vec();
        body.extend_from_slice(data);
        out.extend_from_slice(&body);
        out.extend_from_slice(&crc32(&body).to_be_bytes());
    };
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&size.to_be_bytes());
    ihdr.extend_from_slice(&size.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    chunk(b"IHDR", &ihdr);
    chunk(b"IDAT", &z);
    chunk(b"IEND", &[]);
    out
}
