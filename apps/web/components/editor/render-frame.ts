import { clamp, focusCrop, retainedRanges, type Focus, type Tap, type Segment, type TapStyle } from "../../lib/editor-core.ts";
export { clamp, type Focus, type Tap } from "../../lib/editor-core.ts";
export type Composition={width:number;height:number;padding:number;color:string;focus:Focus[];taps:Tap[];tapStyle?:TapStyle;preset?:'native'|'portrait'|'landscape'|'square';volume?:number;fade?:number;segments?:Segment[]};
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
 return drawFrame(canvas,video,s,video.currentTime);
}
export function drawFrame(canvas:HTMLCanvasElement|OffscreenCanvas,image:CanvasImageSource,s:Composition,t:number){
 const g=geometry(s,t);if(canvas.width!==g.w)canvas.width=g.w;if(canvas.height!==g.h)canvas.height=g.h;
 const c=canvas.getContext('2d',{alpha:false})!;c.fillStyle=s.color;c.fillRect(0,0,g.w,g.h);
 c.drawImage(image,g.sx,g.sy,g.sw,g.sh,g.dx,g.dy,g.dw,g.dh);
 c.save();c.beginPath();c.rect(g.dx,g.dy,g.dw,g.dh);c.clip();
 for(const tap of s.taps){
 const age=t-tap.time,length=tap.duration??.45;if(age<0||age>length)continue;
 const progress=age/length,swipe=tap.gesture==='swipe',pulse=tap.gesture==='double-tap'?(progress*2)%1:progress;
 let x=g.dx+(tap.x*s.width-g.sx)/g.sw*g.dw,y=g.dy+(tap.y*s.height-g.sy)/g.sh*g.dh;
 const distance=Math.min(s.width,s.height)*.2,dir=tap.direction??'up';
 const dx=swipe?(dir==='left'?-distance:dir==='right'?distance:0):0,dy=swipe?(dir==='up'?-distance:dir==='down'?distance:0):0;
 const color=s.tapStyle?.color??'#ffe0bb',radius=s.tapStyle?.size??30,bloom=s.tapStyle?.bloom??.5;
 c.globalAlpha=1-(swipe?progress*.5:pulse);c.strokeStyle=color;c.lineWidth=4*g.dw/g.sw;
 c.shadowColor=color;c.shadowBlur=bloom*radius*2*g.dw/g.sw;
 if(swipe){c.beginPath();c.moveTo(x,y);c.lineTo(x+dx*progress,y+dy*progress);c.stroke();x+=dx*progress;y+=dy*progress}
 c.beginPath();c.arc(x,y,radius*(.75+pulse*.5)*g.dw/g.sw,0,Math.PI*2);c.fillStyle=color+'44';c.fill();c.stroke();
 }c.restore();return g;
}
