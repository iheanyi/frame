import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveFile} from './save-file.ts';
test('file picker is requested before asynchronous library reads, with the correct extension',async()=>{
 const events=[];const blob=new Blob(['video'],{type:'video/mp4'});
 globalThis.window={showSaveFilePicker:async options=>{events.push(options.suggestedName);return {createWritable:async()=>({write:async b=>{assert.equal(b,blob);events.push('write')},close:async()=>events.push('close'),abort:async()=>{}})}}};
 await saveFile(async()=>{events.push('read');return blob},'Original','video/mp4');
 assert.deepEqual(events,['Original.mp4','read','write','close']);
});
test('cancelling destination selection does not load the video',async()=>{
 globalThis.window={showSaveFilePicker:async()=>{throw new DOMException('cancelled','AbortError')}};
 assert.equal(await saveFile(async()=>{throw Error('must not load')},'Original'),'Save cancelled');
});
