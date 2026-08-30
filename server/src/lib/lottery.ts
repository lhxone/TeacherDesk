/**
 * Lottery draw modes (PRD §3.6.1):
 *  - plain     : uniform random
 *  - noRepeat  : students already drawn this round are excluded; when the pool
 *                empties the round auto-resets (AC-10)
 *  - weighted  : probability decays with historical draw count, so frequently
 *                picked students surface less often without being excluded
 */

export type LotteryCandidate = { id: string; drawCount: number };

export type DrawOptions = {
  count: number;
  mode: 'plain' | 'noRepeat' | 'weighted';
  /** Ids already drawn in the current noRepeat round. */
  drawnThisRound?: string[];
  rng?: () => number;
};

export type DrawResult = {
  picked: string[];
  roundReset: boolean;
  roundRemaining: number;
};

function pickWeighted(pool: LotteryCandidate[], rng: () => number): number {
  // Weight decays as 1/(1+count): never zero, so nobody is permanently excluded.
  const weights = pool.map((c) => 1 / (1 + c.drawCount));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return pool.length - 1;
}

export function draw(candidates: LotteryCandidate[], options: DrawOptions): DrawResult {
  const rng = options.rng ?? Math.random;
  const { count, mode } = options;

  if (candidates.length === 0) throw new Error('没有可抽取的学生');
  if (count < 1) throw new Error('抽取人数必须大于 0');
  if (count > candidates.length) {
    throw new Error(`抽取人数（${count}）不能超过候选学生数（${candidates.length}）`);
  }

  let roundReset = false;
  let pool = [...candidates];

  if (mode === 'noRepeat') {
    const drawn = new Set(options.drawnThisRound ?? []);
    let remaining = candidates.filter((c) => !drawn.has(c.id));

    // Round exhausted (or too few left to satisfy the request): start over.
    if (remaining.length < count) {
      roundReset = true;
      remaining = [...candidates];
    }
    pool = remaining;
  }

  const picked: string[] = [];
  const working = [...pool];

  for (let i = 0; i < count; i++) {
    const idx =
      mode === 'weighted'
        ? pickWeighted(working, rng)
        : Math.floor(rng() * working.length);
    picked.push(working[idx].id);
    working.splice(idx, 1);
  }

  const roundRemaining =
    mode === 'noRepeat'
      ? working.length
      : candidates.length;

  return { picked, roundReset, roundRemaining };
}
