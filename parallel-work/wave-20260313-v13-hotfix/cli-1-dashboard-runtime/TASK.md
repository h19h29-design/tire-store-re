# CLI 1: Dashboard Runtime / Error Fix

## Goal

Reproduce and fix the dashboard load failure that still appears on the real user DB.

## Symptom

- The dashboard shows the Korean error banner that says the dashboard information could not be loaded.
- The screenshot suggests some widgets may still render zeros while one or more API calls fail in the background.

## Real DB

- `C:\Users\h19h2\AppData\Roaming\com.tirestore.desktop\tire-store.db`

## Allowed Files

- `src/features/dashboard/*`
- `src/app/shell/AppShell.tsx`
- `src/lib/desktop.ts`
- `src/lib/types.ts`
- `src-tauri/src/commands.rs`

## Do Not Touch

- `src/features/sales/*`
- `src/App.css`
- `src/features/settings/*`

## Required Work

1. Reproduce the failure against the real DB.
2. Identify the failing query, command, startup race, or schema mismatch.
3. Fix it so the dashboard loads cleanly on the real DB.
4. If one dashboard sub-call fails, improve resilience when reasonable so the whole page does not fall over.
5. Write the result into `RESULT.md`.

## Required Tests

- `npm run lint`
- `npm run build`
- `cargo test`
- Record the real DB repro notes
