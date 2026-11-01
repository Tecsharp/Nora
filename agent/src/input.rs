//! Aplicar al equipo los clics y teclas que llegan de Nora, y solo mientras haya un control concedido.

use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde_json::Value;
use std::collections::HashSet;

pub struct Controller {
    enigo: Enigo,
    active: bool,
    buttons: HashSet<u8>,
    held: HashSet<String>, // teclas modificadoras pulsadas
}

impl Controller {
    pub fn new() -> Result<Self, String> {
        let enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        Ok(Self { enigo, active: false, buttons: HashSet::new(), held: HashSet::new() })
    }

    pub fn screen(&self) -> (i32, i32) {
        self.enigo.main_display().unwrap_or((0, 0))
    }

    pub fn start(&mut self) {
        self.active = true;
    }

    /// Termina el control y suelta lo que estuviera pulsado. Devuelve si estaba activo.
    pub fn stop(&mut self) -> bool {
        let was = self.active;
        self.active = false;
        for b in self.buttons.drain().collect::<Vec<_>>() {
            let _ = self.enigo.button(button(b), Direction::Release);
        }
        for k in self.held.drain().collect::<Vec<_>>() {
            if let Some(key) = special(&k) {
                let _ = self.enigo.key(key, Direction::Release);
            }
        }
        was
    }

    /// Escribe un carácter. En macOS `Key::Unicode` consulta el teclado con las funciones TIS, que el sistema solo permite en el hilo principal
    /// (desde otro hilo cierran el programa en el acto); por eso allí se escribe el texto directamente y, con un atajo en marcha (⌘, ⌃, ⌥),
    /// se usa la tecla física por su código.
    fn type_char(&mut self, c: char) {
        #[cfg(target_os = "macos")]
        {
            if self.held.iter().any(|k| k != "Shift") {
                if let Some(code) = mac_keycode(c) {
                    let _ = self.enigo.key(Key::Other(code), Direction::Click);
                }
            } else {
                let _ = self.enigo.text(&c.to_string());
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = self.enigo.key(Key::Unicode(c), Direction::Click);
        }
    }

    pub fn apply(&mut self, e: &Value) {
        if !self.active {
            return;
        }
        let (w, h) = self.screen();
        let at = |v: &Value, size: i32| ((v.as_f64().unwrap_or(0.0).clamp(0.0, 1.0)) * (size.max(1) - 1) as f64).round() as i32;
        let b = e["b"].as_i64().unwrap_or(0).clamp(0, 2) as u8;
        match e["t"].as_str().unwrap_or("") {
            "mm" => {
                let _ = self.enigo.move_mouse(at(&e["x"], w), at(&e["y"], h), Coordinate::Abs);
            }
            "md" => {
                let _ = self.enigo.move_mouse(at(&e["x"], w), at(&e["y"], h), Coordinate::Abs);
                if self.enigo.button(button(b), Direction::Press).is_ok() {
                    self.buttons.insert(b);
                }
            }
            "mu" => {
                let _ = self.enigo.move_mouse(at(&e["x"], w), at(&e["y"], h), Coordinate::Abs);
                let _ = self.enigo.button(button(b), Direction::Release);
                self.buttons.remove(&b);
            }
            "wh" => {
                let dy = e["dy"].as_f64().unwrap_or(0.0);
                let dx = e["dx"].as_f64().unwrap_or(0.0);
                let ys = if dy == 0.0 { 0 } else { sign_clicks(dy) };
                let xs = if dx == 0.0 { 0 } else { sign_clicks(dx) };
                if ys != 0 {
                    let _ = self.enigo.scroll(ys, Axis::Vertical);
                }
                if xs != 0 {
                    let _ = self.enigo.scroll(xs, Axis::Horizontal);
                }
            }
            "kd" | "ku" => {
                let down = e["t"] == "kd";
                let k = e["k"].as_str().unwrap_or("");
                if let Some(key) = special(k) {
                    let dir = if down { Direction::Press } else { Direction::Release };
                    if self.enigo.key(key, dir).is_ok() {
                        if is_modifier(k) {
                            if down { self.held.insert(k.to_string()); } else { self.held.remove(k); }
                        }
                    }
                } else if down {
                    let mut chars = k.chars();
                    if let (Some(c), None) = (chars.next(), chars.next()) {
                        self.type_char(c);
                    }
                }
            }
            _ => {}
        }
    }
}

fn sign_clicks(d: f64) -> i32 {
    let n = (d.abs() / 100.0).round().clamp(1.0, 10.0) as i32;
    if d < 0.0 { -n } else { n }
}

fn button(b: u8) -> Button {
    match b {
        1 => Button::Middle,
        2 => Button::Right,
        _ => Button::Left,
    }
}

fn is_modifier(k: &str) -> bool {
    matches!(k, "Shift" | "Control" | "Alt" | "Meta")
}

/// Teclas con nombre (KeyboardEvent.key) → tecla del sistema. Los caracteres normales no pasan por aquí.
fn special(k: &str) -> Option<Key> {
    Some(match k {
        "Enter" => Key::Return,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        "Escape" => Key::Escape,
        "Delete" => Key::Delete,
        " " => Key::Space,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,
        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        "Shift" => Key::Shift,
        "Control" => Key::Control,
        "Alt" => Key::Alt,
        "Meta" => Key::Meta,
        "CapsLock" => Key::CapsLock,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        _ => return None,
    })
}

/// Código de tecla físico (disposición ANSI/US) de un carácter, para los atajos de macOS sin consultar el teclado.
#[cfg(target_os = "macos")]
fn mac_keycode(c: char) -> Option<u32> {
    Some(match c.to_ascii_lowercase() {
        'a' => 0, 's' => 1, 'd' => 2, 'f' => 3, 'h' => 4, 'g' => 5, 'z' => 6, 'x' => 7, 'c' => 8, 'v' => 9, 'b' => 11,
        'q' => 12, 'w' => 13, 'e' => 14, 'r' => 15, 'y' => 16, 't' => 17, 'o' => 31, 'u' => 32, 'i' => 34, 'p' => 35,
        'l' => 37, 'j' => 38, 'k' => 40, 'n' => 45, 'm' => 46,
        '1' | '!' => 18, '2' | '@' => 19, '3' | '#' => 20, '4' | '$' => 21, '6' | '^' => 22, '5' | '%' => 23, '=' | '+' => 24,
        '9' | '(' => 25, '7' | '&' => 26, '-' | '_' => 27, '8' | '*' => 28, '0' | ')' => 29, ']' | '}' => 30, '[' | '{' => 33,
        '\'' | '"' => 39, ';' | ':' => 41, '\\' | '|' => 42, ',' | '<' => 43, '/' | '?' => 44, '.' | '>' => 47, '`' | '~' => 50,
        _ => return None,
    })
}
