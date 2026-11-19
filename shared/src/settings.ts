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

export interface AppearanceSettings {
  pageStyle: PageStyle;
  fontSize: FontSize;
  compact: boolean;
}

export interface BrandSettings {
  title: string;
  subtitle: string;
  icon: string;
  iconColor: string;
  iconRadius: number;
}

export interface AppSettings {
  appearance: AppearanceSettings;
  brand: BrandSettings;
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

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  pageStyle: 'light',
  fontSize: 'normal',
  compact: false,
};

export const DEFAULT_BRAND: BrandSettings = {
  title: 'WBS 工作台',
  subtitle: 'Local-first · Markdown',
  icon: 'W',
  iconColor: BRAND_ACCENT,
  iconRadius: 7,
};

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: { ...DEFAULT_APPEARANCE },
  brand: { ...DEFAULT_BRAND },
};

/** Coerce an unknown value into a valid AppearanceSettings object. */
export function normalizeAppearance(value: unknown): AppearanceSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const pageStyle = raw.pageStyle === 'dark' ? 'dark' : 'light';
  const fontSize: FontSize =
    raw.fontSize === 'small' || raw.fontSize === 'large' ? raw.fontSize : 'normal';
  return {
    pageStyle,
    fontSize,
    compact: raw.compact === true,
  };
}

/** Coerce an unknown value into a valid BrandSettings object. */
export function normalizeBrand(value: unknown): BrandSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title : DEFAULT_BRAND.title;
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
  return { title, subtitle, icon, iconColor, iconRadius };
}

/** Coerce an unknown value into a full, valid AppSettings object. */
export function normalizeSettings(value: unknown): AppSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    appearance: normalizeAppearance(raw.appearance),
    brand: normalizeBrand(raw.brand),
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
