import { App as AntApp, Button, Checkbox, Tooltip } from 'antd';
import { CaretRightOutlined, PlusOutlined } from '@ant-design/icons';
import type { TaskNode } from '@wbs/shared';
import { useStore } from '../store';
import {
  CycleChip,
  DueChip,
  ImportanceChip,
  LatestProgress,
  OwnerChip,
  PriorityPill,
} from './atoms';

interface TaskRowProps {
  node: TaskNode;
  code: string;
  codes: Map<string, string>;
}

export default function TaskRow({ node, code, codes }: TaskRowProps) {
  const collapsed = useStore((state) => Boolean(state.collapsed[node.id]));
  const toggleCollapsed = useStore((state) => state.toggleCollapsed);
  const toggleDone = useStore((state) => state.toggleDone);
  const openTask = useStore((state) => state.openTask);
  const openCreate = useStore((state) => state.openCreate);
  const { message } = AntApp.useApp();

  const hasChildren = node.children.length > 0;
  const expanded = !collapsed;
  const showProgress = !node.done && node.progress.length > 0;

  const handleToggle = () => {
    void toggleDone(node).catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : '更新失败');
    });
  };

  return (
    <div className="task-node">
      <div
        className={`task-row${node.done ? ' is-done' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={`${code} ${node.title}`}
        onClick={() => openTask(node.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openTask(node.id);
          }
        }}
      >
        <div className="task-main">
          <div className="task-title-row">
            {hasChildren ? (
              <button
                type="button"
                className="chevron-btn"
                aria-label={expanded ? '收起子任务' : '展开子任务'}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleCollapsed(node.id);
                }}
              >
                <CaretRightOutlined className={expanded ? 'chevron-open' : ''} />
              </button>
            ) : (
              <span className="chevron-spacer" />
            )}

            <span className="task-checkbox" onClick={(event) => event.stopPropagation()}>
              <Checkbox checked={node.done} onChange={handleToggle} />
            </span>

            <span className="wbs-code">{code}</span>

            <span className="task-title" title={node.title}>
              {node.title}
            </span>

            <div className="row-actions">
              <Tooltip title="添加子任务">
                <Button
                  type="text"
                  size="small"
                  className="row-action-btn"
                  aria-label="添加子任务"
                  icon={<PlusOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    openCreate(node.id);
                  }}
                />
              </Tooltip>
            </div>
          </div>

          <div className="task-meta">
            <PriorityPill priority={node.fields.priority} />
            <CycleChip cycle={node.fields.cycle} />
            <DueChip due={node.fields.due} done={node.done} />
            <ImportanceChip importance={node.fields.importance} />
            <OwnerChip name={node.fields.owner} />
          </div>

          {showProgress ? <LatestProgress progress={node.progress} /> : null}
        </div>
      </div>

      {hasChildren && expanded ? (
        <div className="task-children">
          {node.children.map((child) => (
            <TaskRow
              key={child.id}
              node={child}
              code={codes.get(child.id) ?? ''}
              codes={codes}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
