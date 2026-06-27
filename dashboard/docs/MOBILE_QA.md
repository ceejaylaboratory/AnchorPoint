# Dashboard Mobile Responsiveness QA

This file documents the mobile responsive behavior and manual QA steps for the dashboard UI.

## What changed

- Sidebar is collapsed by default on screens narrower than 1024px.
- Header and main content now use responsive horizontal padding (`px-4 sm:px-6 lg:px-8`).
- Core content cards use smaller default padding on mobile (`p-6 sm:p-8`).
- Branding color panels now stack on narrow widths using `grid-cols-1 sm:grid-cols-2`.

## Manual QA Steps

1. Start the dashboard app:

```bash
cd dashboard
npm install
npm run dev
```

2. Open the dashboard in a browser.
3. Resize the browser window or open the browser devtools responsive mode.
4. Verify the following behaviors:
   - The sidebar should start hidden on mobile widths and be toggled by the menu button.
   - The top header should maintain appropriate padding and not overflow horizontally.
   - The main dashboard content should remain centered and readable without horizontal scrolling.
   - The branding color cards should stack vertically on narrow screens.
   - All action buttons, charts, and tables should remain visible and usable on mobile screen widths.

## Notes

- The dashboard uses Tailwind responsive utilities and CSS custom properties for consistent theming.
- The sidebar toggle is now controlled by a `matchMedia` listener to keep behavior consistent across viewport resizing.
