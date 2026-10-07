//! GTK children share the actual content container, including on Wayland.
//! All widget access stays on GTK's main thread. No detached WhatsApp window.
use crate::{bench, data_dir, emit_status, emit_whatsapp_notification, snapshot, ContentBounds, Result, UiSnapshot};
use gtk::{glib, prelude::*};
use std::{cell::{Cell, RefCell}, rc::Rc, time::Duration};
use tauri::Manager;
use webkit2gtk::{CookieManagerExt, PermissionRequestExt, SettingsExt, UserMediaPermissionRequestExt, WebContextExt, WebViewExt};

thread_local! {
    static UI: RefCell<Option<NativeUi>> = const { RefCell::new(None) };
}

struct WhatsApp {
    view: webkit2gtk::WebView,
    frame: gtk::ScrolledWindow,
    failed: Rc<Cell<bool>>,
}

struct NativeUi {
    overlay: gtk::Overlay,
    whatsapp: Option<WhatsApp>,
    bench: gtk::DrawingArea,
    bench_frame: gtk::ScrolledWindow,
}

impl NativeUi {
    fn new(app: &tauri::AppHandle) -> Result<Self> {
        let main = app.get_webview_window("main").ok_or("Janela principal ausente.")?;
        let vbox = main.default_vbox().map_err(|e| e.to_string())?;
        // Keep Tauri's existing content subtree; only wrap it in an overlay.
        let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
        for child in vbox.children() {
            vbox.remove(&child);
            content.pack_start(&child, true, true, 0);
        }
        let overlay = gtk::Overlay::new();
        overlay.set_hexpand(true);
        overlay.set_vexpand(true);
        overlay.add(&content);
        vbox.pack_start(&overlay, true, true, 0);
        let allocated = Rc::new(Cell::new((0, 0)));
        let handle = app.clone();
        overlay.connect_size_allocate(move |_, allocation| {
            let size = (allocation.width(), allocation.height());
            if allocated.replace(size) != size {
                // Defer until the current allocation/RefCell borrow has ended.
                refresh(&handle);
            }
        });
        content.show_all();
        overlay.show();
        let bench = gtk::DrawingArea::new();
        bench.set_can_focus(true);
        let bench_frame = frame();
        bench_frame.add(&bench);
        if let Some(child) = bench_frame.child() { child.show(); }
        overlay.add_overlay(&bench_frame);
        // Xephyr creates its child using the host screen's root visual. Do not
        // inherit Tauri's RGBA visual: a depth mismatch causes X11 BadMatch.
        if let Some(visual) = bench.screen().and_then(|screen| screen.system_visual()) {
            bench.set_visual(Some(&visual));
        }
        bench.show();
        Ok(Self { overlay, whatsapp: None, bench, bench_frame })
    }

    fn create_whatsapp(&mut self, app: &tauri::AppHandle) -> Result<()> {
        let profile = data_dir()?.join("webview/whatsapp");
        std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
        // Match Wry's persistent paths and cookie format; do not erase sessions.
        let manager = webkit2gtk::WebsiteDataManager::builder()
            .base_data_directory(profile.to_string_lossy())
            .base_cache_directory(profile.to_string_lossy())
            .build();
        let context = webkit2gtk::WebContext::builder().website_data_manager(&manager).build();
        if let Some(cookies) = context.cookie_manager() {
            cookies.set_persistent_storage(&profile.join("cookies").to_string_lossy(),
                webkit2gtk::CookiePersistentStorage::Text);
        }
        let policies = webkit2gtk::WebsitePolicies::builder()
            // WhatsApp resolves/decrypts the voice message asynchronously;
            // WebKit must allow the resulting media element to start sound.
            .autoplay(webkit2gtk::AutoplayPolicy::Allow)
            .build();
        let view = webkit2gtk::WebView::builder()
            .web_context(&context)
            .website_policies(&policies)
            .is_muted(false)
            .build();
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_javascript(true);
            settings.set_enable_html5_local_storage(true);
            settings.set_enable_media(true);
            settings.set_enable_media_stream(true);
            settings.set_enable_mediasource(true);
            // Voice notes and videos use HTML media. Keeping WebAudio off
            // avoids a second audio pipeline that can lock WebKitGTK on Linux.
            settings.set_enable_webaudio(false);
            settings.set_media_playback_allows_inline(true);
            settings.set_media_playback_requires_user_gesture(false);
            // WhatsApp Web hides the login page for the default WebKitGTK/Safari
            // user agent. Keep the real WebKit engine, but expose a current
            // Chromium UA so the QR/login application is served.
            settings.set_user_agent(Some(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ));
        }
        view.connect_permission_request(|_, request| {
            if let Some(media_request) = request.downcast_ref::<webkit2gtk::UserMediaPermissionRequest>() {
                // Voice messages need microphone access. A combined audio/video
                // request is allowed by WebKit as one media session; requests
                // without audio (for example camera-only) are denied.
                if media_request.is_for_audio_device() {
                    request.allow();
                } else {
                    request.deny();
                }
                return true;
            }
            false
        });
        let frame = frame();
        frame.add(&view);
        if let Some(child) = frame.child() { child.show(); }
        self.overlay.add_overlay(&frame);
        view.show();
        let failed = Rc::new(Cell::new(false));
        let cancelled = Rc::new(Cell::new(false));
        let retry_count = Rc::new(Cell::new(0u8));
        let load_failed = failed.clone();
        let load_cancelled = cancelled.clone();
        let load_retries = retry_count.clone();
        let handle = app.clone();
        view.connect_load_changed(move |_, event| {
            if event == webkit2gtk::LoadEvent::Started {
                load_failed.set(false);
                load_cancelled.set(false);
                let _ = emit_status(&handle, "whatsapp", "loading", "Carregando WhatsApp Web…");
            } else if event == webkit2gtk::LoadEvent::Finished && !load_failed.get() && !load_cancelled.get() {
                load_retries.set(0);
                let _ = emit_status(&handle, "whatsapp", "ready", "WhatsApp Web na área de atendimento.");
            }
        });
        let load_failed = failed.clone();
        let load_cancelled = cancelled.clone();
        let load_retries = retry_count.clone();
        let handle = app.clone();
        let error_frame = frame.clone();
        let retry_view = view.clone();
        view.connect_load_failed(move |_, event, failing_uri, error| {
            if error.matches(webkit2gtk::NetworkError::Cancelled) {
                // WhatsApp performs redirects and replaces the document while
                // bootstrapping. WebKitGTK reports that intermediate stop as
                // "Operation was cancelled"; it is not a terminal failure.
                if event == webkit2gtk::LoadEvent::Committed {
                    load_cancelled.set(false);
                    return true;
                }
                let attempt = load_retries.get();
                if attempt < 2 {
                    load_retries.set(attempt + 1);
                    load_cancelled.set(true);
                    let next_view = retry_view.clone();
                    glib::timeout_add_local_once(Duration::from_millis(350), move || {
                        next_view.load_uri("https://web.whatsapp.com/");
                    });
                    let _ = emit_status(&handle, "whatsapp", "loading", "Reiniciando o carregamento interno do WhatsApp…");
                    return true;
                }
                load_cancelled.set(false);
            }
            load_failed.set(true);
            error_frame.hide();
            let _ = emit_status(&handle, "whatsapp", "error",
                format!("Falha ao carregar o WhatsApp Web internamente ({failing_uri}): {error}"));
            true
        });
        let notification_handle = app.clone();
        let last_title = Rc::new(RefCell::new(String::new()));
        let last_title_for_signal = last_title.clone();
        view.connect_title_notify(move |webview| {
            let title = webview.title().map(|value| value.to_string()).unwrap_or_default();
            if *last_title_for_signal.borrow() == title { return; }
            *last_title_for_signal.borrow_mut() = title.clone();
            let unread_count = title.trim().strip_prefix('(')
                .and_then(|value| value.split_once(')'))
                .and_then(|(count, _)| count.trim().parse::<u32>().ok())
                .unwrap_or(0);
            let _ = emit_whatsapp_notification(&notification_handle, unread_count, &title);
        });
        let terminated = failed.clone();
        let handle = app.clone();
        let error_frame = frame.clone();
        view.connect_web_process_terminated(move |_, reason| {
            terminated.set(true);
            error_frame.hide();
            let _ = emit_status(&handle, "whatsapp", "error",
                format!("O processo interno do WhatsApp foi encerrado ({reason:?})."));
        });
        // Never create a top-level window for target=_blank/window.open.
        view.connect_create(|_, _| None);
        view.load_uri("https://web.whatsapp.com/");
        self.whatsapp = Some(WhatsApp { view, frame, failed });
        Ok(())
    }

    fn layout(&mut self, app: &tauri::AppHandle, ui: &UiSnapshot, retry: bool) -> Result<()> {
        let show_whatsapp = ui.active_page == "whatsapp" && !ui.obscured;
        let show_bench = ui.active_page == "techunion" && !ui.obscured;
        if show_whatsapp && ui.whatsapp_bounds.is_some() && self.whatsapp.is_none() {
            self.create_whatsapp(app)?;
        }
        if let Some(whatsapp) = &self.whatsapp {
            if retry && show_whatsapp {
                whatsapp.failed.set(false);
                whatsapp.view.reload();
            }
            place(&self.overlay, &whatsapp.frame, ui.whatsapp_bounds, ui.content_bounds,
                show_whatsapp && !whatsapp.failed.get());
        }
        place(&self.overlay, &self.bench_frame, ui.bench_bounds, ui.content_bounds,
            show_bench && bench::is_active(app)?);
        Ok(())
    }
}

fn frame() -> gtk::ScrolledWindow {
    let frame = gtk::ScrolledWindow::new(None::<&gtk::Adjustment>, None::<&gtk::Adjustment>);
    frame.set_policy(gtk::PolicyType::Never, gtk::PolicyType::Never);
    frame.set_min_content_width(0);
    frame.set_min_content_height(0);
    frame.set_hexpand(true);
    frame.set_vexpand(true);
    frame.set_halign(gtk::Align::Fill);
    frame.set_valign(gtk::Align::Fill);
    frame.set_no_show_all(true);
    frame
}

fn place(overlay: &gtk::Overlay, frame: &gtk::ScrolledWindow, bounds: Option<ContentBounds>,
    content: Option<ContentBounds>, visible: bool) -> bool {
    let Some(bounds) = bounds.filter(|_| visible) else { frame.hide(); return false; };
    let mut left = bounds.left.max(0.0);
    let mut top = bounds.top.max(0.0);
    let mut right = (bounds.left + bounds.width).min(bounds.viewport_width);
    let mut bottom = (bounds.top + bounds.height).min(bounds.viewport_height);
    if let Some(content) = content {
        left = left.max(content.left);
        top = top.max(content.top);
        right = right.min(content.left + content.width);
        bottom = bottom.min(content.top + content.height);
    }
    if right - left < 2.0 || bottom - top < 2.0 || overlay.allocated_width() < 2 {
        frame.hide();
        return false;
    }
    // CSS pixels -> GTK logical units, including webview zoom. Do not apply
    // screen DPI twice or use global desktop coordinates (unavailable on Wayland).
    let sx = overlay.allocated_width() as f64 / bounds.viewport_width;
    let sy = overlay.allocated_height() as f64 / bounds.viewport_height;
    frame.set_margin_start((left * sx).ceil() as i32);
    frame.set_margin_top((top * sy).ceil() as i32);
    frame.set_margin_end(((bounds.viewport_width - right) * sx).ceil() as i32);
    frame.set_margin_bottom(((bounds.viewport_height - bottom) * sy).ceil() as i32);
    frame.show();
    true
}

async fn on_ui<T: Send + 'static>(app: &tauri::AppHandle,
    task: impl FnOnce(&mut NativeUi, &tauri::AppHandle) -> Result<T> + Send + 'static) -> Result<T> {
    let (tx, rx) = futures_channel::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = UI.with(|slot| {
            let mut slot = slot.borrow_mut();
            if slot.is_none() { *slot = Some(NativeUi::new(&handle)?); }
            task(slot.as_mut().unwrap(), &handle)
        });
        let _ = tx.send(result);
    }).map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "A janela principal foi encerrada.".to_string())?
}

pub async fn sync(app: &tauri::AppHandle, retry: bool) -> Result<()> {
    on_ui(app, move |ui, app| ui.layout(app, &snapshot(app)?, retry)).await
}

pub async fn hide_whatsapp(app: &tauri::AppHandle) -> Result<()> {
    on_ui(app, |ui, _| {
        if let Some(whatsapp) = &ui.whatsapp { whatsapp.frame.hide(); }
        Ok(())
    }).await
}

pub struct BenchHost {
    pub xid: u64,
    pub display: String,
    pub depth: i32,
    pub width: u32,
    pub height: u32,
}

pub async fn start_bench(app: &tauri::AppHandle, executable: std::path::PathBuf) -> Result<()> {
    on_ui(app, move |ui, app| {
        if bench::is_active(app)? { return bench::report(app); }
        let state = snapshot(app)?;
        if state.active_page != "techunion" || state.obscured {
            return Err("Mantenha a Bancada visível para iniciar.".into());
        }
        if !place(&ui.overlay, &ui.bench_frame, state.bench_bounds, state.content_bounds, true) {
            return Err("Aguarde a área da Bancada terminar de ajustar o tamanho.".into());
        }
        // Commit the margins/child allocation before Xephyr reads its parent
        // geometry. Otherwise the newly shown DrawingArea can still be 1x1.
        ui.overlay.size_allocate(&ui.overlay.allocation());
        ui.bench_frame.realize();
        if let Some(viewport) = ui.bench.parent() { viewport.realize(); }
        ui.bench.realize();
        let window = ui.bench.window().ok_or("Não foi possível criar a área gráfica interna.")?;
        if !window.ensure_native() {
            ui.bench_frame.hide();
            return Err("Não foi possível criar a janela-pai nativa da Bancada.".into());
        }
        let display = window.display();
        let visual = window.visual();
        let width = ui.bench.allocated_width();
        let height = ui.bench.allocated_height();
        if width < 2 || height < 2 {
            ui.bench_frame.hide();
            return Err("A área da Bancada ainda não recebeu um tamanho válido. Tente novamente.".into());
        }
        let window = window.downcast::<gdkx11::X11Window>()
            .map_err(|_| {
                ui.bench_frame.hide();
                "A Bancada exige XWayland para a área interna. Nenhum programa foi iniciado."
            })?;
        let scale = ui.bench.scale_factor().max(1) as u32;
        // Flush AND wait for XWayland to create the native XID. Xephyr uses a
        // separate connection and must not race GTK's buffered X11 requests.
        display.sync();
        let host = BenchHost {
            xid: window.xid() as u64,
            display: display.name().to_string(),
            depth: visual.depth(),
            width: (width as u32 * scale).clamp(2, 8192),
            height: (height as u32 * scale).clamp(2, 8192),
        };
        // Reserve the session before leaving GTK's thread. A pending bounds
        // update must not hide the host between preparing it and starting.
        let result = bench::start(app, executable, host);
        if result.is_err() { ui.bench_frame.hide(); }
        result
    }).await
}

pub fn refresh(app: &tauri::AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = sync(&handle, false).await {
            let _ = emit_status(&handle, "techunion", "error", error);
        }
    });
}
