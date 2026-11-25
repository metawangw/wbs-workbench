import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Input, Modal, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { collectCodes, flattenTasks, isVersionTask, type TaskNode } from '@wbs/shared';

interface PickerRow {
  id: string;
  code: string;
  title: string;
  depth: number;
  owner?: string;
  due?: string;
  done: boolean;
  isVersion: boolean;
}

/**
 * 里程碑「插入任务」选择器。
 *
 * 选中后不是写进 Front Matter，而是往正文里插入 `![[2.1]]` 这样的引用标记
 * —— 页面保持纯 Markdown，正文里渲染成任务卡片、点击即跳转。
 */
export default function TaskRefPicker({
  open,
  roots,
  onCancel,
  onInsert,
}: {
  open: boolean;
  roots: TaskNode[];
  onCancel: () => void;
  onInsert: (codes: string[]) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setSelected([]);
      setKeyword('');
    }
  }, [open]);

  const rows = useMemo<PickerRow[]>(() => {
    const codes = collectCodes(roots);
    return flattenTasks(roots)
      .map((task) => ({
        id: task.id,
        code: codes.get(task.id) ?? '',
        title: task.title,
        depth: task.indent > 0 ? Math.min(3, Math.round(task.indent / 2)) : 0,
        owner: task.fields.owner,
        due: task.fields.due,
        done: task.done,
        isVersion: isVersionTask(task.fields),
      }))
      .filter((row) => row.code);
  }, [roots]);

  const visible = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    if (!text) return rows;
    return rows.filter((row) =>
      [row.title, row.code, row.owner ?? ''].some((field) =>
        field.toLowerCase().includes(text),
      ),
    );
  }, [rows, keyword]);

  const toggle = (code: string) => {
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code],
    );
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title="插入任务引用"
      width={720}
      className="milestone-picker-modal"
      footer={
        <div className="mtp-footer">
          <span className="mtp-count">已选 {selected.length} 个任务</span>
          <div>
            <Button onClick={onCancel}>取消</Button>
            <Button
              type="primary"
              disabled={selected.length === 0}
              onClick={() => onInsert(selected)}
            >
              插入引用
            </Button>
          </div>
        </div>
      }
    >
      <div className="mtp-hint">
        插入的是纯 Markdown 引用标记，例如 <code>![[2.1]]</code>
        ；正文里会显示成任务卡片，点一下直接跳到该任务。
      </div>

      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="搜索任务名称、联系人或编号"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />

      <div className="mtp-list">
        {visible.length === 0 ? (
          <div className="mtp-empty">没有匹配的任务</div>
        ) : (
          visible.map((row) => {
            const on = selected.includes(row.code);
            return (
              <div
                key={row.id}
                className={`mtp-row${on ? ' is-on' : ''}${
                  row.isVersion ? ' is-version-task' : ''
                }`}
                style={{ paddingLeft: 10 + row.depth * 16 }}
                onClick={() => toggle(row.code)}
              >
                <Checkbox checked={on} />
                <span className="mtp-code">{row.code}</span>
                <span className={`mtp-title${row.done ? ' is-done' : ''}`}>
                  {row.title}
                </span>
                {row.owner ? <span className="mtp-owner">{row.owner}</span> : null}
                {row.due ? <span className="mtp-due">{row.due}</span> : null}
                {row.done ? <Tag className="mtp-tag">已完成</Tag> : null}
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
