1. Files changed
- `src/App.css`

2. User-visible change
- Tightened Quick Sale spacing in the right-side workbench so the customer form, payment section, and save button have a better chance to fit on a 1080p screen without extra page scrolling.
- Removed the lookup-area inner scroll behavior by keeping the customer match list unconstrained and visible in normal page flow, while also making the lookup cards denser so more matches fit before pushing the form down.

3. Tests run
- `npm run lint` - passed
- `npm run build` - passed

4. Remaining risk
- Because the lookup list now grows in normal flow, an unusually large number of customer matches can still extend the Quick Sale page vertically; this is expected tradeoff for removing the nested scroll box.
- This was verified by static build/lint only, not by an interactive screen-height check against the live desktop window.
