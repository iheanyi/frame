import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAudioRouting} from './audio-routing.ts';

test('monitoring branches device audio without changing recorded gain or monitoring the microphone',()=>{
  const nodes=[];
  const node=()=>{const n={outputs:[],gain:{value:1,setTargetAtTime(value){this.value=value}},connect(other){this.outputs.push(other)}};nodes.push(n);return n};
  const speakers=node();
  const context={destination:speakers,currentTime:0,state:'running',createGain:node,createMediaStreamDestination:node,createAnalyser:()=>Object.assign(node(),{fftSize:1024,getFloatTimeDomainData(a){a.fill(0.1)}})};
  const routing=createAudioRouting(context);
  assert.deepEqual(routing.microphone.outputs,[routing.destination]);
  assert.deepEqual(routing.device.outputs,[routing.destination]);
  const monitor=nodes.find(n=>n.outputs.includes(speakers));
  assert.equal(monitor.gain.value,0);
  routing.device.gain.value=.25;
  routing.setMonitoring(true);
  assert.equal(monitor.gain.value,1);
  assert.equal(routing.device.gain.value,.25);
  assert.ok(routing.level()>.6);
  routing.setMonitoring(false);
  assert.equal(monitor.gain.value,0);
  assert.equal(routing.device.gain.value,.25);
  context.state='closed';
  assert.equal(routing.level(),0);
});
