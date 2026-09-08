import { Input, ALL_FORMATS, BlobSource, CanvasSink, CanvasSource, AudioSampleSink, AudioSampleSource, AudioSample, Output, WebMOutputFormat, BufferTarget, canEncodeVideo, canEncodeAudio } from 'mediabunny';
import { drawFrame, canvasSize, type Composition } from './render-frame';
import { retainedRanges } from '../../lib/editor-core';
import { audioWindow, audioGain } from './export-timing';
self.onmessage=async({data}:{data:{blob:Blob;s:Composition;start:number;end:number}})=>{
 const input=new Input({formats:ALL_FORMATS,source:new BlobSource(data.blob)});
 let output:Output|undefined;
 try {
  if(typeof VideoEncoder==='undefined'||typeof OffscreenCanvas==='undefined')throw Error('This browser does not support background video export. Use a current Chrome or Edge browser. Your original stays in Library.');
  const {s,start,end}=data,ranges=retainedRanges(s.segments,start,end);
  const total=ranges.reduce((n,r)=>n+r.end-r.start,0);
  if(!total)throw Error('No retained footage to export.');
  const track=await input.getPrimaryVideoTrack();
  if(!track||!await track.canDecode())throw Error('This browser cannot decode the original video.');
  const {w,h}=canvasSize(s);
  const codec=await canEncodeVideo('vp9',{width:w,height:h})?'vp9':await canEncodeVideo('vp8',{width:w,height:h})?'vp8':null;
  if(!codec)throw Error('This browser cannot encode the selected dimensions. Your full-resolution original is preserved.');
  const audio=await input.getPrimaryAudioTrack();
  if(audio&&(!await audio.canDecode()||!await canEncodeAudio('opus')))throw Error('This browser cannot process the audio in this take. No silent substitute was exported.');
  const target=new BufferTarget();
  output=new Output({format:new WebMOutputFormat(),target});
  const canvas=new OffscreenCanvas(w,h);
  const videoSource=new CanvasSource(canvas,{codec,bitrate:Math.max(24000000,w*h*5)});
  const fps=60;
  output.addVideoTrack(videoSource,{frameRate:fps});
  const audioSource=audio?new AudioSampleSource({codec:'opus',bitrate:192000}):undefined;
  if(audioSource)output.addAudioTrack(audioSource);
  await output.start();
  // Process both tracks concurrently, honoring encoder backpressure.
  await Promise.all([
   (async()=>{
    const sink=new CanvasSink(track,{poolSize:2});
    const firstTimestamp=await track.getFirstTimestamp();
    const initialFrames=sink.canvases();
    const initial=await initialFrames.next();
    await initialFrames.return();
    if(!initial.value)throw Error('The source contains no decodable video frames.');
    let lastFrame=initial.value;
    let offset=0;
    for(const range of ranges){
     const count=Math.ceil((range.end-range.start)*fps);
     function* timestamps(){for(let i=0;i<count;i++)yield Math.max(firstTimestamp,range.start+i/fps)}
     let i=0;
     for await(const frame of sink.canvasesAtTimestamps(timestamps())){
      // Phone recordings may have timestamp gaps while the screen is static.
      // Hold the last decoded picture across those gaps, including the tail.
      if(frame)lastFrame=frame;
      const t=range.start+i/fps,duration=Math.min(1/fps,range.end-t);
      drawFrame(canvas,lastFrame.canvas,s,t);
      await videoSource.add(offset+i/fps,duration);
      i++;self.postMessage({type:'progress',value:Math.min(.98,(offset+i/fps)/total*.98)});
     }
     offset+=range.end-range.start;
    }
    videoSource.close();
   })(),
   (async()=>{
    if(!audio||!audioSource)return;
    const sink=new AudioSampleSink(audio);let offset=0;
    for(const range of ranges){
     for await(const sample of sink.samples(range.start,range.end)){
      try {
       const window=audioWindow(sample.timestamp,sample.numberOfFrames,sample.sampleRate,range.start,range.end,offset);
       if(!window.frames)continue;
       const floats=new Float32Array(window.frames*sample.numberOfChannels);
       sample.copyTo(floats,{format:'f32',planeIndex:0,frameOffset:window.first,frameCount:window.frames});
       for(let f=0;f<window.frames;f++){
        const gain=audioGain(window.timestamp+f/sample.sampleRate,total,s.volume??1,s.fade??0);
        for(let c=0;c<sample.numberOfChannels;c++)floats[f*sample.numberOfChannels+c]*=gain;
       }
       const edited=new AudioSample({format:'f32',data:floats,numberOfChannels:sample.numberOfChannels,sampleRate:sample.sampleRate,timestamp:window.timestamp});
       try{await audioSource.add(edited)}finally{edited.close()}
      }finally{sample.close()}
     }
     offset+=range.end-range.start;
    }
    audioSource.close();
   })()
  ]);
  await output.finalize();
  if(!target.buffer?.byteLength)throw Error('The encoder produced an empty file.');
  self.postMessage({type:'done',blob:new Blob([target.buffer],{type:'video/webm'})});
 }catch(error){
  await output?.cancel().catch(()=>{});
  self.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});
 }finally{input.dispose()}
};
