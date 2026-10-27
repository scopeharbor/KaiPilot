/**
 * v3-llm-wiki-eval-gate —— 维基评测：问答集解析与打分、计划回测指标、切换门禁。
 *
 * 全部是纯函数、不调用模型；检索层评测（给模型的材料对不对、会不会泄露），答案层真实模型评测另需授权。
 */

export const WIKI_EVAL_MAX_QUESTIONS = 50
export const WIKI_EVAL_MIN_QUESTIONS = 5
export const WIKI_EVAL_MIN_PROJECTS = 3
export const WIKI_EVAL_MAX_PROJECTS = 20

export interface WikiEvalQuestion {
  question: string
  /** 必须出现在上下文中的要点（全部出现才算命中）。 */
  expect: string[]
  /** 不得出现的内容（任一出现即泄露）。 */
  forbid: string[]
  projectId?: number
}

const str = (v: unknown, min: number, max: number): string | null =>
  typeof v === 'string' && v.trim().length >= min && Array.from(v.trim()).length <= max
    ? v.trim()
    : null

const strList = (v: unknown, min: number, max: number): string[] | null => {
  if (v === undefined && min === 0) return []
  if (!Array.isArray(v) || v.length < min || v.length > max) return null
  const out: string[] = []
  for (const item of v) {
    const s = str(item, 1, 100)
    if (s === null) return null
    out.push(s)
  }
  return out
}

/** 解析问答集；不合规时给出第一处原因（中文）。 */
export function parseWikiEvalQuestions(
  input: unknown,
): { ok: true; questions: WikiEvalQuestion[] } | { ok: false; reason: string } {
  if (!Array.isArray(input) || input.length === 0)
    return { ok: false, reason: '问答集必须是非空数组' }
  if (input.length > WIKI_EVAL_MAX_QUESTIONS)
    return { ok: false, reason: `问答集最多 ${WIKI_EVAL_MAX_QUESTIONS} 题` }
  const questions: WikiEvalQuestion[] = []
  for (const [i, raw] of input.entries()) {
    const n = i + 1
    if (typeof raw !== 'object' || raw === null) return { ok: false, reason: `第 ${n} 题格式不对` }
    const r = raw as Record<string, unknown>
    const question = str(r.question, 1, 300)
    if (!question) return { ok: false, reason: `第 ${n} 题的 question 必须是 1–300 字` }
    const expect = strList(r.expect, 1, 10)
    if (!expect) return { ok: false, reason: `第 ${n} 题的 expect 必须是 1–10 个、每个 1–100 字` }
    const forbid = strList(r.forbid, 0, 10)
    if (!forbid) return { ok: false, reason: `第 ${n} 题的 forbid 最多 10 个、每个 1–100 字` }
    const projectId = r.projectId
    if (
      projectId !== undefined &&
      projectId !== null &&
      !(typeof projectId === 'number' && Number.isInteger(projectId) && projectId > 0)
    )
      return { ok: false, reason: `第 ${n} 题的 projectId 必须是正整数` }
    questions.push({
      question,
      expect,
      forbid,
      ...(typeof projectId === 'number' ? { projectId } : {}),
    })
  }
  return { ok: true, questions }
}

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, '')

export interface WikiEvalScore {
  hit: boolean
  leaked: boolean
  /** 命中要点比例（0–1）。 */
  recall: number
}

export function scoreWikiEvalContext(context: string, q: WikiEvalQuestion): WikiEvalScore {
  const c = norm(context)
  const hits = q.expect.filter((e) => c.includes(norm(e))).length
  const leaked = q.forbid.some((f) => c.includes(norm(f)))
  return {
    hit: hits === q.expect.length,
    leaked,
    recall: q.expect.length ? hits / q.expect.length : 0,
  }
}

export interface WikiEvalPathSummary {
  correct: number
  /** 正确（命中且未泄露）比例，两位小数。 */
  correctRate: number
  avgRecall: number
  leaks: number
  avgBytes: number
}

export interface WikiEvalQaRow {
  legacy: WikiEvalScore & { bytes: number }
  wiki: WikiEvalScore & { bytes: number }
}

export interface WikiEvalQaSummary {
  questions: number
  legacy: WikiEvalPathSummary
  wiki: WikiEvalPathSummary
}

const round2 = (n: number) => Math.round(n * 100) / 100

function summarizePath(
  rows: ReadonlyArray<WikiEvalScore & { bytes: number }>,
): WikiEvalPathSummary {
  const n = rows.length
  const correct = rows.filter((r) => r.hit && !r.leaked).length
  return {
    correct,
    correctRate: n ? round2(correct / n) : 0,
    avgRecall: n ? round2(rows.reduce((s, r) => s + r.recall, 0) / n) : 0,
    leaks: rows.filter((r) => r.leaked).length,
    avgBytes: n ? Math.round(rows.reduce((s, r) => s + r.bytes, 0) / n) : 0,
  }
}

export function summarizeWikiEvalQa(rows: readonly WikiEvalQaRow[]): WikiEvalQaSummary {
  return {
    questions: rows.length,
    legacy: summarizePath(rows.map((r) => r.legacy)),
    wiki: summarizePath(rows.map((r) => r.wiki)),
  }
}

// ── 计划回测 ─────────────────────────────────────────────────────────────

export interface WikiEvalEstimate {
  /** 工期系数（预测 = 计划 × 系数）；null 表示没有可用记忆（视为 1）。 */
  factor: number | null
  /** P80 上界比（上界 = 计划 × 比）；null 时用系数。 */
  p80Ratio: number | null
}

export interface WikiEvalBacktestProject {
  tasks: ReadonlyArray<{ plannedDays: number; actualDays: number }>
  legacy: WikiEvalEstimate
  wiki: WikiEvalEstimate
}

export const WIKI_EVAL_METHODS = ['baseline', 'legacy', 'wiki'] as const
export type WikiEvalMethod = (typeof WIKI_EVAL_METHODS)[number]

export const WIKI_EVAL_METHOD_LABELS: Record<WikiEvalMethod, string> = {
  baseline: '无记忆（计划原样）',
  legacy: '现场计算（旧规划记忆）',
  wiki: '维基参照类',
}

export interface WikiEvalMethodMetrics {
  /** 平均绝对百分比误差（两位小数，0.25 = 25%）。 */
  mape: number
  /** 实际 ≤ P80 上界的比例（整数百分比）。 */
  p80Coverage: number
}

export interface WikiEvalBacktestSummary {
  projects: number
  tasks: number
  methods: Record<WikiEvalMethod, WikiEvalMethodMetrics>
}

export function computeWikiEvalBacktest(
  projects: readonly WikiEvalBacktestProject[],
): WikiEvalBacktestSummary {
  const acc: Record<WikiEvalMethod, { err: number; covered: number }> = {
    baseline: { err: 0, covered: 0 },
    legacy: { err: 0, covered: 0 },
    wiki: { err: 0, covered: 0 },
  }
  let tasks = 0
  let counted = 0
  for (const p of projects) {
    const valid = p.tasks.filter(
      (t) =>
        Number.isFinite(t.plannedDays) &&
        Number.isFinite(t.actualDays) &&
        t.plannedDays > 0 &&
        t.actualDays > 0,
    )
    if (valid.length === 0) continue
    counted++
    const est: Record<WikiEvalMethod, WikiEvalEstimate> = {
      baseline: { factor: null, p80Ratio: null },
      legacy: p.legacy,
      wiki: p.wiki,
    }
    for (const t of valid) {
      tasks++
      for (const m of WIKI_EVAL_METHODS) {
        const factor = est[m].factor ?? 1
        const upper = t.plannedDays * (est[m].p80Ratio ?? factor)
        acc[m].err += Math.abs(t.plannedDays * factor - t.actualDays) / t.actualDays
        if (t.actualDays <= upper) acc[m].covered++
      }
    }
  }
  const metrics = (m: WikiEvalMethod): WikiEvalMethodMetrics => ({
    mape: tasks ? round2(acc[m].err / tasks) : 0,
    p80Coverage: tasks ? Math.round((acc[m].covered * 100) / tasks) : 0,
  })
  return {
    projects: counted,
    tasks,
    methods: { baseline: metrics('baseline'), legacy: metrics('legacy'), wiki: metrics('wiki') },
  }
}

// ── 门禁 ─────────────────────────────────────────────────────────────────

export const WIKI_EVAL_GATE_STATUSES = ['passed', 'failed', 'insufficient'] as const
export type WikiEvalGateStatus = (typeof WIKI_EVAL_GATE_STATUSES)[number]

export const WIKI_EVAL_GATE_LABELS: Record<WikiEvalGateStatus, string> = {
  passed: '通过',
  failed: '不通过',
  insufficient: '数据不足',
}

export interface WikiEvalGate {
  status: WikiEvalGateStatus
  reasons: string[]
}

export function wikiEvalGate(
  qa: WikiEvalQaSummary,
  backtest: WikiEvalBacktestSummary,
): WikiEvalGate {
  const insufficient: string[] = []
  if (qa.questions < WIKI_EVAL_MIN_QUESTIONS)
    insufficient.push(`问答集只有 ${qa.questions} 题，至少需要 ${WIKI_EVAL_MIN_QUESTIONS} 题`)
  if (backtest.projects < WIKI_EVAL_MIN_PROJECTS)
    insufficient.push(
      `可回测的已完成项目只有 ${backtest.projects} 个，至少需要 ${WIKI_EVAL_MIN_PROJECTS} 个`,
    )
  const failed: string[] = []
  if (qa.wiki.leaks > 0) failed.push(`维基路径有 ${qa.wiki.leaks} 题出现了不该出现的内容（泄露）`)
  if (qa.wiki.correctRate < qa.legacy.correctRate)
    failed.push(
      `维基路径问答正确率 ${Math.round(qa.wiki.correctRate * 100)}% 低于旧检索 ${Math.round(qa.legacy.correctRate * 100)}%`,
    )
  if (backtest.projects > 0 && backtest.methods.wiki.mape > backtest.methods.legacy.mape)
    failed.push(
      `维基参照类的回测工期误差 ${Math.round(backtest.methods.wiki.mape * 100)}% 高于现场计算 ${Math.round(backtest.methods.legacy.mape * 100)}%`,
    )
  if (failed.length > 0) return { status: 'failed', reasons: [...failed, ...insufficient] }
  if (insufficient.length > 0) return { status: 'insufficient', reasons: insufficient }
  return {
    status: 'passed',
    reasons: ['维基路径无泄露，问答正确率与回测工期误差都不劣于旧路径'],
  }
}

/** 评测种类（v3-llm-wiki-rag-retirement）：检索层不调用模型，答案层经组织 AI 连接生成回答。 */
export const WIKI_EVAL_KINDS = ['retrieval', 'answer'] as const
export type WikiEvalKind = (typeof WIKI_EVAL_KINDS)[number]

export const WIKI_EVAL_KIND_LABELS: Record<WikiEvalKind, string> = {
  retrieval: '检索评测（不调用 AI）',
  answer: '回答评测（调用 AI）',
}

export interface WikiEvalRunDto {
  id: number
  kind: WikiEvalKind
  status: WikiEvalGateStatus
  reasons: string[]
  qa: WikiEvalQaSummary
  backtest: WikiEvalBacktestSummary
  /** 答案层评测消耗的 token；检索层为 0。 */
  tokensUsed: number
  modelName: string | null
  createdAt: string
}
