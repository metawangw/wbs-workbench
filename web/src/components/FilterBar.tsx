import { Button, Input, Select } from 'antd';
import {
  ArrowsAltOutlined,
  CloseCircleOutlined,
  SearchOutlined,
  ShrinkOutlined,
} from '@ant-design/icons';
import { useStore } from '../store';
import { collectExpandableIds, hasActiveFilters } from '../lib/filters';

export default function FilterBar() {
  const project = useStore((state) => state.project);
  const filters = useStore((state) => state.filters);
  const setFilters = useStore((state) => state.setFilters);
  const resetFilters = useStore((state) => state.resetFilters);
  const expandAll = useStore((state) => state.expandAll);
  const collapseAll = useStore((state) => state.collapseAll);
  const collapsed = useStore((state) => state.collapsed);

  const owners = project?.owners ?? [];
  const active = hasActiveFilters(filters);

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

      <Select
        className="filter-select"
        size="small"
        placeholder="负责人"
        allowClear
        showSearch
        value={filters.owner}
        onChange={(value) => setFilters({ owner: value || undefined })}
        options={owners.map((owner) => ({ value: owner, label: owner }))}
        optionFilterProp="label"
      />

      <Select
        className="filter-select"
        size="small"
        value={filters.due}
        onChange={(value) => setFilters({ due: value })}
        options={[
          { value: 'all', label: '全部到期' },
          { value: 'overdue', label: '已超时' },
          { value: 'today', label: '今天到期' },
          { value: 'soon', label: '3 天内' },
          { value: 'none', label: '无截止' },
        ]}
      />

      <Select
        className="filter-select"
        size="small"
        value={filters.status}
        onChange={(value) => setFilters({ status: value })}
        options={[
          { value: 'all', label: '全部状态' },
          { value: 'open', label: '未完成' },
          { value: 'done', label: '已完成' },
        ]}
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
