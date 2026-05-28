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
    await page.getByRole('button', { name: 'USDC' }).click();

    await page.getByRole('button', { name: 'Launch KYC Portal' }).click();
    await expect(page.getByTestId('active-view')).toContainText('Transaction Initiated');

    await page.getByRole('button', { name: 'KYC Status' }).click();
    await expect(page.getByTestId('active-view')).toContainText('Configured KYC Fields');

    await page.getByRole('button', { name: 'Overview' }).click();
    await expect(page.getByTestId('active-view')).toContainText('Total Volume');
  });
});
