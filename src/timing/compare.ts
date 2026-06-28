/**
 * The two implementations the whole lab turns on: a vulnerable secret comparison
 * that exits on the first mismatched byte, and a constant-time comparison that
 * always examines every byte. Both are real — nothing here fakes the math. The
 * vulnerable one genuinely does less work the sooner it finds a wrong byte, and
 * that difference is the entire leak.
 */

/** Number of leading characters `a` and `b` share. */
export function sharedPrefixLength(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) {
      return i;
    }
  }
  return length;
}

/**
 * A small, real, data-dependent mixing step (an LCG round) used as the per-byte
 * "work". Its output is accumulated and ultimately observed by the caller, so a
 * JIT cannot prove it dead and delete it. This does NOT manufacture the leak: it
 * scales the cost of *examining one byte* up to where it clears coarse browser
 * timer granularity when looped. The leak itself comes purely from how many
 * bytes each comparator examines.
 */
function mix(acc: number, byte: number, work: number): number {
  let a = acc;
  for (let w = 0; w < work; w += 1) {
    a = (Math.imul(a ^ byte, 1664525) + 1013904223) >>> 0;
  }
  return a >>> 0;
}

/**
 * Module-level sink. The comparators write their accumulated mixing state here so
 * the engine cannot eliminate the per-byte work as unused. Read it via
 * {@link readSink} from a harness if you want to be extra sure it stays live.
 */
let sink = 0;
export function readSink(): number {
  return sink;
}

/**
 * VULNERABLE: returns false the instant a byte differs. Time scales with the
 * length of the matching prefix — the timing side-channel. Equal-length inputs
 * are assumed (the attacker knows the secret's length); differing lengths fail
 * fast, as a naive `if (a.length !== b.length) return false` would.
 */
export function vulnerableCompare(secret: string, guess: string, work = 1): boolean {
  if (secret.length !== guess.length) {
    return false;
  }
  let acc = 0x9e3779b9;
  for (let i = 0; i < secret.length; i += 1) {
    const s = secret.charCodeAt(i);
    acc = mix(acc, s, work);
    if (s !== guess.charCodeAt(i)) {
      sink = (sink ^ acc) >>> 0;
      return false; // <-- early exit: the leak
    }
  }
  sink = (sink ^ acc) >>> 0;
  return true;
}

/**
 * CONSTANT-TIME: folds every byte into an accumulator with no secret-dependent
 * branch or early exit, then reports equality from the accumulator. Runtime does
 * not depend on the matching-prefix length. This is the correct *source-level*
 * discipline (see README caveats on engine-level guarantees).
 */
export function constantTimeCompare(secret: string, guess: string, work = 1): boolean {
  const max = Math.max(secret.length, guess.length);
  let diff = secret.length ^ guess.length;
  let acc = 0x9e3779b9;
  for (let i = 0; i < max; i += 1) {
    const s = i < secret.length ? secret.charCodeAt(i) : 0;
    const g = i < guess.length ? guess.charCodeAt(i) : 0;
    acc = mix(acc, s, work);
    diff |= s ^ g;
  }
  sink = (sink ^ acc) >>> 0;
  return diff === 0;
}

/**
 * How many secret bytes the VULNERABLE comparator examines for this guess — a
 * deterministic, timer-free proxy for its runtime. This is what makes the leak
 * unit-testable: examined-byte count rises with the matching prefix, exactly as
 * wall-clock time does, but without flaky measurements.
 */
export function bytesExaminedVulnerable(secret: string, guess: string): number {
  if (secret.length !== guess.length) {
    return 0;
  }
  const prefix = sharedPrefixLength(secret, guess);
  // examines bytes 0..prefix-1 (all matched) then byte `prefix` (the mismatch)
  // before returning; a full match examines all length bytes.
  return prefix >= secret.length ? secret.length : prefix + 1;
}

/** How many bytes the CONSTANT-TIME comparator examines — always the full width, by construction. */
export function bytesExaminedConstant(secret: string, guess: string): number {
  return Math.max(secret.length, guess.length);
}

/**
 * Build a guess that matches `secret` for exactly `matched` leading characters,
 * then differs (so the vulnerable comparator stops right there). Used by the
 * prefix-sweep to trace the leak shape. A `matched` of `secret.length` returns
 * the secret itself (a full match).
 */
export function guessWithMatchedPrefix(secret: string, matched: number): string {
  const clamped = Math.max(0, Math.min(matched, secret.length));
  if (clamped >= secret.length) {
    return secret;
  }
  const head = secret.slice(0, clamped);
  // flip one bit of the next byte to guarantee a mismatch at exactly `clamped`
  const wrong = String.fromCharCode(secret.charCodeAt(clamped) ^ 0x01);
  const tail = secret.slice(clamped + 1).replace(/[\s\S]/g, "x");
  return head + wrong + tail;
}
