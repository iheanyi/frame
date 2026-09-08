import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebUSB } from 'usb';
import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from '@yume-chan/adb-scrcpy';
import { ReadableStream, WritableStream } from '@yume-chan/stream-extra';
import { FileCredentials } from './credentials.mjs';
import { parseRequest, packetJson, requireString } from './protocol.mjs';
import { NativeMp4Recorder } from './recorder.mjs';
import { ScrcpyInstanceId } from '@yume-chan/scrcpy';

const manager = new AdbDaemonWebUsbDeviceManager(new WebUSB({ allowAllDevices: true }));
let adb, usb, live, recording, lastRecordingError = null, closing = false, shutdown = false;
const send = async value => { if (!process.stdout.write(JSON.stringify(value) + '\n')) await once(process.stdout, 'drain'); };
const connected = () => { if (!adb) throw new Error('Connect a phone first'); return adb; };
async function stopLive() { const old = live; live = undefined; if (old) await old.client.close(); }
async function disconnect() {
  closing = true;
  try { if (recording) await stopRecording().catch(error => { lastRecordingError = String(error); }); await stopLive(); } finally { try { await adb?.close(); } finally { adb = undefined; await usb?.close(); usb = undefined; closing = false; } }
}
async function stopRecording() {
  const current = recording;
  if (!current) throw new Error(lastRecordingError || 'No recording is active');
  if (current.stopPromise) return current.stopPromise;
  current.stopping = true;
  current.stopPromise = (async () => {
    try {
      await current.client.close();
      await Promise.allSettled(current.pumps);
      const result = current.writer.finalize();
      if (current.error) throw new Error(`${current.error}. Partial recording preserved at ${result.outputPath}`);
      return result;
    } catch (error) { current.writer.abort(); lastRecordingError = error instanceof Error ? error.message : String(error); throw error; }
    finally { if (recording === current) recording = undefined; }
  })();
  return current.stopPromise;
}
async function run(method, params) {
  switch (method) {
    case 'enumerate': return (await manager.getDevices()).map(d => ({ serial: d.serial, name: d.name || d.serial, connection: 'usb' }));
    case 'getState': return { connected: Boolean(adb), live: live ? { sessionId: live.sessionId } : null, recording: recording ? { recordingId: recording.recordingId, outputPath: recording.outputPath } : null, lastRecordingError };
    case 'connect': {
      if (adb) throw new Error('Disconnect the current phone first');
      const serial = requireString(params.serial, 'serial');
      const credentials = requireString(params.credentialDirectory, 'credentialDirectory');
      const device = (await manager.getDevices()).find(d => d.serial === serial);
      if (!device) throw new Error('USB phone unavailable. Check cable and USB debugging.');
      usb = device.raw;
      try {
        const connection = await device.connect();
        await send({ event: 'status', message: 'Approve USB debugging on your phone' });
        let timer;
        const transport = await Promise.race([AdbDaemonTransport.authenticate({ serial, connection, credentialStore: new FileCredentials(credentials) }), new Promise((_, reject) => { timer = setTimeout(() => { void device.raw.close(); reject(new Error('USB debugging authorization timed out')); }, 60000); })]).finally(() => clearTimeout(timer));
        adb = new Adb(transport);
        void transport.disconnected.then(async () => { if (!closing && adb?.transport === transport) { adb = undefined; live = undefined; if (recording) { recording.error = 'Phone disconnected during recording'; void stopRecording().catch(() => {}); } await send({ event: 'disconnected', serial }); } }).catch(error => void send({ event: 'error', message: String(error) }));
        return { serial, name: device.name || serial };
      } catch (error) { await usb?.close().catch(() => {}); usb = undefined; throw error; }
    }
    case 'shell': { const bytes = await connected().subprocess.noneProtocol.spawnWait(requireString(params.command, 'command')); return { data: Buffer.from(bytes).toString('base64'), text: new TextDecoder().decode(bytes) }; }
    case 'screenshot': { const bytes = await connected().subprocess.noneProtocol.spawnWait(['screencap', '-p']); if (!Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Phone did not return a PNG screenshot'); return { data: Buffer.from(bytes).toString('base64'), mimeType: 'image/png' }; }
    case 'startLive': {
      const device = connected();
      await stopLive();
      const bytes = new Uint8Array(await readFile(requireString(params.serverPath, 'serverPath')));
      const server = '/data/local/tmp/frame-tango-server.jar';
      await AdbScrcpyClient.pushServer(device, new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), server);
      const client = await AdbScrcpyClient.start(device, server, new AdbScrcpyOptions3_3_3({ scid: ScrcpyInstanceId.random(), videoCodec: 'h264', maxSize: params.maxSize ?? 0, maxFps: params.maxFps ?? 60, videoBitRate: params.videoBitRate ?? 16000000, audio: false, control: true, tunnelForward: true }));
      const sessionId = params.streamId ?? randomUUID(); live = { client, sessionId };
      void client.output.pipeTo(new WritableStream({ write: message => send({ event: 'serverLog', sessionId, message }) })).catch(() => {});
      const video = await client.videoStream;
      live.video = video;
      video.sizeChanged(size => { void send({ event: 'videoSize', sessionId, ...size }); });
      void video.stream.pipeTo(new WritableStream({ write: packet => send({ event: 'video', sessionId, packet: packetJson(packet) }) })).then(() => { if (live?.sessionId === sessionId) { live = undefined; void send({ event: 'liveEnded', sessionId }); } }).catch(error => { if (live?.sessionId === sessionId) { live = undefined; void client.close(); void send({ event: 'error', sessionId, message: String(error) }); } });
      return { sessionId, width: video.width, height: video.height };
    }
    case 'stopLive': await stopLive(); return {};
    case 'startRecording': {
      const device = connected();
      if (recording) throw new Error('A recording is already active');
      const audio = params.audio ?? 'device';
      if (!['device','silent','mic'].includes(audio)) throw new Error('Direct USB currently supports device audio, phone microphone, or silent recording. Combined audio requires the established recording transport.');
      const outputPath = requireString(params.outputPath, 'outputPath');
      const bytes = new Uint8Array(await readFile(requireString(params.serverPath, 'serverPath')));
      const server = '/data/local/tmp/frame-tango-record-server.jar';
      await AdbScrcpyClient.pushServer(device, new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), server);
      const writer = new NativeMp4Recorder(outputPath, audio !== 'silent', params.maxFps ?? 60);
      let client;
      try {
        client = await AdbScrcpyClient.start(device, server, new AdbScrcpyOptions3_3_3({ scid: ScrcpyInstanceId.random(), videoCodec:'h264', videoCodecOptions:'max-bframes=0', maxSize:params.maxSize ?? 0, maxFps:params.maxFps ?? 60, videoBitRate:params.videoBitRate ?? 16000000, downsizeOnError:false, audio:audio !== 'silent', audioCodec:'aac', audioBitRate:192000, audioSource:audio === 'mic' ? 'mic' : 'output', showTouches:Boolean(params.showTouches), control:false, tunnelForward:true }));
        const current = { client, writer, outputPath, recordingId: randomUUID(), pumps: [], stopping:false, error:null };
        recording = current; lastRecordingError = null;
        void client.output.pipeTo(new WritableStream({ write: message => send({ event:'serverLog', recordingId:current.recordingId, message }) })).catch(() => {});
        const fail = error => { if (!current.stopping) { current.error = error instanceof Error ? error.message : String(error); void send({ event:'recordingError', recordingId:current.recordingId, message:current.error }); void stopRecording().catch(() => {}); } };
        const video = await client.videoStream;
        current.pumps.push(video.stream.pipeTo(new WritableStream({ write: packet => writer.add('video', packet) })).then(() => { if (!current.stopping) fail(new Error('Video capture ended unexpectedly')); }).catch(fail));
        if (audio !== 'silent') {
          const stream = await client.audioStream;
          if (!stream || stream.type !== 'success') throw new Error('Phone audio capture is unavailable; unlock the phone and retry or select silent recording');
          current.pumps.push(stream.stream.pipeTo(new WritableStream({ write: packet => writer.add('audio', packet) })).then(() => { if (!current.stopping) fail(new Error('Audio capture ended unexpectedly')); }).catch(fail));
        }
        return { recordingId:current.recordingId, outputPath };
      } catch (error) { if (recording?.client === client) { recording.stopping = true; recording = undefined; } await client?.close().catch(() => {}); writer.abort(); lastRecordingError = error instanceof Error ? error.message : String(error); throw error; }
    }
    case 'stopRecording': return stopRecording();
    case 'touch': {
      if (!live?.client.controller) throw new Error('Start live preview first');
      const action = { down: 0, up: 1, move: 2 }[params.action];
      if (action === undefined) throw new Error('Touch action must be down, move, or up');
      if (!Number.isFinite(params.x) || !Number.isFinite(params.y)) throw new Error('Touch coordinates must be finite');
      await live.client.controller.injectTouch({ action, pointerId: BigInt(params.pointerId ?? -1), pointerX: Math.round(params.x), pointerY: Math.round(params.y), videoWidth: live.video.width, videoHeight: live.video.height, pressure: action === 1 ? 0 : 1, actionButton: 0, buttons: 0 }); return {};
    }
    case 'key': {
      if (!live?.client.controller) throw new Error('Start live preview first');
      if (!Number.isInteger(params.keyCode)) throw new Error('keyCode must be an integer');
      for (const action of [0,1]) await live.client.controller.injectKeyCode({ action, keyCode: params.keyCode, repeat: 0, metaState: 0 }); return {};
    }
    case 'disconnect': await disconnect(); return {};
    case 'shutdown': await disconnect(); shutdown = true; return {};
    default: throw new Error(`Unknown method: ${method}`);
  }
}
// Single ordered command lane: USB ownership changes cannot race control or capture.
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  const deadline = setTimeout(() => process.exit(1), 3000);
  void disconnect().catch(() => {}).finally(() => { clearTimeout(deadline); process.exit(0); });
});
for await (const line of lines) {
  let request;
  try { request = parseRequest(line); await send({ id: request.id, result: await run(request.method, request.params) }); }
  catch (error) { await send({ id: request?.id ?? null, error: { code: 'TRANSPORT_ERROR', message: error instanceof Error ? error.message : String(error) } }); }
  if (shutdown) break;
}
await disconnect();
