//! La ventana de Nora Agent: pequeña, nativa y sin nada que sobre. Muestra si está vinculado y conectado, quién controla el equipo (con un botón
//! grande para detenerlo) y los pocos ajustes que hacen falta.

use crate::core::{host_label, Command, Shared, State, Status, Worker, VERSION};
use crate::{icon, platform};
use eframe::egui::{self, Color32, RichText, Stroke, Vec2};
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

const BG: Color32 = Color32::from_rgb(11, 11, 12);
const SURFACE: Color32 = Color32::from_rgb(22, 22, 25);
const SURFACE_2: Color32 = Color32::from_rgb(34, 34, 38);
const HAIRLINE: Color32 = Color32::from_rgb(44, 44, 49);
const TEXT: Color32 = Color32::from_rgb(244, 244, 246);
const MUTED: Color32 = Color32::from_rgb(160, 160, 170);
const ACCENT: Color32 = Color32::from_rgb(124, 106, 247);
const GREEN: Color32 = Color32::from_rgb(76, 195, 138);
const YELLOW: Color32 = Color32::from_rgb(231, 179, 94);
const RED: Color32 = Color32::from_rgb(240, 98, 98);
const RED_BTN: Color32 = Color32::from_rgb(200, 58, 62);

pub fn window_icon() -> egui::IconData {
    egui::IconData { rgba: icon::rgba(256), width: 256, height: 256 }
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
        let logo = cc.egui_ctx.load_texture("logo", egui::ColorImage::from_rgba_unmultiplied([128, 128], &icon::rgba(128)), egui::TextureOptions::LINEAR);
        Self {
            shared, tx, logo, server: server_hint, code: String::new(), autostart: platform::autostart_enabled(), ax_ok: platform::accessibility_granted(),
            ax_checked: Instant::now(), was_controlled: false, confirm_reset: false, autostart_err: String::new(), start_minimized,
        }
    }

    fn send(&self, c: Command) {
        let _ = self.tx.send(c);
    }
}

fn style(ctx: &egui::Context) {
    let mut v = egui::Visuals::dark();
    v.panel_fill = BG;
    v.window_fill = SURFACE;
    v.extreme_bg_color = SURFACE_2;
    v.override_text_color = Some(TEXT);
    v.selection.bg_fill = ACCENT;
    v.selection.stroke = Stroke::new(1.0_f32, Color32::WHITE);
    v.hyperlink_color = ACCENT;
    let r = egui::CornerRadius::same(9);
    for w in [&mut v.widgets.noninteractive, &mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
        w.corner_radius = r;
    }
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0_f32, HAIRLINE);
    v.widgets.noninteractive.fg_stroke = Stroke::new(1.0_f32, TEXT);
    v.widgets.inactive.bg_fill = SURFACE_2;
    v.widgets.inactive.weak_bg_fill = SURFACE_2;
    v.widgets.inactive.bg_stroke = Stroke::new(1.0_f32, HAIRLINE);
    v.widgets.hovered.bg_fill = Color32::from_rgb(48, 48, 54);
    v.widgets.hovered.weak_bg_fill = Color32::from_rgb(48, 48, 54);
    v.widgets.hovered.bg_stroke = Stroke::new(1.0_f32, Color32::from_rgb(70, 70, 78));
    v.widgets.active.bg_fill = Color32::from_rgb(58, 58, 66);
    v.widgets.active.weak_bg_fill = Color32::from_rgb(58, 58, 66);
    ctx.set_visuals(v);
    ctx.style_mut(|s| {
        s.spacing.item_spacing = Vec2::new(10.0, 10.0);
        s.spacing.button_padding = Vec2::new(14.0, 8.0);
        s.spacing.interact_size.y = 34.0;
        s.text_styles.insert(egui::TextStyle::Heading, egui::FontId::proportional(20.0));
        s.text_styles.insert(egui::TextStyle::Body, egui::FontId::proportional(14.0));
        s.text_styles.insert(egui::TextStyle::Button, egui::FontId::proportional(14.0));
        s.text_styles.insert(egui::TextStyle::Small, egui::FontId::proportional(12.0));
    });
}

fn card<R>(ui: &mut egui::Ui, fill: Color32, stroke: Color32, add: impl FnOnce(&mut egui::Ui) -> R) -> R {
    egui::Frame::new().fill(fill).stroke(Stroke::new(1.0_f32, stroke)).corner_radius(12).inner_margin(egui::Margin::same(14)).show(ui, |ui| {
        ui.set_width(ui.available_width());
        add(ui)
    }).inner
}

fn dot(ui: &mut egui::Ui, color: Color32) {
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(10.0), egui::Sense::hover());
    ui.painter().circle_filled(rect.center(), 5.0, color);
}

fn primary(ui: &mut egui::Ui, text: &str, color: Color32, enabled: bool) -> egui::Response {
    ui.add_enabled_ui(enabled, |ui| ui.add_sized([ui.available_width(), 40.0], egui::Button::new(RichText::new(text).strong().color(Color32::WHITE)).fill(color))).inner
}

fn muted(text: &str) -> RichText {
    RichText::new(text).color(MUTED).size(13.0)
}

fn row(ui: &mut egui::Ui, label: &str, value: &str) {
    ui.horizontal(|ui| {
        ui.label(muted(label));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| ui.label(RichText::new(value).size(13.0)));
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

        egui::CentralPanel::default().frame(egui::Frame::new().fill(BG).inner_margin(egui::Margin::symmetric(22, 18))).show(ctx, |ui| {
            // ---- cabecera ----
            ui.horizontal(|ui| {
                ui.image((self.logo.id(), Vec2::splat(40.0)));
                ui.vertical(|ui| {
                    ui.add_space(1.0);
                    ui.label(RichText::new("Nora Agent").heading().strong());
                    ui.label(muted("Asistencia remota con tu permiso"));
                });
                ui.with_layout(egui::Layout::right_to_left(egui::Align::TOP), |ui| ui.label(RichText::new(format!("v{VERSION}")).small().color(MUTED)));
            });
            ui.add_space(8.0);

            match st.status {
                Status::Unpaired | Status::Pairing => self.pair_view(ui, &st),
                _ => self.main_view(ui, ctx, &st),
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
    fn pair_view(&mut self, ui: &mut egui::Ui, st: &State) {
        let busy = st.status == Status::Pairing;
        card(ui, SURFACE, HAIRLINE, |ui| {
            ui.label(RichText::new("Vincula este equipo").size(17.0).strong());
            ui.label(muted("Para que alguien de tu sala pueda ayudarte, vincula este programa con tu cuenta de Nora. Solo se aplica algo cuando tú lo aceptas."));
            ui.add_space(6.0);
            ui.label(muted("Dirección de tu Nora"));
            ui.add_enabled(!busy, egui::TextEdit::singleline(&mut self.server).hint_text(RichText::new("https://nora.miempresa.com").color(Color32::from_rgb(96, 96, 106))).desired_width(f32::INFINITY).margin(egui::Margin::symmetric(10, 9)));
            ui.label(muted("Código de vinculación"));
            let r = ui.add_enabled(!busy, egui::TextEdit::singleline(&mut self.code).hint_text(RichText::new("XXXX-XXXX").color(Color32::from_rgb(96, 96, 106))).desired_width(f32::INFINITY).margin(egui::Margin::symmetric(10, 9)).font(egui::FontId::monospace(16.0)));
            self.code = self.code.to_uppercase().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(12).collect();
            let enter = r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
            ui.add_space(4.0);
            let ready = !self.server.trim().is_empty() && self.code.len() >= 4;
            let go = ui.horizontal(|ui| {
                let clicked = primary(ui, if busy { "Vinculando…" } else { "Vincular" }, ACCENT, ready && !busy).clicked();
                clicked
            }).inner;
            if (go || (enter && ready)) && !busy {
                self.send(Command::Pair { server: self.server.clone(), code: self.code.clone() });
            }
            if busy {
                ui.horizontal(|ui| { ui.add(egui::Spinner::new().size(14.0)); ui.label(muted("Conectando con Nora…")); });
            }
            if !st.error.is_empty() {
                ui.label(RichText::new(&st.error).color(RED).size(13.0));
            }
        });
        ui.add_space(4.0);
        ui.label(muted("¿Dónde está el código? En Nora: sala › Asistencia › Agente › «Generar código». Vale 10 minutos y se usa una sola vez."));
        self.footer(ui, false);
    }

    fn main_view(&mut self, ui: &mut egui::Ui, ctx: &egui::Context, st: &State) {
        // ---- estado de la conexión ----
        card(ui, SURFACE, HAIRLINE, |ui| {
            ui.horizontal(|ui| {
                let (color, text) = match &st.status {
                    Status::Connected => (GREEN, "Conectado a Nora".to_string()),
                    Status::Offline(n) => (YELLOW, format!("Sin conexión · reintentando en {n} s")),
                    _ => (YELLOW, "Conectando…".to_string()),
                };
                dot(ui, color);
                ui.label(RichText::new(text).strong());
            });
            ui.label(muted(&host_label(&st.server)));
        });

        // ---- lo que impide controlar el equipo ----
        if !st.blocked.is_empty() {
            card(ui, Color32::from_rgb(44, 36, 20), Color32::from_rgb(98, 76, 30), |ui| {
                ui.label(RichText::new("No se puede controlar este equipo todavía").strong().color(YELLOW));
                ui.label(RichText::new(&st.blocked).size(13.0));
                if cfg!(target_os = "macos") && !self.ax_ok && ui.button("Abrir los ajustes de Accesibilidad").clicked() {
                    platform::open_accessibility_settings();
                }
            });
        }

        // ---- control ----
        match &st.controlled_by {
            Some(who) => {
                card(ui, Color32::from_rgb(56, 22, 24), Color32::from_rgb(130, 44, 48), |ui| {
                    ui.horizontal(|ui| { dot(ui, RED); ui.label(RichText::new("Control remoto activo").strong().color(RED)); });
                    ui.label(RichText::new(who).size(16.0).strong());
                    ui.label(muted("Esta persona puede mover el ratón y escribir en tu equipo. Tú ves todo lo que hace."));
                    ui.add_space(4.0);
                    if primary(ui, "Detener control", RED_BTN, true).clicked() {
                        self.send(Command::StopControl);
                    }
                });
            }
            None => {
                card(ui, SURFACE, HAIRLINE, |ui| {
                    ui.label(RichText::new("Nadie controla tu equipo").strong());
                    ui.label(muted("Cuando alguien pida el control desde Nora, te saldrá un aviso en el navegador y aquí. No se aplica nada sin que lo aceptes."));
                });
            }
        }

        // ---- datos ----
        card(ui, SURFACE, HAIRLINE, |ui| {
            row(ui, "Sistema", platform::os_label());
            if st.screen.0 > 0 {
                row(ui, "Pantalla controlable", &format!("{} × {}", st.screen.0, st.screen.1));
            }
            ui.horizontal(|ui| {
                ui.label(muted("Iniciar con el sistema"));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if toggle(ui, &mut self.autostart).changed() {
                        match platform::set_autostart(self.autostart) {
                            Ok(()) => self.autostart_err.clear(),
                            Err(e) => { self.autostart = !self.autostart; self.autostart_err = e; }
                        }
                    }
                });
            });
            if !self.autostart_err.is_empty() {
                ui.label(RichText::new(&self.autostart_err).color(RED).size(12.0));
            }
        });

        ui.add_space(2.0);
        if self.confirm_reset {
            card(ui, SURFACE, HAIRLINE, |ui| {
                ui.label("¿Desvincular este equipo de tu cuenta? Tendrás que generar un código nuevo para volver a usarlo.");
                ui.horizontal(|ui| {
                    if ui.add(egui::Button::new(RichText::new("Desvincular").color(Color32::WHITE)).fill(RED)).clicked() {
                        self.confirm_reset = false;
                        self.send(Command::Reset);
                    }
                    if ui.button("Cancelar").clicked() { self.confirm_reset = false; }
                });
            });
        } else if ui.add(egui::Button::new(muted("Desvincular este equipo")).frame(false)).clicked() {
            self.confirm_reset = true;
        }
        self.footer(ui, true);
        let _ = ctx;
    }

    fn footer(&self, ui: &mut egui::Ui, quit_button: bool) {
        ui.with_layout(egui::Layout::bottom_up(egui::Align::Min), |ui| {
            ui.horizontal(|ui| {
                ui.label(RichText::new("Cerrar esta ventana detiene el agente.").size(12.0).color(MUTED));
                if quit_button {
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button("Salir").clicked() { ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close); }
                    });
                }
            });
            if platform::wayland_session() {
                ui.label(RichText::new("Sesión Wayland detectada: no permite controlar el equipo.").size(12.0).color(YELLOW));
            }
        });
    }
}

/// Interruptor tipo iOS.
fn toggle(ui: &mut egui::Ui, on: &mut bool) -> egui::Response {
    let size = Vec2::new(40.0, 22.0);
    let (rect, mut resp) = ui.allocate_exact_size(size, egui::Sense::click());
    if resp.clicked() {
        *on = !*on;
        resp.mark_changed();
    }
    let t = ui.ctx().animate_bool(resp.id, *on);
    let bg = Color32::from_rgb((58.0 + (124.0 - 58.0) * t) as u8, (58.0 + (106.0 - 58.0) * t) as u8, (66.0 + (247.0 - 66.0) * t) as u8);
    ui.painter().rect_filled(rect, 11.0, bg);
    let x = rect.left() + 11.0 + t * (size.x - 22.0);
    ui.painter().circle_filled(egui::pos2(x, rect.center().y), 8.0, Color32::WHITE);
    resp
}

pub fn run(server_hint: String, initial_pair: Option<(String, String)>, minimized: bool) -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Nora Agent")
            .with_inner_size([440.0, 660.0])
            .with_min_inner_size([400.0, 620.0])
            .with_icon(window_icon()),
        ..Default::default()
    };
    eframe::run_native("Nora Agent", options, Box::new(move |cc| {
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
