import React, { useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import {
  App as AntApp,
  ConfigProvider,
  theme as antdTheme,
  type ThemeConfig,
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import { useStore } from './store';
import {
  BRAND_ACCENT,
  DEFAULT_IMP_HIGH_COLOR,
  DEFAULT_IMP_LOW_COLOR,
  DEFAULT_IMP_MID_COLOR,
  DEFAULT_P0_COLOR,
  DEFAULT_P1_COLOR,
  DEFAULT_P2_COLOR,
  DEFAULT_VERSION_COLOR,
  buildFavicon,
  fontSizeBump,
} from './lib/settings';
import './styles.css';
import './gantt.css';
import './viz.css';
import './dark.css';

dayjs.locale('zh-cn');

function tint(hex: string, alpha: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alpha}` : hex;
}

function lighten(hex: string, ratio: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${channels
    .map((value) => Math.round(value + (255 - value) * ratio).toString(16).padStart(2, '0'))
    .join('')}`;
}

function applyDocumentStyles(): void {
  const { appearance, brand } = useStore.getState();
  const root = document.documentElement;
  root.setAttribute('data-theme', appearance.pageStyle);
  root.style.setProperty('--fs-bump', `${fontSizeBump(appearance.fontSize)}px`);
  // Brand mark colours are exposed as variables so the sidebar and favicon stay
  // in sync. P0/P1/P2 colours remain the fixed defaults in styles.css.
  root.style.setProperty('--brand-color', brand.iconColor || BRAND_ACCENT);
  root.style.setProperty('--brand-radius', `${brand.iconRadius ?? 7}px`);
  // User-configurable task markers (title rows / creation-date chips).
  const titleColor = appearance.titleColor || BRAND_ACCENT;
  const createdColor = appearance.createdColor || BRAND_ACCENT;
  root.style.setProperty('--title-color', titleColor);
  root.style.setProperty('--title-color-weak', tint(titleColor, '1a'));
  root.style.setProperty('--created-color', createdColor);
  root.style.setProperty('--created-color-weak', tint(createdColor, '14'));
  root.style.setProperty('--created-color-border', tint(createdColor, '40'));
  // Priority colours are user-configurable; dark mode gets a lighter text tone.
  const dark = appearance.pageStyle === 'dark';
  // 版本类型任务：「版本」标记的文字与底色同样跟着设置走。
  const versionColor = appearance.versionColor || DEFAULT_VERSION_COLOR;
  root.style.setProperty('--version-color', versionColor);
  root.style.setProperty('--version-color-weak', tint(versionColor, dark ? '29' : '14'));
  root.style.setProperty('--version-color-border', tint(versionColor, dark ? '4d' : '40'));
  const priorities: Array<[string, string, string]> = [
    ['p0', appearance.p0Color || DEFAULT_P0_COLOR, DEFAULT_P0_COLOR],
    ['p1', appearance.p1Color || DEFAULT_P1_COLOR, DEFAULT_P1_COLOR],
    ['p2', appearance.p2Color || DEFAULT_P2_COLOR, DEFAULT_P2_COLOR],
  ];
  for (const [key, value, fallback] of priorities) {
    const color = /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
    root.style.setProperty(`--${key}`, color);
    root.style.setProperty(`--${key}-weak`, tint(color, dark ? '29' : '14'));
    root.style.setProperty(`--${key}-text`, dark ? lighten(color, 0.45) : color);
  }
  // Importance tones (高 / 中 / 低) follow the same pattern.
  const importances: Array<[string, string, string]> = [
    ['imp-high', appearance.impHighColor || DEFAULT_IMP_HIGH_COLOR, DEFAULT_IMP_HIGH_COLOR],
    ['imp-mid', appearance.impMidColor || DEFAULT_IMP_MID_COLOR, DEFAULT_IMP_MID_COLOR],
    ['imp-low', appearance.impLowColor || DEFAULT_IMP_LOW_COLOR, DEFAULT_IMP_LOW_COLOR],
  ];
  for (const [key, value, fallback] of importances) {
    const color = /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
    root.style.setProperty(`--${key}`, color);
    root.style.setProperty(`--${key}-weak`, tint(color, dark ? '29' : '14'));
    root.style.setProperty(`--${key}-text`, dark ? lighten(color, 0.45) : color);
  }
  document.body.classList.toggle('compact-ui', appearance.compact);

  const favicon = buildFavicon(brand.icon, brand.iconColor, brand.iconRadius);
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = favicon;
}

/** Applies persisted appearance/brand to the document and keeps it reactive. */
function Root() {
  const appearance = useStore((state) => state.appearance);
  const brand = useStore((state) => state.brand);

  useEffect(() => {
    applyDocumentStyles();
  }, [appearance, brand]);

  const theme = useMemo<ThemeConfig>(() => {
    const dark = appearance.pageStyle === 'dark';
    return {
      algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: BRAND_ACCENT,
        colorInfo: BRAND_ACCENT,
        colorLink: BRAND_ACCENT,
        colorSuccess: '#12b76a',
        colorWarning: '#f79009',
        colorError: '#d92d20',
        borderRadius: 6,
        controlHeight: 30,
        fontSize: 14 + fontSizeBump(appearance.fontSize),
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
      },
      components: {
        Button: { primaryShadow: 'none' },
        Segmented: { itemSelectedBg: dark ? '#313a4a' : '#ffffff' },
        Table: { headerBg: dark ? '#242b38' : '#fafbfc', headerColor: dark ? '#98a2b3' : '#667085', cellPaddingBlockSM: 6 },
        Modal: { borderRadiusLG: 12 },
      },
    };
  }, [appearance.pageStyle, appearance.fontSize]);

  return (
    <ConfigProvider locale={zhCN} theme={theme}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  );
}

applyDocumentStyles();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
