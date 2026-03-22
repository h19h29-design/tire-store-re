You are working in `C:\gpt\01project\tire-store-re`.

Read these first:
- `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\README.md`
- `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-2-sales-structure\TASK.md`

Your role is the Quick Sale structure worker.

Mission:
- Fix the tall Quick Sale layout from the JSX side only.
- Remove the extra explanatory paragraph under the Quick Sale title so the screen starts higher.
- Reorder or condense the right-side structure so payment inputs and the save action fit better on a 1080p screen.

Allowed file:
- `src/features/sales/SalesPage.tsx`

Do not edit:
- `src/App.css`
- `src/features/dashboard/*`
- `src/features/settings/*`

Important notes:
- The user explicitly said the customer lookup area should not become an inner scroll region.
- Keep your changes structural and content-focused, not style-focused.

Required output:
1. Make the structure fix in `SalesPage.tsx`.
2. Run:
   - `npm run lint`
   - `npm run build`
3. Write the final summary into:
   `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-2-sales-structure\RESULT.md`

`RESULT.md` format:
1. Files changed
2. User-visible change
3. Tests run
4. Remaining risk
