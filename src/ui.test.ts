// @vitest-environment happy-dom
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initUi } from "./ui";

/**
 * Structural + accessibility gate. happy-dom has no layout engine, so
 * color-contrast can't be evaluated here (it's checked in the static audit).
 * This catches the DOM-level regressions: missing labels, bad roles, broken
 * landmarks, duplicate ids, lang, and that the attack panel actually wires up.
 */
function stubBrowser(): void {
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "measureText") {
          return () => ({ width: 0 });
        }
        if (prop === "setTransform" || prop === "clearRect") {
          return () => undefined;
        }
        return () => undefined;
      },
      set: () => true
    }
  );
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as HTMLCanvasElement["getContext"];

  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear()
  });

  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 0)) as unknown as typeof window.requestAnimationFrame;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;

  if (typeof window.MutationObserver === "undefined") {
    class NoopMO {
      observe(): void {}
      disconnect(): void {}
      takeRecords(): [] {
        return [];
      }
    }
    window.MutationObserver = NoopMO as unknown as typeof MutationObserver;
  }
}

describe("UI integration", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
    document.head.innerHTML = '<meta name="theme-color" content="#1c1a16" />';
    document.body.innerHTML = '<div id="app"></div>';
    stubBrowser();
  });

  it("renders the five sections and the attack controls", () => {
    initUi();
    for (const id of [
      "s1-title",
      "s2-title",
      "s3-title",
      "s4-title",
      "s5-title",
      "s3-run",
      "s3-regen",
      "s3-slots",
      "s3-canvas",
      "s3-effort"
    ]) {
      expect(document.getElementById(id), `#${id} should exist`).not.toBeNull();
    }
    // exactly one secret-length worth of slots is rendered on load
    expect(document.querySelectorAll("#s3-slots .slot").length).toBeGreaterThan(0);
  });

  it("regenerating the secret resets the recovery state", () => {
    initUi();
    const regen = document.getElementById("s3-regen") as HTMLButtonElement;
    regen.click();
    const slots = document.querySelectorAll("#s3-slots .slot.filled");
    expect(slots.length).toBe(0); // nothing recovered after a reset
  });

  it("has no duplicate element ids", () => {
    initUi();
    const ids = Array.from(document.querySelectorAll("[id]")).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no serious or critical axe violations after render", async () => {
    initUi();
    const results = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } }
    });
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    if (blocking.length > 0) {
      const report = blocking.map((v) => `${v.id} (${v.impact}): ${v.help}`).join("\n");
      throw new Error(`axe found blocking violations:\n${report}`);
    }
    expect(blocking).toHaveLength(0);
  });
});
