import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('key lifecycle stages reveal their limits with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 900 })
  await page.goto('.');
  const section = page.locator('section[aria-labelledby="key-lifecycle"]');
  const stages = section.locator('ol details');
  await expect(stages).toHaveCount(4);
  for (const stage of await stages.all()) {
    await stage.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(stage.locator('p')).toBeVisible();
  }
  await section.locator('details').last().locator('summary').click();
  await expect(section.getByText('Not necessarily.', { exact: false })).toBeVisible();
  await expect(section.locator('a')).toHaveAttribute('href', 'https://www.usenix.org/conference/woot26/presentation/brumley');
  const accessibility = await new AxeBuilder({ page }).include('section[aria-labelledby="key-lifecycle"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
