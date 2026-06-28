/**
 * Shared types for the timing side-channel lab.
 *
 * The central abstraction is the {@link Oracle}: the attacker is given ONLY an
 * object that turns a guess into a scalar "cost" (higher = more work performed
 * before the comparison returned). The oracle never reveals whether a guess was
 * correct and never exposes the secret. Recovering the secret therefore depends
 * on timing alone — that is the load-bearing invariant the whole demo exists to
 * teach, so it is encoded in the type, not merely described in prose.
 */

/** Which side of the lesson an oracle sits on. Used for UI labelling only — the attack never reads it. */
export type Defense = "vulnerable" | "constant-time";

/** Where the cost number comes from. `live` = real wall-clock; `ideal` = exact operation count (no timer noise). */
export type Channel = "live" | "ideal";

export interface Oracle {
  /** Length of the hidden secret. An attacker is realistically assumed to know this. */
  readonly length: number;
  /** Whether this oracle leaks. For captions/verdicts only. */
  readonly defense: Defense;
  /** How the cost is sourced. For captions only. */
  readonly channel: Channel;
  /**
   * Compare `guess` against the hidden secret and return a cost.
   * MUST NOT return or otherwise reveal the match result.
   */
  measure(guess: string): number;
}

/**
 * Holds a secret generated per-session in memory. The plaintext is only handed
 * out by an explicit {@link reveal} call, which the UI uses *after* an attack
 * finishes to score the recovered string. The attack code is never given this.
 */
export interface SecretBox {
  readonly length: number;
  /** The alphabet the secret was drawn from (an attacker is assumed to know this). */
  readonly alphabet: string;
  /** Reveal the plaintext. Call only to score/teach, never inside the attack. */
  reveal(): string;
}

/** One candidate character and its measured cost at a single secret position. */
export interface CandidateScore {
  char: string;
  /** Median cost over the samples taken for this candidate. */
  cost: number;
}

/** A single position resolved by the attack — one animation frame's worth of state. */
export interface AttackStep {
  /** 0-based index into the secret being recovered. */
  position: number;
  /** Every candidate's score this position, sorted by cost descending (winner first). */
  candidates: CandidateScore[];
  /** The chosen character (highest cost). */
  best: string;
  /** The second-highest character — the one the winner had to beat. */
  runnerUp: string;
  /** (best − runnerUp) expressed in units of the candidate-cost spread. Higher = more confident. */
  margin: number;
  /** Spread (std-dev) of candidate costs this position — the local noise floor. */
  noise: number;
  /** Secret recovered so far, including this position. */
  recovered: string;
  /** Cumulative number of oracle.measure() calls so far. */
  measurements: number;
  /** True when the winner barely edged out the field — recovery here is a guess, not a read. */
  lowConfidence: boolean;
}

export interface AttackResult {
  recovered: string;
  steps: AttackStep[];
  measurements: number;
}
