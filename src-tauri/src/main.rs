#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "linux"))]
compile_error!("O cliente Fix.io Linux deve ser compilado no Linux.");

mod embedded;
mod bench;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{env, fs, path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Copy, Default)]
struct ContentBounds {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    viewport_height: f64,
}

#[derive(Default, Clone)]
struct UiSnapshot {
    active_page: String,
    whatsapp_bounds: Option<ContentBounds>,
    bench_bounds: Option<ContentBounds>,
    content_bounds: Option<ContentBounds>,
    obscured: bool,
}

#[derive(Default)]
struct UiState(Mutex<UiSnapshot>);

fn snapshot(app: &tauri::AppHandle) -> Result<UiSnapshot> {
    let state = app.state::<UiState>();
    let snapshot = state.0.lock().map_err(|e| e.to_string())?.clone();
    Ok(snapshot)
}

fn content_bounds(message: &Value) -> Option<ContentBounds> {
    let bounds = ContentBounds {
        left: message["left"].as_f64()?,
        top: message["top"].as_f64()?,
        width: message["width"].as_f64()?,
        height: message["height"].as_f64()?,
        viewport_width: message["viewportWidth"].as_f64()?,
        viewport_height: message["viewportHeight"].as_f64()?,
    };
    if [bounds.left, bounds.top, bounds.width, bounds.height, bounds.viewport_width, bounds.viewport_height]
        .into_iter().all(f64::is_finite)
        && bounds.width >= 0.0 && bounds.height >= 0.0
        && bounds.viewport_width >= 1.0 && bounds.viewport_height >= 1.0
    { Some(bounds) } else { None }
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct LinuxConfig {
    wine_executable: Option<String>,
    // Reuse the installed environment; never replace it with a fresh prefix.
    wine_prefix: Option<String>,
}

fn home() -> Result<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
        .ok_or_else(|| "HOME não está definido.".into())
}

fn data_dir() -> Result<PathBuf> {
    Ok(env::var_os("XDG_DATA_HOME").map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or(home()?.join(".local/share")).join("fixio"))
}

fn load_config() -> LinuxConfig {
    data_dir().ok().and_then(|dir| fs::read_to_string(dir.join("linux.json")).ok())
        .and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

fn save_config(config: &LinuxConfig) -> Result<()> {
    let dir = data_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("linux.json"), serde_json::to_string_pretty(config).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn command_exists(program: &str) -> bool {
    let Some(path) = env::var_os("PATH") else { return false; };
    env::split_paths(&path).any(|dir| dir.join(program).is_file())
}

fn expand(path: &str) -> PathBuf {
    if path == "~" { return home().unwrap_or_default(); }
    if let Some(rest) = path.strip_prefix("~/") { return home().unwrap_or_default().join(rest); }
    PathBuf::from(path)
}

fn emit_status(app: &tauri::AppHandle, target: &str, state: &str, message: impl Into<String>) -> Result<()> {
    app.emit("desktop-status", json!({
        "type": "desktop-status", "target": target, "state": state, "message": message.into(),
    })).map_err(|e| e.to_string())
}

async fn choose_executable() -> Option<PathBuf> {
    rfd::AsyncFileDialog::new().add_filter("Programas Windows", &["exe"])
        .set_title("Escolha o programa da bancada").pick_file().await
        .map(|file| file.path().to_path_buf())
}

#[tauri::command]
async fn desktop_message(app: tauri::AppHandle, message: Value) -> Result<()> {
    let kind = message["type"].as_str().unwrap_or_default();
    match kind {
        "navigate" => {
            let page = message["page"].as_str().unwrap_or_default();
            {
                let state = app.state::<UiState>();
                let mut ui = state.0.lock().map_err(|e| e.to_string())?;
                ui.active_page = page.into();
            }
            embedded::sync(&app, false).await?;
            if page == "techunion" { bench::report(&app)?; }
        }
        "whatsapp-bounds" | "techunion-bounds" | "content-bounds" => {
            if let Some(bounds) = content_bounds(&message) {
                {
                    let state = app.state::<UiState>();
                    let mut ui = state.0.lock().map_err(|e| e.to_string())?;
                    match kind {
                        "whatsapp-bounds" => ui.whatsapp_bounds = Some(bounds),
                        "techunion-bounds" => ui.bench_bounds = Some(bounds),
                        _ => {
                            ui.content_bounds = Some(bounds);
                            ui.obscured = message["obscured"].as_bool().unwrap_or(false);
                        }
                    }
                }
                embedded::sync(&app, false).await?;
            }
        }
        "whatsapp-retry" => { embedded::sync(&app, true).await?; }
        "techunion-choose" => {
            if bench::is_active(&app)? {
                return Err("Encerre a sessão antes de trocar o executável.".into());
            }
            if let Some(path) = choose_executable().await {
                let mut config = load_config();
                config.wine_executable = Some(path.to_string_lossy().into_owned());
                save_config(&config)?;
            }
            bench::selection_changed(&app)?;
        }
        "techunion-open" => {
            let state = snapshot(&app)?;
            if state.active_page != "techunion" || state.obscured {
                return Err("Abra a Bancada para iniciar o programa dentro dela.".into());
            }
            if bench::is_active(&app)? { return bench::report(&app); }
            let config = load_config();
            let path = config.wine_executable.as_deref().map(expand)
                .ok_or("Escolha o executável antes de abrir a bancada.")?;
            let path = fs::canonicalize(path).map_err(|e| format!("Executável não encontrado: {e}"))?;
            bench::preflight(&path)?;
            embedded::start_bench(&app, path).await?;
        }
        "techunion-stop" => { bench::stop(&app)?; }
        // Stale frontend commands cannot launch on the host desktop.
        "techunion-external" | "open-application" => {
            return Err("Abertura externa desativada. Use Abrir na bancada.".into());
        }
        "notifications-ready" => {}
        _ => {}
    }
    Ok(())
}

#[tauri::command]
async fn close_whatsapp(app: tauri::AppHandle) -> Result<()> {
    embedded::hide_whatsapp(&app).await
}

fn main() {
    // Xephyr needs an X11 host, which XWayland supplies within a Wayland session.
    // Without DISPLAY, WhatsApp still uses native GTK; the bench fails closed.
    if env::var_os("DISPLAY").is_some() { env::set_var("GDK_BACKEND", "x11"); }
    tauri::Builder::default()
        .manage(UiState::default())
        .manage(bench::BenchState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![desktop_message, close_whatsapp])
        .build(tauri::generate_context!())
        .expect("Não foi possível iniciar o Fix.io Linux")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) { bench::shutdown(app); }
        });
}
