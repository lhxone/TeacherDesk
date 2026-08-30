export type Envelope<T> = { data: T };
export type PageMeta = { page: number; pageSize: number; total: number; totalPages: number };
export type Paged<T> = { data: T[]; meta: PageMeta };

export type User = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  settings: UserSettings;
  createdAt: string;
};

export type UserSettings = {
  periodsPerDay: number;
  showWeekend: boolean;
  periodTimes: [string, string][];
  gradeThresholds: { excellent: number; good: number; pass: number };
};

export type AuthResult = {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type ClassItem = {
  id: string;
  name: string;
  subject: string | null;
  academicYear: string;
  color: string;
  note: string | null;
  status: 'active' | 'archived';
  studentCount: number;
  latestExam?: { id: string; name: string; avg: number | null; examDate: string } | null;
  createdAt: string;
};

export type Tag = { id: string; name: string; color: string; studentCount?: number };

export type Student = {
  id: string;
  classId: string;
  name: string;
  studentNo: string | null;
  gender: 'male' | 'female' | 'other' | null;
  avatarUrl: string | null;
  phone: string | null;
  note: string | null;
  sortOrder: number;
  status: 'active' | 'inactive';
  tags: Tag[];
};

export type StudentDetail = Student & {
  className: string;
  stats: {
    examCount: number;
    avgScore: number | null;
    stddev: number | null;
    lotteryCount: number;
  };
  currentSeat: { seatingChartId: string; rowIndex: number; colIndex: number } | null;
};

export type ScheduleSlot = {
  id: string;
  classId: string | null;
  className: string | null;
  classColor: string | null;
  subject: string | null;
  weekday: number;
  period: number;
  location: string | null;
  repeatRule: 'weekly' | 'odd_week' | 'even_week';
  startDate: string | null;
  endDate: string | null;
  note: string | null;
};

export type AgendaDay = {
  date: string;
  weekday: number;
  weekParity: 'odd' | 'even';
  lessons: {
    slotId: string;
    period: number;
    startTime: string | null;
    endTime: string | null;
    subject: string | null;
    classId: string | null;
    className: string | null;
    classColor: string | null;
    location: string | null;
  }[];
  events: EventItem[];
};

export type EventItem = {
  id: string;
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  isDone: boolean;
  classId: string | null;
  className?: string | null;
  classColor?: string | null;
};

export type SeatLayout = {
  podium?: 'top' | 'bottom';
  disabledCells?: [number, number][];
  aisles?: { afterCols: number[] };
};

export type SeatingChartSummary = {
  id: string;
  classId: string;
  name: string;
  rowCount: number;
  colCount: number;
  layout: SeatLayout;
  isActive: boolean;
  assignedCount: number;
  updatedAt: string;
};

export type SeatAssignment = {
  studentId: string;
  studentName: string | null;
  studentNo: string | null;
  gender: string | null;
  rowIndex: number;
  colIndex: number;
  isPinned: boolean;
};

export type SeatingChartDetail = {
  id: string;
  classId: string;
  name: string;
  rowCount: number;
  colCount: number;
  layout: SeatLayout;
  isActive: boolean;
  assignments: SeatAssignment[];
  unassignedStudents: { id: string; name: string; studentNo: string | null; gender: string | null }[];
};

export type Exam = {
  id: string;
  classId: string;
  name: string;
  subject: string | null;
  examType: 'daily' | 'unit' | 'midterm' | 'final';
  examDate: string;
  fullScore: number;
  note: string | null;
  stats: ExamStats | null;
  entryProgress?: { entered: number; total: number };
};

export type ExamStats = {
  total: number;
  attended: number;
  absent: number;
  avg: number | null;
  max: number | null;
  min: number | null;
  median: number | null;
  stddev: number | null;
  passRate: number | null;
  excellentRate: number | null;
};

export type ScoreRow = {
  studentId: string;
  studentName: string;
  studentNo: string | null;
  score: number | null;
  isAbsent: boolean;
  comment: string | null;
};

export type ClassExamAnalytics = {
  exam: { id: string; name: string; subject: string | null; examDate: string; fullScore: number };
  summary: ExamStats;
  distribution: { range: string; count: number; ratio: number }[];
  gradeRatio: { grade: string; label: string; count: number; ratio: number }[];
  ranking: {
    rank: number;
    studentId: string;
    studentName: string | null;
    studentNo: string | null;
    score: number;
    previousRank: number | null;
    rankDelta: number | null;
  }[];
};

export type TrendPoint = {
  examId: string;
  examName: string;
  examDate: string;
  subject: string | null;
  fullScore: number | null;
  avg: number | null;
  max: number | null;
  min: number | null;
  median: number | null;
  stddev: number | null;
  passRate: number | null;
  excellentRate: number | null;
  attended: number;
};

export type StudentAnalytics = {
  student: { id: string; name: string; studentNo: string | null; classId: string; className: string };
  summary: {
    examCount: number;
    avgScore: number | null;
    bestScore: number | null;
    worstScore: number | null;
    stddev: number | null;
    avgRank: number | null;
    bestRank: number | null;
  };
  trend: {
    examId: string;
    examName: string;
    examDate: string;
    subject: string | null;
    score: number;
    fullScore: number | null;
    classAvg: number | null;
    rank: number | null;
    totalStudents: number;
    zScore: number;
  }[];
  subjectRadar: { subject: string; score: number; classAvg: number | null; zScore: number }[];
};

export type GroupResult = {
  groupIndex: number;
  name: string;
  members: { id: string; name: string; gender?: string | null; score?: number | null }[];
  avgScore: number | null;
};
