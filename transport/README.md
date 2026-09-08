# Frame direct USB transport (experimental)

An app-owned Node helper using Tango ADB and node-usb. It never invokes the host `adb` or `scrcpy` executables and opens no listening ports. Android USB debugging and phone approval are still required. Another app or host ADB process holding the USB interface prevents connection; this helper never kills those processes.

Requires Node 22.13+ and the native `usb` module for the target OS/architecture. Install with `npm ci` in this directory; run `node index.mjs`. Pass the **original scrcpy Android server 3.3.3** path to `startLive`. A 4.1 server is not compatible with these options. Native helper/runtime packaging and hardware validation are separate release requirements.

Stdin/stdout are JSON lines. Request `{ "id": 1, "method": "enumerate", "params": {} }`; response `{ "id": 1, "result": ... }` or `{ "id": 1, "error": { "code": "TRANSPORT_ERROR", "message": "..." } }`. Stdout is protocol-only. Video writes respect pipe backpressure.

Methods:

- `enumerate`: USB devices `{serial,name,connection:'usb'}[]`; does not open their interfaces.
- `connect`: `{serial,credentialDirectory}`. Persists an app-specific private key with mode 0600; authorization times out after 60 seconds.
- `shell`: `{command}` returns `{text,data}` (base64 bytes, combined stdout/stderr). Intended only for trusted native application commands, never webpage input.
- `screenshot`: returns `{data,mimeType:'image/png'}` of exact device PNG bytes.
- `startLive`: `{serverPath,streamId?,maxSize?:0,maxFps?:60,videoBitRate?:16000000}` returns `{sessionId,width,height}`. Initial dimensions can be unknown until codec configuration arrives. Video uses original dimensions when maxSize is zero.
- `stopLive`: stops only this helper's preview.
- `startRecording`: `{serverPath,outputPath,audio:'device'|'mic'|'silent',maxSize?:0,maxFps?:60,videoBitRate?:16000000,showTouches?:false}` returns `{recordingId,outputPath}`. Uses a separate scrcpy session on the same direct connection; preserves encoded H.264 and AAC packets and shared source timestamps. `mic` is the phone microphone. Existing paths are never overwritten.
- `stopRecording`: finalizes the file and returns `{outputPath,width,height,duration,bytes}`. Unexpected capture failures report an actionable error and attempt to preserve the partial file.
- `getState`: returns `{connected,live,recording,lastRecordingError}`; recording is `{recordingId,outputPath}` or null.
- `touch`: `{action:'down'|'move'|'up',x,y,pointerId?}` in video pixel coordinates.
- `key`: `{keyCode}` sends Android key down and up.
- `disconnect`: closes this helper's streams and USB connection.
- `shutdown`: disconnects and exits after responding. Closing stdin also disconnects.

Events: `video` carries `{sessionId,packet:{type:'configuration'|'data',data:<base64>,pts?:<decimal string>,keyframe?:boolean}}`; `videoSize` carries `{sessionId,width,height}`. Other events are `status`, `serverLog`, `liveEnded`, `disconnected`, and `error`. Responses and asynchronous events may interleave. Register the caller-provided streamId before starting live capture.

The recorder writes fragmented MP4 to disk as chunks arrive, with native video dimensions and AAC-LC mono/stereo. It buffers only initial configuration plus the muxer's pending fragment. Fragmented MP4 preserves initial audio/video timing differences and supports long takes without retaining all media in RAM. An orientation change ends the take with an explicit error; no silent resolution reduction. Combined device+microphone audio and Wi-Fi remain on the established transport. Never silently reconnect through host ADB while direct USB owns the phone.

`npm test` verifies protocol framing, byte/timestamp preservation, credential persistence/permissions, and CLI failure/cleanup without opening a physical phone. When FFmpeg/ffprobe are installed, it also generates synthetic H.264/AAC fixtures and independently verifies decoded moving pixels, non-silent audio, resolution, and a 100ms source timing offset in both directions. Synthetic tests are not evidence of actual phone recording. Real USB preview, recording and controls remain to be tested in a coordinated exclusive-access window.
