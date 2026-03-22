# RESULT

1. Files changed
- `src/features/dashboard/DashboardPage.tsx`
- `src/features/dashboard/dashboardService.ts`
- `src/lib/desktop.ts`
- `src/lib/types.ts`
- `src-tauri/src/commands.rs`

2. Root cause summary
- The real user DB at `C:\Users\h19h2\AppData\Roaming\com.tirestore.desktop\tire-store.db` now answers the dashboard SQL set cleanly, so the remaining failure looked like a first-load/runtime timing issue rather than bad live rows.
- Dashboard schema prep was still lazy in the frontend, and `dashboardSchemaPromise` never reset after a rejection. A single first-load failure could therefore poison every later dashboard fetch for that app session.
- The page also treated optional sub-loads (`get_runtime_info`, import/backup lookup, expense history, expense draft) as fatal or banner-worthy, so one auxiliary miss could keep the top error state visible even when the main dashboard data was otherwise usable.
- Fix: move dashboard table prep into runtime startup on the Rust side, cache/retry `ensureRuntimeReady()` on the frontend, make dashboard schema prep retryable, and recover optional dashboard sections with safe defaults instead of collapsing the whole page.

3. User-visible change
- The dashboard no longer depends on first-render lazy migration work to create `daily_expenses`; runtime startup prepares that before the page loads.
- If a non-core dashboard request fails, the page now keeps rendering the main dashboard and shows a softer partial-load status instead of the persistent "dashboard information could not be loaded" banner.
- If the daily expense fetch misses, the expense form falls back to an empty draft for the selected date instead of flipping the whole dashboard into an error state.

4. Tests run
- Real DB verification: inspected schema and replayed the dashboard query set directly against `C:\Users\h19h2\AppData\Roaming\com.tirestore.desktop\tire-store.db` (`items=373`, `customers=3958`, `sales=4622`; dashboard summary/breakdown/history queries returned without SQL errors).
- `npm run lint` ✅
- `npm run build` ✅
- `cargo test` ✅

5. Remaining risk
- I did not capture the installed app UI banner live after the code change, so the remaining uncertainty is around release-only WebView timing rather than SQL correctness or build/test regressions.
- `get_runtime_info` is still loaded separately from the dashboard analytics path; it is now non-fatal for the page, but if that command itself fails the runtime info card can still show blanks.
