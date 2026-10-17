import type { ProjectDraftGenerationStage } from '@aiproj/types'

/**
 * AI 草案生成的墙钟预算（可由环境变量放宽）。
 *
 * 默认值按大型行业项目（数十人、半年以上、上百个任务）的详细度设定：原先的
 * 全程 6 分钟 / WBS 阶段 5 万字符只够小项目，大项目的 WBS 与任务会被迫写得笼统，
 * 或直接撞 `GENERATION_BUDGET_EXHAUSTED`。在此基础上仍开放以下旋钮：
 *
 * - `AI_DRAFT_TIME_BUDGET_SCALE`：时间预算倍率（1–10，默认 5），同比放大全程、各阶段、
 *   最终复核预留与单次请求超时；「单次尝试最小预算」不放大（它是下限，不是上限）。
 * - `AI_DRAFT_REQUEST_TIMEOUT_MS`：单次 provider 请求超时的绝对值覆盖（30 秒–60 分钟），
 *   优先于倍率。
 * - `AI_DRAFT_OUTPUT_BUDGET_SCALE`：输出长度预算倍率（1–5，默认 5），同比放大各阶段与全程
 *   响应字符上限。与时间倍率分开：不遵守 max_tokens 的 provider（如忽略 `max_tokens`
 *   的推理模型网关）在大项目上会远超每阶段 token 上限，撞的是字符上限而非时间。
 *
 * 直接读 `process.env` 而非 `#start/env`，以便未启动 Adonis 的单元测试可直接 import。
 * 每次调用即时读取，便于测试与 watch 模式下改 env 后生效。
 */

const BASE_MAX_GENERATION_WALL_MS = 25 * 60_000
const BASE_RESERVED_FINAL_REVIEW_BUDGET_MS = 6 * 60_000
const BASE_REQUEST_TIMEOUT_MS = 8 * 60_000

const BASE_STAGE_TIME_LIMITS_MS: Record<ProjectDraftGenerationStage, number> = {
  charter_scope: 2 * 60_000,
  wbs_tasks: 8 * 60_000,
  schedule_dependencies: 5 * 60_000,
  resources_risks_acceptance: 5 * 60_000,
  // 最终复核输出完整 ProjectDraft（含全部 WBS / 任务 / 依赖），是体量最大的一次输出。
  reconcile_review: 8 * 60_000,
}

const BASE_MAX_TOTAL_RESPONSE_CHARS = 1_000_000

/** 每阶段响应字符上限（与 STAGE_OUTPUT_TOKEN_LIMITS 互为冗余护栏）。 */
const BASE_STAGE_CHAR_LIMITS: Record<ProjectDraftGenerationStage, number> = {
  charter_scope: 40_000,
  wbs_tasks: 250_000,
  schedule_dependencies: 120_000,
  resources_risks_acceptance: 120_000,
  reconcile_review: 400_000,
}

const MIN_SCALE = 1
const MAX_SCALE = 10
const MAX_OUTPUT_SCALE = 5
const DEFAULT_SCALE = 5
const DEFAULT_OUTPUT_SCALE = 5
const MIN_REQUEST_TIMEOUT_MS = 30_000
const MAX_REQUEST_TIMEOUT_MS = 60 * 60_000

function readNumber(name: string): number | null {
  const raw = process.env[name]?.trim()
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export interface DraftGenerationBudget {
  scale: number
  outputScale: number
  maxGenerationWallMs: number
  reservedFinalReviewBudgetMs: number
  requestTimeoutMs: number
  stageTimeLimitsMs: Record<ProjectDraftGenerationStage, number>
  maxTotalResponseChars: number
  stageCharLimits: Record<ProjectDraftGenerationStage, number>
}

function scaleStageLimits(
  base: Record<ProjectDraftGenerationStage, number>,
  factor: number,
): Record<ProjectDraftGenerationStage, number> {
  return Object.fromEntries(
    Object.entries(base).map(([stage, value]) => [stage, Math.round(value * factor)]),
  ) as Record<ProjectDraftGenerationStage, number>
}

export function resolveDraftGenerationBudget(): DraftGenerationBudget {
  const scale = clamp(
    readNumber('AI_DRAFT_TIME_BUDGET_SCALE') ?? DEFAULT_SCALE,
    MIN_SCALE,
    MAX_SCALE,
  )
  const outputScale = clamp(
    readNumber('AI_DRAFT_OUTPUT_BUDGET_SCALE') ?? DEFAULT_OUTPUT_SCALE,
    MIN_SCALE,
    MAX_OUTPUT_SCALE,
  )
  const requestTimeoutOverride = readNumber('AI_DRAFT_REQUEST_TIMEOUT_MS')

  return {
    scale,
    outputScale,
    maxTotalResponseChars: Math.round(BASE_MAX_TOTAL_RESPONSE_CHARS * outputScale),
    stageCharLimits: scaleStageLimits(BASE_STAGE_CHAR_LIMITS, outputScale),
    maxGenerationWallMs: Math.round(BASE_MAX_GENERATION_WALL_MS * scale),
    reservedFinalReviewBudgetMs: Math.round(BASE_RESERVED_FINAL_REVIEW_BUDGET_MS * scale),
    requestTimeoutMs:
      requestTimeoutOverride !== null
        ? clamp(Math.round(requestTimeoutOverride), MIN_REQUEST_TIMEOUT_MS, MAX_REQUEST_TIMEOUT_MS)
        : Math.round(BASE_REQUEST_TIMEOUT_MS * scale),
    stageTimeLimitsMs: scaleStageLimits(BASE_STAGE_TIME_LIMITS_MS, scale),
  }
}

/** 预算耗尽时指明是哪一道预算，写进 GENERATION_BUDGET_EXHAUSTED 的说明部分。 */
export type DraftBudgetExhaustion = 'global_time' | 'stage_time' | 'stage_output' | 'total_output'

export const DRAFT_BUDGET_EXHAUSTION_LABELS: Record<DraftBudgetExhaustion, string> = {
  global_time: '全程耗时预算不足以再发起一次尝试',
  stage_time: '本阶段耗时超出上限',
  stage_output: '本阶段模型输出长度超出上限',
  total_output: '全程模型输出长度超出上限',
}
