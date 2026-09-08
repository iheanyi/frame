export function fileName(name:string, type:string){
 const ext=type.includes('png')?'png':type.includes('mp4')?'mp4':'webm';
 return name.replace(/\.(webm|mp4|png)$/i,'')+'.'+ext;
}
/** The fallback cannot observe whether the browser actually saves a download. */
export async function saveFile(blob:Blob,name:string):Promise<string>{
 const suggestedName=fileName(name,blob.type);
 const w=window as typeof window & {showSaveFilePicker?:(options:unknown)=>Promise<{createWritable:()=>Promise<{write:(blob:Blob)=>Promise<void>;close:()=>Promise<void>;abort:()=>Promise<void>}>}>};
 if(w.showSaveFilePicker){
  let handle;try{handle=await w.showSaveFilePicker({suggestedName})}catch(e){if(e instanceof DOMException&&e.name==='AbortError')return 'Save cancelled';throw e}const writer=await handle.createWritable();
  try{await writer.write(blob);await writer.close()}catch(error){await writer.abort().catch(()=>{});throw error}
  return 'Saved to file';
 }
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=suggestedName;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 return 'Download requested. Your browser may ask where to save; the local library keeps a separate copy.';
}
