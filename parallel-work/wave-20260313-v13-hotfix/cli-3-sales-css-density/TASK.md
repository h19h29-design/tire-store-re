# CLI 3: Sales CSS Density / Lookup Display

## Goal

Compress the Quick Sale CSS so the screen fits better on 1080p, while removing the inner scroll behavior from the customer lookup area.

## User Requests To Cover

1. Quick Sale still does not fit comfortably on one screen.
2. The customer lookup area should show as many items as possible without an inner scroll box.
3. Keep the left-side inventory list functional, but prioritize the right-side sales form fitting on screen.

## Allowed Files

- `src/App.css`

## Do Not Touch

- `src/features/sales/SalesPage.tsx`
- `src/features/dashboard/*`
- `src/features/settings/*`

## Required Work

1. Reduce vertical spacing only where it affects Quick Sale.
2. Remove the inner scroll behavior from the customer lookup list.
3. Improve the chance that payment inputs and the save action are visible at 1080p.
4. Avoid unrelated styling drift in dashboard or settings.
5. Write the result into `RESULT.md`.

## Required Tests

- `npm run lint`
- `npm run build`
