import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the arrival state, where
 * nothing has been measured, both measured-data disclosures are shut and every
 * result container is empty (which is exactly the state a goto→scan gate would
 * certify as flawless while checking nothing — timing demos build every result
 * asynchronously, so this repo was the highest-risk one in the fleet for that
 * race); both skip links focused; Section 2 measured on the shipped 5-of-16
 * guess and again on a full-match guess, where early-exit never fires and the
 * clock decides between the leak and inconclusive verdict tones; the prefix
 * sweep run and its 17-row data table revealed; the recovery attack run on the
 * noise-free idealised channel against the vulnerable comparator (always the
 * leak verdict, twelve filled slots, an all-green reveal diff) and against the
 * constant-time one (always the safe verdict with its low-confidence
 * admission), with the per-position table revealed between them; the discard
 * states a config change and New secret render; the four-mode board scanned
 * both mid-run — tinted verdict rows above italic pending rows — and complete;
 * two shared-bar hover states; focus rings on an input, a button and a source
 * listing (the keyboard route into the only scroller that overflows at 380px);
 * and finally the theme switched live through the shared bar with every result
 * already rendered. Every one of those states is scanned, in both themes, at
 * desktop and phone width.
 *
 * See `gate.ts` for why nothing is injected into the page (`ui.ts` branches on
 * `matchMedia`, which a style tag cannot reach, so the old gate never once
 * scanned the reduced-motion pacing), why no disclosure is opened from script,
 * why the lab's defaults are asserted rather than assumed, and why `violations`
 * is not the whole oracle.
 */

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });
}
