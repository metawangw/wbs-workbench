import { isVersionTask, type TaskNode } from '@wbs/shared';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 最新进展太长时按字符截断，卡片保持一行高度。 */
function clip(value: string, max = 48): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 页面里的任务引用卡片（`![[2.1]]`）。
 *
 * 这里返回的是原始 HTML 字符串，因为它要插进 marked 解析前的 Markdown 里；
 * 点击跳转靠 `data-task-id`，由 MarkdownText 上的事件委托统一处理。
 */
export function taskRefCardHtml(task: TaskNode, code: string): string {
  const latest = task.progress[task.progress.length - 1];
  const pri = task.fields.priority;
  const bits: string[] = [];

  if (task.fields.owner) bits.push(`<span>${esc(task.fields.owner)}</span>`);
  if (task.fields.due) bits.push(`<span>截止 ${esc(task.fields.due)}</span>`);
  if (latest) {
    bits.push(`<span class="task-ref-prog">${esc(clip(latest.text))}</span>`);
  }

  return [
    `<span class="task-ref${task.done ? ' is-done' : ''}${
      isVersionTask(task.fields) ? ' is-version-task' : ''
    }" data-task-id="${esc(task.id)}"`,
    ` role="link" tabindex="0" title="${esc(task.title)} · 点击跳转到这个任务">`,
    '<span class="task-ref-main">',
    code ? `<span class="task-ref-code">${esc(code)}</span>` : '',
    `<span class="task-ref-title">${esc(task.title)}</span>`,
    pri ? `<span class="task-ref-pri is-${esc(pri.toLowerCase())}">${esc(pri)}</span>` : '',
    `<span class="task-ref-state">${task.done ? '已完成' : '进行中'}</span>`,
    '</span>',
    bits.length ? `<span class="task-ref-sub">${bits.join('')}</span>` : '',
    '</span>',
  ].join('');
}

/**
 * 导出（HTML / PDF）里用的静态版引用：不能点，只保留「序号 + 标题」。
 */
export function taskRefStaticHtml(task: TaskNode, code: string): string {
  return `<span class="task-ref-static">${code ? `<b>${esc(code)}</b> ` : ''}${esc(
    task.title,
  )}</span>`;
}
