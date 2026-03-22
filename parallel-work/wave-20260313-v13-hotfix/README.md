# Wave 2026-03-13 v1.3 Hotfix

This wave is for the remaining v1.3 issues that are still visible in the user's screenshots.

## Target Issues

1. Dashboard still shows the load error banner on the real user database.
2. Quick Sale is still too tall on a 1080p screen. The payment area and save action should fit without page scrolling.
3. The customer lookup area in Quick Sale must not use an inner scroll box. Show as many matches as possible in the main page flow, like the earlier behavior.

## Shared Context

- Workspace: `C:\gpt\01project\tire-store-re`
- Real user DB: `C:\Users\h19h2\AppData\Roaming\com.tirestore.desktop\tire-store.db`
- Known sales counts in the real DB:
  - 2024: 812
  - 2025: 3716
  - 2026: 94
- The user wants the final merge handled back on the main thread after each CLI writes its own result file.

## Role Split

- `cli-1-dashboard-runtime`
  - Reproduce and fix the dashboard load error on the real DB.
  - Stay inside dashboard/runtime files only.

- `cli-2-sales-structure`
  - Trim the Quick Sale JSX structure.
  - Remove the extra explanatory text block and move the high-priority controls higher.
  - Do not edit CSS.

- `cli-3-sales-css-density`
  - Tighten the Quick Sale CSS so the screen fits better at 1080p.
  - Remove the inner scroll behavior from the customer lookup area.
  - Do not edit `SalesPage.tsx`.

- `cli-4-repro-validation`
  - Reproduce the current issues and keep verification notes.
  - Do not change product code unless a tiny helper note is needed under this wave folder.

## File Ownership

- `cli-1-dashboard-runtime`
  - Allowed:
    - `src/features/dashboard/*`
    - `src/app/shell/AppShell.tsx`
    - `src/lib/desktop.ts`
    - `src/lib/types.ts`
    - `src-tauri/src/commands.rs`
  - Do not touch:
    - `src/features/sales/*`
    - `src/App.css`
    - `src/features/settings/*`

- `cli-2-sales-structure`
  - Allowed:
    - `src/features/sales/SalesPage.tsx`
  - Do not touch:
    - `src/App.css`
    - `src/features/dashboard/*`
    - `src/features/settings/*`

- `cli-3-sales-css-density`
  - Allowed:
    - `src/App.css`
  - Do not touch:
    - `src/features/sales/SalesPage.tsx`
    - `src/features/dashboard/*`
    - `src/features/settings/*`

- `cli-4-repro-validation`
  - Allowed:
    - `parallel-work\wave-20260313-v13-hotfix\cli-4-repro-validation\*`
  - Do not touch:
    - product code by default

## Required Output From Each CLI

Each CLI must write its result into its own `RESULT.md` with:

1. Files changed
2. Root cause or intent summary
3. User-visible change
4. Tests run and results
5. Remaining risk

## Required Tests

- Dashboard worker:
  - `npm run lint`
  - `npm run build`
  - `cargo test`
  - Real DB reproduction notes

- Sales structure worker:
  - `npm run lint`
  - `npm run build`

- Sales CSS worker:
  - `npm run lint`
  - `npm run build`

- Validation worker:
  - Repro notes first
  - Re-run shared verification after code workers finish when practical

## Merge Order

1. `cli-1-dashboard-runtime`
2. `cli-2-sales-structure`
3. `cli-3-sales-css-density`
4. `cli-4-repro-validation`
5. Main integrator thread performs final merge and full verification:
   - `npm run lint`
   - `npm run build`
   - `cargo test`
   - `npm run tauri:build`
