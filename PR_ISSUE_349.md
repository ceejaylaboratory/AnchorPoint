# Pull Request: Cypress E2E Setup for Dashboard

## Description
This PR addresses issue #349 by setting up Cypress for End-to-End (E2E) testing in the `dashboard` application as part of the testnet deployment readiness wave.

## Changes Included
- Added `cypress` as a development dependency.
- Configured Cypress basic settings (`cypress.config.ts`).
- Added initial E2E setup files (`cypress/support/e2e.ts`, `cypress/support/commands.ts`).
- Created a preliminary dashboard E2E test (`cypress/e2e/dashboard.cy.ts`) ensuring the application loads successfully.
- Added a `test:e2e` script to the Dashboard's `package.json` for CI pipeline integration.
- Configured a dedicated `tsconfig.json` for the Cypress directory to correctly type commands and avoid linter warnings.

## Architectural Guidelines adherence
- Implemented the Cypress test structure according to modern project standards and documented configurations.
- Does not affect backend architecture or styling. Dark mode styling aesthetics are preserved as no visual changes were introduced.

## Verification / Acceptance Criteria
- [x] Implementation completed according to project standards.
- [x] Code is properly documented and commented.
- [x] E2E tests (`npm run test:e2e`) provided.
- [x] Passes CI pipeline (linting, tests, build) locally.
