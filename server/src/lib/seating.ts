/**
 * Seat randomisation. Implements PRD §3.5.2 constraints:
 *  - pinned students keep their exact seat (AC-8)
 *  - students carrying `frontRowTagIds` get first claim on the row(s) nearest
 *    the podium; everyone else fills row-by-row from the podium outward too
 *    (each row shuffled internally), rather than being scattered uniformly
 *    across every remaining seat — a class should fill its front rows before
 *    leaving gaps up front and people in the back.
 *  - `podium` ('top' | 'bottom', default 'top') says which row is physically
 *    nearest the front of the room; "row 0" is only "the front" when podium
 *    is 'top'.
 *  - optional "avoid same gender adjacent" as a best-effort local repair
 */

export type SeatCell = { rowIndex: number; colIndex: number };

export type RandomizeStudent = {
  id: string;
  gender?: string | null;
  tagIds?: string[];
};

export type ExistingAssignment = {
  studentId: string;
  rowIndex: number;
  colIndex: number;
  isPinned: boolean;
};

export type RandomizeOptions = {
  rowCount: number;
  colCount: number;
  disabledCells?: [number, number][];
  keepPinned?: boolean;
  frontRowTagIds?: string[];
  avoidSameGenderAdjacent?: boolean;
  /** Which row is nearest the podium/front of the room. Defaults to 'top' (row 0). */
  podium?: 'top' | 'bottom';
  /** Injectable RNG so tests are deterministic. */
  rng?: () => number;
};

export type RandomizeResult = {
  assignments: { studentId: string; rowIndex: number; colIndex: number; isPinned: boolean }[];
};

function cellKey(r: number, c: number) {
  return `${r}:${c}`;
}

export function availableCells(
  rowCount: number,
  colCount: number,
  disabled: [number, number][] = [],
): SeatCell[] {
  const blocked = new Set(disabled.map(([r, c]) => cellKey(r, c)));
  const cells: SeatCell[] = [];
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      if (!blocked.has(cellKey(r, c))) cells.push({ rowIndex: r, colIndex: c });
    }
  }
  return cells;
}

/** Fisher-Yates with injectable RNG. */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function randomizeSeating(
  students: RandomizeStudent[],
  existing: ExistingAssignment[],
  options: RandomizeOptions,
): RandomizeResult {
  const rng = options.rng ?? Math.random;
  const keepPinned = options.keepPinned !== false;

  const pinned = keepPinned ? existing.filter((a) => a.isPinned) : [];
  const pinnedStudentIds = new Set(pinned.map((p) => p.studentId));
  const pinnedCells = new Set(pinned.map((p) => cellKey(p.rowIndex, p.colIndex)));

  const all = availableCells(options.rowCount, options.colCount, options.disabledCells);
  const freeCells = all.filter((c) => !pinnedCells.has(cellKey(c.rowIndex, c.colIndex)));

  const toPlace = students.filter((s) => !pinnedStudentIds.has(s.id));

  if (toPlace.length > freeCells.length) {
    const err: Error & { shortfall?: number } = new Error(
      `可用座位不足：需要 ${toPlace.length} 个，仅剩 ${freeCells.length} 个`,
    );
    err.shortfall = toPlace.length - freeCells.length;
    throw err;
  }

  // "Distance from the podium": row 0 is the front when podium is 'top'
  // (default); when it's 'bottom', the last row is. Both the front-row-tag
  // placement and the general fill-order below measure from this, not from
  // a hardcoded row 0, so a chart with podium:'bottom' fills correctly.
  const podium = options.podium ?? 'top';
  const distanceFromPodium = (rowIndex: number) =>
    podium === 'bottom' ? options.rowCount - 1 - rowIndex : rowIndex;

  // Front-row-tag students get first claim on the cells nearest the podium.
  const frontTags = new Set(options.frontRowTagIds ?? []);
  const isFront = (s: RandomizeStudent) => (s.tagIds ?? []).some((t) => frontTags.has(t));

  const frontStudents = shuffle(toPlace.filter(isFront), rng);
  // Shuffle once up front so *which* students land in which row is random;
  // the row-by-row grouping below only constrains fill *order*, not who ends
  // up where within that order.
  const otherStudents = shuffle(toPlace.filter((s) => !isFront(s)), rng);

  const sortedCells = [...freeCells].sort(
    (a, b) => distanceFromPodium(a.rowIndex) - distanceFromPodium(b.rowIndex) || a.colIndex - b.colIndex,
  );
  const frontCells = sortedCells.slice(0, frontStudents.length);
  const cellsForOthers = sortedCells.slice(frontStudents.length);

  // Fill row-by-row outward from the podium: group the remaining cells by
  // distance, shuffle the seat order *within* each row group (so who sits at
  // which column is still random), then hand out `otherStudents` in that
  // concatenated order — so a row fills up before the next one gets anyone,
  // rather than students being scattered uniformly across every open seat.
  const rowGroups = new Map<number, SeatCell[]>();
  for (const cell of cellsForOthers) {
    const d = distanceFromPodium(cell.rowIndex);
    if (!rowGroups.has(d)) rowGroups.set(d, []);
    rowGroups.get(d)!.push(cell);
  }
  const remainingCells = [...rowGroups.keys()]
    .sort((a, b) => a - b)
    .flatMap((d) => shuffle(rowGroups.get(d)!, rng));

  const assignments = [
    ...pinned.map((p) => ({
      studentId: p.studentId,
      rowIndex: p.rowIndex,
      colIndex: p.colIndex,
      isPinned: true,
    })),
    ...frontStudents.map((s, i) => ({
      studentId: s.id,
      rowIndex: frontCells[i].rowIndex,
      colIndex: frontCells[i].colIndex,
      isPinned: false,
    })),
    ...otherStudents.map((s, i) => ({
      studentId: s.id,
      rowIndex: remainingCells[i].rowIndex,
      colIndex: remainingCells[i].colIndex,
      isPinned: false,
    })),
  ];

  if (options.avoidSameGenderAdjacent) {
    return { assignments: repairAdjacency(assignments, students, pinnedStudentIds, rng) };
  }

  return { assignments };
}

/**
 * Best-effort: swap horizontally adjacent same-gender pairs with a random
 * non-pinned seat elsewhere. This is a heuristic, not a guarantee — a class of
 * one gender obviously cannot satisfy the constraint.
 */
function repairAdjacency(
  assignments: RandomizeResult['assignments'],
  students: RandomizeStudent[],
  pinnedStudentIds: Set<string>,
  rng: () => number,
): RandomizeResult['assignments'] {
  const genderOf = new Map(students.map((s) => [s.id, s.gender ?? null]));
  const result = [...assignments];
  const at = new Map(result.map((a, i) => [cellKey(a.rowIndex, a.colIndex), i]));

  const maxPasses = 4;
  for (let pass = 0; pass < maxPasses; pass++) {
    let swapped = false;
    for (const a of result) {
      const rightIdx = at.get(cellKey(a.rowIndex, a.colIndex + 1));
      if (rightIdx === undefined) continue;
      const b = result[rightIdx];
      const ga = genderOf.get(a.studentId);
      const gb = genderOf.get(b.studentId);
      if (!ga || !gb || ga !== gb) continue;

      const candidates = result.filter(
        (c) =>
          !pinnedStudentIds.has(c.studentId) &&
          genderOf.get(c.studentId) &&
          genderOf.get(c.studentId) !== ga,
      );
      if (candidates.length === 0) continue;

      const pick = candidates[Math.floor(rng() * candidates.length)];
      if (pinnedStudentIds.has(b.studentId)) continue;

      const tmp = b.studentId;
      b.studentId = pick.studentId;
      pick.studentId = tmp;
      swapped = true;
    }
    if (!swapped) break;
  }
  return result;
}
