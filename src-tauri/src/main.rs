#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "linux"))]
compile_error!("Fixio Shell é um aplicativo exclusivo para Linux/Arch Linux.");

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, env, fs, io::Write, path::{Path, PathBuf}, process::{Command, Stdio}};
use tauri::{Emitter, Manager, LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use tauri::webview::{Webview, WebviewBuilder};

type Result<T> = std::result::Result<T, String>;
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Shortcut { id: String, name: String, path: String, args: Vec<String>, icon: String, color: String, kind: String, prefix: String, cwd: String }
#[derive(Debug, Clone, Serialize)]
struct RuntimeCapabilities { session_type: String, display: String, wine: bool, wineboot: bool, webkitgtk: bool, external_window_mode: String }
fn home() -> Result<PathBuf> { env::var_os("HOME").map(PathBuf::from).ok_or("HOME não definido. Execute no Linux.".into()) }
fn config_root() -> Result<PathBuf> { Ok(env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).filter(|p|p.is_absolute()).unwrap_or(home()?.join(".config"))) }
fn data_dir() -> Result<PathBuf> { Ok(env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|p|p.is_absolute()).unwrap_or(home()?.join(".local/share")).join("fixio-shell")) }
fn diagnostic(message: impl AsRef<str>) {
    let line = format!("[fixio-shell] {}\n", message.as_ref());
    eprint!("{line}");
    if let Ok(dir) = data_dir() {
        let log_path = dir.join("logs/runtime.log");
        if fs::create_dir_all(&dir.join("logs")).is_ok() {
            if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(log_path) {
                let _ = file.write_all(line.as_bytes());
            }
        }
    }
}
fn log_runtime_environment() {
    diagnostic("iniciando backend nativo");
    for key in ["XDG_SESSION_TYPE", "WAYLAND_DISPLAY", "DISPLAY", "XDG_CURRENT_DESKTOP", "KDE_FULL_SESSION"] {
        diagnostic(format!("ambiente {key}={}", env::var(key).unwrap_or_else(|_| "<não definido>".into())));
    }
    if env::var("XDG_SESSION_TYPE").map(|value|value.eq_ignore_ascii_case("wayland")).unwrap_or(false) {
        diagnostic("Wayland detectado: a dock usa a janela Tauri como fallback até a integração layer-shell; coordenadas absolutas podem ser ignoradas pelo compositor");
    }
}
fn config_file() -> Result<PathBuf> { Ok(config_root()?.join("fixio-shell/config.json")) }
fn expand(path: &str) -> Result<PathBuf> { if path == "~" { home() } else if let Some(rest)=path.strip_prefix("~/") { Ok(home()?.join(rest)) } else { Ok(PathBuf::from(path)) } }
fn command_exists(program: &str) -> bool {
    let Some(path) = env::var_os("PATH") else {
        return false;
    };

    env::split_paths(&path)
        .any(|dir| dir.join(program).is_file())
}
#[tauri::command]
fn runtime_capabilities() -> RuntimeCapabilities {
    let session_type=env::var("XDG_SESSION_TYPE").unwrap_or_else(|_|if env::var_os("WAYLAND_DISPLAY").is_some(){"wayland".into()}else{"x11/unknown".into()});
    let display=if env::var_os("WAYLAND_DISPLAY").is_some(){"wayland".into()}else if env::var_os("DISPLAY").is_some(){"x11".into()}else{"none".into()};
    RuntimeCapabilities{session_type:session_type.clone(),display,wine:command_exists("wine")||command_exists("wine64"),wineboot:command_exists("wineboot"),webkitgtk:true,external_window_mode:if session_type.eq_ignore_ascii_case("wayland"){"janela própria; Wayland não permite reparenting arbitrário".into()}else{"janela própria; host X11 ainda não implementado".into()}}
}
#[tauri::command]
fn load_config() -> Result<Option<Value>> { let path=config_file()?; if !path.exists() { return Ok(None); } let text=fs::read_to_string(path).map_err(|e|e.to_string())?; serde_json::from_str(&text).map(Some).map_err(|e|e.to_string()) }
#[tauri::command]
fn save_config(config: Value) -> Result<()> { if config["version"]!=1 || !config.is_object() {return Err("Configuração inválida".into());} let text=serde_json::to_string_pretty(&config).map_err(|e|e.to_string())?; if text.len()>4_000_000{return Err("Configuração excede 4 MB".into());} let path=config_file()?; fs::create_dir_all(path.parent().unwrap()).map_err(|e|e.to_string())?; let tmp=path.with_extension("json.tmp"); fs::write(&tmp,text).map_err(|e|e.to_string())?; fs::rename(tmp,path).map_err(|e|e.to_string()) }

fn desktop_entry(path: &Path) -> Result<HashMap<String,String>> { let text=fs::read_to_string(path).map_err(|e|e.to_string())?; let mut result=HashMap::new(); let mut in_entry=false; for line in text.lines() { let line=line.trim(); if line.starts_with('[') { in_entry=line=="[Desktop Entry]";continue; } if in_entry&&!line.starts_with('#') { if let Some((k,v))=line.split_once('=') { result.insert(k.to_string(),v.to_string()); } } } Ok(result) }
fn desktop_files(dir:&Path, depth:usize, out:&mut Vec<PathBuf>) { if depth>8 {return;} if let Ok(entries)=fs::read_dir(dir) { for entry in entries.flatten() { let path=entry.path(); if let Ok(kind)=entry.file_type() { if kind.is_dir() {desktop_files(&path,depth+1,out);} else if path.extension().is_some_and(|x|x=="desktop") {out.push(path);} } } } }
#[tauri::command]
fn list_apps() -> Result<Vec<Shortcut>> {
    let user=env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|p|p.is_absolute()).unwrap_or(home()?.join(".local/share"));
    let mut roots=vec![user.join("applications")];
    for root in env::var("XDG_DATA_DIRS").unwrap_or("/usr/local/share:/usr/share".into()).split(':').filter(|s|s.starts_with('/')) { roots.push(PathBuf::from(root).join("applications")); }
    let mut seen=HashSet::new();let mut apps=Vec::new();
    for root in roots { let mut paths=Vec::new();desktop_files(&root,0,&mut paths);paths.sort();for path in paths {let id=path.strip_prefix(&root).unwrap_or(&path).to_string_lossy().replace('/',"-");if !seen.insert(id.clone()){continue;}let Ok(entry)=desktop_entry(&path) else{continue};if entry.get("Type").map(String::as_str)!=Some("Application")||entry.get("Hidden").is_some_and(|v|v=="true")||entry.get("NoDisplay").is_some_and(|v|v=="true")||!entry.contains_key("Exec"){continue;}
      let desktop=env::var("XDG_CURRENT_DESKTOP").unwrap_or("KDE".into());let desktops:Vec<&str>=desktop.split(':').collect();
      if entry.get("OnlyShowIn").is_some_and(|v|!v.split(';').any(|x|desktops.contains(&x))){continue;}
      if entry.get("NotShowIn").is_some_and(|v|v.split(';').any(|x|desktops.contains(&x))){continue;}
      let name=entry.get("Name[pt_BR]").or_else(||entry.get("Name[pt]")).or_else(||entry.get("Name")).cloned().unwrap_or(id.clone());
      apps.push(Shortcut{id,name,path:path.to_string_lossy().into(),args:vec![],icon:"box".into(),color:"#b7a2f8".into(),kind:"desktop".into(),prefix:String::new(),cwd:String::new()});
    }}apps.sort_by_key(|a|a.name.to_lowercase());Ok(apps)
}
fn desktop_args(exec:&str,entry:&HashMap<String,String>,path:&str)->Result<Vec<String>> {
    let tokens=shell_words::split(exec).map_err(|e|format!("Exec inválido: {e}"))?;let mut args=Vec::new();
    for token in tokens {match token.as_str(){"%f"|"%F"|"%u"|"%U"=>{},"%i"=>{if let Some(icon)=entry.get("Icon"){args.push("--icon".into());args.push(icon.clone());}},"%c"=>args.push(entry.get("Name").cloned().unwrap_or_default()),"%k"=>args.push(path.into()),_=>{let sentinel="\u{0001}";let token=token.replace("%%",sentinel);if token.contains('%'){return Err(format!("Código de campo não suportado em Exec: {token}"));}args.push(token.replace(sentinel,"%"));}}}if args.is_empty(){return Err("Exec vazio".into());}Ok(args)
}
#[tauri::command]
fn launch_app(shortcut: Shortcut) -> Result<u32> {
    if shortcut.path.trim().is_empty(){return Err("Escolha um executável".into());}
    let mut cwd=shortcut.cwd.clone();let mut command;
    if shortcut.kind=="desktop" {let path=expand(&shortcut.path)?;let entry=desktop_entry(&path)?;let exec=entry.get("Exec").ok_or("Arquivo .desktop sem Exec")?;let args=desktop_args(exec,&entry,&path.to_string_lossy())?;if entry.get("Terminal").is_some_and(|v|v=="true"){command=Command::new("konsole");command.arg("-e").args(args);}else{command=Command::new(&args[0]);command.args(&args[1..]);}if cwd.is_empty(){cwd=entry.get("Path").cloned().unwrap_or_default();}}
    else if shortcut.kind=="wine"||shortcut.path.to_lowercase().ends_with(".exe") {let wine=if command_exists("wine"){"wine"}else if command_exists("wine64"){"wine64"}else{return Err("Wine não foi encontrado no PATH. Instale wine (e wineboot para prefixos) antes de executar um .exe.".into())};command=Command::new(wine);command.arg(expand(&shortcut.path)?);if !shortcut.prefix.is_empty(){let prefix=expand(&shortcut.prefix)?;if !prefix.is_absolute(){return Err("Use um caminho absoluto para o prefixo Wine".into());}command.env("WINEPREFIX",prefix);}}
    else {command=Command::new(expand(&shortcut.path)?);}
    command.args(&shortcut.args);if !cwd.is_empty(){command.current_dir(expand(&cwd)?);}
    let logs=data_dir()?.join("logs");fs::create_dir_all(&logs).map_err(|e|e.to_string())?;
    let timestamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();let log=fs::File::create(logs.join(format!("launch-{timestamp}.log"))).map_err(|e|e.to_string())?;
    command.stdin(Stdio::null()).stdout(Stdio::from(log.try_clone().map_err(|e|e.to_string())?)).stderr(Stdio::from(log));
    let mut child=command.spawn().map_err(|e|format!("{e}. Verifique o executável e se o aplicativo/Wine está instalado."))?;let pid=child.id();std::thread::spawn(move||{let _=child.wait();});Ok(pid)
}
fn whatsapp_url()->Result<WebviewUrl> { Ok(WebviewUrl::External("https://web.whatsapp.com/".parse().map_err(|e|format!("URL do WhatsApp inválida: {e}"))?)) }
fn place_whatsapp_child(main:&tauri::Window,webview:&Webview)->Result<()> {
    let size=main.inner_size().map_err(|e|e.to_string())?;
    let x=((size.width as f64)*0.18).min(240.0) as i32;
    let y=((size.height as f64)*0.09).min(82.0) as i32;
    let width=size.width.saturating_sub(x as u32).saturating_sub(22).max(1);
    let height=size.height.saturating_sub(y as u32).saturating_sub(20).max(1);
    webview.set_size(PhysicalSize::new(width,height)).map_err(|e|e.to_string())?;
    webview.set_position(PhysicalPosition::new(x,y)).map_err(|e|e.to_string())?;
    Ok(())
}
fn place_whatsapp_window(main:&tauri::Window,window:&tauri::WebviewWindow)->Result<()> {
    let origin=main.outer_position().map_err(|e|e.to_string())?;
    let size=main.inner_size().map_err(|e|e.to_string())?;
    let width=(size.width as f64*0.86).max(720.0).min(1400.0) as u32;
    let height=(size.height as f64*0.84).max(520.0).min(900.0) as u32;
    let x=origin.x+((size.width.saturating_sub(width))/2) as i32;
    let y=origin.y+((size.height.saturating_sub(height))/2) as i32;
    window.set_size(PhysicalSize::new(width,height)).map_err(|e|e.to_string())?;
    window.set_position(PhysicalPosition::new(x,y)).map_err(|e|e.to_string())?;
    Ok(())
}
#[tauri::command]
fn open_whatsapp(app:tauri::AppHandle)->Result<()> {
    let main=app.get_window("main").ok_or("janela principal não encontrada")?;
    if let Some(webview)=app.get_webview("whatsapp") { place_whatsapp_child(&main,&webview)?;webview.show().map_err(|e|e.to_string())?;webview.set_focus().map_err(|e|e.to_string())?;return Ok(()); }
    if let Some(window)=app.get_webview_window("whatsapp") { place_whatsapp_window(&main,&window)?;window.show().map_err(|e|e.to_string())?;window.set_focus().map_err(|e|e.to_string())?;return Ok(()); }
    let whatsapp_builder=WebviewBuilder::new("whatsapp",whatsapp_url()?).data_directory(data_dir()?.join("webview/whatsapp"));
    match main.add_child(whatsapp_builder,PhysicalPosition::new(0,0),PhysicalSize::new(1,1)) {
        Ok(webview)=>{place_whatsapp_child(&main,&webview)?;webview.show().map_err(|e|e.to_string())?;webview.set_focus().map_err(|e|e.to_string())?;Ok(())}
        Err(error)=>{
            diagnostic(format!("child webview do WhatsApp falhou; usando janela própria: {error}"));
            let window=WebviewWindowBuilder::new(&app,"whatsapp",whatsapp_url()?).title("Fixio · WhatsApp Web").inner_size(1100.0,760.0).min_inner_size(720.0,520.0).decorations(true).visible(false).build().map_err(|e|e.to_string())?;
            place_whatsapp_window(&main,&window)?;window.show().map_err(|e|e.to_string())?;window.set_focus().map_err(|e|e.to_string())?;Ok(())
        }
    }
}
#[tauri::command]
fn close_whatsapp(app:tauri::AppHandle)->Result<()> { if let Some(webview)=app.get_webview("whatsapp"){webview.hide().map_err(|e|e.to_string())?;}if let Some(window)=app.get_webview_window("whatsapp"){window.hide().map_err(|e|e.to_string())?;}Ok(()) }
#[tauri::command]
fn resize_whatsapp(app:tauri::AppHandle)->Result<()> { let main=app.get_window("main").ok_or("janela principal não encontrada")?;if let Some(webview)=app.get_webview("whatsapp"){place_whatsapp_child(&main,&webview)?;}else if let Some(window)=app.get_webview_window("whatsapp"){place_whatsapp_window(&main,&window)?;}Ok(()) }
#[tauri::command]
fn list_prefixes()->Result<Vec<String>> {let dir=data_dir()?.join("wine-prefixes");if !dir.exists(){return Ok(vec![]);}let mut items=Vec::new();for e in fs::read_dir(dir).map_err(|e|e.to_string())?.flatten(){if e.path().is_dir(){items.push(e.path().to_string_lossy().into());}}items.sort();Ok(items)}
#[tauri::command]
async fn create_prefix(name:String)->Result<()> {if name.is_empty()||name.len()>64||!name.chars().all(|c|c.is_ascii_alphanumeric()||c=='-'||c=='_'){return Err("Use até 64 letras, números, hífen ou sublinhado.".into());}if !command_exists("wineboot"){return Err("wineboot não foi encontrado no PATH. Instale o pacote Wine antes de criar prefixos.".into());}let dir=data_dir()?.join("wine-prefixes").join(name);if dir.exists(){return Err("Esse prefixo já existe.".into());}tauri::async_runtime::spawn_blocking(move||{fs::create_dir_all(&dir).map_err(|e|e.to_string())?;let output=Command::new("wineboot").arg("--init").env("WINEPREFIX",&dir).output().map_err(|e|format!("Falha ao iniciar wineboot: {e}"))?;if !output.status.success(){return Err(format!("wineboot falhou: {}",String::from_utf8_lossy(&output.stderr)));}Ok(())}).await.map_err(|e|e.to_string())?}
fn autostart_path()->Result<PathBuf>{Ok(config_root()?.join("autostart/fixio-shell.desktop"))}
#[tauri::command]
fn get_autostart()->Result<bool>{Ok(autostart_path()?.exists())}
#[tauri::command]
fn set_autostart(enabled:bool)->Result<()> {let path=autostart_path()?;if !enabled {if path.exists(){fs::remove_file(path).map_err(|e|e.to_string())?;}return Ok(());}let exe=env::var_os("APPIMAGE").map(PathBuf::from).unwrap_or(env::current_exe().map_err(|e|e.to_string())?);let quoted=exe.to_string_lossy().replace('\\',"\\\\").replace('"',"\\\"").replace('`',"\\`").replace('$',"\\$").replace('%',"%%");if quoted.contains('\n')||quoted.contains('\r'){return Err("Caminho inválido para início automático".into());}fs::create_dir_all(path.parent().unwrap()).map_err(|e|e.to_string())?;fs::write(path,format!("[Desktop Entry]\nType=Application\nName=Fixio Shell\nComment=Seu desktop, do seu jeito\nExec=\"{quoted}\" --autostart\nTerminal=false\nX-GNOME-Autostart-enabled=true\n")).map_err(|e|e.to_string())}
#[tauri::command]
fn system_stats()->Value {let memory=fs::read_to_string("/proc/meminfo").ok().and_then(|s|{let mut total=0f64;let mut available=0f64;for line in s.lines(){let mut p=line.split_whitespace();match p.next(){Some("MemTotal:")=>total=p.next()?.parse().ok()?,Some("MemAvailable:")=>available=p.next()?.parse().ok()?,_=>{}}}if total>0.0{Some(format!("RAM {:.0}%",(total-available)/total*100.0))}else{None}}).unwrap_or("RAM —".into());let mut battery="Sem bateria".to_string();if let Ok(entries)=fs::read_dir("/sys/class/power_supply"){for e in entries.flatten(){if fs::read_to_string(e.path().join("type")).unwrap_or_default().trim()=="Battery"{if let Ok(cap)=fs::read_to_string(e.path().join("capacity")){battery=format!("{}% bateria",cap.trim());break;}}}}json!({"memory":memory,"battery":battery})}
#[tauri::command]
fn show_settings(app:tauri::AppHandle,dock_id:Option<String>)->Result<()> {diagnostic(format!("show_settings: solicitação recebida pela dock {:?}",dock_id));if let Some(id)=dock_id{app.emit("settings-dock",id).map_err(|e|e.to_string())?;}if let Some(window)=app.get_webview_window("main"){window.show().map_err(|e|{let error=e.to_string();diagnostic(format!("show_settings: show falhou: {error}"));error})?;window.set_focus().map_err(|e|{let error=e.to_string();diagnostic(format!("show_settings: foco falhou: {error}"));error})?;diagnostic("show_settings: janela main exibida");}else{let error="janela main não encontrada".to_string();diagnostic(format!("show_settings: erro: {error}"));return Err(error);}Ok(())}
fn clamped(config:&Value,key:&str,default:f64,min:f64,max:f64)->f64{config[key].as_f64().unwrap_or(default).clamp(min,max)}
fn configure_dock_window(window:&tauri::WebviewWindow,config:&Value,id:&str)->Result<()> {
    diagnostic(format!("configure_dock[{id}]: iniciando"));
    diagnostic(format!("configure_dock[{id}]: handle da janela encontrado"));
    let monitor=match window.current_monitor().map_err(|e|e.to_string())? {
        Some(monitor)=>monitor,
        None=>match window.primary_monitor().map_err(|e|e.to_string())? {
            Some(monitor)=>monitor,
            None=>{
                let error="nenhum monitor foi detectado".to_string();
                diagnostic(format!("configure_dock[{id}]: erro: {error}"));
                return Err(error);
            }
        }
    };
    let scale=monitor.scale_factor();
    let screen=monitor.size().to_logical::<f64>(scale);
    let origin=monitor.position().to_logical::<f64>(scale);
    diagnostic(format!("configure_dock[{id}]: monitor lógico={:.0}x{:.0}, origem=({:.0},{:.0}), escala={scale:.2}",screen.width,screen.height,origin.x,origin.y));
    let position=config["position"].as_str().unwrap_or("bottom");
    let vertical=position=="left"||position=="right";
    let icon=clamped(config,"iconSize",42.0,28.0,64.0);
    let gap=clamped(config,"gap",10.0,4.0,24.0);
    let margin=clamped(config,"margin",18.0,0.0,64.0);
    let count=config["shortcuts"].as_array().map(|v|v.len().min(30)).unwrap_or(5) as f64;
    let widgets=if ["clock","memory","battery"].iter().any(|k|config[k].as_bool().unwrap_or(*k=="clock")){if vertical{52.0}else{78.0}}else{0.0};
    let available=if vertical{(screen.height-2.0*margin).max(1.0)}else{(screen.width-2.0*margin).max(1.0)};
    let length=((count+2.0)*(icon+gap)+42.0+widgets).min(available);
    let thickness=icon+24.0;
    let (width,height)=if vertical{(thickness.max(90.0),length)}else{(length,thickness.max(70.0))};
    let (x,y)=match position {"top"=>((screen.width-width)/2.0,margin),"left"=>(margin,(screen.height-height)/2.0),"right"=>(screen.width-width-margin,(screen.height-height)/2.0),_=>((screen.width-width)/2.0,screen.height-height-margin)};
    let logical_position=LogicalPosition::new(origin.x+x,origin.y+y);
    diagnostic(format!("configure_dock[{id}]: posição={position}, vertical={vertical}, tamanho lógico={width:.0}x{height:.0}, posição lógica=({:.0},{:.0})",logical_position.x,logical_position.y));
    let mut first_error=None;
    if let Err(error)=window.set_size(LogicalSize::new(width,height)) {
        let error=format!("set_size falhou: {error}");
        diagnostic(format!("configure_dock[{id}]: erro: {error}"));
        first_error=Some(error);
    }else{diagnostic(format!("configure_dock[{id}]: set_size concluído"));}
    if let Err(error)=window.set_position(logical_position) {
        let error=format!("set_position falhou (Wayland pode rejeitar coordenadas absolutas): {error}");
        diagnostic(format!("configure_dock[{id}]: erro: {error}"));
        if first_error.is_none(){first_error=Some(error);}
    }else{diagnostic(format!("configure_dock[{id}]: set_position concluído"));}
    if let Err(error)=window.show() {
        let error=format!("show falhou: {error}");
        diagnostic(format!("configure_dock[{id}]: erro: {error}"));
        return Err(error);
    }
    diagnostic(format!("configure_dock[{id}]: dock visível"));
    if let Some(error)=first_error{Err(error)}else{Ok(())}
}
fn dock_label(id:&str)->String {
    let safe=id.chars().filter(|c|c.is_ascii_alphanumeric()||*c=='-'||*c=='_').take(48).collect::<String>();
    format!("dock-{}",if safe.is_empty(){"main".into()}else{safe})
}
fn dock_entries(config:&Value)->Vec<(String,Value)> {
    if let Some(docks)=config["docks"].as_array(){
        docks.iter().enumerate().map(|(index,dock)|{
            let id=dock["id"].as_str().filter(|id|!id.is_empty()).map(ToOwned::to_owned).unwrap_or_else(||if index==0{"main".into()}else{format!("dock-{}",index+1)});
            (id,dock.clone())
        }).collect()
    }else{
        let mut legacy=config.clone();legacy["id"]=json!("main");legacy["name"]=json!("Principal");legacy["enabled"]=json!(true);vec![("main".into(),legacy)]
    }
}
fn create_dock_window(app:&tauri::AppHandle,id:&str,name:&str)->Result<tauri::WebviewWindow> {
    let safe_id=dock_label(id).trim_start_matches("dock-").to_string();
    let label=dock_label(id);
    tauri::WebviewWindowBuilder::new(app,&label,tauri::WebviewUrl::App(format!("index.html?dock={safe_id}").into())).title(format!("Fixio Shell · {name}")).inner_size(520.0,76.0).decorations(false).transparent(true).always_on_top(true).skip_taskbar(true).resizable(false).visible(false).build().map_err(|error|{diagnostic(format!("criação da janela {label} falhou: {error}"));error.to_string()})
}
#[tauri::command]
fn configure_dock(app:tauri::AppHandle,config:Value)->Result<()> {
    let label=dock_label("main");
    let window=app.get_webview_window(&label).or_else(||app.get_webview_window("dock")).ok_or_else(||format!("janela {label} não encontrada"))?;
    configure_dock_window(&window,&config,"main")
}
#[tauri::command]
fn configure_docks(app:tauri::AppHandle,config:Value)->Result<()> {
    diagnostic("configure_docks: sincronizando todas as barras");
    let entries=dock_entries(&config);
    let mut active_labels=HashSet::new();
    let mut first_error=None;
    for (id,dock_config) in entries {
        let label=dock_label(&id);
        if !dock_config["enabled"].as_bool().unwrap_or(true){
            diagnostic(format!("configure_docks: dock {id} desativada"));
            if let Some(window)=app.get_webview_window(&label){let _=window.hide();}
            continue;
        }
        active_labels.insert(label.clone());
        let name=dock_config["name"].as_str().unwrap_or("Dock");
        let window=match app.get_webview_window(&label){Some(window)=>window,None=>match create_dock_window(&app,&id,name){Ok(window)=>window,Err(error)=>{if first_error.is_none(){first_error=Some(error);}continue;}}};
        if let Err(error)=configure_dock_window(&window,&dock_config,&id){diagnostic(format!("configure_docks: dock {id} terminou com erro: {error}"));if first_error.is_none(){first_error=Some(error);}}
    }
    for (label,window) in app.webview_windows(){if label.starts_with("dock-")&&!active_labels.contains(&label){diagnostic(format!("configure_docks: ocultando dock obsoleta {label}"));let _=window.hide();}}
    if let Some(error)=first_error{Err(error)}else{Ok(())}
}
fn main(){tauri::Builder::default().plugin(tauri_plugin_dialog::init()).setup(|app|{
    log_runtime_environment();
    let config=match load_config(){Ok(Some(config))=>{diagnostic("configuração persistida carregada");config},Ok(None)=>{diagnostic("nenhuma configuração persistida; usando dimensões padrão");json!({})},Err(error)=>{diagnostic(format!("falha ao carregar configuração; usando padrão: {error}"));json!({})}};
    if let Err(error)=configure_docks(app.handle().clone(),config){diagnostic(format!("configure_docks terminou com erro: {error}"));}
    // O lançamento normal mostra somente o painel sobre o desktop. A tela de
    // configurações é uma janela secundária e só aparece pelo botão da barra
    // ou quando o binário é chamado explicitamente com --settings.
    if env::args().any(|a|a=="--settings"){diagnostic("argumento --settings detectado; abrindo configurações");if let Some(window)=app.get_webview_window("main"){window.show()?;window.set_focus()?;}else{diagnostic("janela main não encontrada para --settings");}}else{diagnostic("inicialização normal: somente a dock será exibida");}
    Ok(())
}).on_window_event(|window,event|{if window.label()=="main"{if let tauri::WindowEvent::CloseRequested{api,..}=event{api.prevent_close();let _=window.hide();}}}).invoke_handler(tauri::generate_handler![load_config,save_config,list_apps,launch_app,list_prefixes,create_prefix,get_autostart,set_autostart,system_stats,runtime_capabilities,open_whatsapp,close_whatsapp,resize_whatsapp,show_settings,configure_dock,configure_docks]).run(tauri::generate_context!()).expect("Não foi possível iniciar o Fixio Shell");}

#[cfg(test)]
mod tests {use super::*;#[test]fn desktop_fields_are_arguments_not_shell(){let entry=HashMap::from([("Name".into(),"Meu App".into()),("Icon".into(),"my-icon".into())]);assert_eq!(desktop_args("app --title %c %U %i %%",&entry,"/tmp/app.desktop").unwrap(),vec!["app","--title","Meu App","--icon","my-icon","%"]);}#[test]fn quoted_executable_preserved(){assert_eq!(desktop_args("\"/opt/My App/run\" --flag",&HashMap::new(),"").unwrap(),vec!["/opt/My App/run","--flag"]);}#[test]fn embedded_fields_are_rejected(){assert!(desktop_args("app --file=%f",&HashMap::new(),"").is_err());}}
