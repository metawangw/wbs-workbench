import { useEffect, useMemo, useRef, useState } from 'react';
import {
  App as AntApp,
  AutoComplete,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Switch,
  Tooltip,
} from 'antd';
import type { InputRef } from 'antd/es/input';
import {
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  SaveOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  collectCodes,
  findTask,
  flattenTasks,
  isSelfOrDescendant,
  parseDeps,
  priorityMeta,
  wouldCreateCycle,
} from '@wbs/shared';
import { useStore } from '../store';
import { IMPORTANCE_OPTIONS, StatusPill } from './atoms';
import MarkdownText from './MarkdownText';

interface FormState {
  title: string;
  owner: string;
  priority: string;
  importance: string;
  start: Dayjs | null;
  due: Dayjs | null;
  cycle: string;
  confirm: string;
  /** 0-100; empty string means "not set" (no progress bar on the Gantt). */
  progress: string;
  /** Stable IDs of predecessor tasks. */
  deps: string[];
}

function toForm(task: NonNullable<ReturnType<typeof findTask>>): FormState {
  return {
    title: task.title,
    owner: task.fields.owner ?? '',
    priority: task.fields.priority ?? '',
    importance: task.fields.importance ?? '',
    start: task.fields.start ? dayjs(task.fields.start) : null,
    due: task.fields.due ? dayjs(task.fields.due) : null,
    cycle: task.fields.cycle ?? '',
    confirm: task.fields.confirm ?? '',
    progress: task.fields.progress ?? '',
    deps: parseDeps(task.fields.deps),
  };
}

function readAuthor(): string {
  try {
    return localStorage.getItem('wbs.author') || '我';
  } catch {
    return '我';
  }
}

export default function TaskDrawer() {
  const drawerTaskId = useStore((state) => state.drawerTaskId);
  const project = useStore((state) => state.project);
  const closeTask = useStore((state) => state.closeTask);
  const toggleDone = useStore((state) => state.toggleDone);
  const saveFields = useStore((state) => state.saveFields);
  const addProgress = useStore((state) => state.addProgress);
  const deleteTask = useStore((state) => state.deleteTask);
  const { message, modal } = AntApp.useApp();

  const task = useMemo(
    () => findTask(project?.roots ?? [], drawerTaskId),
    [project, drawerTaskId],
  );
  const codes = useMemo(() => collectCodes(project?.roots ?? []), [project]);

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [preview, setPreview] = useState(false);
  const [author, setAuthor] = useState(readAuthor);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const titleRef = useRef<InputRef>(null);

  useEffect(() => {
    if (task) setForm(toForm(task));
  }, [task?.id]);

  useEffect(() => {
    if (!drawerTaskId) {
      setProgressText('');
      setPreview(false);
    }
  }, [drawerTaskId]);

  const timeline = useMemo(() => {
    return [...(task?.progress ?? [])].sort((a, b) => {
      const at = `${a.date} ${a.time ?? ''}`;
      const bt = `${b.date} ${b.time ?? ''}`;
      return bt.localeCompare(at);
    });
  }, [task?.progress]);

  const dirty = Boolean(
    task &&
      form &&
      (form.title.trim() !== task.title ||
        form.owner.trim() !== (task.fields.owner ?? '') ||
        form.priority.trim() !== (task.fields.priority ?? '') ||
        form.importance.trim() !== (task.fields.importance ?? '') ||
        (form.start?.format('YYYY-MM-DD') ?? '') !== (task.fields.start ?? '') ||
        (form.due?.format('YYYY-MM-DD') ?? '') !== (task.fields.due ?? '') ||
        form.cycle.trim() !== (task.fields.cycle ?? '') ||
        form.confirm.trim() !== (task.fields.confirm ?? '') ||
        form.progress.trim() !== (task.fields.progress ?? '') ||
        JSON.stringify(form.deps) !== JSON.stringify(parseDeps(task.fields.deps))),
  );

  const requestClose = () => {
    if (!dirty) {
      closeTask();
      return;
    }
    modal.confirm({
      title: '放弃未保存的修改？',
      content: '任务字段的修改还没有写入 Markdown 文件。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: closeTask,
    });
  };

  const update = (patch: Partial<FormState>) => {
    setForm((previous) => (previous ? { ...previous, ...patch } : previous));
  };

  const handleSave = async () => {
    if (!task || !form) return;
    if (!form.title.trim()) {
      message.warning('任务名称不能为空');
      return;
    }
    if (wouldCreateCycle(project?.roots ?? [], task.id, form.deps)) {
      message.warning('前置任务会形成循环依赖，请调整');
      return;
    }

    setSaving(true);
    try {
      await saveFields(task.id, {
        title: form.title.trim(),
        fields: {
          owner: form.owner.trim(),
          priority: form.priority.trim(),
          importance: form.importance.trim(),
          start: form.start?.format('YYYY-MM-DD') ?? '',
          due: form.due?.format('YYYY-MM-DD') ?? '',
          cycle: form.cycle.trim(),
          confirm: form.confirm.trim(),
          progress: form.progress.trim(),
          deps: form.deps.join(','),
        },
      });
      message.success('已写入 Markdown');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!task) return;
    try {
      await toggleDone(task);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新失败');
    }
  };

  const submitProgress = async () => {
    if (!task) return;
    const text = progressText.trim();
    if (!text) return;

    setAdding(true);
    try {
      const cleanAuthor = author.trim() || '我';
      await addProgress(task.id, text, cleanAuthor);
      try {
        localStorage.setItem('wbs.author', cleanAuthor);
      } catch {
        /* ignore */
      }
      setProgressText('');
      setPreview(false);
      message.success('进展已追加到文件');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '追加进展失败');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    setDeleting(true);
    try {
      await deleteTask(task.id);
      message.success('任务已删除，原文件已备份到 .wbs-trash');
      closeTask();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const depOptions = useMemo(() => {
    const roots = project?.roots ?? [];
    const codes = collectCodes(roots);
    return flattenTasks(roots)
      // Synthetic IDs are regenerated on first edit; a dependency on one would
      // silently break. Only stable, persisted IDs can be depended upon.
      .filter((node) => !node.synthetic && !isSelfOrDescendant(roots, task?.id ?? '', node.id))
      .map((node) => ({
        value: node.id,
        label: `${codes.get(node.id) ?? ''}  ${node.title}`,
      }));
  }, [project, task?.id]);

  const priorityOptions = useMemo(() => {
    const options = ['P0', 'P1', 'P2'].map((value) => {
      const meta = priorityMeta(value);
      return {
        value,
        label: (
          <span className="select-priority">
            <span className={`mini-dot ${meta.tone}`} />
            {meta.label}
          </span>
        ),
      };
    });

    if (form?.priority && !options.some((option) => option.value === form.priority)) {
      options.push({
        value: form.priority,
        label: (
          <span className="select-priority">
            <span className="mini-dot other" />
            {form.priority}
          </span>
        ),
      });
    }
    return options;
  }, [form?.priority]);

  const footer = task ? (
    <div className="drawer-footer">
      <Popconfirm
        title="删除这个任务？"
        description="子任务与进展会一并删除；原文件会先备份到 .wbs-trash。"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        onConfirm={handleDelete}
      >
        <Button
          danger
          type="text"
          icon={<DeleteOutlined />}
          loading={deleting}
        >
          删除任务
        </Button>
      </Popconfirm>

      <div className="drawer-footer-right">
        {dirty ? <span className="dirty-hint">有未保存修改</span> : null}
        <Button onClick={requestClose}>关闭</Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          disabled={!dirty}
          loading={saving}
          onClick={() => void handleSave()}
        >
          保存字段
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <Drawer
      open={Boolean(drawerTaskId)}
      onClose={requestClose}
      width={588}
      className="task-drawer"
      title={
        <span className="drawer-heading">
          任务详情
          {project ? <span className="drawer-heading-sub">{project.name}</span> : null}
        </span>
      }
      footer={footer}
      styles={{ body: { padding: 0 }, footer: { padding: 0 } }}
    >
      {task && form ? (
        <div className="drawer-body">
          <div className="drawer-head">
            <div className="drawer-eyebrow">
              <span className="wbs-code strong">{codes.get(task.id)}</span>
              {task.section ? <span className="section-chip">{task.section}</span> : null}
              <span className="drawer-file">
                {project?.path} · 第 {task.line + 1} 行
              </span>
            </div>

            <div className="drawer-title-row">
              <Input
                ref={titleRef}
                className="drawer-title-input"
                variant="borderless"
                value={form.title}
                maxLength={300}
                onChange={(event) => update({ title: event.target.value })}
                onPressEnter={() => {
                  if (dirty) void handleSave();
                }}
              />
              <Tooltip title="编辑标题">
                <Button
                  className="title-edit-btn"
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => titleRef.current?.focus()}
                  aria-label="编辑任务标题"
                />
              </Tooltip>
            </div>

            <div className="drawer-statusbar">
              <StatusPill done={task.done} />
              <span className="status-hint">切换状态会立即写入文件</span>
              <Switch
                size="small"
                checked={task.done}
                onChange={() => void handleToggleStatus()}
              />
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">任务属性</div>
            <div className="field-grid">
              <div className="field">
                <div className="field-label">负责人</div>
                <AutoComplete
                  value={form.owner}
                  options={(project?.owners ?? []).map((owner) => ({
                    value: owner,
                  }))}
                  onChange={(value) => update({ owner: value })}
                  placeholder="输入或选择负责人"
                  allowClear
                  filterOption={(input, option) =>
                    String(option?.value ?? '')
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                />
              </div>

              <div className="field">
                <div className="field-label">优先级</div>
                <Select
                  value={form.priority || undefined}
                  options={priorityOptions}
                  onChange={(value) => update({ priority: value ?? '' })}
                  placeholder="未设置"
                  allowClear
                />
              </div>

              <div className="field">
                <div className="field-label">重要性</div>
                <AutoComplete
                  value={form.importance}
                  options={IMPORTANCE_OPTIONS.map((value) => ({ value }))}
                  onChange={(value) => update({ importance: value })}
                  placeholder="可选（高 / 中 / 低）"
                  allowClear
                />
              </div>

              <div className="field">
                <div className="field-label">开始日期</div>
                <DatePicker
                  value={form.start}
                  format="YYYY-MM-DD"
                  onChange={(value) => update({ start: value })}
                  placeholder="未设置"
                  style={{ width: '100%' }}
                  allowClear
                />
                {form.start && form.due && form.start.isAfter(form.due, 'day') ? (
                  <div className="gantt-field-hint">开始日期晚于截止日期，甘特条会自动校正区间。</div>
                ) : null}
              </div>

              <div className="field">
                <div className="field-label">截止日期</div>
                <DatePicker
                  value={form.due}
                  format="YYYY-MM-DD"
                  onChange={(value) => update({ due: value })}
                  placeholder="未设置"
                  style={{ width: '100%' }}
                  allowClear
                />
              </div>

              <div className="field">
                <div className="field-label">周期</div>
                <AutoComplete
                  value={form.cycle}
                  options={[
                    { value: '每日' },
                    { value: '每周' },
                    { value: '本周' },
                  ]}
                  onChange={(value) => update({ cycle: value })}
                  placeholder="例如 本周 / 每日"
                  allowClear
                />
              </div>

              <div className="field">
                <div className="field-label">确认人 / 关联人</div>
                <Input
                  value={form.confirm}
                  onChange={(event) => update({ confirm: event.target.value })}
                  placeholder="例如 李四"
                  allowClear
                />
              </div>

              <div className="field">
                <div className="field-label">进度百分比（可选）</div>
                <InputNumber
                  className="progress-input"
                  min={0}
                  max={100}
                  precision={0}
                  value={form.progress === '' ? null : Number(form.progress)}
                  onChange={(value) =>
                    update({ progress: value === null ? '' : String(value) })
                  }
                  placeholder="未设置"
                  suffix="%"
                  style={{ width: '100%' }}
                />
                <div className="gantt-field-hint">填写后甘特条会按百分比填充并显示数字。</div>
              </div>

              <div className="field field-full">
                <div className="field-label">前置任务（依赖）</div>
                <Select
                  mode="multiple"
                  value={form.deps}
                  options={depOptions}
                  onChange={(value) => update({ deps: value as string[] })}
                  placeholder="选择必须先完成的任务"
                  allowClear
                  maxTagCount="responsive"
                  optionFilterProp="label"
                  filterOption={(input, option) =>
                    String(option?.label ?? '')
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                  notFoundContent={
                    depOptions.length
                      ? '无匹配任务'
                      : '暂无可依赖任务（任务首次编辑后会生成稳定 ID）'
                  }
                />
                <div className="gantt-field-hint">
                  被选任务会成为本任务的前置条件，甘特图中以箭头连线；不允许形成循环。
                </div>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">
              <FileTextOutlined />
              最新进展
              <span className="section-count">{task.progress.length} 条</span>
            </div>

            <div className="progress-composer">
              <div className="composer-head">
                <span>记录一条进展</span>
                <div className="composer-tools">
                  <button
                    type="button"
                    className="preview-toggle"
                    disabled={!progressText.trim()}
                    onClick={() => setPreview((value) => !value)}
                  >
                    {preview ? '继续编辑' : 'Markdown 预览'}
                  </button>
                  <span className="composer-hint">Ctrl / ⌘ + Enter 提交</span>
                </div>
              </div>
              {preview ? (
                <div className="progress-preview">
                  <MarkdownText text={progressText || '（暂无内容）'} />
                </div>
              ) : (
                <Input.TextArea
                  value={progressText}
                  onChange={(event) => setProgressText(event.target.value)}
                  placeholder="今天完成了什么？遇到了什么阻塞？支持 **加粗**、`代码`、[链接](url)"
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  maxLength={2000}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                      event.preventDefault();
                      void submitProgress();
                    }
                  }}
                />
              )}
              <div className="composer-foot">
                <Input
                  className="author-input"
                  prefix={<UserOutlined />}
                  value={author}
                  maxLength={40}
                  onChange={(event) => setAuthor(event.target.value)}
                  placeholder="记录人"
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={adding}
                  disabled={!progressText.trim()}
                  onClick={() => void submitProgress()}
                >
                  追加进展
                </Button>
              </div>
            </div>

            {timeline.length > 0 ? (
              <div className="timeline">
                {timeline.map((entry, index) => (
                  <div className="timeline-item" key={`${entry.line}-${index}`}>
                    <div className="timeline-meta">
                      <span>
                        {entry.date}
                        {entry.time ? ` ${entry.time}` : ''}
                      </span>
                      {entry.author ? (
                        <span className="timeline-author">{entry.author}</span>
                      ) : null}
                    </div>
                    <MarkdownText text={entry.text} className="timeline-text" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="timeline-empty">还没有进展记录，写下第一条吧。</div>
            )}
          </div>

          <div className="drawer-meta-foot">
            数据源 <code>{project?.path}</code> · 所有修改以行为单位写回
          </div>
        </div>
      ) : (
        <div className="drawer-empty">
          <Empty description="任务不存在或已被删除" />
        </div>
      )}
    </Drawer>
  );
}
