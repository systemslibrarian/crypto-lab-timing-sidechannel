import { describe, expect, it } from "vitest";
import { mean, median, stdDev, trimmedMean } from "./stats";

describe("robust statistics", () => {
  it("mean and median on odd/even sets", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("empty inputs return 0 rather than NaN", () => {
    expect(mean([])).toBe(0);
    expect(median([])).toBe(0);
    expect(stdDev([])).toBe(0);
    expect(trimmedMean([])).toBe(0);
  });

  it("stdDev is zero for a constant series and positive otherwise", () => {
    expect(stdDev([5, 5, 5])).toBe(0);
    expect(stdDev([1, 2, 3])).toBeGreaterThan(0);
  });

  it("trimmedMean discards extreme outliers", () => {
    const withOutlier = [10, 10, 10, 10, 1000];
    expect(trimmedMean(withOutlier, 0.2)).toBeLessThan(mean(withOutlier));
  });
});
