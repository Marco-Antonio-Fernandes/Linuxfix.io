//! Contain every program window in a nested X server hosted by a GTK child.
//! There is deliberately no fallback to the desktop DISPLAY.
use crate::{command_exists, data_dir, emit_status, embedded::{self, BenchHost}, load_config, Result};
use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    os::{fd::OwnedFd, unix::{fs::{DirBuilderExt, OpenOptionsExt}, net::UnixStream}},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc::{self, Receiver, Sender}, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::Manager;

struct Control {
    active: bool,
    state: &'static str,
    message: String,
    stop: Option<Sender<()>>,
    worker: Option<JoinHandle<()>>,
}

impl Default for Control {
    fn default() -> Self {
        Self { active: false, state: "ready", message: String::new(), stop: None, worker: None }
    }
}

#[derive(Default)]
pub struct BenchState(Mutex<Control>);

pub fn is_active(app: &tauri::AppHandle) -> Result<bool> {
    let state = app.state::<BenchState>();
    let active = state.0.lock().map_err(|e| e.to_string())?.active;
    Ok(active)
}

pub fn report(app: &tauri::AppHandle) -> Result<()> {
    let state = app.state::<BenchState>();
    let control = state.0.lock().map_err(|e| e.to_string())?;
    let message = if control.message.is_empty() {
        match load_config().wine_executable {
            Some(path) => format!("Selecionado: {path}. Clique em Abrir na bancada."),
            None => "Escolha o executável e depois clique em Abrir na bancada.".into(),
        }
    } else { control.message.clone() };
    emit_status(app, "techunion", control.state, message)
}

pub fn selection_changed(app: &tauri::AppHandle) -> Result<()> {
    let state = app.state::<BenchState>();
    let mut control = state.0.lock().map_err(|e| e.to_string())?;
    if !control.active {
        control.message.clear();
        control.state = "ready";
    }
    drop(control);
    report(app)
}

pub fn preflight(executable: &Path) -> Result<()> {
    if !executable.is_file() { return Err("O executável selecionado não existe.".into()); }
    if !command_exists("Xephyr") {
        return Err("Falta Xephyr (pacote xorg-server-xephyr) para a área interna. Nada será aberto por fora.".into());
    }
    if !command_exists("wine") || !command_exists("wineserver") {
        return Err("Instale Wine com wineserver para executar o programa dentro da Bancada.".into());
    }
    if std::env::var_os("DISPLAY").is_none() {
        return Err("XWayland não está disponível nesta sessão. A Bancada requer XWayland e Xephyr; a abertura externa está desativada.".into());
    }
    Ok(())
}

fn status(app: &tauri::AppHandle, state_name: &'static str, message: String) {
    let state = app.state::<BenchState>();
    if let Ok(mut control) = state.0.lock() {
        control.state = state_name;
        control.message = message.clone();
    }
    let _ = emit_status(app, "techunion", state_name, message);
}

pub fn start(app: &tauri::AppHandle, executable: PathBuf, host: BenchHost) -> Result<()> {
    let state = app.state::<BenchState>();
    let mut control = state.0.lock().map_err(|e| e.to_string())?;
    if control.active { return Ok(()); }
    let (tx, rx) = mpsc::channel();
    control.active = true;
    control.state = "starting";
    control.message = "Preparando a área interna…".into();
    control.stop = Some(tx);
    let handle = app.clone();
    let worker = thread::Builder::new().name("fixio-bench".into()).spawn(move || {
        let result = run(&handle, executable, host, rx);
        {
            let state = handle.state::<BenchState>();
            if let Ok(mut control) = state.0.lock() {
                control.active = false;
                control.stop = None;
            };
        }
        match result {
            Ok(()) => status(&handle, "ready", "Sessão encerrada. O programa só será aberto dentro da Bancada.".into()),
            Err(error) => status(&handle, "error", error),
        }
        embedded::refresh(&handle);
    });
    match worker {
        Ok(worker) => control.worker = Some(worker),
        Err(error) => {
            control.active = false;
            control.stop = None;
            return Err(format!("Não foi possível preparar a Bancada: {error}"));
        }
    }
    drop(control);
    embedded::refresh(app);
    report(app)
}

pub fn stop(app: &tauri::AppHandle) -> Result<()> {
    let state = app.state::<BenchState>();
    let control = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(stop) = &control.stop { let _ = stop.send(()); }
    drop(control);
    status(app, "stopping", "Encerrando a sessão interna…".into());
    Ok(())
}

pub fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<BenchState>();
    let worker = {
        let Ok(mut control) = state.0.lock() else { return; };
        if let Some(stop) = &control.stop { let _ = stop.send(()); }
        control.worker.take()
    };
    // Workers never wait for GTK, so joining after the event loop exits is safe.
    if let Some(worker) = worker { let _ = worker.join(); }
}

fn kill(child: &mut Option<Child>) {
    if let Some(mut child) = child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

struct Session {
    prefix: PathBuf,
    auth_dir: PathBuf,
    _lock: File,
    xephyr: Option<Child>,
    wine: Option<Child>,
    waiter: Option<Child>,
}

impl Drop for Session {
    fn drop(&mut self) {
        // Only this application's dedicated prefix; never kill the user's Wine.
        stop_wineserver(&self.prefix);
        kill(&mut self.wine);
        kill(&mut self.waiter);
        kill(&mut self.xephyr);
        let _ = fs::remove_file(self.auth_dir.join("Xauthority"));
        let _ = fs::remove_dir(&self.auth_dir);
    }
}

fn stop_wineserver(prefix: &Path) {
    if let Ok(mut child) = Command::new("wineserver").arg("-k")
        .env("WINEPREFIX", prefix).stdin(Stdio::null())
        .stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                _ if Instant::now() >= deadline => { let _ = child.kill(); let _ = child.wait(); break; }
                _ => thread::sleep(Duration::from_millis(50)),
            }
        }
    }
}

fn xauthority(directory: &Path) -> Result<()> {
    // Xauthority record with FamilyWild, a random MIT cookie and private file
    // permissions. Do not disable access control (-ac) or listen on TCP.
    let mut cookie = [0u8; 16];
    File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut cookie)).map_err(|e| e.to_string())?;
    let mut record = Vec::from(65535u16.to_be_bytes());
    for field in [&[][..], &[][..], b"MIT-MAGIC-COOKIE-1".as_slice(), cookie.as_slice()] {
        record.extend_from_slice(&(field.len() as u16).to_be_bytes());
        record.extend_from_slice(field);
    }
    let mut file = OpenOptions::new().write(true).create_new(true).mode(0o600)
        .open(directory.join("Xauthority")).map_err(|e| e.to_string())?;
    file.write_all(&record).map_err(|e| e.to_string())
}

fn run(app: &tauri::AppHandle, executable: PathBuf, host: BenchHost, stop: Receiver<()>) -> Result<()> {
    let dir = data_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let lock = OpenOptions::new().read(true).write(true).create(true).truncate(false).mode(0o600)
        .open(dir.join("bench.lock")).map_err(|e| e.to_string())?;
    lock.try_lock_exclusive().map_err(|_| "A Bancada já está ativa em outra instância do Fix.io.")?;
    let prefix = dir.join("wine-bench");
    fs::create_dir_all(&prefix).map_err(|e| e.to_string())?;
    // Exclusive lock acquired: recover a private wineserver left by a crash.
    stop_wineserver(&prefix);
    let mut random = [0u8; 16];
    File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut random)).map_err(|e| e.to_string())?;
    let suffix: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let auth_dir = std::env::temp_dir().join(format!("fixio-bench-{suffix}"));
    fs::DirBuilder::new().mode(0o700).create(&auth_dir).map_err(|e| e.to_string())?;
    let mut session = Session { prefix, auth_dir, _lock: lock, xephyr: None, wine: None, waiter: None };
    xauthority(&session.auth_dir)?;
    let auth = session.auth_dir.join("Xauthority");
    let log_path = dir.join("bench.log");
    let log = OpenOptions::new().create(true).truncate(true).write(true).mode(0o600)
        .open(&log_path).map_err(|e| e.to_string())?;
    let log_copy = || log.try_clone().map_err(|e| e.to_string());
    let (reader, writer) = UnixStream::pair().map_err(|e| e.to_string())?;
    reader.set_read_timeout(Some(Duration::from_secs(10))).map_err(|e| e.to_string())?;
    let output: OwnedFd = writer.into();
    session.xephyr = Some(Command::new("Xephyr")
        // -parent must precede -screen, otherwise a standalone host may appear.
        .arg("-parent").arg(host.xid.to_string())
        .arg("-screen").arg(format!("{}x{}", host.width, host.height))
        .args(["-resizeable", "-noreset", "-nolisten", "tcp", "-displayfd", "1"])
        .arg("-auth").arg(&auth)
        .stdin(Stdio::null()).stdout(Stdio::from(output)).stderr(log_copy()?)
        .spawn().map_err(|e| format!("Não foi possível criar a área interna: {e}"))?);
    let mut display = String::new();
    BufReader::new(reader).take(32).read_line(&mut display)
        .map_err(|e| format!("Xephyr não ficou pronto: {e}. Consulte {}.", log_path.display()))?;
    let number: u32 = display.trim().parse()
        .map_err(|_| format!("Xephyr encerrou antes de preparar a área. Consulte {}.", log_path.display()))?;
    if stop.try_recv().is_ok() { return Ok(()); }
    let display = format!(":{number}");
    let mut wine = Command::new("wine");
    // explorer.exe is a Windows program; use the private prefix's standard
    // Z: mapping for an absolute Unix path, retaining spaces as one argument.
    let windows_executable = format!("Z:{}", executable.to_string_lossy().replace('/', "\\"));
    // The private DISPLAY contains all popups and secondary program windows.
    // A private prefix prevents an already-running application from receiving
    // the request and reopening on an unrelated external desktop.
    wine.arg("explorer")
        .arg(format!("/desktop=FixioBench,{}x{}", host.width, host.height))
        .arg(windows_executable)
        .env("DISPLAY", &display).env("XAUTHORITY", &auth)
        .env("WINEPREFIX", &session.prefix)
        .env("WINEDLLOVERRIDES", "winewayland.drv=d")
        .env_remove("WAYLAND_DISPLAY")
        // Qt/GTK *Windows* programs must choose their Windows platform plugins.
        .env_remove("QT_QPA_PLATFORM").env_remove("GDK_BACKEND")
        .stdin(Stdio::null()).stdout(log_copy()?).stderr(log_copy()?);
    if let Some(directory) = executable.parent() { wine.current_dir(directory); }
    session.wine = Some(wine.spawn().map_err(|e| format!("Não foi possível iniciar o executável: {e}"))?);
    status(app, "embedded", "Sessão interna iniciada; aguardando a janela do programa. A primeira execução pode preparar o ambiente Windows.".into());
    loop {
        if stop.recv_timeout(Duration::from_millis(200)).is_ok() { return Ok(()); }
        if let Some(exit) = session.xephyr.as_mut().unwrap().try_wait().map_err(|e| e.to_string())? {
            return Err(format!("A área interna foi encerrada ({exit}). Consulte {}. Não houve abertura externa.", log_path.display()));
        }
        if let Some(child) = session.wine.as_mut() {
            if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? {
                if !exit.success() {
                    return Err(format!("O programa encerrou com {exit}. Consulte {}. Dependências/instaladores devem ser instalados no ambiente próprio da Bancada.", log_path.display()));
                }
                session.wine = None;
                // Wine launchers can exit before the GUI process. Track the
                // private wineserver instead of launching a duplicate instance.
                session.waiter = Some(Command::new("wineserver").arg("-w")
                    .env("WINEPREFIX", &session.prefix)
                    .stdin(Stdio::null()).stdout(Stdio::null()).stderr(log_copy()?)
                    .spawn().map_err(|e| e.to_string())?);
            }
        }
        if let Some(waiter) = session.waiter.as_mut() {
            if waiter.try_wait().map_err(|e| e.to_string())?.is_some() { return Ok(()); }
        }
    }
}
