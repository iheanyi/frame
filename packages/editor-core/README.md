# Frame editor core

`index.ts` is the canonical, dependency-free TypeScript model for source-time
focus points, gesture annotations, retained segments, snapping, focus duration
bounds, and smooth crop geometry. Desktop imports it directly. Web receives a
generated copy so Sites builds never depend on files outside the site archive.

After changing the core, run:

```sh
node scripts/sync-editor-core.mjs --web=/path/to/frame-browser-poc
node scripts/sync-editor-core.mjs --web=/path/to/frame-browser-poc --check
npm test
```

The generated module records the canonical SHA-256. `--check` compares the whole
generated file with the canonical module, and must pass before deploying changes.
Platform-specific canvases, React layouts, FFmpeg/browser encoders, persistence,
and USB/Wi-Fi transport remain separate. Sharing math does not imply those paths
have identical capabilities: desktop currently draws only basic tap annotations.
