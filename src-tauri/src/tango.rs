//! App-owned Tango transport. JSONL travels over pipes; no host ADB server or port.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    Manager,
};

type Replies = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>;
type Streams = Arc<Mutex<HashMap<String, Channel<InvokeResponseBody>>>>;
#[derive(Default)]
pub struct TangoState(Mutex<Option<Helper>>);
struct Helper {
    child: Child,
    input: Option<ChildStdin>,
    replies: Replies,
    streams: Streams,
    next_id: u64,
    serial: Option<String>,
    connected: Arc<AtomicBool>,
    recording: Option<(PathBuf, u64)>,
}
impl Drop for Helper {
    fn drop(&mut self) {
        self.input.take(); // EOF asks helper to close scrcpy and release USB.
        for _ in 0..40 {
            if self.child.try_wait().ok().flatten().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn resource(app: &tauri::AppHandle, relative: &str, source: &str) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resolve(relative, tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    let path = if bundled.is_file() {
        bundled
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(source)
    };
    path.is_file()
        .then_some(path)
        .ok_or_else(|| format!("Direct USB resource is missing: {relative}"))
}
pub fn availability(app: &tauri::AppHandle) -> Result<String, String> {
    let runtime = if cfg!(windows) {
        "resources/tango-runtime/node.exe"
    } else {
        "resources/tango-runtime/node"
    };
    let node = app
        .path()
        .resolve(runtime, tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|p| p.is_file())
        .or_else(|| crate::resolve("node", ""))
        .ok_or("Direct USB needs the bundled Node.js runtime or Node.js installed.")?;
    resource(
        app,
        "resources/tango-helper/index.mjs",
        "../transport/index.mjs",
    )?;
    resource(
        app,
        "resources/scrcpy-server-v3.3.3",
        "resources/scrcpy-server-v3.3.3",
    )?;
    Ok(node.display().to_string())
}
fn raw_packet(value: &Value) -> Result<Vec<u8>, String> {
    let data = STANDARD
        .decode(value["data"].as_str().ok_or("Missing video data")?)
        .map_err(|e| e.to_string())?;
    if data.is_empty() || data.len() > 16 * 1024 * 1024 {
        return Err("Invalid video packet size".into());
    }
    let pts = value["pts"]
        .as_str()
        .unwrap_or("0")
        .parse::<u64>()
        .map_err(|e| e.to_string())?
        & ((1u64 << 61) - 1);
    let flags = if value["type"] == "configuration" {
        1u64 << 62
    } else if value["keyframe"] == true {
        1u64 << 61
    } else {
        0
    };
    let mut packet = Vec::with_capacity(data.len() + 12);
    packet.extend_from_slice(&(pts | flags).to_be_bytes());
    packet.extend_from_slice(&(data.len() as u32).to_be_bytes());
    packet.extend_from_slice(&data);
    Ok(packet)
}
fn end_streams(streams: &Streams) {
    if let Ok(mut streams) = streams.lock() {
        for (_, channel) in streams.drain() {
            let _ = channel.send(InvokeResponseBody::Raw(Vec::new()));
        }
    }
}
impl Helper {
    fn spawn(app: &tauri::AppHandle) -> Result<Self, String> {
        let node = availability(app)?;
        let entry = resource(
            app,
            "resources/tango-helper/index.mjs",
            "../transport/index.mjs",
        )?;
        let mut child = crate::command(node)
            .arg(entry)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(
                std::fs::File::create(crate::folder(app)?.join("tango.log"))
                    .map_err(|e| e.to_string())?,
            ))
            .spawn()
            .map_err(|e| e.to_string())?;
        let input = child.stdin.take();
        let output = child.stdout.take().ok_or("Missing Tango output pipe")?;
        let replies: Replies = Arc::default();
        let streams: Streams = Arc::default();
        let connected = Arc::new(AtomicBool::new(false));
        let reader_connected = connected.clone();
        let (reader_replies, reader_streams) = (replies.clone(), streams.clone());
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let Ok(line) = line else { break };
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if let Some(id) = value["id"].as_u64() {
                    if let Ok(mut pending) = reader_replies.lock() {
                        if let Some(sender) = pending.remove(&id) {
                            let response = if value.get("error").is_some() {
                                Err(value["error"]["message"]
                                    .as_str()
                                    .unwrap_or("Tango request failed")
                                    .to_owned())
                            } else {
                                Ok(value["result"].clone())
                            };
                            let _ = sender.send(response);
                        }
                    }
                } else if value["event"] == "disconnected" {
                    reader_connected.store(false, Ordering::Relaxed);
                    end_streams(&reader_streams);
                } else if let Some(id) = value["sessionId"].as_str() {
                    if let Ok(mut streams) = reader_streams.lock() {
                        if value["event"] == "video" {
                            if let Some(channel) = streams.get(id) {
                                if let Ok(packet) = raw_packet(&value["packet"]) {
                                    let _ = channel.send(InvokeResponseBody::Raw(packet));
                                }
                            }
                        } else if value["event"] == "liveEnded" || value["event"] == "error" {
                            if let Some(channel) = streams.remove(id) {
                                let _ = channel.send(InvokeResponseBody::Raw(Vec::new()));
                            }
                        }
                    }
                }
            }
            end_streams(&reader_streams);
            reader_connected.store(false, Ordering::Relaxed);
            if let Ok(mut replies) = reader_replies.lock() {
                for (_, sender) in replies.drain() {
                    let _ =
                        sender.send(Err("Direct USB helper exited. Reconnect the device.".into()));
                }
            }
        });
        Ok(Self {
            child,
            input,
            replies,
            streams,
            next_id: 0,
            serial: None,
            connected,
            recording: None,
        })
    }
    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        let (tx, rx) = mpsc::channel();
        self.replies
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, tx);
        let result = (|| {
            let input = self.input.as_mut().ok_or("Tango helper closed")?;
            writeln!(
                input,
                "{}",
                json!({"id":id,"method":method,"params":params})
            )
            .map_err(|e| e.to_string())?;
            rx.recv_timeout(Duration::from_secs(70)).map_err(|_| {
                "Direct USB request timed out. Reconnect and approve USB debugging.".to_string()
            })?
        })();
        self.replies.lock().map_err(|e| e.to_string())?.remove(&id);
        result
    }
    fn connect(&mut self, app: &tauri::AppHandle, serial: &str) -> Result<(), String> {
        if self.serial.as_deref() == Some(serial) && self.connected.load(Ordering::Relaxed) {
            return Ok(());
        }
        if self.recording.is_some() {
            return Err("Stop the current recording before changing devices.".into());
        }
        if self.serial.take().is_some() {
            self.request("disconnect", json!({}))?;
        }
        let directory = app
            .path()
            .app_config_dir()
            .map_err(|e| e.to_string())?
            .join("tango-keys");
        self.request(
            "connect",
            json!({"serial":serial,"credentialDirectory":directory}),
        )?;
        self.serial = Some(serial.to_owned());
        self.connected.store(true, Ordering::Relaxed);
        Ok(())
    }
}
fn with_helper<T>(
    app: &tauri::AppHandle,
    action: impl FnOnce(&mut Helper) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<TangoState>();
    let mut lock = state.0.lock().map_err(|e| e.to_string())?;
    if lock
        .as_mut()
        .is_some_and(|h| h.child.try_wait().ok().flatten().is_some())
    {
        lock.take();
    }
    if lock.is_none() {
        *lock = Some(Helper::spawn(app)?);
    }
    action(lock.as_mut().unwrap())
}
pub fn shutdown(app: &tauri::AppHandle) {
    if let Ok(mut helper) = app.state::<TangoState>().0.lock() {
        helper.take();
    }
}
pub fn devices(app: &tauri::AppHandle) -> Result<Vec<crate::Device>, String> {
    with_helper(app, |h| {
        let result = h.request("enumerate", json!({}))?;
        result
            .as_array()
            .ok_or("Invalid device list")?
            .iter()
            .map(|v| {
                Ok(crate::Device {
                    serial: v["serial"].as_str().ok_or("Missing device serial")?.into(),
                    name: v["name"].as_str().unwrap_or("Android").into(),
                    state: "device".into(),
                    connection: "USB".into(),
                })
            })
            .collect()
    })
}
pub fn screen(app: &tauri::AppHandle, serial: &str) -> Result<Vec<u8>, String> {
    with_helper(app, |h| {
        h.connect(app, serial)?;
        let result = h.request("screenshot", json!({}))?;
        let data = STANDARD
            .decode(result["data"].as_str().ok_or("Missing screenshot")?)
            .map_err(|e| e.to_string())?;
        if !data.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("Invalid screenshot".into());
        }
        Ok(data)
    })
}
pub fn display_size(app: &tauri::AppHandle, serial: &str) -> Result<(u32, u32), String> {
    with_helper(app, |h| {
        h.connect(app, serial)?;
        let result = h.request("shell", json!({"command":"wm size"}))?;
        crate::parse_display_size(result["text"].as_str().unwrap_or(""))
            .ok_or("Phone did not report its display resolution".into())
    })
}
pub fn start_live(
    app: &tauri::AppHandle,
    serial: &str,
    id: &str,
    channel: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    with_helper(app, |h| {
        h.connect(app, serial)?;
        h.request("stopLive", json!({}))?;
        end_streams(&h.streams);
        h.streams
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.into(), channel);
        let result = h.request("startLive", json!({"serverPath":resource(app,"resources/scrcpy-server-v3.3.3","resources/scrcpy-server-v3.3.3")?,"streamId":id,"maxSize":1600,"maxFps":60,"videoBitRate":8000000}));
        if result.is_err() {
            end_streams(&h.streams);
        }
        result.map(|_| ())
    })
}
pub fn stop_live(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let state = app.state::<TangoState>();
    let mut lock = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(h) = lock.as_mut() {
        let active = h
            .streams
            .lock()
            .map_err(|e| e.to_string())?
            .contains_key(id);
        if active {
            h.request("stopLive", json!({}))?;
            end_streams(&h.streams);
        }
    }
    Ok(())
}
pub fn control(app: &tauri::AppHandle, method: &str, params: Value) -> Result<bool, String> {
    let state = app.state::<TangoState>();
    let mut lock = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(h) = lock.as_mut() {
        if !h.streams.lock().map_err(|e| e.to_string())?.is_empty() {
            h.request(method, params)?;
            return Ok(true);
        }
    }
    Ok(false)
}
pub fn is_recording(app: &tauri::AppHandle) -> bool {
    app.state::<TangoState>()
        .0
        .lock()
        .ok()
        .is_some_and(|h| h.as_ref().is_some_and(|h| h.recording.is_some()))
}
pub fn start_recording(
    app: &tauri::AppHandle,
    options: &crate::RecordOptions,
) -> Result<(), String> {
    crate::record_args(options, None)?; // Share option validation with the ADB backend.
    if !options.record {
        return Err("Direct USB uses the embedded preview. Separate Mirror windows require the ADB backend.".into());
    }
    if options.audio == "both" {
        return Err("Direct USB cannot combine microphone and device audio yet. Choose one audio source, or switch to ADB.".into());
    }
    if options.touches {
        return Err("Direct USB recording does not enable Android touch dots yet. Turn off Show touches, or use the ADB backend.".into());
    }
    with_helper(app, |h| {
        if h.recording.is_some() {
            return Err("Stop the current recording first.".into());
        }
        h.connect(app, &options.serial)?;
        let path = crate::folder(app)?.join(format!("Recording-{}.mp4", crate::stamp()));
        h.request("startRecording",json!({"serverPath":resource(app,"resources/scrcpy-server-v3.3.3","resources/scrcpy-server-v3.3.3")?,"outputPath":path,"audio":if options.audio=="none" {"silent"} else {options.audio.as_str()},"maxSize":options.size,"maxFps":options.fps,"videoBitRate":16000000}))?;
        h.recording = Some((path, crate::now()));
        Ok(())
    })
}
pub fn stop_recording(app: &tauri::AppHandle) -> Result<Option<crate::Capture>, String> {
    let state = app.state::<TangoState>();
    let mut lock = state.0.lock().map_err(|e| e.to_string())?;
    let Some(h) = lock.as_mut() else {
        return Ok(None);
    };
    let Some((path, _)) = h.recording.as_ref() else {
        return Ok(None);
    };
    let path = path.clone();
    let result = h.request("stopRecording", json!({}));
    h.recording.take();
    result?;
    let capture = crate::capture_info(&path)?;
    if capture.bytes < 1024 {
        return Err("Direct USB recording produced no usable video.".into());
    }
    Ok(Some(capture))
}
pub fn status(app: &tauri::AppHandle) -> Result<Option<crate::SessionStatus>, String> {
    let state = app.state::<TangoState>();
    let mut lock = state.0.lock().map_err(|e| e.to_string())?;
    let Some(h) = lock.as_mut() else {
        return Ok(None);
    };
    let Some((path, started)) = h.recording.clone() else {
        return Ok(None);
    };
    let result = h.request("getState", json!({}));
    if result
        .as_ref()
        .is_ok_and(|v| v.get("recording").is_some_and(|r| !r.is_null()))
    {
        return Ok(Some(crate::SessionStatus {
            active: true,
            recording: true,
            started,
            message: None,
        }));
    }
    h.recording.take();
    let message = match result {
        Err(error) => error,
        Ok(value) => value["lastRecordingError"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| {
                format!(
                    "Direct USB recording ended unexpectedly. Check {} for a recovered recording.",
                    path.display()
                )
            }),
    };
    Ok(Some(crate::SessionStatus {
        active: false,
        recording: false,
        started: 0,
        message: Some(message),
    }))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tango_packets_keep_scrcpy_configuration_keyframe_and_pts() {
        let p = raw_packet(&json!({"type":"configuration","data":"AQID"})).unwrap();
        assert_eq!(u64::from_be_bytes(p[..8].try_into().unwrap()), 1 << 62);
        assert_eq!(&p[8..], &[0, 0, 0, 3, 1, 2, 3]);
        let p = raw_packet(&json!({"type":"data","pts":"123456","keyframe":true,"data":"AQ=="}))
            .unwrap();
        assert_eq!(
            u64::from_be_bytes(p[..8].try_into().unwrap()),
            (1 << 61) | 123456
        );
    }
}
