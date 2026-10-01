//! Run the selected program in a dedicated Xephyr display.
//! This diagnostic mode deliberately leaves Xephyr as a separate window until
//! the X11 parent integration is proven compatible with KDE/XWayland.
use crate::{command_exists, data_dir, emit_status, embedded::{self, BenchHost}, expand, load_config, Result};
use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Read, Seek, SeekFrom, Write},
    os::{fd::OwnedFd, unix::{fs::{DirBuilderExt, FileTypeExt, OpenOptionsExt}, net::UnixStream}},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError}, Mutex},
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
        return Err("Falta Xephyr (pacote xorg-server-xephyr) para a Bancada. Nenhum programa será aberto diretamente no desktop.".into());
    }
    if !command_exists("wine") || !command_exists("wineserver") {
        return Err("Instale Wine com wineserver para executar o programa dentro da Bancada.".into());
    }
    if std::env::var_os("DISPLAY").is_none() {
        return Err("XWayland não está disponível nesta sessão. A Bancada requer XWayland e Xephyr.".into());
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
    owns_wine: bool,
}

impl Drop for Session {
    fn drop(&mut self) {
        // A Xephyr failure must not terminate a pre-existing/manual Wine run.
        if self.owns_wine { stop_wineserver(&self.prefix); }
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

fn wine_prefix() -> Result<PathBuf> {
    let prefix = match load_config().wine_prefix.filter(|value| !value.trim().is_empty()) {
        Some(path) => expand(&path),
        None => data_dir()?.join("wine/union"),
    };
    if !prefix.is_absolute() || !prefix.is_dir() {
        return Err(format!("O ambiente Wine instalado não foi encontrado em {}. Configure wine_prefix em linux.json com o prefixo já validado. Nenhum ambiente novo foi criado.", prefix.display()));
    }
    fs::canonicalize(prefix).map_err(|e| e.to_string())
}

fn cancelled(stop: &Receiver<()>) -> bool {
    matches!(stop.try_recv(), Ok(()) | Err(TryRecvError::Disconnected))
}

fn pause_or_cancel(stop: &Receiver<()>) -> bool {
    matches!(stop.recv_timeout(Duration::from_millis(50)),
        Ok(()) | Err(RecvTimeoutError::Disconnected))
}

fn idle_prefix(session: &mut Session, stop: &Receiver<()>) -> Result<bool> {
    // Query only: -w waits for the existing server and never kills it. Reusing
    // a busy prefix could route a single-instance EXE to the external desktop.
    session.waiter = Some(Command::new("wineserver").arg("-w")
        .env("WINEPREFIX", &session.prefix).stdin(Stdio::null())
        .stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|e| format!("Não foi possível consultar o Wine: {e}"))?);
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if cancelled(stop) { return Ok(false); }
        if let Some(exit) = session.waiter.as_mut().unwrap().try_wait().map_err(|e| e.to_string())? {
            session.waiter = None;
            return if exit.success() { Ok(true) }
                else { Err(format!("Não foi possível consultar o prefixo Wine ({exit}).")) };
        }
        if Instant::now() >= deadline {
            return Err(format!("O prefixo {} ainda está em uso pelo Wine. Feche o programa aberto manualmente e tente novamente; nenhuma instância existente foi encerrada pelo Fix.io.", session.prefix.display()));
        }
        if pause_or_cancel(stop) { return Ok(false); }
    }
}

fn xephyr_error(reason: impl std::fmt::Display, log_path: &Path) -> String {
    // Include the actual X11 failure in the UI, not just 'exit status: 1'.
    let tail = (|| -> std::io::Result<String> {
        let mut file = File::open(log_path)?;
        let length = file.metadata()?.len();
        file.seek(SeekFrom::Start(length.saturating_sub(4096)))?;
        let mut bytes = Vec::new();
        file.take(4096).read_to_end(&mut bytes)?;
        let text = String::from_utf8_lossy(&bytes);
        let lines: Vec<_> = text.lines().rev().take(10).collect();
        Ok(lines.into_iter().rev().collect::<Vec<_>>().join("\n"))
    })().unwrap_or_default();
    format!("Xephyr não preparou a Bancada: {reason}. O EXE não foi iniciado. Consulte {}.\n{tail}", log_path.display())
}

fn wait_xephyr(child: &mut Child, mut reader: UnixStream, stop: &Receiver<()>,
    log_path: &Path) -> Result<Option<String>> {
    reader.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut reply = Vec::new();
    let mut number = None;
    loop {
        if cancelled(stop) { return Ok(None); }
        if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(xephyr_error(exit, log_path));
        }
        if number.is_none() {
            let mut chunk = [0u8; 32];
            match reader.read(&mut chunk) {
                Ok(0) => return Err(xephyr_error("canal de prontidão encerrado", log_path)),
                Ok(length) => {
                    reply.extend_from_slice(&chunk[..length]);
                    if reply.len() > 32 {
                        return Err(xephyr_error("resposta de display inválida", log_path));
                    }
                    if let Some(end) = reply.iter().position(|byte| *byte == b'\n') {
                        number = Some(std::str::from_utf8(&reply[..end]).ok()
                            .and_then(|text| text.trim().parse::<u32>().ok())
                            .ok_or_else(|| xephyr_error("número de display inválido", log_path))?);
                    }
                }
                Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted) => {}
                Err(error) => return Err(xephyr_error(error, log_path)),
            }
        }
        if let Some(number) = number {
            let socket = PathBuf::from(format!("/tmp/.X11-unix/X{number}"));
            // -displayfd signals readiness after the server selects and binds
            // a free display. Also require the Unix socket, not a stale lock.
            if fs::metadata(&socket).map(|meta| meta.file_type().is_socket()).unwrap_or(false) {
                if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? {
                    return Err(xephyr_error(exit, log_path));
                }
                return Ok(Some(format!(":{number}")));
            }
        }
        if Instant::now() >= deadline {
            return Err(xephyr_error("tempo esgotado aguardando o sinal de prontidão e o socket X11", log_path));
        }
        if pause_or_cancel(stop) { return Ok(None); }
    }
}

fn run(app: &tauri::AppHandle, executable: PathBuf, host: BenchHost, stop: Receiver<()>) -> Result<()> {
    let dir = data_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let lock = OpenOptions::new().read(true).write(true).create(true).truncate(false).mode(0o600)
        .open(dir.join("bench.lock")).map_err(|e| e.to_string())?;
    lock.try_lock_exclusive().map_err(|_| "A Bancada já está ativa em outra instância do Fix.io.")?;
    let prefix = wine_prefix()?;
    let mut random = [0u8; 16];
    File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut random)).map_err(|e| e.to_string())?;
    let suffix: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let auth_dir = std::env::temp_dir().join(format!("fixio-bench-{suffix}"));
    fs::DirBuilder::new().mode(0o700).create(&auth_dir).map_err(|e| e.to_string())?;
    let mut session = Session { prefix, auth_dir, _lock: lock, xephyr: None, wine: None, waiter: None, owns_wine: false };
    if !idle_prefix(&mut session, &stop)? { return Ok(()); }
    xauthority(&session.auth_dir)?;
    let auth = session.auth_dir.join("Xauthority");
    let log_path = dir.join("bench.log");
    let mut log = OpenOptions::new().create(true).truncate(true).write(true).mode(0o600)
        .open(&log_path).map_err(|e| e.to_string())?;
    writeln!(log, "Xephyr host DISPLAY={} parent=0x{:x} depth={} size={}x{}\nWine prefix={}",
        host.display, host.xid, host.depth, host.width, host.height, session.prefix.display())
        .map_err(|e| e.to_string())?;
    let log_copy = || log.try_clone().map_err(|e| e.to_string());
    let (reader, writer) = UnixStream::pair().map_err(|e| e.to_string())?;
    let output: OwnedFd = writer.into();
    status(app, "starting", format!("Preparando Xephyr no display hospedeiro {}; aguardando o display interno…", host.display));
    session.xephyr = Some(Command::new("Xephyr")
        // Use the display that owns the GTK parent, not the internal display.
        // Keep the HOST XAUTHORITY inherited; -auth below protects the CHILD.
        .env("DISPLAY", &host.display)
        // Do not pass -parent during this diagnostic phase. The manual
        // Xephyr :99 flow works, while the GTK/XWayland XID currently causes
        // Xephyr to exit with X11 error code 8 before Wine can start.
        .arg("-screen").arg(format!("{}x{}", host.width, host.height))
        .args(["-resizeable", "-br", "-noreset", "-nolisten", "tcp", "-displayfd", "1"])
        .arg("-auth").arg(&auth)
        .stdin(Stdio::null()).stdout(Stdio::from(output)).stderr(log_copy()?)
        .spawn().map_err(|e| format!("Não foi possível criar a área interna: {e}"))?);
    let Some(display) = wait_xephyr(session.xephyr.as_mut().unwrap(), reader, &stop, &log_path)?
        else { return Ok(()); };
    if cancelled(&stop) { return Ok(()); }
    writeln!(&log, "Xephyr ready DISPLAY={display}; starting selected executable")
        .map_err(|e| e.to_string())?;
    let mut wine = Command::new("wine");
    // Match the manually validated launch: Wine + the selected EXE, using the
    // existing installation. Xephyr itself contains all program windows.
    wine.arg(&executable)
        .env("DISPLAY", &display).env("XAUTHORITY", &auth)
        .env("WINEPREFIX", &session.prefix)
        .env_remove("WAYLAND_DISPLAY")
        // Qt/GTK *Windows* programs must choose their Windows platform plugins.
        .env_remove("QT_QPA_PLATFORM").env_remove("GDK_BACKEND")
        .stdin(Stdio::null()).stdout(log_copy()?).stderr(log_copy()?);
    if let Some(directory) = executable.parent() { wine.current_dir(directory); }
    session.wine = Some(wine.spawn().map_err(|e| format!("Não foi possível iniciar o executável: {e}"))?);
    session.owns_wine = true;
    status(app, "embedded", format!("Display interno {display} pronto; aguardando a janela do programa."));
    loop {
        if matches!(stop.recv_timeout(Duration::from_millis(200)), Ok(()) | Err(RecvTimeoutError::Disconnected)) { return Ok(()); }
        if let Some(exit) = session.xephyr.as_mut().unwrap().try_wait().map_err(|e| e.to_string())? {
            return Err(format!("A área interna foi encerrada ({exit}). Consulte {}. Não houve abertura externa.", log_path.display()));
        }
        if let Some(child) = session.wine.as_mut() {
            if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? {
                if !exit.success() {
                    return Err(format!("O programa encerrou com {exit}. Consulte {}. Prefixo usado: {}.", log_path.display(), session.prefix.display()));
                }
                session.wine = None;
                // Wine launchers can exit before the GUI process. Track the
                // selected prefix's wineserver instead of launching a duplicate.
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
