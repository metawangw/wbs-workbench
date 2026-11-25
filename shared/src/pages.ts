/**
 * Project markdown pages (简介 / 里程碑 / 风险 / 成本 / 相关方)。
 * 简介沿用 description 标记块，其余页面各有自己的标记块。
 *
 * Each page is stored inside the project Markdown as its own marker block, so a
 * project stays a single file that can still be edited by hand:
 *
 *   <!-- page:milestone:start -->
 *   ...任意 Markdown...
 *   <!-- page:milestone:end -->
 *
 * Blocks live between the front matter and the H1 (next to the description
 * block), which keeps them out of the task tree no matter what headings the
 * user writes inside.
 */

export const PROJECT_PAGE_KEYS = [
  'intro',
  'stakeholder',
  'risk',
  'milestone',
  'cost',
] as const;

export type ProjectPageKey = (typeof PROJECT_PAGE_KEYS)[number];

export const PROJECT_PAGE_LABELS: Record<ProjectPageKey, string> = {
  intro: '简介',
  milestone: '里程碑',
  risk: '风险',
  cost: '成本',
  stakeholder: '相关方',
};

/** 简介没有示例模板，进入编辑时留空。 */
export const INTRO_PAGE_KEY: ProjectPageKey = 'intro';

/**
 * 空白页进入编辑时预填的示例模板。
 *
 * 用户可以保留示例直接改写使用；只要原样未动，保存时按「空页面」处理
 * （不写入项目文件，项目信息里也不显示），避免把示例误当真实内容。
 */
export const PROJECT_PAGE_TEMPLATES: Record<ProjectPageKey, string> = {
  intro: '',
  milestone: [
    '| 里程碑 | 计划日期 | 联系人 | 状态 | 验收标准 |',
    '| --- | --- | --- | --- | --- |',
    '| 需求确认 | 2026-12-10 | 项目经理 | 已完成 | 需求规格说明书双方签字 |',
    '| 设备到货验收 | 2027-01-15 | 实施经理 | 进行中 | 型号与数量同合同一致 |',
    '| 系统联调 | 2027-02-20 | 技术联系人 | 未开始 | 与 PBX 互通、拨测通过 |',
    '| 试运行 | 2027-03-10 | 项目经理 | 未开始 | 连续 5 个工作日无重大故障 |',
    '| 终验交付 | 2027-03-31 | 项目经理 | 未开始 | 验收报告签字归档 |',
  ].join('\n'),
  risk: [
    '| 风险 | 等级 | 影响 | 应对措施 | 联系人 |',
    '| --- | --- | --- | --- | --- |',
    '| 设备到货延期 | 高 | 联调节点顺延 | 提前锁定库存、分批到货 | 采供 |',
    '| 现场割接窗口不足 | 中 | 上线时间被压缩 | 与业主方预约夜间窗口 | 实施经理 |',
    '| 关键用户培训不足 | 中 | 上线后使用不畅 | 分批培训 + 操作视频 | 项目经理 |',
    '| 网络策略未开通 | 低 | 联调受阻 | 提前提交端口与策略清单 | 技术联系人 |',
  ].join('\n'),
  cost: [
    '| 项目 | 预算（万元） | 已发生（万元） | 说明 |',
    '| --- | --- | --- | --- |',
    '| 硬件设备 | 68.00 | 40.00 | 网关、话机与配件 |',
    '| 软件许可 | 25.00 | 25.00 | 平台授权 |',
    '| 实施服务 | 18.00 | 6.00 | 现场实施与联调 |',
    '| 运维服务 | 12.00 | 3.00 | 首年运维 |',
    '| 合计 | 123.00 | 74.00 | 预算结余 49.00 |',
  ].join('\n'),
  stakeholder: [
    '| 相关方 | 角色 | 关注点 | 联系人 |',
    '| --- | --- | --- | --- |',
    '| 业主方 信息部 | 项目发起 | 上线时间与稳定性 | 待填 |',
    '| 业主方 使用部门 | 关键用户 | 日常使用体验 | 待填 |',
    '| 业主方 工程部 | 配合方 | 网络与布线改造 | 待填 |',
    '| 设备供应商 | 供应方 | 到货与质保 | 待填 |',
    '| 项目实施团队 | 交付方 | 进度与质量 | 项目经理 |',
  ].join('\n'),
};

export function isProjectPageKey(value: unknown): value is ProjectPageKey {
  return (
    typeof value === 'string' &&
    (PROJECT_PAGE_KEYS as readonly string[]).includes(value)
  );
}

/** 里程碑最多关联的任务数，避免 Front Matter 那一行无限长。 */
export const MAX_MILESTONE_TASKS = 100;

/** 真实任务的 id 形如 `t_mwou7g4j8cdf009d`；`s_` 开头是临时 id，不能持久关联。 */
export function isLinkableTaskId(value: unknown): value is string {
  return typeof value === 'string' && /^t_[A-Za-z0-9_]+$/.test(value);
}

/**
 * 里程碑关联任务列表的归一化。
 *
 * 存成 Front Matter 的 `milestoneTasks: ["t_a", "t_b"]`，跟着项目文件走，
 * 换浏览器、换电脑都一致；顺手滤掉临时 id 与重复项。
 */
export function normalizeMilestoneTaskIds(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : [];
  const out: string[] = [];
  for (const item of raw) {
    if (!isLinkableTaskId(item)) continue;
    const id = item.trim();
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_MILESTONE_TASKS) break;
  }
  return out;
}

export function projectPageStart(key: ProjectPageKey): string {
  return `<!-- page:${key}:start -->`;
}

export function projectPageEnd(key: ProjectPageKey): string {
  return `<!-- page:${key}:end -->`;
}

/** Marker pattern used by the parser to skip page blocks in one pass. */
export const PROJECT_PAGE_BLOCK =
  /^<!--\s*page:(intro|milestone|risk|cost|stakeholder):(start|end)\s*-->$/;

/**
 * 简介 / 里程碑 / 风险 / 成本 / 相关方 的展示顺序。
 *
 * 用户在项目详情里拖动调整后写进项目 Front Matter 的 `pageOrder`，因此顺序
 * 跟着项目文件走：换电脑、换浏览器都一致。缺失的 key 按默认顺序补在后面。
 */
export function normalizeProjectPageOrder(value: unknown): ProjectPageKey[] {
  const out: ProjectPageKey[] = [];
  const push = (key: ProjectPageKey) => {
    if (!out.includes(key)) out.push(key);
  };
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (isProjectPageKey(item)) push(item);
    });
  } else if (typeof value === 'string') {
    // Front Matter 里也可能写成 "milestone, risk" 这种字符串。
    value.split(/[,\s]+/).forEach((item) => {
      if (isProjectPageKey(item)) push(item);
    });
  }
  PROJECT_PAGE_KEYS.forEach(push);
  return out;
}
