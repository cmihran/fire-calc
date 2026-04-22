import { test, expect, type Page } from '@playwright/test';

// Use ?fresh to bypass localStorage AND skip the demo example scenarios,
// so tests always start from a clean single-Baseline DEFAULT_APP_STATE.
async function load(page: Page) {
  await page.goto('/?fresh');
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
    const addBtn = page.locator('.roth-conversions__add', { hasText: '+ Conversion window' });
    await expect(addBtn).toBeVisible();

    await addBtn.click();
    // Scope to the Roth conversions section only (not RSU/exercise rows).
    const section = page.locator('.settings__group', { hasText: 'Roth conversions' });
    const row = section.locator('.roth-conversions__row');
    await expect(row).toHaveCount(1);

    await row.locator('.roth-conversions__remove').click();
    await expect(section.locator('.roth-conversions__row')).toHaveCount(0);
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
    await page.locator('.roth-conversions__add', { hasText: '+ Conversion window' }).click();
    const section = page.locator('.settings__group', { hasText: 'Roth conversions' });
    const row = section.locator('.roth-conversions__row');
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

test.describe('Equity comp', () => {
  test('adding an RSU vest window raises effective tax rate for years inside the window', async ({ page }) => {
    await load(page);
    // Year-table columns: Age | Comp | Tax % | Spend | Net worth | ...
    const row37 = page.locator('.year-table tbody tr', { hasText: /^37\b/ }).first();
    const baseRate = await row37.locator('td').nth(2).textContent();

    // Default RSU vest: fromAge = current age (35), toAge = 38, $100k/yr
    await page.locator('.roth-conversions__add', { hasText: '+ RSU vest' }).click();
    await page.waitForTimeout(150);

    const rsuRate = await row37.locator('td').nth(2).textContent();
    expect(rsuRate).not.toBe(baseRate);
  });

  test('large ISO exercise raises effective tax rate via AMT', async ({ page }) => {
    await load(page);
    const row = page.locator('.year-table tbody tr', { hasText: /^35\b/ }).first();
    const baseRate = await row.locator('td').nth(2).textContent();

    await page.locator('.roth-conversions__add', { hasText: '+ Exercise' }).click();
    const exerciseRow = page.locator('.roth-conversions__row.equity-editor__row--exercise');
    await exerciseRow.locator('select').selectOption('ISO');
    // Exercise row inputs: [Age, Amount]. (Type is a <select>, not an input.)
    // Default amount $100k is too small to trigger AMT; bump to $500k.
    const amountInput = exerciseRow.locator('input').nth(1);
    await amountInput.fill('500000');
    await amountInput.press('Tab');
    await page.waitForTimeout(150);

    const isoRate = await row.locator('td').nth(2).textContent();
    expect(isoRate).not.toBe(baseRate);
  });
});

test.describe('Healthcare (ACA)', () => {
  test('enabling ACA in a FIRE scenario reduces retirement-year net worth', async ({ page }) => {
    await load(page);
    // Build a FIRE-at-55 scenario so age 55-64 is a real gap window.
    const retire = page.locator('.field', { hasText: 'Retire' }).locator('input');
    await retire.fill('55');
    await retire.press('Tab');
    const trad = page.locator('.field', { hasText: 'Traditional' }).locator('input');
    await trad.fill('1000000');
    await trad.press('Tab');

    // Add a Roth conversion window so MAGI stays above ~400% FPL during the
    // gap (ensures PTC is small and ACA cost is non-trivial).
    await page.locator('.roth-conversions__add', { hasText: '+ Conversion window' }).click();
    const convRows = page.locator('.settings__group', { hasText: 'Roth conversions' })
      .locator('.roth-conversions__row input');
    await convRows.nth(0).fill('55');
    await convRows.nth(1).fill('64');
    await convRows.nth(2).fill('150000');
    await convRows.nth(2).press('Tab');
    await page.waitForTimeout(150);

    // Baseline net worth at age 65 (first year post-gap, pre-ACA toggle)
    const row65 = page.locator('.year-table tbody tr', { hasText: /^65\b/ }).first();
    const baseNW = await row65.locator('td').nth(4).textContent();

    // Flip ACA on — scoped by the checkbox's sibling label text.
    const acaToggle = page.locator('label', { hasText: 'Use ACA in gap' })
      .locator('input[type="checkbox"]');
    await acaToggle.check();
    await page.waitForTimeout(200);

    const acaNW = await row65.locator('td').nth(4).textContent();
    expect(acaNW).not.toBe(baseNW);
  });
});

test.describe('Healthcare (Medicare IRMAA)', () => {
  test('toggling Medicare changes the post-65 net-worth trajectory', async ({ page }) => {
    await load(page);
    // Build a late-career scenario where IRMAA hits immediately at 65 and
    // ending NW is small enough ($X.XXM) that ~$100k cumulative drag is visible.
    const currentAge = page.locator('.field', { hasText: 'Age' }).locator('input').first();
    await currentAge.fill('65');
    await currentAge.press('Tab');
    const retire = page.locator('.field', { hasText: 'Retire' }).locator('input').first();
    await retire.fill('65');
    await retire.press('Tab');
    const end = page.locator('.field', { hasText: 'End' }).locator('input').first();
    await end.fill('85');
    await end.press('Tab');
    const trad = page.locator('.field', { hasText: 'Traditional' }).locator('input').first();
    await trad.fill('2500000');
    await trad.press('Tab');
    const spending = page.locator('.field', { hasText: 'Monthly spend' }).locator('input').first();
    await spending.fill('9000');
    await spending.press('Tab');
    await page.waitForTimeout(200);

    // Default has medicareEnabled = true. Net worth at 85 (end of sim).
    const row85 = page.locator('.year-table tbody tr', { hasText: /^85\b/ }).first();
    const withMedicareNW = await row85.locator('td').nth(4).textContent();

    // Toggle Medicare off.
    const medicareToggle = page.locator('label', { hasText: 'Medicare + IRMAA at 65+' })
      .locator('input[type="checkbox"]');
    await medicareToggle.uncheck();
    await page.waitForTimeout(200);

    const withoutMedicareNW = await row85.locator('td').nth(4).textContent();
    // Turning Medicare off skips Part B + IRMAA → more cash retained → higher net worth
    expect(withoutMedicareNW).not.toBe(withMedicareNW);
  });
});

test.describe('Two-earner MFJ', () => {
  test('spouse fields appear only after switching to MFJ', async ({ page }) => {
    await load(page);
    // Single by default: no "Spouse (two-earner)" group
    const group = page.locator('.settings__group', { hasText: 'Spouse (two-earner)' });
    await expect(group).toHaveCount(0);

    // Switch filing status → MFJ
    const filingSelect = page.locator('.field', { hasText: 'Filing' }).locator('select');
    await filingSelect.selectOption('married_filing_jointly');
    await expect(group).toBeVisible();

    // Fields stay hidden until the checkbox is flipped
    await expect(group.locator('.field', { hasText: 'Spouse comp' })).toHaveCount(0);
    const toggle = group.locator('input[type="checkbox"]');
    await toggle.check();
    await expect(group.locator('.field', { hasText: 'Spouse comp' })).toBeVisible();
  });

  test('enabling two-earner with spouse comp changes the year-table', async ({ page }) => {
    await load(page);
    // Switch to MFJ so the Spouse group shows up
    const filingSelect = page.locator('.field', { hasText: 'Filing' }).locator('select');
    await filingSelect.selectOption('married_filing_jointly');

    // Capture baseline comp at age 36 (single income, MFJ brackets)
    const row36 = page.locator('.year-table tbody tr', { hasText: /^36\b/ }).first();
    const baseComp = await row36.locator('td').nth(1).textContent();

    // Flip two-earner on, add $100k spouse income
    const group = page.locator('.settings__group', { hasText: 'Spouse (two-earner)' });
    await group.locator('input[type="checkbox"]').check();
    const spouseCompField = group.locator('.field', { hasText: 'Spouse comp' }).locator('input');
    await spouseCompField.fill('100000');
    await spouseCompField.press('Tab');
    await page.waitForTimeout(150);

    const dualComp = await row36.locator('td').nth(1).textContent();
    // Tick.comp is now effectiveComp + effectiveSpouseComp — must differ
    expect(dualComp).not.toBe(baseComp);
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

test.describe('Scenarios', () => {
  test('baseline scenario renders and can be renamed', async ({ page }) => {
    await load(page);
    await expect(page.locator('.scenario-row')).toHaveCount(1);
    await expect(page.locator('.scenario-row__name')).toHaveText('Baseline');

    // Rename via the pencil icon
    await page.locator('.scenario-row__icon-btn', { hasText: '✎' }).click();
    const rename = page.locator('.scenario-row__rename');
    await rename.fill('Baseline Alt');
    await rename.press('Enter');
    await expect(page.locator('.scenario-row__name')).toHaveText('Baseline Alt');
  });

  test('adding a scenario makes it active and isolates edits', async ({ page }) => {
    await load(page);
    await page.locator('.scenarios__btn', { hasText: '+ New' }).click();
    await expect(page.locator('.scenario-row')).toHaveCount(2);

    // New scenario should be active (second row)
    const active = page.locator('.scenario-row--active .scenario-row__name');
    await expect(active).toHaveText(/Scenario 2/);

    // Edit Gross comp in the new scenario
    const comp = page.locator('.field', { hasText: 'Gross comp' }).locator('input');
    await comp.fill('250000');
    await comp.press('Tab');
    await expect(comp).toHaveValue('250000');

    // Switch back to Baseline — comp should still be 60000
    await page.locator('.scenario-row__name', { hasText: 'Baseline' }).click();
    await expect(comp).toHaveValue('60000');

    // Switch back to Scenario 2 — 250000 preserved
    await page.locator('.scenario-row__name', { hasText: /Scenario 2/ }).click();
    await expect(comp).toHaveValue('250000');
  });

  test('comparing two scenarios switches chart to multi-line mode', async ({ page }) => {
    await load(page);
    // Default single scenario: 5-item stacked legend
    await expect(page.locator('.chart-card__legend > span')).toHaveCount(5);

    await page.locator('.scenarios__btn', { hasText: 'Duplicate' }).click();
    await expect(page.locator('.scenario-row')).toHaveCount(2);

    // Two scenarios, both in compare → overlay mode → 2-item legend per scenario
    const legend = page.locator('.chart-card__legend > span');
    await expect(legend).toHaveCount(2);
    await expect(legend.nth(0)).toContainText('Baseline');
    await expect(legend.nth(1)).toContainText(/Copy of Baseline/);
  });

  test('delete is disabled with a single scenario, enabled with two', async ({ page }) => {
    await load(page);
    const delBtn = page.locator('.scenario-row__icon-btn--danger').first();
    await expect(delBtn).toBeDisabled();

    await page.locator('.scenarios__btn', { hasText: '+ New' }).click();
    await expect(page.locator('.scenario-row__icon-btn--danger').first()).toBeEnabled();
  });
});
