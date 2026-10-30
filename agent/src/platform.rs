//! Lo que cambia de un sistema a otro: avisos, permisos y arranque con el sistema.

use std::path::PathBuf;
use std::process::Command;

/// Aviso del sistema (mejor esfuerzo): que se note cuando alguien empieza o deja de controlar.
pub fn notify(text: &str) {
    println!("{text}");
    #[cfg(target_os = "linux")]
    let _ = Command::new("notify-send").args(["Nora", text]).status();
    #[cfg(target_os = "macos")]
    let _ = Command::new("osascript").args(["-e", &format!("display notification \"{}\" with title \"Nora\"", text.replace(['"', '\\'], "'"))]).status();
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    let _ = text;
}

/// ¿Tiene este programa el permiso de Accesibilidad (macOS)? En el resto de sistemas no hace falta.
pub fn accessibility_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }
        // SAFETY: función del sistema sin argumentos ni efectos secundarios.
        unsafe { AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Abre el panel del sistema donde se concede el permiso de Accesibilidad.
pub fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility").status();
}

/// En Linux con Wayland el sistema no deja que un programa controle el equipo.
pub fn wayland_session() -> bool {
    cfg!(target_os = "linux") && std::env::var("XDG_SESSION_TYPE").map(|v| v.eq_ignore_ascii_case("wayland")).unwrap_or(false)
}

pub fn os_label() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    }
}

// ---- Iniciar con el sistema ----

fn exe() -> Option<PathBuf> {
    std::env::current_exe().ok()
}

#[cfg(target_os = "macos")]
fn autostart_file() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join("Library/LaunchAgents/app.nora.agent.plist"))
}

#[cfg(target_os = "linux")]
fn autostart_file() -> Option<PathBuf> {
    Some(dirs::config_dir()?.join("autostart/nora-agent.desktop"))
}

#[cfg(target_os = "windows")]
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

pub fn autostart_enabled() -> bool {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        autostart_file().map(|p| p.exists()).unwrap_or(false)
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("reg").args(["query", RUN_KEY, "/v", "NoraAgent"]).output().map(|o| o.status.success()).unwrap_or(false)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        false
    }
}

pub fn set_autostart(on: bool) -> Result<(), String> {
    let exe = exe().ok_or("No se encontró la ruta del programa")?;
    let exe_s = exe.to_string_lossy().to_string();
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let path = autostart_file().ok_or("No se encontró la carpeta de usuario")?;
        if !on {
            let _ = std::fs::remove_file(&path);
            return Ok(());
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "macos")]
        let body = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n  <key>Label</key><string>app.nora.agent</string>\n  <key>ProgramArguments</key><array><string>{}</string><string>--minimized</string></array>\n  <key>RunAtLoad</key><true/>\n</dict></plist>\n",
            xml_escape(&exe_s)
        );
        #[cfg(target_os = "linux")]
        let body = format!("[Desktop Entry]\nType=Application\nName=Nora Agent\nComment=Agente de Nora\nExec=\"{}\" --minimized\nTerminal=false\nX-GNOME-Autostart-enabled=true\n", exe_s.replace('"', "\\\""));
        std::fs::write(&path, body).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let status = if on {
            Command::new("reg").args(["add", RUN_KEY, "/v", "NoraAgent", "/t", "REG_SZ", "/d", &format!("\"{exe_s}\" --minimized"), "/f"]).status()
        } else {
            Command::new("reg").args(["delete", RUN_KEY, "/v", "NoraAgent", "/f"]).status()
        };
        status.map_err(|e| e.to_string()).and_then(|s| if s.success() || !on { Ok(()) } else { Err("No se pudo registrar el arranque".into()) })
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (on, exe_s);
        Err("No disponible en este sistema".into())
    }
}

#[cfg(target_os = "macos")]
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}
