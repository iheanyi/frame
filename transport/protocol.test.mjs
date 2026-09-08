import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, stat, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRequest, packetJson } from './protocol.mjs';
import { FileCredentials } from './credentials.mjs';

test('protocol rejects malformed envelopes and preserves large media timestamps', () => {
  for (const value of ['null', '{}', '{"id":1,"method":"touch","params":[]}']) assert.throws(() => parseRequest(value));
  assert.deepEqual(parseRequest('{"id":1,"method":"enumerate"}').params, {});
  const packet = packetJson({ type: 'data', pts: 9007199254740999n, keyframe: true, data: Uint8Array.from([0,128,255]) });
  assert.equal(packet.pts, '9007199254740999');
  assert.deepEqual([...Buffer.from(packet.data, 'base64')], [0,128,255]);
});

test('credentials persist with private permissions and reject overwriting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frame-credentials-test-'));
  try {
    const store = new FileCredentials(directory);
    assert.equal((await Array.fromAsync(store.iterateKeys())).length, 0);
    const generated = await store.generateKey();
    assert.deepEqual((await Array.fromAsync(store.iterateKeys()))[0].buffer, generated.buffer);
    assert.equal((await stat(join(directory, 'frame-adb.pk8'))).mode & 0o777, 0o600);
    await assert.rejects(store.generateKey(), { code: 'EEXIST' });
  } finally { await unlink(join(directory, 'frame-adb.pk8')); await rmdir(directory); }
});

test('CLI returns useful errors and shuts down without opening a phone', async () => {
  const child = spawn(process.execPath, [new URL('./index.mjs', import.meta.url).pathname], { stdio: ['pipe','pipe','pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => errors += data);
  child.stdin.end('{"id":1,"method":"screenshot"}\n{"id":2,"method":"unknown"}\n{"id":3,"method":"shutdown"}\n');
  const code = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(code, 0, errors);
  const responses = output.trim().split('\n').map(JSON.parse);
  assert.match(responses[0].error.message, /Connect a phone first/);
  assert.match(responses[1].error.message, /Unknown method/);
  assert.deepEqual(responses[2], { id:3, result:{} });
});
