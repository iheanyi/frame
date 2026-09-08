import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,readlink,readFile} from 'node:fs/promises';
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
