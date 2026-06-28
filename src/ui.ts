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
import { median, renderCandidateBars, renderDataTable } from "./timing/stats";
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
      </section>

      <section class="panel attack" aria-labelledby="s3-title">
        <div class="panel-head">
          <h2 id="s3-title">3 · Be the attacker — recover the secret from timing</h2>
          <span class="status warn">The secret below is random and hidden. The attack never sees it — only its timing.</span>
        </div>
        <p class="panel-text">
          A fresh secret is generated in memory and never shown to the attack code. The attacker tries every character at each position, keeps the one that takes longest, and moves on. Launch it and watch the secret appear.
        </p>

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

        <p id="s3-status" class="chart-summary" aria-live="polite"></p>
        <canvas id="s3-canvas" aria-label="Timing cost per candidate character at the current position" role="img"></canvas>
        <div id="s3-verdict" class="verdict" role="status" aria-live="polite"></div>
        <div id="s3-reveal" class="reveal" aria-live="polite"></div>
        <details class="chart-data"><summary>Show per-position data</summary><div id="s3-table"></div></details>
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
    const ratio = ctMs > 0 ? vulnMs / ctMs : 1;
    if (matched > 0 && matched < secret.length && ratio > 1.1) {
      setVerdict("s2-verdict", {
        tone: "leak",
        label: "The vulnerable path is faster here",
        detail: `It bailed out after ${matched} matching characters instead of scanning all ${secret.length}. Increase the matching prefix and watch its time climb — the constant-time path won't move.`
      });
    } else {
      setVerdict("s2-verdict", {
        tone: "inconclusive",
        label: "Timer noise dominated this run",
        detail: `The gap was within noise on this machine — try a longer secret, a longer matching prefix, or re-run. The early-exit effect is real even when this coarse browser timer can't resolve it.`
      });
    }
  });
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
  const canvas = byId<HTMLCanvasElement>("s3-canvas");
  const reveal = byId<HTMLDivElement>("s3-reveal");
  const table = byId<HTMLDivElement>("s3-table");
  const effort = byId<HTMLInputElement>("s3-effort");

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
    drawStep(null);
    byId<HTMLDivElement>("s3-verdict").className = "verdict";
    byId<HTMLDivElement>("s3-verdict").innerHTML = "";
    reveal.innerHTML = "";
    table.innerHTML = "";
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
      setProgress((position + 1) / oracle.length);
      const conf = step.lowConfidence
        ? "low confidence"
        : `${Number.isFinite(step.margin) ? step.margin.toFixed(1) : "∞"}σ above the field`;
      status.textContent =
        `Position ${position + 1}/${oracle.length} → “${step.best === " " ? "␣" : step.best}” (${conf}). ` +
        `${measured.toLocaleString()} timing measurements so far.`;
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
    reset();
  });
  for (const input of Array.from(document.querySelectorAll('input[name="defense"], input[name="channel"]'))) {
    input.addEventListener("change", () => {
      if (!running) {
        reset();
      }
    });
  }

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
