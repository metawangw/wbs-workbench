import { App as AntApp, Checkbox } from 'antd';
import { CaretRightOutlined } from '@ant-design/icons';
import {
  findTask,
  isTitleTask,
  isVersionTask,
  isLockedProjectStatus,
  relatedTaskIds,
  showsCreated,
  type TaskNode,
} from '@wbs/shared';
import { useStore } from '../store';
import {
  CreatedChip,
  CycleChip,
  DueChip,
  ImportanceChip,
  LatestProgress,
  OwnerChip,
  PriorityPill,
  VersionChip,
  VersionTypeTag,
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
  const showCheckbox = useStore((state) => state.appearance.showCheckbox !== false);
  const depPeek = useStore((state) => state.depPeek);
  const setDepPeek = useStore((state) => state.setDepPeek);
  const project = useStore((state) => state.project);
  const locked = isLockedProjectStatus(project?.status);
  const jumpToTask = useStore((state) => state.jumpToTask);
  const { message } = AntApp.useApp();

  const isDepTarget = Boolean(depPeek?.deps.includes(node.id));
  const isDepSource = depPeek?.src === node.id;
  const versionOf = node.fields.version
    ? findTask(project?.roots ?? [], node.fields.version)
    : undefined;

  const hasChildren = node.children.length > 0;
  const expanded = !collapsed;
  const isVersion = isVersionTask(node.fields);
  // 已完成任务（含普通任务）同样展示最新进展；仅标题任务不展示。
  const showProgress = !isTitleTask(node.fields) && node.progress.length > 0;

  const handleToggle = () => {
    void toggleDone(node).catch((error: unknown) => {
      message.error(error instanceof Error ? error.message : '更新失败');
    });
  };

  return (
    <div className="task-node">
      <div
        className={`task-row${node.done ? ' is-done' : ''}${
          isTitleTask(node.fields) ? ' is-title-task' : ''
        }${isVersion ? ' is-version-task' : ''}${isDepTarget ? ' is-dep-hl' : ''}${
          isDepSource ? ' is-dep-src' : ''
        }`}
        role="button"
        tabIndex={0}
        aria-label={`${code} ${node.title}`}
        onClick={() => openTask(node.id)}
        onMouseEnter={() => {
          const related = relatedTaskIds(node.fields);
          setDepPeek(related.length ? { src: node.id, deps: related } : null);
        }}
        onMouseLeave={() => {
          if (useStore.getState().depPeek?.src === node.id) setDepPeek(null);
        }}
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

            {showCheckbox ? (
              <span className="task-checkbox" onClick={(event) => event.stopPropagation()}>
                <Checkbox checked={node.done} disabled={locked} onChange={handleToggle} />
              </span>
            ) : null}

            <span className="wbs-code">{code}</span>

            {isVersionTask(node.fields) ? <VersionTypeTag /> : null}

            {showsCreated(node.fields) ? (
              <CreatedChip created={node.fields.created} />
            ) : null}

            {/* 优先级 / 重要性贴在序号之后，避免再占一整行，卡片能放下更多任务。 */}
            {node.fields.priority || node.fields.importance ? (
              <span className="task-badges">
                <PriorityPill priority={node.fields.priority} />
                <ImportanceChip importance={node.fields.importance} />
              </span>
            ) : null}

            <span className="task-title" title={node.title}>
              {node.title}
            </span>

            {versionOf ? (
              <VersionChip
                title={versionOf.title}
                onClick={() => jumpToTask(versionOf.id)}
              />
            ) : node.fields.version ? (
              <span className="version-chip is-missing" title="关联的版本任务已不存在">
                版本失效
              </span>
            ) : null}
          </div>

          {node.fields.cycle || node.fields.due || node.fields.owner ? (
            <div className="task-meta">
              <CycleChip cycle={node.fields.cycle} />
              <DueChip due={node.fields.due} done={node.done} />
              <OwnerChip name={node.fields.owner} />
            </div>
          ) : null}

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
