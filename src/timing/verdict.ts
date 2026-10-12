/** Report the observed outcome; failure to recover is not a safety proof. */
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
  const channelNote =
    channel === "live"
      ? "from live performance.now() timing alone"
      : "from the idealised operation-count channel";

  if (correct === total && total > 0) {
    return {
      tone: "leak",
      label: "Secret fully recovered",
      detail: `All ${total} characters were extracted ${channelNote} — the secret was never compared directly, only timed. This run recovered the secret; the result alone does not establish a universal attack success rate.`
    };
  }

  return {
    tone: "inconclusive",
    label: "No full recovery observed — insufficient evidence",
    detail: `${correct}/${total} characters match in this run. A partial match may occur by chance and does not establish measured leakage. ${channel === "ideal" ? (defense === "constant-time" ? "The ideal constant-work model assigns equal counted cost to candidates; this is not a browser timing guarantee." : "The ideal early-exit model has a source-known variable cost; this incomplete run alone does not establish recovery.") : "Live wall-clock results do not prove the absence of timing leakage, regardless of the selected source pattern."}`
  };
}
