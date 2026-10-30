//! Un registro sencillo en `nora-agent/agent.log` (junto a la configuración). Si el programa falla, ahí queda el motivo.

use std::io::Write;
use std::path::PathBuf;

fn path() -> PathBuf {
    let mut p = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("nora-agent");
    let _ = std::fs::create_dir_all(&p);
    p.push("agent.log");
    p
}

fn stamp() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (h, m, s) = ((secs / 3600) % 24, (secs / 60) % 60, secs % 60);
    format!("{h:02}:{m:02}:{s:02}Z")
}

/// Escribe una línea en el registro y en la consola (sin fallar nunca: con la salida cerrada `println!` haría caer el programa).
pub fn log(msg: &str) {
    let _ = writeln!(std::io::stdout(), "{msg}");
    let p = path();
    // no crece sin límite: pasado 256 KB se empieza de nuevo
    if std::fs::metadata(&p).map(|m| m.len() > 256 * 1024).unwrap_or(false) {
        let _ = std::fs::remove_file(&p);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let _ = writeln!(f, "{} {msg}", stamp());
    }
}

/// Que un fallo inesperado quede escrito en el registro con su lugar exacto.
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let place = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let what = info.payload().downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| info.payload().downcast_ref::<String>().cloned()).unwrap_or_default();
        log(&format!("ERROR interno en {place}: {what}"));
    }));
}
