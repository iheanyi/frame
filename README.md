# Frame

A local Android capture and editing studio, powered by scrcpy and Tango ADB.

**Desktop** captures over USB or Wi-Fi. **Web** connects directly over WebUSB with no local bridge. Both keep your media on your computer and offer native-resolution originals, focus points, tap highlights, and a timeline editor.

Frame is early-stage software. macOS has been exercised with real phones; Windows/Linux builds and the experimental desktop Tango transport still need real-device validation. This repository does not contain a signed production release.

## Run desktop

Install Node.js 22.18+, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Install scrcpy, Android platform-tools, and FFmpeg for the default USB/Wi-Fi mode.

```sh
npm ci
npm run dev
```

On macOS, `brew install scrcpy ffmpeg` provides the capture tools. Choose another installed executable in Settings if needed. Connect a phone with USB debugging enabled and approve its authorization prompt. For Wi-Fi, pair/connect with Android wireless debugging first; connected devices appear in Frame.

## Run web

```sh
npm --prefix apps/web ci
npm run studio:dev
```

Open http://localhost:3001 in desktop Chrome or Edge. Enable Android USB debugging, connect by USB, then choose **Connect device**. Release the phone in other capture apps first. Ordinary browser pages cannot connect directly to wireless ADB, so Wi-Fi capture belongs to the desktop app.

The web app uses IndexedDB for local media. Download important takes before clearing site data. Clipboard, USB, and microphone permissions are controlled by the browser. Deployment requires HTTPS; localhost works for development. The public source has no dependency on a personal Sites project or account.

## Capture and edit

- Native screen-only PNG screenshots and video originals.
- Device audio, microphone options, or silent recording. Desktop uses the phone microphone; web uses the computer microphone.
- Local Library, original-image copying, and native video-file clipboard copying on desktop.
- Timeline scrubbing, focus/tap effects, resizing, deletion, and undo/redo.
- Optional canvas padding/backgrounds; choose **Screen only · Native** on desktop to export without them.
- Desktop exports with FFmpeg. Browser exports run locally in real time and require the tab to stay visible.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/`, `src-tauri/` | React/Tauri desktop app and native capture/export adapters |
| `apps/web/` | Standalone browser capture and editor |
| `packages/editor-core/` | Shared editing model and geometry |
| `transport/` | Experimental app-owned Tango USB helper |

`npm run editor:sync` updates the web copy of the shared core. `npm run editor:check` verifies it. The platform-specific renderers and storage remain separate.

```sh
npm run check
npm test
npm run editor:check
npm --prefix apps/web run test:editor
npm --prefix transport ci
npm --prefix transport test
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
npm run desktop:build
```

Desktop builds bundle an official Node runtime for the optional Tango helper; the preparation script downloads and verifies its checksum. Default capture tools and FFmpeg remain external dependencies. See [desktop details](docs/DESKTOP.md), [platform boundaries](docs/PLATFORMS.md), and [transport limitations](transport/README.md).

## License and acknowledgements

Frame's original code is licensed under [Apache-2.0](LICENSE). Built with [scrcpy](https://github.com/Genymobile/scrcpy), [Tango ADB](https://github.com/yume-chan/ya-webadb), Tauri, React, and shadcn/ui. Bundled upstream code retains its own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
