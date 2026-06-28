/**
 * UI for the Timing Side-Channel lab. The centre of gravity is Section 3: an
 * animated, byte-by-byte secret-recovery attack driven purely by the oracle's
 * timing. Sections 1, 2, 4 and 5 frame it (what a timing channel is, the two
 * implementations, why constant-time is hard, and the defenses).
 */

import {
  defaultAttackOptions,
  makeStep,
  probePosition,
  type AttackOptions
} from "./timing/attack";
import {
  DEFAULT_ALPHABET,
  generateSecret,
  makeLiveOracle,
  makeOracle,
  makeSecretBox,
  type MeasureOptions
} from "./timing/measure";
import { bytesExaminedVulnerable, guessWithMatchedPrefix } from "./timing/compare";
import { median, renderCandidateBars, renderDataTable, renderLineChart } from "./timing/stats";
import type { AttackStep, Channel, Defense, SecretBox } from "./timing/types";
import { attackVerdict, correctCharacters, type Verdict } from "./timing/verdict";

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing required element: ${id}`);
  }
  return node as T;
}

const redraws: Array<() => void> = [];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Disable a trigger, show a Running… state, paint it, then run the (possibly heavy) work. */
async function withRunning(button: HTMLButtonElement, work: () => void | Promise<void>): Promise<void> {
  if (button.dataset.running === "true") {
    return;
  }
  const label = button.dataset.label ?? button.textContent ?? "Run";
  button.dataset.label = label;
  button.dataset.running = "true";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Running…";
  await nextFrame(); // let the Running… state paint before the synchronous work
  try {
    await work();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.dataset.running = "false";
    button.textContent = label;
  }
}

function setVerdict(id: string, verdict: Verdict): void {
  const node = byId<HTMLDivElement>(id);
  node.className = `verdict verdict--${verdict.tone}`;
  const icon = verdict.tone === "leak" ? "⚠" : verdict.tone === "safe" ? "✓" : "•";
  node.innerHTML = `<strong>${icon} ${verdict.label}.</strong> ${verdict.detail}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}

function displayChar(ch: string): string {
  return ch === " " ? "␣" : escapeHtml(ch);
}

/* ------------------------------------------------------------------ *
 * Static source shown in Section 2 (kept in sync with compare.ts by hand,
 * trimmed to the load-bearing lines so the contrast is obvious)
 * ------------------------------------------------------------------ */

const VULNERABLE_SRC = `function vulnerableCompare(secret, guess) {
  if (secret.length !== guess.length) return false;
  for (let i = 0; i < secret.length; i++) {
    // ⚠ returns the instant a byte differs:
    // time scales with the matching prefix length
    if (secret[i] !== guess[i]) return false;
  }
  return true;
}`;

const CONSTANT_SRC = `function constantTimeCompare(secret, guess) {
  let diff = secret.length ^ guess.length;
  for (let i = 0; i < secret.length; i++) {
    // ✓ no early exit, no secret-dependent branch:
    // every byte is always examined
    diff |= secret.charCodeAt(i) ^ guess.charCodeAt(i);
  }
  return diff === 0;
}`;

/* ------------------------------------------------------------------ *
 * App shell
 * ------------------------------------------------------------------ */

function renderAppShell(): void {
  const app = byId<HTMLDivElement>("app");
  app.innerHTML = `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <header class="hero" role="banner" aria-label="Demo header">
      <div class="category-chip">Side-Channel Attacks</div>
      <h1>Timing Side-Channel</h1>
      <p class="subtitle">Watch a secret get pulled out of pure timing — one byte at a time — from a comparison that exits early. Real <code>performance.now()</code> measurements, no backend.</p>
      <div class="chip-row">
        <span class="primitive-chip">Timing Attack</span>
        <span class="primitive-chip">Constant-Time</span>
        <span class="primitive-chip">Secret Recovery</span>
        <span class="primitive-chip">performance.now()</span>
      </div>
    </header>

    <main id="main-content" aria-label="Timing side-channel demo">
      <section class="why" aria-labelledby="s1-title">
        <h2 id="s1-title">1 · What is a timing side-channel?</h2>
        <p>
          A cryptographic check can be mathematically perfect and still leak its secret — through <em>how long it takes</em>.
          If code decides faster when more of your guess is right, the clock becomes an oracle.
        </p>
        <p class="panel-note">
          <strong>Analogy.</strong> Imagine a lock that clicks for every correct digit before rejecting a wrong one. You don't need the combination — you just turn each dial until you hear the extra click, then move to the next. The timing of the rejection <em>is</em> the leak.
        </p>
        <p class="panel-note">
          Real attacks of exactly this shape have broken production systems: Kocher's RSA/Diffie-Hellman timing attacks (1996), Bernstein's AES cache-timing key recovery (2005), the Lucky&nbsp;13 TLS attack (2013), and a long line of non-constant-time MAC/token comparison CVEs in web frameworks.
        </p>
      </section>

      <section class="panel" aria-labelledby="s2-title">
        <div class="panel-head">
          <h2 id="s2-title">2 · Vulnerable vs constant-time</h2>
          <div class="status-row">
            <span class="status bad">Early-exit: leaks</span>
            <span class="status good">Constant-time: safe</span>
          </div>
        </div>
        <p class="panel-text">The same comparison, two ways. Pick a demo secret and a guess, then measure both. The constant-time version is flat no matter how much of your guess is correct; the vulnerable one is not.</p>
        <div class="code-compare">
          <figure>
            <figcaption class="code-cap bad">Vulnerable — exits on first mismatch</figcaption>
            <pre tabindex="0" aria-label="Vulnerable comparison source"><code>${escapeHtml(VULNERABLE_SRC)}</code></pre>
          </figure>
          <figure>
            <figcaption class="code-cap good">Constant-time — always full width</figcaption>
            <pre tabindex="0" aria-label="Constant-time comparison source"><code>${escapeHtml(CONSTANT_SRC)}</code></pre>
          </figure>
        </div>
        <div class="controls two-col">
          <label for="s2-secret">Demo secret (visible here for experimenting)</label>
          <input id="s2-secret" aria-label="Demo secret" value="open-sesame-1234" />
          <label for="s2-guess">Your guess</label>
          <input id="s2-guess" aria-label="Your guess" value="open-XXXXXXXXXXX" />
          <button id="s2-run" type="button">Measure both implementations</button>
        </div>
        <p id="s2-summary" class="chart-summary" aria-live="polite"></p>
        <div id="s2-verdict" class="verdict" role="status" aria-live="polite"></div>

        <h3 class="subhead">The leak has a shape</h3>
        <p class="panel-text">Sweep every matching-prefix length from 0 to full and plot how long each implementation takes. The vulnerable line climbs one step per correct character; the constant-time line is flat. That rising curve is the whole attack in one picture — before you extract a single byte.</p>
        <button id="s2-sweep" type="button">Sweep all prefix lengths</button>
        <canvas id="s2-sweep-canvas" aria-label="Timing vs matching prefix length for vulnerable and constant-time comparison" role="img"></canvas>
        <p id="s2-sweep-summary" class="chart-summary" aria-live="polite"></p>
        <details class="chart-data"><summary>Show sweep data (including exact bytes examined)</summary><div id="s2-sweep-table"></div></details>
      </section>

      <section class="panel attack" aria-labelledby="s3-title">
        <div class="panel-head">
          <h2 id="s3-title">3 · Be the attacker — recover the secret from timing</h2>
          <span class="status warn">The secret below is random and hidden. The attack never sees it — only its timing.</span>
        </div>
        <p class="panel-text">
          A fresh secret is generated in memory and never shown to the attack code. The attacker tries every character at each position, keeps the one that takes longest, and moves on. Launch it and watch the secret appear.
        </p>

        <div class="proof-card" role="note" aria-label="What this proves and does not prove">
          <div class="proof-col proves">
            <h3>What this proves</h3>
            <ul>
              <li>An early-exit comparison leaks how many leading bytes of a guess are correct.</li>
              <li>Repeated timing measurements alone can recover a full secret — no access to the secret or to any pass/fail result.</li>
              <li>A constant-time comparison removes the signal: the same attack drops to chance.</li>
            </ul>
          </div>
          <div class="proof-col disproves">
            <h3>What it does <em>not</em> prove</h3>
            <ul>
              <li>That constant-time <em>source</em> is constant-time on the metal — a JS JIT, CPU, or compiler can reintroduce leaks.</li>
              <li>That browser timers match a native attacker's resolution (they're deliberately coarsened post-Spectre).</li>
              <li>That adding random delays is a sound defense — it is not; remove the data dependence instead.</li>
            </ul>
          </div>
        </div>

        <div class="attack-config">
          <fieldset>
            <legend>Target implementation</legend>
            <label><input type="radio" name="defense" value="vulnerable" checked /> Vulnerable (early-exit)</label>
            <label><input type="radio" name="defense" value="constant-time" /> Constant-time (defended)</label>
          </fieldset>
          <fieldset>
            <legend>Timing channel</legend>
            <label><input type="radio" name="channel" value="live" checked /> Live <code>performance.now()</code></label>
            <label><input type="radio" name="channel" value="ideal" /> Idealised (operation count, no noise)</label>
          </fieldset>
          <fieldset>
            <legend>Effort: measurements per byte</legend>
            <label for="s3-effort" class="sr-only">Measurements per byte</label>
            <input type="range" id="s3-effort" min="0" max="2" step="1" value="1" aria-describedby="s3-effort-note" />
            <span id="s3-effort-note" class="panel-note">More measurements beat down timer noise but take longer.</span>
          </fieldset>
        </div>

        <div class="attack-actions">
          <button id="s3-run" type="button">Launch attack</button>
          <button id="s3-regen" type="button" class="secondary">New secret</button>
        </div>

        <div class="recovery" aria-label="Recovered secret so far">
          <div class="recovery-label">Recovered:</div>
          <div id="s3-slots" class="slots" role="img" aria-label="Recovered characters"></div>
        </div>

        <div id="s3-progress" class="progress" role="progressbar" aria-label="Attack progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div id="s3-progress-fill" class="progress-fill"></div>
        </div>

        <p id="s3-status" class="chart-summary"></p>
        <p id="s3-sr" class="sr-only" role="status" aria-live="polite"></p>
        <canvas id="s3-canvas" aria-label="Timing cost per candidate character at the current position" role="img"></canvas>
        <div id="s3-why" class="why-won"></div>
        <div id="s3-verdict" class="verdict" role="status" aria-live="polite"></div>
        <div id="s3-reveal" class="reveal" aria-live="polite"></div>
        <details class="chart-data"><summary>Show per-position data</summary><div id="s3-table"></div></details>

        <h3 class="subhead">Prove it can't be cheating — run all four modes</h3>
        <p class="panel-text">Run the <em>same</em> hidden secret through every combination of target and channel. The attack should fully recover the secret only when the implementation leaks, and the idealised channel should match the live one in shape — confirming it isn't faking the result, just removing the timer noise.</p>
        <button id="s3-board-run" type="button" class="secondary">Run all four modes</button>
        <div id="s3-board" class="board"></div>
      </section>

      <section class="why" aria-labelledby="s4-title">
        <h2 id="s4-title">4 · Why constant-time is hard</h2>
        <ul class="rules">
          <li><strong>The compiler fights you.</strong> An optimizer can reintroduce a branch or short-circuit you wrote constant-time, or hoist a secret-dependent check.</li>
          <li><strong>The hardware fights you.</strong> Caches, branch predictors, and variable-latency instructions (division, multiplication on some cores) make “the same code” take secret-dependent time.</li>
          <li><strong>The language fights you.</strong> In a JIT like JavaScript's, bounds checks, string interning, and garbage collection can add data-dependent timing you can't see in the source.</li>
          <li><strong>Small leaks compound.</strong> A sub-nanosecond per-byte difference is invisible in one call and decisive over millions of measurements — which is exactly what the attack above exploits.</li>
        </ul>
        <p class="panel-note">This is why constant-time code is written against the machine, tested with tools (dudect, ctgrind, TIMECOP), and—where possible—handed to vetted primitives instead of hand-rolled.</p>
      </section>

      <section class="panel" aria-labelledby="s5-title">
        <h2 id="s5-title">5 · Defenses &amp; best practices</h2>
        <ol class="rules" aria-label="Constant-time defense checklist">
          <li>No secret-dependent branches.</li>
          <li>No secret-dependent memory accesses (table indices, array bounds).</li>
          <li>No secret-dependent loop counts or early exits.</li>
          <li>Compare secrets, MACs, and tokens with a constant-time equality, never <code>==</code> / <code>memcmp</code>.</li>
          <li>Prefer vetted primitives over hand-rolled crypto.</li>
        </ol>
        <p class="panel-note">
          In practice: <code>crypto.timingSafeEqual</code> (Node), <code>hmac.compare_digest</code> (Python), <code>sodium_memcmp</code> (libsodium), the <code>@noble</code> family, and formally verified code such as HACL*. RSA implementations add blinding; AES uses AES-NI to avoid lookup-table cache leaks.
        </p>
        <nav class="links" aria-label="Related demos">
          <a href="https://github.com/systemslibrarian/crypto-lab-timing-oracle" target="_blank" rel="noreferrer">crypto-lab-timing-oracle</a>
          <a href="https://github.com/systemslibrarian/crypto-lab-padding-oracle" target="_blank" rel="noreferrer">crypto-lab-padding-oracle</a>
          <a href="https://github.com/systemslibrarian/crypto-lab-kyberslash" target="_blank" rel="noreferrer">crypto-lab-kyberslash</a>
          <a href="https://github.com/systemslibrarian/crypto-lab-hqc-timing" target="_blank" rel="noreferrer">crypto-lab-hqc-timing</a>
          <a href="https://crypto-lab.systemslibrarian.dev/" target="_blank" rel="noreferrer">crypto-lab landing page</a>
        </nav>
        <p class="panel-note caveat">
          <strong>Honesty note.</strong> The “constant-time” comparator here is the correct <em>source-level</em> pattern, not an engine-level guarantee — a JS JIT can still leak. Browser timers are deliberately coarsened post-Spectre, so the live channel is noisier than native code; the idealised channel shows the same leak without that noise. The per-byte cost is amplified by real repeated work so the genuine early-exit effect clears timer granularity — it is amplified, never faked.
        </p>
      </section>
    </main>
  `;
}

/* ------------------------------------------------------------------ *
 * Section 2 — manual measurement of both implementations
 * ------------------------------------------------------------------ */

const SECTION2_OPTS: MeasureOptions = { loops: 2400, work: 24 };
const SECTION2_BATCHES = 9;

function wireComparePanel(): void {
  const run = byId<HTMLButtonElement>("s2-run");
  const secretInput = byId<HTMLInputElement>("s2-secret");
  const guessInput = byId<HTMLInputElement>("s2-guess");
  const summary = byId<HTMLParagraphElement>("s2-summary");

  run.addEventListener("click", () => {
    const secret = secretInput.value;
    const guess = guessInput.value;
    // pad/truncate the guess to the secret length so the comparators run (they require equal length)
    const normalizedGuess = guess.slice(0, secret.length).padEnd(secret.length, " ");
    const vuln = makeLiveOracle(secret, "vulnerable", SECTION2_OPTS);
    const ct = makeLiveOracle(secret, "constant-time", SECTION2_OPTS);
    // each measure() is one noisy batch; median several for a stable reading
    const vulnSamples: number[] = [];
    const ctSamples: number[] = [];
    for (let i = 0; i < SECTION2_BATCHES; i += 1) {
      vulnSamples.push(vuln.measure(normalizedGuess));
      ctSamples.push(ct.measure(normalizedGuess));
    }
    const vulnMs = median(vulnSamples);
    const ctMs = median(ctSamples);
    let matched = 0;
    while (matched < secret.length && secret[matched] === normalizedGuess[matched]) {
      matched += 1;
    }
    summary.textContent =
      `Matching prefix: ${matched}/${secret.length} chars. ` +
      `Vulnerable median ${vulnMs.toFixed(4)} ms · constant-time median ${ctMs.toFixed(4)} ms ` +
      `(median of ${SECTION2_BATCHES} batches × ${SECTION2_OPTS.loops.toLocaleString()} comparisons).`;
    const gap = Math.abs(vulnMs - ctMs) / Math.max(vulnMs, ctMs, 1e-9);
    if (gap > 0.1) {
      const faster = vulnMs < ctMs;
      setVerdict("s2-verdict", {
        tone: "leak",
        label: faster ? "Vulnerable path ran faster" : "Vulnerable path ran slower",
        detail: faster
          ? `It bailed out after ${matched} of ${secret.length} characters instead of scanning the full width. Raise the matching prefix and its time climbs toward the constant-time line — that dependence on the prefix is the leak.`
          : `With ${matched} of ${secret.length} characters matching, the early-exit comparator scanned almost the whole secret. The constant-time line never moves with the prefix; the vulnerable one does — sweep below to see it.`
      });
    } else {
      setVerdict("s2-verdict", {
        tone: "inconclusive",
        label: "Timer noise dominated this run",
        detail: `The gap was within noise on this machine — try a longer secret, a longer matching prefix, or re-run. The early-exit effect is real even when this coarse browser timer can't resolve it; the sweep below averages it out across all prefix lengths.`
      });
    }
  });

  wireSweep();
}

const VULN_COLOR = "#c2410c";
const SAFE_COLOR = "#1a6a3c";

/** Section 2 prefix sweep: trace time vs matching-prefix length for both implementations. */
function wireSweep(): void {
  const run = byId<HTMLButtonElement>("s2-sweep");
  const secretInput = byId<HTMLInputElement>("s2-secret");
  const canvas = byId<HTMLCanvasElement>("s2-sweep-canvas");
  const summary = byId<HTMLParagraphElement>("s2-sweep-summary");
  const table = byId<HTMLDivElement>("s2-sweep-table");

  type SweepRow = { matched: number; vulnMs: number; ctMs: number; examined: number };
  let rows: SweepRow[] = [];

  function draw(): void {
    renderLineChart(
      canvas,
      [
        { label: "Vulnerable", color: VULN_COLOR, points: rows.map((r) => ({ x: r.matched, y: r.vulnMs })) },
        { label: "Constant-time", color: SAFE_COLOR, points: rows.map((r) => ({ x: r.matched, y: r.ctMs })) }
      ],
      "Comparison time vs matching prefix length"
    );
  }
  redraws.push(draw);

  run.addEventListener("click", () =>
    void withRunning(run, () => {
      const secret = secretInput.value || "open-sesame-1234";
      const vuln = makeLiveOracle(secret, "vulnerable", SECTION2_OPTS);
      const ct = makeLiveOracle(secret, "constant-time", SECTION2_OPTS);
      rows = [];
      for (let matched = 0; matched <= secret.length; matched += 1) {
        const guess = guessWithMatchedPrefix(secret, matched);
        const v: number[] = [];
        const c: number[] = [];
        for (let i = 0; i < SECTION2_BATCHES; i += 1) {
          v.push(vuln.measure(guess));
          c.push(ct.measure(guess));
        }
        rows.push({
          matched,
          vulnMs: median(v),
          ctMs: median(c),
          examined: bytesExaminedVulnerable(secret, guess)
        });
      }
      draw();
      const first = rows[0];
      const last = rows[rows.length - 1];
      const climbed = last.vulnMs - first.vulnMs;
      summary.textContent =
        `Vulnerable time went from ${first.vulnMs.toFixed(4)} ms (0 correct) to ${last.vulnMs.toFixed(4)} ms ` +
        `(all ${secret.length} correct) — a ${climbed >= 0 ? "rise" : "change"} of ${climbed.toFixed(4)} ms that tracks the bytes examined column. ` +
        `Constant-time stayed near ${median(rows.map((r) => r.ctMs)).toFixed(4)} ms throughout.`;
      renderDataTable(
        table,
        "Median time and exact bytes examined by matching-prefix length",
        ["Prefix", "Vulnerable (ms)", "Constant-time (ms)", "Bytes examined (vuln)"],
        rows.map((r) => [r.matched, r.vulnMs, r.ctMs, r.examined])
      );
    })
  );
}

/* ------------------------------------------------------------------ *
 * Section 3 — the animated recovery attack
 * ------------------------------------------------------------------ */

const EFFORT_LEVELS: MeasureOptions[] = [
  { loops: 1000, work: 24 }, // 0 — fast
  { loops: 1200, work: 24 }, // 1 — balanced (default)
  { loops: 1600, work: 32 } // 2 — thorough
];
// interleaved rounds per candidate at each effort level (live channel)
const EFFORT_SAMPLES = [14, 20, 30];

function wireAttackPanel(): void {
  const runBtn = byId<HTMLButtonElement>("s3-run");
  const regenBtn = byId<HTMLButtonElement>("s3-regen");
  const slots = byId<HTMLDivElement>("s3-slots");
  const status = byId<HTMLParagraphElement>("s3-status");
  const srStatus = byId<HTMLParagraphElement>("s3-sr");
  const canvas = byId<HTMLCanvasElement>("s3-canvas");
  const why = byId<HTMLDivElement>("s3-why");
  const reveal = byId<HTMLDivElement>("s3-reveal");
  const table = byId<HTMLDivElement>("s3-table");
  const effort = byId<HTMLInputElement>("s3-effort");
  const boardRun = byId<HTMLButtonElement>("s3-board-run");
  const board = byId<HTMLDivElement>("s3-board");

  const SECRET_LENGTH = 12;
  let box: SecretBox = makeSecretBox(generateSecret(DEFAULT_ALPHABET, SECRET_LENGTH), DEFAULT_ALPHABET);
  let running = false;
  let runToken = 0;
  let lastStep: AttackStep | null = null;

  function selectedDefense(): Defense {
    return (document.querySelector('input[name="defense"]:checked') as HTMLInputElement).value as Defense;
  }
  function selectedChannel(): Channel {
    return (document.querySelector('input[name="channel"]:checked') as HTMLInputElement).value as Channel;
  }

  const progress = byId<HTMLDivElement>("s3-progress");
  const progressFill = byId<HTMLDivElement>("s3-progress-fill");
  function setProgress(fraction: number): void {
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    progressFill.style.width = `${pct}%`;
    progress.setAttribute("aria-valuenow", String(pct));
  }

  function buildSlots(recovered: string, cursor: number): void {
    let html = "";
    for (let i = 0; i < box.length; i += 1) {
      const filled = i < recovered.length;
      const cls = `slot${filled ? " filled" : ""}${i === cursor ? " cursor" : ""}`;
      const ch = filled ? displayChar(recovered[i]) : "·";
      html += `<span class="${cls}" aria-hidden="true">${ch}</span>`;
    }
    slots.innerHTML = html;
    slots.setAttribute("aria-label", recovered ? `Recovered so far: ${recovered}` : "No characters recovered yet");
  }

  function drawStep(step: AttackStep | null): void {
    if (!step) {
      renderCandidateBars(canvas, [], "", "Timing cost per candidate character");
      return;
    }
    renderCandidateBars(
      canvas,
      step.candidates,
      step.best,
      `Position ${step.position + 1}/${box.length}: timing per candidate`
    );
  }
  redraws.push(() => drawStep(lastStep));

  function reset(): void {
    runToken += 1;
    running = false;
    lastStep = null;
    buildSlots("", 0);
    setProgress(0);
    status.textContent = `Ready. A ${box.length}-character secret is loaded and hidden. Choose a target and launch the attack.`;
    srStatus.textContent = "";
    drawStep(null);
    why.innerHTML = "";
    byId<HTMLDivElement>("s3-verdict").className = "verdict";
    byId<HTMLDivElement>("s3-verdict").innerHTML = "";
    reveal.innerHTML = "";
    table.innerHTML = "";
    // the four-mode board is independent of a single run; leave it unless explicitly re-run
  }

  /** Explain, for the just-resolved position, what the attacker tried and why this character won. */
  function renderWhy(step: AttackStep, channel: Channel): void {
    const prefix = step.recovered.slice(0, step.position);
    const winner = step.best === " " ? "␣" : step.best;
    const top = step.candidates
      .slice(0, 4)
      .map(
        (c, i) =>
          `<li${i === 0 ? ' class="win"' : ""}><code>${displayChar(c.char)}</code> <span class="cost">${c.cost.toFixed(channel === "ideal" ? 0 : 4)}${channel === "ideal" ? " bytes" : " ms"}</span></li>`
      )
      .join("");
    const isLast = step.position === box.length - 1;
    const conf = step.lowConfidence
      ? `<strong class="lowconf">Low confidence</strong> — the field was nearly tied, so this pick is a guess (expected when the target is constant-time).`
      : `The winner stood <strong>${Number.isFinite(step.margin) ? step.margin.toFixed(1) : "∞"}σ</strong> above the field.`;
    const lastNote = isLast
      ? ` Because this is the final byte, the match extends into a known trailing delimiter (a sentinel), so the correct character is still measurably slower than the rest.`
      : "";
    why.innerHTML =
      `<h4>Why “${winner}” at position ${step.position + 1}?</h4>` +
      `<p>The attacker fixed the recovered prefix <code>${escapeHtml(prefix) || "∅"}</code>, appended each candidate, and padded the rest. ` +
      `Only the correct character lets the early-exit comparator run <em>one byte further</em> before it stops, so its measured cost is the highest. ${conf}${lastNote}</p>` +
      `<ol class="why-top">${top}</ol>`;
  }

  function renderReveal(recovered: string): void {
    const actual = box.reveal();
    const correct = correctCharacters(recovered, actual);
    let diff = "";
    for (let i = 0; i < actual.length; i += 1) {
      const ok = recovered[i] === actual[i];
      diff += `<span class="ch ${ok ? "ok" : "bad"}">${displayChar(actual[i])}</span>`;
    }
    reveal.innerHTML =
      `<div class="reveal-row"><span class="reveal-key">Actual secret</span><span class="reveal-val">${diff}</span></div>` +
      `<div class="reveal-row"><span class="reveal-key">Recovered</span><span class="reveal-val mono">${escapeHtml(recovered)}</span></div>` +
      `<div class="reveal-row"><span class="reveal-key">Score</span><span class="reveal-val">${correct}/${actual.length} characters</span></div>`;
  }

  function buildTable(steps: AttackStep[]): void {
    renderDataTable(
      table,
      "Per-position winner, confidence margin, and winning cost",
      ["Position", "Char", "Margin (σ)", "Winning cost", "Measurements"],
      steps.map((s) => [
        s.position + 1,
        s.best === " " ? "␣" : s.best,
        Number.isFinite(s.margin) ? s.margin.toFixed(2) : "∞",
        s.candidates[0].cost,
        s.measurements
      ])
    );
  }

  async function launch(): Promise<void> {
    if (running) {
      return;
    }
    running = true;
    const token = ++runToken;
    runBtn.disabled = true;
    runBtn.setAttribute("aria-busy", "true");
    runBtn.textContent = "Attacking…";
    reveal.innerHTML = "";
    table.innerHTML = "";
    byId<HTMLDivElement>("s3-verdict").className = "verdict";
    byId<HTMLDivElement>("s3-verdict").innerHTML = "";

    const defense = selectedDefense();
    const channel = selectedChannel();
    const level = Number(effort.value);
    const opts = makeAttackOptions(channel, level);
    const oracle = makeOracle(box.reveal(), channel, defense, EFFORT_LEVELS[level]);

    const steps: AttackStep[] = [];
    const reduced = prefersReducedMotion();
    const delay = reduced ? 0 : 70;
    let recovered = "";
    let measured = 0;
    buildSlots("", 0);
    setProgress(0);
    await nextFrame();

    for (let position = 0; position < oracle.length; position += 1) {
      if (token !== runToken) {
        return; // aborted by reset / regen / new launch
      }
      buildSlots(recovered, position);
      const probe = probePosition(oracle, recovered, position, opts);
      // Run the interleaved rounds, yielding to the browser periodically so the
      // page stays responsive AND the chart animates the estimate converging as
      // measurements accumulate — the "average out the noise" idea, made visible.
      const yieldEvery = 3; // yield for responsiveness regardless of motion preference
      while (probe.completed() < probe.rounds) {
        if (token !== runToken) {
          return;
        }
        probe.round();
        if (probe.completed() % yieldEvery === 0 || probe.completed() === probe.rounds) {
          const partial = probe.score();
          drawStep(makeStep(partial, position, recovered, measured + probe.measurements(), opts.confidenceThreshold));
          status.textContent =
            `Position ${position + 1}/${oracle.length}: ${probe.completed()}/${probe.rounds} rounds, ` +
            `${(measured + probe.measurements()).toLocaleString()} measurements. Watching the bars settle…`;
          await nextFrame();
        }
      }

      measured += probe.measurements();
      const step = makeStep(probe.score(), position, recovered, measured, opts.confidenceThreshold);
      steps.push(step);
      lastStep = step;
      recovered = step.recovered;
      buildSlots(recovered, position + 1);
      drawStep(step);
      renderWhy(step, channel);
      setProgress((position + 1) / oracle.length);
      const conf = step.lowConfidence
        ? "low confidence"
        : `${Number.isFinite(step.margin) ? step.margin.toFixed(1) : "∞"}σ above the field`;
      status.textContent =
        `Position ${position + 1}/${oracle.length} → “${step.best === " " ? "␣" : step.best}” (${conf}). ` +
        `${measured.toLocaleString()} timing measurements so far.`;
      // Announce only completed positions to assistive tech (round-by-round churn stays visual-only).
      srStatus.textContent = `Position ${position + 1} of ${oracle.length} recovered: ${step.best === " " ? "space" : step.best}.`;
      await nextFrame();
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    buildTable(steps);
    renderReveal(recovered);
    setVerdict("s3-verdict", attackVerdict(recovered, box.reveal(), defense, channel));

    running = false;
    runBtn.disabled = false;
    runBtn.removeAttribute("aria-busy");
    runBtn.textContent = "Launch attack";
  }

  runBtn.addEventListener("click", () => void launch());
  regenBtn.addEventListener("click", () => {
    box = makeSecretBox(generateSecret(DEFAULT_ALPHABET, SECRET_LENGTH), DEFAULT_ALPHABET);
    running = false;
    runBtn.disabled = false;
    runBtn.removeAttribute("aria-busy");
    runBtn.textContent = "Launch attack";
    runToken += 1; // invalidate any in-flight board run against the old secret
    board.innerHTML = "";
    reset();
  });
  for (const input of Array.from(document.querySelectorAll('input[name="defense"], input[name="channel"]'))) {
    input.addEventListener("change", () => {
      if (!running) {
        reset();
      }
    });
  }

  async function runBoard(): Promise<void> {
    const token = runToken;
    const secret = box.reveal();
    const actual = secret;
    const modes: Array<{ label: string; channel: Channel; defense: Defense }> = [
      { label: "Vulnerable · idealised", channel: "ideal", defense: "vulnerable" },
      { label: "Vulnerable · live timing", channel: "live", defense: "vulnerable" },
      { label: "Constant-time · idealised", channel: "ideal", defense: "constant-time" },
      { label: "Constant-time · live timing", channel: "live", defense: "constant-time" }
    ];
    type Row = { label: string; recovered: string | null; score: number; total: number; ms: number; tone: string; pending: boolean };
    const rows: Row[] = modes.map((m) => ({ label: m.label, recovered: null, score: 0, total: actual.length, ms: 0, tone: "inconclusive", pending: true }));

    function paint(): void {
      const cells = rows
        .map((r) => {
          const status = r.pending
            ? '<span class="board-pending">running…</span>'
            : `<span class="board-score">${r.score}/${r.total}</span>`;
          const rec = r.pending || r.recovered === null ? "—" : `<code>${escapeHtml(r.recovered)}</code>`;
          const time = r.pending ? "" : `${r.ms.toFixed(0)} ms`;
          const tag = r.pending ? "" : r.tone === "leak" ? "⚠ leak" : r.tone === "safe" ? "✓ safe" : "• noisy";
          return `<tr class="board-row board-${r.pending ? "pending" : r.tone}"><th scope="row">${r.label}</th><td>${rec}</td><td>${status}</td><td>${time}</td><td>${tag}</td></tr>`;
        })
        .join("");
      board.innerHTML =
        `<table><caption>Same hidden secret, every target × channel. The attack should win only when the implementation leaks.</caption>` +
        `<thead><tr><th scope="col">Mode</th><th scope="col">Recovered</th><th scope="col">Score</th><th scope="col">Time</th><th scope="col">Verdict</th></tr></thead>` +
        `<tbody>${cells}</tbody></table>`;
    }
    paint();

    for (let i = 0; i < modes.length; i += 1) {
      if (token !== runToken) return;
      const m = modes[i];
      // live board runs use the fast effort to keep all four modes quick
      const opts = makeAttackOptions(m.channel, 0);
      const oracle = makeOracle(secret, m.channel, m.defense, EFFORT_LEVELS[0]);
      const result = await runAttackQuiet(oracle, opts, () => token !== runToken);
      if (!result || token !== runToken) return;
      const verdict = attackVerdict(result.recovered, actual, m.defense, m.channel);
      rows[i] = {
        label: m.label,
        recovered: result.recovered,
        score: correctCharacters(result.recovered, actual),
        total: actual.length,
        ms: result.elapsedMs,
        tone: verdict.tone,
        pending: false
      };
      paint();
    }
  }

  boardRun.addEventListener("click", () => {
    if (running) {
      return;
    }
    void withRunning(boardRun, runBoard);
  });

  reset();
}

function makeAttackOptions(channel: Channel, level: number): AttackOptions {
  const base = defaultAttackOptions(DEFAULT_ALPHABET);
  return {
    ...base,
    // the idealised channel is noise-free, so one sample per candidate is plenty
    samplesPerCandidate: channel === "ideal" ? 1 : EFFORT_SAMPLES[level]
  };
}

/** Run an attack to completion off the animation path, yielding so the page stays responsive. */
async function runAttackQuiet(
  oracle: ReturnType<typeof makeOracle>,
  opts: AttackOptions,
  aborted: () => boolean
): Promise<{ recovered: string; steps: AttackStep[]; measurements: number; elapsedMs: number } | null> {
  const start = performance.now();
  const steps: AttackStep[] = [];
  let recovered = "";
  let measured = 0;
  for (let position = 0; position < oracle.length; position += 1) {
    const probe = probePosition(oracle, recovered, position, opts);
    while (probe.completed() < probe.rounds) {
      if (aborted()) return null;
      probe.round();
      if (probe.completed() % 4 === 0) {
        await nextFrame();
      }
    }
    measured += probe.measurements();
    const step = makeStep(probe.score(), position, recovered, measured, opts.confidenceThreshold);
    steps.push(step);
    recovered = step.recovered;
    await nextFrame();
  }
  return { recovered, steps, measurements: measured, elapsedMs: performance.now() - start };
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function wireResizeRedraw(): void {
  let timer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      for (const redraw of redraws) {
        redraw();
      }
    }, 150);
  });
}

export function initUi(): void {
  renderAppShell();
  wireComparePanel();
  wireAttackPanel();
  wireResizeRedraw();

  // Redraw canvases when the shared-header theme toggle flips data-theme.
  const observer = new MutationObserver(() => {
    for (const redraw of redraws) {
      redraw();
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
