1. Files changed
- `src/features/sales/SalesPage.tsx`
- `parallel-work/wave-20260313-v13-hotfix/cli-2-sales-structure/RESULT.md`

2. User-visible change
- Removed the explanatory paragraph under the Quick Sale title so the page starts higher.
- Removed the extra helper paragraph above the sales workbench.
- Moved card, Naver, and cash inputs into the main sales form grid, placed the totals summary beside the payment difference and save action, and moved the optional memo below them so the main payment/save controls land earlier on a 1080p screen.
- Kept the customer lookup list in the normal page flow with no inner scroll container added from JSX.

3. Tests run
- `npm run lint` - passed
- `npm run build` - passed

4. Remaining risk
- Final 1080p fit still depends on real content height. Large customer-match lists or unusually large cart contents can still push the page longer because the lookup area intentionally stays in the main document flow.
