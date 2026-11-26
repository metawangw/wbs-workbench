/**
 * Canonical, server-persisted workbench settings.
 *
 * These definitions live in the shared package so the web client and the
 * server agree on shape, defaults and validation. The server stores them in
 * `.wbs-config.json`, making them accessible from any browser that opens the
 * workbench (localStorage is kept only as an instant-paint cache/fallback).
 */

export type FontSize = 'small' | 'normal' | 'large';
export type PageStyle = 'light' | 'dark';
/** 列表模式下「最新进展」的展示档位：只有标签 / 标签+日期 / 完整内容。 */
export type ListProgressDetail = 'label' | 'date' | 'full';
/** 列表模式下「最新进展」的位置：靠单元格右侧 / 紧跟任务描述。 */
export type ListProgressAlign = 'right' | 'left';

/** 今日关注贴纸（每列）宽度范围与默认值，单位 px。 */
export const FOCUS_CARD_WIDTH_MIN = 200;
export const FOCUS_CARD_WIDTH_MAX = 300;
export const DEFAULT_FOCUS_CARD_WIDTH = 272;

export interface AppearanceSettings {
  pageStyle: PageStyle;
  fontSize: FontSize;
  compact: boolean;
  /** Highlight colour for title-type task rows. */
  titleColor: string;
  /** Colour of the creation-date chip shown before task names. */
  createdColor: string;
  /** Colour of version-type tasks:「版本」标记的文字与底色. */
  versionColor: string;
  /** Priority marker colours for P0 / P1 / P2. */
  p0Color: string;
  p1Color: string;
  p2Color: string;
  /** Importance marker colours for 高 / 中 / 低. */
  impHighColor: string;
  impMidColor: string;
  impLowColor: string;
  /** Whether the quick settings bar (search / filters / columns) is visible. */
  showQuickBar: boolean;
  /** Whether the per-task done checkbox is rendered in the views. */
  showCheckbox: boolean;
  /** 列表行「最新进展」展示到什么程度。 */
  listProgressDetail: ListProgressDetail;
  /** 列表行「最新进展」是贴右还是紧跟任务标题。 */
  listProgressAlign: ListProgressAlign;
  /** 今日关注看板中贴纸（项目列）的宽度。 */
  focusCardWidth: number;
}

export interface BrandSettings {
  /** Whether the sidebar brand block (mark + name) is rendered. */
  show: boolean;
  title: string;
  subtitle: string;
  icon: string;
  iconColor: string;
  iconRadius: number;
}

/** 项目状态前置图标库：key 持久化在配置里，label 用于设置页展示。 */
export const PROJECT_STATUS_ICONS = [
  { key: 'dot', label: '实心圆' },
  { key: 'ring', label: '空心环' },
  { key: 'ringDot', label: '环中点' },
  { key: 'dashed', label: '虚线环' },
  { key: 'half', label: '半填充' },
  { key: 'threeQuarter', label: '四分之三填充' },
  { key: 'check', label: '对勾圆' },
  { key: 'pause', label: '暂停圆' },
  { key: 'slash', label: '禁止圆' },
  { key: 'square', label: '方块' },
  { key: 'diamond', label: '菱形' },
  { key: 'hexagon', label: '六边形' },
  { key: 'flag', label: '旗帜' },
  { key: 'bolt', label: '闪电' },
  { key: 'star', label: '星形' },
  { key: 'clock', label: '时钟' },
  { key: 'archive', label: '归档盒' },
  { key: 'target', label: '靶心' },
] as const;

export type ProjectStatusIconKey = (typeof PROJECT_STATUS_ICONS)[number]['key'];

const PROJECT_STATUS_ICON_KEYS = new Set<string>(
  PROJECT_STATUS_ICONS.map((item) => item.key),
);

/** 按状态名推断默认图标，兼容旧配置（没有 icon 字段）。 */
export function defaultStatusIcon(name: string | undefined): ProjectStatusIconKey {
  const value = name?.trim() ?? '';
  if (/规划|待定|未启动|筹备/.test(value)) return 'dashed';
  if (/进行|实施|开发|执行/.test(value)) return 'half';
  if (/待.*验|验收|评审|测试/.test(value)) return 'threeQuarter';
  if (/稳定|运营|完成|正常|上线/.test(value)) return 'check';
  if (/暂停|挂起|搁置/.test(value)) return 'pause';
  if (/终止|取消|失败|中止/.test(value)) return 'slash';
  if (/归档|封存|关闭/.test(value)) return 'ringDot';
  return 'ring';
}

/** One selectable project status: a name, colour and a leading icon key. */
export interface ProjectStatusDef {
  name: string;
  color: string;
  icon?: ProjectStatusIconKey;
}

export interface AppSettings {
  appearance: AppearanceSettings;
  brand: BrandSettings;
  /** User-defined project statuses (name + colour + order). */
  statuses: ProjectStatusDef[];
}

export const BRAND_ACCENT = '#2563eb';

export const ICON_COLOR_PRESETS: Array<{ name: string; value: string }> = [
  { name: '经典蓝', value: '#2563eb' },
  { name: '靛青', value: '#4f46e5' },
  { name: '优雅紫', value: '#7a5af8' },
  { name: '青碧', value: '#0e9384' },
  { name: '生机绿', value: '#12b76a' },
  { name: '活力橙', value: '#f79009' },
  { name: '热情红', value: '#d92d20' },
];

export const DEFAULT_TITLE_COLOR = BRAND_ACCENT;
export const DEFAULT_CREATED_COLOR = BRAND_ACCENT;
/** 版本类型任务默认沿用原来的靛蓝（#3538cd）。 */
export const DEFAULT_VERSION_COLOR = '#3538cd';
export const DEFAULT_P0_COLOR = '#d92d20';
export const DEFAULT_P1_COLOR = '#b54708';
export const DEFAULT_P2_COLOR = '#475467';
/** 重要性与优先级共用同一套三档色，视觉上「高= P0」「中= P1」「低= P2」。 */
export const DEFAULT_IMP_HIGH_COLOR = DEFAULT_P0_COLOR;
export const DEFAULT_IMP_MID_COLOR = DEFAULT_P1_COLOR;
export const DEFAULT_IMP_LOW_COLOR = DEFAULT_P2_COLOR;

export const MAX_PROJECT_STATUSES = 12;
export const MAX_PROJECT_STATUS_NAME = 8;

/** Fallback palette used when a status comes without a valid colour. */
export const STATUS_COLOR_POOL = [
  '#2563eb',
  '#7a5af8',
  '#12b76a',
  '#f79009',
  '#d92d20',
  '#0e9384',
  '#475467',
  '#b54708',
];

export const DEFAULT_PROJECT_STATUSES: ProjectStatusDef[] = [
  { name: '规划中', color: '#7a5af8', icon: 'dashed' },
  { name: '进行中', color: '#2563eb', icon: 'half' },
  { name: '稳定运营', color: '#12b76a', icon: 'check' },
  { name: '已归档', color: '#667085', icon: 'ringDot' },
];

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  pageStyle: 'light',
  fontSize: 'normal',
  compact: false,
  titleColor: DEFAULT_TITLE_COLOR,
  createdColor: DEFAULT_CREATED_COLOR,
  versionColor: DEFAULT_VERSION_COLOR,
  p0Color: DEFAULT_P0_COLOR,
  p1Color: DEFAULT_P1_COLOR,
  p2Color: DEFAULT_P2_COLOR,
  impHighColor: DEFAULT_IMP_HIGH_COLOR,
  impMidColor: DEFAULT_IMP_MID_COLOR,
  impLowColor: DEFAULT_IMP_LOW_COLOR,
  showQuickBar: true,
  showCheckbox: true,
  listProgressDetail: 'full',
  listProgressAlign: 'right',
  focusCardWidth: DEFAULT_FOCUS_CARD_WIDTH,
};

export const DEFAULT_BRAND: BrandSettings = {
  show: true,
  title: 'WBS 工作台',
  subtitle: 'Local-first · Markdown',
  icon: 'W',
  iconColor: BRAND_ACCENT,
  iconRadius: 7,
};

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: { ...DEFAULT_APPEARANCE },
  brand: { ...DEFAULT_BRAND },
  statuses: DEFAULT_PROJECT_STATUSES.map((status) => ({ ...status })),
};

/** 把旧默认色一次性迁到新默认色（只认完全相等的旧值）。 */
function migrateLegacyColor(value: string, legacy: string, next: string): string {
  return value.toLowerCase() === legacy ? next : value;
}

/** Coerce an unknown value into a valid AppearanceSettings object. */
export function normalizeAppearance(value: unknown): AppearanceSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const pageStyle = raw.pageStyle === 'dark' ? 'dark' : 'light';
  const fontSize: FontSize =
    raw.fontSize === 'small' || raw.fontSize === 'large' ? raw.fontSize : 'normal';
  const color = (value: unknown, fallback: string): string =>
    /^#[0-9a-fA-F]{6}$/.test(String(value ?? '')) ? String(value) : fallback;
  const listProgressDetail: ListProgressDetail =
    raw.listProgressDetail === 'label' || raw.listProgressDetail === 'date'
      ? raw.listProgressDetail
      : 'full';
  const listProgressAlign: ListProgressAlign =
    raw.listProgressAlign === 'left' ? 'left' : 'right';
  const widthNum = Number(raw.focusCardWidth);
  const focusCardWidth = Number.isFinite(widthNum)
    ? Math.max(FOCUS_CARD_WIDTH_MIN, Math.min(FOCUS_CARD_WIDTH_MAX, Math.round(widthNum)))
    : DEFAULT_FOCUS_CARD_WIDTH;
  return {
    pageStyle,
    fontSize,
    compact: raw.compact === true,
    titleColor: color(raw.titleColor, DEFAULT_TITLE_COLOR),
    createdColor: color(raw.createdColor, DEFAULT_CREATED_COLOR),
    versionColor: color(raw.versionColor, DEFAULT_VERSION_COLOR),
    p0Color: color(raw.p0Color, DEFAULT_P0_COLOR),
    p1Color: color(raw.p1Color, DEFAULT_P1_COLOR),
    p2Color: color(raw.p2Color, DEFAULT_P2_COLOR),
    impHighColor: color(raw.impHighColor, DEFAULT_IMP_HIGH_COLOR),
    // 旧版本的「中/低」默认色（#f79009 / #667085）统一到「中= P1、低= P2」，
    // 只迁移恰好等于旧默认值的配置，手动改过的颜色原样保留。
    impMidColor: migrateLegacyColor(
      color(raw.impMidColor, DEFAULT_IMP_MID_COLOR),
      '#f79009',
      DEFAULT_IMP_MID_COLOR,
    ),
    impLowColor: migrateLegacyColor(
      color(raw.impLowColor, DEFAULT_IMP_LOW_COLOR),
      '#667085',
      DEFAULT_IMP_LOW_COLOR,
    ),
    // Older config files have no `showQuickBar` key — default to visible.
    showQuickBar: raw.showQuickBar !== false,
    // Same for the done checkbox: missing key means visible.
    showCheckbox: raw.showCheckbox !== false,
    // 旧配置没有这两个键：默认「完整内容 + 靠右」，正文尽量展示完整。
    listProgressDetail,
    listProgressAlign,
    focusCardWidth,
  };
}

/** Coerce an unknown value into a valid BrandSettings object. */
export function normalizeBrand(value: unknown): BrandSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  // Older config files have no `show` key — default to visible.
  const show = raw.show !== false;
  // Allow an empty title: the user must be able to clear it before typing a new
  // name. Display layers already fall back to the default when it is empty.
  const title = typeof raw.title === 'string' ? raw.title : DEFAULT_BRAND.title;
  const subtitle = typeof raw.subtitle === 'string' ? raw.subtitle : DEFAULT_BRAND.subtitle;
  // Allow an empty icon: the user must be able to clear it before typing a new
  // glyph. Display layers already fall back to 'W' when icon is empty.
  const icon = typeof raw.icon === 'string' ? raw.icon.slice(0, 2) : DEFAULT_BRAND.icon;
  const iconColor = /^#[0-9a-fA-F]{6}$/.test(String(raw.iconColor ?? ''))
    ? String(raw.iconColor)
    : DEFAULT_BRAND.iconColor;
  const radiusNum = Number(raw.iconRadius);
  const iconRadius = Number.isFinite(radiusNum)
    ? Math.max(0, Math.min(24, Math.round(radiusNum)))
    : DEFAULT_BRAND.iconRadius;
  return { show, title, subtitle, icon, iconColor, iconRadius };
}

/** Coerce an unknown value into a valid, de-duplicated project status list. */
export function normalizeProjectStatuses(value: unknown): ProjectStatusDef[] {
  // Missing value (old config files) -> ship the defaults. An explicit empty
  // array is respected: the user may want to clear every preset.
  if (!Array.isArray(value)) return DEFAULT_PROJECT_STATUSES.map((status) => ({ ...status }));

  const out: ProjectStatusDef[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const name = String(raw.name ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_PROJECT_STATUS_NAME);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(raw.color ?? ''))
      ? String(raw.color)
      : STATUS_COLOR_POOL[out.length % STATUS_COLOR_POOL.length];
    const rawIcon = String(raw.icon ?? '');
    const icon = PROJECT_STATUS_ICON_KEYS.has(rawIcon)
      ? (rawIcon as ProjectStatusIconKey)
      : defaultStatusIcon(name);
    out.push({ name, color, icon });
    if (out.length >= MAX_PROJECT_STATUSES) break;
  }
  return out;
}

/**
 * Resolve the colour for a project status name. Unknown names (projects saved
 * before statuses became configurable) fall back to the legacy tone mapping.
 */
export function projectStatusColor(
  name: string | undefined,
  statuses: ProjectStatusDef[],
): string {
  const value = name?.trim();
  if (!value) return '#98a2b3';
  const hit = statuses.find((status) => status.name === value);
  if (hit) return hit.color;
  if (/稳定|运营|完成|正常/.test(value)) return '#12b76a';
  if (/归档|停止|暂停|下线/.test(value)) return '#667085';
  return '#2563eb';
}

/** Resolve the configured leading-icon key for a project status name. */
export function projectStatusIcon(
  name: string | undefined,
  statuses: ProjectStatusDef[],
): ProjectStatusIconKey {
  const value = name?.trim();
  if (!value) return 'ring';
  const hit = statuses.find((status) => status.name === value);
  if (hit?.icon && PROJECT_STATUS_ICON_KEYS.has(hit.icon)) return hit.icon;
  return defaultStatusIcon(value);
}

/**
 * 已归档 / 已终止的项目为只读状态：只允许修改项目信息（名称、编号、状态等），
 * 任务、页面、分组、进展等内容一律不可编辑。按状态名匹配，兼容用户自定义的状态名。
 */
export function isLockedProjectStatus(status: string | undefined): boolean {
  return /归档|终止/.test(status?.trim() ?? '');
}

/** Coerce an unknown value into a full, valid AppSettings object. */
export function normalizeSettings(value: unknown): AppSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    appearance: normalizeAppearance(raw.appearance),
    brand: normalizeBrand(raw.brand),
    statuses: normalizeProjectStatuses(raw.statuses),
  };
}

export function fontSizeBump(size: FontSize): number {
  if (size === 'small') return 0;
  if (size === 'large') return 4;
  return 2;
}

/** Build a data-URI favicon from the configured brand glyph, colour and radius. */
export function buildFavicon(icon: string, color: string, radius: number): string {
  const glyph = (icon.trim() || 'W').replace(/[<>&"']/g, '').slice(0, 2);
  const accent = /^#[0-9a-fA-F]{6}$/.test(color) ? color : BRAND_ACCENT;
  const rx = Math.max(0, Math.min(24, Math.round(radius || 0)));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${rx}" fill="${accent}"/><text x="32" y="44" text-anchor="middle" font-family="Segoe UI,Microsoft YaHei,sans-serif" font-size="34" font-weight="700" fill="#fff">${glyph}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
