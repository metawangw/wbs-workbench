import type { ProjectPageKey } from './pages';

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
  /** Task creation date, `YYYY-MM-DD`. */
  created?: string;
  /** '1' (or true-like) shows the creation date before the task name in the list. */
  showCreated?: string;
  /** '1' marks a title/heading task, rendered with a background highlight. */
  isTitle?: string;
  /** '1' marks a version/release task: it can host child tasks and own a date. */
  isVersion?: string;
  /** Stable id of the version task this task belongs to; its due date follows it. */
  version?: string;
  /** '1' marks the task for 项目总览 → 今日关注 (sticky note). */
  focus?: string;
  /** Sticky-note background colour (`#rrggbb`) shown in 今日关注. */
  focusColor?: string;
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
  /** 简介 / 里程碑 / 风险 / 成本 / 相关方 五个独立页面。简介存于 description 块。 */
  pages?: Partial<Record<ProjectPageKey, string>>;
  /** Front Matter `pageOrder`：用户拖动后确定的页面展示顺序。 */
  pageOrder?: ProjectPageKey[];
  /** Front Matter `milestoneTasks`：里程碑页关联的任务 id 列表。 */
  milestoneTasks?: string[];
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

/** A task pinned to 项目总览 → 今日关注, flattened for the sticky-note board. */
export interface FocusTask {
  id: string;
  /** WBS numbering, e.g. `3.2.1`. */
  code: string;
  title: string;
  priority?: string;
  owner?: string;
  due?: string;
  /** User-chosen sticky-note colour; absent = auto paper colour. */
  color?: string;
  done: boolean;
  /** Latest progress text (single line, server-truncated). */
  latest?: string;
  latestDate?: string;
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
  /** Hand-managed tags (`tags: [a, b]` in Front Matter). */
  tags?: string[];
  /** Tasks marked for 今日关注; absent when none. */
  focusTasks?: FocusTask[];
  updated?: string;
  stats: ProjectStats;
}

export interface ProjectDetail extends ProjectSummary {
  meta: Record<string, unknown>;
  title?: string;
  /** 简介 / 里程碑 / 风险 / 成本 / 相关方：空的 key 表示还没有内容。 */
  pages: Partial<Record<ProjectPageKey, string>>;
  /** 页面展示顺序（简介 / 里程碑 / 风险 / 成本 / 相关方），可拖动调整。 */
  pageOrder: ProjectPageKey[];
  /** 里程碑页关联的任务 id 列表（Front Matter `milestoneTasks`）。 */
  milestoneTasks: string[];
  roots: TaskNode[];
  /** Ordered H2 group names (`## name`), including empty ones. */
  sections: string[];
  /** 分组名 → 分组描述（H2 行尾 `<!-- desc:… -->` 注释）。 */
  sectionDescriptions: Record<string, string>;
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
