'use client';
import { useEffect, useRef, useState } from 'react';
import { loadTake, saveProject, saveTake } from '@/lib/take-store';
import {saveFile} from '@/lib/save-file';
import {saveScreenshot} from '@/lib/screenshot';
import {copyScreen} from '@/lib/copy-image';
import {TimelineDock} from './TimelineDock';
import { Camera, Clipboard, Maximize2, Minimize2, Scissors, Copy, Magnet, Download, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import {
  clamp,
  canvasSize,
  drawComposition,
  exportComposition,
  geometry,
  type Composition,
  type Focus,
} from './composition';
import './editor.css';
const colors = ['#c6b8a6', '#b8cbbb', '#aebfda', '#d5b5bb', '#202124'];
export function VideoEditor({ url, takeId }: { url: string; takeId?: string }) {
  const [saveStatus,setSaveStatus]=useState('Loading project…'),[timelineZoom,setTimelineZoom]=useState(1),[snap,setSnap]=useState(true);
  const recoveredTime=useRef(0);
  const [expanded, setExpanded] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    video = useRef<HTMLVideoElement>(null),
    root = useRef<HTMLElement>(null),
    abort = useRef<AbortController | null>(null);
  const [s, setS] = useState<Composition>({
    width: 0,
    height: 0,
    padding: 0,
    color: colors[0],
    focus: [],
    taps: [],
  });
  const current = useRef(s);
  current.current = s;
  const [duration, setDuration] = useState(0),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [mode, setMode] = useState<'focus' | 'tap' | ''>(''),
    [error, setError] = useState(''),
    [progress, setProgress] = useState<number | null>(null),
    [result, setResult] = useState(''),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(0);
  const [projectReady, setProjectReady] = useState(false);
  useEffect(()=>()=>{abort.current?.abort()},[]);
  const history = useRef<{ s: Composition; start: number; end: number }[]>([]),
    position = useRef(-1),
    restoring = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  function undo(delta: number) {
    const next = position.current + delta;
    if (next < 0 || next >= history.current.length) return;
    position.current = next;
    restoring.current = true;
    const h = history.current[next];
    setS(h.s);
    setStart(h.start);
    setEnd(h.end);
    setSelected(null);
    setHistoryVersion((x) => x + 1);
  }
  const [selected, setSelected] = useState<{
    kind: 'focus' | 'taps';
    index: number;
  } | null>(null);
  function removeSelected() {
    if (!selected || progress !== null) return;
    setS(x => ({...x, [selected.kind]: x[selected.kind].filter((_, i) => i !== selected.index)}));
    setSelected(null);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false']),[role=dialog]") || !root.current?.getClientRects().length) return;
      if (e.code === 'Space') {
        if ((!root.current.contains(target) && target !== document.body) || progress !== null || !video.current || video.current.readyState < 2) return;
        e.preventDefault();
        if (!e.repeat) void toggle();
        return;
      }
      if (!(e.key === 'Delete' || e.key === 'Backspace')) return;
      if (selected && progress === null) { e.preventDefault(); removeSelected(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [selected, progress]);
  useEffect(() => {
    history.current = [];
    position.current = -1;
    setProjectReady(false);
    setS({
      width: video.current?.videoWidth || 0,
      height: video.current?.videoHeight || 0,
      padding: 0,
      color: colors[0],
      focus: [],
      taps: [],
    });
    const known =
      video.current && Number.isFinite(video.current.duration)
        ? video.current.duration
        : 0;
    setDuration(known);
    setTime(0);
    setStart(0);
    setEnd(known);
    setPlaying(false);
    setSelected(null);
    let alive = true;
    if (takeId)
      void loadTake(takeId)
        .then((t) => {
          if (!alive) return;
          const p = t?.project as
            | { composition?: Composition; start?: number; end?: number; time?:number }
            | undefined;
          if (p?.composition) {
            setS((x) => ({
              ...x,
              ...p.composition!,
              width:x.width,height:x.height,
              padding: p.composition!.padding,
              color: p.composition!.color,
              focus: p.composition!.focus || [],
              taps: p.composition!.taps || [],
            }));
            recoveredTime.current=p.time||0;if(video.current&&video.current.readyState>=2)video.current.currentTime=recoveredTime.current;
            setStart(p.start || 0);
            if (p.end) setEnd(p.end);
          }
          setProjectReady(true);setSaveStatus('Saved locally');
        })
        .catch((e) => {
          setError(String(e));
          setProjectReady(true);setSaveStatus('Saved locally');
        });
    else {
      try {
        const style = JSON.parse(
          localStorage.getItem('frame-editor-style') || 'null',
        );
        if (
          style &&
          Number.isFinite(style.padding) &&
          typeof style.color === 'string'
        )
          setS((x) => ({
            ...x,
            padding: clamp(style.padding, 0, 240),
            color: style.color,
          }));
      } catch {}
      setProjectReady(true);
    }
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, [url, takeId]);
  useEffect(() => {
    if (!projectReady || !s.width) return;
    if (restoring.current) {
      restoring.current = false;
      return;
    }
    const value = { s, start, end };
    if (
      JSON.stringify(history.current[position.current]) ===
      JSON.stringify(value)
    )
      return;
    history.current = history.current.slice(0, position.current + 1);
    history.current.push(value);
    if (history.current.length > 100) history.current.shift();
    position.current = history.current.length - 1;
    setHistoryVersion((x) => x + 1);
    try {
      localStorage.setItem(
        'frame-editor-style',
        JSON.stringify({ padding: s.padding, color: s.color }),
      );
    } catch {}
  }, [s, start, end, projectReady]);
  useEffect(() => {
    if (!projectReady || !takeId || !s.width) return;
    setSaveStatus('Saving…');
    void saveProject(takeId,{composition:s,start,end,time:video.current?.currentTime||0}).then(()=>setSaveStatus('Saved locally')).catch(e=>setSaveStatus('Save failed: '+String(e)));
  }, [s,start,end,takeId,projectReady]);

  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result);
    },
    [result],
  );
  useEffect(() => {
    let frame = 0,
      last = 0;
    const draw = (now: number) => {
      if (canvas.current && video.current && current.current.width) {
        const v=video.current,c=current.current;
        const ranges=c.segments;
        if(!v.paused&&ranges?.length&&!ranges.some(r=>v.currentTime>=r.start&&v.currentTime<r.end)){const next=ranges.find(r=>r.start>v.currentTime);if(next)v.currentTime=next.start;else {v.pause();setPlaying(false)}}
        const fade=c.fade??0,total=v.duration,at=v.currentTime;
        v.volume=clamp((c.volume??1)*(fade?Math.min(1,at/fade,(total-at)/fade):1),0,1);
        drawComposition(canvas.current, video.current, current.current);
        if (now - last > 80) {
          setTime(video.current.currentTime);
          last = now;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  function ready() {
    const v = video.current!;
    if(recoveredTime.current)v.currentTime=recoveredTime.current;
    setS((x) => ({ ...x, width: v.videoWidth, height: v.videoHeight }));
    if (Number.isFinite(v.duration)) {
      setDuration(v.duration);
      setEnd((old) => old || v.duration);
    } else {
      v.currentTime = 1e10;
      v.onseeked = () => {
        if (Number.isFinite(v.duration)) {
          setDuration(v.duration);
          setEnd((old) => old || v.duration);
        }
        v.onseeked = null;
        v.currentTime = 0;
      };
    }
  }
  function seek(t: number) {
    video.current!.currentTime = t;
    setTime(t);if(takeId&&projectReady)void saveProject(takeId,{composition:s,start,end,time:t}).catch(e=>setSaveStatus(String(e)));
  }
  async function toggle() {
    try {
      if (video.current!.paused) {
        await video.current!.play();
        setPlaying(true);
      } else {
        video.current!.pause();
        setPlaying(false);
      }
    } catch (e) {
      setError(String(e));
    }
  }
  function mark(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!mode || progress !== null) return;
    const v = video.current!,
      r = e.currentTarget.getBoundingClientRect(),
      g = geometry(s, v.currentTime),
      px = ((e.clientX - r.left) / r.width) * g.w,
      py = ((e.clientY - r.top) / r.height) * g.h;
    if (px < g.dx || px > g.dx + g.dw || py < g.dy || py > g.dy + g.dh) return;
    const point = {
      time: v.currentTime,
      x: clamp((g.sx + ((px - g.dx) / g.dw) * g.sw) / s.width, 0, 1),
      y: clamp((g.sy + ((py - g.dy) / g.dh) * g.sh) / s.height, 0, 1),
    };
    if (mode === 'focus') {
      const length = Math.min(2.5, duration - point.time);
      if (length < 0.8) {
        setError('Choose a moment at least 0.8 seconds before the end.');
        return;
      }
      if (
        s.focus.some(
          (f) =>
            point.time < f.time + f.duration && f.time < point.time + length,
        )
      ) {
        setError('Choose an empty part of the focus track.');
        return;
      }
      setSelected({ kind: 'focus', index: s.focus.length });
      setS({
        ...s,
        focus: [...s.focus, { ...point, duration: length, zoom: 1.7 }],
      });
    } else {
      setSelected({ kind: 'taps', index: s.taps.length });
      setS({ ...s, taps: [...s.taps, point] });
    }
    setMode('');
    setError('');
  }
  async function render() {
    if (end <= start || start < 0 || end > duration) {
      setError('Trim must be inside the clip with end after start.');
      return;
    }
    video.current!.pause();
    setPlaying(false);
    setError('');
    setProgress(0);
    abort.current = new AbortController();
    try {
      const blob = await exportComposition(
        url,
        s,
        start,
        end,
        abort.current.signal,
        setProgress,
      );
      try {
        await saveTake(blob, {
          kind:'export',
          name: 'Edited export ' + new Date().toLocaleTimeString(),
          width: canvasSize(s).w,
          height: canvasSize(s).h,
          duration: (s.segments||[{start,end}]).reduce((n,r)=>n+Math.max(0,Math.min(end,r.end)-Math.max(start,r.start)),0),
        });
      } catch (e) {
        setError('Export is ready but local save failed: ' + String(e));
      }
      setResult(URL.createObjectURL(blob));
    } catch (e) {
      setError(String(e));
    } finally {
      setProgress(null);
    }
  }
  const point = selected ? s[selected.kind][selected.index] : null;
  return (
    <section
      className={`frame-editor ${expanded ? 'editor-expanded' : ''}`}
      ref={root}
    >
      <div className="editor-heading">
        <div>
          <h2>Recording editor</h2>
          <p>
            Original {s.width} × {s.height} · Export {canvasSize(s).w} ×{' '}
            {canvasSize(s).h}
          </p>
        </div>
        <div className="editor-save-state" role="status">{saveStatus}</div><div className="editor-heading-actions"><Button disabled={!s.width} onClick={()=>{if(video.current)void saveScreenshot(video.current).then(()=>setSaveStatus('Screenshot saved in Library')).catch(e=>setError(String(e)))}} title="Save screen frame to Library"><Camera/><span>Save frame</span></Button><Button disabled={!s.width} onClick={()=>{if(video.current)void copyScreen(video.current).then(()=>setSaveStatus('Screen copied — paste into UltraMock.')).catch(e=>setError(String(e)))}} title="Copy native screen image"><Clipboard/><span>Copy image</span></Button>
        <Button aria-label={expanded ? "Collapse workspace" : "Expand workspace"} title={expanded ? "Collapse workspace" : "Expand workspace"} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2/> : <Maximize2/>}</Button></div>
      </div>
      <video
        ref={video}
        src={url}
        playsInline
        preload="auto"
        onLoadedData={ready}
        onEnded={() => setPlaying(false)}
        onError={() =>
          setError('This browser cannot decode the imported video.')
        }
        className="editor-source"
      />
      <div className="editor-layout">
        <div>
          <div className="editor-stage">
            <canvas
              ref={canvas}
              onClick={mark}
              aria-label="Composition preview"
              style={{ cursor: mode ? 'crosshair' : 'default' }}
            />
          </div>
          <TimelineDock zoom={timelineZoom} s={s} duration={duration} time={time} playing={playing} mode={mode} disabled={progress!==null} canUndo={position.current>0} canRedo={position.current<history.current.length-1} selected={selected} onUndo={()=>undo(-1)} onRedo={()=>undo(1)} onToggle={toggle} onSeek={seek} onSelect={setSelected} onMode={m=>{video.current!.pause();setPlaying(false);setMode(mode===m?'':m)}} onResize={(kind,index,t,length)=>{if(kind==='focus'&&s.focus.some((other,i)=>i!==index&&t<other.time+other.duration&&other.time<t+length)){setError('Focus effects cannot overlap.');return}setS({...s,[kind]:s[kind].map((p,i)=>i===index?{...p,time:t,duration:length}:p)})}} onMove={(kind,index,t)=>{if(snap){const anchors=[0,time,...s[kind].flatMap(p=>[p.time,p.time+(p.duration??.45)])];const near=anchors.find(a=>Math.abs(a-t)<.12);if(near!==undefined)t=near;}if(kind==='focus'){const f=s.focus[index];if(s.focus.some((other,i)=>i!==index&&t<other.time+other.duration&&other.time<t+f.duration)){setError('Focus effects cannot overlap.');return}}setS({...s,[kind]:s[kind].map((p,i)=>i===index?{...p,time:t}:p)})}}/>
        </div>
        <aside className="editor-settings">
          <div className="editor-inspector-title">Properties</div><div className="inspector-content"><div className="inspector-edit-actions"><div className="timeline-operations"><Button disabled={!duration||progress!==null} onClick={()=>seek(Math.max(0,time-1/30))} aria-label="Previous frame" title="Previous frame"><ChevronLeft/></Button><Button disabled={!duration||progress!==null} onClick={()=>seek(Math.min(duration,time+1/30))} aria-label="Next frame" title="Next frame"><ChevronRight/></Button><label><NativeSelect aria-label="Timeline zoom" value={timelineZoom} onChange={e=>setTimelineZoom(Number(e.target.value))}><option value="1">Fit</option><option value="2">2×</option><option value="4">4×</option></NativeSelect></label><Button aria-pressed={snap} onClick={()=>setSnap(!snap)} aria-label="Snap effects" title="Snap effects"><Magnet/></Button><Button disabled={!selected||progress!==null} onClick={()=>{if(!selected)return;const p=s[selected.kind][selected.index],length=p.duration??.45;let t=p.time+length;const items=s[selected.kind];for(const item of [...items].sort((a,b)=>a.time-b.time)){if(t<item.time+(item.duration??.45)&&item.time<t+length)t=item.time+(item.duration??.45)}if(t+length>duration){setError('No space after this effect. Move it earlier first.');return}setS({...s,[selected.kind]:[...items,{...p,time:t}]});setSelected({kind:selected.kind,index:items.length})}} aria-label="Duplicate effect" title="Duplicate effect"><Copy/></Button><Button disabled={!duration||progress!==null} onClick={()=>{const ranges=s.segments||[{start:0,end:duration}];const i=ranges.findIndex(r=>time>r.start+.05&&time<r.end-.05);if(i<0){setError('Place the playhead inside a retained section.');return}setS({...s,segments:ranges.flatMap((r,n)=>n===i?[{start:r.start,end:time},{start:time,end:r.end}]:[r])})}} aria-label="Split at playhead" title="Split at playhead"><Scissors/></Button></div></div>
          {point && selected && (
            <div className="editor-point">
              <h3>
                {selected.kind === 'focus' ? 'Focus point' : 'Tap highlight'}
              </h3>
              <p>At {point.time.toFixed(1)} seconds</p>
              {selected.kind==='taps' && <><label>Gesture<NativeSelect aria-label="Gesture" value={s.taps[selected.index].gesture??'tap'} onChange={e=>setS({...s,taps:s.taps.map((p,i)=>i===selected.index?{...p,gesture:e.target.value as 'tap'|'double-tap'|'swipe'}:p)})}><option value="tap">Tap</option><option value="double-tap">Double-Tap</option><option value="swipe">Swipe</option></NativeSelect></label>{s.taps[selected.index].gesture==='swipe'&&<label>Direction<NativeSelect aria-label="Swipe direction" value={s.taps[selected.index].direction??'up'} onChange={e=>setS({...s,taps:s.taps.map((p,i)=>i===selected.index?{...p,direction:e.target.value as 'up'|'down'|'left'|'right'}:p)})}>{['up','down','left','right'].map(d=><option key={d} value={d}>{d}</option>)}</NativeSelect></label>}</>}
              {'zoom' in point && (
                <>
                  <label>
                    Zoom
                    <Input
                      type="number"
                      min={1}
                      max={3}
                      step={0.1}
                      value={(point as Focus).zoom}
                      disabled={progress !== null}
                      onChange={(e) =>
                        setS({
                          ...s,
                          focus: s.focus.map((p, i) =>
                            i === selected.index
                              ? {
                                  ...p,
                                  zoom: clamp(Number(e.target.value), 1, 3),
                                }
                              : p,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Duration
                    <Input
                      type="number"
                      min={0.8}
                      max={duration - point.time}
                      step={0.1}
                      value={(point as Focus).duration}
                      disabled={progress !== null}
                      onChange={(e) => {
                        const length = clamp(
                          Number(e.target.value),
                          0.8,
                          duration - point.time,
                        );
                        if (
                          s.focus.some(
                            (p, i) =>
                              i !== selected.index &&
                              point.time < p.time + p.duration &&
                              p.time < point.time + length,
                          )
                        ) {
                          setError('Focus points cannot overlap.');
                          return;
                        }
                        setS({
                          ...s,
                          focus: s.focus.map((p, i) =>
                            i === selected.index
                              ? { ...p, duration: length }
                              : p,
                          ),
                        });
                      }}
                    />
                  </label>
                </>
              )}
              <Button
                disabled={progress !== null}
                onClick={() => {
                  setS({
                    ...s,
                    [selected.kind]: s[selected.kind].filter(
                      (_, i) => i !== selected.index,
                    ),
                  });
                  setSelected(null);
                }}
              >
                Remove point
              </Button>
            </div>
          )}
          <details className="inspector-disclosure"><summary>Retained sections</summary>          {s.segments&&<div className="splice-list">{s.segments.map((r,i)=><div key={i}><Button onClick={()=>seek(r.start)}>{i+1}: {r.start.toFixed(1)}–{r.end.toFixed(1)}s</Button><Button disabled={s.segments!.length<=1||progress!==null} aria-label={`Remove section ${i+1}`} onClick={()=>setS({...s,segments:s.segments!.filter((_,n)=>n!==i)})}>×</Button></div>)}<Button onClick={()=>setS({...s,segments:undefined})}>Restore full take</Button></div>}
</details>
          <details className="inspector-disclosure" open><summary>Canvas</summary><label>Export preset<NativeSelect aria-label="Export preset" value={s.preset??'native'} disabled={progress!==null} onChange={e=>setS({...s,preset:e.target.value as Composition['preset']})}><option value="native">Original aspect</option><option value="portrait">Portrait · 9:16</option><option value="landscape">Landscape · 16:9</option><option value="square">Square · 1:1</option></NativeSelect></label>          <p>
            Original pixels, plus padding. The phone image is never silently
            reduced to 1080p.
          </p>
          <label>
            Padding · {s.padding} px
            <Slider
              aria-label="Canvas padding"
              min={0}
              max={240}
              step={8}
              value={[s.padding]}
              disabled={progress !== null}
              onValueChange={(v) =>
                setS({ ...s, padding: Array.isArray(v) ? v[0] : v })
              }
            />
          </label>
          <div className="editor-swatches">
            {colors.map((c, i) => (
              <button
                key={c}
                aria-label={['Sand', 'Sage', 'Mist', 'Rose', 'Graphite'][i]}
                aria-pressed={s.color === c}
                disabled={progress !== null}
                style={{ background: c }}
                onClick={() => setS({ ...s, color: c })}
              />
            ))}
          </div>
</details><details className="inspector-disclosure"><summary>Audio</summary><label>Recording volume<input aria-label="Recording volume" type="range" min="0" max="1" step=".05" value={s.volume??1} disabled={progress!==null} onChange={e=>setS({...s,volume:Number(e.target.value)})}/></label><label>Audio fade seconds<Input aria-label="Audio fade seconds" type="number" min="0" max="3" step=".1" value={s.fade??0} disabled={progress!==null} onChange={e=>setS({...s,fade:clamp(Number(e.target.value),0,3)})}/></label>
</details><details className="inspector-disclosure"><summary>Trim</summary><div className="trim-fields">
          <label>
            Start seconds
            <Input
              type="number"
              min={0}
              max={duration}
              step={0.1}
              value={start}
              disabled={progress !== null}
              onChange={(e) => setStart(Number(e.target.value))}
            />
          </label>
          <label>
            End seconds
            <Input
              type="number"
              min={0}
              max={duration}
              step={0.1}
              value={end}
              disabled={progress !== null}
              onChange={(e) => setEnd(Number(e.target.value))}
            />
          </label>
</div></details>
</div><div className="inspector-export">
          <Button className="editor-export-button" disabled={!duration || progress !== null} onClick={render}>
            <Download/>Export video
          </Button>
          {progress !== null && (
            <>
              <p role="status">
                Exporting {Math.round(progress * 100)}% · you can switch tabs; keep Frame open
              </p>
              <Button onClick={() => abort.current?.abort()}>
                Cancel export
              </Button>
            </>
          )}
          <p>
            Export runs locally in the background and retains source audio. Your raw
            recording stays separate.
          </p>
</div>
        </aside>
      </div>
      {error && (
        <div role="alert" className="editor-alert"><span>{error}</span><Button aria-label="Dismiss editor error" onClick={()=>setError("")}><X/></Button></div>
      )}
      {result && (
        <div className="editor-result">
          <div className="editor-result-heading"><h3>Export ready</h3><Button aria-label="Close export preview" onClick={()=>setResult("")}><X/></Button></div>
          <video controls src={result} />
          <Button
            onClick={async () => {
              try {setSaveStatus('Choose where to save…');setSaveStatus(await saveFile(()=>fetch(result).then(r=>r.blob()),'Frame-edited','video/webm'))}catch(e){setError(String(e))}
            }}
          >
            Save edited video
          </Button>
        </div>
      )}
    </section>
  );
}
