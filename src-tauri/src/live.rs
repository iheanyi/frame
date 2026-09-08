use crate::{adb, command, output_timeout, stop_child, tool};
use serde::Deserialize;
use std::{
    io::{Read, Write},
    net::{Shutdown, TcpStream},
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    Manager, State,
};

#[derive(Default)]
pub struct LiveState(pub Mutex<Option<LiveSession>>);
pub struct LiveSession {
    id: String,
    child: Child,
    socket: TcpStream,
    control: TcpStream,
    alive: Arc<AtomicBool>,
    adb: std::path::PathBuf,
    serial: String,
    port: String,
}
impl Drop for LiveSession {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Relaxed);
        let _ = self.socket.shutdown(Shutdown::Both);
        let _ = self.control.shutdown(Shutdown::Both);
        stop_child(&mut self.child);
        let mut c = command(&self.adb);
        c.args(["-s", &self.serial, "forward", "--remove", &self.port]);
        let _ = output_timeout(c, Duration::from_secs(3));
    }
}
#[tauri::command]
pub async fn start_live(
    app: tauri::AppHandle,
    serial: String,
    stream_id: String,
    on_packet: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if crate::settings(&app).direct_usb {
            app.state::<LiveState>()
                .0
                .lock()
                .map_err(|e| e.to_string())?
                .take();
            return crate::tango::start_live(&app, &serial, &stream_id, on_packet);
        }
        let state = app.state::<LiveState>();
        let mut lock = state.0.lock().map_err(|e| e.to_string())?;
        lock.take();
        let resource = app
            .path()
            .resolve(
                "resources/scrcpy-server",
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|e| e.to_string())?;
        let resource = if resource.exists() {
            resource
        } else {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/scrcpy-server")
        };
        let mut push = adb(&app, &serial)?;
        push.arg("push")
            .arg(resource)
            .arg("/data/local/tmp/frame-live.jar");
        output_timeout(push, Duration::from_secs(15))?;
        let scid = format!("{:08x}", (crate::stamp() as u32) & 0x7fffffff);
        let mut forward = adb(&app, &serial)?;
        forward.args(["forward", "tcp:0", &format!("localabstract:scrcpy_{scid}")]);
        let port = String::from_utf8_lossy(&output_timeout(forward, Duration::from_secs(5))?)
            .trim()
            .to_owned();
        let address = format!("127.0.0.1:{port}");
        let mut server = adb(&app, &serial)?;
        server.args([
            "shell",
            "CLASSPATH=/data/local/tmp/frame-live.jar",
            "app_process",
            "/",
            "com.genymobile.scrcpy.Server",
            "4.1",
            &format!("scid={scid}"),
            "log_level=warn",
            "audio=false",
            "control=true",
            "tunnel_forward=true",
            "max_size=1600",
            "max_fps=60",
            "video_bit_rate=8000000",
            "video_codec=h264",
            "send_device_meta=false",
            "send_stream_meta=false",
            "clipboard_autosync=false",
            "cleanup=false",
            "stay_awake=false",
        ]);
        let log = std::fs::File::create(crate::folder(&app)?.join("live.log"))
            .map_err(|e| e.to_string())?;
        server
            .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
            .stderr(Stdio::from(log));
        let mut child = server.spawn().map_err(|e| e.to_string())?;
        let began = Instant::now();
        let mut socket = loop {
            if began.elapsed() > Duration::from_secs(12) {
                stop_child(&mut child);
                return Err(
                    "The live stream could not connect. Unlock the phone and retry.".into(),
                );
            }
            if let Ok(mut s) = TcpStream::connect(&address) {
                let _ = s.set_read_timeout(Some(Duration::from_millis(500)));
                let mut dummy = [0];
                if s.read_exact(&mut dummy).is_ok() {
                    break s;
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        let control = match TcpStream::connect(&address) {
            Ok(s) => s,
            Err(e) => {
                stop_child(&mut child);
                return Err(e.to_string());
            }
        };
        let _ = control.set_nodelay(true);
        let _ = control.set_write_timeout(Some(Duration::from_millis(500)));
        let _ = socket.set_read_timeout(None);
        let alive = Arc::new(AtomicBool::new(true));
        let session = LiveSession {
            id: stream_id,
            child,
            socket: socket.try_clone().map_err(|e| e.to_string())?,
            control,
            alive: alive.clone(),
            adb: tool(&app, "adb")?,
            serial,
            port: format!("tcp:{port}"),
        };
        *lock = Some(session);
        std::thread::spawn(move || {
            loop {
                let mut header = [0u8; 12];
                if socket.read_exact(&mut header).is_err() {
                    break;
                }
                let size = u32::from_be_bytes(header[8..12].try_into().unwrap()) as usize;
                if size > 16 * 1024 * 1024 || size == 0 {
                    break;
                }
                let mut packet = Vec::with_capacity(12 + size);
                packet.extend_from_slice(&header);
                packet.resize(12 + size, 0);
                if socket.read_exact(&mut packet[12..]).is_err() {
                    break;
                }
                if !alive.load(Ordering::Relaxed)
                    || on_packet.send(InvokeResponseBody::Raw(packet)).is_err()
                {
                    break;
                }
            }
            alive.store(false, Ordering::Relaxed);
            let _ = on_packet.send(InvokeResponseBody::Raw(Vec::new()));
        });
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn stop_live(app: tauri::AppHandle, stream_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::tango::stop_live(&app, &stream_id)?;
        let state = app.state::<LiveState>();
        let mut lock = state.0.lock().map_err(|e| e.to_string())?;
        if lock.as_ref().is_some_and(|s| s.id == stream_id) {
            lock.take();
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Deserialize)]
pub struct Touch {
    action: u8,
    x: u32,
    y: u32,
    width: u16,
    height: u16,
}
#[tauri::command]
pub fn live_touch(
    app: tauri::AppHandle,
    state: State<LiveState>,
    touch: Touch,
) -> Result<(), String> {
    if ![0, 1, 2].contains(&touch.action)
        || touch.width == 0
        || touch.height == 0
        || touch.x > touch.width as u32
        || touch.y > touch.height as u32
    {
        return Err("Invalid touch".into());
    }
    if crate::tango::control(
        &app,
        "touch",
        serde_json::json!({"action": match touch.action { 0 => "down", 1 => "up", _ => "move" }, "x":touch.x,"y":touch.y}),
    )? {
        return Ok(());
    }
    let mut lock = state.0.lock().map_err(|e| e.to_string())?;
    let s = lock.as_mut().ok_or("Live stream is disconnected")?;
    let mut p = vec![2, touch.action];
    p.extend_from_slice(&u64::MAX.to_be_bytes());
    p.extend_from_slice(&touch.x.to_be_bytes());
    p.extend_from_slice(&touch.y.to_be_bytes());
    p.extend_from_slice(&touch.width.to_be_bytes());
    p.extend_from_slice(&touch.height.to_be_bytes());
    p.extend_from_slice(&(if touch.action == 1 { 0u16 } else { 0xffffu16 }).to_be_bytes());
    p.extend_from_slice(&1u32.to_be_bytes());
    p.extend_from_slice(&(if touch.action == 1 { 0u32 } else { 1u32 }).to_be_bytes());
    s.control.write_all(&p).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn live_key(app: tauri::AppHandle, state: State<LiveState>, key: u32) -> Result<(), String> {
    if ![3, 4, 24, 25, 26, 187].contains(&key) {
        return Err("Unsupported device key".into());
    }
    if crate::tango::control(&app, "key", serde_json::json!({"keyCode":key}))? {
        return Ok(());
    }
    let mut lock = state.0.lock().map_err(|e| e.to_string())?;
    let s = lock.as_mut().ok_or("Live stream is disconnected")?;
    for action in [0u8, 1] {
        let mut p = vec![0, action];
        p.extend_from_slice(&key.to_be_bytes());
        p.extend_from_slice(&0u32.to_be_bytes());
        p.extend_from_slice(&0u32.to_be_bytes());
        s.control.write_all(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}
