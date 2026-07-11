import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * WCAG regression gate. Deploys are already gated on the unit vectors; this
 * gates them on accessibility the same way. Scans the full page with every
 * <details> expanded and every live demo run, in both themes.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Kill animations/transitions so scans see settled, opaque, final state. */
async function killMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{
      animation-duration:0s!important;animation-delay:0s!important;
      transition-duration:0s!important;transition-delay:0s!important;
      scroll-behavior:auto!important;
    }`,
  });
}

async function openAllDetails(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const details of document.querySelectorAll('details')) {
      details.open = true;
    }
  });
}

/** Drive the interactive demos so dynamically-injected regions get scanned. */
async function driveDemos(page: Page): Promise<void> {
  // Section 2: measure + sweep.
  await page.locator('#s2-run').click();
  await page.locator('#s2-sweep').click();
  await expect(page.locator('#s2-sweep-summary')).not.toBeEmpty();

  // Section 3: launch the timing attack and let it settle, plus the board run.
  await page.locator('#s3-run').click();
  await expect(page.locator('#s3-verdict')).not.toBeEmpty({ timeout: 60_000 });
  await page.locator('#s3-board-run').click();
  await expect(page.locator('#s3-board')).not.toBeEmpty({ timeout: 60_000 });
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

test('no WCAG A/AA violations in dark theme', async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('#app main')).toBeVisible();
  await killMotion(page);
  await driveDemos(page);
  await openAllDetails(page);
  await scan(page);
});

test('no WCAG A/AA violations in light theme', async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('#app main')).toBeVisible();
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await killMotion(page);
  await driveDemos(page);
  await openAllDetails(page);
  await scan(page);
});
