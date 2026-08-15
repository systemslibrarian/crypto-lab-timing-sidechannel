/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path (`NT_BASELINE_CAPTURE=1`) so the baseline and the check
 * cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can paint
 * outside its host and the oracle measures it against the host's backdrop, so
 * that ratio is NOT trustworthy — hand-measure before acting on it. (No entry
 * here today is of that kind: this lab has no pseudo-content at all.)
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {
  /*
   * The two shared-top-bar controls: fill-less buttons whose 1px
   * color-mix(accent 38%, transparent) border is their only delineator against
   * the fixed #0b1512 bar. The same bar is baselined fleet-wide (timing-oracle
   * records it at 1.49, mac-race at 1.51) because the top bar is the shared
   * header design — brightening one lab's border is exactly the per-lab drift
   * the header policy warns against. Fix as a deliberate fleet pass, then
   * delete these two entries. The ratio differs by theme here because the bar
   * inherits this lab's `--accent` (#b45309 light at 1.49:1, #f5b14c dark at
   * 2.40:1); the entry records the WORSE of the two, captured through the
   * gate's own path, and the ratchet compares against whichever state
   * reproduces it. The hovered rendering is NOT baselined: on hover the fill
   * becomes a 14% accent mix and the border the full accent, which clears 3:1
   * — measured live by the hover states the drive scans.
   */
  "control-boundary|a.cl-btn": { ratio: 1.49, required: 3.0, unverified: false },
};
