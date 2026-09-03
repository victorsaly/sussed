/**
 * The move stack.
 *
 * Undo and redo are the obvious use. The reason it lives in core is the two
 * non-obvious ones: it is a replay system (feed it to a renderer and you get a
 * solve video without filming anything) and it is the anti-cheat signal for
 * leaderboards (a 4-second solve with two moves is a bot).
 */

export interface MoveRecord<TMove> {
  move: TMove;
  /** ms since the run started */
  at: number;
}

export interface Snapshot<TMove> {
  moves: MoveRecord<TMove>[];
  cursor: number;
  elapsedMs: number;
}

export class MoveStack<TMove> {
  private records: MoveRecord<TMove>[] = [];
  private cursor = 0;
  private startedAt: number | null = null;
  private accumulated = 0;

  /** Starts (or resumes) the clock. Idempotent. */
  start(now = Date.now()): void {
    if (this.startedAt === null) this.startedAt = now;
  }

  /** Pauses the clock — call on tab blur so idle time isn't counted. */
  pause(now = Date.now()): void {
    if (this.startedAt !== null) {
      this.accumulated += now - this.startedAt;
      this.startedAt = null;
    }
  }

  get elapsedMs(): number {
    return this.accumulated + (this.startedAt === null ? 0 : Date.now() - this.startedAt);
  }

  get length(): number {
    return this.cursor;
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.records.length;
  }

  /** Pushes a move, discarding any redo branch. */
  push(move: TMove): void {
    this.start();
    this.records.length = this.cursor;
    this.records.push({ move, at: this.elapsedMs });
    this.cursor++;
  }

  undo(): TMove | undefined {
    if (!this.canUndo) return undefined;
    this.cursor--;
    return this.records[this.cursor]?.move;
  }

  redo(): TMove | undefined {
    if (!this.canRedo) return undefined;
    const rec = this.records[this.cursor];
    this.cursor++;
    return rec?.move;
  }

  /** Every move up to the cursor, for replay or for rebuilding state. */
  history(): TMove[] {
    return this.records.slice(0, this.cursor).map((r) => r.move);
  }

  /** Scrub to an absolute point in the history. Returns the full prefix. */
  seek(index: number): TMove[] {
    this.cursor = Math.max(0, Math.min(index, this.records.length));
    return this.history();
  }

  reset(): void {
    this.records = [];
    this.cursor = 0;
    this.startedAt = null;
    this.accumulated = 0;
  }

  toJSON(): Snapshot<TMove> {
    return { moves: this.records.slice(), cursor: this.cursor, elapsedMs: this.elapsedMs };
  }

  static from<T>(snap: Snapshot<T>): MoveStack<T> {
    const s = new MoveStack<T>();
    // eslint-disable-next-line @typescript-eslint/dot-notation
    s['records'] = snap.moves.slice();
    s['cursor'] = snap.cursor;
    s['accumulated'] = snap.elapsedMs;
    return s;
  }
}
