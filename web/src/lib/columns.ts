/**
 * Column visibility for the list view.
 *
 * The task column is always shown (it carries the checkbox, the code and the
 * title), so only the optional columns are stored. Keeping the preference in
 * `localStorage` matches the other view settings (view mode, filters, …).
 */
export const LIST_COLUMN_KEYS = [
  'owner',
  'priority',
  'importance',
  'due',
  'cycle',
  'status',
] as const;

export type ListColumnKey = (typeof LIST_COLUMN_KEYS)[number];

export type ListColumns = Record<ListColumnKey, boolean>;

export const LIST_COLUMN_LABELS: Record<ListColumnKey, string> = {
  owner: '联系人',
  priority: '优先级',
  importance: '重要性',
  due: '截止',
  cycle: '周期',
  status: '状态',
};

/**
 * Column widths, shared by the table and the exported document.
 *
 * These are the base widths for the default font size (14px row text). The
 * list view scales them with the font-size setting, so larger text gets
 * proportionally wider cells instead of overflowing its column.
 */
export const LIST_COLUMN_WIDTHS: Record<ListColumnKey, number> = {
  owner: 88,
  priority: 64,
  importance: 64,
  due: 152,
  cycle: 64,
  status: 78,
};

export const DEFAULT_LIST_COLUMNS: ListColumns = {
  owner: true,
  priority: true,
  importance: true,
  due: true,
  cycle: true,
  status: true,
};

const STORAGE_KEY = 'wbs.listColumns';

export function normalizeListColumns(value: unknown): ListColumns {
  const next = { ...DEFAULT_LIST_COLUMNS };
  if (!value || typeof value !== 'object') return next;
  for (const key of LIST_COLUMN_KEYS) {
    const flag = (value as Record<string, unknown>)[key];
    if (typeof flag === 'boolean') next[key] = flag;
  }
  return next;
}

export function loadListColumns(): ListColumns {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeListColumns(JSON.parse(raw)) : { ...DEFAULT_LIST_COLUMNS };
  } catch {
    return { ...DEFAULT_LIST_COLUMNS };
  }
}

export function saveListColumns(columns: ListColumns): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
  } catch {
    /* ignore quota / private-mode failures */
  }
}
