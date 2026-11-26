/**
 * Client-side settings helpers.
 *
 * Canonical types/defaults/validation live in @wbs/shared and are persisted by
 * the server in `.wbs-config.json`. localStorage is kept only as an
 * instant-paint cache so the first frame does not flash before the server
 * responds; the server config is always the source of truth on `init()`.
 */

import {
  BRAND_ACCENT,
  DEFAULT_APPEARANCE,
  DEFAULT_BRAND,
  DEFAULT_CREATED_COLOR,
  DEFAULT_IMP_HIGH_COLOR,
  DEFAULT_IMP_LOW_COLOR,
  DEFAULT_IMP_MID_COLOR,
  DEFAULT_P0_COLOR,
  DEFAULT_P1_COLOR,
  DEFAULT_P2_COLOR,
  DEFAULT_PROJECT_STATUSES,
  DEFAULT_SETTINGS,
  DEFAULT_TITLE_COLOR,
  DEFAULT_VERSION_COLOR,
  MAX_PROJECT_STATUSES,
  MAX_PROJECT_STATUS_NAME,
  PROJECT_STATUS_ICONS,
  STATUS_COLOR_POOL,
  buildFavicon,
  defaultStatusIcon,
  fontSizeBump,
  normalizeAppearance,
  normalizeBrand,
  normalizeProjectStatuses,
  normalizeSettings,
  projectStatusColor,
  projectStatusIcon,
  type AppearanceSettings,
  type AppSettings,
  type BrandSettings,
  type FontSize,
  type ListProgressAlign,
  type ListProgressDetail,
  type PageStyle,
  type ProjectStatusDef,
  type ProjectStatusIconKey,
} from '@wbs/shared';

export {
  BRAND_ACCENT,
  DEFAULT_APPEARANCE,
  DEFAULT_BRAND,
  DEFAULT_CREATED_COLOR,
  DEFAULT_IMP_HIGH_COLOR,
  DEFAULT_IMP_LOW_COLOR,
  DEFAULT_IMP_MID_COLOR,
  DEFAULT_P0_COLOR,
  DEFAULT_P1_COLOR,
  DEFAULT_P2_COLOR,
  DEFAULT_PROJECT_STATUSES,
  DEFAULT_SETTINGS,
  DEFAULT_TITLE_COLOR,
  DEFAULT_VERSION_COLOR,
  MAX_PROJECT_STATUSES,
  MAX_PROJECT_STATUS_NAME,
  PROJECT_STATUS_ICONS,
  STATUS_COLOR_POOL,
  buildFavicon,
  defaultStatusIcon,
  fontSizeBump,
  normalizeAppearance,
  normalizeBrand,
  normalizeProjectStatuses,
  normalizeSettings,
  projectStatusColor,
  projectStatusIcon,
  type AppearanceSettings,
  type AppSettings,
  type BrandSettings,
  type FontSize,
  type ListProgressAlign,
  type ListProgressDetail,
  type PageStyle,
  type ProjectStatusDef,
  type ProjectStatusIconKey,
};

export interface PresetColor {
  name: string;
  value: string;
}

export const ICON_COLOR_PRESETS: PresetColor[] = [
  { name: '经典蓝', value: '#2563eb' },
  { name: '靛青', value: '#4f46e5' },
  { name: '优雅紫', value: '#7a5af8' },
  { name: '青碧', value: '#0e9384' },
  { name: '生机绿', value: '#12b76a' },
  { name: '活力橙', value: '#f79009' },
  { name: '热情红', value: '#d92d20' },
];

const KEY_SETTINGS = 'wbs.settings.v2';

function readCache(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY_SETTINGS);
    if (!raw) return normalizeSettings(DEFAULT_SETTINGS);
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

function writeCache(value: AppSettings): void {
  try {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(value));
  } catch {
    /* storage may be unavailable; settings still apply for this session */
  }
}

/** Instant-paint cache read (server value overwrites it on init). */
export function loadAppearance(): AppearanceSettings {
  return readCache().appearance;
}

export function loadBrand(): BrandSettings {
  return readCache().brand;
}

export function loadStatuses(): ProjectStatusDef[] {
  return readCache().statuses;
}

export function saveAppearance(value: AppearanceSettings): void {
  writeCache({ ...readCache(), appearance: value });
}

export function saveBrand(value: BrandSettings): void {
  writeCache({ ...readCache(), brand: value });
}

export function saveStatuses(value: ProjectStatusDef[]): void {
  writeCache({ ...readCache(), statuses: value });
}

/** Cache the settings received from the server so the next paint is instant. */
export function cacheSettings(value: AppSettings): void {
  writeCache(normalizeSettings(value));
}
