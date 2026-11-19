export interface TaskFields {
  owner?: string;
  priority?: string;
  importance?: string;
  /** Planned start date, `YYYY-MM-DD`. Used by the Gantt view to draw bars. */
  start?: string;
  due?: string;
  cycle?: string;
  confirm?: string;
  /** Completion percentage 0-100 (stored as a decimal string). */
  progress?: string;
  /** Comma-separated predecessor task IDs (finish-to-start dependencies). */
  deps?: string;
  [key: string]: string | undefined;
}

export interface ProgressEntry {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time?: string;
  author?: string;
  text: string;
  /** Absolute line index in the source file */
  line: number;
}

export interface TaskNode {
  id: string;
  /** true when the task has no persisted `<!-- id -->` comment yet */
  synthetic: boolean;
  line: number;
  indent: number;
  title: string;
  done: boolean;
  fields: TaskFields;
  progress: ProgressEntry[];
  children: TaskNode[];
  section?: string;
}

export interface ProjectDoc {
  meta: Record<string, unknown>;
  title?: string;
  /** Markdown description between the front matter and the H1 title. */
  description?: string;
  roots: TaskNode[];
  byId: Map<string, TaskNode>;
  lines: string[];
  eol: '\n' | '\r\n';
  warnings: string[];
}

export interface ProjectStats {
  total: number;
  open: number;
  done: number;
  p0: number;
  overdue: number;
  today: number;
  byPriority: Record<string, number>;
}

export interface ProjectSummary {
  id: string;
  path: string;
  /** Manual order in the sidebar; absent until the user drags a project. */
  order?: number;
  name: string;
  code?: string;
  status?: string;
  /** Markdown description shown when hovering the project name. */
  description?: string;
  updated?: string;
  stats: ProjectStats;
}

export interface ProjectDetail extends ProjectSummary {
  meta: Record<string, unknown>;
  title?: string;
  roots: TaskNode[];
  /** Ordered H2 group names (`## name`), including empty ones. */
  sections: string[];
  warnings: string[];
  owners: string[];
  lineCount: number;
}

export type ProjectMeta = {
  wbs?: number;
  project?: string;
  code?: string;
  status?: string;
  owner?: string;
  updated?: string;
  [key: string]: unknown;
};
