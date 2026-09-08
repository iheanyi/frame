import {saveTake} from './take-store';
export async function saveScreenshot(source:HTMLCanvasElement|HTMLVideoElement){
 const video=source instanceof HTMLVideoElement,width=video?source.videoWidth:source.width,height=video?source.videoHeight:source.height;
 if(!width||!height||(video&&source.readyState<2))throw Error('Wait for the image to load.');
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d')!.drawImage(source,0,0);
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Screenshot failed.')),'image/png'));
 const thumb=document.createElement('canvas');thumb.width=160;thumb.height=Math.round(height/width*160);thumb.getContext('2d')!.drawImage(canvas,0,0,thumb.width,thumb.height);
 return saveTake(blob,{name:`Screenshot ${new Date().toLocaleString()}`,width,height,kind:'screenshot',thumbnail:thumb.toDataURL('image/jpeg',.7)});
}
