export type Profile = {
  id: string;
  role: "student" | "teacher";
  full_name: string;
  active: boolean;
};
export type Module = {
  course_module_id?: string;
  course_module_title?: string;
  subject_id?: string;
  subject_name?: string;
  id: string;
  title: string;
  status: string;
  question_count: number;
  seconds_per_question: number;
  total_seconds: number;
  max_score: number;
  selection_mode: string;
  quotas: Record<string, number>;
  available?: boolean;
  attempt_id?: string;
  attempt_status?: string;
};
export type Current = {
  course_module_title?: string;
  subject_name?: string;
  attempt_id: string;
  done: boolean;
  published?: boolean;
  score?: number;
  correct?: number;
  max_score?: number;
  title: string;
  index?: number;
  total: number;
  question?: string;
  options?: { id: string; text: string }[];
  server_now: string;
  question_deadline?: string;
  attempt_deadline: string;
  outcome?: string;
};
export type Group = { id: string; name: string };
export type Student = {
  id: string;
  full_name: string;
  login: string;
  group_id: string;
  active: boolean;
  auth_id: string;
};
export type Question = {
  id?: string;
  external_id: string;
  lecture: string;
  difficulty: string;
  text: string;
  options: string[];
  correct: number;
  active: boolean;
};
export type Attempt = {
  module_id: string;
  id: string;
  full_name: string;
  group_id: string;
  status: string;
  current_index: number;
  question_count: number;
  started_at: string;
  finished_at: string | null;
  correct_count: number | null;
  score: number | null;
};
export type AdminData = {
  subjects: { id: string; name: string }[];
  course_modules: {
    id: string;
    subject_id: string;
    title: string;
    position: number;
  }[];
  modules: Module[];
  groups: Group[];
  students: Student[];
  attempts: Attempt[];
  module_groups: {
    module_id: string;
    group_id: string;
    access: boolean;
    window_start: string | null;
    window_end: string | null;
  }[];
  stats: {
    students: number;
    groups: number;
    started: number;
    active: number;
    finished: number;
    average: number | null;
  };
};
