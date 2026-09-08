# Third-party notices

Frame's Apache-2.0 license applies to its original application code. Dependencies and bundled upstream components retain their own licenses.

- **scrcpy** — Copyright Genymobile and contributors, Apache-2.0. Original Android servers 4.1 and 3.3.3 are included unchanged. Source: https://github.com/Genymobile/scrcpy. Full license: `src-tauri/resources/SCRCPY-LICENSE` and `apps/web/public/scrcpy-LICENSE.txt`.
- **Tango ADB / ya-webadb** — Copyright yume-chan and contributors, MIT. Source: https://github.com/yume-chan/ya-webadb. Installed via npm; license files remain in dependency packages.
- **Node.js** — Distributed under its included license and third-party notices. Desktop packaging downloads an official binary with checksum verification and includes its `LICENSE`. Node is not committed to this repository.
- **node-usb** — Installed as the `usb` npm package; its license and native dependency notices accompany the packaged helper.
- **MP4 muxer** — Installed as `mp4-muxer`; its package license accompanies the helper.
- **Mediabunny** — MPL-2.0. Browser media decoding, encoding, and WebM muxing. Source: https://github.com/Vanilagy/mediabunny. Used unchanged as an npm dependency; its license remains in the package.
- **React, Tauri, shadcn/ui, Base UI, Heroicons, Lucide, and Inter** — Installed dependencies retain their package licenses. Consult the committed npm/Cargo lockfiles for exact dependency versions.

FFmpeg, adb, and the desktop scrcpy executable are detected external tools rather than source files in this repository. Distributors who bundle additional executables must retain their applicable licenses and notices.
