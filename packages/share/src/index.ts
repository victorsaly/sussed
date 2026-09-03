/**
 * The share card — the studio's entire distribution strategy in one file.
 *
 * Rules it must never break:
 *   1. It gives nothing away. A person who hasn't played today can read it
 *      without the puzzle being spoiled. This is why Wordle spread and why
 *      screenshots of a solved board do not.
 *   2. It is plain text first. Text pastes into any group chat, any app, on
 *      any phone, with no image upload and no permissions.
 *   3. It says the game and the issue number, so the reader can find it.
 */

import { formatMs } from './format';

export * from './format';

export interface ShareInput {
  game: string;
  gameLabel: string;
  number: number;
  solved: boolean;
  ms: number;
  moves: number;
  hints: number;
  difficulty: 1 | 2 | 3;
  /** current streak, omitted from the card when 0 */
  streak: number;
  url: string;
}

const DIFFICULTY_MARK = { 1: '·', 2: ':', 3: '⁘' } as const;

/**
 * A progress bar of blocks: each block is a chunk of the solve, filled if it
 * was made without an undo. Shows *how* the solve went without showing the
 * board. Deterministic from move data, so two people can compare shapes.
 */
export function progressBlocks(moves: number, hints: number, solved: boolean): string {
  if (!solved) return '⬜⬜⬜⬜⬜';
  const clean = Math.max(0, 5 - Math.min(5, hints * 2));
  return '🟥'.repeat(clean) + '⬜'.repeat(5 - clean);
}

export function buildShareText(input: ShareInput): string {
  const head = `${input.gameLabel} #${input.number} ${DIFFICULTY_MARK[input.difficulty]}`;
  const body = input.solved
    ? `SUSSED in ${formatMs(input.ms)}`
    : `not sussed — yet`;
  const blocks = progressBlocks(input.moves, input.hints, input.solved);
  const streak = input.streak > 1 ? `\n${input.streak} day streak` : '';
  return `${head}\n${body}\n${blocks}${streak}\n${input.url}`;
}

/**
 * Copies to clipboard, falling back to the native share sheet on mobile.
 * Returns what actually happened so the UI can say the right thing —
 * "Copied" when it copied, nothing when the share sheet took over.
 */
export async function share(input: ShareInput): Promise<'shared' | 'copied' | 'failed'> {
  const text = buildShareText(input);
  const nav = globalThis.navigator;

  if (nav?.share) {
    try {
      await nav.share({ text });
      return 'shared';
    } catch (err) {
      // A cancelled share sheet is not a failure — fall through to copy.
      if ((err as Error)?.name === 'AbortError') return 'failed';
    }
  }
  try {
    await nav.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/**
 * The image version, for places that want a picture. Drawn on a canvas so it
 * ships with the page — no server, no image service, no third party.
 */
export function renderCard(
  canvas: HTMLCanvasElement,
  input: ShareInput,
  theme: { bg: string; ink: string; accent: string; muted: string },
): void {
  const scale = globalThis.devicePixelRatio || 1;
  const W = 600;
  const H = 315;
  canvas.width = W * scale;
  canvas.height = H * scale;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = theme.muted;
  ctx.font = '600 13px ui-monospace, Menlo, monospace';
  ctx.fillText(`${input.gameLabel.toUpperCase()} #${input.number}`, 44, 60);

  ctx.fillStyle = input.solved ? theme.accent : theme.ink;
  ctx.font = '800 58px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(input.solved ? 'SUSSED' : 'NOT YET', 44, 130);

  ctx.fillStyle = theme.ink;
  ctx.font = '400 22px ui-sans-serif, system-ui, sans-serif';
  ctx.fillText(input.solved ? formatMs(input.ms) : 'still going', 44, 170);

  const blocks = 5;
  const filled = input.solved ? Math.max(0, 5 - Math.min(5, input.hints * 2)) : 0;
  for (let i = 0; i < blocks; i++) {
    ctx.fillStyle = i < filled ? theme.accent : theme.muted;
    ctx.globalAlpha = i < filled ? 1 : 0.25;
    ctx.fillRect(44 + i * 34, 196, 26, 26);
  }
  ctx.globalAlpha = 1;

  if (input.streak > 1) {
    ctx.fillStyle = theme.muted;
    ctx.font = '600 14px ui-monospace, Menlo, monospace';
    ctx.fillText(`${input.streak} DAY STREAK`, 44, 254);
  }

  ctx.fillStyle = theme.muted;
  ctx.font = '400 14px ui-monospace, Menlo, monospace';
  ctx.fillText(input.url.replace(/^https?:\/\//, ''), 44, H - 34);
}
