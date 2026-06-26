import { expect, test } from '@playwright/test';

test.describe('dashboard cross-browser smoke coverage', () => {
  test('renders the shell and recovers from backend config failure', async ({ page }) => {
    await page.route('**/api/config/ui', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'mocked failure' }),
      });
    });

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'AnchorPoint' })).toBeVisible();
    await expect(page.getByTestId('config-warning')).toBeVisible();
    await expect(page.getByTestId('backend-status')).toContainText('Fallback Theme Active');
    await expect(page.getByTestId('sidebar')).toBeVisible();

    await page.getByRole('button', { name: 'Deposit' }).click();
    await expect(page.getByTestId('active-view')).toContainText('Deposit Assets');
    await page.getByRole('button', { name: 'Select USDC for deposit' }).click();
    await expect(page.getByTestId('active-view')).toContainText('Identity Verification');

    await page.getByRole('button', { name: 'Launch AnchorPoint KYC portal' }).click();
    await page.getByLabel('Full Name').fill('Jane Doe');
    await page.getByRole('button', { name: 'Submit KYC and continue' }).click();
    await expect(page.getByTestId('active-view')).toContainText('Transaction Initiated');

    await page.getByRole('button', { name: 'KYC Status' }).click();
    await expect(page.getByTestId('active-view')).toContainText('Preview State');
    await expect(page.getByTestId('active-view')).toContainText('Verification Failed');

    await page.getByRole('button', { name: 'Overview' }).click();
    await expect(page.getByTestId('active-view')).toContainText('Total Volume');
  });
});
