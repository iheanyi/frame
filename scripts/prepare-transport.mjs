import {cp, mkdir, readFile, writeFile, access, chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {copyTransport} from './copy-transport.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const resources=path.join(root,'src-tauri/resources');
try { await access(path.join(root,'transport/node_modules/usb/package.json')); }
catch {
 const options={cwd:path.join(root,'transport'),stdio:'inherit'};
 // npm's JS entry point avoids spawning a .cmd file directly on Windows.
 if(process.env.npm_execpath)execFileSync(process.execPath,[process.env.npm_execpath,'ci','--omit=dev'],options);
 else if(process.platform==='win32')execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm ci --omit=dev'],options);
 else execFileSync('npm',['ci','--omit=dev'],options);
}
const version='v22.23.2';
const platform=process.platform, arch=process.arch;
const name=`node-${version}-${platform==='win32'?'win':platform}-${arch}`;
const archive=`${name}.${platform==='win32'?'zip':'tar.gz'}`;
const cache=path.join(root,'.runtime-cache');
await mkdir(cache,{recursive:true});
async function download(url,file){try{await access(file)}catch{execFileSync('curl',['--fail','--location','--silent','--show-error',url,'--output',file],{stdio:'inherit'});}}
const sums=path.join(cache,`SHASUMS256-${version}.txt`);
await download(`https://nodejs.org/dist/${version}/SHASUMS256.txt`,sums);
const archivePath=path.join(cache,archive);
await download(`https://nodejs.org/dist/${version}/${archive}`,archivePath);
const expected=(await readFile(sums,'utf8')).split('\n').find(line=>line.endsWith(`  ${archive}`))?.split(' ')[0];
const actual=createHash('sha256').update(await readFile(archivePath)).digest('hex');
if(!expected||actual!==expected)throw Error(`Runtime checksum mismatch: ${archivePath}`);
execFileSync('tar',['-xf',archivePath,'-C',cache]);
await mkdir(path.join(resources,'tango-runtime'),{recursive:true});
const executable=platform==='win32'?'node.exe':'node';
await cp(path.join(cache,name,platform==='win32'?'node.exe':'bin/node'),path.join(resources,'tango-runtime',executable));
await chmod(path.join(resources,'tango-runtime',executable),0o755);
await cp(path.join(cache,name,'LICENSE'),path.join(resources,'tango-runtime','LICENSE'));
await copyTransport(path.join(root,'transport'),path.join(resources,'tango-helper'));
await writeFile(path.join(resources,'tango-runtime','build.json'),JSON.stringify({version,platform,arch,sha256:actual},null,2));
console.log(`Prepared Tango runtime ${version} for ${platform}/${arch}`);
