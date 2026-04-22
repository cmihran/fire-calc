import { test } from '@playwright/test';

// Visual smoke — captures screenshots for manual review. Not assertions.
test('screenshot: default view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo');
  await page.waitForSelector('.chart-card');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/default.png', fullPage: true });
});

test('screenshot: Roth conversion ladder active', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo');
  await page.waitForSelector('.chart-card');
  // Demo profile is read-only — duplicate into an editable copy so we can edit Settings.
  await page.locator('.readonly-banner__btn').click();

  await page.locator('.field', { hasText: 'Retire' }).locator('input').fill('55');
  await page.locator('.field', { hasText: 'Retire' }).locator('input').press('Tab');
  await page.locator('.field', { hasText: 'Traditional' }).locator('input').fill('1000000');
  await page.locator('.field', { hasText: 'Traditional' }).locator('input').press('Tab');
  await page.locator('.roth-conversions__add', { hasText: '+ Conversion window' }).click();
  const section = page.locator('.settings__group', { hasText: 'Roth conversions' });
  const inputs = section.locator('.roth-conversions__row').locator('input');
  await inputs.nth(0).fill('55');
  await inputs.nth(1).fill('65');
  await inputs.nth(2).fill('200000');
  await inputs.nth(2).press('Tab');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/roth-ladder.png', fullPage: true });
});

test('screenshot: PA retirement exclusion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo');
  await page.waitForSelector('.chart-card');
  await page.locator('.readonly-banner__btn').click();
  await page.locator('.field__select').first().selectOption('PA');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/pa-state.png', fullPage: true });
});
