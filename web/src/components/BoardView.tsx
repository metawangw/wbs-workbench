import { useEffect, useMemo } from 'react';
import { Button } from 'antd';
import { ProfileOutlined } from '@ant-design/icons';
import { collectCodes, collectStats, priorityMeta } from '@wbs/shared';
import { useStore } from '../store';
import { buildBoard, allTaskTypesOn, hasActiveFilters } from '../lib/filters';
import TaskRow from './TaskRow';
import { NoMatches } from './EmptyStates';

export default function BoardView() {
  const project = useStore((state) => state.project);
  const filters = useStore((state) => state.filters);
  const resetFilters = useStore((state) => state.resetFilters);
  const boardTypes = useStore((state) => state.boardTypes);
  const resetBoardTypes = useStore((state) => state.resetBoardTypes);
  const depPeek = useStore((state) => state.depPeek);
  const setDepPeek = useStore((state) => state.setDepPeek);

  // 切换视图时清掉「前置高亮」的压暗状态，别带到别的视图里。
  useEffect(() => () => setDepPeek(null), [setDepPeek]);

  const roots = project?.roots ?? [];
  const codes = useMemo(() => collectCodes(roots), [roots]);
  const groups = useMemo(
    () => buildBoard(roots, filters, { types: boardTypes }),
    [roots, filters, boardTypes],
  );

  if (!project) return null;

  if (groups.length === 0) {
    const typesFiltered = !allTaskTypesOn(boardTypes);
    // 关掉某几类任务后看板可能整块空掉 —— 给一个一键恢复的出口。
    if (typesFiltered && !hasActiveFilters(filters)) {
      return (
        <div className="empty-block">
          <div className="empty-icon">
            <ProfileOutlined />
          </div>
          <h3>当前类型下没有可分类的任务</h3>
          <p>看板的「类型」过滤关掉了部分任务类型，把它们打开就能看到任务。</p>
          <Button size="small" onClick={resetBoardTypes}>
            包含全部类型
          </Button>
        </div>
      );
    }
    return <NoMatches onReset={resetFilters} />;
  }

  return (
    <div className="board-sheet board-columns" data-dep-peek={depPeek ? '1' : undefined}>
      {groups.map((group) => {
        const meta = priorityMeta(group.priority);
        const stats = collectStats(group.tasks);

        return (
          <section className="board-group" key={group.priority}>
            <header className="group-head">
              <span className={`group-dot ${meta.tone}`} />
              <h2 className={`group-title tone-${meta.tone}`}>{meta.label}</h2>
              <span className="group-hint">
                共 {stats.total} 项 · 未完成 {stats.open}
              </span>
            </header>

            <div className="task-list">
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  node={task}
                  code={codes.get(task.id) ?? ''}
                  codes={codes}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
