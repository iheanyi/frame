import {cp,rename,mkdtemp} from 'node:fs/promises';
import path from 'node:path';

export async function copyTransport(source,destination,platform=process.platform,arch=process.arch){
 // Retain the previous generated bundle outside the resource glob. This also
 // removes stale foreign binaries from repeat builds without deleting them.
 try{
  const previous=await mkdtemp(path.join(path.dirname(destination),'.transport-previous-'));
  await rename(destination,path.join(previous,'helper'));
 }catch(error){if(error.code!=='ENOENT')throw error;}
 // Keep npm's relative links inside the bundle, including on repeat builds.
 return cp(source,destination,{recursive:true,verbatimSymlinks:true,filter:file=>{
  if(file.endsWith('.test.mjs'))return false;
  const parts=path.relative(source,file).split(path.sep),index=parts.indexOf('prebuilds');
  if(index<0||!parts[index+1])return true;
  const [os,arches]=parts[index+1].split('-');
  return os===platform&&arches?.split('+').includes(arch);
 }});
}
