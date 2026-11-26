import { useEffect, useMemo, useRef, useState } from 'react';
import { App as AntApp, Button, Input, Tooltip } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import {
  PROJECT_PAGE_LABELS,
  PROJECT_PAGE_TEMPLATES,
  buildTaskRefIndex,
  lookupTaskRef,
  isLockedProjectStatus,
  type ProjectPageKey,
} from '@wbs/shared';
import { useStore } from '../store';
import MarkdownText, { type EmbedResolver, type ImageResolver } from './MarkdownText';
import TaskRefPicker from './TaskRefPicker';
import { taskRefCardHtml } from '../lib/taskRef';

/**
 * 里程碑 / 风险 / 成本 / 相关方：独立的 Markdown 页面。
 *
 * 内容直接存在项目 Markdown 的 `<!-- page:xxx:start/end -->` 块里，所以既能
 * 在应用内编辑，也能用任意编辑器直接改文件；保存走 store → 服务端写回。
 *
 * 空白页进入编辑时会预填一份示例模板：可以直接在示例上改成自己的内容；
 * 若原样不动就保存，则按「空页面」处理（不写入文件，项目信息里也不显示）。
 *
 * 里程碑要挂任务时不写 Front Matter，而是在正文里插 `![[2.1]]` 这样的
 * 引用标记（与插图同一套 Obsidian 语法）：渲染成任务卡片，点击跳转任务。
 */
export default function PageView({ pageKey }: { pageKey: ProjectPageKey }) {
  const project = useStore((state) => state.project);
  const saveProjectPage = useStore((state) => state.saveProjectPage);
  const jumpToTask = useStore((state) => state.jumpToTask);
  const { message } = AntApp.useApp();

  const template = PROJECT_PAGE_TEMPLATES[pageKey] ?? '';
  const hasTemplate = template.trim().length > 0;
  const stored = project?.pages?.[pageKey] ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const textareaRef = useRef<TextAreaRef>(null);
  /** 最后已知的光标位置；没碰过编辑框时按「文末」插入。 */
  const caretRef = useRef<number | null>(null);

  // 切换项目 / 页面 / 外部改动时，退出编辑并跟上最新内容。
  useEffect(() => {
    setEditing(false);
    setDraft(stored);
    caretRef.current = null;
  }, [project?.id, pageKey, stored]);

  /** 编辑框里此刻显示的仍是未改动的示例模板。 */
  const onTemplate =
    editing && hasTemplate && !stored.trim() && draft.trim() === template.trim();

  const resolveImage = useMemo<ImageResolver | undefined>(() => {
    if (!project) return undefined;
    const baseUrl = `/api/projects/${encodeURIComponent(project.id)}/images/`;
    return (raw: string) => {
      const match = /^([^|]+)(?:\|(\d+))?$/.exec(raw.trim());
      if (!match) return null;
      const file = match[1].trim();
      if (!file) return null;
      return {
        src: `${baseUrl}${encodeURIComponent(file)}`,
        width: match[2] ? Number(match[2]) : undefined,
      };
    };
  }, [project?.id]);

  // 序号 → 任务。`![[2.1]]` 先按序号找，找不到才当图片名。
  const refIndex = useMemo(() => buildTaskRefIndex(project?.roots ?? []), [project?.roots]);

  const resolveTask = useMemo<EmbedResolver | undefined>(() => {
    if (!project) return undefined;
    return (raw) => {
      const hit = lookupTaskRef(refIndex, raw);
      return hit ? taskRefCardHtml(hit.task, hit.code) : null;
    };
  }, [project?.id, refIndex]);

  if (!project) return null;

  const locked = isLockedProjectStatus(project?.status);
  const label = PROJECT_PAGE_LABELS[pageKey];

  const startEdit = () => {
    if (locked) {
      message.info('项目已归档或终止，仅可修改项目信息');
      return;
    }
    setDraft(stored.trim() ? stored : template);
    caretRef.current = null;
    setEditing(true);
  };

  const submit = async () => {
    if (locked || saving) return;
    setSaving(true);
    try {
      // 示例原样未改 → 视为空页面，不把示例写进项目文件。
      const untouched =
        hasTemplate && !stored.trim() && draft.trim() === template.trim();
      await saveProjectPage(pageKey, untouched ? '' : draft);
      setEditing(false);
      if (untouched) {
        message.info('没有改动示例内容，这一页按空页面处理');
      } else {
        message.success(`${label}已保存`);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /** 只在编辑态点得到这个按钮，直接打开选择器。 */
  const openPicker = () => setPickerOpen(true);

  /** 把 `![[2.1]]` 原样插到光标处（多选用空格分隔）。 */
  const insertRefs = (codes: string[]) => {
    setPickerOpen(false);
    if (codes.length === 0) return;

    const current = editing ? draft : stored;
    const caret = caretRef.current;
    const at0 = caret === null ? current.length : Math.min(caret, current.length);

    // 光标停在表格行的收尾 `|` 后面时，往前挪一格，否则会多出一个单元格。
    const lineStart = current.lastIndexOf('\n', Math.max(at0 - 1, 0)) + 1;
    const lineBreak = current.indexOf('\n', at0);
    const lineEnd = lineBreak === -1 ? current.length : lineBreak;
    const atRowEnd =
      at0 === lineEnd && current.slice(lineStart, lineEnd).trimStart().startsWith('|');
    const at = atRowEnd && current[at0 - 1] === '|' ? at0 - 1 : at0;

    const token = codes.map((code) => `![[${code}]]`).join(' ');
    const before = current.slice(0, at);
    const after = current.slice(at);
    // 紧跟文字时补一个空格，其余情况严格插在光标处。
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    const inserted = `${pad}${token}`;
    const cursor = at + inserted.length;

    setDraft(`${before}${inserted}${after}`);
    requestAnimationFrame(() => {
      const node = textareaRef.current?.resizableTextArea?.textArea;
      if (!node) return;
      node.focus();
      node.setSelectionRange(cursor, cursor);
      caretRef.current = cursor;
    });
    message.success(`已插入 ${codes.length} 个任务引用`);
  };

  return (
    <div className="page-view">
      <div className="page-view-bar">
        <div className="page-view-title">
          <FileTextOutlined />
          <span>{label}</span>
          <span className="page-view-path">
            {project.path} · {pageKey === 'intro' ? 'description' : `page:${pageKey}`}
          </span>
        </div>
        <div className="page-view-actions">
          {editing && pageKey === 'milestone' ? (
            <Tooltip title="把 ![[序号]] 插到光标处">
              <Button size="small" icon={<LinkOutlined />} disabled={locked} onClick={openPicker}>
                插入任务
              </Button>
            </Tooltip>
          ) : null}
          {editing ? (
            <>
              <Button
                size="small"
                icon={<CloseOutlined />}
                onClick={() => {
                  setDraft(stored);
                  setEditing(false);
                }}
              >
                取消
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                loading={saving}
                onClick={() => void submit()}
              >
                保存
              </Button>
            </>
          ) : (
            <Tooltip title={locked ? '项目已归档或终止，仅可修改项目信息' : '编辑这一页 Markdown'}>
              <Button
                size="small"
                icon={<EditOutlined />}
                disabled={locked}
                onClick={startEdit}
              >
                编辑
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {editing ? (
        <div className="page-view-editor">
          {onTemplate ? (
            <div className="page-view-tip">
              <InfoCircleOutlined />
              <span>
                下面是示例模板，可以直接在示例上改成你要的内容；若不做任何修改就保存，
                这一页按空页面处理，不会写入文件，项目信息里也不显示。
              </span>
            </div>
          ) : null}
          <Input.TextArea
            ref={textareaRef}
            className="page-view-textarea"
            value={draft}
            autoFocus
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value);
              caretRef.current = event.target.selectionStart;
            }}
            onSelect={(event) => {
              caretRef.current = event.currentTarget.selectionStart;
            }}
            onClick={(event) => {
              caretRef.current = event.currentTarget.selectionStart;
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 's') {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="page-view-foot">
            <span>
              支持 Markdown
              {pageKey === 'milestone' ? '；![[2.1]] 引用任务' : ''}
              ；Ctrl + S 保存，内容写入 {project.path}
            </span>
          </div>
        </div>
      ) : stored.trim() ? (
        <div className="page-view-body">
          <MarkdownText
            text={stored}
            resolveImage={resolveImage}
            resolveTask={resolveTask}
            onTaskClick={jumpToTask}
            className="page-md"
          />
        </div>
      ) : (
        <div className="page-view-empty">
          <div className="page-view-empty-icon">
            <FileTextOutlined />
          </div>
        </div>
      )}

      {pageKey === 'milestone' ? (
        <TaskRefPicker
          open={pickerOpen}
          roots={project.roots}
          onCancel={() => setPickerOpen(false)}
          onInsert={insertRefs}
        />
      ) : null}
    </div>
  );
}
