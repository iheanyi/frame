# Frame

A small desktop capture studio for Android, powered by **scrcpy**, built with **Tauri 2, Rust, React, and TypeScript**.

## Use

Open **Frame.app** on macOS (build output: `src-tauri/target/release/bundle/macos/Frame.app`). Connect an Android phone, enable USB debugging, approve the phone's authorization prompt, and choose it in Studio.

- **Record screen** records H.264 video while the embedded live preview stays interactive. **Finish recording** finalizes an MP4 in your Movies/Videos → Frame folder and opens it in the editor.
- **Native resolution** is the recording default. Frame reads the phone display size and disables scrcpy's automatic downscaling on encoder errors for this mode. A lower-resolution live preview does not reduce the recording resolution. Styled exports use the selected output canvas size.
- **Screenshot** saves a full-resolution PNG of only the Android screen, without borders or backgrounds. **Copy screen** takes the same native-resolution screenshot and places it on the clipboard without saving a library file, ready to paste into other apps. Library → **Copy image** copies native-resolution pixels of a saved screenshot; **Save original** writes an unchanged copy to a location you choose. **Select files → Copy files** copies a real OS file list for apps that accept pasted files.
- **Mirror** opens the interactive device window without recording.
- **Audio source** offers device audio, the Android microphone, both mixed together, or silence. The microphone is the **phone's microphone**, not the computer's. Audio requires Android 11+, and a requested audio source failing stops capture rather than silently producing a silent demo. Both mode uses a second scrcpy audio session and mixes it into the exported MP4. Audio playback is muted in microphone modes to avoid feedback. Both sources start independently; this is suitable for narration, not sample-accurate multi-track production.
- **Library** starts in **Original** preview: only the saved screen. **Styled export** is a separate mode for optional padding, backgrounds, and emphasis. The library uses a canvas-first editor with a right-hand composition inspector and focus/tap timeline below the preview. It plays originals with a portrait-first composition, preview magnification, background, canvas ratio, padding, and trim. Add manual focus points for smooth punch-ins and tap highlights on the timeline. Edits save alongside the original; export writes a new PNG or H.264/AAC MP4.
- **Cmd/Ctrl + Shift + R** starts/finishes recording, **Cmd/Ctrl + Shift + S** takes a screenshot, and **Cmd/Ctrl + Shift + C** copies the screen to the clipboard while the studio is focused.

Original MKV recordings and separate microphone takes remain on disk for recovery. Successfully finalized recordings appear once in the library. Quitting Frame stops its children and attempts finalization. No account, server, or cloud upload is involved.

## Tools

This first build uses **installed desktop tools** and bundles the original scrcpy 4.1 Android server for the embedded preview. Frame detects PATH, Homebrew, Android Studio platform-tools, and common SDK/Scoop locations. Settings → Browse can select executables from extracted official downloads; no terminal commands are needed to operate Frame.

- [scrcpy official releases](https://github.com/Genymobile/scrcpy/releases) — use the platform's complete package so scrcpy-server and shared libraries remain with the executable.
- [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools) — provides adb. The Windows scrcpy release also includes it.
- [FFmpeg downloads](https://ffmpeg.org/download.html) — used for MP4 finalization, previews, and styled exports.

For developers on macOS, `brew install scrcpy ffmpeg` is a convenient setup. Frame also checks Android Studio's installed adb. On Linux, install scrcpy, adb, and FFmpeg through your distribution. On Windows, extract the official scrcpy package and an FFmpeg build, then choose the executables in Settings if they aren't on PATH.

The app source supports macOS, Windows, and Linux; the local delivery was built on Apple Silicon macOS. Windows/Linux packaging is defined in CI and still requires runs on those operating systems. Distribution signing/notarization and bundled tool installation are not configured.

## Develop

Install [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), Node.js 22.18+ and Rust, then:

```sh
npm install
npm run dev
```

`npm run dev` starts both Vite and the actual native app. `npm run web:dev` is a browser-only UI preview: it does not pretend to connect to a phone.

```sh
npm run check
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:build
```

Use `npm run tauri build -- --bundles app` for a macOS app without creating a DMG. CI uploads platform installers as workflow artifacts.

## Architecture and current boundaries

Rust owns child processes, executable discovery, device targeting, capture files, export validation, and graceful shutdown. The webview receives a small typed command surface, not unrestricted shell or file access. All subprocess arguments are passed as arguments, not interpreted by a shell. Media access is restricted to Frame's capture directory.

The studio receives H.264 packets over ADB and decodes them with WebCodecs in the app, targeting up to 60 fps at a 1600-pixel maximum dimension. Click and drag the preview to control Android. Systems without WebCodecs can use the separate Mirror window. Actual frame rate depends on the phone and system webview. The new embedded preview and timeline require hardware validation before release.

Focus points and tap markers are editable effects, not an automatic action detector or multitrack editor. Computer microphone input and a floating system-wide toolbar are not implemented. Embedded-preview clicks made while recording are saved as editable tap markers; physical phone touches are not automatically added to the timeline.

Audio output capture can be restricted by Android/apps. Device disconnection is reported, with recoverable originals retained. scrcpy's `--show-touches` temporarily changes the Android touch indicator setting and normally restores it on exit. On Windows, child termination preserves Matroska recording data before FFmpeg finalization; test on hardware before distributing a Windows build.

The bundled scrcpy 4.1 server is from the installed official Homebrew scrcpy package; SHA-256: `deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae`. Its Apache-2.0 license is included in `src-tauri/resources/SCRCPY-LICENSE`.

## Credits

[scrcpy](https://github.com/Genymobile/scrcpy) by Genymobile (Apache-2.0), [Tauri](https://tauri.app) (MIT/Apache-2.0), [React](https://react.dev) (MIT), [Heroicons](https://heroicons.com) (MIT), and [Inter](https://rsms.me/inter/) (SIL OFL). FFmpeg is an external dependency, with licensing determined by the installed build. Frame is an independent project and is not affiliated with these projects, CleanShot, or Screen Studio.
