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
import { BRAND_ACCENT, buildFavicon, fontSizeBump } from './lib/settings';
import './styles.css';
import './gantt.css';
import './viz.css';
import './dark.css';

dayjs.locale('zh-cn');

function applyDocumentStyles(): void {
  const { appearance, brand } = useStore.getState();
  const root = document.documentElement;
  root.setAttribute('data-theme', appearance.pageStyle);
  root.style.setProperty('--fs-bump', `${fontSizeBump(appearance.fontSize)}px`);
  // Brand mark colours are exposed as variables so the sidebar and favicon stay
  // in sync. P0/P1/P2 colours remain the fixed defaults in styles.css.
  root.style.setProperty('--brand-color', brand.iconColor || BRAND_ACCENT);
  root.style.setProperty('--brand-radius', `${brand.iconRadius ?? 7}px`);
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
