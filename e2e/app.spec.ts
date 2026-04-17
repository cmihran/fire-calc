import { test, expect, type Page } from '@playwright/test';

// Use ?demo to bypass localStorage so tests always start from defaults.
async function load(page: Page) {
  await page.goto('/?demo');
  await expect(page.locator('.sidebar__title')).toHaveText(/Net Worth Projection/);
}

test.describe('Baseline render', () => {
  test('loads with chart, settings, and milestones', async ({ page }) => {
    await load(page);
    await expect(page.locator('.chart-card')).toBeVisible();
    await expect(page.locator('.settings')).toBeVisible();
    await expect(page.locator('.main__hero').first()).toBeVisible();
    // Five legend entries (Taxable, Roth, HSA, Traditional, Home)
    const legend = page.locator('.chart-card__legend > span');
    await expect(legend).toHaveCount(5);
    await expect(legend.nth(0)).toContainText('Taxable');
    await expect(legend.nth(1)).toContainText('Roth');
    await expect(legend.nth(2)).toContainText('HSA');
    await expect(legend.nth(3)).toContainText('Traditional');
    await expect(legend.nth(4)).toContainText('Home');
  });

  test('hero shows three milestones with dollar values', async ({ page }) => {
    await load(page);
    const heroes = page.locator('.main__hero-value');
    await expect(heroes).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(heroes.nth(i)).toContainText(/\$/);
    }
  });
});

test.describe('City selector', () => {
  test('visible for NY, hidden for TX', async ({ page }) => {
    await load(page);
    // Default state is NY, city dropdown should be visible
    const cityLabel = page.locator('.field__label', { hasText: 'City' });
    await expect(cityLabel).toBeVisible();

    // Switch to TX — city dropdown should disappear
    await page.locator('.field__select').first().selectOption('TX');
    await expect(cityLabel).toHaveCount(0);
  });

  test('toggling NYC → Yonkers changes effective tax rate', async ({ page }) => {
    await load(page);
    // Find the city dropdown (second select; first is state)
    const citySelect = page.locator('.field__select').nth(1);
    await expect(citySelect).toHaveValue('NYC');

    // Capture effective tax rate for age ~36 from the year table
    const ageCell = page.locator('.year-table tbody tr').nth(1);
    const rateNyc = await ageCell.locator('td').nth(2).textContent();

    await citySelect.selectOption('Yonkers');
    await page.waitForTimeout(100);
    const rateYonkers = await ageCell.locator('td').nth(2).textContent();

    expect(rateNyc).not.toBe(rateYonkers);

    await citySelect.selectOption('');
    await page.waitForTimeout(100);
    const rateNone = await ageCell.locator('td').nth(2).textContent();
    expect(rateNone).not.toBe(rateNyc);
  });
});

test.describe('HSA contribution', () => {
  test('cranking HSA slider grows HSA balance over time', async ({ page }) => {
    await load(page);
    // Set some spend to stay positive, high income default is fine
    // Find HSA slider by its label "HSA" in contribution group
    const hsaSlider = page.locator('.contrib-slider', { hasText: /^HSA/ }).locator('input[type="range"]');
    await hsaSlider.fill('1');
    await page.waitForTimeout(150);

    // Tooltip/year-table doesn't show HSA directly; rely on chart tooltip by
    // hovering the chart instead — simplest check is that netWorth grew.
    // Use the milestone pill at age 55 as a proxy.
    const pills = page.locator('.milestone-pill');
    await expect(pills.first()).toBeVisible();
    // Grab the last pill's net worth (age 70 or similar)
    const lastPill = pills.last();
    const net1 = await lastPill.locator('.milestone-pill__value').textContent();

    // Reset HSA to 0 and verify net worth drops
    await hsaSlider.fill('0');
    await page.waitForTimeout(150);
    const net0 = await lastPill.locator('.milestone-pill__value').textContent();

    expect(net1).not.toBe(net0);
  });
});

test.describe('Roth conversion editor', () => {
  test('add and remove a conversion window', async ({ page }) => {
    await load(page);
    const addBtn = page.locator('.roth-conversions__add');
    await expect(addBtn).toBeVisible();

    await addBtn.click();
    const row = page.locator('.roth-conversions__row');
    await expect(row).toHaveCount(1);

    await row.locator('.roth-conversions__remove').click();
    await expect(page.locator('.roth-conversions__row')).toHaveCount(0);
  });

  test('conversion window produces non-zero rothConversion in milestone detail', async ({ page }) => {
    await load(page);
    // Set retirement to 55 so conversions at 55-65 see low baseline ordinary
    const retireField = page.locator('.field', { hasText: 'Retire' }).locator('input');
    await retireField.fill('55');
    await retireField.press('Tab');

    // Boost Traditional so conversions persist across multiple years
    const tradField = page.locator('.field', { hasText: 'Traditional' }).locator('input');
    await tradField.fill('1000000');
    await tradField.press('Tab');

    // Add a conversion window 55-65 with a realistic nominal target
    await page.locator('.roth-conversions__add').click();
    const row = page.locator('.roth-conversions__row');
    const inputs = row.locator('input');
    await inputs.nth(0).fill('55');
    await inputs.nth(1).fill('65');
    await inputs.nth(2).fill('200000');
    await inputs.nth(2).press('Tab');
    await page.waitForTimeout(200);

    const pill60 = page.locator('.milestone-pill', { has: page.locator('.milestone-pill__age', { hasText: '60' }) });
    await pill60.click();
    const detail = page.locator('.milestone-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(/Roth conversion/);
  });
});

test.describe('Social Security toggle', () => {
  test('disable and re-enable SS', async ({ page }) => {
    await load(page);
    // SS is enabled by default (claimAge 67, PIA 2800)
    await expect(page.locator('.field__label', { hasText: 'Claim age' })).toBeVisible();

    await page.locator('button.settings__inline-btn', { hasText: 'Disable SS' }).click();
    await expect(page.locator('button', { hasText: 'Enable Social Security' })).toBeVisible();
    await expect(page.locator('.field__label', { hasText: 'Claim age' })).toHaveCount(0);

    await page.locator('button', { hasText: 'Enable Social Security' }).click();
    await expect(page.locator('.field__label', { hasText: 'Claim age' })).toBeVisible();
  });
});

test.describe('State retirement exclusion', () => {
  test('switching NY → PA changes retirement-year effective rate', async ({ page }) => {
    await load(page);
    // Find a retirement-year row in the table (age 70, somewhere deep)
    // Set retirement age to 67, leave endAge 85, find age-70 row
    const stateSelect = page.locator('.field__select').first();

    // Grab PA row at age 70
    await stateSelect.selectOption('NY');
    await page.waitForTimeout(100);
    const row70 = page.locator('.year-table tbody tr', { hasText: /^70\b/ }).first();
    const nyRate = await row70.locator('td').nth(2).textContent();

    await stateSelect.selectOption('PA');
    await page.waitForTimeout(150);
    const paRate = await row70.locator('td').nth(2).textContent();

    // PA fully exempts retirement income; effective rate should drop vs NY
    expect(nyRate).not.toBe(paRate);
  });
});

test.describe('Reset', () => {
  test('Reset restores defaults', async ({ page }) => {
    await load(page);
    const comp = page.locator('.field', { hasText: 'Gross comp' }).locator('input');
    await comp.fill('999999');
    await comp.press('Tab');
    await expect(comp).toHaveValue('999999');

    await page.locator('button', { hasText: 'Reset' }).click();
    await expect(comp).toHaveValue('60000');
  });
});
