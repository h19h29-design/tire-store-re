1. Reproduction notes
- Runtime used: `npm run tauri:dev` against `C:\Users\h19h2\AppData\Roaming\com.tirestore.desktop\tire-store.db`, with the app window forced to a 1920x1080 desktop-sized viewport. Captures saved under this folder:
  `dashboard-1920x1080.png`, `sales-cart-one-item.png`, `sales-lookup-panel.png`.
- Dashboard issue still reproduces on the real DB. On first load, the dashboard shows the load-error banner while the visible summary cards stay at zero values. This is visible in `dashboard-1920x1080.png`.
- Quick Sale still feels vertically tight at 1080p once the right side is in a realistic state. Repro path:
  1. Open `Quick Sale`.
  2. Search `145 13 8 DU05`.
  3. Add the single visible `DU05 / 145 13 8` item to the cart.
  4. Enter plate prefix `15` in the plate field to open customer lookup.
  Observation: the page gets a global vertical scrollbar and the memo area drops below the fold. The payment block and save button remain barely visible, but the page still feels clipped/tight in this state. This is visible in `sales-lookup-panel.png`.
- Customer lookup behavior in the current workspace is inline page flow, not an inner scroll box. The `15` plate-prefix repro shows eight lookup cards expanding directly inside the form area. That matches the requested target behavior and should be preserved during merge.

2. Real DB confirmation
- DB path confirmed: `C:\Users\h19h2\AppData\Roaming\com.tirestore.desktop\tire-store.db`
- Sales counts confirmed from the real DB:
  - `2024`: `812`
  - `2025`: `3716`
  - `2026`: `94`
- Latest import row:
  - `source_file`: points to the user's sales workbook under `C:\Users\h19h2\Downloads`
  - `imported_at`: `2026-03-13 10:07:49`
  - `note`: `sales=94, unmatched_tire_lines=1667, validation_issues=0`
- `backups` table currently has `0` rows.
- `daily_expenses` has a real row for `2026-03-13`: `amount=5000`, `note=aasas`, `updated_at=2026-03-13 09:35:44`.
- Plate-prefix breadth used for the lookup repro is real: `normalized_plate_number LIKE '%15%'` matches `262` vehicles in the DB, while the UI lookup caps the visible list at `8`.

3. Tests run
- `npm run lint` - passed
- `npm run build` - passed
- `cargo test` - passed (`11` tests)
- `cargo test` warnings only:
  - `src/commands.rs`: dead-code warning for `CustomerSeedRecord.row_number`
  - `src/db.rs`: unused `DB_URL`
  - `src/db.rs`: unused `migrations`

4. Final merge checklist notes
- Dashboard error banner is still visible in the current pre-merge runtime capture. Recheck the default dashboard route against the real DB after `cli-1-dashboard-runtime` is merged.
- Quick Sale is still vertically tight on a 1080p screen when cart content and customer lookup are both visible. Recheck that the payment inputs, diff line, and save action stay on-screen without needing page scroll after `cli-2` and `cli-3` are combined.
- Customer lookup is currently inline and not using an inner scroll region in this workspace. Preserve that behavior in the final merge.
- Shared verification completed on this workspace: `npm run lint`, `npm run build`, and `cargo test` all passed.
- `npm run tauri:build` was not run in this lane; that remains part of the integrator's final full verification.
