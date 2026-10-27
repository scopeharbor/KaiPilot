/**
 * v3-llm-wiki-process-reality —— 流程页「实际的流程」派生段：任务流转与变更审批的确定性统计、渲染与解析、页面骨架。
 *
 * 只用状态与时间（不含对象名称、备注、操作人）；渲染与解析成对（往返测试守护）；正文不含日期，统计不变时正文不变。
 * 停留与等待按自然日计（审计时间戳），与参照类页的「工作日」区分。
 */
import { wikiPercentile, type WikiDerivedBlockRender } from './llm-wiki-dossier.js'
import { renderWikiMarkdown } from './llm-wiki-memory.js'

export const WIKI_PROCESS_TASK_FLOW_GENERATOR = 'process.task-flow'
export const WIKI_PROCESS_CHANGE_APPROVAL_GENERATOR = 'process.change-approval'

export const WIKI_PROCESS_KINDS = ['task-flow', 'change-approval'] as const
export type WikiProcessKind = (typeof WIKI_PROCESS_KINDS)[number]

export const WIKI_PROCESS_GENERATORS: Record<WikiProcessKind, string> = {
  'task-flow': WIKI_PROCESS_TASK_FLOW_GENERATOR,
  'change-approval': WIKI_PROCESS_CHANGE_APPROVAL_GENERATOR,
}
export const WIKI_PROCESS_KEY_PREFIX: Record<WikiProcessKind, string> = {
  'task-flow': 'pf-',
  'change-approval': 'pc-',
}

/** 走到「已完成」的任务至少这么多个才产出任务流转页（与参照类门槛一致）。 */
export const WIKI_PROCESS_TASK_MIN_SAMPLES = 8
/** 有审批结论的变更请求至少这么多个才产出变更审批页。 */
export const WIKI_PROCESS_CHANGE_MIN_SAMPLES = 5
/** 某状态停留 / 某类区间至少这么多个才报告分位数。 */
export const WIKI_PROCESS_MIN_INTERVALS = 3

export const WIKI_PROCESS_DECLARED_HEADING = '声明的流程（制度怎么写）'
export const WIKI_PROCESS_ACTUAL_HEADING = '实际的流程（数据怎么说）'
export const WIKI_PROCESS_INTERPRETATION_HEADING = '差异与解读'

const DAY_MS = 86_400_000
const PATH_TOP = 3
const PATH_MAX_STEPS = 7

const TASK_STATUS_LABELS: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '受阻',
  on_hold: '暂停',
  cancelled: '已取消',
}
const DWELL_STATUSES = ['in_progress', 'blocked', 'on_hold'] as const
type DwellStatus = (typeof DWELL_STATUSES)[number]

/** 一次状态流转（at 为毫秒时间戳）。 */
export interface WikiProcessTransition {
  entityId: number
  at: number
  from: string | null
  to: string
}

const round = (n: number, digits: number) => {
  const f = 10 ** digits
  return Math.round(n * f) / f
}
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : 0)
const days = (ms: number) => round(Math.max(0, ms) / DAY_MS, 1)

function groupByEntity(transitions: readonly WikiProcessTransition[]) {
  const byId = new Map<number, WikiProcessTransition[]>()
  for (const t of transitions) {
    if (!Number.isFinite(t.at) || !t.to) continue
    const list = byId.get(t.entityId) ?? []
    list.push(t)
    byId.set(t.entityId, list)
  }
  for (const list of byId.values()) list.sort((a, b) => a.at - b.at)
  return [...byId.entries()].sort((a, b) => a[0] - b[0])
}

function quantiles(values: number[]): { p50: number; p80: number } {
  return { p50: round(wikiPercentile(values, 0.5), 1), p80: round(wikiPercentile(values, 0.8), 1) }
}
const toDays = (q: { p50: number; p80: number }) => ({ p50Days: q.p50, p80Days: q.p80 })

// ── 任务流转 ─────────────────────────────────────────────────────────────

export interface WikiTaskFlowStats {
  samples: number
  paths: Array<{ label: string; share: number }>
  /** 完成后重新打开或进行中退回未开始的样本比例（整数百分比）。 */
  reworkRate: number
  /** 样本进入「已完成」次数的均值。 */
  rounds: number
  /** 受阻或暂停过的样本比例（整数百分比）。 */
  blockedRate: number
  dwell: Array<{ status: DwellStatus; p50Days: number; p80Days: number }>
}

function pathLabel(steps: readonly string[]): string {
  const labels = steps.map((s) => TASK_STATUS_LABELS[s] ?? s)
  if (labels.length <= PATH_MAX_STEPS) return labels.join(' → ')
  return [...labels.slice(0, 5), '…', labels[labels.length - 1]!].join(' → ')
}

export function computeWikiTaskFlow(
  transitions: readonly WikiProcessTransition[],
): WikiTaskFlowStats | null {
  const groups = groupByEntity(transitions)
  const dwellValues: Record<DwellStatus, number[]> = { in_progress: [], blocked: [], on_hold: [] }
  const pathCounts = new Map<string, number>()
  let samples = 0
  let rework = 0
  let blocked = 0
  let completions = 0

  for (const [, list] of groups) {
    for (let i = 0; i < list.length; i++) {
      const cur = list[i]!
      const next = list[i + 1]
      if (next && (DWELL_STATUSES as readonly string[]).includes(cur.to))
        dwellValues[cur.to as DwellStatus].push(days(next.at - cur.at))
    }
    if (list[list.length - 1]!.to !== 'completed') continue
    samples++
    const steps: string[] = []
    const first = list[0]!.from
    if (first) steps.push(first)
    for (const t of list) if (steps[steps.length - 1] !== t.to) steps.push(t.to)
    const label = pathLabel(steps)
    pathCounts.set(label, (pathCounts.get(label) ?? 0) + 1)
    if (
      list.some(
        (t) =>
          (t.from === 'completed' && t.to === 'in_progress') ||
          (t.from === 'in_progress' && t.to === 'not_started'),
      )
    )
      rework++
    if (list.some((t) => t.to === 'blocked' || t.to === 'on_hold')) blocked++
    completions += list.filter((t) => t.to === 'completed').length
  }
  if (samples < WIKI_PROCESS_TASK_MIN_SAMPLES) return null

  const paths = [...pathCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, PATH_TOP)
    .map(([label, count]) => ({ label, share: pct(count, samples) }))
  const dwell = DWELL_STATUSES.filter(
    (s) => dwellValues[s].length >= WIKI_PROCESS_MIN_INTERVALS,
  ).map((status) => ({ status, ...toDays(quantiles(dwellValues[status])) }))
  return {
    samples,
    paths,
    reworkRate: pct(rework, samples),
    rounds: round(completions / samples, 2),
    blockedRate: pct(blocked, samples),
    dwell,
  }
}

// ── 变更审批 ─────────────────────────────────────────────────────────────

export interface WikiChangeApprovalStats {
  samples: number
  waitP50Days: number
  waitP80Days: number
  approvalRate: number
  returnRate: number
  /** 样本进入「已提交」次数的均值。 */
  rounds: number
  implement: { p50Days: number; p80Days: number } | null
}

const DECISIONS = new Set(['approved', 'rejected', 'returned'])

export function computeWikiChangeApproval(
  transitions: readonly WikiProcessTransition[],
): WikiChangeApprovalStats | null {
  const groups = groupByEntity(transitions)
  const waits: number[] = []
  const implementLags: number[] = []
  let samples = 0
  let approved = 0
  let returned = 0
  let submissions = 0

  for (const [, list] of groups) {
    let roundStart: number | null = null
    let approvedAt: number | null = null
    let implementCounted = false
    for (const t of list) {
      if (t.to === 'submitted') roundStart = t.at
      else if (DECISIONS.has(t.to) && roundStart !== null) {
        waits.push(days(t.at - roundStart))
        roundStart = null
      }
      if (t.to === 'approved' && approvedAt === null) approvedAt = t.at
      if (t.to === 'implemented' && approvedAt !== null && !implementCounted) {
        implementLags.push(days(t.at - approvedAt))
        implementCounted = true
      }
    }
    const tos = list.map((t) => t.to)
    if (!tos.includes('approved') && !tos.includes('rejected')) continue
    samples++
    if (tos.includes('approved')) approved++
    if (tos.includes('returned')) returned++
    submissions += tos.filter((s) => s === 'submitted').length
  }
  if (samples < WIKI_PROCESS_CHANGE_MIN_SAMPLES || waits.length === 0) return null
  const wait = quantiles(waits)
  return {
    samples,
    waitP50Days: wait.p50,
    waitP80Days: wait.p80,
    approvalRate: pct(approved, samples),
    returnRate: pct(returned, samples),
    rounds: round(submissions / samples, 2),
    implement:
      implementLags.length >= WIKI_PROCESS_MIN_INTERVALS ? toDays(quantiles(implementLags)) : null,
  }
}

// ── 渲染与解析 ───────────────────────────────────────────────────────────

const fmt = (n: number) => String(round(n, 2))
const NUM = '(\\d+(?:\\.\\d+)?)'

function def(key: string, generator: string) {
  return `[^c:${key}]: derived_query#${generator}`
}

export function renderWikiTaskFlowBlock(stats: WikiTaskFlowStats): WikiDerivedBlockRender {
  const g = WIKI_PROCESS_TASK_FLOW_GENERATOR
  const lines = [
    `- 样本：走到「已完成」的任务 ${stats.samples} 个（来自任务状态流转记录）。[^c:pf-samples]`,
    `- 最常见的实际路径：${stats.paths.map((p) => `${p.label}（${p.share}%）`).join('；')}。[^c:pf-paths]`,
    `- 返工：${stats.reworkRate}% 的任务完成后被重新打开或从进行中退回未开始；平均完成 ${fmt(stats.rounds)} 轮。[^c:pf-rework]`,
    `- 受阻或暂停过的任务 ${stats.blockedRate}%。[^c:pf-blocked]`,
  ]
  const defs = [def('pf-samples', g), def('pf-paths', g), def('pf-rework', g), def('pf-blocked', g)]
  if (stats.dwell.length > 0) {
    lines.push(
      `- 各状态停留（自然日）：${stats.dwell
        .map(
          (d) =>
            `${TASK_STATUS_LABELS[d.status]} P50 ${fmt(d.p50Days)} 天、P80 ${fmt(d.p80Days)} 天`,
        )
        .join('；')}。[^c:pf-dwell]`,
    )
    defs.push(def('pf-dwell', g))
  }
  return { lines, defs }
}

const DWELL_BY_LABEL: Record<string, DwellStatus> = {
  进行中: 'in_progress',
  受阻: 'blocked',
  暂停: 'on_hold',
}

export function parseWikiTaskFlowBlock(content: string): WikiTaskFlowStats | null {
  const samples = new RegExp(`走到「已完成」的任务 ${NUM} 个`).exec(content)
  const rework = new RegExp(`返工：${NUM}% 的任务.*?平均完成 ${NUM} 轮`).exec(content)
  const blocked = new RegExp(`受阻或暂停过的任务 ${NUM}%`).exec(content)
  if (!samples || !rework || !blocked) return null
  const pathsLine = /最常见的实际路径：(.+?)。\[\^c:/.exec(content)?.[1] ?? ''
  const paths = pathsLine
    .split('；')
    .map((p) => /^(.+)（(\d+)%）$/.exec(p.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ label: m[1]!, share: Number(m[2]) }))
  const dwell: WikiTaskFlowStats['dwell'] = []
  const dwellLine = /各状态停留（自然日）：(.+?)。\[\^c:/.exec(content)?.[1] ?? ''
  for (const m of dwellLine.matchAll(
    new RegExp(`(进行中|受阻|暂停) P50 ${NUM} 天、P80 ${NUM} 天`, 'g'),
  ))
    dwell.push({ status: DWELL_BY_LABEL[m[1]!]!, p50Days: Number(m[2]), p80Days: Number(m[3]) })
  return {
    samples: Number(samples[1]),
    paths,
    reworkRate: Number(rework[1]),
    rounds: Number(rework[2]),
    blockedRate: Number(blocked[1]),
    dwell,
  }
}

export function renderWikiChangeApprovalBlock(
  stats: WikiChangeApprovalStats,
): WikiDerivedBlockRender {
  const g = WIKI_PROCESS_CHANGE_APPROVAL_GENERATOR
  const lines = [
    `- 样本：已有审批结论（批准或驳回）的变更请求 ${stats.samples} 个。[^c:pc-samples]`,
    `- 从提交到审批结论（批准、驳回或退回）的等待：P50 ${fmt(stats.waitP50Days)} 天、P80 ${fmt(stats.waitP80Days)} 天（自然日）。[^c:pc-wait]`,
    `- 批准率 ${stats.approvalRate}%；被退回补充过的 ${stats.returnRate}%，平均提交 ${fmt(stats.rounds)} 轮。[^c:pc-rounds]`,
  ]
  const defs = [def('pc-samples', g), def('pc-wait', g), def('pc-rounds', g)]
  if (stats.implement) {
    lines.push(
      `- 批准到实施：P50 ${fmt(stats.implement.p50Days)} 天、P80 ${fmt(stats.implement.p80Days)} 天（自然日）。[^c:pc-implement]`,
    )
    defs.push(def('pc-implement', g))
  }
  return { lines, defs }
}

export function parseWikiChangeApprovalBlock(content: string): WikiChangeApprovalStats | null {
  const samples = new RegExp(`的变更请求 ${NUM} 个`).exec(content)
  const wait = new RegExp(`审批结论（批准、驳回或退回）的等待：P50 ${NUM} 天、P80 ${NUM} 天`).exec(
    content,
  )
  const rates = new RegExp(`批准率 ${NUM}%；被退回补充过的 ${NUM}%，平均提交 ${NUM} 轮`).exec(
    content,
  )
  if (!samples || !wait || !rates) return null
  const implement = new RegExp(`批准到实施：P50 ${NUM} 天、P80 ${NUM} 天`).exec(content)
  return {
    samples: Number(samples[1]),
    waitP50Days: Number(wait[1]),
    waitP80Days: Number(wait[2]),
    approvalRate: Number(rates[1]),
    returnRate: Number(rates[2]),
    rounds: Number(rates[3]),
    implement: implement ? { p50Days: Number(implement[1]), p80Days: Number(implement[2]) } : null,
  }
}

// ── 页面 ────────────────────────────────────────────────────────────────

const TITLES: Record<WikiProcessKind, string> = {
  'task-flow': '任务流转：声明与实际',
  'change-approval': '变更审批：声明与实际',
}
const SUMMARIES: Record<WikiProcessKind, string> = {
  'task-flow': '任务实际怎么流转：常见路径、返工、受阻与各状态停留（确定性统计）',
  'change-approval': '变更请求实际怎么审批：等待时间、批准率与退回（确定性统计）',
}

export function wikiProcessSlug(kind: WikiProcessKind): string {
  return `process-${kind}`
}

export function wikiProcessTitle(kind: WikiProcessKind): string {
  return TITLES[kind]
}

export function wikiProcessKindOfSlug(slug: string): WikiProcessKind | null {
  return WIKI_PROCESS_KINDS.find((k) => wikiProcessSlug(k) === slug) ?? null
}

/** 新建流程页的完整正文：空的声明段 + 实际段（派生）+ 空的差异与解读 + 脚注定义。 */
export function wikiProcessPageBody(kind: WikiProcessKind, block: WikiDerivedBlockRender): string {
  return renderWikiMarkdown(
    { type: 'process', title: TITLES[kind], summary: SUMMARIES[kind] },
    [
      `## ${WIKI_PROCESS_DECLARED_HEADING}`,
      '',
      `## ${WIKI_PROCESS_ACTUAL_HEADING}`,
      '',
      `<!-- derived:${WIKI_PROCESS_GENERATORS[kind]} -->`,
      ...block.lines,
      '<!-- /derived -->',
      '',
      `## ${WIKI_PROCESS_INTERPRETATION_HEADING}`,
      '',
      ...block.defs,
      '',
    ].join('\n'),
  )
}

/** 某行（1 起，相对整份源文本）所在的二级章节标题；在首个二级标题之前返回 null。 */
export function wikiSectionOfLine(source: string, line: number): string | null {
  const lines = source.split('\n')
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const m = /^##\s+(.+?)\s*$/.exec(lines[i] ?? '')
    if (m) return m[1]!
  }
  return null
}

// ── 草案上下文与计划体检 ──────────────────────────────────────────────────

/** 草案上下文里的流程实况（来自组织维基已发布流程页）。 */
export interface WikiProcessRealityForDraft {
  taskFlow?: { label: string; samples: number; reworkRate: number; blockedRate: number }
  changeApproval?: {
    label: string
    samples: number
    waitP50Days: number
    waitP80Days: number
    returnRate: number
  }
}

/** 返工率不低于这个百分比时提示预留返工缓冲。 */
export const WIKI_PROCESS_REWORK_HINT_RATE = 20
/** 受阻或暂停比例不低于这个百分比时提示留等待余量。 */
export const WIKI_PROCESS_BLOCKED_HINT_RATE = 30
/** 计划体检里视为「审批类」的任务名关键字。 */
export const WIKI_PROCESS_APPROVAL_TASK_PATTERN = /审批|批准|审核|签批|签字|法务|合规/
