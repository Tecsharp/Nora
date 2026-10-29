//! Agente de escritorio de Nora (Asistencia).
//!
//! Un navegador no puede mover el ratón ni escribir en el sistema, así que para que alguien de tu sala pueda *controlar* tu equipo
//! hace falta este programa. Se vincula una vez con tu cuenta (código de un solo uso que ves en Nora → Asistencia) y después se queda
//! conectado a tu servidor Nora. No hace NADA hasta que tú, desde Nora, aceptas expresamente que una persona te controle; en cuanto
//! pulsas «Detener control» (o cierras esta ventana) deja de aplicar nada. La pantalla no la envía este programa: la comparte tu navegador.

mod input;

use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tungstenite::client::IntoClientRequest;
use tungstenite::http::HeaderValue;
use tungstenite::Message;

const VERSION: &str = env!("CARGO_PKG_VERSION");

struct Config {
    server: String,
    token: String,
}

fn config_path() -> PathBuf {
    let mut p = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("nora-agent");
    let _ = std::fs::create_dir_all(&p);
    p.push("config.json");
    p
}

fn load_config() -> Option<Config> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(config_path()).ok()?).ok()?;
    Some(Config { server: v["server"].as_str()?.to_string(), token: v["token"].as_str()?.to_string() })
}

fn save_config(c: &Config) {
    let path = config_path();
    let body = json!({ "server": c.server, "token": c.token }).to_string();
    if std::fs::write(&path, body).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
    }
}

fn prompt(label: &str) -> String {
    print!("{label}");
    let _ = std::io::stdout().flush();
    let mut s = String::new();
    let _ = std::io::stdin().lock().read_line(&mut s);
    s.trim().to_string()
}

fn normalize_server(s: &str) -> String {
    let mut s = s.trim().trim_end_matches('/').to_string();
    if !s.starts_with("http://") && !s.starts_with("https://") {
        s = format!("https://{s}");
    }
    s
}

fn pair(server: &str, code: &str) -> Result<String, String> {
    let resp = ureq::post(&format!("{server}/api/assist/agent/pair"))
        .timeout(Duration::from_secs(15))
        .send_json(json!({ "code": code }));
    match resp {
        Ok(r) => r.into_json::<Value>().ok().and_then(|v| v["token"].as_str().map(String::from)).ok_or_else(|| "Respuesta inesperada del servidor".to_string()),
        Err(ureq::Error::Status(_, _)) => Err("Código no válido o caducado. Genera uno nuevo en Nora → Asistencia.".to_string()),
        Err(e) => Err(format!("No se pudo conectar con {server}: {e}")),
    }
}

/// Aviso del sistema (mejor esfuerzo): que se note cuando alguien empieza o deja de controlar.
fn notify(text: &str) {
    println!("{text}");
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("notify-send").args(["Nora", text]).status();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("osascript").args(["-e", &format!("display notification \"{}\" with title \"Nora\"", text.replace('"', "'"))]).status();
}

enum Outcome {
    Retry,
    Unauthorized,
}

fn run_session(cfg: &Config, ctl: &mut input::Controller) -> Outcome {
    let ws_url = cfg.server.replacen("http", "ws", 1) + "/ws/agent";
    let parsed = match url::Url::parse(&ws_url) {
        Ok(u) => u,
        Err(e) => {
            eprintln!("Dirección no válida: {e}");
            return Outcome::Retry;
        }
    };
    let host = parsed.host_str().unwrap_or("").to_string();
    let port = parsed.port_or_known_default().unwrap_or(80);
    let stream = match TcpStream::connect((host.as_str(), port)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Sin conexión con {host}:{port}: {e}");
            return Outcome::Retry;
        }
    };
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut req = ws_url.as_str().into_client_request().expect("url");
    req.headers_mut().insert("Authorization", HeaderValue::from_str(&format!("Bearer {}", cfg.token)).expect("token"));
    let (mut ws, _) = match tungstenite::client_tls(req, stream) {
        Ok(x) => x,
        Err(tungstenite::HandshakeError::Failure(tungstenite::Error::Http(r))) if r.status().as_u16() == 401 => return Outcome::Unauthorized,
        Err(e) => {
            eprintln!("No se pudo abrir el canal con Nora: {e}");
            return Outcome::Retry;
        }
    };
    let (w, h) = ctl.screen();
    let _ = ws.send(Message::text(json!({ "type": "hello", "os": std::env::consts::OS, "version": VERSION, "screen": format!("{w}x{h}") }).to_string()));
    println!("Conectado a Nora. Esperando; no se hará nada hasta que aceptes un control desde Nora.");
    let mut last_ping = Instant::now();
    loop {
        if last_ping.elapsed() > Duration::from_secs(25) {
            if ws.send(Message::text("{\"type\":\"ping\"}")).is_err() {
                break;
            }
            last_ping = Instant::now();
        }
        match ws.read() {
            Ok(Message::Text(t)) => handle(ctl, &t),
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(_) => break,
        }
    }
    ctl.stop(); // sin canal no se obedece nada
    Outcome::Retry
}

fn handle(ctl: &mut input::Controller, text: &str) {
    let Ok(v) = serde_json::from_str::<Value>(text) else { return };
    match v["type"].as_str().unwrap_or("") {
        "control.start" => {
            ctl.start();
            notify(&format!("{} está controlando tu equipo. Puedes detenerlo desde Nora.", v["controller"].as_str().filter(|s| !s.is_empty()).unwrap_or("Alguien")));
        }
        "control.stop" => {
            if ctl.stop() {
                notify("Se terminó el control de tu equipo.");
            }
        }
        "input" => ctl.apply(&v),
        _ => {}
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("nora-agent {VERSION}\n\nUso: nora-agent [--server https://tu-nora] [--code XXXX-XXXX] [--reset]\n\n  --server  dirección de tu Nora (se recuerda)\n  --code    código de vinculación de Nora → Asistencia (un solo uso)\n  --reset   olvida la vinculación y pide otra\n");
        return;
    }
    if args.iter().any(|a| a == "--reset") {
        let _ = std::fs::remove_file(config_path());
    }
    let mut ctl = match input::Controller::new() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("No se pudo acceder al teclado/ratón de este equipo: {e}\nEn Linux hace falta una sesión X11 (Wayland no lo permite). En macOS concede el permiso de Accesibilidad a este programa.");
            std::process::exit(2);
        }
    };
    println!("Agente de Nora {VERSION}");
    let mut cfg = load_config();
    if let Some(s) = arg("--server") {
        let server = normalize_server(&s);
        if cfg.as_ref().map(|c| c.server != server).unwrap_or(false) {
            cfg = None; // otro servidor: hay que vincular de nuevo
        }
        if cfg.is_none() {
            cfg = Some(Config { server, token: String::new() });
        }
    }
    let mut cfg = match cfg {
        Some(c) if !c.token.is_empty() => c,
        other => {
            let server = other.map(|c| c.server).unwrap_or_else(|| normalize_server(&prompt("Dirección de tu Nora (por ejemplo https://nora.miempresa.com): ")));
            let code = arg("--code").unwrap_or_else(|| prompt("Código de vinculación (Nora → Asistencia → Agente): "));
            match pair(&server, &code) {
                Ok(token) => {
                    let c = Config { server, token };
                    save_config(&c);
                    println!("Vinculado. La próxima vez se conectará solo.");
                    c
                }
                Err(e) => {
                    eprintln!("{e}");
                    std::process::exit(1);
                }
            }
        }
    };
    let mut wait = 1u64;
    loop {
        let started = Instant::now();
        match run_session(&cfg, &mut ctl) {
            Outcome::Unauthorized => {
                eprintln!("Nora no reconoce este agente (la sesión se cerró o caducó). Vuelve a vincularlo: nora-agent --reset");
                let _ = std::fs::remove_file(config_path());
                cfg.token.clear();
                std::process::exit(1);
            }
            Outcome::Retry => {}
        }
        wait = if started.elapsed() > Duration::from_secs(30) { 1 } else { (wait * 2).min(30) };
        eprintln!("Reintentando en {wait} s…");
        std::thread::sleep(Duration::from_secs(wait));
    }
}
