/**
 * Turns the two comparators into {@link Oracle}s the attacker can probe.
 *
 * Two channels are offered, and the distinction is pedagogical:
 *  - `live`  — real wall-clock cost via performance.now(), looped enough times to
 *              clear coarse timer granularity. This is the honest, noisy channel.
 *  - `ideal` — the exact count of secret bytes examined (timer-free). Same leak,
 *              zero noise. Lets a student see the attack *algorithm* succeed
 *              perfectly, isolating it from the browser-timer noise that makes the
 *              live channel harder.
 *
 * Crossed with the two defenses (vulnerable / constant-time) this gives the
 * four-quadrant lesson: the attack only ever wins against the vulnerable oracle.
 */

import {
  bytesExaminedConstant,
  bytesExaminedVulnerable,
  constantTimeCompare,
  vulnerableCompare
} from "./compare";
import type { Channel, Defense, Oracle, SecretBox } from "./types";

export interface MeasureOptions {
  /** Comparisons per timing bracket. Larger = signal rises further above timer granularity, but slower. */
  loops: number;
  /** Per-byte mixing rounds; scales the cost of examining one byte (see compare.ts). */
  work: number;
}

export const DEFAULT_MEASURE: MeasureOptions = { loops: 1200, work: 24 };

/** The default alphabet a recovered secret is drawn from (lowercase, digits, dash, dot). */
export const DEFAULT_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789-.";

/**
 * A known delimiter appended to the secret (and to every guess) inside the oracle.
 * A bare prefix-compare cannot separate the *last* secret byte — a correct and an
 * incorrect final byte both examine the full width and stop. A trailing delimiter
 * (which real wire formats and length-prefixed fields routinely have) gives the
 * correct final byte one more matching byte to extend into, so the last position
 * leaks just like the rest. It is NOT in {@link DEFAULT_ALPHABET}, so it can never
 * be confused with a recoverable character.
 */
const SENTINEL = "\u0001";

/** Pick `length` characters from `alphabet` using rejection sampling for an unbiased draw. */
export function generateSecret(alphabet: string, length: number): string {
  if (alphabet.length === 0) {
    throw new Error("alphabet must be non-empty");
  }
  const out: string[] = [];
  const max = Math.floor(256 / alphabet.length) * alphabet.length; // reject above this to avoid modulo bias
  const buffer = new Uint8Array(1);
  while (out.length < length) {
    crypto.getRandomValues(buffer);
    const byte = buffer[0];
    if (byte < max) {
      out.push(alphabet[byte % alphabet.length]);
    }
  }
  return out.join("");
}

/** Box a secret so its plaintext is only handed out by an explicit reveal(). */
export function makeSecretBox(secret: string, alphabet: string): SecretBox {
  return {
    length: secret.length,
    alphabet,
    reveal: () => secret
  };
}

/** Time `loops` comparisons in one performance.now() bracket. */
function timeBatch(
  compare: (s: string, g: string, work: number) => boolean,
  secret: string,
  guess: string,
  loops: number,
  work: number
): number {
  const start = performance.now();
  for (let i = 0; i < loops; i += 1) {
    compare(secret, guess, work);
  }
  return performance.now() - start;
}

/**
 * Live-timing oracle. Each `measure()` is a SINGLE timing bracket — deliberately
 * noisy. Repetition is the attacker's job: the attack interleaves many single
 * measurements across candidates so that clock drift and GC pauses hit every
 * candidate equally instead of biasing whoever is measured last. Taking the
 * median over consecutive batches here (the obvious design) does NOT survive
 * drift across a 38-candidate sweep, which is why it lives in the attack loop.
 */
export function makeLiveOracle(secret: string, defense: Defense, opts: MeasureOptions = DEFAULT_MEASURE): Oracle {
  const compare = defense === "vulnerable" ? vulnerableCompare : constantTimeCompare;
  const internal = secret + SENTINEL;
  // One-time warm-up so the JIT has compiled the comparator before any real measurement.
  for (let i = 0; i < opts.loops; i += 1) {
    compare(internal, internal, opts.work);
  }
  return {
    length: secret.length,
    defense,
    channel: "live",
    measure(guess: string): number {
      return timeBatch(compare, internal, guess + SENTINEL, opts.loops, opts.work);
    }
  };
}

/**
 * Idealised oracle. `measure()` returns the exact number of secret bytes the
 * comparator examined — a noise-free stand-in for time. The leak is identical in
 * shape to the live channel; only the noise is gone.
 */
export function makeIdealOracle(secret: string, defense: Defense): Oracle {
  const examined = defense === "vulnerable" ? bytesExaminedVulnerable : bytesExaminedConstant;
  const internal = secret + SENTINEL;
  return {
    length: secret.length,
    defense,
    channel: "ideal",
    measure(guess: string): number {
      return examined(internal, guess + SENTINEL);
    }
  };
}

/** Build the oracle for a (channel, defense) pair. */
export function makeOracle(
  secret: string,
  channel: Channel,
  defense: Defense,
  opts: MeasureOptions = DEFAULT_MEASURE
): Oracle {
  return channel === "live" ? makeLiveOracle(secret, defense, opts) : makeIdealOracle(secret, defense);
}
