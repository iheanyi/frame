import { parseLivePacket } from "./livePacket";
import { fitPreview } from "./previewSize";
import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { WebCodecsVideoDecoder } from "@yume-chan/scrcpy-decoder-webcodecs";
import { ScrcpyVideoCodecId } from "@yume-chan/scrcpy";
import {
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  HomeIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  DevicePhoneMobileIcon,
} from "@heroicons/react/16/solid";
export type Tap = { time: number; x: number; y: number };
export function LivePreview({
  serial,
  onTap,
}: {
  serial: string;
  onTap: (x: number, y: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    callback = useRef(onTap);
  const container = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState({width: 180, height: 400});
  callback.current = onTap;
  const [error, setError] = useState(""),
    [waiting, setWaiting] = useState(false),
    [connected, setConnected] = useState(false),
    [attempt, setAttempt] = useState(0),
    [aspect, setAspect] = useState("720/1600"),
    [tap, setTap] = useState<{ x: number; y: number } | null>(null);
  const dims = useRef({ width: 720, height: 1600 }),
    lastMove = useRef(0),
    tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () => setDisplaySize(fitPreview(dims.current.width, dims.current.height, element.clientWidth, Math.max(0, element.clientHeight - 48)));
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [aspect]);
  useEffect(() => {
    let active = true;
    let receivedFrame = false;
    const streamId = crypto.randomUUID();
    setError("");
    setConnected(false);
    setWaiting(false);
    const waitingTimer = setTimeout(() => {
      if (active && !receivedFrame) setWaiting(true);
    }, 6000);
    if (!WebCodecsVideoDecoder.isSupported) {
      setError(
        "This system webview does not support live video decoding. Update your operating system or use the Mirror window.",
      );
      clearTimeout(waitingTimer);
      return;
    }
    const target = canvas.current!;
    const ctx = target.getContext("2d", { alpha: false })!;
    const decoder = new WebCodecsVideoDecoder({
      codec: ScrcpyVideoCodecId.H264,
      renderer: {
        setSize(width, height) {
          target.width = width;
          target.height = height;
          dims.current = { width, height };
          if (active) setAspect(`${width}/${height}`);
        },
        draw(frame) {
          if (active) {
            ctx.drawImage(frame, 0, 0, target.width, target.height);
            if (!receivedFrame) {
              receivedFrame = true;
              setConnected(true);
            }
          }
        },
      },
    });
    const writer = decoder.writable.getWriter();
    writer.closed.catch(() => {});
    const channel = new Channel<ArrayBuffer>();
    let queue = Promise.resolve();
    channel.onmessage = (raw) => {
      if (!active) return;
      if (raw.byteLength === 0) {
        setConnected(false);
        setError(
          "Live stream ended. Retry the stream; if it fails again, check the phone connection.",
        );
        return;
      }
      const packet = parseLivePacket(raw);
      queue = queue
        .then(() => {
          if (active) return writer.write(packet);
        })
        .catch((e) => {
          if (active) setError(`Video decoding failed: ${e}`);
        });
    };
    invoke("start_live", { serial, streamId, onPacket: channel }).catch((e) => {
      if (active) setError(String(e));
    });
    return () => {
      active = false;
      clearTimeout(waitingTimer);
      void invoke("stop_live", { streamId });
      void writer.abort().catch(() => {});
      decoder.dispose();
      if (tapTimer.current) clearTimeout(tapTimer.current);
    };
  }, [serial, attempt]);
  function pointer(e: React.PointerEvent<HTMLCanvasElement>, action: number) {
    if (!connected) return;
    if (
      action === 2 &&
      (e.buttons === 0 || performance.now() - lastMove.current < 16)
    )
      return;
    lastMove.current = performance.now();
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    if (action === 0) {
      e.currentTarget.setPointerCapture(e.pointerId);
      callback.current(x, y);
      setTap({ x, y });
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = setTimeout(() => setTap(null), 500);
    }
    invoke("live_touch", {
      touch: {
        action,
        x: Math.round(x * dims.current.width),
        y: Math.round(y * dims.current.height),
        ...dims.current,
      },
    }).catch((e) => setError(String(e)));
  }
  return (
    <div className="live-preview" ref={container}>
      <div className="live-screen" style={{ width: displaySize.width, height: displaySize.height, aspectRatio: aspect, flexShrink: 0 }}>
        <canvas
          ref={canvas}
          className="live-canvas"
          aria-label="Live Android screen. Click and drag to control your phone."
          onPointerDown={(e) => pointer(e, 0)}
          onPointerMove={(e) => pointer(e, 2)}
          onPointerUp={(e) => pointer(e, 1)}
          onPointerCancel={(e) => pointer(e, 1)}
        />
        {tap && (
          <span
            className="tap-ring"
            style={{ left: `${tap.x * 100}%`, top: `${tap.y * 100}%` }}
          />
        )}
      {(!connected || error) && (
        <div className="live-overlay" role="status" aria-live="polite">
          <div className={`connection-icon ${error ? "" : "is-connecting"}`}><DevicePhoneMobileIcon /></div>
          <strong>{error ? "Preview unavailable" : waiting ? "Waiting for your phone" : "Connecting to your phone"}</strong>
          <p>{error || (waiting ? "Unlock your phone and check for a USB debugging approval prompt. The first connection can take a moment." : "Starting the live preview…")}</p>
          {error && (
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>
              <ArrowPathIcon />
              Retry stream
            </button>
          )}
        </div>
      )}
      </div>
      <div className="device-keys">
        {[
          { key: 4, label: "Back", Icon: ArrowUturnLeftIcon },
          { key: 3, label: "Home", Icon: HomeIcon },
          { key: 25, label: "Volume down", Icon: SpeakerXMarkIcon },
          { key: 24, label: "Volume up", Icon: SpeakerWaveIcon },
        ].map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            title={label}
            aria-label={label}
            disabled={!connected || !!error}
            onClick={() =>
              invoke("live_key", { key }).catch((e) => setError(String(e)))
            }
          >
            <Icon />
          </button>
        ))}
        <span className="live-indicator">
          {error
            ? "Stream unavailable"
            : connected
              ? "LIVE · 60 fps max"
              : "Connecting"}
        </span>
      </div>
    </div>
  );
}
