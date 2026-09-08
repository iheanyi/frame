import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availableFocusTime,
  resizeFocus,
  snapTime,
  splitSegments,
} from "../src/timeline.ts";

test("split preserves the original interval and refuses gaps or tiny fragments", () => {
  const original = [
    { start: 0, end: 2 },
    { start: 4, end: 8 },
  ];
  assert.deepEqual(splitSegments(original, 5), [
    { start: 0, end: 2 },
    { start: 4, end: 5 },
    { start: 5, end: 8 },
  ]);
  assert.equal(splitSegments(original, 3), null);
  assert.equal(splitSegments(original, 4.001), null);
  assert.deepEqual(original, [
    { start: 0, end: 2 },
    { start: 4, end: 8 },
  ]);
});

test("snapping chooses the nearest boundary only inside its pixel tolerance", () => {
  assert.equal(snapTime(3.96, [0, 4, 4.2, 10], 0.1), 4);
  assert.equal(snapTime(3.7, [0, 4, 10], 0.1), 3.7);
  assert.equal(snapTime(0.03, [0, 10], 0.1), 0);
});

test("duplication finds a complete gap without overlapping or exceeding the clip", () => {
  const effects = [
    { time: 0, duration: 2 },
    { time: 3, duration: 2 },
    { time: 7, duration: 1 },
  ];
  assert.equal(availableFocusTime(effects, 2, 2, 10), 5);
  assert.equal(availableFocusTime(effects, 3, 2, 10), null);
  assert.equal(availableFocusTime(effects, 2, 8, 10), 8);
});

test("focus edges cannot cross adjacent effects or the source bounds", () => {
  const focus = [
    { time: 1, duration: 2 },
    { time: 4, duration: 2 },
    { time: 8, duration: 1 },
  ];
  assert.deepEqual(resizeFocus(focus, 1, "start", -5, 10), {
    time: 3,
    duration: 3,
  });
  assert.deepEqual(resizeFocus(focus, 1, "end", 12, 10), {
    time: 4,
    duration: 4,
  });
  assert.deepEqual(resizeFocus(focus, 0, "start", -5, 10), {
    time: 0,
    duration: 3,
  });
  assert.deepEqual(resizeFocus(focus, 2, "end", 12, 10), {
    time: 8,
    duration: 2,
  });
});

test("focus retains enough duration for smooth entrance and exit", () => {
  const focus = [{ time: 4, duration: 2 }];
  const start = resizeFocus(focus, 0, "start", 10, 20);
  const end = resizeFocus(focus, 0, "end", 0, 20);
  assert.ok(Math.abs(start.duration - 0.8) < 0.00001);
  assert.equal(start.time + start.duration, 6);
  assert.ok(Math.abs(end.duration - 0.8) < 0.00001);
  assert.equal(end.time, 4);
  assert.deepEqual(focus, [{ time: 4, duration: 2 }]);
});
