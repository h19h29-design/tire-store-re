# Homepage Design Handoff

Date: 2026-03-15

## What Is Already Done

- Public homepage route is split from the desktop app.
  - Web homepage: `/`
  - Desktop manager: `/app/*`
- Homepage quote flow is implemented.
  - Search by vehicle/model, size, brand
  - Estimate for 2 or 4 tires
  - Optional installation and alignment
  - Quote inquiry submission
- Public quote publishing flow is implemented.
  - Inventory items can be marked as public quote items
  - Each item can store a Naver Store URL
  - Desktop settings page can publish the quote feed manually
  - Desktop shell also has timed publish sync logic
- Small local quote API server is implemented.
  - `GET /quote-feed`
  - `POST /quote-feed/publish`
  - `POST /quote-inquiries`
- Local dev helper scripts are added.
  - `npm run dev:local`
  - `npm run dev:local:stop`

## Current Working State

- `npm run lint` passes
- `npm run build` passes
- Local homepage and quote API were both verified to respond
- If no published feed exists yet, local sample feed data is created automatically for testing

## Main Files

- Homepage UI:
  - `src/features/home/HomePage.tsx`
  - `src/features/home/HomePage.css`
- Web/Desktop routing:
  - `src/app/router.tsx`
  - `src/app/shell/AppShell.tsx`
- Public quote logic:
  - `src/features/publicQuote/quoteUtils.ts`
  - `src/features/publicQuote/publicQuoteApi.ts`
  - `src/features/publicQuote/publicQuotePublishingService.ts`
- Inventory public quote fields:
  - `src/features/inventory/InventoryPage.tsx`
  - `src/features/inventory/inventoryService.ts`
- Settings page for quote publishing:
  - `src/features/settings/SettingsPage.tsx`
  - `src/features/settings/settingsService.ts`
- Local quote API:
  - `server/quote-api-server.mjs`
- Local run scripts:
  - `scripts/dev-local.mjs`
  - `scripts/stop-local.mjs`

## Local Run Guide

1. Start local web stack:
   - `npm run dev:local`
2. Open:
   - Homepage: `http://127.0.0.1:5173`
   - Quote feed: `http://127.0.0.1:4174/quote-feed`
3. Stop local web stack:
   - `npm run dev:local:stop`

Notes:

- Local sample quote feed is written under `.quote-api-data/quote-feed.json`
- That folder is gitignored
- For real data publishing from the desktop app, use this publish endpoint:
  - `http://127.0.0.1:4174/quote-feed/publish`

## Known Gaps

- Homepage design is functional, but not yet polished
- Brand voice and final marketing copy are not finalized
- Real store phone, Kakao URL, business hours, and exact address still need real values
- Dev quote API is file-based and suitable for local/dev use, not final production hosting
- No visual QA pass has been done yet for desktop/mobile polish

## Next Work: Homepage Design

This is the next task to start from.

### Design Goal

Make the homepage feel like a real local tire shop landing page:

- trustworthy
- fast to understand
- easy to inquire
- clearly connected to Naver Smart Store
- better on mobile than the current utility-first layout

### Recommended Visual Direction

- Tone: warm, grounded, practical, local-service-first
- Color direction: cream / sand / charcoal / orange-rust accents
- Avoid generic SaaS look
- Keep it promotional, but not flashy or fake
- Make CTA visibility strong, especially on mobile

### Design Work Order

1. Refine homepage content hierarchy
   - Hero
   - Trust badges
   - Quote search
   - Why this shop
   - Process
   - Naver Smart Store bridge
   - Inquiry CTA/footer

2. Rewrite visible homepage copy
   - Shorter headline
   - Stronger local positioning
   - Easier "vehicle model only is enough to ask" messaging
   - More persuasive service/process wording

3. Redesign hero section
   - Strong headline
   - Supporting sentence
   - Primary CTA
   - Secondary CTAs for Naver Store / Kakao / phone
   - Visual card showing latest quote feed status

4. Polish quote section UI
   - Better spacing
   - Better card hierarchy
   - Stronger selected-state styling
   - Cleaner form grouping
   - More obvious final estimate panel

5. Add stronger trust section
   - Naver Store operation
   - Multi-brand consultation
   - Ilsan/Paju service area
   - "final stock and price confirmed after consultation" message in a calmer, more professional way

6. Improve mobile conversion UX
   - Sticky bottom CTA bar
   - Larger touch targets
   - Cleaner stacked sections
   - Quote result cards easier to scan on mobile

7. Finish footer/contact block
   - Store summary
   - Contact CTA
   - Naver Store link
   - Business info placeholders

8. Final visual QA
   - Desktop width
   - 390px mobile width
   - No broken spacing
   - No unreadable contrast

## First Step When User Says "Start"

Resume from:

`Next Work: Homepage Design -> 1. Refine homepage content hierarchy`

Then immediately start editing:

- `src/features/home/HomePage.tsx`
- `src/features/home/HomePage.css`

## Suggested First Design Pass

For the first pass, aim for:

- one strong hero redesign
- one refined quote section redesign
- one trust/process section polish
- one mobile sticky CTA

Do not expand backend/API scope in that pass.
