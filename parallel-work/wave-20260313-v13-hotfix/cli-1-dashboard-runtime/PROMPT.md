You are working in `C:\gpt\01project\tire-store-re`.

Read these first:
- `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\README.md`
- `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-1-dashboard-runtime\TASK.md`

Your role is the dashboard/runtime worker.

Mission:
- Reproduce the dashboard load error against the real user DB at:
  `C:\Users\h19h2\AppData\Roaming\com.tirestore.desktop\tire-store.db`
- Fix the root cause.
- Keep the edit scope limited to:
  - `src/features/dashboard/*`
  - `src/app/shell/AppShell.tsx`
  - `src/lib/desktop.ts`
  - `src/lib/types.ts`
  - `src-tauri/src/commands.rs`

Important hints:
- The user still sees the error banner after the last v1.3 round.
- The screenshot suggests the page shell renders, but one or more data loads still fail.
- Check for startup timing problems between app runtime preparation and the first dashboard fetch.
- Check for older DB schema cases and failure handling in dashboard data loading.

Do not edit:
- `src/features/sales/*`
- `src/App.css`
- `src/features/settings/*`

Required output:
1. Make the fix.
2. Run:
   - `npm run lint`
   - `npm run build`
   - `cargo test`
3. Write the final summary into:
   `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-1-dashboard-runtime\RESULT.md`

`RESULT.md` format:
1. Files changed
2. Root cause summary
3. User-visible change
4. Tests run
5. Remaining risk
