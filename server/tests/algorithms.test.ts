import { describe, it, expect } from 'vitest';
import { availableCells, randomizeSeating } from '../src/lib/seating.js';
import { generateGroups, resolveGroupCount } from '../src/lib/grouping.js';
import { draw } from '../src/lib/lottery.js';
import { stddev } from '../src/lib/stats.js';
import { seededRng } from './helpers.js';

const students = (n: number, gender?: 'male' | 'female') =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    name: `学生${i}`,
    gender: gender ?? (i % 2 === 0 ? 'male' : 'female'),
  }));

describe('seating: available cells', () => {
  it('excludes disabled cells from the usable grid', () => {
    expect(availableCells(2, 3, [[0, 0], [1, 2]])).toHaveLength(4);
  });
});

describe('seating: randomize', () => {
  it('seats every student exactly once, on distinct cells', () => {
    const result = randomizeSeating(students(20), [], {
      rowCount: 5,
      colCount: 6,
      rng: seededRng(1),
    });
    expect(result.assignments).toHaveLength(20);
    expect(new Set(result.assignments.map((a) => a.studentId)).size).toBe(20);
    expect(new Set(result.assignments.map((a) => `${a.rowIndex}:${a.colIndex}`)).size).toBe(20);
  });

  it('AC-8: pinned students keep their exact seat', () => {
    const existing = [{ studentId: 's3', rowIndex: 4, colIndex: 5, isPinned: true }];
    const result = randomizeSeating(students(20), existing, {
      rowCount: 5,
      colCount: 6,
      keepPinned: true,
      rng: seededRng(7),
    });

    const pinned = result.assignments.find((a) => a.studentId === 's3');
    expect(pinned).toMatchObject({ rowIndex: 4, colIndex: 5, isPinned: true });
  });

  it('re-seats pinned students when keepPinned is false', () => {
    const existing = [{ studentId: 's0', rowIndex: 0, colIndex: 0, isPinned: true }];
    const result = randomizeSeating(students(12), existing, {
      rowCount: 4,
      colCount: 4,
      keepPinned: false,
      rng: seededRng(3),
    });
    expect(result.assignments.every((a) => !a.isPinned)).toBe(true);
  });

  it('never places anyone on a disabled cell', () => {
    const disabled: [number, number][] = [[0, 0], [0, 1], [1, 1]];
    const result = randomizeSeating(students(10), [], {
      rowCount: 4,
      colCount: 4,
      disabledCells: disabled,
      rng: seededRng(11),
    });

    const used = new Set(result.assignments.map((a) => `${a.rowIndex}:${a.colIndex}`));
    for (const [r, c] of disabled) expect(used.has(`${r}:${c}`)).toBe(false);
  });

  it('places front-row-tagged students in the earliest rows', () => {
    const roster = students(12).map((s, i) => ({ ...s, tagIds: i < 3 ? ['focus'] : [] }));
    const result = randomizeSeating(roster, [], {
      rowCount: 4,
      colCount: 4,
      frontRowTagIds: ['focus'],
      rng: seededRng(5),
    });

    const tagged = result.assignments.filter((a) => ['s0', 's1', 's2'].includes(a.studentId));
    expect(tagged.every((a) => a.rowIndex === 0)).toBe(true);
  });

  it('fills the front row before spilling into the next one', () => {
    // 4 cols x 4 rows, 6 students: the front row (row 0) must be full before
    // row 1 gets anyone, rather than students being scattered across every
    // open seat uniformly.
    const result = randomizeSeating(students(6), [], {
      rowCount: 4,
      colCount: 4,
      rng: seededRng(2),
    });
    const row0 = result.assignments.filter((a) => a.rowIndex === 0);
    const row1 = result.assignments.filter((a) => a.rowIndex === 1);
    expect(row0).toHaveLength(4);
    expect(row1).toHaveLength(2);
    expect(result.assignments.every((a) => a.rowIndex <= 1)).toBe(true);
  });

  it('podium "bottom" fills from the last row outward instead of row 0', () => {
    const result = randomizeSeating(students(6), [], {
      rowCount: 4,
      colCount: 4,
      podium: 'bottom',
      rng: seededRng(2),
    });
    const lastRow = result.assignments.filter((a) => a.rowIndex === 3);
    const secondLast = result.assignments.filter((a) => a.rowIndex === 2);
    expect(lastRow).toHaveLength(4);
    expect(secondLast).toHaveLength(2);
    expect(result.assignments.every((a) => a.rowIndex >= 2)).toBe(true);
  });

  it('podium "bottom" also seats front-row-tagged students in the last row', () => {
    const roster = students(12).map((s, i) => ({ ...s, tagIds: i < 3 ? ['focus'] : [] }));
    const result = randomizeSeating(roster, [], {
      rowCount: 4,
      colCount: 4,
      podium: 'bottom',
      frontRowTagIds: ['focus'],
      rng: seededRng(5),
    });

    const tagged = result.assignments.filter((a) => ['s0', 's1', 's2'].includes(a.studentId));
    expect(tagged.every((a) => a.rowIndex === 3)).toBe(true);
  });

  it('AC-9: throws with a shortfall when seats are fewer than students', () => {
    expect(() =>
      randomizeSeating(students(20), [], { rowCount: 2, colCount: 4, rng: seededRng(1) }),
    ).toThrowError(/座位不足/);
  });

  it('counts pinned seats as taken when checking capacity', () => {
    // 3x3 = 9 cells, 1 pinned -> 8 free, but 9 unpinned students remain.
    const existing = [{ studentId: 's0', rowIndex: 0, colIndex: 0, isPinned: true }];
    expect(() =>
      randomizeSeating(students(10), existing, {
        rowCount: 3,
        colCount: 3,
        keepPinned: true,
        rng: seededRng(1),
      }),
    ).toThrowError(/座位不足/);
  });

  it('reduces same-gender adjacency when asked (best effort)', () => {
    const roster = students(16);
    const before = randomizeSeating(roster, [], {
      rowCount: 4,
      colCount: 4,
      rng: seededRng(42),
    });
    const after = randomizeSeating(roster, [], {
      rowCount: 4,
      colCount: 4,
      avoidSameGenderAdjacent: true,
      rng: seededRng(42),
    });

    const countAdjacent = (as: typeof before.assignments) => {
      const g = new Map(roster.map((s) => [s.id, s.gender]));
      const at = new Map(as.map((a) => [`${a.rowIndex}:${a.colIndex}`, a.studentId]));
      let n = 0;
      for (const a of as) {
        const right = at.get(`${a.rowIndex}:${a.colIndex + 1}`);
        if (right && g.get(right) === g.get(a.studentId)) n++;
      }
      return n;
    };

    expect(countAdjacent(after.assignments)).toBeLessThanOrEqual(countAdjacent(before.assignments));
    expect(new Set(after.assignments.map((a) => a.studentId)).size).toBe(16);
  });
});

describe('grouping: group count resolution', () => {
  it('derives group count from group size, rounding up', () => {
    expect(resolveGroupCount(23, { mode: 'byGroupSize', groupSize: 5 })).toBe(5);
  });

  it('rejects more groups than students', () => {
    expect(() => resolveGroupCount(3, { mode: 'byGroupCount', groupCount: 5 })).toThrowError(
      /不能超过学生人数/,
    );
  });
});

describe('grouping: generate', () => {
  it('places every student in exactly one group', () => {
    const groups = generateGroups(students(23), {
      mode: 'byGroupCount',
      groupCount: 4,
      rng: seededRng(9),
    });

    const all = groups.flatMap((g) => g.members.map((m) => m.id));
    expect(all).toHaveLength(23);
    expect(new Set(all).size).toBe(23);
  });

  it('keeps group sizes within one of each other', () => {
    const groups = generateGroups(students(23), {
      mode: 'byGroupCount',
      groupCount: 4,
      rng: seededRng(9),
    });
    const sizes = groups.map((g) => g.members.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('AC-11: score-balanced groups have averages within the class stddev', () => {
    const roster = Array.from({ length: 40 }, (_, i) => ({
      id: `s${i}`,
      name: `学生${i}`,
      score: 40 + i * 1.5,
    }));

    const groups = generateGroups(roster, {
      mode: 'byGroupCount',
      groupCount: 5,
      balanceByScore: true,
    });

    const avgs = groups.map((g) => g.avgScore!).filter((a) => a !== null);
    const spread = Math.max(...avgs) - Math.min(...avgs);
    const classSd = stddev(roster.map((r) => r.score))!;

    expect(spread).toBeLessThanOrEqual(classSd);
  });

  it('distributes genders evenly when balanceGender is set', () => {
    const roster = [...students(10, 'male'), ...students(10, 'female').map((s) => ({
      ...s,
      id: `f${s.id}`,
    }))];

    const groups = generateGroups(roster, {
      mode: 'byGroupCount',
      groupCount: 4,
      balanceGender: true,
      rng: seededRng(2),
    });

    for (const g of groups) {
      const males = g.members.filter((m) => m.gender === 'male').length;
      expect(males).toBeGreaterThan(0);
      expect(males).toBeLessThan(g.members.length);
    }
  });

  it('honours a separatePairs constraint', () => {
    const groups = generateGroups(students(12), {
      mode: 'byGroupCount',
      groupCount: 3,
      separatePairs: [['s0', 's1'], ['s2', 's3']],
      rng: seededRng(4),
    });

    for (const g of groups) {
      const ids = g.members.map((m) => m.id);
      expect(ids.includes('s0') && ids.includes('s1')).toBe(false);
      expect(ids.includes('s2') && ids.includes('s3')).toBe(false);
    }
  });

  it('reports a clear error when separation constraints are unsatisfiable', () => {
    // Three mutually-exclusive students cannot fit into two groups.
    expect(() =>
      generateGroups(students(4), {
        mode: 'byGroupCount',
        groupCount: 2,
        separatePairs: [['s0', 's1'], ['s1', 's2'], ['s0', 's2']],
        rng: seededRng(1),
      }),
    ).toThrowError(/不同组|约束/);
  });

  it('rejects grouping an empty roster', () => {
    expect(() => generateGroups([], { mode: 'byGroupCount', groupCount: 2 })).toThrowError(
      /没有可分组的学生/,
    );
  });

  it('leaves avgScore null when no scores are supplied', () => {
    const groups = generateGroups(students(6), {
      mode: 'byGroupCount',
      groupCount: 2,
      rng: seededRng(1),
    });
    expect(groups.every((g) => g.avgScore === null)).toBe(true);
  });
});

describe('lottery: draw', () => {
  const candidates = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `s${i}`, drawCount: 0 }));

  it('draws the requested number of distinct students', () => {
    const result = draw(candidates(10), { count: 3, mode: 'plain', rng: seededRng(1) });
    expect(result.picked).toHaveLength(3);
    expect(new Set(result.picked).size).toBe(3);
  });

  it('rejects drawing more students than exist', () => {
    expect(() => draw(candidates(3), { count: 5, mode: 'plain' })).toThrowError(/不能超过/);
  });

  it('rejects an empty candidate pool', () => {
    expect(() => draw([], { count: 1, mode: 'plain' })).toThrowError(/没有可抽取的学生/);
  });

  it('AC-10: noRepeat draws each student exactly once across a full round', () => {
    const pool = candidates(8);
    const drawn: string[] = [];

    for (let i = 0; i < 8; i++) {
      const result = draw(pool, {
        count: 1,
        mode: 'noRepeat',
        drawnThisRound: drawn,
        rng: seededRng(100 + i),
      });
      expect(result.roundReset).toBe(false);
      drawn.push(...result.picked);
    }

    expect(new Set(drawn).size).toBe(8);
  });

  it('AC-10: the round resets once everyone has been drawn', () => {
    const pool = candidates(4);
    const result = draw(pool, {
      count: 1,
      mode: 'noRepeat',
      drawnThisRound: ['s0', 's1', 's2', 's3'],
      rng: seededRng(3),
    });

    expect(result.roundReset).toBe(true);
    expect(result.picked).toHaveLength(1);
  });

  it('resets early when too few remain to satisfy the requested count', () => {
    const result = draw(candidates(5), {
      count: 3,
      mode: 'noRepeat',
      drawnThisRound: ['s0', 's1', 's2', 's3'],
      rng: seededRng(3),
    });
    expect(result.roundReset).toBe(true);
    expect(new Set(result.picked).size).toBe(3);
  });

  it('weighted mode favours students drawn less often', () => {
    const pool = [
      { id: 'rare', drawCount: 0 },
      { id: 'common', drawCount: 50 },
    ];

    let rareWins = 0;
    for (let i = 0; i < 300; i++) {
      const result = draw(pool, { count: 1, mode: 'weighted', rng: seededRng(i * 31 + 7) });
      if (result.picked[0] === 'rare') rareWins++;
    }

    // Weight ratio is 1 : 1/51, so 'rare' should dominate decisively.
    expect(rareWins).toBeGreaterThan(250);
  });

  it('weighted mode still allows a frequently-drawn student to be picked', () => {
    const pool = [
      { id: 'a', drawCount: 5 },
      { id: 'b', drawCount: 5 },
    ];
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      seen.add(draw(pool, { count: 1, mode: 'weighted', rng: seededRng(i * 13 + 1) }).picked[0]);
    }
    expect(seen.size).toBe(2);
  });
});
