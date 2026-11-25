import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { hoistTableEmbeds } from '../lib/embed';

marked.setOptions({ gfm: true, breaks: true });

export interface ResolvedImage {
  src: string;
  width?: number;
}

export type ImageResolver = (name: string) => ResolvedImage | null;

/**
 * 把 `![[...]]` 里的内容变成一段 HTML（任务引用卡片）。返回 null 表示
 * 这条不是它能识别的引用，交给后面的解析器继续试。
 */
export type EmbedResolver = (raw: string) => string | null;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 占位符：`![[...]]` 先换成 `\uE0000\uE001` 这样的纯文本记号，等 Markdown
 * 解析完再换回 HTML。直接把 `<span>` 塞进源码会把块级语法弄坏（比如表格里
 * 夹一行 HTML，整张表就退化成一段文字），占位符只是普通字符，不会影响解析。
 */
const TOKEN_OPEN = '\uE000';
const TOKEN_CLOSE = '\uE001';
const TOKEN_RE = /\uE000(\d+)\uE001/g;

/**
 * Rewrite Obsidian embed syntax (`![[2.1]]` / `![[image.png|100]]`).
 * 任务引用优先：序号能命中本地任务就渲染成任务卡片，否则再按图片名解析。
 * Fence-aware so code blocks are never touched.
 */
function applyEmbeds(
  markdown: string,
  resolveTask?: EmbedResolver,
  resolveImage?: ImageResolver,
): { text: string; embeds: string[] } {
  const embeds: string[] = [];
  if (!resolveTask && !resolveImage) return { text: markdown, embeds };

  const lines = markdown.split('\n');
  let inFence = false;
  const out = lines.map((line) => {
    if (/^[ \t]*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    return line.replace(/!\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
      let html: string | null = resolveTask?.(inner) ?? null;

      if (!html && resolveImage) {
        const resolved = resolveImage(inner);
        if (resolved) {
          const name = inner.split('|')[0].trim();
          const widthAttr = resolved.width ? ` width="${resolved.width}"` : '';
          html = `<img src="${resolved.src}" alt="${escapeHtml(name)}"${widthAttr}>`;
        }
      }

      if (!html) return whole;
      embeds.push(html);
      return `${TOKEN_OPEN}${embeds.length - 1}${TOKEN_CLOSE}`;
    });
  });

  return { text: out.join('\n'), embeds };
}

export default function MarkdownText({
  text,
  className,
  resolveImage,
  resolveTask,
  onTaskClick,
}: {
  text: string;
  className?: string;
  /** Optional resolver that turns an Obsidian embed name into an <img>. */
  resolveImage?: ImageResolver;
  /** Optional resolver that turns `![[2.1]]` into a task card. */
  resolveTask?: EmbedResolver;
  /** 点了任务引用卡片：带着 `data-task-id` 回调出去。 */
  onTaskClick?: (taskId: string) => void;
}) {
  const html = useMemo(() => {
    const { text: prepared, embeds } = applyEmbeds(
      hoistTableEmbeds(text),
      resolveTask,
      resolveImage,
    );
    let rendered = marked.parse(prepared, { async: false }) as string;

    if (embeds.length > 0) {
      // 占位符落进 `<td>` / `<p>` 里都没问题：替换后再统一交给 DOMPurify。
      rendered = rendered.replace(TOKEN_RE, (_, index: string) => embeds[Number(index)] ?? '');
    }

    return DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true },
      // Keep the explicit width attribute from `![[name|100]]`.
      ADD_ATTR: ['width'],
    });
  }, [text, resolveImage, resolveTask]);

  if (!onTaskClick) {
    return (
      <div
        className={`markdown-text${className ? ` ${className}` : ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  /** 引用卡片是生成出来的 HTML，用事件委托接管点击 / 回车。 */
  const pick = (target: EventTarget | null): string | null => {
    const el = target instanceof Element ? target.closest('[data-task-id]') : null;
    return el?.getAttribute('data-task-id') ?? null;
  };

  return (
    <div
      className={`markdown-text${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(event) => {
        const id = pick(event.target);
        if (id) {
          event.preventDefault();
          onTaskClick(id);
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const id = pick(event.target);
        if (!id) return;
        event.preventDefault();
        onTaskClick(id);
      }}
    />
  );
}
