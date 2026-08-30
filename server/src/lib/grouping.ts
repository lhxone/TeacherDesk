/**
 * Random grouping. Implements PRD §3.6.2:
 *  - byGroupCount / byGroupSize
 *  - optional gender balance
 *  - optional score balance via snake (serpentine) distribution — this is what
 *    keeps group averages tight (AC-11)
 *  - `separatePairs` blacklist: two students who must not share a group
 */

export type GroupStudent = {
  id: string;
  name: string;
  gender?: string | null;
  score?: number | null;
};

export type GroupingOptions = {
  mode: 'byGroupCount' | 'byGroupSize';
  groupCount?: number;
  groupSize?: number;
  balanceGender?: boolean;
  balanceByScore?: boolean;
  separatePairs?: [string, string][];
  rng?: () => number;
};

export type GroupResult = {
  groupIndex: number;
  name: string;
  members: GroupStudent[];
  avgScore: number | null;
};

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function resolveGroupCount(total: number, options: GroupingOptions): number {
  if (options.mode === 'byGroupCount') {
    const n = options.groupCount ?? 0;
    if (n < 1) throw new Error('组数必须大于 0');
    if (n > total) throw new Error(`组数（${n}）不能超过学生人数（${total}）`);
    return n;
  }
  const size = options.groupSize ?? 0;
  if (size < 1) throw new Error('每组人数必须大于 0');
  return Math.ceil(total / size);
}

/**
 * Serpentine distribution: sort desc by key, then deal 0,1,2..n-1,n-1..1,0
 * so the strongest and weakest even out across groups.
 */
function snakeDistribute<T>(sorted: T[], groupCount: number): T[][] {
  const groups: T[][] = Array.from({ length: groupCount }, () => []);
  sorted.forEach((item, idx) => {
    const round = Math.floor(idx / groupCount);
    const pos = idx % groupCount;
    const target = round % 2 === 0 ? pos : groupCount - 1 - pos;
    groups[target].push(item);
  });
  return groups;
}

function avgOf(members: GroupStudent[]): number | null {
  const vals = members
    .map((m) => m.score)
    .filter((s): s is number => s !== null && s !== undefined);
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

function violatesSeparation(
  group: GroupStudent[],
  candidate: GroupStudent,
  separate: Map<string, Set<string>>,
): boolean {
  const enemies = separate.get(candidate.id);
  if (!enemies) return false;
  return group.some((m) => enemies.has(m.id));
}

export function generateGroups(
  students: GroupStudent[],
  options: GroupingOptions,
): GroupResult[] {
  const rng = options.rng ?? Math.random;
  if (students.length === 0) throw new Error('没有可分组的学生');

  const groupCount = resolveGroupCount(students.length, options);

  const separate = new Map<string, Set<string>>();
  for (const [a, b] of options.separatePairs ?? []) {
    if (!separate.has(a)) separate.set(a, new Set());
    if (!separate.has(b)) separate.set(b, new Set());
    separate.get(a)!.add(b);
    separate.get(b)!.add(a);
  }

  let groups: GroupStudent[][];

  if (options.balanceByScore) {
    // Students without a score sort to the end but still get distributed.
    const sorted = [...students].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    groups = snakeDistribute(sorted, groupCount);
  } else if (options.balanceGender) {
    const males = shuffle(students.filter((s) => s.gender === 'male'), rng);
    const females = shuffle(students.filter((s) => s.gender === 'female'), rng);
    const others = shuffle(
      students.filter((s) => s.gender !== 'male' && s.gender !== 'female'),
      rng,
    );
    groups = Array.from({ length: groupCount }, () => []);
    let cursor = 0;
    for (const bucket of [males, females, others]) {
      for (const s of bucket) {
        groups[cursor % groupCount].push(s);
        cursor++;
      }
    }
  } else {
    groups = snakeDistribute(shuffle(students, rng), groupCount);
  }

  if (separate.size > 0) {
    groups = repairSeparation(groups, separate);
  }

  return groups.map((members, i) => ({
    groupIndex: i + 1,
    name: `第${i + 1}组`,
    members,
    avgScore: avgOf(members),
  }));
}

/**
 * Move conflicting students to a group that accepts them, swapping with a
 * member that the source group accepts. Throws if no arrangement is found —
 * the caller surfaces this as 422 with the offending pair (PRD §3.6.2).
 */
function repairSeparation(
  groups: GroupStudent[][],
  separate: Map<string, Set<string>>,
): GroupStudent[][] {
  const maxPasses = 50;

  for (let pass = 0; pass < maxPasses; pass++) {
    let conflict: { gi: number; student: GroupStudent } | null = null;

    outer: for (let gi = 0; gi < groups.length; gi++) {
      for (const s of groups[gi]) {
        const others = groups[gi].filter((m) => m.id !== s.id);
        if (violatesSeparation(others, s, separate)) {
          conflict = { gi, student: s };
          break outer;
        }
      }
    }

    if (!conflict) return groups;

    const { gi, student } = conflict;
    let moved = false;

    for (let tj = 0; tj < groups.length && !moved; tj++) {
      if (tj === gi) continue;
      if (violatesSeparation(groups[tj], student, separate)) continue;

      for (const swapCandidate of groups[tj]) {
        const sourceRest = groups[gi].filter((m) => m.id !== student.id);
        if (violatesSeparation(sourceRest, swapCandidate, separate)) continue;

        groups[gi] = [...sourceRest, swapCandidate];
        groups[tj] = [...groups[tj].filter((m) => m.id !== swapCandidate.id), student];
        moved = true;
        break;
      }
    }

    if (!moved) {
      const enemies = [...(separate.get(student.id) ?? [])];
      const err: Error & { conflictPair?: [string, string] } = new Error(
        `无法满足"不同组"约束：学生 ${student.id} 与 ${enemies.join(', ')} 的约束冲突，请减少约束或增加组数`,
      );
      err.conflictPair = [student.id, enemies[0]];
      throw err;
    }
  }

  throw new Error('分组约束求解超时，请减少"不同组"约束数量');
}
