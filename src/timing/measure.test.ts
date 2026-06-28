import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALPHABET,
  generateSecret,
  makeIdealOracle,
  makeOracle,
  makeSecretBox
} from "./measure";

describe("secret generation", () => {
  it("produces a secret of the requested length using only the alphabet", () => {
    const secret = generateSecret(DEFAULT_ALPHABET, 16);
    expect(secret).toHaveLength(16);
    for (const ch of secret) {
      expect(DEFAULT_ALPHABET).toContain(ch);
    }
  });

  it("rejects an empty alphabet", () => {
    expect(() => generateSecret("", 4)).toThrow();
  });

  it("is not constant across draws", () => {
    const a = generateSecret(DEFAULT_ALPHABET, 24);
    const b = generateSecret(DEFAULT_ALPHABET, 24);
    expect(a).not.toBe(b); // astronomically unlikely to collide
  });
});

describe("secret box", () => {
  it("reveals the secret and reports its length and alphabet", () => {
    const box = makeSecretBox("abc.def", DEFAULT_ALPHABET);
    expect(box.length).toBe(7);
    expect(box.alphabet).toBe(DEFAULT_ALPHABET);
    expect(box.reveal()).toBe("abc.def");
  });
});

describe("idealised oracle", () => {
  const secret = "abcdef";

  it("the vulnerable oracle costs more for a longer matching prefix", () => {
    const oracle = makeIdealOracle(secret, "vulnerable");
    const wrongAtStart = oracle.measure("x" + "a".repeat(secret.length - 1));
    const wrongAtEnd = oracle.measure(secret.slice(0, -1) + "x");
    const fullMatch = oracle.measure(secret);
    expect(wrongAtEnd).toBeGreaterThan(wrongAtStart);
    expect(fullMatch).toBeGreaterThan(wrongAtEnd); // sentinel lets the last byte leak too
  });

  it("the constant-time oracle costs the same regardless of the guess", () => {
    const oracle = makeIdealOracle(secret, "constant-time");
    const a = oracle.measure("xxxxxx");
    const b = oracle.measure(secret);
    expect(a).toBe(b);
  });

  it("does not reveal the match result (returns a number, not a boolean)", () => {
    const oracle = makeIdealOracle(secret, "vulnerable");
    expect(typeof oracle.measure(secret)).toBe("number");
  });
});

describe("makeOracle dispatch", () => {
  it("selects the channel and reports it", () => {
    expect(makeOracle("abc", "ideal", "vulnerable").channel).toBe("ideal");
    expect(makeOracle("abc", "live", "constant-time").channel).toBe("live");
    expect(makeOracle("abc", "ideal", "constant-time").defense).toBe("constant-time");
  });
});
