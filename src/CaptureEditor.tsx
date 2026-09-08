import { primeVideoFrame } from "./video-primer";
import { TimelineDock } from './TimelineDock';
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  availableFocusTime,
  resizeFocus,
  type Segment,
} from "./timeline";
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  ClipboardIcon,
  TrashIcon,
} from "@heroicons/react/16/solid";
type Capture = { path: string; name: string; kind: string; bytes: number };
import { clamp, focusCrop, type Focus, type Tap } from "../packages/editor-core/index.ts";
type Edits = { focus: Focus[]; taps: Tap[]; segments?: Segment[] | null };
type Info = { width: number; height: number; duration: number; audio: boolean };
const palette = ["#c6b8a6", "#b8cbbb", "#aebfda", "#d5b5bb", "#202124"];
const names = ["Sand", "Sage", "Mist", "Rose", "Graphite"];
export function CaptureEditor({
  capture,
  onExport,
  onError,
}: {
  capture: Capture;
  onExport: () => void;
  onError: (e: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    video = useRef<HTMLVideoElement>(document.createElement("video")),
    image = useRef<HTMLImageElement | null>(null),
    frame = useRef(0);
  const editorRoot = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = editorRoot.current;
    if (!root) return;
    const fit = () => root.style.setProperty("--editor-available-height", `${Math.max(380, window.innerHeight - root.getBoundingClientRect().top - 16)}px`);
    fit();
    const observer = new ResizeObserver(fit);
    if (root.parentElement) observer.observe(root.parentElement);
    window.addEventListener("resize", fit);
    return () => { observer.disconnect(); window.removeEventListener("resize", fit); };
  }, []);
  const [info, setInfo] = useState<Info>({
    width: 720,
    height: 1600,
    duration: 0,
    audio: false,
  });
  const [edits, setEdits] = useState<Edits>({ focus: [], taps: [] }),
    [loaded, setLoaded] = useState(false),
    [mediaReady, setMediaReady] = useState(false);
  const [color, setColor] = useState(palette[0]),
    [aspect, setAspect] = useState("native"),
    [padding, setPadding] = useState(48),
    [viewZoom, setViewZoom] = useState(1);
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [start, setStart] = useState("0"),
    [end, setEnd] = useState("");
  const [mode, setMode] = useState<"none" | "focus" | "tap">("none"),
    [selected, setSelected] = useState<{
      kind: "focus" | "tap";
      index: number;
    } | null>(null),
    [exporting, setExporting] = useState(false),
    [status, setStatus] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [styled, setStyled] = useState(false);
  const [originalBusy, setOriginalBusy] = useState(false);
  const [, setSaveStatus] = useState("Loading project…");
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const loadedPath = useRef("");
  const recoveryTime = useRef(0);
  const decodedRevision = useRef(0);
  useEffect(() => {
    if (selected) setSelectedSegment(null);
  }, [selected]);
  const state = useRef({ info, edits, color, aspect, padding, time, styled });
  state.current = { info, edits, color, aspect, padding, time, styled };
  useEffect(() => {
    let live = true;
    let url = "";
    let disposePrimer: (() => void) | undefined;
    let primed = false;
    // WKWebView's media pipeline needs a document-connected video surface.
    // Keep the decoder mounted (not display:none); the canvas is the visible UI.
    const decoder = video.current;
    const originalMuted = decoder.muted;
    decoder.setAttribute("aria-hidden", "true");
    decoder.tabIndex = -1;
    decoder.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    decoder.preload = "auto";
    decoder.playsInline = true;
    document.body.appendChild(decoder);
    setLoaded(false);
    loadedPath.current = "";
    recoveryTime.current = 0;
    setSaveStatus("Loading project…");
    setMediaReady(false);
    setMediaError("");
    setTime(0);
    setPlaying(false);
    setSelected(null);
    setSelectedSegment(null);
    setStart("0");
    setEnd("");
    setColor(palette[0]);
    setPadding(48);
    setAspect("native");
    setStyled(false);
    Promise.all([
      invoke<Info>("media_info", { path: capture.path }),
      invoke<Edits>("load_edits", { path: capture.path }),
    ])
      .then(([i, e]) => {
        if (live) {
          setInfo(i);
          setEdits(e);
          setLoaded(true);
          setAspect("native");
          loadedPath.current = capture.path;
          try {
            const saved = JSON.parse(
              localStorage.getItem(`frame-editor:${capture.path}`) || "null",
            );
            if (saved?.version === 1) {
              if (palette.includes(saved.color)) setColor(saved.color);
              if (["native", "portrait", "landscape", "square"].includes(saved.aspect))
                setAspect(saved.aspect);
              if (Number.isFinite(saved.padding))
                setPadding(clamp(saved.padding, 0, 200));
              if (Number.isFinite(saved.time))
                recoveryTime.current = clamp(saved.time, 0, i.duration);
              setTime(recoveryTime.current);
              if (typeof saved.start === "string") setStart(saved.start);
              if (typeof saved.end === "string") setEnd(saved.end);
              setStyled(saved.styled === true);
              if (video.current.readyState >= 2)
                video.current.currentTime = recoveryTime.current;
            }
            setSaveStatus("Project restored locally");
          } catch {
            setSaveStatus("Could not restore workspace settings");
          }
        }
      })
      .catch((e) => {
        if (live) onError(String(e));
      });
    if (capture.kind === "image") {
      const im = new Image();
      im.onload = () => {
        if (live) {
          image.current = im;
          setMediaReady(true);
        }
      };
      im.onerror = () => setMediaError("Could not load image.");
      im.src = convertFileSrc(capture.path);
    } else if (capture.bytes > 512 * 1024 * 1024) {
      setMediaError(
        "This clip is larger than the 512 MB preview limit. You can still export it or open the original.",
      );
    } else {
      fetch(convertFileSrc(capture.path))
        .then((r) => {
          if (!r.ok) throw Error("Could not read video");
          return r.blob();
        })
        .then((b) => {
          if (live) {
            url = URL.createObjectURL(new Blob([b], { type: "video/mp4" }));
            const v = video.current;
            v.onloadeddata = () => {
              if (live) {
                decodedRevision.current += 1;
                setMediaReady(true);
                if (!primed) {
                  primed = true;
                  // loadeddata can precede a drawable WebKit video texture.
                  // Prime one muted frame, then pause at the restored playhead.
                  disposePrimer = primeVideoFrame(v, () => {
                    if (!live) return;
                    decodedRevision.current += 1;
                    if (v.currentTime !== recoveryTime.current) v.currentTime = recoveryTime.current;
                  });
                }
              }
            };
            v.onerror = () =>
              setMediaError(
                "Video preview is unavailable. Open the original or export it.",
              );
            v.onended = () => setPlaying(false);
            v.onseeked = () => {
              decodedRevision.current += 1;
            };
            // Install handlers before assigning src; cached clips can load fast.
            v.src = url;
            v.load();
          }
        })
        .catch((e) => {
          if (live) setMediaError(String(e));
        });
    }
    return () => {
      live = false;
      video.current.pause();
      video.current.muted = originalMuted;
      disposePrimer?.();
      video.current.onloadeddata = null;
      video.current.onseeked = null;
      video.current.onerror = null;
      video.current.onended = null;
      video.current.removeAttribute("src");
      video.current.load();
      decoder.remove();
      if (url) URL.revokeObjectURL(url);
      image.current = null;
      cancelAnimationFrame(frame.current);
    };
  }, [capture.path]);
  useEffect(() => {
    if (!loaded || loadedPath.current !== capture.path) return;
    setSaveStatus("Saving edits…");
    const t = setTimeout(() => {
      invoke("save_edits", { path: capture.path, edits })
        .then(() => setSaveStatus("Edits saved locally"))
        .catch((e) => {
          setSaveStatus("Edits could not be saved");
          onError(String(e));
        });
    }, 400);
    return () => clearTimeout(t);
  }, [edits, loaded, capture.path]);
  useEffect(() => {
    if (!loaded || loadedPath.current !== capture.path) return;
    try {
      localStorage.setItem(
        `frame-editor:${capture.path}`,
        JSON.stringify({
          version: 1,
          color,
          aspect,
          padding,
          start,
          end,
          styled,
          time,
        }),
      );
    } catch {
      setSaveStatus("Workspace settings could not be saved");
    }
  }, [loaded, capture.path, color, aspect, padding, start, end, styled, time]);
  function geometry(t: number) {
    const s = state.current;
    if (!s.styled)
      return {
        w: s.info.width,
        h: s.info.height,
        dw: s.info.width,
        dh: s.info.height,
        dx: 0,
        dy: 0,
        sw: s.info.width,
        sh: s.info.height,
        sx: 0,
        sy: 0,
      };
    if (s.aspect === "native") return { w:s.info.width,h:s.info.height,dw:s.info.width,dh:s.info.height,dx:0,dy:0,...focusCrop(s.info.width,s.info.height,s.edits.focus,t) };
    const [w, h] =
      s.aspect === "landscape"
        ? [1920, 1080]
        : s.aspect === "square"
          ? [1080, 1080]
          : [1080, 1920];
    const ratio = Math.min(
      (w - s.padding * 2) / s.info.width,
      (h - s.padding * 2) / s.info.height,
    );
    const dw = s.info.width * ratio,
      dh = s.info.height * ratio;
    const { sw, sh, sx, sy } = focusCrop(s.info.width, s.info.height, s.edits.focus, t);
    return { w, h, dw, dh, dx: (w - dw) / 2, dy: (h - dh) / 2, sw, sh, sx, sy };
  }
  useEffect(() => {
    if (!mediaReady) return;
    let active = true,
      last = 0;
    let lastTime = -1,
      lastEdits: Edits | null = null,
      lastStyle = "",
      lastDecoded = -1;
    const draw = (now: number) => {
      if (!active) return;
      const c = canvas.current;
      if (c) {
        // A seek updates currentTime before the decoded frame is ready. Keep
        // the last image visible until seeked rather than clearing the canvas.
        if (
          capture.kind === "video" &&
          (video.current.seeking || video.current.readyState < 2)
        ) {
          frame.current = requestAnimationFrame(draw);
          return;
        }
        const t = capture.kind === "video" ? video.current.currentTime : 0,
          g = geometry(t);
        if (
          capture.kind === "video" &&
          !video.current.paused &&
          state.current.edits.segments
        ) {
          const segments = state.current.edits.segments;
          if (!segments.some((s) => t >= s.start && t < s.end)) {
            const next = segments.find((s) => s.start > t);
            if (next) video.current.currentTime = next.start;
            else {
              video.current.pause();
              setPlaying(false);
            }
            frame.current = requestAnimationFrame(draw);
            return;
          }
        }
        const resized = c.width !== g.w || c.height !== g.h;
        if (c.width !== g.w) c.width = g.w;
        if (c.height !== g.h) c.height = g.h;
        const style = `${state.current.styled}:${state.current.aspect}:${state.current.padding}:${state.current.color}`;
        if (
          !resized &&
          t === lastTime &&
          lastEdits === state.current.edits &&
          style === lastStyle &&
          lastDecoded === decodedRevision.current
        ) {
          frame.current = requestAnimationFrame(draw);
          return;
        }
        lastTime = t;
        lastEdits = state.current.edits;
        lastStyle = style;
        lastDecoded = decodedRevision.current;
        const ctx = c.getContext("2d", { alpha: false })!;
        ctx.fillStyle = state.current.color;
        ctx.fillRect(0, 0, g.w, g.h);
        const media = capture.kind === "image" ? image.current : video.current;
        if (media)
          ctx.drawImage(media, g.sx, g.sy, g.sw, g.sh, g.dx, g.dy, g.dw, g.dh);
        for (const tap of state.current.styled
          ? state.current.edits.taps
          : []) {
          if (t >= tap.time && t < tap.time + 0.45) {
            const x =
                g.dx +
                ((tap.x * state.current.info.width - g.sx) / g.sw) * g.dw,
              y =
                g.dy +
                ((tap.y * state.current.info.height - g.sy) / g.sh) * g.dh;
            ctx.save();
            ctx.beginPath();
            ctx.rect(g.dx, g.dy, g.dw, g.dh);
            ctx.clip();
            ctx.beginPath();
            ctx.arc(x, y, (30 * g.dw) / g.sw, 0, Math.PI * 2);
            ctx.fillStyle = "#e1bb9844";
            ctx.fill();
            ctx.strokeStyle = "#ffe0bbdd";
            ctx.lineWidth = (5 * g.dw) / g.sw;
            ctx.stroke();
            ctx.restore();
          }
        }
        if (now - last > 100) {
          setTime(t);
          last = now;
        }
      }
      frame.current = requestAnimationFrame(draw);
    };
    frame.current = requestAnimationFrame(draw);
    return () => {
      active = false;
      cancelAnimationFrame(frame.current);
    };
  }, [mediaReady, capture.kind]);
  const seek = (t: number) => {
    video.current.currentTime = clamp(t, 0, info.duration);
    setTime(clamp(t, 0, info.duration));
  };
  function step(direction: number) {
    video.current.pause();
    setPlaying(false);
    seek(video.current.currentTime + direction / 30);
  }
  const segments = edits.segments || [{ start: 0, end: info.duration }];
  function removeSegment() {
    if (selectedSegment === null || exporting) return;
    if (segments.length < 2) {
      setStatus("Keep at least one segment. Your original is unchanged.");
      return;
    }
    const kept = segments.filter((_, i) => i !== selectedSegment);
    setEdits({ ...edits, segments: kept });
    setSelectedSegment(null);
    seek(kept[0].start);
  }
  function duplicateSelected() {
    if (!selected || exporting) return;
    if (selected.kind === "focus") {
      const source = edits.focus[selected.index];
      const next = availableFocusTime(
        edits.focus,
        source.duration,
        source.time + source.duration,
        info.duration,
      );
      if (next === null) {
        setStatus(
          "No room after this focus. Shorten it or choose an earlier point.",
        );
        return;
      }
      setEdits({
        ...edits,
        focus: [...edits.focus, { ...source, time: next }],
      });
      setSelected({ kind: "focus", index: edits.focus.length });
      seek(next);
    } else {
      const source = edits.taps[selected.index];
      const next = source.time + 0.5;
      if (next >= info.duration) {
        setStatus("No room for another tap after this point.");
        return;
      }
      setEdits({ ...edits, taps: [...edits.taps, { ...source, time: next }] });
      setSelected({ kind: "tap", index: edits.taps.length });
      seek(next);
    }
  }
  function mark(e: React.MouseEvent<HTMLCanvasElement>) {
    if (mode === "none" || capture.kind !== "video") return;
    const c = e.currentTarget,
      r = c.getBoundingClientRect(),
      g = geometry(video.current.currentTime);
    const px = ((e.clientX - r.left) / r.width) * g.w,
      py = ((e.clientY - r.top) / r.height) * g.h;
    if (px < g.dx || px > g.dx + g.dw || py < g.dy || py > g.dy + g.dh) return;
    const x = clamp((g.sx + ((px - g.dx) / g.dw) * g.sw) / info.width, 0, 1),
      y = clamp((g.sy + ((py - g.dy) / g.dh) * g.sh) / info.height, 0, 1),
      t = video.current.currentTime;
    if (mode === "focus") {
      const duration = Math.min(2.5, info.duration - t);
      if (duration < 0.8) {
        onError("Place the focus at least 0.8 seconds before the end.");
        return;
      }
      if (
        edits.focus.some(
          (f) => t < f.time + f.duration && f.time < t + duration,
        )
      ) {
        onError("Choose an empty part of the focus track.");
        return;
      }
      setEdits({
        ...edits,
        focus: [...edits.focus, { time: t, duration, x, y, zoom: 1.7 }],
      });
      setSelected({ kind: "focus", index: edits.focus.length });
    } else {
      setEdits({ ...edits, taps: [...edits.taps, { time: t, x, y }] });
      setSelected({ kind: "tap", index: edits.taps.length });
    }
    setMode("none");
  }
  async function toggle() {
    if (playing) {
      video.current.pause();
      setPlaying(false);
    } else {
      try {
        await video.current.play();
        setPlaying(true);
      } catch (e) {
        onError(String(e));
      }
    }
  }
  const update = (key: string, value: number) => {
    if (!selected) return;
    if (!Number.isFinite(value)) return;
    if (selected.kind === "focus" && key === "duration") {
      const focus = edits.focus[selected.index];
      const changed = resizeFocus(
        edits.focus,
        selected.index,
        "end",
        focus.time + value,
        info.duration,
      );
      setEdits({
        ...edits,
        focus: edits.focus.map((f, i) =>
          i === selected.index ? { ...f, ...changed } : f,
        ),
      });
      return;
    }
    setEdits({
      ...edits,
      [selected.kind === "focus" ? "focus" : "taps"]: (selected.kind === "focus"
        ? edits.focus
        : edits.taps
      ).map((e, i) => (i === selected.index ? { ...e, [key]: value } : e)),
    });
  };
  function removeSelected() {
    if (!selected || exporting) return;
    setEdits((value) => ({
      ...value,
      [selected.kind === "focus" ? "focus" : "taps"]: (selected.kind === "focus"
        ? value.focus
        : value.taps
      ).filter((_, i) => i !== selected.index),
    }));
    setSelected(null);
    setStatus("Point removed. Edits saved automatically.");
  }
  const editHistory = useRef<Edits[]>([]);
  const historyPosition = useRef(-1), historyRestore = useRef(false);
  const [, setHistoryRevision] = useState(0);
  useEffect(() => {
    if (!loaded) return;
    if (historyRestore.current) { historyRestore.current = false; return; }
    editHistory.current = [...editHistory.current.slice(0, historyPosition.current + 1), edits];
    historyPosition.current = editHistory.current.length - 1;
    setHistoryRevision(n => n + 1);
  }, [edits, loaded]);
  function undoEdits(delta:number) {
    const next=historyPosition.current+delta;
    if(next<0||next>=editHistory.current.length)return;
    historyPosition.current=next;historyRestore.current=true;
    setEdits(editHistory.current[next]);setSelected(null);setHistoryRevision(n=>n+1);
  }
  function updateTimeline(kind:'focus'|'taps',index:number,time:number,duration:number) {
    if(kind==='focus'&&edits.focus.some((f,i)=>i!==index&&time<f.time+f.duration&&f.time<time+duration)) {
      onError('Focus effects cannot overlap.');return;
    }
    setEdits({...edits,[kind]:edits[kind].map((p,i)=>i===index?{...p,time,duration}:p)});
    setStyled(true);
  }
  const current = selected
    ? (selected.kind === "focus" ? edits.focus : edits.taps)[selected.index]
    : null;
  async function originalAction(
    command: "copy_original_image" | "copy_capture_files" | "save_original",
  ) {
    setOriginalBusy(true);
    try {
      const result = await invoke(
        command,
        command === "copy_capture_files"
          ? { paths: [capture.path] }
          : { path: capture.path },
      );
      if (result !== false)
        setStatus(
          command === "copy_original_image"
            ? "Original image copied. Ready to paste."
            : command === "copy_capture_files"
              ? "Video file copied. Paste into Finder or an app that accepts files."
              : "Original saved without changes.",
        );
    } catch (e) {
      onError(String(e));
    } finally {
      setOriginalBusy(false);
    }
  }
  async function exportFile() {
    setExporting(true);
    setStatus("Rendering your video…");
    try {
      await invoke("save_edits", { path: capture.path, edits });
      const result = await invoke<{ name: string }>("export_capture", {
        options: {
          path: capture.path,
          color,
          aspect,
          padding,
          start: Number(start),
          end: end === "" ? null : Number(end),
          edits,
        },
      });
      setStatus(`Saved ${result.name}`);
      onExport();
    } catch (e) {
      onError(String(e));
      setStatus("Export failed. Your original is safe.");
    } finally {
      setExporting(false);
    }
  }
  return (
    <section
      ref={editorRoot}
      className="editor timeline-editor"
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (
          e.defaultPrevented ||
          e.nativeEvent.isComposing ||
          e.altKey ||
          target.closest(
            "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
          )
        )
          return;
        if (
          (e.metaKey || e.ctrlKey) &&
          e.key.toLowerCase() === "d" &&
          selected
        ) {
          e.preventDefault();
          duplicateSelected();
          return;
        }
        if (e.metaKey || e.ctrlKey) return;
        if (
          (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
          !target.closest("[role=slider]")
        ) {
          e.preventDefault();
          step((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1));
          return;
        }
        if (e.key !== "Delete" && e.key !== "Backspace") return;
        if (selectedSegment !== null && !exporting) {
          e.preventDefault();
          removeSegment();
          return;
        }
        if (selected && !exporting) {
          e.preventDefault();
          removeSelected();
        }
      }}
    >
      <div className="editor-title">
        <div>
          <h2>
            {capture.kind === "video"
              ? "Recording editor"
              : "Style your screenshot"}
          </h2>
          <p>{capture.name}</p>
        </div>
        <div className="original-actions">
          {capture.kind === "image" && (
            <button
              type="button"
              disabled={originalBusy}
              onClick={() => originalAction("copy_original_image")}
            >
              <ClipboardIcon />
              Copy screen image
            </button>
          )}
          {capture.kind === "video" && (
            <button
              type="button"
              disabled={originalBusy}
              title="Copy the original video file to paste into another app"
              onClick={() => originalAction("copy_capture_files")}
            >
              <ClipboardIcon />
              Copy video file
            </button>
          )}
          <button
            type="button"
            disabled={originalBusy}
            onClick={() => originalAction("save_original")}
          >
            <ArrowDownTrayIcon />
            Save original screen
          </button>
          <button
            type="button"
            title="Open original"
            onClick={() =>
              invoke("open_capture", { path: capture.path }).catch((e) =>
                onError(String(e)),
              )
            }
          >
            <ArrowTopRightOnSquareIcon />
            Open original
          </button>
        </div>
      </div>
      <div className="editor-workspace">
        <div className="editor-preview-panel">
          <div className="editor-view-toolbar">
            <div className="preview-mode" aria-label="Preview mode">
              <button
                type="button"
                aria-pressed={!styled}
                onClick={() => {
                  setStyled(false);
                  setMode("none");
                }}
              >
                Original
              </button>
              <button
                type="button"
                aria-pressed={styled}
                onClick={() => setStyled(true)}
              >
                Styled export
              </button>
            </div>
            <span>
              {info.width} × {info.height}
              {info.audio ? " · Audio" : ""}
            </span>
            <label>
              Preview zoom
              <select
                name="preview-zoom"
                value={viewZoom}
                onChange={(e) => setViewZoom(Number(e.target.value))}
              >
                <option value={1}>Fit</option>
                <option value={1.5}>150%</option>
                <option value={2}>200%</option>
              </select>
            </label>
          </div>
          <div
            className={`composition-stage ${styled ? aspect : info.width > info.height ? "landscape" : "portrait"}`}
          >
            <canvas
              ref={canvas}
              className={
                mode === "none" ? "composition" : "composition marking"
              }
              onClick={mark}
              aria-label={
                mode === "none"
                  ? "Composed video preview"
                  : `Click the video to add a ${mode} point`
              }
              style={
                {
                  "--preview-zoom": viewZoom,
                  aspectRatio: !styled || aspect === "native"
                    ? `${info.width}/${info.height}`
                    : aspect === "landscape"
                      ? "16/9"
                      : aspect === "square"
                        ? "1"
                        : "9/16",
                } as CSSProperties
              }
            />
            {(!mediaReady || mediaError) && (
              <p className="editor-loading">
                {mediaError || "Loading capture…"}
              </p>
            )}
          </div>
        </div>
        <div className="editor-timeline-panel">
          {capture.kind === "video" && (
            <>
              <TimelineDock s={edits} duration={info.duration} time={time} playing={playing} mode={mode}
                disabled={!mediaReady||exporting} canUndo={historyPosition.current>0} canRedo={historyPosition.current<editHistory.current.length-1}
                selected={selected?{kind:selected.kind==='tap'?'taps':'focus',index:selected.index}:null}
                onUndo={()=>undoEdits(-1)} onRedo={()=>undoEdits(1)} onToggle={()=>void toggle()} onSeek={seek}
                onSelect={p=>{setSelected(p?{kind:p.kind==='taps'?'tap':'focus',index:p.index}:null);setStyled(true)}}
                onMode={m=>{video.current.pause();setPlaying(false);setStyled(true);setMode(mode===m?'none':m)}}
                onMove={(kind,index,t)=>updateTimeline(kind,index,t,edits[kind][index].duration??.45)}
                onResize={updateTimeline}/>
              {current && selected && (
                <div className="point-properties">
                  <strong>
                    {selected.kind === "focus"
                      ? "Focus point"
                      : "Tap highlight"}
                  </strong>
                  <label>
                    Time
                    <input
                      name="point-time"
                      type="number"
                      min="0"
                      max={info.duration}
                      step="0.1"
                      value={current.time.toFixed(1)}
                      onChange={(e) => update("time", Number(e.target.value))}
                    />
                  </label>
                  {"zoom" in current && (
                    <>
                      <label>
                        Zoom
                        <input
                          name="point-zoom"
                          type="number"
                          min="1"
                          max="3"
                          step="0.1"
                          value={(current as Focus).zoom}
                          onChange={(e) =>
                            update("zoom", Number(e.target.value))
                          }
                        />
                      </label>
                      <label>
                        Duration
                        <input
                          name="point-duration"
                          type="number"
                          min="0.8"
                          max="20"
                          step="0.1"
                          value={(current as Focus).duration}
                          onChange={(e) =>
                            update("duration", Number(e.target.value))
                          }
                        />
                      </label>
                    </>
                  )}
                  <button
                    type="button"
                    aria-label="Remove selected point"
                    onClick={removeSelected}
                  >
                    <TrashIcon />
                  </button>
                </div>
              )}
              <p className="timeline-help">
                Drag focus edges to resize. Delete removes a selected point.
                Edits save automatically.
              </p>
            </>
          )}
        </div>
        <aside
          className="editor-inspector"
          onChangeCapture={() => setStyled(true)}
        >
          <h3 className="editor-inspector-title">Composition</h3>
          <div className="editor-controls">
            <div>
              <h3>Background</h3>
              <div className="swatches">
                {palette.map((c, i) => (
                  <button
                    type="button"
                    key={c}
                    aria-label={names[i]}
                    aria-pressed={color === c}
                    className={`swatch ${color === c ? "chosen" : ""}`}
                    style={{ background: c }}
                    onClick={() => {
                      setColor(c);
                      setStyled(true);
                    }}
                  >
                    {color === c && <CheckIcon />}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              Canvas
              <select
                name="canvas"
                value={aspect}
                onChange={(e) => setAspect(e.target.value)}
              >
                <option value="native">Screen only · Native</option>
                <option value="portrait">Portrait · 9:16</option>
                <option value="landscape">Landscape · 16:9</option>
                <option value="square">Square · 1:1</option>
              </select>
            </label>
            <label className="field">
              Padding · {aspect === "native" ? 0 : padding} px
              <input
                name="padding"
                disabled={aspect === "native"}
                type="range"
                min="0"
                max="200"
                step="8"
                value={padding}
                onChange={(e) => setPadding(Number(e.target.value))}
              />
            </label>
          </div>
          {capture.kind === "video" && (
            <div className="trim">
              <div>
                <h3>Trim clip</h3>
                <p>Original timeline, in seconds.</p>
              </div>
              <label className="field">
                Start
                <input
                  name="trim-start"
                  type="number"
                  min="0"
                  max={info.duration}
                  step="0.1"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label className="field">
                End
                <input
                  name="trim-end"
                  type="number"
                  min="0"
                  max={info.duration}
                  step="0.1"
                  placeholder="Full clip"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </div>
          )}
          <p className="export-dimensions">
            Export ·{" "}
            {aspect === "native" ? info.width + " × " + info.height + " · Screen only" : aspect === "landscape"
              ? "1920 × 1080"
              : aspect === "square"
                ? "1080 × 1080"
                : "1080 × 1920"}
            <br />
            Original · {info.width} × {info.height}
          </p>
          <div className="export-footer">
            <p role="status">{status || "Your original stays untouched."}</p>
            <button
              type="button"
              className="primary"
              disabled={exporting || !loaded}
              onClick={exportFile}
            >
              <ArrowDownTrayIcon />
              {exporting
                ? "Exporting…"
                : `Export styled ${capture.kind === "image" ? "image" : "video"}`}
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
