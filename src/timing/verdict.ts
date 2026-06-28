/**
 * Turns an attack outcome into a plain-language verdict.
 *
 * Inverted semantics (important): colour tracks SYSTEM INTEGRITY, not the
 * attacker's success. A fully recovered secret is a catastrophe for the
 * defender, so it reads as an ALARM (`leak`), never a green "success". The
 * constant-time oracle *defeating* the attack is the genuinely good outcome
 * (`safe`). Every verdict pairs an icon + text + colour so meaning survives
 * grayscale and colour-blindness (WCAG 1.4.1).
 */

import { sharedPrefixLength } from "./compare";
import type { Channel, Defense } from "./types";

export type VerdictTone = "leak" | "safe" | "inconclusive";

export interface Verdict {
  tone: VerdictTone;
  label: string;
  detail: string;
}

/** Count exact character matches between recovered and actual (same length assumed). */
export function correctCharacters(recovered: string, actual: string): number {
  let count = 0;
  const length = Math.min(recovered.length, actual.length);
  for (let i = 0; i < length; i += 1) {
    if (recovered[i] === actual[i]) {
      count += 1;
    }
  }
  return count;
}

export function attackVerdict(
  recovered: string,
  actual: string,
  defense: Defense,
  channel: Channel
): Verdict {
  const total = actual.length;
  const correct = correctCharacters(recovered, actual);
  const prefix = sharedPrefixLength(recovered, actual);
  const channelNote =
    channel === "live"
      ? "from live performance.now() timing alone"
      : "from the idealised operation-count channel";

  if (correct === total && total > 0) {
    return {
      tone: "leak",
      label: "Secret fully recovered",
      detail: `All ${total} characters were extracted ${channelNote} — the secret was never compared directly, only timed. An early-exit comparison hands the whole secret to an attacker one byte at a time.`
    };
  }

  if (defense === "constant-time") {
    return {
      tone: "safe",
      label: "Attack failed — constant-time held",
      detail: `Only ${correct}/${total} characters happened to match (≈ chance for this alphabet). With no early exit, every candidate costs the same, so timing reveals nothing. This is the defense working.`
    };
  }

  // Vulnerable but not perfect: still a leak, just noisier this run.
  return {
    tone: "leak",
    label: `Partial recovery — ${correct}/${total} characters`,
    detail: `The first ${prefix} character${prefix === 1 ? "" : "s"} fell cleanly; timer noise derailed the rest this run. The leak is real — raise measurements per byte or use the idealised channel and it recovers in full. Statistically the secret is still exploitable.`
  };
}
