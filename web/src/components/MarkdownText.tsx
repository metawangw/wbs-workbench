import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

export interface ResolvedImage {
  src: string;
  width?: number;
}

export type ImageResolver = (name: string) => ResolvedImage | null;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Rewrite Obsidian embed syntax (`![[image.png]]` / `![[image.png|100]]`) into
 * plain `<img>` tags. Fence-aware so code blocks are never touched. When no
 * resolver is provided the text is returned unchanged (existing behaviour).
 */
function embedObsidianImages(markdown: string, resolveImage?: ImageResolver): string {
  if (!resolveImage) return markdown;

  const lines = markdown.split('\n');
  let inFence = false;
  const out = lines.map((line) => {
    if (/^[ \t]*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    return line.replace(/!\[\[([^\]]+)\]\]/g, (whole, inner: string) => {
      const resolved = resolveImage(inner);
      if (!resolved) return whole;
      const name = inner.split('|')[0].trim();
      const widthAttr = resolved.width ? ` width="${resolved.width}"` : '';
      return `<img src="${resolved.src}" alt="${escapeHtml(name)}"${widthAttr}>`;
    });
  });

  return out.join('\n');
}

export default function MarkdownText({
  text,
  className,
  resolveImage,
}: {
  text: string;
  className?: string;
  /** Optional resolver that turns an Obsidian embed name into an <img>. */
  resolveImage?: ImageResolver;
}) {
  const html = useMemo(() => {
    const rendered = marked.parse(embedObsidianImages(text, resolveImage), {
      async: false,
    }) as string;
    return DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true },
      // Keep the explicit width attribute from `![[name|100]]`.
      ADD_ATTR: ['width'],
    });
  }, [text, resolveImage]);

  return (
    <div
      className={`markdown-text${className ? ` ${className}` : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
