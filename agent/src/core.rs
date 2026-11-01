//! El motor del agente: vinculación con tu Nora, el canal en vivo y la aplicación de clics y teclas.
//! No sabe nada de ventanas: la interfaz (o la consola) solo lee su estado y le manda órdenes.

use crate::applog;
use crate::input::Controller;
use crate::platform;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, RecvTimeoutError, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tungstenite::client::IntoClientRequest;
use tungstenite::http::HeaderValue;
use tungstenite::Message;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    /// Sin vincular: hace falta el código de Nora.
    Unpaired,
    Pairing,
    /// Vinculado y abriendo el canal con Nora.
    Connecting,
    Connected,
    /// Sin conexión; vuelve a intentarlo en N segundos.
    Offline(u64),
}

#[derive(Clone)]
pub struct State {
    pub status: Status,
    pub server: String,
    /// Quién es el usuario de Nora al que está vinculado este equipo (lo manda Nora al conectar).
    pub user_name: String,
    pub user_email: String,
    /// Mensaje de error de la última acción (vincular…).
    pub error: String,
    /// Quién está controlando el equipo ahora mismo.
    pub controlled_by: Option<String>,
    pub screen: (i32, i32),
    /// Por qué no se puede controlar este equipo (falta de permiso, Wayland…). Vacío si todo va bien.
    pub blocked: String,
    pub quit: bool,
}

pub type Shared = Arc<Mutex<State>>;

pub enum Command {
    Pair { server: String, code: String },
    /// Olvida la vinculación de este equipo.
    Reset,
    /// Detiene el control que alguien tenga ahora mismo sobre este equipo.
    StopControl,
    Quit,
}

pub struct Worker {
    pub shared: Shared,
    wake: Box<dyn Fn() + Send>,
}

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

/// Guarda el nombre y el correo para enseñarlos también cuando aún no hay conexión.
fn save_profile(name: &str, email: &str) {
    let path = config_path();
    let Some(mut v) = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else { return };
    v["name"] = json!(name);
    v["email"] = json!(email);
    let _ = std::fs::write(&path, v.to_string());
}

fn load_profile() -> (String, String) {
    let v: Value = std::fs::read_to_string(config_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    (v["name"].as_str().unwrap_or("").to_string(), v["email"].as_str().unwrap_or("").to_string())
}

pub fn forget_config() {
    let _ = std::fs::remove_file(config_path());
}

pub fn normalize_server(s: &str) -> String {
    let mut s = s.trim().trim_end_matches('/').to_string();
    if !s.starts_with("http://") && !s.starts_with("https://") {
        s = format!("https://{s}");
    }
    s
}

/// Solo el servidor, para enseñarlo sin el «https://».
pub fn host_label(server: &str) -> String {
    server.trim_start_matches("https://").trim_start_matches("http://").to_string()
}

fn pair(server: &str, code: &str) -> Result<String, String> {
    let resp = ureq::post(&format!("{server}/api/assist/agent/pair")).timeout(Duration::from_secs(15)).send_json(json!({ "code": code.trim().to_uppercase() }));
    match resp {
        Ok(r) => r.into_json::<Value>().ok().and_then(|v| v["token"].as_str().map(String::from)).ok_or_else(|| "Respuesta inesperada del servidor".to_string()),
        Err(ureq::Error::Status(_, _)) => Err("Código no válido o caducado. Genera uno nuevo en Nora › Asistencia.".to_string()),
        Err(e) => Err(format!("No se pudo conectar con {server}: {e}")),
    }
}

enum Outcome {
    Retry,
    Unauthorized,
    Reset,
    Quit,
}

impl Worker {
    pub fn new(wake: impl Fn() + Send + 'static) -> Self {
        let paired = load_config().filter(|c| !c.token.is_empty());
        let (user_name, user_email) = if paired.is_some() { load_profile() } else { Default::default() };
        let state = State {
            status: if paired.is_some() { Status::Connecting } else { Status::Unpaired },
            server: paired.as_ref().map(|c| c.server.clone()).unwrap_or_default(),
            user_name,
            user_email,
            error: String::new(),
            controlled_by: None,
            screen: (0, 0),
            blocked: String::new(),
            quit: false,
        };
        Self { shared: Arc::new(Mutex::new(state)), wake: Box::new(wake) }
    }

    fn set(&self, f: impl FnOnce(&mut State)) {
        if let Ok(mut s) = self.shared.lock() {
            f(&mut s);
        }
        (self.wake)();
    }

    /// Bucle principal (corre en su propio hilo hasta que llega «Quit»).
    pub fn run(self, rx: Receiver<Command>, initial_pair: Option<(String, String)>) {
        let mut ctl: Option<Controller> = None;
        let mut cfg = load_config().filter(|c| !c.token.is_empty());
        let mut pending = initial_pair;
        let mut wait = 1u64;
        loop {
            // ---- sin vincular: se espera el código ----
            if cfg.is_none() {
                let cmd = match pending.take() {
                    Some((server, code)) => Command::Pair { server, code },
                    None => match rx.recv_timeout(Duration::from_millis(400)) {
                        Ok(c) => c,
                        Err(RecvTimeoutError::Timeout) => continue,
                        Err(RecvTimeoutError::Disconnected) => return,
                    },
                };
                match cmd {
                    Command::Quit => return,
                    Command::Pair { server, code } => {
                        let server = normalize_server(&server);
                        self.set(|s| { s.status = Status::Pairing; s.error.clear(); });
                        match pair(&server, &code) {
                            Ok(token) => {
                                let c = Config { server: server.clone(), token };
                                save_config(&c);
                                self.set(|s| { s.status = Status::Connecting; s.server = server; s.error.clear(); });
                                cfg = Some(c);
                                wait = 1;
                            }
                            Err(e) => self.set(|s| { s.status = Status::Unpaired; s.error = e; }),
                        }
                    }
                    _ => {}
                }
                continue;
            }

            // ---- vinculado: se necesita poder controlar el equipo para conectar ----
            if ctl.is_none() {
                match Controller::new() {
                    Ok(c) => {
                        ctl = Some(c);
                        self.set(|s| s.blocked.clear());
                    }
                    Err(e) => {
                        let msg = if platform::wayland_session() {
                            "Tu sesión usa Wayland, que no permite controlar el equipo desde un programa. Inicia sesión con X11.".to_string()
                        } else if cfg!(target_os = "macos") {
                            "Falta el permiso de Accesibilidad: concédeselo a Nora Agent en Ajustes del Sistema › Privacidad y seguridad.".to_string()
                        } else {
                            format!("No se pudo acceder al teclado y al ratón de este equipo: {e}")
                        };
                        self.set(|s| { s.blocked = msg; s.status = Status::Connecting; });
                        if self.wait_commands(&rx, Duration::from_secs(2), &mut cfg, &mut ctl) {
                            return;
                        }
                        continue;
                    }
                }
            }

            let started = Instant::now();
            // un fallo inesperado dentro de la sesión no debe cerrar el programa: se anota, se suelta el control y se reconecta
            let outcome = match (cfg.as_ref(), ctl.as_mut()) {
                (Some(c), Some(k)) => match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.session(c, k, &rx))) {
                    Ok(o) => o,
                    Err(_) => {
                        applog::log("La sesión falló y se reinicia");
                        ctl = None;
                        self.set(|s| s.controlled_by = None);
                        Outcome::Retry
                    }
                },
                _ => Outcome::Retry,
            };
            match outcome {
                Outcome::Quit => {
                    if let Some(k) = ctl.as_mut() { k.stop(); }
                    return;
                }
                Outcome::Reset => {
                    forget_config();
                    cfg = None;
                    self.set(|s| { s.status = Status::Unpaired; s.server.clear(); s.user_name.clear(); s.user_email.clear(); s.controlled_by = None; s.error.clear(); });
                    continue;
                }
                Outcome::Unauthorized => {
                    forget_config();
                    cfg = None;
                    self.set(|s| { s.status = Status::Unpaired; s.controlled_by = None; s.error = "Nora no reconoce este equipo (la sesión se cerró o caducó). Vuelve a vincularlo con un código nuevo.".into(); });
                    continue;
                }
                Outcome::Retry => {}
            }
            wait = if started.elapsed() > Duration::from_secs(30) { 1 } else { (wait * 2).min(30) };
            for left in (1..=wait).rev() {
                self.set(|s| { s.status = Status::Offline(left); s.controlled_by = None; });
                if self.wait_commands(&rx, Duration::from_secs(1), &mut cfg, &mut ctl) {
                    return;
                }
                if cfg.is_none() { break; }
            }
            if cfg.is_some() { self.set(|s| s.status = Status::Connecting); }
        }
    }

    /// Espera atendiendo órdenes. Devuelve true si hay que terminar.
    fn wait_commands(&self, rx: &Receiver<Command>, dur: Duration, cfg: &mut Option<Config>, ctl: &mut Option<Controller>) -> bool {
        match rx.recv_timeout(dur) {
            Ok(Command::Quit) => true,
            Ok(Command::Reset) => {
                forget_config();
                *cfg = None;
                if let Some(k) = ctl.as_mut() { k.stop(); }
                self.set(|s| { s.status = Status::Unpaired; s.server.clear(); s.user_name.clear(); s.user_email.clear(); s.controlled_by = None; s.error.clear(); });
                false
            }
            Ok(_) | Err(RecvTimeoutError::Timeout) => false,
            Err(RecvTimeoutError::Disconnected) => true,
        }
    }

    fn session(&self, cfg: &Config, ctl: &mut Controller, rx: &Receiver<Command>) -> Outcome {
        self.set(|s| s.status = Status::Connecting);
        let ws_url = cfg.server.replacen("http", "ws", 1) + "/ws/agent";
        let parsed = match url::Url::parse(&ws_url) {
            Ok(u) => u,
            Err(_) => return Outcome::Retry,
        };
        let host = parsed.host_str().unwrap_or("").to_string();
        let port = parsed.port_or_known_default().unwrap_or(80);
        let Ok(stream) = std::net::TcpStream::connect((host.as_str(), port)) else { return Outcome::Retry };
        let _ = stream.set_nodelay(true);
        let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
        let Ok(mut req) = ws_url.as_str().into_client_request() else { return Outcome::Retry };
        let Ok(auth) = HeaderValue::from_str(&format!("Bearer {}", cfg.token)) else { return Outcome::Unauthorized };
        req.headers_mut().insert("Authorization", auth);
        let (mut ws, _) = match tungstenite::client_tls(req, stream) {
            Ok(x) => x,
            Err(tungstenite::HandshakeError::Failure(tungstenite::Error::Http(r))) if r.status().as_u16() == 401 => return Outcome::Unauthorized,
            Err(e) => { applog::log(&format!("No se pudo abrir el canal con Nora: {e}")); return Outcome::Retry }
        };
        let (w, h) = ctl.screen();
        let _ = ws.send(Message::text(json!({ "type": "hello", "os": std::env::consts::OS, "version": VERSION, "screen": format!("{w}x{h}") }).to_string()));
        self.set(|s| { s.status = Status::Connected; s.screen = (w, h); });
        let mut last_ping = Instant::now();
        let outcome = loop {
            if last_ping.elapsed() > Duration::from_secs(25) {
                if ws.send(Message::text("{\"type\":\"ping\"}")).is_err() {
                    break Outcome::Retry;
                }
                last_ping = Instant::now();
            }
            loop {
                match rx.try_recv() {
                    Ok(Command::StopControl) => {
                        if ctl.stop() {
                            let _ = ws.send(Message::text("{\"type\":\"control.revoke\"}")); // Nora avisa a quien controlaba
                            self.set(|s| s.controlled_by = None);
                            platform::notify("Detuviste el control de tu equipo.");
                        }
                    }
                    Ok(Command::Reset) => { ctl.stop(); let _ = ws.close(None); return Outcome::Reset; }
                    Ok(Command::Quit) => { ctl.stop(); let _ = ws.close(None); return Outcome::Quit; }
                    Ok(Command::Pair { .. }) => {}
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => return Outcome::Quit,
                }
            }
            match ws.read() {
                Ok(Message::Text(t)) => self.handle(ctl, &t),
                Ok(Message::Close(_)) => { applog::log("Nora cerró el canal"); break Outcome::Retry }
                Ok(_) => {}
                Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
                Err(e) => { applog::log(&format!("Se perdió el canal con Nora: {e}")); break Outcome::Retry }
            }
        };
        ctl.stop(); // sin canal no se obedece nada
        outcome
    }

    fn handle(&self, ctl: &mut Controller, text: &str) {
        let Ok(v) = serde_json::from_str::<Value>(text) else { return };
        match v["type"].as_str().unwrap_or("") {
            "control.start" => {
                ctl.start();
                let who = v["controller"].as_str().filter(|s| !s.is_empty()).unwrap_or("Alguien").to_string();
                platform::notify(&format!("{who} está controlando tu equipo. Puedes detenerlo desde Nora."));
                self.set(|s| s.controlled_by = Some(who));
            }
            "control.stop" => {
                if ctl.stop() {
                    platform::notify("Se terminó el control de tu equipo.");
                }
                self.set(|s| s.controlled_by = None);
            }
            "input" => ctl.apply(&v),
            "welcome" => {
                let name = v["name"].as_str().unwrap_or("").to_string();
                let email = v["email"].as_str().unwrap_or("").to_string();
                save_profile(&name, &email);
                self.set(|s| { s.user_name = name; s.user_email = email; });
            }
            _ => {}
        }
    }
}
