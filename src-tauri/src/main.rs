#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "linux"))]
compile_error!("O cliente Fix.io Linux deve ser compilado no Linux.");

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env, fs,
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use tauri::webview::{Webview, WebviewBuilder};

type Result<T> = std::result::Result<T, String>;

const WHATSAPP_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Clone, Copy)]
struct ContentBounds {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}

#[derive(Default, Clone)]
struct UiSnapshot {
    active_page: String,
    whatsapp_bounds: Option<ContentBounds>,
}

struct TrackedWineProcess {
    executable: PathBuf,
    pid: u32,
    running: bool,
}

#[derive(Default)]
struct UiState {
    snapshot: Mutex<UiSnapshot>,
    wine_processes: Arc<Mutex<Vec<TrackedWineProcess>>>,
}

fn content_bounds(message: &Value) -> Option<ContentBounds> {
    let bounds = ContentBounds {
        left: message["left"].as_f64()?,
        top: message["top"].as_f64()?,
        width: message["width"].as_f64()?,
        height: message["height"].as_f64()?,
    };
    if [bounds.left, bounds.top, bounds.width, bounds.height]
        .into_iter()
        .all(f64::is_finite)
        && bounds.width >= 1.0
        && bounds.height >= 1.0
    {
        Some(bounds)
    } else {
        None
    }
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct LinuxConfig {
    wine_executable: Option<String>,
    wine_prefix: Option<String>,
}

fn home() -> Result<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME não está definido. Execute o Fix.io em uma sessão Linux normal.".into())
}

fn data_dir() -> Result<PathBuf> {
    Ok(env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or(home()?.join(".local/share"))
        .join("fixio"))
}

fn config_path() -> Result<PathBuf> {
    Ok(data_dir()?.join("linux.json"))
}

fn load_config() -> LinuxConfig {
    config_path()
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_config(config: &LinuxConfig) -> Result<()> {
    let path = config_path()?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|error| error.to_string())?;
    let text = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

fn command_exists(program: &str) -> bool {
    let Some(path) = env::var_os("PATH") else {
        return false;
    };

    env::split_paths(&path)
        .any(|dir| dir.join(program).is_file())
}

fn expand(path: &str) -> PathBuf {
    if path == "~" {
        return home().unwrap_or_default();
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return home().unwrap_or_default().join(rest);
    }
    PathBuf::from(path)
}

fn wine_command() -> Result<&'static str> {
    if command_exists("wine") {
        Ok("wine")
    } else if command_exists("wine64") {
        Ok("wine64")
    } else {
        Err("Wine não foi encontrado. Instale Wine antes de executar o programa da bancada.".into())
    }
}

fn emit_status(app: &tauri::AppHandle, target: &str, state: &str, message: impl Into<String>) -> Result<()> {
    app.emit("desktop-status", json!({
        "type": "desktop-status",
        "target": target,
        "state": state,
        "message": message.into(),
    })).map_err(|error| error.to_string())
}

fn active_wine_pid(state: &UiState, executable: &PathBuf) -> Result<Option<u32>> {
    let processes = state.wine_processes.lock().map_err(|error| error.to_string())?;
    Ok(processes
        .iter()
        .find(|process| process.running && process.executable == *executable)
        .map(|process| process.pid))
}

fn launch_wine(app: &tauri::AppHandle, state: &UiState, target: &str, executable: PathBuf, prefix: Option<String>) -> Result<u32> {
    if !executable.is_file() {
        return Err(format!("Executável não encontrado: {}", executable.display()));
    }

    let mut processes = state.wine_processes.lock().map_err(|error| error.to_string())?;
    processes.retain(|process| process.running);
    if let Some(process) = processes
        .iter()
        .find(|process| process.running && process.executable == executable)
    {
        let pid = process.pid;
        drop(processes);
        emit_status(
            app,
            target,
            "external",
            format!("Este programa já está aberto pelo Wine (PID {pid}). Não iniciei outra instância."),
        )?;
        return Ok(pid);
    }

    let wine = wine_command()?;
    let mut command = Command::new(wine);
    command.arg(&executable);
    if let Some(prefix) = prefix.filter(|value| !value.trim().is_empty()) {
        let prefix = expand(&prefix);
        if !prefix.is_absolute() {
            return Err("O prefixo Wine precisa usar um caminho absoluto.".into());
        }
        command.env("WINEPREFIX", prefix);
    }

    let mut child = command.spawn().map_err(|error| format!("Não foi possível iniciar Wine: {error}"))?;
    let pid = child.id();
    processes.push(TrackedWineProcess {
        executable: executable.clone(),
        pid,
        running: true,
    });
    drop(processes);

    let tracked_processes = Arc::clone(&state.wine_processes);
    std::thread::spawn(move || {
        let _ = child.wait();
        if let Ok(mut processes) = tracked_processes.lock() {
            if let Some(process) = processes.iter_mut().find(|process| process.pid == pid) {
                process.running = false;
            }
        }
    });
    emit_status(app, target, "external", format!("Programa iniciado pelo Wine (PID {pid}) em uma janela própria."))?;
    Ok(pid)
}

async fn choose_executable() -> Option<PathBuf> {
    rfd::AsyncFileDialog::new()
        .add_filter("Programas Windows", &["exe"])
        .set_title("Escolha o programa Windows da bancada")
        .pick_file()
        .await
        .map(|file| file.path().to_path_buf())
}

fn whatsapp_url() -> Result<WebviewUrl> {
    Ok(WebviewUrl::External(
        "https://web.whatsapp.com/".parse().map_err(|error| format!("URL inválida: {error}"))?,
    ))
}

fn place_whatsapp_child(webview: &Webview, bounds: ContentBounds) -> Result<()> {
    webview
        .set_position(LogicalPosition::new(bounds.left, bounds.top))
        .map_err(|error| error.to_string())?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn place_whatsapp_window(main: &tauri::Window, window: &tauri::WebviewWindow) -> Result<()> {
    let origin = main.outer_position().map_err(|error| error.to_string())?;
    let size = main.inner_size().map_err(|error| error.to_string())?;
    let width = (size.width as f64 * 0.86).clamp(720.0, 1400.0) as u32;
    let height = (size.height as f64 * 0.84).clamp(520.0, 900.0) as u32;
    let x = origin.x + ((size.width.saturating_sub(width)) / 2) as i32;
    let y = origin.y + ((size.height.saturating_sub(height)) / 2) as i32;
    window.set_size(PhysicalSize::new(width, height)).map_err(|error| error.to_string())?;
    window.set_position(PhysicalPosition::new(x, y)).map_err(|error| error.to_string())?;
    Ok(())
}

fn open_whatsapp(app: &tauri::AppHandle, bounds: Option<ContentBounds>) -> Result<()> {
    let main = app.get_window("main").ok_or("Janela principal não encontrada.")?;
    if let Some(webview) = app.get_webview("whatsapp") {
        if let Some(bounds) = bounds {
            place_whatsapp_child(&webview, bounds)?;
            webview.show().map_err(|error| error.to_string())?;
            webview.set_focus().map_err(|error| error.to_string())?;
        } else {
            webview.hide().map_err(|error| error.to_string())?;
        }
        return Ok(());
    }
    if let Some(window) = app.get_webview_window("whatsapp") {
        place_whatsapp_window(&main, &window)?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let webview_data = data_dir()?.join("webview/whatsapp");
    fs::create_dir_all(&webview_data).map_err(|error| format!("Não foi possível preparar o perfil do WhatsApp: {error}"))?;
    let builder = WebviewBuilder::new("whatsapp", whatsapp_url()?)
        .user_agent(WHATSAPP_USER_AGENT)
        .data_directory(webview_data);
    match main.add_child(builder, LogicalPosition::new(0.0, 0.0), LogicalSize::new(1.0, 1.0)) {
        Ok(webview) => {
            if let Some(bounds) = bounds {
                place_whatsapp_child(&webview, bounds)?;
                webview.show().map_err(|error| error.to_string())?;
                webview.set_focus().map_err(|error| error.to_string())?;
            } else {
                webview.hide().map_err(|error| error.to_string())?;
            }
            Ok(())
        }
        Err(error) => {
            let window = WebviewWindowBuilder::new(app, "whatsapp", whatsapp_url()?)
                .title("Fix.io · WhatsApp Web")
                .user_agent(WHATSAPP_USER_AGENT)
                .data_directory(data_dir()?.join("webview/whatsapp"))
                .inner_size(900.0, 680.0)
                .min_inner_size(720.0, 520.0)
                .visible(false)
                .build()
                .map_err(|fallback| format!("WebView filha indisponível ({error}); fallback também falhou: {fallback}"))?;
            place_whatsapp_window(&main, &window)?;
            window.show().map_err(|error| error.to_string())?;
            window.set_focus().map_err(|error| error.to_string())?;
            Ok(())
        }
    }
}

#[tauri::command]
async fn desktop_message(app: tauri::AppHandle, message: Value) -> Result<()> {
    let kind = message["type"].as_str().unwrap_or_default();
    match kind {
        "navigate" => {
            let page = message["page"].as_str().unwrap_or_default().to_string();
            let snapshot = {
                let ui_state = app.state::<UiState>();
                let mut state = ui_state.snapshot.lock().map_err(|error| error.to_string())?;
                state.active_page = page.clone();
                state.clone()
            };
            if page == "whatsapp" {
                emit_status(&app, "whatsapp", "loading", "Abrindo WhatsApp Web pelo WebKitGTK…")?;
                match open_whatsapp(&app, snapshot.whatsapp_bounds) {
                    Ok(()) if snapshot.whatsapp_bounds.is_some() => {
                        emit_status(&app, "whatsapp", "ready", "WhatsApp Web aberto na área de atendimento.")?;
                    }
                    Ok(()) => {}
                    Err(error) => emit_status(&app, "whatsapp", "error", format!("Não foi possível abrir o WhatsApp Web: {error}"))?,
                }
            } else if message["page"].as_str() == Some("techunion") {
                let configured = load_config()
                    .wine_executable
                    .as_deref()
                    .map(expand)
                    .is_some_and(|path| path.is_file());
                let message = if configured {
                    "Bancada pronta. O Wine abre o programa em janela própria; incorporá-lo nesta área ainda não está disponível no cliente Linux."
                } else {
                    "Escolha o executável da bancada. No Linux, ele será aberto em janela própria pelo Wine."
                };
                emit_status(&app, "techunion", "ready", message)?;
            } else if let Some(webview) = app.get_webview("whatsapp") {
                let _ = webview.hide();
            } else if let Some(window) = app.get_webview_window("whatsapp") {
                let _ = window.hide();
            }
        }
        "whatsapp-bounds" => {
            if let Some(bounds) = content_bounds(&message) {
                let active = {
                    let ui_state = app.state::<UiState>();
                    let mut state = ui_state.snapshot.lock().map_err(|error| error.to_string())?;
                    state.whatsapp_bounds = Some(bounds);
                    state.active_page == "whatsapp"
                };
                if active {
                    if let Some(webview) = app.get_webview("whatsapp") {
                        match place_whatsapp_child(&webview, bounds) {
                            Ok(()) => {
                                webview.show().map_err(|error| error.to_string())?;
                                emit_status(&app, "whatsapp", "ready", "WhatsApp Web aberto na área de atendimento.")?;
                            }
                            Err(error) => emit_status(&app, "whatsapp", "error", format!("Não foi possível ajustar a área do WhatsApp: {error}"))?,
                        }
                    }
                }
            }
        }
        "techunion-open" => {
            let state = app.state::<UiState>();
            let configured = load_config()
                .wine_executable
                .as_deref()
                .map(expand);
            let active = configured
                .as_ref()
                .map(|path| active_wine_pid(&state, path))
                .transpose()?;
            let (status, message) = match active {
                Some(Some(pid)) => (
                    "external",
                    format!(
                        "O programa continua aberto pelo Wine (PID {pid}). Este cliente Linux ainda não incorpora a janela à área da Bancada; esta ação não iniciou outra instância. Use Alt+Tab ou a barra de tarefas para voltar à janela."
                    ),
                ),
                Some(None) => (
                    "ready",
                    "A incorporação de janelas Wine ainda não está implementada neste cliente Linux. Esta ação não iniciou o programa; se ele já estiver aberto, volte à janela pela barra de tarefas ou com Alt+Tab.".into(),
                ),
                None => (
                    "ready",
                    "A incorporação de janelas Wine ainda não está implementada neste cliente Linux. Esta ação não iniciou o programa; escolha um executável e use ‘Abrir em janela própria’ para executá-lo.".into(),
                ),
            };
            emit_status(&app, "techunion", status, message)?;
        }
        "open-application" | "techunion-external" | "techunion-choose" => {
            let target = if kind.starts_with("techunion") { "techunion" } else { "application" };
            emit_status(&app, target, "busy", "Preparando o programa da bancada…")?;
            let choose = kind.ends_with("choose") || message["choose"].as_bool().unwrap_or(false);
            let mut config = load_config();
            let executable = if choose {
                choose_executable().await
            } else {
                let saved = config
                    .wine_executable
                    .as_deref()
                    .map(expand)
                    .filter(|path| path.is_file());
                match saved {
                    Some(path) => Some(path),
                    None => choose_executable().await,
                }
            };
            let Some(executable) = executable else {
                emit_status(&app, target, "error", "Escolha o executável Windows da bancada. Ele será executado pelo Wine.")?;
                return Ok(());
            };
            config.wine_executable = Some(executable.to_string_lossy().into_owned());
            save_config(&config)?;
            if let Err(error) = launch_wine(&app, &app.state::<UiState>(), target, executable, config.wine_prefix) {
                emit_status(&app, target, "error", error)?;
            }
        }
        "whatsapp-retry" => {
            let snapshot = app.state::<UiState>().snapshot.lock().map_err(|error| error.to_string())?.clone();
            match open_whatsapp(&app, snapshot.whatsapp_bounds) {
                Ok(()) if snapshot.whatsapp_bounds.is_some() => {
                    emit_status(&app, "whatsapp", "ready", "WhatsApp Web aberto na área de atendimento.")?;
                }
                Ok(()) => {}
                Err(error) => emit_status(&app, "whatsapp", "error", format!("Não foi possível abrir o WhatsApp Web: {error}"))?,
            }
        }
        "notifications-ready" | "content-bounds" | "techunion-bounds" => {}
        _ => {}
    }
    Ok(())
}

#[tauri::command]
fn close_whatsapp(app: tauri::AppHandle) -> Result<()> {
    if let Some(webview) = app.get_webview("whatsapp") {
        webview.hide().map_err(|error| error.to_string())?;
    }
    if let Some(window) = app.get_webview_window("whatsapp") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn main() {
    // Tauri's unstable multi-webview child bounds overflow on Wayland with WebKitGTK.
    // Prefer XWayland for this app when available; child webviews are supported there.
    if env::var_os("WAYLAND_DISPLAY").is_some() && env::var_os("DISPLAY").is_some() {
        env::set_var("GDK_BACKEND", "x11");
    }

    tauri::Builder::default()
        .manage(UiState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![desktop_message, close_whatsapp])
        .run(tauri::generate_context!())
        .expect("Não foi possível iniciar o Fix.io Linux");
}
