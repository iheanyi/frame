import {test} from 'node:test';
import assert from 'node:assert/strict';
import {audioWindow,audioGain} from './export-timing.ts';
test('cut audio at sample boundaries and retime spliced sections contiguously',()=>{
 const a=audioWindow(.9,9600,48000,1,1.05,2);
 assert.equal(a.first,4800);assert.equal(a.frames,2400);assert.ok(Math.abs(a.timestamp-2)<1e-9);
 assert.equal(audioWindow(2,1024,48000,0,1,0).frames,0);
});
test('audio fades follow edited duration rather than removed source gaps',()=>{
 assert.equal(audioGain(0,4,.5,1),0);assert.equal(audioGain(.5,4,.5,1),.25);
 assert.equal(audioGain(2,4,.5,1),.5);assert.equal(audioGain(4,4,.5,1),0);
 assert.equal(audioGain(2,4,0,0),0);
});
