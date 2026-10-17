/**
 * v3-chart-gallery-data-foundation —— ProjectEvmService（W4.1）。
 *
 * EVM 实值管理（Earned Value Management）纯只读计算引擎：
 * - 输入：organizationId / projectId / 可选的 asOfDate（YYYY-MM-DD，默认今天）；
 * - 输出：BAC / PV / EV / AC / CV / SV / CPI / SPI / ETC / EAC / VAC / TCPI
 *   指标卡 + 全周期 S 曲线时序点阵（历史 PV/EV/AC 重放 + 未来 PV/EAC 预测）；
 * - 恪守 D14：EVM 仅为工程进度-成本绩效度量视图，绝不介入财务核算；
 * - 纯计算零写库（RL-06），组织隔离 projectOrFail → 跨租户 404（RL-05）。
 *
 * 数据策略（无 N+1，三次批量读取后内存聚合）：
 * 1. Project（组织断言 + budgetCents/起止日期）；
 * 2. GanttBaseline 单行（快照含每任务基线成本与基线排期；旧快照缺省
 *    baselineCostCents / totalBaselineCostCents 时按 0 防御回退）；
 * 3. 项目全部未删任务（进度/实际成本/计划与实际日期）。
 *
 * 基线口径：
 * - 任务基线成本：快照中命中则取快照值（缺省按 0），未命中（打基线后新增任务）
 *   或无基线行时降级取任务当前 cost_estimate_cents；
 * - BAC：快照 totalBaselineCostCents > 0 取之；否则取 Project.budgetCents；
 *   完全无基线时最后回退到任务成本估算总和。
 *
 * 历史 EV/AC 重放模型（任务无逐日进度记录，采用线性锚点插值）：
 * - 进度从 0% 起线性爬升至当前 progressPercent：起点 = 实际开始（无则计划开始），
 *   终点 = 实际完成日（未完成则以 asOfDate 为锚）——保证 t = asOfDate 时
 *   历史累计 EV 与指标卡 EV 严格一致；
 * - AC 同构：从起点线性摊至实际完成日（未完成摊至 asOfDate）后走平。
 *
 * S 曲线采样：总工期 <= 30 天按日步进，> 30 天按周（7 天）步进并锚定项目起点；
 * 采样点严格 <= 150 个（超长工期自动加粗步长），响应体积远低于 200KB 预算。
 */
import GanttBaseline from '#models/gantt_baseline'
import Project from '#models/project'
import Task from '#models/task'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'

/** 进度状态定级（SPI 阈值 1.05 / 0.95）。 */
export type EvmScheduleStatus = 'ahead' | 'on_track' | 'delayed'

/** 成本状态定级（CPI 阈值 1.05 / 0.95）。 */
export type EvmCostStatus = 'under_budget' | 'on_track' | 'over_budget'

/** EVM 当前绩效指标卡。金额单位为「分」；比率保留 3 位小数。 */
export interface EvmIndicators {
  projectId: number
  asOfDate: string
  hasBaseline: boolean
  bac: number
  pv: number
  ev: number
  ac: number
  cv: number
  sv: number
  cpi: number
  spi: number
  etc: number
  eac: number
  vac: number
  tcpi: number
  scheduleStatus: EvmScheduleStatus
  costStatus: EvmCostStatus
}

/** S 曲线单采样点。未来点 ev/ac 为 null；历史点 eacForecast 为 null。 */
export interface EvmSCurvePoint {
  date: string
  pv: number
  ev: number | null
  ac: number | null
  eacForecast: number | null
}

/** S 曲线时序聚合结果。 */
export interface EvmSCurveResult {
  projectId: number
  asOfDate: string
  startDate: string
  endDate: string
  hasBaseline: boolean
  points: EvmSCurvePoint[]
}

/** 单个任务的 EVM 计算事实（内存投影）。 */
interface TaskEarnedValueFacts {
  id: number
  /** 基线成本（分）：快照命中优先，否则当前成本估算（无基线降级）。 */
  baselineCostCents: number
  /** 进度百分比 0-100。 */
  progressPercent: number
  /** 实际成本（分）。 */
  actualCostCents: number
  /** 计划/基线排期起止（用于 PV 计划值插值）。 */
  plannedStart: DateTime | null
  plannedEnd: DateTime | null
  /** 实际起止（用于历史 EV/AC 重放锚点）。 */
  actualStart: DateTime | null
  actualEnd: DateTime | null
}

/** EVM 计算所需的三份只读数据。 */
interface EvmDataSource {
  project: Project
  hasBaseline: boolean
  baselineTotalCents: number
  tasks: TaskEarnedValueFacts[]
  /** 项目预算（分）。 */
  budgetCents: number
}

/** 日期轴生成结果（daily/weekly 步进 + 终点对齐 + 150 点上限）。 */
interface SampleAxis {
  start: DateTime
  end: DateTime
  dates: DateTime[]
}

const ROUND2 = 2
const ROUND3 = 3

function round2(value: number): number {
  return Number(value.toFixed(ROUND2))
}

function round3(value: number): number {
  return Number(value.toFixed(ROUND3))
}

/** 日历日差（忽略时刻与时区 DST 影响，按年月日取整）。 */
function calendarDayDiff(from: DateTime, to: DateTime): number {
  const utcMs = (d: DateTime) => Date.UTC(d.year, d.month - 1, d.day)
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000)
}

@inject()
export default class ProjectEvmService {
  /** 当前 EVM 绩效指标卡。 */
  async getIndicators(
    organizationId: number,
    projectId: number,
    asOfDate?: string,
  ): Promise<EvmIndicators> {
    const data = await this.loadDataSource(organizationId, projectId)
    const asOf = this.parseAsOf(asOfDate)

    const bac = this.computeBac(data)
    // 展示口径：金额字段统一 2 位小数（分），CV/SV 由展示值推导保证算术自洽
    const ev = round2(this.sumCurrentEarnedValue(data.tasks))
    const ac = sum(data.tasks.map((t) => t.actualCostCents))
    const pv = round2(this.plannedValueAt(data.tasks, asOf))
    const cv = round2(ev - ac)
    const sv = round2(ev - pv)
    // 完工预测（ETC/EAC）使用未舍入 CPI 参与计算，输出比率另行舍入
    const cpiRaw = ac > 0 ? ev / ac : 1
    const spiRaw = pv > 0 ? ev / pv : 1
    const cpi = round3(cpiRaw)
    const spi = round3(spiRaw)
    const etc = cpiRaw > 0 ? Math.round((bac - ev) / cpiRaw) : Math.round(bac - ev)
    const eac = round2(ac + etc)
    const vac = round2(bac - eac)
    const tcpi = bac - ac > 0 ? round3((bac - ev) / (bac - ac)) : 1

    return {
      projectId,
      asOfDate: asOf.toISODate()!,
      hasBaseline: data.hasBaseline,
      bac,
      pv,
      ev,
      ac,
      cv,
      sv,
      cpi,
      spi,
      etc,
      eac,
      vac,
      tcpi,
      scheduleStatus: this.deriveScheduleStatus(spi),
      costStatus: this.deriveCostStatus(cpi),
    }
  }

  /** 全周期 S 曲线时序点阵（历史重放 + 未来 PV/EAC 预测）。 */
  async getSCurve(
    organizationId: number,
    projectId: number,
    asOfDate?: string,
  ): Promise<EvmSCurveResult> {
    const data = await this.loadDataSource(organizationId, projectId)
    const asOf = this.parseAsOf(asOfDate)
    const bac = this.computeBac(data)

    const axis = this.buildSampleAxis(data, asOf)
    if (!axis) {
      return {
        projectId,
        asOfDate: asOf.toISODate()!,
        startDate: asOf.toISODate()!,
        endDate: asOf.toISODate()!,
        hasBaseline: data.hasBaseline,
        points: [],
      }
    }

    const evNow = this.sumCurrentEarnedValue(data.tasks)
    const acNow = sum(data.tasks.map((t) => t.actualCostCents))
    const cpi = acNow > 0 ? evNow / acNow : 1
    const etc = cpi > 0 ? Math.round((bac - evNow) / cpi) : Math.round(bac - evNow)
    const horizonDays = calendarDayDiff(asOf, axis.end)

    const points: EvmSCurvePoint[] = axis.dates.map((date) => {
      const isPast = date.toISODate()! < asOf.toISODate()!
      if (isPast) {
        return {
          date: date.toISODate()!,
          pv: round2(this.plannedValueAt(data.tasks, date)),
          ev: round2(this.earnedValueAt(data.tasks, date, asOf)),
          ac: round2(this.actualCostAt(data.tasks, date, asOf)),
          eacForecast: null,
        }
      }
      if (date.toISODate()! === asOf.toISODate()!) {
        return {
          date: date.toISODate()!,
          pv: round2(this.plannedValueAt(data.tasks, asOf)),
          ev: round2(evNow),
          ac: round2(acNow),
          eacForecast: null,
        }
      }
      // 未来：基线 PV + 基于当前 CPI 的线性 EAC 预测趋势
      const forecast =
        horizonDays > 0 ? round2(acNow + etc * (calendarDayDiff(asOf, date) / horizonDays)) : null
      return {
        date: date.toISODate()!,
        pv: round2(this.plannedValueAt(data.tasks, date)),
        ev: null,
        ac: null,
        eacForecast: forecast,
      }
    })

    return {
      projectId,
      asOfDate: asOf.toISODate()!,
      startDate: axis.start.toISODate()!,
      endDate: axis.end.toISODate()!,
      hasBaseline: data.hasBaseline,
      points,
    }
  }

  // ---------------------------------------------------------------------------
  // 数据装配
  // ---------------------------------------------------------------------------

  private async loadDataSource(organizationId: number, projectId: number): Promise<EvmDataSource> {
    const project = await this.projectOrFail(organizationId, projectId)

    const baseline = await GanttBaseline.query().where('project_id', projectId).first()

    const tasks = await Task.query()
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .select(
        'id',
        'start_date',
        'end_date',
        'actual_start_date',
        'actual_end_date',
        'progress_percent',
        'cost_estimate_cents',
        'cost_actual_cents',
      )
      .orderBy('id')

    // 快照投影：任务 id -> { 基线成本, 基线排期 }。旧快照（无 baselineCostCents）
    // 与打基线后新增任务统一回退任务当前字段；旧快照任务节点按 ?? 0 防御。
    const baselineCostById = new Map<number, number>()
    const plannedStartById = new Map<number, DateTime | null>()
    const plannedEndById = new Map<number, DateTime | null>()
    let baselineTotalCents = 0

    if (baseline) {
      const snapshot = baseline.snapshot
      const snapshotTasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : []
      for (const item of snapshotTasks) {
        if (typeof item?.id !== 'number' || item.id <= 0) continue
        baselineCostById.set(item.id, Number(item.baselineCostCents ?? 0) || 0)
        plannedStartById.set(
          item.id,
          typeof item.startDate === 'string' && item.startDate
            ? DateTime.fromISO(item.startDate)
            : null,
        )
        plannedEndById.set(
          item.id,
          typeof item.endDate === 'string' && item.endDate ? DateTime.fromISO(item.endDate) : null,
        )
      }
      if (
        typeof snapshot?.totalBaselineCostCents === 'number' &&
        snapshot.totalBaselineCostCents > 0
      ) {
        baselineTotalCents = snapshot.totalBaselineCostCents
      }
    }

    const facts: TaskEarnedValueFacts[] = tasks.map((task) => {
      const hasSnapshotCost = baselineCostById.has(task.id)
      return {
        id: task.id,
        // 快照命中取快照（即使为 0 —— 旧快照防御）；未命中取当前估算（无基线降级）
        baselineCostCents: hasSnapshotCost
          ? (baselineCostById.get(task.id) ?? 0)
          : (task.costEstimateCents ?? 0),
        progressPercent: task.progressPercent ?? 0,
        actualCostCents: task.costActualCents ?? 0,
        plannedStart: plannedStartById.has(task.id)
          ? (plannedStartById.get(task.id) ?? null)
          : task.startDate,
        plannedEnd: plannedEndById.has(task.id)
          ? (plannedEndById.get(task.id) ?? null)
          : task.endDate,
        actualStart: task.actualStartDate,
        actualEnd: task.actualEndDate,
      }
    })

    return {
      project,
      hasBaseline: baseline !== null,
      baselineTotalCents,
      tasks: facts,
      budgetCents: project.budgetCents ?? 0,
    }
  }

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  private parseAsOf(asOfDate?: string): DateTime {
    if (!asOfDate) return DateTime.now()
    const parsed = DateTime.fromISO(asOfDate)
    return parsed.isValid ? parsed : DateTime.now()
  }

  // ---------------------------------------------------------------------------
  // 核心公式
  // ---------------------------------------------------------------------------

  private computeBac(data: EvmDataSource): number {
    if (data.baselineTotalCents > 0) return data.baselineTotalCents
    if (data.budgetCents > 0) return data.budgetCents
    if (!data.hasBaseline) return sum(data.tasks.map((t) => t.baselineCostCents))
    return 0
  }

  /** 完工预算口径下的任务挣值总额（当前时点）。 */
  private sumCurrentEarnedValue(tasks: TaskEarnedValueFacts[]): number {
    return sum(
      tasks.map((task) => {
        const percent = Math.min(100, Math.max(0, task.progressPercent))
        return (task.baselineCostCents * percent) / 100
      }),
    )
  }

  /** 计划值（PV）——按基线排期线性流逝插值（D2 公式）。 */
  private plannedValueAt(tasks: TaskEarnedValueFacts[], at: DateTime): number {
    return sum(tasks.map((task) => this.taskPlannedValueAt(task, at)))
  }

  private taskPlannedValueAt(task: TaskEarnedValueFacts, at: DateTime): number {
    const { baselineCostCents: cost, plannedStart: start, plannedEnd: end } = task
    if (cost <= 0 || !start || !end) return 0
    if (at.toISODate()! < start.toISODate()!) return 0
    if (at.toISODate()! >= end.toISODate()!) return cost
    const spanDays = calendarDayDiff(start, end)
    if (spanDays <= 0) return cost
    const elapsedDays = calendarDayDiff(start, at)
    return (cost * Math.max(0, elapsedDays)) / spanDays
  }

  /**
   * 历史挣值重放：t = asOf 时恒等于当前 EV；完工任务在 actual_end_date 达 100%。
   * 无起点信息的任务按「在完工锚点一次性挣得」处理（阶梯，文档化近似）。
   */
  private earnedValueAt(tasks: TaskEarnedValueFacts[], at: DateTime, asOf: DateTime): number {
    return sum(
      tasks.map((task) => {
        const cost = task.baselineCostCents
        const percent = Math.min(100, Math.max(0, task.progressPercent))
        const finalValue = (cost * percent) / 100
        if (finalValue <= 0) return 0
        if (at.toISODate()! >= asOf.toISODate()!) return finalValue

        const rampStart = task.actualStart ?? task.plannedStart
        // 完工任务以实际完成日为爬升终点；未完工任务锚定 asOfDate
        let rampEnd = task.actualEnd
        if (!rampEnd || rampEnd.toISODate()! > asOf.toISODate()!) rampEnd = asOf

        if (!rampStart || !rampEnd) {
          return at.toISODate()! >= rampEnd.toISODate()! ? finalValue : 0
        }
        if (at.toISODate()! <= rampStart.toISODate()!) return 0
        if (at.toISODate()! >= rampEnd.toISODate()!) return finalValue
        const spanDays = calendarDayDiff(rampStart, rampEnd)
        if (spanDays <= 0) return at.toISODate()! >= rampEnd.toISODate()! ? finalValue : 0
        const elapsedDays = calendarDayDiff(rampStart, at)
        return (finalValue * elapsedDays) / spanDays
      }),
    )
  }

  /** 历史实际成本重放：与 EV 同构的线性摊分，完工后走平。 */
  private actualCostAt(tasks: TaskEarnedValueFacts[], at: DateTime, asOf: DateTime): number {
    return sum(
      tasks.map((task) => {
        const total = task.actualCostCents
        if (total <= 0) return 0
        if (at.toISODate()! >= asOf.toISODate()!) return total

        const rampStart = task.actualStart ?? task.plannedStart
        let rampEnd = task.actualEnd
        if (!rampEnd || rampEnd.toISODate()! > asOf.toISODate()!) rampEnd = asOf

        if (!rampStart || !rampEnd) {
          return at.toISODate()! >= rampEnd.toISODate()! ? total : 0
        }
        if (at.toISODate()! <= rampStart.toISODate()!) return 0
        if (at.toISODate()! >= rampEnd.toISODate()!) return total
        const spanDays = calendarDayDiff(rampStart, rampEnd)
        if (spanDays <= 0) return at.toISODate()! >= rampEnd.toISODate()! ? total : 0
        const elapsedDays = calendarDayDiff(rampStart, at)
        return (total * elapsedDays) / spanDays
      }),
    )
  }

  private deriveScheduleStatus(spi: number): EvmScheduleStatus {
    if (spi >= 1.05) return 'ahead'
    if (spi >= 0.95) return 'on_track'
    return 'delayed'
  }

  private deriveCostStatus(cpi: number): EvmCostStatus {
    if (cpi >= 1.05) return 'under_budget'
    if (cpi >= 0.95) return 'on_track'
    return 'over_budget'
  }

  // ---------------------------------------------------------------------------
  // S 曲线采样轴
  // ---------------------------------------------------------------------------

  private buildSampleAxis(data: EvmDataSource, asOf: DateTime): SampleAxis | null {
    const candidates = [
      ...data.tasks.flatMap((t) => [t.plannedStart, t.plannedEnd, t.actualStart, t.actualEnd]),
    ]
    if (data.project.startDate) candidates.push(data.project.startDate)
    if (data.project.endDate) candidates.push(data.project.endDate)
    if (data.project.actualStartDate) candidates.push(data.project.actualStartDate)
    if (data.project.actualEndDate) candidates.push(data.project.actualEndDate)

    const valid = candidates.filter((d): d is DateTime => d !== null && d.isValid)
    if (
      valid.length === 0 &&
      data.tasks.length === 0 &&
      !data.project.startDate &&
      !data.project.endDate
    ) {
      return null
    }

    const start = valid.length > 0 ? minDate(valid) : asOf
    // 终点必须覆盖 asOf：项目延期时曲线延伸到评估日
    const rawEnd = valid.length > 0 ? maxDate(valid) : asOf
    const end = rawEnd.toISODate()! < asOf.toISODate()! ? asOf : rawEnd
    const dates = this.generateSampleDates(start, end)
    return { start, end, dates }
  }

  private generateSampleDates(start: DateTime, end: DateTime): DateTime[] {
    const spanDays = calendarDayDiff(start, end)
    if (spanDays <= 0) return [start.startOf('day')]

    // 总工期 <= 30 天按日步进；> 30 天按周（7 天）步进（D2 采样粒度）
    let stepDays = spanDays <= 30 ? 1 : 7
    const maxPoints = 150
    if (Math.floor(spanDays / stepDays) + 2 > maxPoints) {
      stepDays = Math.ceil(spanDays / (maxPoints - 1))
    }

    const dates: DateTime[] = []
    let cursor = start.startOf('day')
    let guard = 0
    while (
      cursor.toISODate()! <= end.toISODate()! &&
      dates.length < maxPoints &&
      guard < maxPoints + 10
    ) {
      dates.push(cursor)
      cursor = cursor.plus({ days: stepDays })
      guard += 1
    }
    const last = dates[dates.length - 1]
    if (last && last.toISODate()! < end.toISODate()!) dates.push(end.startOf('day'))
    return dates
  }
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0)
}

function minDate(dates: DateTime[]): DateTime {
  return dates.reduce((acc, date) => (date.toMillis() < acc.toMillis() ? date : acc))
}

function maxDate(dates: DateTime[]): DateTime {
  return dates.reduce((acc, date) => (date.toMillis() > acc.toMillis() ? date : acc))
}
