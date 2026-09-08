import {test} from 'node:test';
import assert from 'node:assert/strict';
import {primeVideoFrame} from '../src/video-primer.ts';

test('a loaded video primes silently and redraws only once a decoded frame arrives', async () => {
  let decoded, paused=0, painted=0;
  const video={muted:false,play:async()=>{},pause(){paused++},requestVideoFrameCallback(fn){decoded=fn;return 7}};
  primeVideoFrame(video,()=>painted++);
  await Promise.resolve();
  assert.equal(video.muted,true);
  assert.equal(painted,0,'play fulfillment is not evidence of a decoded frame');
  decoded();
  assert.equal(paused,1);
  assert.equal(video.muted,false);
  assert.equal(painted,1);
});

test('switching clips cancels initialization and never paints the previous source', () => {
  let decoded,cancelled,painted=0;
  const video={muted:false,play:async()=>{},pause(){},requestVideoFrameCallback(fn){decoded=fn;return 9},cancelVideoFrameCallback(id){cancelled=id}};
  const dispose=primeVideoFrame(video,()=>painted++);
  dispose();decoded();
  assert.equal(cancelled,9);
  assert.equal(painted,0);
  assert.equal(video.muted,false);
});
