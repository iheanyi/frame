import { clamp, focusCrop, retainedRanges, type Focus, type Tap, type Segment } from "../../lib/editor-core.ts";
export { clamp, type Focus, type Tap } from "../../lib/editor-core.ts";
export type Composition={width:number;height:number;padding:number;color:string;focus:Focus[];taps:Tap[];preset?:'native'|'portrait'|'landscape'|'square';volume?:number;fade?:number;segments?:Segment[]};
export function canvasSize(s:Composition){
 if(!s.width||!s.height)return {w:0,h:0};
 const baseW=s.width+2*s.padding,baseH=s.height+2*s.padding;
 const ratio=s.preset==='portrait'?9/16:s.preset==='landscape'?16/9:s.preset==='square'?1:baseW/baseH;
 return {w:Math.ceil(Math.max(baseW,baseH*ratio)/2)*2,h:Math.ceil(Math.max(baseH,baseW/ratio)/2)*2};
}
export function geometry(s:Composition,t:number){
 const {w,h}=canvasSize(s);
 const crop=focusCrop(s.width,s.height,s.focus,t);
 return {w,h,...crop,dx:(w-s.width)/2,dy:(h-s.height)/2,dw:s.width,dh:s.height};
}
export function drawComposition(canvas:HTMLCanvasElement,video:HTMLVideoElement,s:Composition){
 if(video.readyState<2 || video.seeking)return geometry(s,video.currentTime);
 const t=video.currentTime,g=geometry(s,t);if(canvas.width!==g.w)canvas.width=g.w;if(canvas.height!==g.h)canvas.height=g.h;
 const c=canvas.getContext('2d',{alpha:false})!;c.fillStyle=s.color;c.fillRect(0,0,g.w,g.h);
 if(video.readyState>=2)c.drawImage(video,g.sx,g.sy,g.sw,g.sh,g.dx,g.dy,g.dw,g.dh);
 c.save();c.beginPath();c.rect(g.dx,g.dy,g.dw,g.dh);c.clip();
 for(const tap of s.taps){
 const age=t-tap.time,length=tap.duration??.45;if(age<0||age>length)continue;
 const progress=age/length,swipe=tap.gesture==='swipe',pulse=tap.gesture==='double-tap'?(progress*2)%1:progress;
 let x=g.dx+(tap.x*s.width-g.sx)/g.sw*g.dw,y=g.dy+(tap.y*s.height-g.sy)/g.sh*g.dh;
 const distance=Math.min(s.width,s.height)*.2,dir=tap.direction??'up';
 const dx=swipe?(dir==='left'?-distance:dir==='right'?distance:0):0,dy=swipe?(dir==='up'?-distance:dir==='down'?distance:0):0;
 c.globalAlpha=1-(swipe?progress*.5:pulse);c.strokeStyle='#ffe0bb';c.lineWidth=4*g.dw/g.sw;
 if(swipe){c.beginPath();c.moveTo(x,y);c.lineTo(x+dx*progress,y+dy*progress);c.stroke();x+=dx*progress;y+=dy*progress}
 c.beginPath();c.arc(x,y,(22+pulse*11)*g.dw/g.sw,0,Math.PI*2);c.fillStyle='#e1bb9866';c.fill();c.stroke();
 }c.restore();return g;
}
function mediaEvent(video:HTMLVideoElement,event:string,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);video.removeEventListener(event,ok);video.removeEventListener('error',bad);signal.removeEventListener('abort',cancel)};const ok=()=>{cleanup();resolve()},bad=()=>{cleanup();reject(Error('Cannot decode this video for export.'))},cancel=()=>{cleanup();reject(Error('Export cancelled.'))};const timer=setTimeout(()=>{cleanup();reject(Error('Video loading or seeking timed out.'))},20000);video.addEventListener(event,ok,{once:true});video.addEventListener('error',bad,{once:true});signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});}
export async function exportComposition(url:string,s:Composition,start:number,end:number,signal:AbortSignal,progress:(n:number)=>void):Promise<Blob>{
 const video=document.createElement('video');video.playsInline=true;video.preload='auto';video.src=url;
 const context=new AudioContext();await context.resume();const source=context.createMediaElementSource(video),destination=context.createMediaStreamDestination();const gain=context.createGain();source.connect(gain);gain.connect(destination);
 const canvas=document.createElement('canvas');const output=canvasSize(s);canvas.width=output.w;canvas.height=output.h;
 const ranges=retainedRanges(s.segments,start,end);if(!ranges.length){await context.close();throw Error('No retained footage to export.');}start=ranges[0].start;end=ranges[ranges.length-1].end;
 let recorder:MediaRecorder|undefined,stream:MediaStream|undefined,raf=0;
 try{
 if(video.readyState<2)await mediaEvent(video,'loadeddata',signal);
 if(start>0){const sought=mediaEvent(video,'seeked',signal);video.currentTime=start;await sought;}
 signal.throwIfAborted();drawComposition(canvas,video,s);stream=canvas.captureStream(30);for(const track of destination.stream.getAudioTracks())stream.addTrack(track.clone());
 const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));if(!mime)throw Error('WebM recording is unsupported in this browser.');
 recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:Math.max(24000000,s.width*s.height*5),audioBitsPerSecond:192000});
 const chunks:Blob[]=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
 const done=new Promise<Blob>((resolve,reject)=>{recorder!.onstop=()=>signal.aborted?reject(Error('Export cancelled.')):resolve(new Blob(chunks,{type:mime}));recorder!.onerror=()=>reject(Error('Browser encoder failed at this resolution. Your original is preserved.'));});
 let hidden=false,spliceError:unknown;const stop=()=>{video.pause();if(recorder&&recorder.state!=='inactive')recorder.stop();};signal.addEventListener('abort',stop,{once:true});video.onended=stop;const visibility=()=>{if(document.hidden){hidden=true;stop()}};document.addEventListener('visibilitychange',visibility);
 let rangeIndex=0,elapsed=0;const total=ranges.reduce((n,r)=>n+r.end-r.start,0);
 const tick=()=>{
  const range=ranges[rangeIndex],offset=elapsed+Math.max(0,video.currentTime-range.start),fade=Math.min(s.fade??0,total/2);
  gain.gain.value=(s.volume??1)*(fade?Math.min(1,offset/fade,Math.max(0,total-offset)/fade):1);
  drawComposition(canvas,video,s);progress(clamp(offset/total,0,1));
  if(video.currentTime>=range.end){
   elapsed+=range.end-range.start;rangeIndex++;
   if(rangeIndex>=ranges.length){stop();return}
   video.pause();recorder!.pause();const sought=mediaEvent(video,'seeked',signal);video.currentTime=ranges[rangeIndex].start;
   void sought.then(async()=>{if(signal.aborted||hidden)return;drawComposition(canvas,video,s);recorder!.resume();await video.play();raf=requestAnimationFrame(tick)}).catch(e=>{spliceError=e;stop()});return;
  }
  raf=requestAnimationFrame(tick);
 };
 recorder.start(1000);await video.play();tick();try{const blob=await done;if(spliceError)throw spliceError;if(hidden)throw Error('Export stopped because the tab was hidden. Keep Frame visible and export again.');return blob}finally{signal.removeEventListener('abort',stop);document.removeEventListener('visibilitychange',visibility)}

 }finally{cancelAnimationFrame(raf);video.pause();if(recorder&&recorder.state!=='inactive')recorder.stop();stream?.getTracks().forEach(t=>t.stop());video.removeAttribute('src');video.load();await context.close();}
}
