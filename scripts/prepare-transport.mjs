import {cp, mkdir, readFile, writeFile, access, chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const resources=path.join(root,'src-tauri/resources');
try { await access(path.join(root,'transport/node_modules/usb/package.json')); }
catch { execFileSync(process.platform==='win32'?'npm.cmd':'npm',['ci','--omit=dev'],{cwd:path.join(root,'transport'),stdio:'inherit'}); }
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
await cp(path.join(root,'transport'),path.join(resources,'tango-helper'),{recursive:true,filter:source=>!source.endsWith('.test.mjs')});
await writeFile(path.join(resources,'tango-runtime','build.json'),JSON.stringify({version,platform,arch,sha256:actual},null,2));
console.log(`Prepared Tango runtime ${version} for ${platform}/${arch}`);
