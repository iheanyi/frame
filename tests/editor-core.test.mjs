import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusCrop, focusEnvelope, retainedRanges } from '../packages/editor-core/index.ts';

test('shared crop uses source pixels with smooth bounded focus', () => {
  const focus = [{ time: 1, duration: 2, x: 0, y: 1, zoom: 2 }];
  assert.deepEqual(focusCrop(1344,2992,focus,1), { sw:1344,sh:2992,sx:0,sy:0 });
  assert.deepEqual(focusCrop(1344,2992,focus,1.5), { sw:672,sh:1496,sx:0,sy:1496 });
  assert.equal(focusEnvelope(focus[0],3),0);
  assert.ok(Math.abs(focusEnvelope(focus[0],1.175)-0.5)<1e-10);
});

test('retained source ranges trim without merging deliberate splice boundaries', () => {
  assert.deepEqual(retainedRanges([{start:0,end:2},{start:2,end:3},{start:5,end:9}],1,6),[{start:1,end:2},{start:2,end:3},{start:5,end:6}]);
  assert.deepEqual(retainedRanges([],0,10),[]);
  assert.deepEqual(retainedRanges(undefined,0,10),[{start:0,end:10}]);
});
