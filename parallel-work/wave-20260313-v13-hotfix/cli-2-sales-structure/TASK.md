# CLI 2: Sales Structure / Markup Hotfix

## Goal

Reduce the vertical footprint of Quick Sale by changing the markup and content order, without editing CSS.

## User Requests To Cover

1. Quick Sale is still clipped on a 1080p screen.
2. The extra explanatory paragraph near the top should be removed so the UI moves upward.
3. The customer lookup area should behave like the older style and should not be redesigned into an inner scroll box.

## Allowed Files

- `src/features/sales/SalesPage.tsx`

## Do Not Touch

- `src/App.css`
- `src/features/dashboard/*`
- `src/features/settings/*`

## Required Work

1. Read the current `SalesPage.tsx` layout.
2. Remove or sharply reduce the tall explanatory text near the page title.
3. Reorder and tighten the right-side sales form structure so payment inputs and the save action land higher on the page.
4. Keep the JSX compatible with the existing CSS worker scope.
5. Write the result into `RESULT.md`.

## Required Tests

- `npm run lint`
- `npm run build`
