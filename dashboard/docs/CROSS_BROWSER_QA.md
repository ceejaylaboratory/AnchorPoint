# Cross-Browser QA Plan

This document captures the browser coverage added for the dashboard and the manual checks used to validate the release readiness flow.

## Coverage Matrix

| Browser | Mode | Focus |
| --- | --- | --- |
| Chrome | Desktop | Primary interaction path, navigation, config fallback, tab switching |
| Firefox | Desktop | Layout stability, motion timing, form rendering, API fallback |
| Safari | Desktop | WebKit-specific rendering, sticky header behavior, responsive sidebar |

## Automated Smoke Test

Run the browser smoke suite from the `dashboard/` workspace:

```bash
npm run test:browser
```

The test:

1. Opens the dashboard in Chromium, Firefox, and WebKit.
2. Mocks the `/api/config/ui` request to verify graceful fallback handling.
3. Verifies the dashboard shell, sidebar, warning banner, and flow transitions render correctly.

## Manual QA Steps

If browsers are not available in CI or a local environment, use the following manual checklist:

1. Start the dashboard with `npm run dev` from `dashboard/`.
2. Open the app in Chrome, Firefox, and Safari.
3. Confirm the dashboard loads with the institutional dark theme applied.
4. Confirm the loading indicator resolves to either connected or fallback state.
5. Click `Deposit` and verify the SEP-24 flow shows asset selection, KYC requirements, and the completion state.
6. Click `Withdraw` and repeat the same flow checks.
7. Toggle the sidebar on a narrow viewport and confirm the menu opens and closes cleanly.
8. Visit `History`, `KYC Status`, and `Settings` and confirm content swaps without layout breakage.
9. Reload the page with the backend unavailable and confirm the fallback config banner appears instead of a blank screen.

## Acceptance Notes

- The dashboard now exposes stable selectors for browser automation.
- The UI handles backend config failure without crashing.
- Browser coverage is encoded in a repeatable test rather than a one-off manual pass.
