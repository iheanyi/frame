import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLivePacket } from '../src/livePacket.ts';
function packet(flags) {
  const raw = new ArrayBuffer(16);
  const view = new DataView(raw);
  view.setBigUint64(0, flags);
  view.setUint32(8, 4);
  new Uint8Array(raw).set([0,0,0,1],12);
  return raw;
}
test('scrcpy 4.1 configuration uses bit 62', () => {
  assert.equal(parseLivePacket(packet(1n << 62n)).type, 'configuration');
});
test('scrcpy 4.1 keyframe flag is excluded from presentation timestamp', () => {
  const p = parseLivePacket(packet((1n << 61n) | 123456n));
  assert.equal(p.type, 'data');
  assert.equal(p.keyframe, true);
  assert.equal(p.pts, 123456n);
  assert.deepEqual([...p.data], [0,0,0,1]);
});
