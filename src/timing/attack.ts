/**
 * The centrepiece: recover a hidden secret one character at a time using nothing
 * but the {@link Oracle}'s timing.
 *
 * At each position the attacker fixes the characters recovered so far, then tries
 * every candidate for the current position (padding the rest with a fixed filler).
 * Against a vulnerable oracle the *correct* candidate makes the comparison match
 * one byte further before it stops, so it costs measurably more than every wrong
 * candidate — which all stop at the current position. Pick the costliest
 * candidate, append it, move on. Against a constant-time oracle every candidate
 * costs the same, the winner is noise, and recovery fails — which is the point.
 *
 * The engine is exposed as a generator so the UI can animate one position per
 * frame, and as {@link runAttack} for tests and headless use.
 */

import { stdDev } from "./stats";
import type { AttackResult, AttackStep, CandidateScore, Oracle } from "./types";

export interface AttackOptions {
  /** Candidate alphabet to try at each position. */
  alphabet: string;
  /**
   * Number of interleaved rounds. Each round takes ONE measurement of every
   * candidate, round-robin, so timing drift across the sweep biases all
   * candidates equally instead of whoever happens to be measured last. Per
   * candidate the cost is the trimmed mean over its rounds.
   */
  samplesPerCandidate: number;
  /** Character used to pad not-yet-recovered positions. Must be deterministic. */
  filler: string;
  /**
   * A winner this many candidate-cost std-devs above the runner-up (or fewer) is
   * flagged low-confidence: the position was a guess, not a clean read.
   */
  confidenceThreshold: number;
}

export function defaultAttackOptions(alphabet: string): AttackOptions {
  return {
    alphabet,
    samplesPerCandidate: 18,
    filler: alphabet[0] ?? "a",
    confidenceThreshold: 1.0
  };
}

/**
 * A resumable probe of a single secret position. The caller drives it one
 * interleaved {@link round} at a time — every candidate is measured once per
 * round, so machine drift across the sweep cancels instead of biasing whoever is
 * measured last — and can read the current {@link score} between rounds to
 * animate the estimate converging. The per-candidate cost is the MINIMUM batch
 * time observed: timing noise here is one-sided (GC, scheduling and contention
 * only ever ADD time), so the fastest run is the cleanest estimate of intrinsic
 * compute, and the correct character — which does one byte more work — keeps the
 * highest minimum even before the noise fully averages out.
 */
export interface PositionProbe {
  /** Target number of rounds (== samplesPerCandidate). */
  readonly rounds: number;
  /** Rounds completed so far. */
  completed(): number;
  /** Total oracle.measure() calls this probe has made. */
  measurements(): number;
  /** Run one interleaved round (one measurement of every candidate). */
  round(): void;
  /** Current best-estimate scores from the rounds run so far, sorted winner-first. */
  score(): CandidateScore[];
}

export function probePosition(
  oracle: Oracle,
  recovered: string,
  position: number,
  opts: AttackOptions
): PositionProbe {
  const tail = opts.filler.repeat(Math.max(0, oracle.length - position - 1));
  const alphabet = opts.alphabet;
  const guesses = Array.from(alphabet, (ch) => recovered + ch + tail);
  // Track each candidate's running minimum so score() is O(alphabet), not O(samples).
  const best = new Float64Array(alphabet.length).fill(Number.POSITIVE_INFINITY);
  let done = 0;
  let measurements = 0;

  return {
    rounds: opts.samplesPerCandidate,
    completed: () => done,
    measurements: () => measurements,
    round(): void {
      for (let i = 0; i < alphabet.length; i += 1) {
        const cost = oracle.measure(guesses[i]);
        if (cost < best[i]) {
          best[i] = cost;
        }
        measurements += 1;
      }
      done += 1;
    },
    score(): CandidateScore[] {
      const scores: CandidateScore[] = Array.from(alphabet, (ch, i) => ({
        char: ch,
        cost: Number.isFinite(best[i]) ? best[i] : 0
      }));
      scores.sort((a, b) => b.cost - a.cost);
      return scores;
    }
  };
}

/** Run a probe to completion and return its final scores + measurement count. */
function scorePosition(
  oracle: Oracle,
  recovered: string,
  position: number,
  opts: AttackOptions
): { scores: CandidateScore[]; measurements: number } {
  const probe = probePosition(oracle, recovered, position, opts);
  while (probe.completed() < probe.rounds) {
    probe.round();
  }
  return { scores: probe.score(), measurements: probe.measurements() };
}

/** Turn a position's scores into an {@link AttackStep}. Exported so a UI can build steps as it animates. */
export function makeStep(
  scores: CandidateScore[],
  position: number,
  recovered: string,
  measurements: number,
  threshold: number
): AttackStep {
  const best = scores[0];
  const runnerUp = scores[1] ?? best;
  const noise = stdDev(scores.map((s) => s.cost));
  const margin =
    noise > 0
      ? (best.cost - runnerUp.cost) / noise
      : best.cost > runnerUp.cost
        ? Number.POSITIVE_INFINITY
        : 0;
  return {
    position,
    candidates: scores,
    best: best.char,
    runnerUp: runnerUp.char,
    margin,
    noise,
    recovered: recovered + best.char,
    measurements,
    lowConfidence: margin < threshold
  };
}

/**
 * Generator form. Yields one {@link AttackStep} per secret position so a caller
 * can render each position as it resolves. The heavy measurement work for a
 * position happens in the `next()` that produces that position's step.
 */
export function* attackSteps(oracle: Oracle, opts: AttackOptions): Generator<AttackStep> {
  let recovered = "";
  let measurements = 0;
  for (let position = 0; position < oracle.length; position += 1) {
    const { scores, measurements: used } = scorePosition(oracle, recovered, position, opts);
    measurements += used;
    const step = makeStep(scores, position, recovered, measurements, opts.confidenceThreshold);
    recovered = step.recovered;
    yield step;
  }
}

/** Run the whole attack to completion and collect every step. */
export function runAttack(oracle: Oracle, opts: AttackOptions): AttackResult {
  const steps: AttackStep[] = [];
  for (const step of attackSteps(oracle, opts)) {
    steps.push(step);
  }
  const last = steps[steps.length - 1];
  return {
    recovered: last ? last.recovered : "",
    steps,
    measurements: last ? last.measurements : 0
  };
}
