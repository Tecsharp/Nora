//! La ventana de Nora Agent: pequeña, nativa y sin adornos. Sigue el tema claro u oscuro del sistema, dice a qué usuario de Nora está
//! vinculado el equipo y su versión, y deja a mano lo único importante: detener el control remoto.

use crate::core::{host_label, Command, Shared, State, Status, Worker, VERSION};
use crate::{icon, platform};
use eframe::egui::{self, Color32, RichText, Stroke, Vec2};
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

/// Colores de un tema. Sobrios: grises neutros y un solo acento.
#[derive(Clone, Copy)]
struct Pal {
    bg: Color32,
    group: Color32,
    field: Color32,
    hairline: Color32,
    text: Color32,
    muted: Color32,
    accent: Color32,
    green: Color32,
    yellow: Color32,
    red: Color32,
    switch_off: Color32,
}

fn pal(dark: bool) -> Pal {
    if dark {
        Pal {
            bg: Color32::from_rgb(30, 30, 32),
            group: Color32::from_rgb(43, 43, 46),
            field: Color32::from_rgb(30, 30, 32),
            hairline: Color32::from_rgb(62, 62, 67),
            text: Color32::from_rgb(242, 242, 245),
            muted: Color32::from_rgb(152, 152, 160),
            accent: Color32::from_rgb(139, 124, 246),
            green: Color32::from_rgb(61, 190, 130),
            yellow: Color32::from_rgb(226, 170, 80),
            red: Color32::from_rgb(240, 98, 98),
            switch_off: Color32::from_rgb(80, 80, 86),
        }
    } else {
        Pal {
            bg: Color32::from_rgb(244, 244, 246),
            group: Color32::WHITE,
            field: Color32::WHITE,
            hairline: Color32::from_rgb(226, 226, 231),
            text: Color32::from_rgb(28, 28, 31),
            muted: Color32::from_rgb(110, 110, 120),
            accent: Color32::from_rgb(98, 80, 224),
            green: Color32::from_rgb(28, 150, 90),
            yellow: Color32::from_rgb(176, 114, 16),
            red: Color32::from_rgb(209, 52, 56),
            switch_off: Color32::from_rgb(200, 200, 207),
        }
    }
}

fn tint(c: Color32, alpha: u8) -> Color32 {
    Color32::from_rgba_unmultiplied(c.r(), c.g(), c.b(), alpha)
}

pub fn window_icon() -> egui::IconData {
    // en macOS este es el icono del Dock: necesita su margen o se ve enorme junto a los demás
    let pad = if cfg!(target_os = "macos") { icon::MAC_PAD } else { 0.0 };
    egui::IconData { rgba: icon::rgba_padded(256, pad), width: 256, height: 256 }
}

pub struct App {
    shared: Shared,
    tx: Sender<Command>,
    logo: egui::TextureHandle,
    server: String,
    code: String,
    autostart: bool,
    ax_ok: bool,
    ax_checked: Instant,
    was_controlled: bool,
    confirm_reset: bool,
    autostart_err: String,
    start_minimized: bool,
}

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>, shared: Shared, tx: Sender<Command>, server_hint: String, start_minimized: bool) -> Self {
        style(&cc.egui_ctx);
        let logo = cc.egui_ctx.load_texture("logo", egui::ColorImage::from_rgba_unmultiplied([96, 96], &icon::rgba(96)), egui::TextureOptions::LINEAR);
        Self {
            shared, tx, logo, server: server_hint, code: String::new(), autostart: platform::autostart_enabled(), ax_ok: platform::accessibility_granted(),
            ax_checked: Instant::now(), was_controlled: false, confirm_reset: false, autostart_err: String::new(), start_minimized,
        }
    }

    fn send(&self, c: Command) {
        let _ = self.tx.send(c);
    }
}

/// La tipografía del sistema (San Francisco, Segoe UI, Noto/Cantarell…) para que no se vea como una herramienta de desarrollo.
fn system_font() -> Option<Vec<u8>> {
    let candidates: &[&str] = &[
        "/System/Library/Fonts/SFNS.ttf",
        "C:\\Windows\\Fonts\\segoeui.ttf",
        "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoSans-Regular.otf",
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
        "/usr/share/fonts/cantarell/Cantarell-Regular.otf",
        "/usr/share/fonts/open-sans/OpenSans-Regular.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ];
    candidates.iter().find_map(|p| std::fs::read(p).ok())
}

fn style(ctx: &egui::Context) {
    if let Some(bytes) = system_font() {
        let mut fonts = egui::FontDefinitions::default();
        fonts.font_data.insert("system".into(), std::sync::Arc::new(egui::FontData::from_owned(bytes)));
        if let Some(f) = fonts.families.get_mut(&egui::FontFamily::Proportional) {
            f.insert(0, "system".into());
        }
        ctx.set_fonts(fonts);
    }
    for dark in [true, false] {
        let p = pal(dark);
        let mut v = if dark { egui::Visuals::dark() } else { egui::Visuals::light() };
        v.panel_fill = p.bg;
        v.window_fill = p.group;
        v.extreme_bg_color = p.field;
        v.override_text_color = Some(p.text);
        v.selection.bg_fill = tint(p.accent, 90);
        v.selection.stroke = Stroke::new(1.0_f32, p.accent);
        v.hyperlink_color = p.accent;
        v.text_cursor.stroke = Stroke::new(1.5_f32, p.accent);
        let r = egui::CornerRadius::same(8);
        for w in [&mut v.widgets.noninteractive, &mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
            w.corner_radius = r;
        }
        let lift = |c: Color32, by: i16| {
            let f = |x: u8| (x as i16 + if dark { by } else { -by }).clamp(0, 255) as u8;
            Color32::from_rgb(f(c.r()), f(c.g()), f(c.b()))
        };
        v.widgets.noninteractive.bg_stroke = Stroke::new(1.0_f32, p.hairline);
        v.widgets.inactive.bg_fill = lift(p.group, 6);
        v.widgets.inactive.weak_bg_fill = lift(p.group, 6);
        v.widgets.inactive.bg_stroke = Stroke::new(1.0_f32, p.hairline);
        v.widgets.hovered.bg_fill = lift(p.group, 14);
        v.widgets.hovered.weak_bg_fill = lift(p.group, 14);
        v.widgets.hovered.bg_stroke = Stroke::new(1.0_f32, p.muted);
        v.widgets.active.bg_fill = lift(p.group, 22);
        v.widgets.active.weak_bg_fill = lift(p.group, 22);
        v.widgets.active.bg_stroke = Stroke::new(1.0_f32, p.accent);
        ctx.set_visuals_of(if dark { egui::Theme::Dark } else { egui::Theme::Light }, v);
    }
    ctx.all_styles_mut(|s| {
        s.spacing.item_spacing = Vec2::new(10.0, 8.0);
        s.spacing.button_padding = Vec2::new(14.0, 7.0);
        s.spacing.interact_size.y = 32.0;
        s.text_styles.insert(egui::TextStyle::Heading, egui::FontId::proportional(18.0));
        s.text_styles.insert(egui::TextStyle::Body, egui::FontId::proportional(14.0));
        s.text_styles.insert(egui::TextStyle::Button, egui::FontId::proportional(14.0));
        s.text_styles.insert(egui::TextStyle::Small, egui::FontId::proportional(12.0));
    });
}

fn muted(p: &Pal, text: &str) -> RichText {
    RichText::new(text).color(p.muted).size(13.0)
}

/// Título pequeño de una sección.
fn section(ui: &mut egui::Ui, p: &Pal, title: &str) {
    ui.add_space(6.0);
    ui.label(RichText::new(title.to_uppercase()).size(11.0).color(p.muted));
    ui.add_space(-2.0);
}

/// Bloque redondeado con filas separadas por una línea fina, como los ajustes de un sistema operativo.
fn group<R>(ui: &mut egui::Ui, p: &Pal, add: impl FnOnce(&mut egui::Ui) -> R) -> R {
    egui::Frame::new().fill(p.group).stroke(Stroke::new(1.0_f32, p.hairline)).corner_radius(10).inner_margin(egui::Margin::symmetric(14, 0)).show(ui, |ui| {
        ui.set_width(ui.available_width());
        ui.spacing_mut().item_spacing.y = 0.0;
        add(ui)
    }).inner
}

/// Una fila de un `group`: etiqueta a la izquierda, lo que se pase a la derecha.
fn line(ui: &mut egui::Ui, p: &Pal, first: bool, label: &str, right: impl FnOnce(&mut egui::Ui)) {
    if !first {
        ui.add(egui::Separator::default().spacing(0.0));
    }
    ui.allocate_ui_with_layout(Vec2::new(ui.available_width(), 38.0), egui::Layout::left_to_right(egui::Align::Center), |ui| {
        ui.label(RichText::new(label).size(14.0));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.spacing_mut().item_spacing.x = 8.0;
            right(ui);
        });
    });
    let _ = p;
}

fn value(ui: &mut egui::Ui, p: &Pal, v: &str) {
    ui.label(RichText::new(v).size(14.0).color(p.muted));
}

fn dot(ui: &mut egui::Ui, color: Color32) {
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(8.0), egui::Sense::hover());
    ui.painter().circle_filled(rect.center(), 4.0, color);
}

/// Botón de acción principal, a todo el ancho.
fn primary(ui: &mut egui::Ui, text: &str, color: Color32, enabled: bool) -> egui::Response {
    ui.add_enabled_ui(enabled, |ui| ui.add_sized([ui.available_width(), 38.0], egui::Button::new(RichText::new(text).color(Color32::WHITE).size(14.0)).fill(color).corner_radius(8))).inner
}

/// Círculo con la inicial del usuario.
fn avatar(ui: &mut egui::Ui, p: &Pal, name: &str) {
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(44.0), egui::Sense::hover());
    ui.painter().circle_filled(rect.center(), 22.0, tint(p.accent, 36));
    let initial = name.chars().find(|c| c.is_alphanumeric()).map(|c| c.to_uppercase().to_string()).unwrap_or_else(|| "·".into());
    ui.painter().text(rect.center(), egui::Align2::CENTER_CENTER, initial, egui::FontId::proportional(19.0), p.accent);
}

/// Estado de la conexión como una pastilla.
fn pill(ui: &mut egui::Ui, color: Color32, text: &str) {
    egui::Frame::new().fill(tint(color, 30)).corner_radius(20).inner_margin(egui::Margin::symmetric(10, 4)).show(ui, |ui| {
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 6.0;
            dot(ui, color);
            ui.label(RichText::new(text).size(12.5).color(color));
        });
    });
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if self.start_minimized {
            self.start_minimized = false;
            ctx.send_viewport_cmd(egui::ViewportCommand::Minimized(true));
        }
        let st: State = self.shared.lock().map(|s| s.clone()).unwrap_or_else(|p| p.into_inner().clone());
        if self.ax_checked.elapsed() > Duration::from_secs(1) {
            self.ax_ok = platform::accessibility_granted();
            self.ax_checked = Instant::now();
        }
        // alguien empieza a controlar: la ventana se trae al frente y pide atención
        let controlled = st.controlled_by.is_some();
        if controlled && !self.was_controlled {
            ctx.send_viewport_cmd(egui::ViewportCommand::Minimized(false));
            ctx.send_viewport_cmd(egui::ViewportCommand::Focus);
            ctx.send_viewport_cmd(egui::ViewportCommand::RequestUserAttention(egui::UserAttentionType::Critical));
        }
        self.was_controlled = controlled;
        ctx.request_repaint_after(Duration::from_millis(500));

        let p = pal(ctx.theme() == egui::Theme::Dark);
        egui::CentralPanel::default().frame(egui::Frame::new().fill(p.bg).inner_margin(egui::Margin::symmetric(20, 16))).show(ctx, |ui| {
            match st.status {
                Status::Unpaired | Status::Pairing => self.pair_view(ui, &p, &st),
                _ => self.main_view(ui, &p, &st),
            }
        });
    }

    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        self.send(Command::Quit);
        // se deja un instante para que el motor suelte teclas y botones y cierre el canal
        for _ in 0..20 {
            if self.shared.lock().map(|s| s.quit).unwrap_or(true) { break; }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

impl App {
    /// Logo, nombre y versión; a la derecha lo que se le pase (el estado, normalmente).
    fn header(&self, ui: &mut egui::Ui, p: &Pal, right: impl FnOnce(&mut egui::Ui)) {
        ui.horizontal(|ui| {
            ui.image((self.logo.id(), Vec2::splat(34.0)));
            ui.vertical(|ui| {
                ui.spacing_mut().item_spacing.y = 0.0;
                ui.label(RichText::new("Nora Agent").heading());
                ui.label(RichText::new(format!("Versión {VERSION}")).size(12.0).color(p.muted));
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), right);
        });
        ui.add_space(8.0);
    }

    fn pair_view(&mut self, ui: &mut egui::Ui, p: &Pal, st: &State) {
        let busy = st.status == Status::Pairing;
        self.header(ui, p, |_| {});
        ui.add_space(6.0);
        ui.label(RichText::new("Vincula este equipo").size(17.0));
        ui.label(muted(p, "Así alguien de tu sala podrá ayudarte desde Nora. No se aplica nada sin que tú lo aceptes."));
        ui.add_space(6.0);
        let hint = |t: &str| RichText::new(t).color(p.muted.gamma_multiply(0.7));
        ui.label(muted(p, "Dirección de tu Nora"));
        ui.add_enabled(!busy, egui::TextEdit::singleline(&mut self.server).hint_text(hint("https://nora.miempresa.com")).desired_width(f32::INFINITY).margin(egui::Margin::symmetric(10, 8)));
        ui.label(muted(p, "Código de vinculación"));
        let r = ui.add_enabled(!busy, egui::TextEdit::singleline(&mut self.code).hint_text(hint("XXXX-XXXX")).desired_width(f32::INFINITY).margin(egui::Margin::symmetric(10, 8)).font(egui::FontId::monospace(15.0)));
        self.code = self.code.to_uppercase().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(12).collect();
        let enter = r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
        ui.add_space(4.0);
        let ready = !self.server.trim().is_empty() && self.code.len() >= 4;
        let go = primary(ui, if busy { "Vinculando…" } else { "Vincular" }, p.accent, ready && !busy).clicked();
        if (go || (enter && ready)) && !busy {
            self.send(Command::Pair { server: self.server.clone(), code: self.code.clone() });
        }
        if busy {
            ui.horizontal(|ui| { ui.add(egui::Spinner::new().size(14.0)); ui.label(muted(p, "Conectando con Nora…")); });
        }
        if !st.error.is_empty() {
            ui.label(RichText::new(&st.error).color(p.red).size(13.0));
        }
        ui.add_space(6.0);
        ui.label(muted(p, "El código está en Nora: sala › Asistencia › Agente › «Generar código». Vale 10 minutos y se usa una sola vez."));
        self.footer(ui, p, false);
    }

    fn main_view(&mut self, ui: &mut egui::Ui, p: &Pal, st: &State) {
        let (color, status) = match &st.status {
            Status::Connected => (p.green, "Conectado".to_string()),
            Status::Offline(n) => (p.yellow, format!("Sin conexión · {n} s")),
            _ => (p.yellow, "Conectando…".to_string()),
        };
        self.header(ui, p, |ui| pill(ui, color, &status));

        // ---- quién es ----
        let name = if st.user_name.is_empty() { "Usuario de Nora" } else { st.user_name.as_str() };
        group(ui, p, |ui| {
            ui.add_space(12.0);
            ui.horizontal(|ui| {
                avatar(ui, p, name);
                ui.vertical(|ui| {
                    ui.spacing_mut().item_spacing.y = 1.0;
                    ui.add_space(3.0);
                    ui.label(RichText::new(name).size(16.0));
                    let sub = if st.user_email.is_empty() { host_label(&st.server) } else { st.user_email.clone() };
                    ui.label(muted(p, &sub));
                });
            });
            ui.add_space(12.0);
        });

        // ---- lo que impide controlar el equipo ----
        if !st.blocked.is_empty() {
            ui.add_space(4.0);
            egui::Frame::new().fill(tint(p.yellow, 28)).stroke(Stroke::new(1.0_f32, tint(p.yellow, 90))).corner_radius(10).inner_margin(egui::Margin::same(12)).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.label(RichText::new("No se puede controlar este equipo todavía").color(p.yellow));
                ui.label(RichText::new(&st.blocked).size(13.0));
                if cfg!(target_os = "macos") && !self.ax_ok && ui.button("Abrir los ajustes de Accesibilidad").clicked() {
                    platform::open_accessibility_settings();
                }
            });
        }

        // ---- control ----
        ui.add_space(4.0);
        match &st.controlled_by {
            Some(who) => {
                egui::Frame::new().fill(tint(p.red, 26)).stroke(Stroke::new(1.0_f32, tint(p.red, 100))).corner_radius(10).inner_margin(egui::Margin::same(14)).show(ui, |ui| {
                    ui.set_width(ui.available_width());
                    ui.horizontal(|ui| { dot(ui, p.red); ui.label(RichText::new("Control remoto activo").color(p.red)); });
                    ui.label(RichText::new(who).size(16.0));
                    ui.label(muted(p, "Puede mover el ratón y escribir en tu equipo. Tú ves todo lo que hace."));
                    ui.add_space(4.0);
                    if primary(ui, "Detener control", p.red, true).clicked() {
                        self.send(Command::StopControl);
                    }
                });
            }
            None => {
                ui.label(muted(p, "Nadie controla tu equipo. Si alguien lo pide desde Nora, te avisaremos aquí y podrás aceptar o detenerlo."));
            }
        }

        // ---- conexión ----
        section(ui, p, "Conexión");
        group(ui, p, |ui| {
            line(ui, p, true, "Servidor", |ui| value(ui, p, &host_label(&st.server)));
        });

        // ---- este equipo ----
        section(ui, p, "Este equipo");
        group(ui, p, |ui| {
            line(ui, p, true, "Sistema", |ui| value(ui, p, &platform::os_label()));
            if st.screen.0 > 0 {
                line(ui, p, false, "Pantalla", |ui| value(ui, p, &format!("{} × {}", st.screen.0, st.screen.1)));
            }
            line(ui, p, false, "Iniciar con el sistema", |ui| {
                if toggle(ui, p, &mut self.autostart).changed() {
                    match platform::set_autostart(self.autostart) {
                        Ok(()) => self.autostart_err.clear(),
                        Err(e) => { self.autostart = !self.autostart; self.autostart_err = e; }
                    }
                }
            });
        });
        if !self.autostart_err.is_empty() {
            ui.label(RichText::new(&self.autostart_err).color(p.red).size(12.0));
        }

        ui.add_space(8.0);
        if self.confirm_reset {
            egui::Frame::new().fill(p.group).stroke(Stroke::new(1.0_f32, p.hairline)).corner_radius(10).inner_margin(egui::Margin::same(12)).show(ui, |ui| {
                ui.set_width(ui.available_width());
                ui.label("¿Desvincular este equipo de tu cuenta? Tendrás que generar un código nuevo para volver a usarlo.");
                ui.horizontal(|ui| {
                    if ui.add(egui::Button::new(RichText::new("Desvincular").color(Color32::WHITE)).fill(p.red)).clicked() {
                        self.confirm_reset = false;
                        self.send(Command::Reset);
                    }
                    if ui.button("Cancelar").clicked() { self.confirm_reset = false; }
                });
            });
        } else if ui.add(egui::Button::new(RichText::new("Desvincular este equipo").size(13.0).color(p.red)).frame(false)).clicked() {
            self.confirm_reset = true;
        }
        self.footer(ui, p, true);
    }

    fn footer(&self, ui: &mut egui::Ui, p: &Pal, quit_button: bool) {
        ui.with_layout(egui::Layout::bottom_up(egui::Align::Min), |ui| {
            ui.horizontal(|ui| {
                ui.label(RichText::new("Cerrar esta ventana detiene el agente.").size(12.0).color(p.muted));
                if quit_button {
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button("Salir").clicked() { ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close); }
                    });
                }
            });
            if platform::wayland_session() {
                ui.label(RichText::new("Sesión Wayland detectada: no permite controlar el equipo.").size(12.0).color(p.yellow));
            }
        });
    }
}

/// Interruptor.
fn toggle(ui: &mut egui::Ui, p: &Pal, on: &mut bool) -> egui::Response {
    let size = Vec2::new(38.0, 22.0);
    let (rect, mut resp) = ui.allocate_exact_size(size, egui::Sense::click());
    if resp.clicked() {
        *on = !*on;
        resp.mark_changed();
    }
    let t = ui.ctx().animate_bool(resp.id, *on);
    let bg = p.switch_off.lerp_to_gamma(p.accent, t);
    ui.painter().rect_filled(rect, 11.0, bg);
    let x = rect.left() + 11.0 + t * (size.x - 22.0);
    ui.painter().circle_filled(egui::pos2(x, rect.center().y), 8.0, Color32::WHITE);
    resp
}

pub fn run(server_hint: String, initial_pair: Option<(String, String)>, minimized: bool) -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Nora Agent")
            .with_inner_size([420.0, 640.0])
            .with_min_inner_size([380.0, 600.0])
            .with_icon(window_icon()),
        ..Default::default()
    };
    eframe::run_native("Nora Agent", options, Box::new(move |cc| {
        if let Ok(t) = std::env::var("NORA_AGENT_THEME") {
            // para probar el aspecto: NORA_AGENT_THEME=light|dark (si no, se sigue el tema del sistema)
            cc.egui_ctx.options_mut(|o| o.theme_preference = match t.as_str() { "light" => egui::ThemePreference::Light, "dark" => egui::ThemePreference::Dark, _ => egui::ThemePreference::System });
        }
        let ctx = cc.egui_ctx.clone();
        let worker = Worker::new(move || ctx.request_repaint());
        let shared = worker.shared.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let done = shared.clone();
        std::thread::spawn(move || {
            worker.run(rx, initial_pair);
            if let Ok(mut s) = done.lock() { s.quit = true; }
        });
        let hint = shared.lock().map(|s| s.server.clone()).unwrap_or_default();
        Ok(Box::new(App::new(cc, shared, tx, if hint.is_empty() { server_hint } else { hint }, minimized)))
    }))
}
