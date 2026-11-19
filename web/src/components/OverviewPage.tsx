import { useMemo } from 'react';
import { Button } from 'antd';
import {
  FolderAddOutlined,
  FolderOpenOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import type { ProjectSummary } from '@wbs/shared';
import { useStore } from '../store';
import { ProjectStatusChip } from './atoms';

function sortProjects(projects: ProjectSummary[]): ProjectSummary[] {
  return [...projects].sort((a, b) => {
    if (b.stats.open !== a.stats.open) return b.stats.open - a.stats.open;
    if (b.stats.overdue !== a.stats.overdue) {
      return b.stats.overdue - a.stats.overdue;
    }
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
}

function EmptyOverview() {
  const openNewProject = useStore((state) => state.openNewProject);
  const openNewFolder = useStore((state) => state.openNewFolder);

  return (
    <div className="overview-empty">
      <div className="overview-empty-icon">
        <FolderOpenOutlined />
      </div>
      <h2>还没有项目</h2>
      <p>创建一份 Markdown 项目文件，或先建好文件夹开始整理。</p>
      <div className="overview-empty-actions">
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openNewProject()}>
          新建项目
        </Button>
        <Button icon={<FolderAddOutlined />} onClick={openNewFolder}>
          新建文件夹
        </Button>
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const projects = useStore((state) => state.projects);
  const selectProject = useStore((state) => state.selectProject);
  const openProjectDetail = useStore((state) => state.openProjectDetail);

  const sorted = useMemo(() => sortProjects(projects), [projects]);
  const totals = useMemo(() => {
    return projects.reduce(
      (acc, project) => ({
        total: acc.total + project.stats.total,
        done: acc.done + project.stats.done,
        open: acc.open + project.stats.open,
        overdue: acc.overdue + project.stats.overdue,
        today: acc.today + project.stats.today,
      }),
      { total: 0, done: 0, open: 0, overdue: 0, today: 0 },
    );
  }, [projects]);

  if (!projects.length) return <EmptyOverview />;

  const completion = totals.total
    ? Math.round((totals.done / totals.total) * 100)
    : 0;

  return (
    <div className="overview-page">
      <div className="overview-kpis">
        <div className="overview-kpi">
          <div className="overview-kpi-label">项目</div>
          <div className="overview-kpi-value">{projects.length}</div>
          <div className="overview-kpi-sub">本地 Markdown 项目</div>
        </div>
        <div className="overview-kpi">
          <div className="overview-kpi-label">总任务</div>
          <div className="overview-kpi-value">{totals.total}</div>
          <div className="overview-kpi-sub">已完成 {totals.done} 项</div>
        </div>
        <div className="overview-kpi">
          <div className="overview-kpi-label">未完成</div>
          <div className="overview-kpi-value accent">{totals.open}</div>
          <div className="overview-kpi-sub">整体完成率 {completion}%</div>
        </div>
        <div className="overview-kpi">
          <div className="overview-kpi-label">已超时</div>
          <div className={`overview-kpi-value${totals.overdue > 0 ? ' danger' : ''}`}>
            {totals.overdue}
          </div>
          <div className="overview-kpi-sub">今天到期 {totals.today} 项</div>
        </div>
      </div>

      <section className="overview-card">
        <header className="overview-card-head overview-list-head">
          <div>
            <h2 className="overview-card-title">项目列表</h2>
          </div>
          <span className="chart-unit">{projects.length} 个项目</span>
        </header>

        <div className="index-head">
          <span>项目</span>
          <span>状态</span>
          <span>进度</span>
          <span className="num">未完成</span>
          <span className="num">P0</span>
          <span className="num">P1</span>
          <span className="num">P2</span>
          <span className="num">超时</span>
        </div>

        {sorted.map((project) => {
          const progress = project.stats.total
            ? Math.round((project.stats.done / project.stats.total) * 100)
            : 0;

          return (
            <button
              type="button"
              className="index-row"
              key={project.id}
              onClick={() => void selectProject(project.id)}
              aria-label={`打开项目 ${project.name}`}
            >
              <span className="index-project">
                <span
                  className="index-project-name"
                  role="button"
                  title="点击查看项目详情"
                  onClick={(event) => {
                    event.stopPropagation();
                    openProjectDetail(project.id);
                  }}
                >
                  {project.name}
                </span>
                {project.code ? (
                  <span className="index-project-meta">{project.code}</span>
                ) : null}
              </span>
              <span className="index-status">
                <ProjectStatusChip status={project.status} />
              </span>
              <span className="index-progress">
                <span className="index-progress-track">
                  <span style={{ width: `${progress}%` }} />
                </span>
                <span className="index-progress-label">
                  {project.stats.done}/{project.stats.total}
                </span>
              </span>
              <span className="index-open num">
                {project.stats.open}
                <span className="index-unit"> 项</span>
              </span>
              <span className={`index-p0 num${project.stats.p0 > 0 ? ' danger' : ''}`}>
                {project.stats.p0 || '—'}
              </span>
              <span
                className={`index-p1 num${(project.stats.byPriority.P1 ?? 0) > 0 ? ' warn' : ''}`}
              >
                {project.stats.byPriority.P1 || '—'}
              </span>
              <span className={`index-p2 num${(project.stats.byPriority.P2 ?? 0) > 0 ? ' warn2' : ''}`}>
                {project.stats.byPriority.P2 || '—'}
              </span>
              <span
                className={`index-overdue num${
                  project.stats.overdue > 0 ? ' danger' : ''
                }`}
              >
                {project.stats.overdue || '—'}
              </span>
            </button>
          );
        })}
      </section>
    </div>
  );
}
