import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Claims gate — asserts the states this lab actually claims, not merely that it
 * rendered. The a11y spec proves the page is reachable; this proves it is right.
 *
 * Design note on flakiness: the live channel is deliberately noisy, so every
 * assertion here is either (a) driven through the idealised operation-count
 * channel, which is noise-free by construction, or (b) an internal-consistency
 * check that holds for ANY outcome (the stated score matches the characters the
 * page itself marked correct; the verdict label matches the numbers next to it).
 * Nothing below depends on a lucky measurement.
 */

const SECRET_LENGTH = 12;
const SWEEP_SECRET = 'open-sesame-1234';

function numOf(text: string | null): number {
  const m = (text ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) throw new Error(`no number found in ${JSON.stringify(text)}`);
  return Number(m[0]);
}

/** Rows of a rendered data table as arrays of trimmed cell text (row header included). */
async function tableRows(host: Locator): Promise<string[][]> {
  return host.evaluate((node) =>
    Array.from(node.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('th,td')).map((cell) => (cell.textContent ?? '').trim()),
    ),
  );
}

/** Choose the target implementation and timing channel. Must precede a launch: changing either resets. */
async function configure(page: Page, defense: 'vulnerable' | 'constant-time', channel: 'live' | 'ideal'): Promise<void> {
  await page.locator(`input[name="defense"][value="${defense}"]`).check();
  await page.locator(`input[name="channel"][value="${channel}"]`).check();
}

async function launchAndSettle(page: Page, timeout = 120_000): Promise<void> {
  await page.locator('#s3-run').click();
  await expect(page.locator('#s3-verdict')).not.toBeEmpty({ timeout });
  await expect(page.locator('#s3-run')).toBeEnabled({ timeout });
}

/** The secret the page revealed after a completed run, read off the coloured diff. */
async function revealedSecret(page: Page): Promise<string> {
  return (await page.locator('#s3-reveal .reveal-row').first().locator('.ch').allInnerTexts()).join('');
}

async function revealedRecovered(page: Page): Promise<string> {
  return (await page.locator('#s3-reveal .reveal-row').nth(1).locator('.reveal-val').innerText()).trim();
}

/** The "N/12 characters" score the page printed for itself. */
async function revealedScore(page: Page): Promise<number> {
  return numOf(await page.locator('#s3-reveal .reveal-row').nth(2).locator('.reveal-val').innerText());
}

test.beforeEach(async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('#app main')).toBeVisible();
});

// ------------------------------------------------------- Section 2: the leak

test('the page starts with nothing revealed and nothing recovered', async ({ page }) => {
  await expect(page.locator('#s3-reveal')).toBeEmpty();
  await expect(page.locator('#s3-verdict')).toBeEmpty();
  await expect(page.locator('#s3-slots .slot')).toHaveCount(SECRET_LENGTH);
  await expect(page.locator('#s3-slots .slot.filled')).toHaveCount(0);
  await expect(page.locator('#s3-status')).toContainText(`A ${SECRET_LENGTH}-character secret is loaded and hidden`);
  await expect(page.locator('#s3-progress')).toHaveAttribute('aria-valuenow', '0');
});

test('measuring both implementations reports the matching prefix it actually has', async ({ page }) => {
  await page.locator('#s2-run').click();

  const summary = page.locator('#s2-summary');
  await expect(summary).not.toBeEmpty();
  const text = (await summary.innerText()).replace(/\s+/g, ' ');

  // Default secret "open-sesame-1234" vs guess "open-XXXXXXXXXXX": the shared
  // prefix is "open-" — five characters — and the page must say so.
  const prefix = text.match(/Matching prefix: (\d+)\/(\d+) chars/)!;
  expect(Number(prefix[1])).toBe(5);
  expect(Number(prefix[2])).toBe(SWEEP_SECRET.length);

  const medians = text.match(/Vulnerable median ([\d.]+) ms · constant-time median ([\d.]+) ms/)!;
  const vulnMs = Number(medians[1]);
  const ctMs = Number(medians[2]);
  // Not asserted to be strictly positive: a coarsened browser clock can round a
  // short batch to 0.0000 ms, which is exactly the "timer noise dominated" case
  // the page has a verdict for. What must hold is that the verdict matches them.
  expect(Number.isFinite(vulnMs)).toBe(true);
  expect(Number.isFinite(ctMs)).toBe(true);

  // The verdict must agree with the two numbers printed beside it.
  const verdict = page.locator('#s2-verdict');
  const verdictText = await verdict.innerText();
  const gap = Math.abs(vulnMs - ctMs) / Math.max(vulnMs, ctMs, 1e-9);
  if (gap > 0.1) {
    await expect(verdict).toHaveClass(/verdict--leak/);
    expect(verdictText).toContain(vulnMs < ctMs ? 'Vulnerable path ran faster' : 'Vulnerable path ran slower');
  } else {
    await expect(verdict).toHaveClass(/verdict--inconclusive/);
    expect(verdictText).toContain('Timer noise dominated this run');
  }
});

test('editing the guess to match in full is reported as a full-width prefix', async ({ page }) => {
  await page.locator('#s2-guess').fill(SWEEP_SECRET);
  await page.locator('#s2-run').click();
  await expect(page.locator('#s2-summary')).toContainText(
    `Matching prefix: ${SWEEP_SECRET.length}/${SWEEP_SECRET.length} chars`,
  );
});

test('a guess that matches nothing is reported as a zero-length prefix', async ({ page }) => {
  await page.locator('#s2-guess').fill('X'.repeat(SWEEP_SECRET.length));
  await page.locator('#s2-run').click();
  await expect(page.locator('#s2-summary')).toContainText(`Matching prefix: 0/${SWEEP_SECRET.length} chars`);
});

test('the sweep’s timer-free "bytes examined" column is exactly the early-exit control flow', async ({ page }) => {
  await page.locator('#s2-sweep').click();
  await expect(page.locator('#s2-sweep-summary')).not.toBeEmpty({ timeout: 120_000 });

  const rows = await tableRows(page.locator('#s2-sweep-table'));
  // One row per matching-prefix length, 0 through full width inclusive.
  expect(rows).toHaveLength(SWEEP_SECRET.length + 1);

  rows.forEach((row, matched) => {
    expect(Number(row[0])).toBe(matched);
    // The vulnerable comparator examines the matched bytes plus the mismatching
    // one, and saturates at the full width once the guess is exactly right.
    // This column is derived from control flow with no clock, so it is exact.
    const expected = matched >= SWEEP_SECRET.length ? SWEEP_SECRET.length : matched + 1;
    expect(Number(row[3]), `row for prefix ${matched}`).toBe(expected);
  });

  // Strictly rising until saturation — the leak's shape, stated without a timer.
  const examined = rows.map((r) => Number(r[3]));
  for (let i = 1; i < examined.length - 1; i += 1) {
    expect(examined[i]).toBeGreaterThan(examined[i - 1]);
  }
  expect(examined[examined.length - 1]).toBe(examined[examined.length - 2]);
});

test('the sweep summary quotes the same endpoints its own table holds', async ({ page }) => {
  await page.locator('#s2-sweep').click();
  await expect(page.locator('#s2-sweep-summary')).not.toBeEmpty({ timeout: 120_000 });

  const rows = await tableRows(page.locator('#s2-sweep-table'));
  const first = Number(rows[0][1]);
  const last = Number(rows[rows.length - 1][1]);

  const text = (await page.locator('#s2-sweep-summary').innerText()).replace(/\s+/g, ' ');
  const quoted = text.match(
    /went from ([\d.]+) ms \(0 correct\) to ([\d.]+) ms \(all (\d+) correct\) — a (?:rise|change) of (-?[\d.]+) ms/,
  );
  expect(quoted, `unparsed sweep summary: ${text}`).not.toBeNull();

  expect(Number(quoted![1])).toBeCloseTo(first, 4);
  expect(Number(quoted![2])).toBeCloseTo(last, 4);
  expect(Number(quoted![3])).toBe(SWEEP_SECRET.length);
  // The advertised delta is the difference of its own endpoints.
  expect(Number(quoted![4])).toBeCloseTo(last - first, 3);
});

// -------------------------------------------------- Section 3: the recovery

test('against the vulnerable comparator the idealised channel recovers the whole secret', async ({ page }) => {
  await configure(page, 'vulnerable', 'ideal');
  await launchAndSettle(page);

  const actual = await revealedSecret(page);
  const recovered = await revealedRecovered(page);
  expect(actual).toHaveLength(SECRET_LENGTH);
  expect(recovered).toBe(actual);

  // The score line, the coloured diff and the recovered string must all agree.
  expect(await revealedScore(page)).toBe(SECRET_LENGTH);
  await expect(page.locator('#s3-reveal .ch.ok')).toHaveCount(SECRET_LENGTH);
  await expect(page.locator('#s3-reveal .ch.bad')).toHaveCount(0);

  const verdict = page.locator('#s3-verdict');
  await expect(verdict).toHaveClass(/verdict--leak/);
  await expect(verdict).toContainText('Secret fully recovered');
  await expect(verdict).toContainText(`All ${SECRET_LENGTH} characters were extracted`);
  await expect(verdict).toContainText('idealised operation-count channel');

  // The recovery strip mirrors the recovered string, character for character.
  const slots = (await page.locator('#s3-slots .slot.filled').allInnerTexts()).join('');
  expect(slots).toBe(recovered);
  await expect(page.locator('#s3-progress')).toHaveAttribute('aria-valuenow', '100');
});

test('the final character is recovered too — the trailing-sentinel claim the README makes', async ({ page }) => {
  await configure(page, 'vulnerable', 'ideal');
  await launchAndSettle(page);

  const actual = await revealedSecret(page);
  const slots = await page.locator('#s3-slots .slot').allInnerTexts();
  expect(slots[SECRET_LENGTH - 1]).toBe(actual[SECRET_LENGTH - 1]);
  await expect(page.locator('#s3-why')).toContainText('known trailing delimiter');
});

test('the per-position table spells out the same secret the verdict claims', async ({ page }) => {
  await configure(page, 'vulnerable', 'ideal');
  await launchAndSettle(page);

  const recovered = await revealedRecovered(page);
  const rows = await tableRows(page.locator('#s3-table'));
  expect(rows).toHaveLength(SECRET_LENGTH);

  // Position column is 1..N in order, and the Char column IS the recovered secret.
  expect(rows.map((r) => Number(r[0]))).toEqual([...Array(SECRET_LENGTH)].map((_, i) => i + 1));
  expect(rows.map((r) => r[1]).join('')).toBe(recovered);

  // Measurement counts are cumulative, so they never go backwards, and the
  // running total the status line quotes is the table's last entry.
  const measurements = rows.map((r) => Number(r[4]));
  for (let i = 1; i < measurements.length; i += 1) {
    expect(measurements[i]).toBeGreaterThan(measurements[i - 1]);
  }
  const status = (await page.locator('#s3-status').innerText()).replace(/\s+/g, ' ');
  expect(numOf(status.match(/([\d,]+) timing measurements so far/)![1])).toBe(measurements[measurements.length - 1]);
});

test('against the constant-time comparator the same attack fails, and says the defense held', async ({ page }) => {
  await configure(page, 'constant-time', 'ideal');
  await launchAndSettle(page);

  const actual = await revealedSecret(page);
  const recovered = await revealedRecovered(page);
  const score = await revealedScore(page);

  expect(recovered).not.toBe(actual);
  expect(score).toBeLessThan(SECRET_LENGTH);

  // The score the page prints equals the characters it coloured green — the two
  // renderings of the same number cannot drift apart.
  await expect(page.locator('#s3-reveal .ch.ok')).toHaveCount(score);
  await expect(page.locator('#s3-reveal .ch.bad')).toHaveCount(SECRET_LENGTH - score);
  let matches = 0;
  for (let i = 0; i < SECRET_LENGTH; i += 1) if (recovered[i] === actual[i]) matches += 1;
  expect(matches).toBe(score);

  const verdict = page.locator('#s3-verdict');
  await expect(verdict).toHaveClass(/verdict--safe/);
  await expect(verdict).toContainText('Attack failed — constant-time held');
  await expect(verdict).toContainText(`Only ${score}/${SECRET_LENGTH} characters happened to match`);
  await expect(verdict).toContainText('timing reveals nothing');

  // Every position was a coin flip, and the page admits it rather than
  // presenting a guess as a read.
  await expect(page.locator('#s3-why .lowconf')).toBeVisible();
});

test('the live channel leaks too — whatever it recovers, the verdict matches the score', async ({ page }) => {
  test.setTimeout(240_000);
  await configure(page, 'vulnerable', 'live');
  await launchAndSettle(page, 180_000);

  const actual = await revealedSecret(page);
  const recovered = await revealedRecovered(page);
  const score = await revealedScore(page);
  await expect(page.locator('#s3-reveal .ch.ok')).toHaveCount(score);

  const verdict = page.locator('#s3-verdict');
  // Inverted semantics: a recovered secret is a defender's catastrophe, so a
  // vulnerable target is never allowed to read as "safe".
  await expect(verdict).toHaveClass(/verdict--leak/);
  if (score === SECRET_LENGTH) {
    expect(recovered).toBe(actual);
    await expect(verdict).toContainText('Secret fully recovered');
    await expect(verdict).toContainText('live performance.now() timing alone');
  } else {
    await expect(verdict).toContainText(`Partial recovery — ${score}/${SECRET_LENGTH} characters`);
    await expect(verdict).toContainText('The leak is real');
  }
});

// ------------------------------------------ Section 3: the four-mode board

test('the four-mode board wins only where the implementation leaks', async ({ page }) => {
  test.setTimeout(300_000);

  // Learn the secret first, from a run against the same in-memory box.
  await configure(page, 'vulnerable', 'ideal');
  await launchAndSettle(page);
  const actual = await revealedSecret(page);

  await page.locator('#s3-board-run').click();
  await expect(page.locator('#s3-board table')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#s3-board .board-row')).toHaveCount(4);
  await expect(page.locator('#s3-board .board-pending')).toHaveCount(0, { timeout: 240_000 });

  const rows = await tableRows(page.locator('#s3-board'));
  expect(rows.map((r) => r[0])).toEqual([
    'Vulnerable · idealised',
    'Vulnerable · live timing',
    'Constant-time · idealised',
    'Constant-time · live timing',
  ]);

  for (const row of rows) {
    const [label, recovered, score] = row;
    expect(recovered, `${label} recovered a full-width candidate`).toHaveLength(SECRET_LENGTH);
    // Every row's score is the count of characters it actually got right.
    let matches = 0;
    for (let i = 0; i < SECRET_LENGTH; i += 1) if (recovered[i] === actual[i]) matches += 1;
    expect(numOf(score), `${label} score disagrees with its own recovered string`).toBe(matches);
  }

  // The noise-free channel is the decisive comparison: it wins outright against
  // the leaky comparator and loses against the constant-time one.
  expect(rows[0][2]).toContain(`${SECRET_LENGTH}/${SECRET_LENGTH}`);
  expect(rows[0][1]).toBe(actual);
  expect(rows[0][4]).toContain('leak');

  expect(numOf(rows[2][2])).toBeLessThan(SECRET_LENGTH);
  expect(rows[2][1]).not.toBe(actual);
  expect(rows[2][4]).toContain('safe');

  // And the live constant-time row must never claim a win either.
  expect(numOf(rows[3][2])).toBeLessThan(SECRET_LENGTH);
});

// ------------------------------------------------------- controls behave

test('New secret clears every result and installs a genuinely different secret', async ({ page }) => {
  await configure(page, 'vulnerable', 'ideal');
  await launchAndSettle(page);
  const first = await revealedSecret(page);

  await page.locator('#s3-regen').click();
  await expect(page.locator('#s3-reveal')).toBeEmpty();
  await expect(page.locator('#s3-verdict')).toBeEmpty();
  await expect(page.locator('#s3-table')).toBeEmpty();
  await expect(page.locator('#s3-board')).toBeEmpty();
  await expect(page.locator('#s3-slots .slot.filled')).toHaveCount(0);
  await expect(page.locator('#s3-progress')).toHaveAttribute('aria-valuenow', '0');

  await launchAndSettle(page);
  const second = await revealedSecret(page);
  expect(second).toHaveLength(SECRET_LENGTH);
  expect(second).not.toBe(first);
  // Still fully recovered — the attack works on any secret, not a planted one.
  expect(await revealedScore(page)).toBe(SECRET_LENGTH);
});

test('switching target or channel discards the previous verdict instead of leaving it stale', async ({ page }) => {
  await configure(page, 'vulnerable', 'ideal');
  await launchAndSettle(page);
  await expect(page.locator('#s3-verdict')).toContainText('Secret fully recovered');

  await page.locator('input[name="defense"][value="constant-time"]').check();
  await expect(page.locator('#s3-verdict')).toBeEmpty();
  await expect(page.locator('#s3-reveal')).toBeEmpty();
  await expect(page.locator('#s3-slots .slot.filled')).toHaveCount(0);
});

// ------------------------------------------------------ README-visible claims

test('the honesty caveats the README leans on are on the page, not only in the docs', async ({ page }) => {
  await expect(page.locator('.proof-card .proves')).toContainText('no access to the secret');
  await expect(page.locator('.proof-card .disproves')).toContainText('trailing delimiter');
  await expect(page.locator('.caveat')).toContainText('amplified, never faked');
  await expect(page.locator('.panel-note', { hasText: 'does not create the leak' })).toHaveCount(1);
});
