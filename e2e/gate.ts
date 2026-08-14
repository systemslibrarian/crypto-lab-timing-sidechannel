import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something the gate
 * this replaces did:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old spec's
 *     `killMotion()` pushed `animation-duration:0s!important;
 *     transition-duration:0s!important` through `addStyleTag`. That BYPASSES
 *     this lab's own `@media (prefers-reduced-motion: reduce)` block instead of
 *     exercising it — and on this page that block is not the only thing motion
 *     depends on. `ui.ts` reads `matchMedia('(prefers-reduced-motion: reduce)')`
 *     in JavaScript and, when it matches, drops the 70ms per-position pause of
 *     the recovery animation. A style tag cannot reach a `matchMedia` call, so
 *     the old gate always scanned the paced rendering and never once scanned
 *     the reduced-motion pacing that a reader with the preference set is the
 *     only rendering to ever see. This gate sets the preference through
 *     `emulateMedia`, asserts from inside the page that it took effect, and
 *     injects nothing.
 *
 *  2. IT NEVER TOUCHED A `<details>`. This page ships two `.chart-data`
 *     disclosures — the sweep data and the per-position data, the only
 *     rendering of the measured numbers that is not a `<canvas>` — and the old
 *     gate's `openAllDetails()` set `details.open = true` on both from script
 *     before its only scan, so the SHUT state every reader arrives in was never
 *     scanned, and the open state was reached by a route no reader has. This
 *     gate opens each one by clicking its `<summary>`, and scans before and
 *     after.
 *
 *  3. IT DROVE THE PANELS AND THEN THREW THE RESULT AWAY. `driveDemos()`
 *     clicked all four run buttons and scanned ONCE at the end, so every
 *     intermediate rendering — the config-change state that discards a verdict,
 *     the full-match measurement, the safe verdict with its low-confidence
 *     admission, the four-mode board with rows still pending — was overwritten
 *     before anything measured it. And its light-theme test re-drove everything
 *     after a toggle click but never scanned a live in-place switch with
 *     results already on screen. This drive names every control it touches,
 *     asserts a real completion signal after each, and scans after every step,
 *     in {dark, light} x {1280, 380}.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. Every surface on this
 *     page that carries meaning is a `color-mix()` or a gradient — all three
 *     verdict tones, all three status pills, both proof-card columns, every
 *     reveal-diff cell, the board-row tints, every button — and axe files all
 *     of them under `incomplete` rather than judging them. So does an
 *     `aria-label` on a role-less element.
 *
 *  5. IT HAD NO REFLOW, NON-TEXT-CONTRAST OR GENERATED-CONTENT ORACLE. The two
 *     1.4.10 defects already fixed in this repo — `main`'s bare `auto` grid
 *     track floored at its widest panel's min-content (509px at a 380px
 *     viewport), and the `white-space: pre` source listings pushing the
 *     document to 492px — were invisible to `withTags(TAGS)`, because axe has
 *     no reflow rule at all. `nontext.ts` adds the 1.4.11 half; see its header
 *     for why the control-boundary check is the live half in this lab.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are not enough. A transition sampled mid-flight has a colour that
 * exists in no state of the page, and axe will happily report it: elsewhere in
 * this fleet that produced a phantom 2.00:1 failure on a button whose settled
 * ratio is 9:1. Transitions also drain in waves rather than in one batch, so a
 * poll for "nothing running right now" can exit through a gap between waves —
 * hence six consecutive quiet frames rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `main.css`'s
 * `* { animation: none !important; transition: none !important }` means
 * `getAnimations()` is normally empty and this returns on the sixth frame. The
 * page's remaining motion — the recovery loop repainting slots and bars — is a
 * `requestAnimationFrame`/`setTimeout` chain the Animation API cannot see at
 * all, which is why the drive additionally waits on each run's own completion
 * signal (a verdict becoming non-empty, a button re-enabling) rather than on
 * this alone.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      const w = window as unknown as { __quietFrames?: number; __settleStart?: number };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set.
 *
 * `main.css` cannot currently be in that shape, and this assertion is what
 * makes that a measurement rather than a reading. Its reduced-motion block was
 * read declaration by declaration: it contains exactly `animation`,
 * `transition` and `scroll-behavior`, all `none`/`auto`, and nothing else. The
 * file's one `@keyframes` (`slot-pop`, the filled-slot entrance) animates FROM
 * `opacity: .4` TO the element's base state, so cancelling it leaves the slot
 * fully opaque — the safe direction. The check runs in every state anyway,
 * because all of that is a property of the current stylesheet rather than of
 * the page.
 *
 * `aria-hidden` subtrees are excluded; see the note on `ariaHidden` in
 * `contrast.ts` for the one thing this lab hides (the recovery slots) and the
 * hand measurement that covers it.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created. This lab's benchmarks run straight in click handlers with no
 * `try/catch` around them, so a thrown measurement would leave a half-painted
 * page behind — a summary with no verdict, a board stuck on "running…" — that a
 * scan would report as perfectly accessible. Attach before `boot`, assert after
 * the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * This page ships two `<header>`s: the shared `.cl-topbar` with an explicit
 * `role="banner"`, and the lab's own `.cl-hero`, which `ui.ts` renders as a
 * direct child of the `<div id="app">` — NOT inside sectioning content, so it
 * implies `banner` on its own. The single banner is therefore not a property of
 * the nesting here; it depends entirely on the shared bar's `dedupeBanner()`
 * demoting the hero to `role="group"`, which it does on `DOMContentLoaded`,
 * after the deferred module script has rendered the shell. Asserting the
 * OUTCOME rather than either mechanism is what catches a change to that
 * ordering.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * An explicit role on a list REPLACES its implicit `list` role, orphaning every
 * `<li>` under it — and a redundant `role="list"` makes axe apply
 * `aria-required-children`, which fails whenever the list is empty. Neither is
 * reliably visible to a source grep, because a role can be assigned as a JS
 * property in an element-creation helper rather than as markup. Ask the DOM.
 *
 * This lab has five lists — the two proof-card `<ul>`s, the Section 4
 * `<ul class="rules">`, the Section 5 `<ol class="rules">` (which carries an
 * `aria-label`, fine on the implicit `list` role), and the `.why-top` results
 * `<ol>` — and none carries a `role`. `.why-top` is also the only one that is
 * ever empty, and only before a run, when it does not exist at all — a property
 * of the content, not of the code, which is exactly why the assertion is cheap
 * enough to keep.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els.map(
      (e) => `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
    )
  );
  expect(broken, 'an explicit role on a list deletes its list semantics').toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page — including the
 * lab's DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. That assertion is load-bearing in this repo
 * beyond the usual: `ui.ts` branches on `matchMedia` in JavaScript (the
 * per-position pacing of the recovery animation), so if the emulation silently
 * failed the gate would scan the paced animation while claiming to scan the
 * reduced-motion rendering.
 *
 * The theme is seeded through `localStorage` rather than by clicking the
 * toggle, which pins down a real failure mode as a side effect: `index.html`'s
 * anti-flash script reads `localStorage.getItem('theme')` and the shared bar's
 * toggle writes `localStorage.setItem('theme', …)`. Both agree on `'theme'`; if
 * either drifted, this boot fails on `data-theme` rather than quietly scanning
 * dark twice. Unlike some labs in this fleet, this one has NO theme toggle of
 * its own — `#cl-theme-toggle` is the only one, which is asserted below so the
 * shared bar's hide-the-lab-toggle rule cannot silently start matching a
 * control this lab later grows.
 *
 * The defaults are asserted at length because `ui.ts` builds the entire page
 * from `renderAppShell()` into an empty `<div id="app">`, and every result on
 * it — both Section 2 summaries, the Section 3 verdict, reveal, tables and
 * board — is rendered only by a click. A navigation that resolves proves
 * nothing here: a render that threw would leave `#app` empty, and an empty div
 * is exactly what a scan reports as perfectly accessible. Timing demos build
 * their results asynchronously by nature, which made THIS repo the highest-risk
 * one in the fleet for the goto→scan race the old gate ran.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  await expect(page.locator('main#main-content')).toHaveCount(1);
  await expect(page.locator('#app main > section')).toHaveCount(5);

  // Both skip links exist and point at ids that exist. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it — a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run
  // says nothing about. This page has TWO, with DIFFERENT targets: the shared
  // bar's goes to `#app` and the lab's own goes to `#main-content`.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('a.skip-link')).toHaveAttribute('href', '#main-content');
  await expect(page.locator('#app')).toHaveCount(1);

  // The one and only theme toggle. The shared bar ships a rule that
  // display:none's any lab-local toggle; this lab has none, and if one ever
  // appears it must be hidden in a way that also removes it from the tab
  // order — asserting "exactly one toggle-shaped control" catches the addition
  // so that question gets asked.
  await expect(page.locator('#cl-theme-toggle')).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        document.querySelectorAll('#theme-toggle,#themeToggle,.theme-toggle,[data-theme-toggle]').length
    ),
    'this lab declares no theme toggle of its own'
  ).toBe(0);

  // ── Every shipped control default ───────────────────────────────────────
  // Which half of this lab a scan sees depends entirely on these. The shipped
  // Section 2 guess shares exactly the "open-" prefix with the demo secret, so
  // the first measurement exercises a 5/16 partial match; Section 3 ships
  // targeting the VULNERABLE comparator over the LIVE timing channel at the
  // balanced effort.
  await expect(page.locator('#s2-secret')).toHaveValue('open-sesame-1234');
  await expect(page.locator('#s2-guess')).toHaveValue('open-XXXXXXXXXXX');
  await expect(page.locator('input[name="defense"][value="vulnerable"]')).toBeChecked();
  await expect(page.locator('input[name="channel"][value="live"]')).toBeChecked();
  await expect(page.locator('#s3-effort')).toHaveValue('1');

  // Nothing has run yet, and the page says so rather than being blank by
  // accident: 12 empty slots, a zeroed progressbar, a Ready status, and every
  // result container empty (each `:empty` rule hides its box).
  await expect(page.locator('#s3-slots .slot')).toHaveCount(12);
  await expect(page.locator('#s3-slots .slot.filled')).toHaveCount(0);
  await expect(page.locator('#s3-progress')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#s3-status')).toContainText('12-character secret is loaded and hidden');
  for (const empty of ['#s2-summary', '#s2-verdict', '#s2-sweep-summary', '#s3-verdict', '#s3-why', '#s3-reveal', '#s3-table', '#s3-board']) {
    await expect(page.locator(empty)).toBeEmpty();
  }

  // ── Two disclosures, both shut ──────────────────────────────────────────
  // The gate this replaces opened both from script before its only scan.
  await expect(page.locator('#app details')).toHaveCount(2);
  await expect(page.locator('#app details[open]')).toHaveCount(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, which is why the
 * two defects fixed in this repo survived every green run of the gate this
 * replaces: `main` is a `display: grid` whose implicit `auto` track was floored
 * at its widest panel's min-content (509px at 380px), and the `white-space:
 * pre` source listings sized their `<figure>` grid items to 462px (492px
 * document scroll) because a grid item's automatic minimum size is its
 * min-content. The fixes were `grid-template-columns: minmax(0, 1fr)` on both
 * grids and `min-width: 0` on the figures and `<pre>`s; this is what stops
 * either from being quietly reverted.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element. Every
    // `<code>` line inside a `.code-compare pre` is such a decoy once the pre
    // scrolls, and so are the board and measured-data tables inside their
    // scrolling wrappers.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1). If
 * it holds no focusable content it needs `tabindex="0"`, so it becomes a focus
 * target arrow keys can then scroll.
 *
 * This lab has three scroller shapes and they are satisfied differently, which
 * is why the assertion is on the OUTCOME rather than on any mechanism. The two
 * `.code-compare pre` listings carry `tabindex="0"` (plus `role="group"` and an
 * `aria-label`) in `ui.ts`, and they genuinely scroll at 380px where at 1280px
 * they do not — so the requirement only exists in one of the two configurations
 * this gate runs. The two `.chart-data` disclosures scroll their tables but
 * hold a focusable `<summary>`. The four-mode `.board` holds a table with no
 * focusable content at all, so it needs the `tabindex` route.
 *
 * Note the ordering trap this guards: fixing 1.4.10 is what MAKES a container
 * scroll. Before the `min-width: 0` fix the listings grew to fit their content
 * and never overflowed, so a 2.1.1 requirement that now exists did not exist
 * then.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * `tabIndex: 0`, so a keyboard reader tabs to a control that is not on screen
 * and the focus ring lands nowhere. `display: none` and `visibility: hidden` DO
 * remove an element from the tab order, so those are skipped here rather than
 * flagged — the failure is specifically the invisible-but-tabbable pair.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: both skip links on this page have full opacity and
 * a real box, and each slides into view on focus. The drive scans both focused.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI or in the
 * committed workflow, and a run with it set prints every finding as it happens
 * and then fails at the end, so a green collection run cannot be mistaken for a
 * green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no text
 * node.
 *
 * IT IS CALLED FROM `scan()`, deliberately and not by accident. Fleet-wide this
 * oracle had been called from inside `expectScrollersReachable`'s soft wrapper,
 * AFTER that wrapper's `if (!COLLECTING) return` guard — so in a strict run,
 * which is every run in CI and every run anyone reads as a pass, the guard
 * returned first and `nontext.ts` never executed at all. Thirteen repos
 * certified themselves clean on an oracle that had never looked. Calling it
 * here means it runs at every driven state, including `:hover`, and this repo's
 * baseline was captured by that live path.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything
 * in the baseline that has been FIXED fails until its entry is deleted. That
 * last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the point
 * — or the drive stopped reaching the state that shows it, which is a coverage
 * regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Eight assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters more here than in most labs,
 *    because every meaningful surface on this page is a `color-mix()` or a
 *    gradient: all three verdict tones, all three status pills, both
 *    proof-card columns, every reveal-diff cell, the winning candidate chip,
 *    the board-row tints, the table header rows, and every `button`. axe
 *    resolves none of them. Everything else in that bucket is a real result
 *    axe simply could not finish — including `aria-prohibited-attr`, which is
 *    where an `aria-label` on a role-less element hides, a defect that never
 *    reaches the violations array at all. This page depends on getting that
 *    right in several places: `#s3-slots` pairs its recovered-string label
 *    with `role="img"`, both `<canvas>` charts pair theirs with `role="img"`,
 *    the source listings pair theirs with `role="group"`, and the proof card
 *    pairs its with `role="note"`. Drop any of those roles and the label is
 *    silently discarded.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it — load-bearing here
 *    because every text input and secondary button is filled with the exact
 *    colour of the card behind it, so its border is the only thing that makes
 *    it a visible control.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of
  // axe-core 4.12's 105 rule definitions; the chained form executes 4.
  //
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them — and this page
  // has the shape they catch: a sticky `<header role="banner">` above a
  // `<div id="app">` that itself contains a `<header class="cl-hero">` with an
  // `<aside class="cl-hero-why">` inside it, plus two labelled `<nav>`s and a
  // `<footer>` sibling.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr`
  // and `aria-required-children` appear ONLY here — never in `violations` — so
  // a gate that ignores this bucket cannot see either. Only `color-contrast` is
  // allowed to remain, and only because the arithmetic walk below judges those
  // ratios for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}

// ── The drive ───────────────────────────────────────────────────────────────

/**
 * Click a busy-guarded control and prove the click actually started work.
 *
 * Three of this lab's four triggers guard themselves against re-entry —
 * `withRunning()` opens with `if (button.dataset.running === "true") return`
 * for the sweep and the board, and `launch()` opens with `if (running) return`
 * — so a click that lands while a previous run is in flight SILENTLY DOES
 * NOTHING. A drive that clicked and then waited for a completion signal would
 * sail straight through on the PREVIOUS run's completion, having driven
 * nothing.
 *
 * So the click is PROVED to have started a run rather than assumed: a
 * `MutationObserver` armed before the click latches the moment `aria-busy`
 * appears on the button, which both guards set only when a run genuinely
 * starts. A latch cannot be missed the way a poll can. (`#s2-run` is the one
 * trigger this does not apply to: its handler is synchronous and unguarded, so
 * the drive clicks it directly and asserts its summary.)
 */
export async function runGuarded(page: Page, id: string): Promise<void> {
  const button = page.locator(id);
  await expect(button).toBeEnabled({ timeout: 120_000 });
  await button.scrollIntoViewIfNeeded();
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no such control: ${sel}`);
    (window as unknown as { __ranBusy?: boolean }).__ranBusy = false;
    const obs = new MutationObserver(() => {
      if (el.getAttribute('aria-busy') === 'true') {
        (window as unknown as { __ranBusy?: boolean }).__ranBusy = true;
        obs.disconnect();
      }
    });
    obs.observe(el, { attributes: true, attributeFilter: ['aria-busy'] });
  }, id);
  await button.click();
  expect(
    await page.waitForFunction(() => (window as unknown as { __ranBusy?: boolean }).__ranBusy, undefined, {
      timeout: 20_000,
    }),
    `${id} must have actually started a run, not been swallowed by its re-entrancy guard`
  ).toBeTruthy();
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Six things shape this drive:
 *
 *  - THE ARRIVAL STATE IS SCANNED BEFORE ANYTHING IS DRIVEN, with both
 *    `<details>` shut and no measurement rendered. The gate this replaces ran
 *    every demo and opened every disclosure from script before its only scan,
 *    so the state every reader actually arrives in was never measured.
 *
 *  - EVERY RESULT SURFACE IS CLICK-BUILT. Both Section 2 summaries, the sweep
 *    chart and its table, the whole of Section 3's output — slots, progress,
 *    candidate chart, why-panel, verdict, reveal diff, per-position table,
 *    four-mode board — exist only after a run. The drive reaches all of them
 *    and waits on each surface's own completion signal, never on a timeout.
 *
 *  - BOTH DETERMINISTIC VERDICT TONES ARE FORCED. The idealised channel is
 *    noise-free by construction, so vulnerable→ideal ALWAYS yields the `leak`
 *    verdict with a fully recovered secret, and constant-time→ideal ALWAYS
 *    yields the `safe` verdict with the low-confidence admission. The third
 *    tone (`inconclusive`) is genuinely nondeterministic — it is Section 2's
 *    "timer noise dominated" branch — so the drive measures a full-match guess,
 *    where early-exit never fires and the two medians converge, and scans
 *    whichever verdict the clock produced. Its surface (`--warn` at a 12% mix)
 *    sits between two always-scanned neighbours authored from the same tokens:
 *    the `.status.warn` pill (14%) and the `.disproves` proof column (8%).
 *
 *  - THE DISCARD STATES ARE REAL RENDERINGS. Switching target or channel after
 *    a run wipes the verdict, reveal and table; New secret additionally clears
 *    the board. Both are scanned, because each is a state a reader sits in.
 *
 *  - THE BOARD IS SCANNED MID-RUN AND COMPLETE. Its first mode (ideal,
 *    vulnerable) finishes almost instantly, leaving a stable rendering of one
 *    tinted result row above three italic "running…" rows for the long live
 *    mode that follows — the only route to `.board-pending`'s styling.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `:hover` stays on the
 *    element under the pointer after `page.click()` resolves — and the two
 *    shared-bar control shapes (`a.cl-btn`, the `.cl-icon` toggle) repaint
 *    fill, border and ink on hover. Both are scanned hovered. The lab's own
 *    buttons declare no hover style, which was checked rather than assumed.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);
  const S2_SECRET = 'open-sesame-1234';

  await scanAt('arrival, nothing measured, both disclosures shut');

  // ── The two skip links, focused ─────────────────────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('shared skip link focused, slid into view');

  await page.locator('a.skip-link').focus();
  await expect(page.locator('a.skip-link')).toBeFocused();
  await scanAt('the lab own skip link focused, slid in from left:-9999px');

  // ── Section 2: measure both implementations ─────────────────────────────
  await page.locator('#s2-run').click();
  await expect(page.locator('#s2-summary')).toContainText('Matching prefix: 5/16 chars');
  await expect(page.locator('#s2-verdict')).not.toBeEmpty();
  await scanAt('Section 2 measured on the shipped 5-of-16 guess');

  // A full-match guess is the case where early-exit never fires: the two
  // medians converge and the clock decides between the "ran slower" leak
  // wording and the inconclusive "timer noise dominated" branch. Whichever it
  // paints is scanned.
  await page.fill('#s2-guess', S2_SECRET);
  await page.locator('#s2-run').click();
  await expect(page.locator('#s2-summary')).toContainText('Matching prefix: 16/16 chars');
  await scanAt('Section 2 measured on a full-match guess — the clock-decided verdict tone');
  await page.fill('#s2-guess', 'open-XXXXXXXXXXX');

  // ── The prefix sweep ────────────────────────────────────────────────────
  await runGuarded(page, '#s2-sweep');
  await expect(page.locator('#s2-sweep-summary')).not.toBeEmpty({ timeout: 180_000 });
  await expect(page.locator('#s2-sweep')).toBeEnabled({ timeout: 180_000 });
  await scanAt('the sweep complete: line chart painted, summary quoting its endpoints');

  await page.locator('#app details').first().locator('summary').click();
  await expect(page.locator('#app details[open]')).toHaveCount(1);
  await expect(page.locator('#s2-sweep-table table')).toBeVisible();
  await scanAt('sweep data disclosure open: 17-row table with the bytes-examined column');

  // ── Section 3: the recovery attack, on the noise-free channel ───────────
  // The idealised channel is deterministic: against the vulnerable comparator
  // it ALWAYS fully recovers the secret (the leak verdict), and against the
  // constant-time one it ALWAYS fails (the safe verdict). The live channel's
  // renderings are reached through the four-mode board below.
  await page.locator('input[name="channel"][value="ideal"]').check();
  await runGuarded(page, '#s3-run');
  await expect(page.locator('#s3-verdict')).not.toBeEmpty({ timeout: 180_000 });
  await expect(page.locator('#s3-run')).toBeEnabled({ timeout: 180_000 });
  await expect(page.locator('#s3-verdict')).toContainText('Secret fully recovered');
  await expect(page.locator('#s3-slots .slot.filled')).toHaveCount(12);
  await expect(page.locator('#s3-reveal .ch.ok')).toHaveCount(12);
  await scanAt('attack complete: leak verdict, filled slots, all-green reveal diff, why-panel');

  await page.locator('#app details').nth(1).locator('summary').click();
  await expect(page.locator('#s3-table table')).toBeVisible();
  await scanAt('per-position data disclosure open');

  // Switching the target discards the previous result — a real rendering a
  // reader sits in, and the state the old gate could never see because it
  // never changed a control after running.
  await page.locator('input[name="defense"][value="constant-time"]').check();
  await expect(page.locator('#s3-verdict')).toBeEmpty();
  await expect(page.locator('#s3-reveal')).toBeEmpty();
  await expect(page.locator('#s3-slots .slot.filled')).toHaveCount(0);
  await scanAt('config change discarded the results: empty verdict, cleared slots, open-but-empty disclosure');

  await runGuarded(page, '#s3-run');
  await expect(page.locator('#s3-verdict')).not.toBeEmpty({ timeout: 180_000 });
  await expect(page.locator('#s3-run')).toBeEnabled({ timeout: 180_000 });
  await expect(page.locator('#s3-verdict')).toContainText('Attack failed — constant-time held');
  await expect(page.locator('#s3-why .lowconf')).toBeVisible();
  await scanAt('the defense held: safe verdict, red diff cells, low-confidence admission');

  await page.locator('#s3-regen').click();
  await expect(page.locator('#s3-verdict')).toBeEmpty();
  await expect(page.locator('#s3-slots .slot.filled')).toHaveCount(0);
  await expect(page.locator('#s3-progress')).toHaveAttribute('aria-valuenow', '0');
  await scanAt('New secret pressed: everything cleared, a fresh hidden secret loaded');

  // ── The four-mode board ─────────────────────────────────────────────────
  // Mode 1 (idealised, vulnerable) completes almost instantly; mode 2 is a
  // live attack, which holds the board stable for a scan of the mixed
  // rendering — one tinted verdict row above three pending rows. That is the
  // only route to `.board-pending`'s italic muted styling.
  await runGuarded(page, '#s3-board-run');
  await expect(page.locator('#s3-board table')).toBeVisible({ timeout: 60_000 });
  // Wait for the first mode to land rather than for an exact pending count: on
  // a fast machine a later mode could finish between two polls, and an
  // equality wait would then never match. If the whole board somehow finishes
  // first, the scan below simply measures the complete rendering twice, which
  // is harmless — the pending styling is decorative (italic, muted) and is
  // judged by the same oracles whenever it IS on screen.
  await page.waitForFunction(
    () => {
      const rows = document.querySelectorAll('#s3-board tr.board-row').length;
      const pending = document.querySelectorAll('#s3-board tr.board-pending').length;
      return rows === 4 && pending <= 3;
    },
    undefined,
    { timeout: 120_000 }
  );
  await scanAt('board mid-run: tinted verdict rows above italic pending rows');

  await expect(page.locator('#s3-board tr.board-pending')).toHaveCount(0, { timeout: 300_000 });
  await expect(page.locator('#s3-board-run')).toBeEnabled({ timeout: 300_000 });
  await scanAt('board complete: all four target-channel modes rendered');

  // ── Hover, which persists after a click ─────────────────────────────────
  await page.locator('.cl-actions a.cl-btn').first().hover();
  await scanAt('the shared bar Menu control hovered');

  await page.locator('#cl-theme-toggle').hover();
  await scanAt('the shared bar theme toggle hovered');

  // ── Focus rings on the controls that take them ──────────────────────────
  await page.locator('#s2-secret').focus();
  await expect(page.locator('#s2-secret')).toBeFocused();
  await scanAt('a text input focused, showing its focus-visible outline');

  await page.locator('#s2-run').focus();
  await scanAt('a run button focused, showing its focus-visible outline');

  await page.locator('.code-compare pre').first().focus();
  await expect(page.locator('.code-compare pre').first()).toBeFocused();
  await scanAt('a source listing focused — the keyboard route into the scroller at 380px');

  // ── The theme switched IN PLACE, without a reload ───────────────────────
  // Every other configuration seeds the theme through localStorage before
  // `goto`, so this is the only state where the page is repainted live — the
  // canvases redraw through the MutationObserver on `data-theme` — with every
  // result already on screen.
  const other = theme.startsWith('dark') ? 'light' : 'dark';
  await page.click('#cl-theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', other);
  await scan(page, `${theme} / switched live to ${other} with every result already rendered`);
}
