You are working in `C:\gpt\01project\tire-store-re`.

Read these first:
- `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\README.md`
- `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-3-sales-css-density\TASK.md`

Your role is the Quick Sale CSS worker.

Mission:
- Improve Quick Sale screen density from CSS only.
- Help the right-side form fit better on a 1080p display.
- Remove the inner scroll behavior from the customer lookup area and let it show naturally in page flow.

Allowed file:
- `src/App.css`

Do not edit:
- `src/features/sales/SalesPage.tsx`
- `src/features/dashboard/*`
- `src/features/settings/*`

Important notes:
- There was a previous CSS change that introduced an inner scroll box for the lookup list. Undo that direction.
- Keep the fix targeted to Quick Sale styles as much as possible.

Required output:
1. Make the CSS fix in `src/App.css`.
2. Run:
   - `npm run lint`
   - `npm run build`
3. Write the final summary into:
   `C:\gpt\01project\tire-store-re\parallel-work\wave-20260313-v13-hotfix\cli-3-sales-css-density\RESULT.md`

`RESULT.md` format:
1. Files changed
2. User-visible change
3. Tests run
4. Remaining risk
