import { useEffect, useState } from 'react';
import {
  App as AntApp,
  Button,
  Input,
  Modal,
  Popover,
  Select,
  Slider,
  Switch,
  Tooltip,
} from 'antd';
import {
  AppstoreOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  BgColorsOutlined,
  CheckOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { useStore } from '../store';
import DirPicker from './DirPicker';
import { brandGlyphStyle } from './atoms';
import StatusIcon from './StatusIcon';
import {
  DEFAULT_BRAND,
  DEFAULT_CREATED_COLOR,
  DEFAULT_IMP_HIGH_COLOR,
  DEFAULT_IMP_LOW_COLOR,
  DEFAULT_IMP_MID_COLOR,
  DEFAULT_P0_COLOR,
  DEFAULT_P1_COLOR,
  DEFAULT_P2_COLOR,
  DEFAULT_PROJECT_STATUSES,
  DEFAULT_TITLE_COLOR,
  DEFAULT_VERSION_COLOR,
  ICON_COLOR_PRESETS,
  MAX_PROJECT_STATUSES,
  MAX_PROJECT_STATUS_NAME,
  PROJECT_STATUS_ICONS,
  STATUS_COLOR_POOL,
  type FontSize,
  type ListProgressAlign,
  type ListProgressDetail,
  type PageStyle,
  type ProjectStatusDef,
} from '../lib/settings';

type Section = 'general' | 'appearance' | 'statuses' | 'brand';

const SECTIONS: Array<{
  key: Section;
  label: string;
  keywords: string;
  icon: React.ReactNode;
}> = [
  {
    key: 'general',
    label: '常规',
    keywords: '目录 数据源 路径 构建',
    icon: <AppstoreOutlined />,
  },
  {
    key: 'appearance',
    label: '外观',
    keywords: '主题 颜色 字号 紧凑 优先级 标记 暗色 最新进展 靠左 靠右',
    icon: <BgColorsOutlined />,
  },
  {
    key: 'statuses',
    label: '状态',
    keywords: '项目状态 自定义 名称 颜色 数量 排序',
    icon: <TagsOutlined />,
  },
  {
    key: 'brand',
    label: '品牌',
    keywords: '名称 副名称 图标 圆角 颜色',
    icon: <SettingOutlined />,
  },
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

function SectionCard({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`ob-card ${className}`.trim()}>
      <h4 className="ob-card-title">{title}</h4>
      <div className="ob-card-body">{children}</div>
    </section>
  );
}

function SettingRow({
  title,
  desc,
  children,
  className = '',
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`ob-row ${className}`.trim()}>
      <div className="ob-row-info">
        <strong>{title}</strong>
        {desc ? <span>{desc}</span> : null}
      </div>
      <div className="ob-row-control">{children}</div>
    </div>
  );
}

/** Obsidian-like colour setting: a round swatch, preset palette and a reset. */
function ColorControl({
  value,
  label,
  onChange,
  onReset,
}: {
  value: string;
  label: string;
  onChange: (color: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="ob-color-control">
      <Popover
        trigger="click"
        placement="bottomRight"
        title={label}
        content={
          <div className="ob-color-popover">
            <div className="color-presets">
              {ICON_COLOR_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.value}
                  title={preset.name}
                  className={`color-swatch${
                    value.toLowerCase() === preset.value.toLowerCase() ? ' is-active' : ''
                  }`}
                  style={{ background: preset.value }}
                  onClick={() => onChange(preset.value)}
                >
                  {value.toLowerCase() === preset.value.toLowerCase() ? <CheckOutlined /> : null}
                </button>
              ))}
            </div>
            <label className="ob-color-custom">
              自定义
              <input
                type="color"
                value={value}
                onChange={(event) => onChange(event.target.value)}
              />
            </label>
          </div>
        }
      >
        <button
          type="button"
          className="ob-color-button"
          style={{ background: value }}
          aria-label={label}
        />
      </Popover>
      <Tooltip title="恢复默认">
        <button
          type="button"
          className="ob-color-reset"
          onClick={onReset}
          aria-label={`恢复默认${label}`}
        >
          <ReloadOutlined />
        </button>
      </Tooltip>
    </div>
  );
}

/** Swatch palette for project statuses: tone pool first, then brand presets. */
const STATUS_SWATCHES = Array.from(
  new Set([...STATUS_COLOR_POOL, ...ICON_COLOR_PRESETS.map((preset) => preset.value)]),
);

function StatusColorPicker({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (color: string) => void;
}) {
  const active = (color: string) => value.toLowerCase() === color.toLowerCase();
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      title={label}
      content={
        <div className="ob-color-popover">
          <div className="color-presets">
            {STATUS_SWATCHES.map((color) => (
              <button
                type="button"
                key={color}
                title={color}
                className={`color-swatch${active(color) ? ' is-active' : ''}`}
                style={{ background: color }}
                onClick={() => onChange(color)}
              >
                {active(color) ? <CheckOutlined /> : null}
              </button>
            ))}
          </div>
          <label className="ob-color-custom">
            自定义
            <input
              type="color"
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
          </label>
        </div>
      }
    >
      <button
        type="button"
        className="status-def-swatch"
        style={{ background: value }}
        aria-label={label}
      />
    </Popover>
  );
}

/** 状态图标选择器：图形用状态自定义色绘制，改色后预览即时跟随。 */
function StatusIconPicker({
  value,
  color,
  name,
  onChange,
}: {
  value: string;
  color: string;
  name: string;
  onChange: (icon: string) => void;
}) {
  const label = PROJECT_STATUS_ICONS.find((item) => item.key === value)?.label ?? '空心环';
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      title="选择状态图标"
      content={
        <div className="status-icon-grid">
          {PROJECT_STATUS_ICONS.map((item) => (
            <button
              type="button"
              key={item.key}
              title={item.label}
              className={`status-icon-option${item.key === value ? ' is-active' : ''}`}
              onClick={() => onChange(item.key)}
            >
              <StatusIcon icon={item.key} color={color} size={21} />
            </button>
          ))}
        </div>
      }
    >
      <button
        type="button"
        className="status-def-icon-btn"
        title={`${name}的图标：${label}`}
        aria-label={`${name}的图标`}
      >
        <StatusIcon icon={value} color={color} size={15} />
      </button>
    </Popover>
  );
}

/** One editable row: colour, name (commit on blur/enter), chip preview, order. */
function StatusDefRow({
  def,
  index,
  total,
  onRename,
  onRecolor,
  onIcon,
  onDelete,
  onMove,
}: {
  def: ProjectStatusDef;
  index: number;
  total: number;
  onRename: (from: string, to: string) => boolean;
  onRecolor: (name: string, color: string) => void;
  onIcon: (name: string, icon: string) => void;
  onDelete: (name: string) => void;
  onMove: (index: number, delta: number) => void;
}) {
  const [draft, setDraft] = useState(def.name);

  useEffect(() => {
    setDraft(def.name);
  }, [def.name]);

  const commit = () => {
    const name = draft.replace(/\s+/g, ' ').trim().slice(0, MAX_PROJECT_STATUS_NAME);
    if (!name || name === def.name) {
      setDraft(def.name);
      return;
    }
    if (!onRename(def.name, name)) setDraft(def.name);
    else setDraft(name);
  };

  return (
    <div className="status-def-row">
      <StatusColorPicker
        value={def.color}
        label={`${def.name}的颜色`}
        onChange={(color) => onRecolor(def.name, color)}
      />
      <StatusIconPicker
        value={def.icon ?? 'ring'}
        color={def.color}
        name={def.name}
        onChange={(icon) => onIcon(def.name, icon)}
      />
      <Input
        className="status-def-name"
        value={draft}
        maxLength={MAX_PROJECT_STATUS_NAME}
        placeholder="状态名称"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onPressEnter={commit}
      />
      <span className="status-def-chip" style={{ '--sc': def.color } as React.CSSProperties}>
        {def.name}
      </span>
      <div className="status-def-actions">
        <Tooltip title="上移">
          <Button
            type="text"
            size="small"
            aria-label="上移"
            icon={<ArrowUpOutlined />}
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
          />
        </Tooltip>
        <Tooltip title="下移">
          <Button
            type="text"
            size="small"
            aria-label="下移"
            icon={<ArrowDownOutlined />}
            disabled={index === total - 1}
            onClick={() => onMove(index, 1)}
          />
        </Tooltip>
        <Tooltip title={total <= 1 ? '至少保留一个状态' : '删除'}>
          <Button
            type="text"
            size="small"
            danger
            aria-label="删除状态"
            icon={<DeleteOutlined />}
            disabled={total <= 1}
            onClick={() => onDelete(def.name)}
          />
        </Tooltip>
      </div>
    </div>
  );
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
  const statuses = useStore((state) => state.statuses);
  const setStatuses = useStore((state) => state.setStatuses);
  const { message } = AntApp.useApp();

  const [section, setSection] = useState<Section>('general');
  const [dirInput, setDirInput] = useState(dataDir || '');
  const [dirSaving, setDirSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (settingsOpen) setDirInput(dataDir || '');
  }, [settingsOpen, dataDir]);

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

  const resetMarkerColors = () =>
    setAppearance({
      titleColor: DEFAULT_TITLE_COLOR,
      createdColor: DEFAULT_CREATED_COLOR,
      versionColor: DEFAULT_VERSION_COLOR,
      p0Color: DEFAULT_P0_COLOR,
      p1Color: DEFAULT_P1_COLOR,
      p2Color: DEFAULT_P2_COLOR,
      impHighColor: DEFAULT_IMP_HIGH_COLOR,
      impMidColor: DEFAULT_IMP_MID_COLOR,
      impLowColor: DEFAULT_IMP_LOW_COLOR,
    });

  const addStatus = () => {
    if (statuses.length >= MAX_PROJECT_STATUSES) {
      message.warning(`最多 ${MAX_PROJECT_STATUSES} 个状态`);
      return;
    }
    let index = 1;
    let name = '新状态';
    while (statuses.some((status) => status.name === name)) {
      index += 1;
      name = `新状态 ${index}`;
    }
    const color = STATUS_COLOR_POOL[statuses.length % STATUS_COLOR_POOL.length];
    setStatuses([...statuses, { name, color, icon: 'dot' }]);
  };

  const renameStatus = (from: string, to: string): boolean => {
    if (statuses.some((status) => status.name !== from && status.name === to)) {
      message.warning(`状态「${to}」已存在`);
      return false;
    }
    setStatuses(
      statuses.map((status) => (status.name === from ? { ...status, name: to } : status)),
    );
    return true;
  };

  const recolorStatus = (name: string, color: string) =>
    setStatuses(
      statuses.map((status) => (status.name === name ? { ...status, color } : status)),
    );

  const setStatusIcon = (name: string, icon: string) =>
    setStatuses(
      statuses.map((status) =>
        status.name === name
          ? { ...status, icon: icon as ProjectStatusDef['icon'] }
          : status,
      ),
    );

  const deleteStatus = (name: string) => {
    if (statuses.length <= 1) return;
    setStatuses(statuses.filter((status) => status.name !== name));
  };

  const moveStatus = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= statuses.length) return;
    const next = statuses.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setStatuses(next);
  };

  return (
    <Modal
      open={settingsOpen}
      onCancel={closeSettings}
      footer={null}
      width={720}
      wrapClassName="ob-settings-wrap"
      title={<span className="settings-title">设置</span>}
      className="settings-modal ob-settings"
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
            <div className="settings-pane ob-pane">
              <SectionCard title="项目目录">
                <div className="ob-row ob-dir-row">
                  <div className="ob-row-info">
                    <strong>数据目录</strong>
                  </div>
                  <div className="ob-row-control">
                    <Input
                      className="ob-dir-input"
                      value={dirInput}
                      placeholder="例如 D://MyPM"
                      onChange={(event) => setDirInput(event.target.value)}
                      onPressEnter={() => void submitDir()}
                    />
                    <Button
                      icon={<FolderOpenOutlined />}
                      onClick={() => setPickerOpen(true)}
                    >
                      选择
                    </Button>
                    <Button type="primary" loading={dirSaving} onClick={() => void submitDir()}>
                      应用
                    </Button>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="关于">
                <SettingRow title="数据源">
                  <span className="ob-value">本地 Markdown · 无数据库</span>
                </SettingRow>
                <SettingRow title="界面构建时间">
                  <span className="ob-value">
                    {builtAt
                      ? new Date(builtAt).toLocaleString('zh-CN', { hour12: false })
                      : '—'}
                  </span>
                </SettingRow>
              </SectionCard>
            </div>
          ) : null}

          {section === 'appearance' ? (
            <div className="settings-pane ob-pane">
              <SectionCard title="主题">
                <SettingRow title="页面风格" desc="亮色或暗色，切换整个界面的明暗">
                  <Select<PageStyle>
                    value={appearance.pageStyle}
                    onChange={(value) => setAppearance({ pageStyle: value })}
                    options={[
                      { value: 'light', label: '亮色' },
                      { value: 'dark', label: '暗色' },
                    ]}
                    style={{ width: 130 }}
                  />
                </SettingRow>
                <SettingRow title="字号" desc="界面文字的整体大小">
                  <Select<FontSize>
                    value={appearance.fontSize}
                    onChange={(value) => setAppearance({ fontSize: value })}
                    options={[
                      { value: 'small', label: '小' },
                      { value: 'normal', label: '标准' },
                      { value: 'large', label: '大' },
                    ]}
                    style={{ width: 130 }}
                  />
                </SettingRow>
                <SettingRow title="紧凑模式" desc="缩小间距，一屏显示更多内容">
                  <Switch
                    checked={appearance.compact}
                    onChange={(value) => setAppearance({ compact: value })}
                  />
                </SettingRow>
                <SettingRow
                  title="显示快捷设置栏"
                  desc="关闭后看板、列表、甘特图顶部不再显示搜索与筛选工具条"
                >
                  <Switch
                    checked={appearance.showQuickBar !== false}
                    onChange={(showQuickBar) => setAppearance({ showQuickBar })}
                  />
                </SettingRow>
                <SettingRow
                  title="显示完成复选框"
                  desc="关闭后任务前的勾选框全部隐藏，完成状态仍可在任务详情里修改"
                >
                  <Switch
                    checked={appearance.showCheckbox !== false}
                    onChange={(showCheckbox) => setAppearance({ showCheckbox })}
                  />
                </SettingRow>
              </SectionCard>

              <SectionCard title="列表 · 最新进展">
                <SettingRow
                  title="展示内容"
                  desc="列表行里「最新进展」展示到什么程度；正文永远让位于任务描述"
                >
                  <Select<ListProgressDetail>
                    value={appearance.listProgressDetail ?? 'full'}
                    onChange={(listProgressDetail) => setAppearance({ listProgressDetail })}
                    options={[
                      { value: 'label', label: '仅“最新进展”' },
                      { value: 'date', label: '标签 + 日期' },
                      { value: 'full', label: '完整内容' },
                    ]}
                    style={{ width: 148 }}
                  />
                </SettingRow>
                <SettingRow
                  title="展示位置"
                  desc="贴在任务单元格右侧，或紧跟任务描述之后"
                >
                  <Select<ListProgressAlign>
                    value={appearance.listProgressAlign ?? 'right'}
                    onChange={(listProgressAlign) => setAppearance({ listProgressAlign })}
                    options={[
                      { value: 'right', label: '靠右' },
                      { value: 'left', label: '紧跟任务描述' },
                    ]}
                    style={{ width: 148 }}
                  />
                </SettingRow>
              </SectionCard>

              <SectionCard title="任务标记颜色" className="ob-card-markers">
                <SettingRow title="标题类型" desc="分组行（标题类型任务）的文字与底色">
                  <ColorControl
                    label="标题类型颜色"
                    value={appearance.titleColor}
                    onChange={(titleColor) => setAppearance({ titleColor })}
                    onReset={() => setAppearance({ titleColor: DEFAULT_TITLE_COLOR })}
                  />
                </SettingRow>
                <SettingRow title="创建日期" desc="任务编号后日期徽标的文字与底色">
                  <ColorControl
                    label="创建日期颜色"
                    value={appearance.createdColor}
                    onChange={(createdColor) => setAppearance({ createdColor })}
                    onReset={() => setAppearance({ createdColor: DEFAULT_CREATED_COLOR })}
                  />
                </SettingRow>
                <SettingRow title="版本类型" desc="版本任务行与「版本」标识的文字与底色">
                  <ColorControl
                    label="版本类型颜色"
                    value={appearance.versionColor || DEFAULT_VERSION_COLOR}
                    onChange={(versionColor) => setAppearance({ versionColor })}
                    onReset={() => setAppearance({ versionColor: DEFAULT_VERSION_COLOR })}
                  />
                </SettingRow>
                <SettingRow title="优先级 P0" desc="P0（紧急）标记的文字与底色">
                  <ColorControl
                    label="优先级 P0 颜色"
                    value={appearance.p0Color}
                    onChange={(p0Color) => setAppearance({ p0Color })}
                    onReset={() => setAppearance({ p0Color: DEFAULT_P0_COLOR })}
                  />
                </SettingRow>
                <SettingRow title="优先级 P1" desc="P1（重要）标记的文字与底色">
                  <ColorControl
                    label="优先级 P1 颜色"
                    value={appearance.p1Color}
                    onChange={(p1Color) => setAppearance({ p1Color })}
                    onReset={() => setAppearance({ p1Color: DEFAULT_P1_COLOR })}
                  />
                </SettingRow>
                <SettingRow title="优先级 P2" desc="P2（常规）标记的文字与底色">
                  <ColorControl
                    label="优先级 P2 颜色"
                    value={appearance.p2Color}
                    onChange={(p2Color) => setAppearance({ p2Color })}
                    onReset={() => setAppearance({ p2Color: DEFAULT_P2_COLOR })}
                  />
                </SettingRow>
                <SettingRow title="重要性 高" desc="「高」标记的文字与底色">
                  <ColorControl
                    label="重要性「高」颜色"
                    value={appearance.impHighColor}
                    onChange={(impHighColor) => setAppearance({ impHighColor })}
                    onReset={() => setAppearance({ impHighColor: DEFAULT_IMP_HIGH_COLOR })}
                  />
                </SettingRow>
                <SettingRow title="重要性 中" desc="「中」标记的文字与底色">
                  <ColorControl
                    label="重要性「中」颜色"
                    value={appearance.impMidColor}
                    onChange={(impMidColor) => setAppearance({ impMidColor })}
                    onReset={() => setAppearance({ impMidColor: DEFAULT_IMP_MID_COLOR })}
                  />
                </SettingRow>
                <SettingRow title="重要性 低" desc="「低」标记的文字与底色">
                  <ColorControl
                    label="重要性「低」颜色"
                    value={appearance.impLowColor}
                    onChange={(impLowColor) => setAppearance({ impLowColor })}
                    onReset={() => setAppearance({ impLowColor: DEFAULT_IMP_LOW_COLOR })}
                  />
                </SettingRow>
                <div className="ob-card-foot marker-foot">
                  <span className="marker-foot-hint">
                    颜色同时用于看板、列表、甘特图与导出文档
                  </span>
                  <Button onClick={resetMarkerColors}>恢复默认颜色</Button>
                </div>
              </SectionCard>
            </div>
          ) : null}

          {section === 'statuses' ? (
            <div className="settings-pane ob-pane">
              <SectionCard title="项目状态">
                <div className="ob-row">
                  <div className="ob-row-info">
                    <strong>状态清单</strong>
                  </div>
                  <div className="ob-row-control">
                    <span className="ob-value">
                      {statuses.length} / {MAX_PROJECT_STATUSES} 个
                    </span>
                  </div>
                </div>

                {statuses.length > 0 ? (
                  <div className="status-def-list">
                    {statuses.map((def, index) => (
                      <StatusDefRow
                        key={def.name}
                        def={def}
                        index={index}
                        total={statuses.length}
                        onRename={renameStatus}
                        onRecolor={recolorStatus}
                        onIcon={setStatusIcon}
                        onDelete={deleteStatus}
                        onMove={moveStatus}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="status-def-empty">
                    还没有状态定义，项目将不显示状态标签。点击下方「添加状态」开始。
                  </div>
                )}

                <div className="ob-card-foot status-def-foot">
                  <Button
                    icon={<PlusOutlined />}
                    onClick={addStatus}
                    disabled={statuses.length >= MAX_PROJECT_STATUSES}
                  >
                    添加状态
                  </Button>
                  <Button
                    onClick={() =>
                      setStatuses(DEFAULT_PROJECT_STATUSES.map((status) => ({ ...status })))
                    }
                  >
                    恢复默认
                  </Button>
                </div>
              </SectionCard>

              <SectionCard title="说明">
                <div className="ob-row">
                  <div className="ob-row-info">
                    <strong>已有项目状态</strong>
                    <span>
                      改动状态清单不会改写项目文件；项目里保存的状态名若不在清单中，仍会按原名称显示。
                    </span>
                  </div>
                </div>
              </SectionCard>
            </div>
          ) : null}

          {section === 'brand' ? (
            <div className="settings-pane ob-pane">
              <SectionCard title="预览">
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
              </SectionCard>

              <SectionCard title="基本信息">
                <SettingRow
                  title="显示品牌区"
                  desc="关闭后侧边栏顶部不再显示图标与名称"
                >
                  <Switch
                    checked={brand.show !== false}
                    onChange={(show) => setBrand({ show })}
                  />
                </SettingRow>
                <SettingRow title="主名称" desc="显示在侧边栏与浏览器标题">
                  <Input
                    value={brand.title}
                    maxLength={40}
                    onChange={(event) => setBrand({ title: event.target.value })}
                    placeholder="WBS 工作台"
                  />
                </SettingRow>
                <SettingRow title="副名称" desc="显示在品牌名称下方">
                  <Input
                    value={brand.subtitle}
                    maxLength={60}
                    onChange={(event) => setBrand({ subtitle: event.target.value })}
                    placeholder="Local-first · Markdown"
                  />
                </SettingRow>
                <SettingRow title="图标" desc="1–2 个字符或 emoji">
                  <Input
                    value={brand.icon}
                    maxLength={2}
                    onChange={(event) => setBrand({ icon: event.target.value })}
                    placeholder="W"
                  />
                </SettingRow>
              </SectionCard>

              <SectionCard title="图标外观">
                <SettingRow title="图标颜色" desc="品牌标记的底色">
                  <ColorControl
                    label="图标颜色"
                    value={brand.iconColor}
                    onChange={(iconColor) => setBrand({ iconColor })}
                    onReset={() => setBrand({ iconColor: DEFAULT_BRAND.iconColor })}
                  />
                </SettingRow>
                <SettingRow title="图标弧度" desc={`当前 ${brand.iconRadius}px`}>
                  <Slider
                    className="ob-radius-slider"
                    min={0}
                    max={24}
                    value={brand.iconRadius}
                    onChange={(value) => setBrand({ iconRadius: value })}
                  />
                </SettingRow>
                <div className="ob-card-foot">
                  <Button onClick={() => setBrand({ ...DEFAULT_BRAND })}>恢复默认</Button>
                </div>
              </SectionCard>
            </div>
          ) : null}
        </div>
      </div>

      <DirPicker
        open={pickerOpen}
        initialPath={dirInput}
        onCancel={() => setPickerOpen(false)}
        onPick={(picked) => {
          setPickerOpen(false);
          setDirInput(picked);
          message.success(`已选择：${picked}（点击应用后生效）`);
        }}
      />
    </Modal>
  );
}
