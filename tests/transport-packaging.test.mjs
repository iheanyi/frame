import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,readlink,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {copyTransport} from '../scripts/copy-transport.mjs';

test('repeat packaging preserves relative npm links inside the bundle',{skip:process.platform==='win32'},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'frame-packaging-'));
 const source=path.join(root,'transport'),dest=path.join(root,'bundle');
 await mkdir(path.join(source,'node_modules/.bin'),{recursive:true});
 await mkdir(path.join(source,'node_modules/tool'),{recursive:true});
 await writeFile(path.join(source,'node_modules/tool/bin.js'),'first');
 await symlink('../tool/bin.js',path.join(source,'node_modules/.bin/tool'));
 await copyTransport(source,dest);
 await writeFile(path.join(source,'node_modules/tool/bin.js'),'updated');
 await copyTransport(source,dest);
 assert.equal(await readlink(path.join(dest,'node_modules/.bin/tool')),'../tool/bin.js');
 assert.equal(await readFile(path.join(dest,'node_modules/.bin/tool'),'utf8'),'updated');
 await writeFile(path.join(source,'node_modules/tool/bin.js'),'source only');
 assert.equal(await readFile(path.join(dest,'node_modules/.bin/tool'),'utf8'),'updated');
});

test('bundles only matching USB binaries and removes stale architectures on a repeat build',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'frame-architectures-'));
 const source=path.join(root,'transport'),dest=path.join(root,'bundle');
 for(const tuple of ['linux-x64','linux-ia32','darwin-x64+arm64','win32-x64']){
  const dir=path.join(source,'node_modules/usb/prebuilds',tuple);
  await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'node.napi.node'),'fixture');
 }
 await copyTransport(source,dest,'linux','x64');
 assert.deepEqual(await readdir(path.join(dest,'node_modules/usb/prebuilds')),['linux-x64']);
 await copyTransport(source,dest,'darwin','arm64');
 assert.deepEqual(await readdir(path.join(dest,'node_modules/usb/prebuilds')),['darwin-x64+arm64']);
});
