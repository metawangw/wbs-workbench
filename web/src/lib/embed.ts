/**
 * `![[...]]` 引用在 Markdown 里必须独立成段。
 *
 * GFM 表格要求「表头行」与「分隔行」紧挨着，中间插一行别的内容（哪怕只有一个
 * 引用标记）整张表就会退化成一段普通文字；把引用换成任务卡片 / 静态文字时也
 * 一样会把表格撑破。这里把夹在表格里的「只含引用的行」搬到表格块之后。
 */
const TABLE_ROW_RE = /^\s*\|/;
const EMBED_ONLY_RE = /^\s*(?:!\[\[[^\]]+\]\]\s*)+$/;

export function hoistTableEmbeds(markdown: string): string {
  if (!markdown.includes('![[')) return markdown;

  const lines = markdown.split('\n');
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    if (!TABLE_ROW_RE.test(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    // 一整块「表格行 + 夹在中间的引用行」
    const rows: string[] = [];
    const refs: string[] = [];
    let j = i;
    while (j < lines.length && (TABLE_ROW_RE.test(lines[j]) || EMBED_ONLY_RE.test(lines[j]))) {
      if (TABLE_ROW_RE.test(lines[j])) rows.push(lines[j]);
      else refs.push(...lines[j].trim().split(/\s+/));
      j += 1;
    }

    out.push(...rows);
    if (refs.length > 0) {
      // 表头 + 分隔行的「真表格」才搬，且与表格之间留一个空行。
      if (rows.length >= 2 && j < lines.length && lines[j].trim() !== '') out.push('');
      out.push(...refs);
    }
    i = j;
  }

  return out.join('\n');
}
