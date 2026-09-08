# Contributing

Start with the setup and checks in the README. Keep platform adapters separate from the shared editor core. Update the generated web core with `npm run editor:sync` and verify with `npm run editor:check`.

For capture changes, report the actual browser/OS, phone, resolution, audio mode, and transport tested. Build or muxer tests alone do not establish working hardware capture. Preserve originals and avoid taking over a USB device being used by another application. Do not kill a shared ADB server to make a test pass.

Do not commit recordings, personal screenshots, signing keys, Android authorization keys, environment files, or local hosting configuration. Use synthetic fixtures for automated media tests.
