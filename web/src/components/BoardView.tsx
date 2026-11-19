import { useMemo } from 'react';
import { collectCodes, collectStats, priorityMeta } from '@wbs/shared';
import { useStore } from '../store';
import { buildBoard } from '../lib/filters';
import TaskRow from './TaskRow';
import { NoMatches } from './EmptyStates';

export default function BoardView() {
  const project = useStore((state) => state.project);
  const filters = useStore((state) => state.filters);
  const resetFilters = useStore((state) => state.resetFilters);

  const roots = project?.roots ?? [];
  const codes = useMemo(() => collectCodes(roots), [roots]);
  const groups = useMemo(() => buildBoard(roots, filters), [roots, filters]);

  if (!project) return null;

  if (groups.length === 0) {
    return <NoMatches onReset={resetFilters} />;
  }

  return (
    <div className="board-sheet board-columns">
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
