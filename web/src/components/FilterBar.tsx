import { Button, Checkbox, Input, Popover } from 'antd';
import {
  ArrowsAltOutlined,
  CloseCircleOutlined,
  FilterOutlined,
  SearchOutlined,
  SettingOutlined,
  ShrinkOutlined,
} from '@ant-design/icons';
import { useStore } from '../store';
import {
  DUE_KEYS,
  DUE_LABELS,
  STATUS_KEYS,
  STATUS_LABELS,
  TASK_TYPE_LABELS,
  allTaskTypesOn,
  collectExpandableIds,
  hasActiveFilters,
  type DueFilter,
  type StatusFilter,
  type TaskTypeFilter,
} from '../lib/filters';
import { LIST_COLUMN_KEYS, LIST_COLUMN_LABELS } from '../lib/columns';

const TASK_TYPE_KEYS: Array<keyof TaskTypeFilter> = [
  'plain',
  'title',
  'version',
  'versionChildren',
];

/**
 * 到期 / 状态靠「空数组 = 全部包含」存值，浮层里则按全选展示。
 * 勾选时先把空数组展开成全选态再增删，若又覆盖所有项就归一成空数组。
 */
function toggleFilterSet<T extends string>(
  current: T[],
  keys: readonly T[],
  key: T,
  checked: boolean,
): T[] {
  const base = current.length ? current : keys;
  const picked = new Set<T>(base);
  if (checked) picked.add(key);
  else picked.delete(key);
  const next = keys.filter((item) => picked.has(item));
  return next.length === keys.length ? [] : next;
}

interface FilterPickerProps {
  /** 按钮上的短标签，如「到期」「状态」「类型」。 */
  label: string;
  /** 浮层标题。 */
  title: string;
  /** 可选项总数，用于「2/4」这种计数。 */
  total: number;
  keys: string[];
  checked: (key: string) => boolean;
  labelOf: (key: string) => string;
  onToggle: (key: string, checked: boolean) => void;
  onReset: () => void;
  /** 已选数量；0 表示「全部」。 */
  count: number;
  /** 当前的取值相对默认态是否被改过（决定按钮高亮）。 */
  active: boolean;
  /** 是否至少保留一项（到期 / 状态 / 联系人不允许把最后一项也取消掉）。 */
  keepOne?: boolean;
  /** 选项多时（联系人）给列表加滚动条。 */
  scroll?: boolean;
  /** 没有任何可选项时把按钮置灰。 */
  disabled?: boolean;
}

/** 与「类型」过滤同款的浮层多选按钮：到期 / 状态 / 类型共用。 */
function FilterPicker({
  label,
  title,
  total,
  keys,
  checked,
  labelOf,
  onToggle,
  onReset,
  count,
  active,
  keepOne,
  scroll,
  disabled,
}: FilterPickerProps) {
  // 空数组 = 全部包含，浮层里就按「全部勾选」显示，和「类型」一致。
  const effective = count > 0 ? count : total;
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      title={title}
      content={
        <div className="col-picker type-picker">
          <div className={`col-picker-list${scroll ? ' is-scroll' : ''}`}>
            {keys.map((key) => (
              <label className="col-picker-row" key={key}>
                <Checkbox
                  checked={checked(key)}
                  disabled={Boolean(keepOne) && checked(key) && effective <= 1}
                  onChange={(event) => onToggle(key, event.target.checked)}
                />
                <span>{labelOf(key)}</span>
              </label>
            ))}
          </div>
          <div className="col-picker-foot">
            <Button type="link" size="small" onClick={onReset}>
              全部包含
            </Button>
          </div>
        </div>
      }
    >
      <Button
        className={`filter-type-btn${active ? ' is-active' : ''}`}
        size="small"
        icon={<FilterOutlined />}
        disabled={disabled}
      >
        {label}
        <span className="filter-type-count">
          {count > 0 ? `${count}/${total}` : '全部'}
        </span>
      </Button>
    </Popover>
  );
}

export default function FilterBar() {
  const project = useStore((state) => state.project);
  const filters = useStore((state) => state.filters);
  const setFilters = useStore((state) => state.setFilters);
  const resetFilters = useStore((state) => state.resetFilters);
  const expandAll = useStore((state) => state.expandAll);
  const collapseAll = useStore((state) => state.collapseAll);
  const collapsed = useStore((state) => state.collapsed);
  const view = useStore((state) => state.view);
  const boardTypes = useStore((state) => state.boardTypes);
  const setBoardType = useStore((state) => state.setBoardType);
  const resetBoardTypes = useStore((state) => state.resetBoardTypes);
  const listColumns = useStore((state) => state.listColumns);
  const setListColumn = useStore((state) => state.setListColumn);
  const resetListColumns = useStore((state) => state.resetListColumns);

  const owners = project?.owners ?? [];
  const typeFilterActive = !allTaskTypesOn(boardTypes);
  const typeCount = TASK_TYPE_KEYS.filter((key) => boardTypes[key]).length;
  // 「任务类型」现在对列表/看板/甘特图都生效，任一视图下都算作已筛选。
  const active = hasActiveFilters(filters) || typeFilterActive;

  const toggleDue = (key: string, checked: boolean) => {
    setFilters({
      due: toggleFilterSet(filters.due, DUE_KEYS, key as DueFilter, checked),
    });
  };

  const toggleStatus = (key: string, checked: boolean) => {
    setFilters({
      status: toggleFilterSet(filters.status, STATUS_KEYS, key as StatusFilter, checked),
    });
  };


  // Only consider nodes that actually have children, so stale ids from a
  // previously opened project cannot make the button flip to "展开".
  const expandableIds = collectExpandableIds(project?.roots ?? []);
  const hasCollapsed = expandableIds.some((id) => collapsed[id]);

  return (
    <div className="filterbar">
      <Input
        id="task-search"
        className="filter-search"
        size="small"
        prefix={<SearchOutlined />}
        suffix={<span className="key-hint">/</span>}
        placeholder="搜索任务全部内容"
        value={filters.q}
        onChange={(event) => setFilters({ q: event.target.value })}
        allowClear
        autoComplete="off"
      />

      <FilterPicker
        label="联系人"
        title="联系人"
        total={owners.length}
        keys={owners}
        checked={(key) => filters.owner.length === 0 || filters.owner.includes(key)}
        labelOf={(key) => key}
        onToggle={(key, checked) =>
          setFilters({ owner: toggleFilterSet(filters.owner, owners, key, checked) })
        }
        onReset={() => setFilters({ owner: [] })}
        count={filters.owner.length}
        active={filters.owner.length > 0}
        keepOne
        scroll
        disabled={owners.length === 0}
      />

      <FilterPicker
        label="到期"
        title="到期时间"
        total={DUE_KEYS.length}
        keys={DUE_KEYS}
        checked={(key) => filters.due.length === 0 || filters.due.includes(key as DueFilter)}
        labelOf={(key) => DUE_LABELS[key as DueFilter]}
        onToggle={toggleDue}
        onReset={() => setFilters({ due: [] })}
        count={filters.due.length}
        active={filters.due.length > 0}
        keepOne
      />

      <FilterPicker
        label="状态"
        title="任务状态"
        total={STATUS_KEYS.length}
        keys={STATUS_KEYS}
        checked={(key) =>
          filters.status.length === 0 || filters.status.includes(key as StatusFilter)
        }
        labelOf={(key) => STATUS_LABELS[key as StatusFilter]}
        onToggle={toggleStatus}
        onReset={() => setFilters({ status: [] })}
        count={filters.status.length}
        // 「已完成」单项选中等于旧版的「仅已完成」，同样算作已筛选。
        active={filters.status.length > 0}
        keepOne
      />

      <FilterPicker
        label="类型"
        title="任务类型"
        total={TASK_TYPE_KEYS.length}
        keys={TASK_TYPE_KEYS}
        checked={(key) => boardTypes[key as keyof TaskTypeFilter]}
        labelOf={(key) => TASK_TYPE_LABELS[key as keyof TaskTypeFilter]}
        onToggle={(key, checked) => setBoardType(key as keyof TaskTypeFilter, checked)}
        onReset={resetBoardTypes}
        // 全部勾选是常态：这时按钮显示「全部」，不做计数。
        count={typeFilterActive ? typeCount : 0}
        active={typeFilterActive}
      />

      {active ? (
        <Button
          type="text"
          size="small"
          className="filter-reset"
          icon={<CloseCircleOutlined />}
          onClick={resetFilters}
        >
          重置
        </Button>
      ) : null}

      <div className="filter-spacer" />

      {view === 'list' ? (
        <Popover
          trigger="click"
          placement="bottomRight"
          title="显示列"
          content={
            <div className="col-picker">
              <label className="col-picker-row is-locked">
                <Checkbox checked disabled />
                <span>任务</span>
                <span className="col-picker-hint">必选</span>
              </label>
              {LIST_COLUMN_KEYS.map((key) => (
                <label className="col-picker-row" key={key}>
                  <Checkbox
                    checked={listColumns[key]}
                    onChange={(event) => setListColumn(key, event.target.checked)}
                  />
                  <span>{LIST_COLUMN_LABELS[key]}</span>
                </label>
              ))}
              <div className="col-picker-foot">
                <Button type="link" size="small" onClick={resetListColumns}>
                  恢复默认
                </Button>
              </div>
            </div>
          }
        >
          <Button
            className="icon-btn"
            type="text"
            size="small"
            icon={<SettingOutlined />}
            aria-label="自定义显示列"
          >
            列
          </Button>
        </Popover>
      ) : null}

      <Button
        className="icon-btn"
        type="text"
        size="small"
        icon={hasCollapsed ? <ArrowsAltOutlined /> : <ShrinkOutlined />}
        onClick={hasCollapsed ? expandAll : collapseAll}
        disabled={expandableIds.length === 0}
      >
        {hasCollapsed ? '展开' : '收起'}
      </Button>
    </div>
  );
}
