# Merge Checklist

Use this after the worker CLIs finish.

1. Read every `RESULT.md` first.
2. Confirm each worker stayed inside its allowed file set.
3. Confirm the dashboard fix was reproduced against the real DB path:
   - `C:\Users\h19h2\AppData\Roaming\com.tirestore.desktop\tire-store.db`
4. Confirm Quick Sale changes cover all three user asks:
   - the extra explanatory paragraph is removed or reduced enough to move the UI up
   - payment area and save action fit better on 1080p
   - customer lookup does not use an inner scroll box
5. Re-run shared verification:
   - `npm run lint`
   - `npm run build`
   - `cargo test`
   - `npm run tauri:build`
6. If packaging succeeds, continue with installer copy and changelog update on the main thread.
