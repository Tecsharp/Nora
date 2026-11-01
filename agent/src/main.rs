//! Nora Agent: programa de escritorio (macOS, Windows y Linux) que permite que alguien de tu sala controle tu equipo con el ratón y el teclado,
//! solo cuando tú lo aceptas desde Nora. Un navegador no puede hacerlo por sí solo; por eso existe. La pantalla la comparte tu navegador;
//! este programa solo aplica los clics y las teclas autorizados.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod applog;
mod core;
mod gui;
mod icon;
mod input;
mod platform;

use std::io::{BufRead, Write};

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn prompt(label: &str) -> String {
    print!("{label}");
    let _ = std::io::stdout().flush();
    let mut s = String::new();
    let _ = std::io::stdin().lock().read_line(&mut s);
    s.trim().to_string()
}

/// Modo sin ventana (servidores, SSH…): el mismo motor, controlado por consola.
fn cli(args: &[String]) {
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel();
    let worker = core::Worker::new(|| {});
    let shared = worker.shared.clone();
    let need_pair = shared.lock().map(|s| s.status == core::Status::Unpaired).unwrap_or(true);
    let initial = if need_pair {
        let server = arg(args, "--server").unwrap_or_else(|| prompt("Dirección de tu Nora (por ejemplo https://nora.miempresa.com): "));
        let code = arg(args, "--code").unwrap_or_else(|| prompt("Código de vinculación (Nora → Asistencia → Agente): "));
        Some((server, code))
    } else {
        None
    };
    let handle = std::thread::spawn(move || worker.run(rx, initial));
    let mut last = String::new();
    loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let st = shared.lock().map(|s| s.clone()).ok();
        let Some(st) = st else { break };
        let line = format!("{:?}|{}|{:?}|{}", st.status, st.error, st.controlled_by, st.blocked);
        if line != last {
            match (&st.status, st.error.is_empty()) {
                (core::Status::Unpaired, false) => { eprintln!("{}", st.error); drop(tx); let _ = handle.join(); std::process::exit(1); }
                (core::Status::Connected, _) => println!("Conectado a Nora. No se hará nada hasta que aceptes un control desde Nora."),
                (core::Status::Offline(n), _) => eprintln!("Sin conexión; reintentando en {n} s…"),
                _ => {}
            }
            if !st.blocked.is_empty() { eprintln!("{}", st.blocked); }
            last = line;
        }
        if handle.is_finished() { break; }
    }
}

fn main() {
    applog::install_panic_hook();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("nora-agent {}\n\nSin argumentos abre la ventana.\n\nOpciones:\n  --server URL    dirección de tu Nora\n  --code CODIGO   código de vinculación (Nora → Asistencia → Agente)\n  --cli           sin ventana: todo por consola\n  --reset         olvida la vinculación\n  --minimized     abre la ventana minimizada (lo usa «Iniciar con el sistema»)\n  --write-icon F  escribe el icono en un PNG\n", core::VERSION);
        return;
    }
    if let Some(path) = arg(&args, "--write-icon") {
        let size = arg(&args, "--size").and_then(|s| s.parse().ok()).unwrap_or(1024);
        let _ = std::fs::write(path, icon::png(size));
        return;
    }
    if args.iter().any(|a| a == "--reset") {
        core::forget_config();
    }
    if args.iter().any(|a| a == "--cli") {
        cli(&args);
        return;
    }
    let server = arg(&args, "--server").map(|s| core::normalize_server(&s)).unwrap_or_default();
    let initial = arg(&args, "--code").filter(|_| !server.is_empty()).map(|c| (server.clone(), c));
    if let Err(e) = gui::run(server, initial, args.iter().any(|a| a == "--minimized")) {
        eprintln!("No se pudo abrir la ventana: {e}\nPuedes usar el modo de consola: nora-agent --cli");
        std::process::exit(2);
    }
}
