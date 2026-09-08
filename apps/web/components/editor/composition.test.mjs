import {test} from 'node:test';
import assert from 'node:assert/strict';
import {geometry,drawComposition} from './composition.ts';
const s={width:1344,height:2992,padding:48,color:'#fff',focus:[{time:1,duration:2,x:0,y:1,zoom:2}],taps:[]};
test('native pixels retained with explicit padding',()=>{const g=geometry(s,0);assert.equal(g.w,1440);assert.equal(g.h,3088);assert.equal(g.dw,1344);assert.equal(g.dh,2992);assert.equal(g.sw,1344)});
test('focus smoothly enters and exits and stays inside the source',()=>{assert.equal(geometry(s,1).sw,1344);assert.equal(geometry(s,3).sw,1344);const g=geometry(s,1.5);assert.equal(g.sw,672);assert.equal(g.sx,0);assert.equal(g.sy,1496);const ramp=geometry(s,1.175);assert.ok(ramp.sw>672&&ramp.sw<1344)});

test('seeking preserves the previous decoded picture',()=>{const canvas={getContext(){throw Error('Must not clear the canvas while seeking')}};assert.doesNotThrow(()=>drawComposition(canvas,{readyState:1,seeking:true,currentTime:2},s));assert.doesNotThrow(()=>drawComposition(canvas,{readyState:2,seeking:true,currentTime:2},s))});
