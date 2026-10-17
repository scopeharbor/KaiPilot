import type { ConfirmedProjectContext } from '@aiproj/types'

/**
 * 草案颗粒度指引：按团队规模与项目周期给出 WBS / 任务数量与单任务工期要求。
 *
 * 背景（实测）：25 人、6 个月的银行核心系统重构，模型只产出 20 个 WBS 节点、16 个任务，
 * 单任务 7–30 天——对行业交付过于笼统，无法直接排产。原 prompt 只写「通常至少 8 个任务」，
 * 没有随规模放大的下限。这里用工作包惯例（单个工作包 3–10 个工作日，约 1 人 · 2 周）
 * 估算任务量：团队人数 × 周数 ÷ 5，夹在 [12, 160]，上限受单阶段输出预算约束。
 */

export interface DraftScaleInput {
  /** 团队人数；未知时按 5 人估算。 */
  teamSize: number | null
  /** 章程起止日期（YYYY-MM-DD）；缺失时按 12 周估算。 */
  startDate: string | null
  endDate: string | null
}

export interface DraftGranularityTarget {
  teamSize: number
  weeks: number
  minTasks: number
  maxTasks: number
  minLeafNodes: number
  minWbsDepth: number
}

const DEFAULT_TEAM_SIZE = 5
const DEFAULT_WEEKS = 12
const MIN_TASKS = 12
const MAX_TASKS = 160
const DAY_MS = 86_400_000

function leadingNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value !== 'string') return null
  const match = /\d+/.exec(value)
  return match ? Number(match[0]) : null
}

/** 团队人数：用户确认值 → 意图解析实体 → 组织在岗人数推断（最弱）。 */
export function contextTeamSize(context: ConfirmedProjectContext): number | null {
  const confirmed = leadingNumber(context.resolvedFields?.teamSize?.value)
  if (confirmed) return confirmed
  const parsed = context.parsedIntent.entities.find((entity) => entity.type === 'team_size')
  const fromEntity = leadingNumber(parsed?.value)
  if (fromEntity) return fromEntity
  return leadingNumber(context.assumptions?.teamSize?.value)
}

function weeksBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const from = Date.parse(`${start}T00:00:00Z`)
  const to = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null
  return Math.max(1, Math.ceil((to - from + DAY_MS) / (7 * DAY_MS)))
}

export function computeDraftGranularity(input: DraftScaleInput): DraftGranularityTarget {
  const teamSize =
    input.teamSize !== null && Number.isFinite(input.teamSize) && input.teamSize > 0
      ? Math.round(input.teamSize)
      : DEFAULT_TEAM_SIZE
  const weeks = weeksBetween(input.startDate, input.endDate) ?? DEFAULT_WEEKS
  const target = Math.min(MAX_TASKS, Math.max(MIN_TASKS, Math.round((teamSize * weeks) / 5)))
  const minTasks = Math.max(MIN_TASKS, Math.round(target * 0.8))
  const maxTasks = Math.min(MAX_TASKS + 40, Math.round(target * 1.25))
  return {
    teamSize,
    weeks,
    minTasks,
    maxTasks,
    // 每个可执行叶节点承载 2–4 个任务。
    minLeafNodes: Math.max(8, Math.round(minTasks / 4)),
    minWbsDepth: minTasks >= 40 ? 3 : 2,
  }
}

/** 写进 wbs_tasks 阶段 system prompt 的颗粒度要求。 */
export function draftGranularityGuide(target: DraftGranularityTarget): string {
  return [
    `【颗粒度要求】本项目团队约 ${target.teamSize} 人、周期约 ${target.weeks} 周，必须按可直接排产的工作包粒度拆分：`,
    `tasks 输出 ${target.minTasks}–${target.maxTasks} 个；WBS 至少 ${target.minWbsDepth} 层、至少 ${target.minLeafNodes} 个可执行叶节点，每个叶节点挂 2–4 个任务；`,
    '单个任务工期 3–10 个工作日（测评、演练、并行观察等等待型任务最多 15 个工作日），超过即拆分；',
    '每个核心子系统/模块都要分别拆出设计、开发、联调、测试任务，不得用一个任务覆盖多个模块；',
    '任务 description 写 40–120 字：具体产出物 + 完成判定标准（可量化的写数值）。',
  ].join('')
}
