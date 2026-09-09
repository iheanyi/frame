import { CaptureEditor } from "./CaptureEditor";
import { LivePreview } from "./LivePreview";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
  ClipboardIcon,
  FilmIcon,
  FolderIcon,
  RectangleGroupIcon,
  SignalIcon,
  Square2StackIcon,
  StopIcon,
  XMarkIcon,
  DevicePhoneMobileIcon,
} from "@heroicons/react/16/solid";
import "@fontsource-variable/inter";
import "./App.css";

type Device = {
  serial: string;
  name: string;
  state: string;
  connection: string;
};
type Capture = {
  name: string;
  path: string;
  kind: string;
  bytes: number;
  created: number;
};
type Session = {
  active: boolean;
  recording: boolean;
  started: number;
  message?: string;
};
type Settings = { scrcpy: string; adb: string; ffmpeg: string; direct_usb: boolean };
type Health = {
  tango: string | null;
  scrcpy: string | null;
  adb: string | null;
  ffmpeg: string | null;
  folder: string;
  settings: Settings;
};
const idle: Session = { active: false, recording: false, started: 0 };
const colors = [
  { name: "Sand", value: "#c6b8a6" },
  { name: "Sage", value: "#b8cbbb" },
  { name: "Mist", value: "#aebfda" },
  { name: "Rose", value: "#d5b5bb" },
  { name: "Graphite", value: "#202124" },
];
const time = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
const bytes = (n: number) =>
  n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
function Button({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={className} {...props}>
      {children}
    </button>
  );
}
function Toggle({
  label,
  detail,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-row">
      <div>
        {label}
        <p>{detail}</p>
      </div>
      <input
        name={label}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
    </label>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Thumb({ capture }: { capture: Capture }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    invoke<string>("thumbnail", { path: capture.path })
      .then((s) => {
        if (live) setSrc(s);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [capture.path]);
  return src ? <img src={src} alt="" /> : <FilmIcon />;
}

export default function App() {
  const [page, setPage] = useState<"studio" | "library" | "settings">("studio");
  const [deviceList, setDevices] = useState<Device[]>([]),
    [serial, setSerial] = useState("");
  const [health, setHealth] = useState<Health | null>(null),
    [settings, setSettings] = useState<Settings>({
      scrcpy: "",
      adb: "",
      ffmpeg: "",
      direct_usb: false,
    });
  const [session, setSession] = useState<Session>(idle),
    [library, setLibrary] = useState<Capture[]>([]),
    [selected, setSelected] = useState<Capture | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [selectFiles, setSelectFiles] = useState(false);
  const [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(""),
    [seconds, setSeconds] = useState(0);
  const [displaySize, setDisplaySize] = useState<[number, number] | null>(null);
  const [size, setSize] = useState(0),
    [fps, setFps] = useState(60),
    [audio, setAudio] = useState("device"),
    [touches, setTouches] = useState(false);
  const [color, setColor] = useState(colors[0].value);
  const tapsRef = useRef<{ time: number; x: number; y: number }[]>([]);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const device = deviceList.find((d) => d.serial === serial);
  const ready = device?.state === "device" && (health?.settings.direct_usb ? !!health.tango : !!health?.scrcpy && !!health?.adb);
  useEffect(() => {
    let active = true;
    setDisplaySize(null);
    if (ready && serial && isTauri()) {
      invoke<[number, number]>("display_size", { serial })
        .then((value) => {
          if (active) setDisplaySize(value);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [ready, serial]);
  const refreshLibrary = useCallback(async () => {
    if (isTauri()) setLibrary(await invoke<Capture[]>("captures"));
  }, []);
  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    const h = await invoke<Health>("health");
    setHealth(h);
    setSettings(h.settings);
    if (h.settings.direct_usb ? h.tango : h.adb) {
      const ds = await invoke<Device[]>("devices");
      setDevices(ds);
      setSerial((s) =>
        ds.some((d) => d.serial === s)
          ? s
          : ((
              ds.find((d) => d.connection === "USB" && d.state === "device") ??
              ds.find(
                (d) => d.state === "device" && d.connection !== "Emulator",
              )
            )?.serial ?? ""),
      );
    }
    await refreshLibrary();
  }, [refreshLibrary]);
  const action = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);
  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    let pending = false;
    const id = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const s = await invoke<Session>("session_status");
        if (live) {
          setSession(s);
          if (s.message) {
            setNotice(s.message);
            await refreshLibrary();
          }
        }
      } catch (e) {
        if (live) setError(String(e));
      } finally {
        pending = false;
      }
    }, 1000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [refreshLibrary]);
  useEffect(() => {
    const id = setInterval(
      () =>
        setSeconds(
          session.active ? Math.max(0, Date.now() / 1000 - session.started) : 0,
        ),
      500,
    );
    return () => clearInterval(id);
  }, [session]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(id);
  }, [notice]);
  async function start(record: boolean) {
    await action(record ? "Starting recording" : "Opening mirror", async () => {
      tapsRef.current = [];
      await invoke("start_session", {
        options: { serial, size, fps, audio, touches, record },
      });
      setSession({
        active: true,
        recording: record,
        started: Date.now() / 1000,
      });
      setNotice(
        record
          ? "Recording started. Control your phone right here in Frame."
          : "Mirror opened. Control your phone in the device window.",
      );
    });
  }
  async function stop() {
    await action("Saving recording", async () => {
      const c = await invoke<Capture | null>("stop_session");
      setSession(idle);
      await refreshLibrary();
      if (c) {
        await invoke("save_edits", {
          path: c.path,
          edits: { focus: [], taps: tapsRef.current },
        });
        setSelected(c);
        setPage("library");
        setNotice("Recording saved. Trim, add focus points, or export below.");
      } else setNotice("Mirroring stopped.");
    });
  }
  async function shot() {
    await action("Taking screenshot", async () => {
      const c = await invoke<Capture>("screenshot", { serial });
      await refreshLibrary();
      setNotice("Screenshot saved to your library.");
      setSelected(c);
    });
  }
  async function copyShot() {
    await action("Copying screen", async () => {
      await invoke("copy_screen", { serial });
      setNotice("Screen copied — paste anywhere.");
    });
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        ["r", "s", "c"].includes(key)
      ) {
        e.preventDefault();
        if (busy || page !== "studio") return;
        if (key === "r") {
          if (sessionRef.current.active) void stop();
          else if (ready) void start(true);
        } else if (ready) {
          if (key === "s") void shot();
          else void copyShot();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const openFolder = () =>
    action("Opening folder", async () => {
      await invoke("open_capture", { path: null });
    });
  return (
    <div className={`app-shell page-${page}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("studio");
          }}
          aria-label="Frame studio"
        >
          <span className="brand-mark" />
          frame<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">Your workspace</div>
        <nav aria-label="Main navigation">
          <Button
            className={page === "studio" ? "nav active" : "nav"}
            onClick={() => setPage("studio")}
          >
            <RectangleGroupIcon />
            Studio
          </Button>
          <Button
            className={page === "library" ? "nav active" : "nav"}
            onClick={() => {
              setPage("library");
              void refreshLibrary();
            }}
          >
            <Square2StackIcon />
            Library <span className="count">{library.length}</span>
          </Button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="status-dot" />
            Everything stays on your Mac, PC, or Linux desktop.
          </div>
          <Button
            className={page === "settings" ? "nav active" : "nav"}
            onClick={() => setPage("settings")}
          >
            <Cog6ToothIcon />
            Settings
          </Button>
          <div className="powered">
            Powered by scrcpy <span>v0.1</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRightIcon />
            <span>
              {page === "studio"
                ? "Capture studio"
                : page === "library"
                  ? "Your library"
                  : "Settings"}
            </span>
          </div>
          <Button className="ghost" onClick={openFolder} disabled={!isTauri()}>
            <FolderIcon />
            Open captures
          </Button>
        </header>
        {!isTauri() && (
          <div className="banner">
            Browser preview · Open the Frame desktop app to connect your phone
            and capture.
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <Button aria-label="Dismiss error" onClick={() => setError("")}>
              <XMarkIcon />
            </Button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <CheckIcon />
            <span>{notice}</span>
            <Button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <XMarkIcon />
            </Button>
          </div>
        )}
        {page === "studio" && (
          <>
            <div className="page-heading">
              <div>
                <h1>Capture studio</h1>
              </div>
              <div className="connection-badge">
                <span className={`status-dot ${ready ? "" : "off"}`} />
                {ready ? "Device available" : "Waiting for a device"}
              </div>
            </div>
            <div className="studio-grid">
              <section className="capture-area">
                <div className="preview-toolbar">
                  <div>
                    <DevicePhoneMobileIcon />
                    <strong>{device?.name ?? "Your Android"}</strong>
                    <span className="chip">
                      {device?.connection ?? "USB / Wi-Fi"}
                    </span>
                  </div>
                  <div
                    className={
                      session.recording ? "recording-label" : "preview-label"
                    }
                  >
                    <span className="status-dot" />
                    {session.recording ? `REC ${time(seconds)}` : "Preview"}
                  </div>
                </div>
                <div
                  className="canvas"
                  style={{ "--canvas-color": color } as CSSProperties}
                >
                  <div className="canvas-corner top-left" />
                  <div className="canvas-corner bottom-right" />
                  {ready ? (
                    <LivePreview
                      serial={serial}
                      onTap={(x, y) => {
                        if (sessionRef.current.recording)
                          tapsRef.current.push({
                            time: Math.max(
                              0,
                              Date.now() / 1000 - sessionRef.current.started,
                            ),
                            x,
                            y,
                          });
                      }}
                    />
                  ) : (
                    <div className="empty-device">
                      <DevicePhoneMobileIcon />
                      <h2>Connect your Android</h2>
                      <p>
                        Enable USB debugging and approve the connection on your
                        phone.
                      </p>
                      <Button
                        onClick={() => action("Refreshing", refresh)}
                        disabled={!!busy || !isTauri()}
                      >
                        <ArrowPathIcon />
                        Check connection
                      </Button>
                    </div>
                  )}
                  <div className="canvas-caption">
                    {session.active
                      ? "Recording your live screen"
                      : "Click and drag to control your phone."}
                  </div>
                </div>
                <div className="capture-controls">
                  <div className="control-buttons">
                    {session.active ? (
                      <Button
                        className="primary stop"
                        onClick={stop}
                        disabled={!!busy}
                      >
                        <StopIcon />
                        {busy ||
                          (session.recording
                            ? "Finish recording"
                            : "Stop mirroring")}
                      </Button>
                    ) : (
                      <Button
                        className="primary"
                        onClick={() => start(true)}
                        disabled={!ready || !!busy || !health?.ffmpeg}
                      >
                        <span className="record-dot" />
                        {busy || "Record screen"}
                      </Button>
                    )}
                    <Button onClick={shot} disabled={!ready || !!busy}>
                      <CameraIcon />
                      Screenshot
                    </Button>
                    <Button
                      onClick={copyShot}
                      disabled={!ready || !!busy}
                      title="Copy a native-resolution screenshot to the clipboard without saving it"
                    >
                      <ClipboardIcon />
                      Copy screen
                    </Button>
                    <Button
                      className="mirror-button"
                      onClick={() => start(false)}
                      disabled={!ready || !!busy || session.active}
                    >
                      <ArrowTopRightOnSquareIcon />
                      Mirror
                    </Button>
                  </div>
                  <span className="shortcut">
                    {session.active ? time(seconds) : "⌘ / Ctrl ⇧ R"}
                  </span>
                </div>
                <p className="preview-footnote">
                  {size === 0 && displaySize
                    ? `Records at ${displaySize[0]} × ${displaySize[1]}. `
                    : ""}
                  Preview is optimized for responsiveness.
                </p>
              </section>
              <aside className="inspector">
                <div className="inspector-heading">
                  <AdjustmentsHorizontalIcon />
                  <h2>Capture settings</h2>
                </div>
                <section>
                  <Field label="Device">
                    <select
                      name="device"
                      value={serial}
                      onChange={(e) => setSerial(e.target.value)}
                      disabled={session.active || !!busy}
                    >
                      <option value="" disabled>
                        Select a device
                      </option>
                      {deviceList.map((d) => (
                        <option key={d.serial} value={d.serial}>
                          {d.name} · {d.connection}
                          {d.state !== "device" ? ` · ${d.state}` : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button
                    className="text-button"
                    onClick={() => action("Refreshing", refresh)}
                    disabled={!!busy || session.active || !isTauri()}
                  >
                    <ArrowPathIcon />
                    Refresh devices
                  </Button>
                  {device?.state === "unauthorized" && (
                    <p className="help">
                      Approve USB debugging on your phone to continue.
                    </p>
                  )}
                </section>
                <section>
                  <h3>Recording</h3>
                  <div className="two-fields">
                    <Field label="Resolution">
                      <select
                        name="resolution"
                        value={size}
                        disabled={session.active}
                        onChange={(e) => setSize(Number(e.target.value))}
                      >
                        <option value={0}>
                          Native
                          {displaySize
                            ? ` · ${displaySize[0]} × ${displaySize[1]}`
                            : " resolution"}
                        </option>
                        <option value={1920}>1920 px</option>
                        <option value={2560}>2560 px</option>
                        <option value={1080}>1080 px</option>
                        <option value={720}>720 px</option>
                      </select>
                    </Field>
                    <Field label="Frame rate">
                      <select
                        name="fps"
                        value={fps}
                        disabled={session.active}
                        onChange={(e) => setFps(Number(e.target.value))}
                      >
                        <option value={30}>30 fps</option>
                        <option value={60}>60 fps</option>
                        <option value={120}>120 fps</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="Audio source">
                    <select
                      name="audio-source"
                      value={audio}
                      onChange={(e) => setAudio(e.target.value)}
                      disabled={session.active}
                    >
                      <option value="device">Device audio</option>
                      <option value="mic">Android microphone</option>
                      <option value="both">Device + Android microphone</option>
                      <option value="none">No audio</option>
                    </select>
                  </Field>
                  <p className="help">
                    {audio === "both"
                      ? "Mixes device sound and the phone microphone. Playback is muted to prevent feedback."
                      : audio === "mic"
                        ? "Records the microphone on your Android."
                        : audio === "device"
                          ? "Captures sound playing on Android."
                          : "A silent screen recording."}
                  </p>
                  <Toggle
                    label="Show touches"
                    detail="Make every tap visible."
                    checked={touches}
                    onChange={setTouches}
                    disabled={session.active}
                  />
                </section>
                <section>
                  <h3>Preview background</h3>
                  <div className="swatches">
                    {colors.map((c) => (
                      <Button
                        key={c.name}
                        title={c.name}
                        aria-label={c.name}
                        aria-pressed={color === c.value}
                        className={`swatch ${color === c.value ? "chosen" : ""}`}
                        style={{ background: c.value }}
                        onClick={() => setColor(c.value)}
                      >
                        {color === c.value && <CheckIcon />}
                      </Button>
                    ))}
                  </div>
                  <p className="help">
                    Style your saved captures in the library. Originals are
                    always preserved.
                  </p>
                </section>
                <div className="output-note">
                  <FilmIcon />
                  <div>
                    {size === 0
                      ? "Native resolution"
                      : `${size} px maximum edge`}
                    <p>MP4 video · PNG screenshots</p>
                  </div>
                </div>
              </aside>
            </div>
            <section className="recent">
              <div className="section-heading">
                <h2>Recent captures</h2>
                <Button
                  className="text-button"
                  onClick={() => setPage("library")}
                >
                  View library
                  <ChevronRightIcon />
                </Button>
              </div>
              {library.length ? (
                <div className="recent-grid">
                  {library.slice(0, 3).map((c) => (
                    <Button
                      key={c.path}
                      className="recent-item"
                      onClick={() => {
                        setSelected(c);
                        setPage("library");
                      }}
                    >
                      <div className="tiny-thumb">
                        <Thumb capture={c} />
                      </div>
                      <div>
                        <strong>
                          {c.name.startsWith("Screenshot")
                            ? "Screenshot"
                            : c.name.startsWith("Export")
                              ? "Styled export"
                              : "Screen recording"}
                        </strong>
                        <p>
                          {new Date(c.created * 1000).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}{" "}
                          · {bytes(c.bytes)}
                        </p>
                      </div>
                      <ChevronRightIcon />
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="empty-library-inline">
                  <FolderIcon />
                  <p>Your first capture will feel right at home here.</p>
                  <span>Saved locally. Ready to share.</span>
                </div>
              )}
            </section>
          </>
        )}
        {page === "library" && (
          <>
            <div className="page-heading">
              <div>
                <h1>Library & editor</h1>
              </div>
              <div className="library-actions">
                <Button
                  aria-pressed={selectFiles}
                  onClick={() => {
                    setSelectFiles(!selectFiles);
                    setSelectedFiles([]);
                  }}
                >
                  {selectFiles ? "Done selecting" : "Select files"}
                </Button>
                {selectFiles && (
                  <Button
                    disabled={!selectedFiles.length || !!busy}
                    onClick={() =>
                      action("Copying files", async () => {
                        await invoke("copy_capture_files", {
                          paths: selectedFiles,
                        });
                        setNotice(
                          `${selectedFiles.length} original files copied. Paste into an app that accepts files.`,
                        );
                      })
                    }
                  >
                    <ClipboardIcon />
                    Copy {selectedFiles.length || "selected"} files
                  </Button>
                )}
                <Button
                  onClick={() => action("Refreshing library", refreshLibrary)}
                  disabled={!!busy}
                >
                  <ArrowPathIcon />
                  Refresh
                </Button>
              </div>
            </div>
            {library.length === 0 ? (
              <div className="library-empty">
                <Square2StackIcon />
                <h2>A blank slate, for now.</h2>
                <p>
                  Record a moment or take a screenshot to start your collection.
                </p>
                <Button className="primary" onClick={() => setPage("studio")}>
                  Go to studio
                  <ChevronRightIcon />
                </Button>
              </div>
            ) : (
              <div className="library-layout">
                <div className="library-list">
                  {library.map((c) => (
                    <div
                      className={`library-entry ${selectFiles ? "selecting" : ""}`}
                      key={c.path}
                    >
                      {selectFiles && (
                        <input
                          type="checkbox"
                          name="selected-capture"
                          aria-label={`Select ${c.name}`}
                          checked={selectedFiles.includes(c.path)}
                          onChange={(e) =>
                            setSelectedFiles((files) =>
                              e.target.checked
                                ? [...files, c.path]
                                : files.filter((p) => p !== c.path),
                            )
                          }
                        />
                      )}
                      <Button
                        className={`library-item ${selected?.path === c.path ? "selected" : ""}`}
                        key={c.path}
                        onClick={() => {
                          setSelected(c);
                        }}
                      >
                        <div className="library-thumb">
                          <Thumb capture={c} />
                        </div>
                        <div>
                          <strong>
                            {c.name.startsWith("Export")
                              ? "Styled export"
                              : c.kind === "image"
                                ? "Screenshot"
                                : "Screen recording"}
                          </strong>
                          <p>
                            {new Date(c.created * 1000).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                          <p>
                            {c.kind === "image"
                              ? "PNG"
                              : c.name.endsWith(".mkv")
                                ? "MKV"
                                : "MP4"}{" "}
                            · {bytes(c.bytes)}
                          </p>
                        </div>
                      </Button>
                    </div>
                  ))}
                </div>
                {selected ? (
                  <CaptureEditor
                    key={selected.path}
                    capture={selected}
                    onExport={() => {
                      void refreshLibrary();
                    }}
                    onError={setError}
                  />
                ) : (
                  <div className="library-empty">
                    <FilmIcon />
                    <h2>Choose a capture</h2>
                    <p>Add focus points, tap highlights, and a frame.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {page === "settings" && (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">Make yourself at home</div>
                <h1>Settings</h1>
                <p>Your capture toolkit, connected.</p>
              </div>
            </div>
            <section className="settings-panel">
              <h2>Phone connection</h2>
              <label className="tool-row">
                <span>Connection mode</span>
                <select aria-label="Connection mode" value={settings.direct_usb ? "usb" : "adb"} disabled={session.active} onChange={(e) => setSettings({...settings, direct_usb: e.target.value === "usb"})}>
                  <option value="adb">USB and Wi-Fi · ADB</option>
                  <option value="usb">Direct USB · Experimental</option>
                </select>
                <p>{settings.direct_usb ? "Tango connects directly to USB. Release the phone in other capture apps before connecting." : "Connect USB and paired Wi-Fi phones through ADB."}</p>
              </label>
              <h2>Capture tools</h2>
              <p>
                Frame finds installed tools automatically. You can also choose
                the executable from an extracted download.
              </p>
              {(["scrcpy", "adb", "ffmpeg"] as const).map((name) => (
                <div className="tool-row" key={name}>
                  <div className="tool-title">
                    <strong>{name}</strong>
                    <span
                      className={`status-dot ${health?.[name] ? "" : "off"}`}
                    />
                    <span>{health?.[name] ? "Available" : "Not found"}</span>
                  </div>
                  <div className="tool-input">
                    <input
                      aria-label={`${name} executable path`}
                      name={name}
                      placeholder={health?.[name] ?? "Automatic detection"}
                      value={settings[name]}
                      onChange={(e) =>
                        setSettings({ ...settings, [name]: e.target.value })
                      }
                    />
                    <Button
                      onClick={() =>
                        action("Choosing executable", async () => {
                          const p = await open({
                            multiple: false,
                            directory: false,
                            title: `Choose ${name} executable`,
                          });
                          if (p) setSettings((s) => ({ ...s, [name]: p }));
                        })
                      }
                    >
                      Browse
                    </Button>
                  </div>
                  <p>
                    {name === "scrcpy"
                      ? "Mirrors and records your Android screen."
                      : name === "adb"
                        ? "Connects Frame to your Android devices."
                        : "Finalizes recordings and creates styled exports."}
                  </p>
                </div>
              ))}
              <Button
                className="primary"
                disabled={!!busy || !isTauri()}
                onClick={() =>
                  action("Saving settings", async () => {
                    await invoke("save_settings", { value: settings });
                    await refresh();
                    setNotice("Settings saved.");
                  })
                }
              >
                <CheckIcon />
                Save settings
              </Button>
              <div className="settings-divider" />
              <h2>Saved on this computer</h2>
              <p className="path">{health?.folder ?? "Movies / Frame"}</p>
              <Button onClick={openFolder} disabled={!isTauri()}>
                <FolderIcon />
                Open capture folder
              </Button>
              <div className="settings-divider" />
              <h2>Connecting your phone</h2>
              <ol>
                <li>Enable Developer options and USB debugging on Android.</li>
                <li>
                  Connect by USB, unlock your phone, and approve the debugging
                  prompt.
                </li>
                <li>
                  Choose your device in the studio. Wireless ADB devices appear
                  here too.
                </li>
              </ol>
              <p className="help">
                Frame 0.1 · Tauri + scrcpy. This build uses installed scrcpy,
                Android platform-tools, and FFmpeg. Downloads and setup details
                are included in the README.
              </p>
            </section>
          </>
        )}
        <footer>
          <span>
            <SignalIcon />
            Local capture. No account. No cloud.
          </span>
          <span>FRAME STUDIO</span>
        </footer>
      </main>
    </div>
  );
}
