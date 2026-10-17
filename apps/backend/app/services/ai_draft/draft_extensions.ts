/**
 * 草案可选扩展字段的宽松归一化：三点估算、风险登记册扩展、治理文档。
 *
 * 这些字段都是可选的：模型写错形态时先尽量修正（拆 Marked 包装、中文策略名映射、数字字符串转数字），
 * 实在不合法就丢弃该字段 / 该条目，而不是让整个阶段因可选内容重跑。
 */

import { PROJECT_DRAFT_RISK_STRATEGIES, type ProjectDraftRiskStrategy } from '@aiproj/types'

type JsonObject = Record<string, unknown>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 拆掉模型误加的 Marked 包装：{ value, marker } → value。 */
function unwrap(value: unknown): unknown {
  return isObject(value) && 'value' in value && 'marker' in value ? value.value : value
}

function text(value: unknown): string {
  const inner = unwrap(value)
  return typeof inner === 'string' ? inner.trim() : typeof inner === 'number' ? String(inner) : ''
}

function textList(value: unknown): string[] {
  const inner = unwrap(value)
  if (typeof inner === 'string') {
    return inner
      .split(/[、,，;；\n]+/u)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return Array.isArray(inner) ? inner.map(text).filter(Boolean) : []
}

function positiveNumber(value: unknown): number | null {
  const inner = unwrap(value)
  const number = typeof inner === 'string' ? Number(inner) : inner
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : null
}

const STRATEGY_ALIASES: Record<string, ProjectDraftRiskStrategy> = {
  规避: 'avoid',
  回避: 'avoid',
  转移: 'transfer',
  转嫁: 'transfer',
  减轻: 'mitigate',
  缓解: 'mitigate',
  降低: 'mitigate',
  接受: 'accept',
  承受: 'accept',
}

function strategyOf(value: unknown): ProjectDraftRiskStrategy | null {
  const raw = text(value).toLowerCase()
  if ((PROJECT_DRAFT_RISK_STRATEGIES as readonly string[]).includes(raw)) {
    return raw as ProjectDraftRiskStrategy
  }
  const alias = Object.entries(STRATEGY_ALIASES).find(([key]) => raw.includes(key))
  return alias ? alias[1] : null
}

function marked(value: unknown, reason: string, fallback: unknown): JsonObject {
  if (isObject(value) && 'value' in value && isObject(value.marker)) return value
  return {
    value: fallback,
    marker: { confidence: 0.6, source: 'inferred', reason, needsConfirmation: true },
  }
}

function normalizeEstimate(task: JsonObject): void {
  if (task.estimate === undefined) return
  const estimate = unwrap(task.estimate)
  const likely = positiveNumber(isObject(task.durationDays) ? task.durationDays.value : null)
  const optimistic = isObject(estimate)
    ? positiveNumber(estimate.optimisticDays ?? estimate.optimistic)
    : null
  const pessimistic = isObject(estimate)
    ? positiveNumber(estimate.pessimisticDays ?? estimate.pessimistic)
    : null
  if (
    optimistic === null ||
    pessimistic === null ||
    optimistic > pessimistic ||
    (likely !== null && (optimistic > likely || pessimistic < likely))
  ) {
    delete task.estimate
    return
  }
  task.estimate = { optimisticDays: optimistic, pessimisticDays: pessimistic }
}

/** 同时投入人数：正整数、封顶 50（超出多半是模型把角色总人数抄了过来），不合法直接丢弃按 1 人计。 */
const MAX_TASK_HEADCOUNT = 50

function normalizeHeadcount(task: JsonObject): void {
  if (task.headcount === undefined) return
  const value = positiveNumber(task.headcount)
  if (value === null) {
    delete task.headcount
    return
  }
  const rounded = Math.round(value)
  if (rounded < 1 || rounded > MAX_TASK_HEADCOUNT) delete task.headcount
  else task.headcount = rounded
}

function normalizeRiskExtensions(risk: JsonObject): void {
  for (const key of ['trigger', 'ownerRole'] as const) {
    if (risk[key] === undefined) continue
    const value = text(risk[key])
    if (!value) delete risk[key]
    else
      risk[key] = marked(
        risk[key],
        key === 'trigger' ? '触发条件由 AI 识别。' : '责任角色由 AI 建议。',
        value,
      )
  }
  if (risk.strategy !== undefined) {
    const strategy = strategyOf(risk.strategy)
    if (!strategy) delete risk.strategy
    else {
      const current = marked(risk.strategy, '应对策略由 AI 建议。', strategy)
      risk.strategy = { ...current, value: strategy }
    }
  }
}

function normalizeGovernance(value: unknown): JsonObject | null {
  const raw = unwrap(value)
  if (!isObject(raw)) return null
  const raci = (Array.isArray(unwrap(raw.raci)) ? (unwrap(raw.raci) as unknown[]) : [])
    .filter(isObject)
    .map((entry) => ({
      activity: text(entry.activity),
      responsible: textList(entry.responsible),
      accountable: text(entry.accountable),
      consulted: textList(entry.consulted),
      informed: textList(entry.informed),
    }))
    .filter((entry) => entry.activity && entry.responsible.length > 0)
  const qualityGates = (
    Array.isArray(unwrap(raw.qualityGates)) ? (unwrap(raw.qualityGates) as unknown[]) : []
  )
    .filter(isObject)
    .map((gate) => ({
      name: text(gate.name),
      entryCriteria: textList(gate.entryCriteria),
      exitCriteria: textList(gate.exitCriteria),
    }))
    .filter((gate) => gate.name && (gate.entryCriteria.length > 0 || gate.exitCriteria.length > 0))
  const releaseWindows = (
    Array.isArray(unwrap(raw.releaseWindows)) ? (unwrap(raw.releaseWindows) as unknown[]) : []
  )
    .filter(isObject)
    .map((window) => ({
      name: text(window.name),
      startDate: text(window.startDate),
      endDate: text(window.endDate),
      scope: text(window.scope),
      rollbackPlan: text(window.rollbackPlan),
    }))
    .filter(
      (window) =>
        window.name &&
        ISO_DATE.test(window.startDate) &&
        ISO_DATE.test(window.endDate) &&
        window.startDate <= window.endDate,
    )
  if (raci.length === 0 && qualityGates.length === 0 && releaseWindows.length === 0) return null
  return { raci, qualityGates, releaseWindows }
}

/** 就地归一化草案的可选扩展字段。 */
export function normalizeDraftExtensions(draft: JsonObject): void {
  if (Array.isArray(draft.tasks)) {
    for (const task of draft.tasks)
      if (isObject(task)) {
        normalizeEstimate(task)
        normalizeHeadcount(task)
      }
  }
  if (Array.isArray(draft.riskHints)) {
    for (const risk of draft.riskHints) if (isObject(risk)) normalizeRiskExtensions(risk)
  }
  if (draft.governance !== undefined) {
    const governance = normalizeGovernance(draft.governance)
    if (governance) draft.governance = governance
    else delete draft.governance
  }
}
