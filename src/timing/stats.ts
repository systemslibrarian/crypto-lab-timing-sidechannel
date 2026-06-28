/**
 * Robust statistics + theme-aware canvas charts for the attack panel.
 * The charts mirror the rest of the suite: they read CSS variables so they
 * re-skin on theme change, and every chart is paired with an accessible data
 * table rendered separately (see {@link renderDataTable}).
 */

import type { CandidateScore } from "./types";

/* ------------------------------------------------------------------ *
 * Robust statistics
 * ------------------------------------------------------------------ */

export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function stdDev(values: number[], precomputedMean?: number): number {
  if (values.length === 0) {
    return 0;
  }
  const m = precomputedMean ?? mean(values);
  const variance = values.reduce((sum, value) => sum + (value - m) * (value - m), 0) / values.length;
  return Math.sqrt(variance);
}

/** Mean after discarding the top and bottom `fraction` of samples — resists timer outliers. */
export function trimmedMean(values: number[], fraction = 0.1): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * fraction);
  const kept = sorted.slice(cut, sorted.length - cut);
  return mean(kept.length > 0 ? kept : sorted);
}

/* ------------------------------------------------------------------ *
 * Theme-aware canvas plumbing
 * ------------------------------------------------------------------ */

type ChartPalette = {
  surface: string;
  text: string;
  muted: string;
  grid: string;
  axis: string;
  win: string;
  bar: string;
};

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function chartPalette(): ChartPalette {
  return {
    surface: cssVar("--chart-surface", "#fffaf1"),
    text: cssVar("--text", "#111"),
    muted: cssVar("--muted", "#555"),
    grid: cssVar("--chart-grid", "rgba(0,0,0,0.08)"),
    axis: cssVar("--chart-axis", "#6a7484"),
    win: cssVar("--danger", "#c2410c"),
    bar: cssVar("--accent", "#b45309")
  };
}

const CHART_HEIGHT = 230;
const TITLE_FONT = "600 13px 'Space Grotesk', 'Segoe UI', sans-serif";
const LABEL_FONT = "12px 'IBM Plex Sans', 'Segoe UI', sans-serif";

function setupCanvas(canvas: HTMLCanvasElement): {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  palette: ChartPalette;
} {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.floor(rect.width) || 280);
  const height = CHART_HEIGHT;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D context unavailable");
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height, palette: chartPalette() };
}

function withAlpha(color: string, alpha: number): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    const a = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0");
    return `${color}${a}`;
  }
  return color;
}

/* ------------------------------------------------------------------ *
 * Candidate bar chart — the core "aha" visual
 * ------------------------------------------------------------------ */

/**
 * One bar per candidate character, height = measured cost. The winning character
 * is drawn in the alarm colour and labelled; every other bar is muted. A dashed
 * line marks the median cost (the noise floor the winner has to clear). When the
 * channel leaks, one bar stands clearly above the pack — that lone tall bar is
 * the secret byte falling out of the timing.
 */
export function renderCandidateBars(
  canvas: HTMLCanvasElement,
  scores: CandidateScore[],
  winner: string,
  title: string
): void {
  const { ctx, width, height, palette } = setupCanvas(canvas);

  ctx.fillStyle = palette.surface;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = palette.text;
  ctx.font = TITLE_FONT;
  ctx.fillText(title, 12, 16);

  const left = 46;
  const right = width - 12;
  const top = 30;
  const bottom = height - 26;

  if (scores.length === 0) {
    ctx.fillStyle = palette.muted;
    ctx.font = LABEL_FONT;
    ctx.fillText("Launch the attack to populate this chart.", 12, top + 20);
    return;
  }

  const costs = scores.map((s) => s.cost);
  const maxCost = Math.max(...costs, 1e-9);
  const minCost = Math.min(...costs, 0);
  const span = Math.max(1e-9, maxCost - minCost);
  const med = median(costs);

  // y axis baseline
  ctx.strokeStyle = palette.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  // median / noise-floor guide line
  const medY = bottom - ((med - minCost) / span) * (bottom - top);
  ctx.strokeStyle = withAlpha(palette.muted, 0.9);
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(left, medY);
  ctx.lineTo(right, medY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = palette.muted;
  ctx.font = LABEL_FONT;
  ctx.fillText("median", left + 4, Math.max(top + 10, medY - 4));

  const slot = (right - left) / scores.length;
  const barWidth = Math.max(2, slot * 0.7);
  ctx.textAlign = "center";
  for (let i = 0; i < scores.length; i += 1) {
    const score = scores[i];
    const x = left + i * slot + (slot - barWidth) / 2;
    const barHeight = ((score.cost - minCost) / span) * (bottom - top);
    const y = bottom - barHeight;
    const isWinner = score.char === winner;
    ctx.fillStyle = isWinner ? palette.win : withAlpha(palette.bar, 0.55);
    ctx.fillRect(x, y, barWidth, barHeight);
    // label only the winner + a sparse set so the axis stays readable
    if (isWinner) {
      ctx.fillStyle = palette.win;
      ctx.font = "600 12px 'Space Grotesk', 'Segoe UI', sans-serif";
      ctx.fillText(displayChar(score.char), x + barWidth / 2, bottom + 14);
    } else if (scores.length <= 48 && i % 3 === 0) {
      ctx.fillStyle = palette.muted;
      ctx.font = LABEL_FONT;
      ctx.fillText(displayChar(score.char), x + barWidth / 2, bottom + 14);
    }
  }
  ctx.textAlign = "left";
  ctx.fillStyle = palette.muted;
  ctx.font = LABEL_FONT;
  ctx.fillText("candidate character →", left, height - 4);
}

function displayChar(ch: string): string {
  if (ch === " ") return "␣";
  return ch;
}

/* ------------------------------------------------------------------ *
 * Accessible data table
 * ------------------------------------------------------------------ */

export function renderDataTable(
  container: HTMLElement,
  caption: string,
  headers: string[],
  rows: (string | number)[][]
): void {
  const head = headers.map((h) => `<th scope="col">${h}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = row
        .map((cell, index) =>
          index === 0
            ? `<th scope="row">${cell}</th>`
            : `<td>${typeof cell === "number" ? cell.toFixed(4) : cell}</td>`
        )
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  container.innerHTML = `
    <table>
      <caption>${caption}</caption>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}
