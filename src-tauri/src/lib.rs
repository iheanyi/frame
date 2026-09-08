mod editor;
mod live;
mod originals;
mod tango;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};

#[derive(Default)]
struct Studio {
    session: Mutex<Option<Session>>,
    exporting: Mutex<bool>,
}
struct Session {
    child: Child,
    path: Option<PathBuf>,
    log: PathBuf,
    started: u64,
    mic: Option<Child>,
    mic_path: Option<PathBuf>,
}
#[derive(Serialize, Deserialize, Default, Clone)]
struct Settings {
    scrcpy: String,
    adb: String,
    ffmpeg: String,
    #[serde(default)]
    direct_usb: bool,
}
#[derive(Serialize)]
struct Device {
    serial: String,
    name: String,
    state: String,
    connection: String,
}
#[derive(Serialize)]
struct Health {
    tango: Option<String>,
    scrcpy: Option<String>,
    adb: Option<String>,
    ffmpeg: Option<String>,
    folder: String,
    settings: Settings,
}
#[derive(Serialize, Clone)]
struct Capture {
    name: String,
    path: String,
    kind: String,
    bytes: u64,
    created: u64,
}
#[derive(Serialize)]
struct SessionStatus {
    active: bool,
    recording: bool,
    started: u64,
    message: Option<String>,
}
#[derive(Deserialize)]
struct RecordOptions {
    serial: String,
    size: u32,
    fps: u32,
    audio: String,
    touches: bool,
    record: bool,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
fn folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let p = app
        .path()
        .video_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|e| e.to_string())?
        .join("Frame");
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}
fn config(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("tools.json"))
}
fn settings(app: &tauri::AppHandle) -> Settings {
    config(app)
        .ok()
        .and_then(|p| fs::read(p).ok())
        .and_then(|s| serde_json::from_slice(&s).ok())
        .unwrap_or_default()
}
fn resolve(name: &str, custom: &str) -> Option<PathBuf> {
    if !custom.trim().is_empty() {
        return Path::new(custom).is_file().then(|| PathBuf::from(custom));
    }
    let exe = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.into()
    };
    let mut dirs: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ]);
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home = PathBuf::from(home);
        dirs.extend([
            home.join("Library/Android/sdk/platform-tools"),
            home.join("Android/Sdk/platform-tools"),
            home.join("AppData/Local/Android/Sdk/platform-tools"),
            home.join("scoop/shims"),
        ]);
    }
    dirs.into_iter().map(|d| d.join(&exe)).find(|p| p.is_file())
}
fn tool(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let s = settings(app);
    let custom = match name {
        "scrcpy" => s.scrcpy,
        "adb" => s.adb,
        _ => s.ffmpeg,
    };
    resolve(name, &custom)
        .ok_or_else(|| format!("{name} was not found. Choose its executable in Settings."))
}
fn command(path: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut c = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    c.stdin(Stdio::null());
    c
}
fn output(c: Command) -> Result<Vec<u8>, String> {
    output_timeout(c, Duration::from_secs(1800))
}
fn output_timeout(mut c: Command, timeout: Duration) -> Result<Vec<u8>, String> {
    use std::io::Read;
    c.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let out = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = stdout.read_to_end(&mut b);
        b
    });
    let err = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = stderr.read_to_end(&mut b);
        b
    });
    let began = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if began.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = out.join();
            let _ = err.join();
            return Err("Device request timed out. Wake and unlock your phone, or open Mirror, then try again.".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let stdout = out.join().map_err(|_| "Output reader failed")?;
    let stderr = err.join().map_err(|_| "Error reader failed")?;
    if !status.success() {
        return Err(String::from_utf8_lossy(&stderr)
            .chars()
            .take(1800)
            .collect());
    }
    Ok(stdout)
}
fn adb(app: &tauri::AppHandle, serial: &str) -> Result<Command, String> {
    if serial.is_empty() || serial.starts_with('-') {
        return Err("Select a connected device first.".into());
    }
    let mut c = command(tool(app, "adb")?);
    c.args(["-s", serial]);
    Ok(c)
}
#[tauri::command]
fn health(app: tauri::AppHandle) -> Result<Health, String> {
    let s = settings(&app);
    Ok(Health {
        tango: tango::availability(&app).ok(),
        scrcpy: resolve("scrcpy", &s.scrcpy).map(|p| p.display().to_string()),
        adb: resolve("adb", &s.adb).map(|p| p.display().to_string()),
        ffmpeg: resolve("ffmpeg", &s.ffmpeg).map(|p| p.display().to_string()),
        folder: folder(&app)?.display().to_string(),
        settings: s,
    })
}
#[tauri::command]
fn save_settings(app: tauri::AppHandle, value: Settings) -> Result<(), String> {
    for p in [&value.scrcpy, &value.adb, &value.ffmpeg] {
        if !p.is_empty() && !Path::new(p).is_file() {
            return Err(format!("Executable does not exist: {p}"));
        }
    }
    if value.direct_usb != settings(&app).direct_usb {
        if tango::is_recording(&app) || app.state::<Studio>().session.lock().map_err(|e| e.to_string())?.is_some() { return Err("Stop the recording before changing transport.".into()); }
        app.state::<live::LiveState>().0.lock().map_err(|e| e.to_string())?.take();
        tango::shutdown(&app);
    }
    fs::write(
        config(&app)?,
        serde_json::to_vec(&value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
fn parse_devices(s: &str) -> Vec<Device> {
    s.lines()
        .skip(1)
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let serial = fields.next()?;
            let state = fields.next()?;
            let details: Vec<&str> = fields.collect();
            let name = details
                .iter()
                .find_map(|f| f.strip_prefix("model:"))
                .unwrap_or(serial)
                .replace('_', " ");
            let connection = if serial.starts_with("emulator-") {
                "Emulator"
            } else if details.iter().any(|s| s.starts_with("usb:")) {
                "USB"
            } else {
                "Wi-Fi"
            };
            Some(Device {
                serial: serial.into(),
                name,
                state: state.into(),
                connection: connection.into(),
            })
        })
        .collect()
}
#[tauri::command]
async fn devices(app: tauri::AppHandle) -> Result<Vec<Device>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if settings(&app).direct_usb { return tango::devices(&app); }
        let mut c = command(tool(&app, "adb")?);
        c.args(["devices", "-l"]);
        Ok(parse_devices(&String::from_utf8_lossy(&output(c)?)))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn parse_display_size(text: &str) -> Option<(u32, u32)> {
    text.lines()
        .filter_map(|line| {
            let (label, size) = line.split_once(':')?;
            if !matches!(label.trim(), "Physical size" | "Override size") {
                return None;
            }
            let (w, h) = size.trim().split_once('x')?;
            let w = w.parse::<u32>().ok()?;
            let h = h.parse::<u32>().ok()?;
            (w > 0 && h > 0).then_some((w, h))
        })
        .last()
}
#[tauri::command]
async fn display_size(app: tauri::AppHandle, serial: String) -> Result<(u32, u32), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if settings(&app).direct_usb { return tango::display_size(&app, &serial); }
        let mut c = adb(&app, &serial)?;
        c.args(["shell", "wm", "size"]);
        parse_display_size(&String::from_utf8_lossy(&output_timeout(
            c,
            Duration::from_secs(5),
        )?))
        .ok_or("The phone did not report its display resolution.".into())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn screen(app: &tauri::AppHandle, serial: &str) -> Result<Vec<u8>, String> {
    if settings(app).direct_usb { return tango::screen(app, serial); }
    let mut c = adb(app, serial)?;
    c.args(["exec-out", "screencap", "-p"]);
    let bytes = output_timeout(c, Duration::from_secs(8))?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("The device did not return an image. Unlock it and try again.".into());
    }
    Ok(bytes)
}
#[tauri::command]
async fn preview(app: tauri::AppHandle, serial: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(screen(&app, &serial)?)
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn capture_info(p: &Path) -> Result<Capture, String> {
    let m = fs::metadata(p).map_err(|e| e.to_string())?;
    Ok(Capture {
        name: p.file_name().unwrap_or_default().to_string_lossy().into(),
        path: p.display().to_string(),
        kind: if p.extension().is_some_and(|e| e == "png") {
            "image"
        } else {
            "video"
        }
        .into(),
        bytes: m.len(),
        created: m
            .modified()
            .unwrap_or(UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    })
}
#[tauri::command]
async fn screenshot(app: tauri::AppHandle, serial: String) -> Result<Capture, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = folder(&app)?.join(format!("Screenshot-{}.png", stamp()));
        fs::write(&p, screen(&app, &serial)?).map_err(|e| e.to_string())?;
        capture_info(&p)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn record_args(o: &RecordOptions, p: Option<&Path>) -> Result<Vec<String>, String> {
    if o.serial.is_empty()
        || o.serial.starts_with('-')
        || ![720, 1080, 1440, 1920, 2560, 0].contains(&o.size)
        || ![24, 30, 60, 120].contains(&o.fps)
    {
        return Err("Invalid capture settings.".into());
    }
    let mut a = vec![
        format!("--serial={}", o.serial),
        format!("--max-size={}", o.size),
        format!("--max-fps={}", o.fps),
        "--video-codec=h264".into(),
        "--video-bit-rate=16M".into(),
        "--window-title=Frame · Device".into(),
        "--window-height=780".into(),
    ];
    if o.size == 0 {
        a.push("--no-downsize-on-error".into());
    }
    match o.audio.as_str() {
        "none" => a.push("--no-audio".into()),
        "device" | "both" | "mic" => {
            a.extend(["--audio-codec=aac".into(), "--require-audio".into()]);
            if o.audio == "mic" {
                a.push("--audio-source=mic".into());
            }
            if o.audio != "device" {
                a.push("--no-audio-playback".into());
            }
        }
        _ => return Err("Invalid audio source.".into()),
    }
    if o.touches {
        a.push("--show-touches".into());
    }
    if let Some(p) = p {
        a.push("--no-playback".into());
        a.push(format!("--record={}", p.display()));
    }
    Ok(a)
}
#[tauri::command]
fn start_session(
    app: tauri::AppHandle,
    state: State<Studio>,
    options: RecordOptions,
) -> Result<(), String> {
    if settings(&app).direct_usb { return tango::start_recording(&app, &options); }
    let mut lock = state.session.lock().map_err(|e| e.to_string())?;
    if lock.is_some() {
        return Err("Stop the current session first.".into());
    }
    let root = folder(&app)?;
    if options.record {
        tool(&app, "ffmpeg")?;
    }
    let path = options
        .record
        .then(|| root.join(format!("Recording-{}.mkv", stamp())));
    let log = root.join("session.log");
    let file = fs::File::create(&log).map_err(|e| e.to_string())?;
    let mut c = command(tool(&app, "scrcpy")?);
    c.env("ADB", tool(&app, "adb")?)
        .args(record_args(&options, path.as_deref())?)
        .stdout(Stdio::from(file.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(file));
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    let mic_path = if options.audio == "both" && options.record {
        path.as_ref().map(|p| p.with_extension("mic.mka"))
    } else {
        None
    };
    let mic = if let Some(p) = &mic_path {
        let mut c = command(tool(&app, "scrcpy")?);
        c.env("ADB", tool(&app, "adb")?).args([
            format!("--serial={}", options.serial),
            "--no-video".into(),
            "--no-control".into(),
            "--no-playback".into(),
            "--audio-source=mic".into(),
            "--audio-codec=aac".into(),
            "--require-audio".into(),
            format!("--record={}", p.display()),
        ]);
        let mic_log = fs::File::create(root.join("microphone.log")).map_err(|e| e.to_string())?;
        c.stdout(Stdio::null()).stderr(Stdio::from(mic_log));
        match c.spawn() {
            Ok(c) => Some(c),
            Err(e) => {
                stop_child(&mut child);
                return Err(format!("Microphone could not start: {e}"));
            }
        }
    } else {
        None
    };
    *lock = Some(Session {
        child,
        path,
        log,
        started: now(),
        mic,
        mic_path,
    });
    Ok(())
}
fn stop_child(child: &mut Child) {
    if child.try_wait().ok().flatten().is_some() {
        return;
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(child.id() as i32, libc::SIGINT);
    }
    #[cfg(windows)]
    {
        let _ = child.kill();
    }
    for _ in 0..60 {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
}
fn finalize(app: &tauri::AppHandle, s: &Session) -> Result<Option<Capture>, String> {
    let Some(p) = &s.path else {
        return Ok(None);
    };
    if !p.exists() || fs::metadata(p).map_err(|e| e.to_string())?.len() < 1024 {
        return Err(format!(
            "Recording could not start. {}",
            fs::read_to_string(&s.log).unwrap_or_default()
        ));
    }
    let dest = p.with_extension("mp4");
    let temp = dest.with_file_name(format!(
        ".partial-{}",
        dest.file_name().unwrap().to_string_lossy()
    ));
    let mut c = command(tool(app, "ffmpeg")?);
    c.args(["-hide_banner", "-loglevel", "error", "-n", "-i"])
        .arg(p);
    if let Some(mic) = &s.mic_path {
        c.arg("-i").arg(mic).args([
            "-filter_complex",
            "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[a]",
            "-map",
            "0:v",
            "-map",
            "[a]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
        ]);
    } else {
        c.args([
            "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", "-c:a", "aac",
        ]);
    }
    c.args(["-movflags", "+faststart"]).arg(&temp);
    match output(c) {
        Ok(_) => {
            fs::rename(&temp, &dest).map_err(|e| e.to_string())?;
            capture_info(&dest).map(Some)
        }
        Err(e) => Err(format!(
            "Original MKV saved, but MP4 conversion failed: {e}"
        )),
    }
}
#[tauri::command]
async fn stop_session(app: tauri::AppHandle) -> Result<Option<Capture>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if tango::is_recording(&app) { return tango::stop_recording(&app); }
        let state = app.state::<Studio>();
        let mut lock = state.session.lock().map_err(|e| e.to_string())?;
        let Some(mut s) = lock.take() else {
            return Ok(None);
        };
        stop_child(&mut s.child);
        if let Some(mic) = s.mic.as_mut() {
            stop_child(mic);
        }
        finalize(&app, &s)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn session_status(app: tauri::AppHandle) -> Result<SessionStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(status) = tango::status(&app)? { return Ok(status); }
        let state = app.state::<Studio>();
        let mut lock = state.session.lock().map_err(|e| e.to_string())?;
        if let Some(s) = lock.as_mut() {
            let mic_ended = s
                .mic
                .as_mut()
                .is_some_and(|m| m.try_wait().ok().flatten().is_some());
            if !mic_ended && s.child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Ok(SessionStatus {
                    active: true,
                    recording: s.path.is_some(),
                    started: s.started,
                    message: None,
                });
            }
            let mut s = lock.take().unwrap();
            stop_child(&mut s.child);
            if let Some(mic) = s.mic.as_mut() {
                stop_child(mic);
            }
            let message = match finalize(&app, &s) {
                Ok(Some(_)) => {
                    if mic_ended {
                        "Microphone capture ended unexpectedly. The partial recording was saved."
                            .into()
                    } else {
                        "Recording saved.".into()
                    }
                }
                Ok(None) => fs::read_to_string(&s.log).unwrap_or_else(|_| "Mirror closed.".into()),
                Err(e) => e,
            };
            return Ok(SessionStatus {
                active: false,
                recording: false,
                started: 0,
                message: Some(message),
            });
        }
        Ok(SessionStatus {
            active: false,
            recording: false,
            started: 0,
            message: None,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn captures(app: tauri::AppHandle) -> Result<Vec<Capture>, String> {
    let mut files: Vec<Capture> = fs::read_dir(folder(&app)?)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let ext = p.extension()?.to_str()?;
            if p.file_name()?.to_str()?.starts_with('.') {
                return None;
            }
            if !["png", "mp4", "mkv"].contains(&ext)
                || (ext == "mkv" && p.with_extension("mp4").exists())
            {
                return None;
            }
            capture_info(&p).ok()
        })
        .collect();
    files.sort_by(|a, b| b.created.cmp(&a.created));
    Ok(files)
}
fn owned_path(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if p.parent()
        != Some(
            folder(app)?
                .canonicalize()
                .map_err(|e| e.to_string())?
                .as_path(),
        )
        || !p.is_file()
    {
        return Err("Choose a file from the Frame library.".into());
    }
    Ok(p)
}
#[tauri::command]
async fn thumbnail(app: tauri::AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = owned_path(&app, &path)?;
        let bytes = if p.extension().is_some_and(|e| e == "png") {
            fs::read(p).map_err(|e| e.to_string())?
        } else {
            let mut c = command(tool(&app, "ffmpeg")?);
            c.args(["-hide_banner", "-loglevel", "error", "-i"])
                .arg(p)
                .args([
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=360:-1",
                    "-f",
                    "image2pipe",
                    "-vcodec",
                    "png",
                    "pipe:1",
                ]);
            output(c)?
        };
        Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn open_capture(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    let p = if let Some(p) = path {
        owned_path(&app, &p)?
    } else {
        folder(&app)?
    };
    let mut c = if cfg!(target_os = "macos") {
        command("open")
    } else if cfg!(windows) {
        command("explorer")
    } else {
        command("xdg-open")
    };
    c.arg(p);
    c.spawn().map_err(|e| e.to_string())?;
    Ok(())
}
#[derive(Deserialize)]
struct ExportOptions {
    path: String,
    color: String,
    aspect: String,
    padding: u32,
    start: f64,
    end: Option<f64>,
    #[serde(default)]
    edits: editor::Edits,
}
fn export_filter(o: &ExportOptions) -> Result<String, String> {
    if !["#c6b8a6", "#b8cbbb", "#aebfda", "#d5b5bb", "#202124"].contains(&o.color.as_str())
        || o.padding > 200
        || !o.start.is_finite()
        || o.start < 0.0
        || o.end.is_some_and(|e| !e.is_finite() || e <= o.start)
    {
        return Err("Invalid export settings.".into());
    }
    let (w, h) = match o.aspect.as_str() {
        "native" => return Ok("setsar=1".into()),
        "landscape" => (1920, 1080),
        "portrait" => (1080, 1920),
        "square" => (1080, 1080),
        _ => return Err("Invalid aspect ratio.".into()),
    };
    let p = o.padding * 2;
    Ok(format!("scale={}:{}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={},setsar=1", w-p,h-p,o.color))
}
#[tauri::command]
async fn export_capture(app: tauri::AppHandle, options: ExportOptions) -> Result<Capture, String> {
    {
        let s = app.state::<Studio>();
        let mut b = s.exporting.lock().map_err(|e| e.to_string())?;
        if *b {
            return Err("An export is already running.".into());
        }
        *b = true;
    }
    let cloned = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let p = owned_path(&cloned, &options.path)?;
        let filter = export_filter(&options)?;
        let info = editor::inspect(&cloned, &p)?;
        if info.duration > 0.
            && (options.start >= info.duration
                || options.end.is_some_and(|e| e > info.duration + 0.1))
        {
            return Err("Trim points must be inside the clip.".into());
        }
        let is_image = p.extension().is_some_and(|e| e == "png");
        let dest = folder(&cloned)?.join(format!(
            "Export-{}.{}",
            stamp(),
            if is_image { "png" } else { "mp4" }
        ));
        let temp = dest.with_file_name(format!(
            ".partial-{}",
            dest.file_name().unwrap().to_string_lossy()
        ));
        let mut c = command(tool(&cloned, "ffmpeg")?);
        c.args(["-hide_banner", "-loglevel", "error", "-n"]);
        if !is_image {
            c.args(["-ss", &options.start.to_string()]);
        }
        c.arg("-i").arg(&p);
        if let Some(end) = options.end {
            if !is_image {
                c.args(["-t", &(end - options.start).to_string()]);
            }
        }
        let (graph, spliced_audio) = editor::splice_effects(&options.edits, &info, options.start, options.end, &filter)?;
        c.args(["-filter_complex", &graph, "-map", "[outv]", "-map", if spliced_audio { "[outa]" } else { "0:a?" }]);
        if is_image {
            c.args(["-frames:v", "1"]);
        } else {
            c.args([
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
            ]);
        }
        c.arg(&temp);
        output(c)?;
        fs::rename(&temp, &dest).map_err(|e| e.to_string())?;
        capture_info(&dest)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    *app.state::<Studio>()
        .exporting
        .lock()
        .map_err(|e| e.to_string())? = false;
    result
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Studio::default())
        .manage(tango::TangoState::default())
        .manage(originals::ClipboardState::default())
        .manage(live::LiveState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            originals::copy_original_image,
            originals::copy_capture_files,
            originals::save_original,
            editor::media_info,
            editor::load_edits,
            editor::save_edits,
            live::start_live,
            live::stop_live,
            live::live_touch,
            live::live_key,
            health,
            save_settings,
            devices,
            display_size,
            preview,
            screenshot,
            start_session,
            stop_session,
            session_status,
            captures,
            thumbnail,
            open_capture,
            export_capture
        ])
        .build(tauri::generate_context!())
        .expect("Could not start Frame")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = tango::stop_recording(app);
                tango::shutdown(app);
                if let Ok(mut live) = app.state::<live::LiveState>().0.lock() {
                    live.take();
                }
                if let Ok(mut lock) = app.state::<Studio>().session.lock() {
                    if let Some(mut s) = lock.take() {
                        stop_child(&mut s.child);
                        if let Some(mic) = s.mic.as_mut() {
                            stop_child(mic);
                        }
                        let _ = finalize(app, &s);
                    }
                }
            }
        });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn existing_settings_keep_adb_and_wifi_as_default() {
        let legacy: Settings = serde_json::from_str(r#"{"scrcpy":"","adb":"","ffmpeg":""}"#).unwrap();
        assert!(!legacy.direct_usb);
        assert!(!Settings::default().direct_usb);
    }
    #[test]
    fn native_export_preserves_source_pixels_without_background() {
        let options = ExportOptions { path: String::new(), color: "#c6b8a6".into(), aspect: "native".into(), padding: 200, start: 0., end: None, edits: editor::Edits::default() };
        assert_eq!(export_filter(&options).unwrap(), "setsar=1");
        let Some(ffmpeg) = resolve("ffmpeg", "") else { return; };
        let mut render = command(ffmpeg);
        render.args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=128x284:rate=1", "-frames:v", "1", "-vf", &export_filter(&options).unwrap(), "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
        let pixels = output_timeout(render,Duration::from_secs(10)).unwrap();
        assert_eq!(pixels.len(),128*284*3,"Native export must keep the exact source dimensions even when saved padding is nonzero");
    }
    #[test]
    fn devices_keep_transport_and_authorization() {
        let d = parse_devices("List of devices attached\nusb123 device usb:1 model:Pixel_8_Pro\nwifi:5555 unauthorized\nemulator-5554 offline\n");
        assert_eq!(d.len(), 3);
        assert_eq!(d[0].connection, "USB");
        assert_eq!(d[1].state, "unauthorized");
        assert_eq!(d[2].connection, "Emulator");
    }
    #[test]
    fn arguments_target_device_and_preserve_path_as_one_argument() {
        let o = RecordOptions {
            serial: "usb123".into(),
            size: 1920,
            fps: 60,
            audio: "none".into(),
            touches: true,
            record: true,
        };
        let a = record_args(&o, Some(Path::new("/a folder/file.mkv"))).unwrap();
        assert!(a.contains(&"--serial=usb123".into()));
        assert!(a.contains(&"--record=/a folder/file.mkv".into()));
        assert!(a.contains(&"--no-audio".into()));
    }
    #[test]
    fn export_rejects_bad_trim_and_filter_injection() {
        let mut o = ExportOptions {
            path: "".into(),
            color: "#c6b8a6".into(),
            aspect: "landscape".into(),
            padding: 80,
            start: 0.,
            end: Some(5.),
            edits: editor::Edits::default(),
        };
        assert!(export_filter(&o).unwrap().contains("pad=1920:1080"));
        o.end = Some(0.);
        assert!(export_filter(&o).is_err());
        o.end = None;
        o.color = "red;movie=/etc/passwd".into();
        assert!(export_filter(&o).is_err());
    }
    #[test]
    fn requested_audio_is_required_and_microphone_does_not_feed_back() {
        let mut o = RecordOptions {
            serial: "usb123".into(),
            size: 1920,
            fps: 60,
            audio: "device".into(),
            touches: false,
            record: true,
        };
        let a = record_args(&o, None).unwrap();
        assert!(a.contains(&"--require-audio".into()));
        assert!(!a.contains(&"--no-audio".into()));
        o.audio = "mic".into();
        let a = record_args(&o, None).unwrap();
        assert!(a.contains(&"--audio-source=mic".into()));
        assert!(a.contains(&"--no-audio-playback".into()));
        o.audio = "both".into();
        assert!(record_args(&o, None)
            .unwrap()
            .contains(&"--require-audio".into()));
        o.audio = "unknown".into();
        assert!(record_args(&o, None).is_err());
    }
}
