# Frame web

The browser-only USB capture and editing studio. Run `npm ci` then `npm run dev -- --port 3001` here, or use `npm run studio:dev` from the repository root after installing dependencies.

Requires desktop Chrome/Edge with WebUSB and WebCodecs. All captures and edits stay local. Ordinary websites cannot access ADB over TCP; use Frame desktop for Wi-Fi capture. See the root README for platform differences and limitations.

Device audio capture redirects sound away from the phone while connected. Enable **Monitor device audio** to hear it through the computer; this does not change recording volume. The input meter shows incoming sound even with monitoring off. Use headphones if also recording the computer microphone. Disconnect releases phone audio capture; stopping a recording keeps the preview connection active.
