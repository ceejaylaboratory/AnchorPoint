# Issue 607 Implementation Notes

## Scope

Issue: `[Dashboard] Audit Color Contrast Ratio for Accessibility Compliance`

This change is limited to the dashboard accessibility surface. It updates the dashboard theme tokens, rendered Tailwind classes, and Vite type declaration needed to validate the dashboard build. No backend, contract, database, lockfile, or SQLite changes are part of this implementation.

## Files Changed

| File | Purpose |
| --- | --- |
| `dashboard/src/App.tsx` | Adds accessible brand-color derivation and replaces low-contrast UI classes. |
| `dashboard/src/index.css` | Updates default theme tokens and reusable component styles to use higher-contrast colors. |
| `dashboard/tailwind.config.js` | Exposes `primary-text` and `accent-text` CSS variables to Tailwind utilities. |
| `dashboard/src/vite-env.d.ts` | Adds the standard Vite client type declaration required for `import.meta.env` during `tsc`. |

## Accessibility Standard

The audit uses WCAG contrast expectations:

| Surface | Minimum Ratio |
| --- | ---: |
| Normal text | 4.5:1 |
| Large text | 3:1 |
| Icons and graphical UI controls | 3:1 |

The dashboard has a dark base surface, so the primary failures were muted text using `text-slate-500`, thin `slate-800` borders used as control boundaries, and brand-colored text that could be supplied dynamically by backend configuration.

## Design Decisions

### Static Theme Tokens

The default primary color was changed from `#3b82f6` to `#2563eb` because white text on `#3b82f6` does not meet the 4.5:1 normal-text threshold. `#2563eb` preserves the same blue visual identity while increasing white-on-primary contrast to approximately `5.17:1`.

The default accent color was changed from purple to teal (`#0f766e`) and paired with `--accent-text: #5eead4`. This keeps the palette from relying on a low-contrast purple-blue family and gives accent text a high-contrast token on the dark surface.

`--primary-text` and `--accent-text` were introduced because the same brand color cannot safely serve every role. A color that works as a button background may not work as text on the page, so text/icon usages now consume dedicated accessible text tokens.

### Dynamic Backend Theme Colors

The dashboard accepts `primaryColor` and `accentColor` from backend UI configuration. Static CSS cannot guarantee accessibility when those values are dynamic, so `App.tsx` derives safe CSS variables at render time:

| Helper | Logic |
| --- | --- |
| `hexToRgb` | Parses 3-digit and 6-digit hex colors into RGB channels. Invalid values return `null` so the rest of the calculation remains deterministic. |
| `relativeLuminance` | Implements the WCAG relative luminance formula using normalized sRGB channels. |
| `contrastRatio` | Computes `(lighter + 0.05) / (darker + 0.05)` for two colors. |
| `getAccessibleTextColor` | Uses the supplied brand color as text only when it reaches `4.5:1` on the dashboard background; otherwise it falls back to the accessible token. |
| `getAccessibleForeground` | Chooses white text for brand backgrounds only when white reaches `4.5:1`; otherwise it uses the dark surface color. |

This keeps the backend-driven branding behavior intact while preventing inaccessible foreground/background pairs.

### Muted Text and UI Boundaries

Low-contrast `text-slate-500` usages were lifted to `text-slate-400`. On the base background, `#94a3b8` reaches approximately `7.87:1`; on card surfaces it reaches approximately `6.96:1`.

Borders that communicate card, table, input, and button boundaries were raised from `slate-800`/`slate-700` to `slate-600` or `slate-500`, depending on the component. The reusable card border now uses `slate-500`, which gives component edges a contrast ratio above the 3:1 non-text target on the dark dashboard background.

### Build Type Declaration

`dashboard/src/vite-env.d.ts` was added because the dashboard already reads `import.meta.env.VITE_API_BASE_URL`, but TypeScript did not have Vite client types loaded. Without this declaration, the required `npm run build` validation fails before Vite can bundle the app.

## Contrast Checks

Representative audited pairs:

| Pair | Ratio | Result |
| --- | ---: | --- |
| `#94a3b8` muted text on `#020617` page background | 7.87:1 | Pass |
| `#94a3b8` muted text on `#0f172a` card background | 6.96:1 | Pass |
| `#ffffff` text on default `#2563eb` primary button | 5.17:1 | Pass |
| `#020617` dynamic fallback text on original `#3b82f6` primary | 5.71:1 | Pass |
| `#93c5fd` primary text token on `#020617` | 11.19:1 | Pass |
| `#5eead4` accent text token on `#020617` | 13.64:1 | Pass |
| `#64748b` component boundary on `#020617` | 4.24:1 | Pass |

## Performance and Complexity

The implementation adds no dependencies and performs only a handful of constant-time color calculations during render.

Time complexity is `O(1)`: each render computes a fixed number of CSS custom properties from two configured colors. There are no loops over dashboard data, routes, tables, or user content.

Space complexity is `O(1)`: the helpers allocate only tiny fixed-size arrays for RGB channels and do not store any persistent contrast audit state.

Bundle impact is minimal because the helpers are small arithmetic functions and replace no existing runtime architecture. The approach avoids shipping a contrast library for a two-color theme boundary.

## Validation

Branch checked against remote before continuing:

```sh
git fetch origin
```

`origin/main` matched the local `main` commit at the time of implementation, so no refork or upstream merge was required.

Required local validation:

```sh
cd dashboard
npm run build
```

Result: passed.

Build summary:

```text
tsc && vite build
1920 modules transformed
dist/index.html 0.84 kB
dist/assets/index-CCR-cdyL.css 17.72 kB
dist/assets/index-LnowqPWz.js 282.15 kB
```

## Repository Hygiene

No lock files were modified for this issue. No SQLite files were modified or staged. Existing unrelated local changes, including `backend/tsconfig.json` and `CODEBASE_INDEX.md`, are intentionally outside this implementation scope.

