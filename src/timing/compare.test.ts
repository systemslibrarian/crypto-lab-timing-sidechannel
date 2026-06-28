import { describe, expect, it } from "vitest";
import {
  bytesExaminedConstant,
  bytesExaminedVulnerable,
  constantTimeCompare,
  sharedPrefixLength,
  vulnerableCompare
} from "./compare";

describe("comparison primitives", () => {
  it("both comparators agree with ===", () => {
    const cases: Array<[string, string]> = [
      ["", ""],
      ["a", "a"],
      ["abc", "abc"],
      ["abc", "abd"],
      ["abc", "ab"],
      ["abc", "abcd"],
      ["s3cr3t-token.42", "s3cr3t-token.42"],
      ["s3cr3t-token.42", "s3cr3t-token.43"]
    ];
    for (const [a, b] of cases) {
      expect(vulnerableCompare(a, b)).toBe(a === b);
      expect(constantTimeCompare(a, b)).toBe(a === b);
    }
  });

  it("shared prefix length counts matching leading characters", () => {
    expect(sharedPrefixLength("abcdef", "abcxyz")).toBe(3);
    expect(sharedPrefixLength("abc", "abc")).toBe(3);
    expect(sharedPrefixLength("abc", "xyz")).toBe(0);
    expect(sharedPrefixLength("abc", "ab")).toBe(2);
  });
});

describe("the leak is real and the defense is flat (timer-free proxy)", () => {
  const secret = "correct-horse";

  it("vulnerable examined-byte count rises strictly with the matching prefix", () => {
    // For guesses that differ at position p, runtime is strictly increasing in p.
    let previous = -1;
    for (let p = 0; p < secret.length; p += 1) {
      const guess =
        secret.slice(0, p) + String.fromCharCode(secret.charCodeAt(p) ^ 0x01) + "x".repeat(secret.length - p - 1);
      const examined = bytesExaminedVulnerable(secret, guess);
      expect(examined).toBe(p + 1); // exactly p matched bytes + the mismatching byte
      expect(examined).toBeGreaterThan(previous); // monotonic increase == the timing gradient
      previous = examined;
    }
    // A bare prefix-compare cannot separate the last byte: a full match examines
    // the same number of bytes as a guess that differs only at the final byte.
    // That tie is exactly why the oracle appends a sentinel (see measure.ts).
    const fullMatch = bytesExaminedVulnerable(secret, secret);
    const wrongLast = secret.slice(0, -1) + String.fromCharCode(secret.charCodeAt(secret.length - 1) ^ 0x01);
    expect(fullMatch).toBe(secret.length);
    expect(bytesExaminedVulnerable(secret, wrongLast)).toBe(secret.length);
  });

  it("constant-time examined-byte count never depends on the prefix", () => {
    const counts = new Set<number>();
    for (let p = 0; p <= secret.length; p += 1) {
      const guess =
        p >= secret.length
          ? secret
          : secret.slice(0, p) + String.fromCharCode(secret.charCodeAt(p) ^ 0x01) + "x".repeat(secret.length - p - 1);
      counts.add(bytesExaminedConstant(secret, guess));
    }
    expect(counts.size).toBe(1); // perfectly flat
  });

  it("differing lengths fail fast in the vulnerable path", () => {
    expect(vulnerableCompare("secret", "secretX")).toBe(false);
    expect(bytesExaminedVulnerable("secret", "secretX")).toBe(0);
  });
});
