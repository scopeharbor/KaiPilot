/**
 * v3-chart-gallery-data-foundation —— SpcMetricService（W4.5）。
 *
 * SPC 统计过程控制（Statistical Process Control）纯只读计算服务：
 * 自动抽取项目已完工任务样本，核算过程周期指标的中心线（CL/均值）、
 * 样本标准差 σ、上下控制限（UCL/LCL，±3σ）与上下警告限（UWL/LWL，±2σ），
 * 并按 Nelson 规则子集（超限点 / 9 点同侧漂移 / 6 点单调趋势）标记失控点。
 *
 * 派生统计量（天数，下限 0.1 防御同日完工任务）：
 * - cycle_time：max(0.1, actual_end_date − actual_start_date)（日历日差）；
 * - lead_time：max(0.1, actual_end_date − created_at)（含时刻的真实日差）。
 *
 * 样本选取：status='completed' 且 actual_start_date / actual_end_date 均非空，
 * 按完工时间取最近 `limit` 条（默认 100），返回按完工时间升序（控制图横轴）。
 *
 * 统计口径：
 * - σ 为样本标准差（Bessel 校正，N−1 分母）；
 * - UCL = round(CL + 3σ, 2)，LCL = round(max(0, CL − 3σ), 2)，
 *   UWL/LWL 以 ±2σ 同规则；规则判定使用未舍入统计量（防边界误判）；
 * - N < 5 时控制限置 null 并返回 warning='SAMPLE_SIZE_TOO_SMALL'。
 *
 * 纯计算零写库（RL-06）；组织隔离 projectOrFail → 404（RL-05）。
 */
import Project from '#models/project'
import Task from '#models/task'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'

/** SPC 派生统计量类型。 */
export type SpcMetricKind = 'cycle_time' | 'lead_time'

/** Nelson 规则违规码（rule1 与 spec 场景一致）。 */
export const SPC_RULE1_BEYOND_3SIGMA = 'rule1_beyond_3sigma'
export const SPC_RULE2_NINE_SAME_SIDE = 'rule2_nine_same_side'
export const SPC_RULE3_SIX_MONOTONIC_TREND = 'rule3_six_monotonic_trend'

/** 样本不足提示码（design：友好降级而非报错）。 */
export const SPC_WARNING_SAMPLE_SIZE_TOO_SMALL = 'SAMPLE_SIZE_TOO_SMALL'

export interface SpcSample {
  taskId: number
  taskName: string
  completedAt: string
  value: number
  isOutlier: boolean
  violatedRules: string[]
}

export interface SpcSummary {
  metric: SpcMetricKind
  sampleCount: number
  mean: number | null
  sigma: number | null
  ucl: number | null
  lcl: number | null
  uwl: number | null
  lwl: number | null
}

export interface SpcResult {
  summary: SpcSummary
  samples: SpcSample[]
  warning: string | null
}

/** 完工任务内存样本。 */
interface CompletedTaskSample {
  taskId: number
  taskName: string
  completedAt: DateTime
  /** 派生统计量（天数，已做 0.1 下限防御）。 */
  value: number
}

const DEFAULT_LIMIT = 100
const MIN_SAMPLE_SIZE = 5

function round2(value: number): number {
  return Number(value.toFixed(2))
}

/** 日历日差（cycle_time 口径：忽略时刻与 DST）。 */
function calendarDayDiff(from: DateTime, to: DateTime): number {
  const utcMs = (d: DateTime) => Date.UTC(d.year, d.month - 1, d.day)
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000)
}

@inject()
export default class SpcMetricService {
  async getControlChart(
    organizationId: number,
    projectId: number,
    metric: SpcMetricKind = 'cycle_time',
    limit: number = DEFAULT_LIMIT,
  ): Promise<SpcResult> {
    const effectiveMetric: SpcMetricKind = metric === 'lead_time' ? 'lead_time' : 'cycle_time'
    await this.projectOrFail(organizationId, projectId)

    const sampleLimit = Math.min(1000, Math.max(1, Math.trunc(Number(limit) || DEFAULT_LIMIT)))

    const tasks = await Task.query()
      .where('project_id', projectId)
      .where('status', 'completed')
      .whereNotNull('actual_start_date')
      .whereNotNull('actual_end_date')
      .select('id', 'name', 'actual_start_date', 'actual_end_date', 'created_at')
      // 取最近 N 条完工任务，再在内存按完工时间升序输出
      .orderBy('actual_end_date', 'desc')
      .orderBy('id', 'desc')
      .limit(sampleLimit)

    const samples: CompletedTaskSample[] = tasks
      .map((task) => {
        const actualEnd = task.actualEndDate!
        const rawValue =
          effectiveMetric === 'cycle_time'
            ? calendarDayDiff(task.actualStartDate!, actualEnd)
            : actualEnd.diff(task.createdAt, 'days').days
        return {
          taskId: task.id,
          taskName: task.name,
          completedAt: actualEnd,
          value: Math.max(0.1, rawValue),
        }
      })
      .sort((a, b) =>
        a.completedAt.toMillis() === b.completedAt.toMillis()
          ? a.taskId - b.taskId
          : a.completedAt.toMillis() - b.completedAt.toMillis(),
      )

    if (samples.length < MIN_SAMPLE_SIZE) {
      return {
        summary: this.buildSummary(effectiveMetric, samples, null),
        samples: samples.map((sample) => this.wrapSample(sample, null, null)),
        warning: SPC_WARNING_SAMPLE_SIZE_TOO_SMALL,
      }
    }

    const mean = average(samples.map((s) => s.value))
    const sigma = sampleStdDev(
      samples.map((s) => s.value),
      mean,
    )

    const ucl = round2(mean + 3 * sigma)
    const lcl = round2(Math.max(0, mean - 3 * sigma))
    const uwl = round2(mean + 2 * sigma)
    const lwl = round2(Math.max(0, mean - 2 * sigma))

    const ruleFlags = this.evaluateNelsonRules(samples, mean, sigma)

    return {
      summary: this.buildSummary(effectiveMetric, samples, { mean, sigma, ucl, lcl, uwl, lwl }),
      samples: samples.map((sample, index) =>
        this.wrapSample(sample, mean, sigma, ruleFlags[index]),
      ),
      warning: null,
    }
  }

  // ---------------------------------------------------------------------------
  // 统计与规则
  // ---------------------------------------------------------------------------

  private buildSummary(
    metric: SpcMetricKind,
    samples: CompletedTaskSample[],
    stats: {
      mean: number
      sigma: number
      ucl: number
      lcl: number
      uwl: number
      lwl: number
    } | null,
  ): SpcSummary {
    const mean = stats ? round2(stats.mean) : null
    const sigma = stats ? round2(stats.sigma) : null
    return {
      metric,
      sampleCount: samples.length,
      mean,
      sigma,
      ucl: stats ? stats.ucl : null,
      lcl: stats ? stats.lcl : null,
      uwl: stats ? stats.uwl : null,
      lwl: stats ? stats.lwl : null,
    }
  }

  private wrapSample(
    sample: CompletedTaskSample,
    mean: number | null,
    sigma: number | null,
    violatedRules?: string[],
  ): SpcSample {
    const beyondLimits =
      mean !== null &&
      sigma !== null &&
      (sample.value > mean + 3 * sigma || sample.value < Math.max(0, mean - 3 * sigma))
    return {
      taskId: sample.taskId,
      taskName: sample.taskName,
      completedAt: sample.completedAt.toISODate()!,
      value: round2(sample.value),
      isOutlier: violatedRules ? violatedRules.includes(SPC_RULE1_BEYOND_3SIGMA) : beyondLimits,
      violatedRules: violatedRules ?? [],
    }
  }

  /**
   * Nelson 规则子集（design D2-3）：
   * - rule1：样本超出 UCL/LCL（±3σ 极值异常，未舍入比较防边界误判）；
   * - rule2：连续 9 个点落在中心线同一侧（> CL 为上一侧、< CL 为下一侧，等于 CL 不归属任何一侧并切断连击）；
   * - rule3：连续 6 个点严格单调递增或递减（趋势恶化）。
   */
  private evaluateNelsonRules(
    samples: CompletedTaskSample[],
    mean: number,
    sigma: number,
  ): Array<string[]> {
    const ucl = mean + 3 * sigma
    const lcl = Math.max(0, mean - 3 * sigma)

    const sides: number[] = samples.map((sample) => {
      if (sample.value > mean) return 1
      if (sample.value < mean) return -1
      return 0
    })

    const flags: Array<string[]> = samples.map(() => [])
    for (let i = 0; i < samples.length; i++) {
      const value = samples[i].value
      const rules: string[] = []

      // Rule 1：极值超限
      if (value > ucl || value < lcl) rules.push(SPC_RULE1_BEYOND_3SIGMA)

      // Rule 2：从 i 向前数同侧连击
      if (sides[i] !== 0) {
        let run = 1
        for (let j = i - 1; j >= 0 && sides[j] === sides[i]; j--) run += 1
        if (run >= 9) rules.push(SPC_RULE2_NINE_SAME_SIDE)
      }

      // Rule 3：从 i 向前数严格单调连击（升/降）
      let upRun = 1
      let downRun = 1
      for (let j = i - 1; j >= 0; j--) {
        if (samples[j].value < samples[j + 1].value) upRun += 1
        else break
      }
      for (let j = i - 1; j >= 0; j--) {
        if (samples[j].value > samples[j + 1].value) downRun += 1
        else break
      }
      if (upRun >= 6 || downRun >= 6) rules.push(SPC_RULE3_SIX_MONOTONIC_TREND)

      flags[i] = rules
    }
    return flags
  }

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }
}

function average(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0) / values.length
}

/** 样本标准差（Bessel 校正，N-1 分母）。 */
function sampleStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}
