import { describe, expect, it } from "vitest";
import { defaultAttackOptions, runAttack } from "./attack";
import { DEFAULT_ALPHABET, makeIdealOracle } from "./measure";
import type { Channel, Defense, Oracle } from "./types";
import { bytesExaminedVulnerable } from "./compare";
import { attackVerdict, correctCharacters } from "./verdict";

const ALPHABET = DEFAULT_ALPHABET;

/**
 * A vulnerable oracle whose cost is the true examined-byte count plus bounded,
 * deterministic noise keyed by the guess. With noise amplitude below the 1-byte
 * signal, a robust attack must still recover the secret — this is the headless
 * stand-in for the noisy live channel.
 */
function makeNoisyOracle(secret: string, amplitude: number): Oracle {
  const internal = secret + String.fromCharCode(1);
  return {
    length: secret.length,
    defense: "vulnerable" as Defense,
    channel: "live" as Channel,
    measure(guess: string): number {
      const base = bytesExaminedVulnerable(internal, guess + String.fromCharCode(1));
      // deterministic hash of the guess -> [0,1)
      let h = 2166136261;
      for (let i = 0; i < guess.length; i += 1) {
        h = Math.imul(h ^ guess.charCodeAt(i), 16777619) >>> 0;
      }
      const jitter = (h / 0xffffffff - 0.5) * 2 * amplitude;
      return base + jitter;
    }
  };
}

describe("byte-by-byte secret recovery", () => {
  it("fully recovers the secret from the idealised vulnerable oracle", () => {
    const secret = "s3cr3t-key.42";
    const result = runAttack(makeIdealOracle(secret, "vulnerable"), defaultAttackOptions(ALPHABET));
    expect(result.recovered).toBe(secret);
    expect(result.steps.every((s) => !s.lowConfidence)).toBe(true);
  });

  it("recovers a variety of secrets, including ones ending in the same char", () => {
    for (const secret of ["aaaaaa", "zzz-000", "abc.def.ghi", "9", "hunter2-but-longer"]) {
      const result = runAttack(makeIdealOracle(secret, "vulnerable"), defaultAttackOptions(ALPHABET));
      expect(result.recovered).toBe(secret);
    }
  });

  it("still recovers under noise smaller than the per-byte signal", () => {
    const secret = "token-abc-123";
    const opts = { ...defaultAttackOptions(ALPHABET), samplesPerCandidate: 1 };
    const result = runAttack(makeNoisyOracle(secret, 0.4), opts);
    expect(result.recovered).toBe(secret);
  });

  it("fails against a constant-time oracle — the defense works", () => {
    const secret = "s3cr3t-key.42";
    const result = runAttack(makeIdealOracle(secret, "constant-time"), defaultAttackOptions(ALPHABET));
    // every candidate is tied, so recovery is no better than chance and the
    // verdict must NOT be a full recovery.
    expect(result.recovered).not.toBe(secret);
    expect(correctCharacters(result.recovered, secret)).toBeLessThan(secret.length);
    expect(result.steps.every((s) => s.lowConfidence)).toBe(true);
  });

  it("measurement count is reported and grows with secret length", () => {
    const short = runAttack(makeIdealOracle("abcd", "vulnerable"), defaultAttackOptions(ALPHABET));
    const long = runAttack(makeIdealOracle("abcdefghij", "vulnerable"), defaultAttackOptions(ALPHABET));
    expect(short.measurements).toBeGreaterThan(0);
    expect(long.measurements).toBeGreaterThan(short.measurements);
  });
});

describe("attack verdict semantics (colour tracks integrity, not attacker success)", () => {
  it("full recovery reads as an alarm, not a success", () => {
    const v = attackVerdict("secret", "secret", "vulnerable", "ideal");
    expect(v.tone).toBe("leak");
  });

  it("constant-time defeating the attack reads as safe", () => {
    const v = attackVerdict("xxxxxx", "secret", "constant-time", "live");
    expect(v.tone).toBe("safe");
  });

  it("partial recovery against a vulnerable target is still a leak", () => {
    const v = attackVerdict("secXXX", "secret", "vulnerable", "live");
    expect(v.tone).toBe("leak");
  });
});
