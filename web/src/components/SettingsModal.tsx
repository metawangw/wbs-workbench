import { useEffect, useState } from 'react';
import {
  App as AntApp,
  Button,
  Divider,
  Input,
  Modal,
  Segmented,
  Slider,
  Switch,
} from 'antd';
import {
  AppstoreOutlined,
  BgColorsOutlined,
  CheckOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { api, type DirListing } from '../api';
import { useStore } from '../store';
import { brandGlyphStyle } from './atoms';
import {
  DEFAULT_BRAND,
  ICON_COLOR_PRESETS,
  fontSizeBump,
  type FontSize,
  type PageStyle,
} from '../lib/settings';

type Section = 'general' | 'appearance' | 'brand';

const SECTIONS: Array<{ key: Section; label: string; icon: React.ReactNode }> = [
  { key: 'general', label: '常规', icon: <AppstoreOutlined /> },
  { key: 'appearance', label: '外观', icon: <BgColorsOutlined /> },
  { key: 'brand', label: '品牌', icon: <SettingOutlined /> },
];

function isAbsoluteDir(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/');
}

function parentOfPath(value: string): string | null {
  const trimmed = value.replace(/[\\/]+$/, '');
  if (/^[a-zA-Z]:$/.test(trimmed)) return null;
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (index <= 0) return null;
  let parent = trimmed.slice(0, index);
  if (/^[a-zA-Z]:$/.test(parent)) parent += '\\';
  return parent;
}

export default function SettingsModal() {
  const settingsOpen = useStore((state) => state.settingsOpen);
  const closeSettings = useStore((state) => state.closeSettings);
  const dataDir = useStore((state) => state.dataDir);
  const builtAt = useStore((state) => state.builtAt);
  const setDataDir = useStore((state) => state.setDataDir);
  const appearance = useStore((state) => state.appearance);
  const setAppearance = useStore((state) => state.setAppearance);
  const brand = useStore((state) => state.brand);
  const setBrand = useStore((state) => state.setBrand);
  const { message } = AntApp.useApp();

  const [section, setSection] = useState<Section>('general');
  const [dirInput, setDirInput] = useState(dataDir || '');
  const [dirSaving, setDirSaving] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const [browseData, setBrowseData] = useState<DirListing | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  useEffect(() => {
    if (settingsOpen) {
      setDirInput(dataDir || '');
      setBrowseOpen(false);
      setBrowseData(null);
      setBrowseError(null);
    }
  }, [settingsOpen, dataDir]);

  const loadDirs = async (candidates: string[]): Promise<void> => {
    setBrowseLoading(true);
    setBrowseError(null);
    for (const candidate of candidates) {
      try {
        const listing = await api.listDirs(candidate);
        setBrowseData(listing);
        setBrowsePath(listing.path);
        setBrowseLoading(false);
        return;
      } catch {
        /* try next */
      }
    }
    setBrowseData(null);
    setBrowseError('无法读取该目录，请检查路径或手动输入绝对路径');
    setBrowseLoading(false);
  };

  const toggleBrowse = () => {
    if (browseOpen) {
      setBrowseOpen(false);
      return;
    }
    setBrowseOpen(true);
    const typed = dirInput.trim();
    if (!typed) {
      void loadDirs(['']);
      return;
    }
    const candidates: string[] = [];
    if (isAbsoluteDir(typed)) {
      candidates.push(typed);
      const parent = parentOfPath(typed);
      if (parent) candidates.push(parent);
    }
    candidates.push('');
    void loadDirs(candidates);
  };

  const submitDir = async () => {
    const value = dirInput.trim();
    if (!value) {
      message.warning('请输入数据目录的绝对路径');
      return;
    }
    if (!isAbsoluteDir(value)) {
      message.warning('请输入绝对路径（如 D:\\WorkBuddy\\data）');
      return;
    }
    setDirSaving(true);
    try {
      await setDataDir(value);
      message.success('数据目录已切换，项目列表已重新扫描');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '切换失败');
    } finally {
      setDirSaving(false);
    }
  };

  return (
    <Modal
      open={settingsOpen}
      onCancel={closeSettings}
      footer={null}
      width={760}
      title={<span className="settings-title">设置</span>}
      className="settings-modal"
      destroyOnClose
    >
      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.map((item) => (
            <button
              type="button"
              key={item.key}
              className={`settings-nav-item${section === item.key ? ' is-active' : ''}`}
              onClick={() => setSection(item.key)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {section === 'general' ? (
            <div className="settings-pane">
              <h3>项目目录</h3>
              <p className="settings-desc">
                工作台直接读取该目录下的 Markdown 文件作为项目数据源。切换后会立即重新扫描。
              </p>
              <div className="dir-input-row">
                <Input
                  value={dirInput}
                  placeholder="输入绝对路径，例如 D:\WorkBuddy\data"
                  onChange={(event) => setDirInput(event.target.value)}
                  onPressEnter={() => void submitDir()}
                />
                <Button icon={<FolderOpenOutlined />} onClick={toggleBrowse}>
                  {browseOpen ? '收起' : '浏览'}
                </Button>
                <Button type="primary" loading={dirSaving} onClick={() => void submitDir()}>
                  应用
                </Button>
              </div>

              {browseOpen ? (
                <div className="dir-browser">
                  <div className="dir-browser-head">
                    <Button size="small" type="text" onClick={() => void loadDirs([''])}>
                      盘符
                    </Button>
                    <Button
                      size="small"
                      type="text"
                      onClick={() => browseData?.parent && void loadDirs([browseData.parent])}
                      disabled={!browseData?.parent}
                    >
                      上一级
                    </Button>
                    <span className="dir-browser-path" title={browsePath || '选择盘符'}>
                      {browsePath || '选择盘符'}
                    </span>
                  </div>
                  {browseLoading ? (
                    <div className="dir-browser-hint">加载中…</div>
                  ) : browseError ? (
                    <div className="dir-browser-hint dir-browser-error">{browseError}</div>
                  ) : (
                    <div className="dir-browser-list">
                      {browseData && browseData.dirs.length > 0 ? (
                        browseData.dirs.map((dir) => (
                          <button
                            type="button"
                            key={dir.path}
                            className="dir-browser-item"
                            title={dir.path}
                            onClick={() => void loadDirs([dir.path])}
                          >
                            <FolderOutlined />
                            <span>{dir.name}</span>
                          </button>
                        ))
                      ) : (
                        <div className="dir-browser-hint">此目录下没有子文件夹</div>
                      )}
                    </div>
                  )}
                  <div className="dir-browser-foot">
                    <Button
                      type="primary"
                      size="small"
                      disabled={!browsePath}
                      onClick={() => {
                        if (browsePath) setDirInput(browsePath);
                        setBrowseOpen(false);
                      }}
                    >
                      选择此目录
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="settings-metagroup">
                <div className="settings-meta">
                  <span>数据源</span>
                  <span>本地 Markdown · 无数据库</span>
                </div>
                <div className="settings-meta">
                  <span>界面构建时间</span>
                  <span>{builtAt ? new Date(builtAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</span>
                </div>
              </div>
            </div>
          ) : null}

          {section === 'appearance' ? (
            <div className="settings-pane">
              <h3>外观</h3>
              <p className="settings-desc">
                外观设置立即生效，并保存到服务端配置文件，可在不同浏览器间共享。
              </p>

              <div className="settings-row">
                <div className="settings-row-label">
                  <strong>页面风格</strong>
                  <span>亮色或暗色，切换整个界面的明暗</span>
                </div>
                <Segmented<PageStyle>
                  value={appearance.pageStyle}
                  onChange={(value) => setAppearance({ pageStyle: value })}
                  options={[
                    { value: 'light', label: '亮色' },
                    { value: 'dark', label: '暗色' },
                  ]}
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <strong>字号</strong>
                  <span>界面文字的整体大小</span>
                </div>
                <Segmented<FontSize>
                  value={appearance.fontSize}
                  onChange={(value) => setAppearance({ fontSize: value })}
                  options={[
                    { value: 'small', label: '小' },
                    { value: 'normal', label: '标准' },
                    { value: 'large', label: '大' },
                  ]}
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <strong>紧凑模式</strong>
                  <span>缩小间距，一屏显示更多内容</span>
                </div>
                <Switch
                  checked={appearance.compact}
                  onChange={(value) => setAppearance({ compact: value })}
                />
              </div>

              <div className="appearance-preview">
                <div className="appearance-preview-bar">预览 · 当前字号偏移 {fontSizeBump(appearance.fontSize)}px</div>
                <div className="appearance-preview-body">
                  <Button type="primary" size="small">
                    主要按钮
                  </Button>
                  <Button size="small">次要按钮</Button>
                  <span className="appearance-preview-tag">P0 / P1 / P2 使用默认配色</span>
                </div>
              </div>
            </div>
          ) : null}

          {section === 'brand' ? (
            <div className="settings-pane">
              <h3>品牌</h3>
              <p className="settings-desc">自定义工作台名称与图标，显示在侧边栏、浏览器标题与标签页图标上。</p>

              <div className="brand-preview">
                <div
                  className="brand-preview-mark"
                  style={{
                    background: brand.iconColor,
                    borderRadius: brand.iconRadius,
                    ...brandGlyphStyle(brand.icon, 16),
                  }}
                >
                  {(brand.icon || 'W').slice(0, 2)}
                </div>
                <div>
                  <div className="brand-preview-title">{brand.title || 'WBS 工作台'}</div>
                  <div className="brand-preview-sub">{brand.subtitle}</div>
                </div>
              </div>

              <div className="settings-field">
                <label>主名称</label>
                <Input
                  value={brand.title}
                  maxLength={40}
                  onChange={(event) => setBrand({ title: event.target.value })}
                  placeholder="WBS 工作台"
                />
              </div>
              <div className="settings-field">
                <label>副名称</label>
                <Input
                  value={brand.subtitle}
                  maxLength={60}
                  onChange={(event) => setBrand({ subtitle: event.target.value })}
                  placeholder="Local-first · Markdown"
                />
              </div>
              <div className="settings-field">
                <label>图标（1–2 个字符或 emoji）</label>
                <Input
                  value={brand.icon}
                  maxLength={2}
                  onChange={(event) => setBrand({ icon: event.target.value })}
                  placeholder="W"
                />
              </div>

              <div className="settings-subhead">图标外观</div>
              <div className="settings-field">
                <label>图标颜色</label>
                <div className="color-presets">
                  {ICON_COLOR_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset.value}
                      title={preset.name}
                      className={`color-swatch${
                        brand.iconColor.toLowerCase() === preset.value.toLowerCase()
                          ? ' is-active'
                          : ''
                      }`}
                      style={{ background: preset.value }}
                      onClick={() => setBrand({ iconColor: preset.value })}
                    >
                      {brand.iconColor.toLowerCase() === preset.value.toLowerCase() ? (
                        <CheckOutlined />
                      ) : null}
                    </button>
                  ))}
                  <label className="color-custom" title="自定义颜色">
                    <input
                      type="color"
                      value={brand.iconColor}
                      onChange={(event) => setBrand({ iconColor: event.target.value })}
                    />
                    +
                  </label>
                </div>
              </div>

              <div className="settings-field">
                <label>图标弧度：{brand.iconRadius}px</label>
                <Slider
                  min={0}
                  max={24}
                  value={brand.iconRadius}
                  onChange={(value) => setBrand({ iconRadius: value })}
                />
              </div>

              <Divider style={{ margin: '8px 0 12px' }} />
              <div className="settings-row settings-row-inline">
                <Button onClick={() => setBrand({ ...DEFAULT_BRAND })}>恢复默认</Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
