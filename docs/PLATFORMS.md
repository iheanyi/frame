# Frame platform boundaries

Frame desktop is the full capture application. Frame web is the install-free USB studio. Media stays on the user's computer in both.

| Capability | Desktop | Web |
| --- | --- | --- |
| USB capture | Existing ADB or opt-in app-owned Tango USB | Tango WebUSB |
| Wi-Fi capture | Existing ADB connection to paired phone | Not offered; ordinary browser pages cannot open ADB TCP sockets |
| Recording storage | Native Movies/Frame files | IndexedDB, then user-initiated download |
| Original image clipboard | Native image clipboard | Browser PNG Clipboard API |
| Video file clipboard | Native OS file list | Download; no promise of native file-list clipboard |
| Export | Native FFmpeg | Local browser encoder |

The browser has no ADB bridge dependency and hosts application assets only. ADB mode remains the desktop default so USB and Wi-Fi devices continue to appear together. Direct USB is experimental and exclusive: another program holding the USB interface must release it first. Frame must never kill the user's shared ADB server to switch transports.

## Shared editing core

`packages/editor-core/index.ts` is the canonical platform-independent editing model and temporal/crop math. Desktop imports it directly. The standalone Sites project contains a generated copy at `lib/editor-core.ts` so deployment does not depend on paths outside its archive.

After changing the core:

```
node scripts/sync-editor-core.mjs --web=/path/to/frame-browser-poc
node scripts/sync-editor-core.mjs --web=/path/to/frame-browser-poc --check
```

The checksum check must pass before browser deployment. Capture, storage, clipboard, and encoders remain platform adapters. The desktop shell must not be replaced when sharing editor components.

## Desktop direct USB packaging

`npm run transport:prepare` installs the helper dependencies if needed, verifies an official Node archive checksum, and copies the runtime and helper into Tauri resources. It runs before desktop builds. Native dependencies must be built/tested on each target operating system; an Apple Silicon build is not Windows or Linux validation.

Direct USB supports screen-only screenshots and H.264/AAC recording. Its transport and muxer have automated coverage; real-device acceptance is tracked separately. Combined device/microphone capture, system touch indicators, and the separate native Mirror window remain ADB-mode capabilities.
