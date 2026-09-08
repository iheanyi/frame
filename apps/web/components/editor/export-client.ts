import type { Composition } from './render-frame.ts';
import ExportWorker from './export-worker?worker';
export async function exportComposition(url:string,s:Composition,start:number,end:number,signal:AbortSignal,progress:(n:number)=>void):Promise<Blob>{
 signal.throwIfAborted();
 const response=await fetch(url,{signal});if(!response.ok)throw Error('The original take is unavailable. Reopen it from Library.');
 const blob=await response.blob();signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const worker=new ExportWorker();
  const cleanup=()=>{signal.removeEventListener('abort',cancel);worker.terminate()};
  const cancel=()=>{cleanup();reject(Error('Export cancelled. Your original and edits are preserved.'))};
  signal.addEventListener('abort',cancel,{once:true});
  worker.onmessage=({data})=>{
   if(data.type==='progress')progress(data.value);
   if(data.type==='done'){cleanup();resolve(data.blob)}
   if(data.type==='error'){cleanup();reject(Error(data.message))}
  };
  worker.onerror=(event)=>{cleanup();reject(Error(event.message||'The export worker could not start. Your original is preserved.'))};
  worker.postMessage({blob,s,start,end});
 });
}
