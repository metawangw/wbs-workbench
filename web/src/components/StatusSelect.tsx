import { Select } from 'antd';
import { useStore } from '../store';
import { ProjectStatusIcon } from './StatusIcon';

interface Props {
  /** Injected by AntD Form.Item. */
  value?: string;
  onChange?: (value?: string) => void;
  placeholder?: string;
}

/** Project status picker driven by the configurable status list in 设置. */
export default function StatusSelect({
  value,
  onChange,
  placeholder = '选择项目状态',
}: Props) {
  const statuses = useStore((state) => state.statuses);

  const options = statuses.map((status) => ({
    value: status.name,
    label: (
      <span className="status-option">
        <ProjectStatusIcon status={status.name} size={12} />
        {status.name}
      </span>
    ),
  }));

  // Projects saved before statuses became configurable may carry a name that is
  // no longer (or never was) in the list. Keep it selectable instead of
  // silently clearing the field.
  if (value && !statuses.some((status) => status.name === value)) {
    options.unshift({
      value,
      label: (
        <span className="status-option">
          <ProjectStatusIcon status={value} size={12} />
          {value}
          <span className="status-option-tag">未在设置中</span>
        </span>
      ),
    });
  }

  return (
    <Select
      value={value || undefined}
      onChange={(next?: string) => onChange?.(next)}
      options={options}
      placeholder={placeholder}
      allowClear
      showSearch
      optionFilterProp="value"
    />
  );
}
