import {cp} from 'node:fs/promises';

export function copyTransport(source,destination){
 // Keep npm's relative links inside the bundle, including on repeat builds.
 return cp(source,destination,{recursive:true,verbatimSymlinks:true,filter:file=>!file.endsWith('.test.mjs')});
}
