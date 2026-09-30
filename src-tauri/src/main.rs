#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "linux"))]
compile_error!("O cliente Fix.io Linux deve ser compilado no Linux.");

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{env, fs, path::PathBuf, process::Command};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use tauri::webview::{Webview, WebviewBuilder};

type Result<T> = std::result::Result<T, String>;

const WHATSAPP_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

fn launch_wine(app: &tauri::AppHandle, target: &str, executable: PathBuf, prefix: Option<String>) -> Result<u32> {
    if !executable.is_file() {
        return Err(format!("Executável não encontrado: {}", executable.display()));
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

    let child = command.spawn().map_err(|error| format!("Não foi possível iniciar Wine: {error}"))?;
    let pid = child.id();
    emit_status(app, target, "external", format!("Programa iniciado pelo Wine (PID {pid}). No Wayland, ele será exibido em uma janela própria."))?;
    std::thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
    });
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

fn place_whatsapp_child(main: &tauri::Window, webview: &Webview) -> Result<()> {
    let size = main.inner_size().map_err(|error| error.to_string())?;
    let x = ((size.width as f64) * 0.18).min(240.0) as i32;
    let y = ((size.height as f64) * 0.09).min(82.0) as i32;
    let width = size.width.saturating_sub(x as u32).saturating_sub(22).max(1);
    let height = size.height.saturating_sub(y as u32).saturating_sub(20).max(1);
    webview.set_position(PhysicalPosition::new(x, y)).map_err(|error| error.to_string())?;
    webview.set_size(PhysicalSize::new(width, height)).map_err(|error| error.to_string())?;
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

fn open_whatsapp(app: &tauri::AppHandle) -> Result<()> {
    let main = app.get_window("main").ok_or("Janela principal não encontrada.")?;
    if let Some(webview) = app.get_webview("whatsapp") {
        place_whatsapp_child(&main, &webview)?;
        webview.show().map_err(|error| error.to_string())?;
        webview.set_focus().map_err(|error| error.to_string())?;
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
    match main.add_child(builder, PhysicalPosition::new(0, 0), PhysicalSize::new(1, 1)) {
        Ok(webview) => {
            place_whatsapp_child(&main, &webview)?;
            webview.show().map_err(|error| error.to_string())?;
            webview.set_focus().map_err(|error| error.to_string())?;
            Ok(())
        }
        Err(error) => {
            let window = WebviewWindowBuilder::new(app, "whatsapp", whatsapp_url()?)
                .title("Fix.io · WhatsApp Web")
                .user_agent(WHATSAPP_USER_AGENT)
                .inner_size(1100.0, 760.0)
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
            if message["page"].as_str() == Some("whatsapp") {
                emit_status(&app, "whatsapp", "loading", "Abrindo WhatsApp Web pelo WebKitGTK…")?;
                open_whatsapp(&app)?;
                emit_status(&app, "whatsapp", "ready", "WhatsApp Web carregado pelo WebKitGTK.")?;
            } else if message["page"].as_str() == Some("techunion") {
                let configured = load_config()
                    .wine_executable
                    .as_deref()
                    .map(expand)
                    .is_some_and(|path| path.is_file());
                let message = if configured {
                    "Bancada pronta. O programa configurado será executado pelo Wine."
                } else {
                    "Escolha o executável da bancada para iniciar pelo Wine."
                };
                emit_status(&app, "techunion", "ready", message)?;
            } else if let Some(webview) = app.get_webview("whatsapp") {
                let _ = webview.hide();
            } else if let Some(window) = app.get_webview_window("whatsapp") {
                let _ = window.hide();
            }
        }
        "open-application" | "techunion-open" | "techunion-external" | "techunion-choose" => {
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
            if let Err(error) = launch_wine(&app, target, executable, config.wine_prefix) {
                emit_status(&app, target, "error", error)?;
            }
        }
        "whatsapp-retry" => {
            open_whatsapp(&app)?;
            emit_status(&app, "whatsapp", "ready", "WhatsApp Web carregado pelo WebKitGTK.")?;
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![desktop_message, close_whatsapp])
        .run(tauri::generate_context!())
        .expect("Não foi possível iniciar o Fix.io Linux");
}
