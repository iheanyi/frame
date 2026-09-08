/** Frame's platform-independent edit model. No DOM, transport, or persistence. */
export type TimedFocus = { time: number; duration: number };
export type Focus = TimedFocus & { x: number; y: number; zoom: number };
export type TapStyle = { color?: string; size?: number; bloom?: number };
export type Tap = {
  time: number;
  x: number;
  y: number;
  duration?: number;
  gesture?: "tap" | "double-tap" | "swipe";
  direction?: "up" | "down" | "left" | "right";
};
export type Segment = { start: number; end: number };
export const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

/** Smooth entrance and exit, measured on original source time in seconds. */
export function focusEnvelope(focus: TimedFocus, time: number): number {
  return (
    Math.sin((Math.PI / 2) * clamp((time - focus.time) / 0.35, 0, 1)) ** 2 *
    Math.sin((Math.PI / 2) * clamp((focus.time + focus.duration - time) / 0.35, 0, 1)) ** 2
  );
}

/** Crop in original pixels; viewport fitting remains platform-specific. */
export function focusCrop(width: number, height: number, focus: Focus[], time: number) {
  const selected = focus.find((item) => time >= item.time && time <= item.time + item.duration);
  const zoom = selected ? 1 + (selected.zoom - 1) * focusEnvelope(selected, time) : 1;
  const sw = width / zoom, sh = height / zoom;
  return {
    sw,
    sh,
    sx: clamp((selected?.x ?? 0.5) * width - sw / 2, 0, width - sw),
    sy: clamp((selected?.y ?? 0.5) * height - sh / 2, 0, height - sh),
  };
}

/** Clip retained source ranges to the export trim without changing their order. */
export function retainedRanges(segments: Segment[] | undefined, start: number, end: number): Segment[] {
  return (segments ?? [{ start, end }])
    .map((range) => ({ start: Math.max(start, range.start), end: Math.min(end, range.end) }))
    .filter((range) => range.end > range.start);
}
export function splitSegments(
  segments: Segment[],
  time: number,
): Segment[] | null {
  const index = segments.findIndex(
    (s) => time - s.start >= 1 / 30 && s.end - time >= 1 / 30,
  );
  if (index < 0 || segments.length >= 100) return null;
  const source = segments[index];
  return [
    ...segments.slice(0, index),
    { start: source.start, end: time },
    { start: time, end: source.end },
    ...segments.slice(index + 1),
  ];
}

/** Prefer nearby clip/effect boundaries without pulling a distant edit. */
export function snapTime(
  position: number,
  targets: number[],
  tolerance: number,
): number {
  let result = position,
    distance = tolerance;
  for (const target of targets) {
    const delta = Math.abs(target - position);
    if (delta <= distance) {
      result = target;
      distance = delta;
    }
  }
  return result;
}

/** Find the first complete empty interval at or after the requested time. */
export function availableFocusTime(
  focus: TimedFocus[],
  duration: number,
  after: number,
  clipDuration: number,
): number | null {
  let time = Math.max(0, after);
  for (const item of [...focus].sort((a, b) => a.time - b.time)) {
    if (time + duration <= item.time) break;
    if (time < item.time + item.duration) time = item.time + item.duration;
  }
  return time + duration <= clipDuration ? time : null;
}

/** Keep a focus inside the source clip and its neighboring focus intervals. */
export function resizeFocus(
  focus: TimedFocus[],
  index: number,
  edge: "start" | "end",
  position: number,
  clipDuration: number,
): TimedFocus {
  const current = focus[index];
  const end = current.time + current.duration;
  const previousEnd = Math.max(
    0,
    ...focus
      .filter((_, i) => i !== index)
      .filter((f) => f.time + f.duration <= current.time + 0.00001)
      .map((f) => f.time + f.duration),
  );
  const nextStart = Math.min(
    clipDuration,
    ...focus
      .filter((_, i) => i !== index)
      .filter((f) => f.time >= end - 0.00001)
      .map((f) => f.time),
  );
  const minimum = Math.min(0.8, current.duration);
  if (edge === "start") {
    const time = Math.max(previousEnd, Math.min(end - minimum, position));
    return { time, duration: end - time };
  }
  return {
    time: current.time,
    duration:
      Math.max(current.time + minimum, Math.min(nextStart, position)) -
      current.time,
  };
}
