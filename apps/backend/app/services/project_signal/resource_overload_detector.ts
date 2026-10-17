import ResourceLoadService from '#services/resource_load_service'
import type { ResourceLoadResult } from '#services/resource_load_service'
import { ValidationException } from '#exceptions/api_exception'
import type { SignalObservation, SignalObservationWindows } from './signal_contracts.js'
import {
  RESOURCE_OVERLOAD_COUNT_MIN,
  RESOURCE_OVERLOAD_COUNT_SIGNIFICANT,
  RESOURCE_OVERLOAD_HOURS_MIN,
  RESOURCE_OVERLOAD_RATIO_PERCENT,
  RESOURCE_OVERLOAD_RATIO_PERCENT_SIGNIFICANT,
  RESOURCE_OVERLOAD_REFERENCE_PERCENT,
  RESOURCE_PEAK_ALLOCATION_PERCENT_SIGNIFICANT,
} from './signal_thresholds.js'

/**
 * v3-triz-contradiction-copilot W3 任务 3.2 ③——资源负载过载检测器（只读）。
 *
 * 口径（spec「四类硬信号检测」第 3 条）：超载资源（分配比例 > 100%，与既有上下文包同款判定）
 * 的**占比**或其对应**超载工作量**达阈值即候选；数据走既有 `ResourceLoadService.load`，
 * 往期重放直接传上一周期 from/to（design 待核实清单第 6 项结论）。
 *
 * 证据为**团队聚合口径**（D9 ③）：只出项目级计数、占比、峰值与超载工时，
 * **不**输出 `resourceId` / `resourceName` / 任何个人维度的度量或排名。
 *
 * 只读：仅调用既有负载读取，零写入。
 */
export interface ResourceOverloadDetectorDeps {
  /** 可注入替身（单测零 DB）；缺省即既有资源负载服务。 */
  resourceLoadService?: Pick<ResourceLoadService, 'load'>
}

export interface ResourceOverloadEvaluateRequest {
  organizationId: number
  projectId: number
  windows: SignalObservationWindows
}

export interface ResourceOverloadReadings {
  resourceCount: number
  overloadedResourceCount: number
  overloadRatioPercent: number
  teamAverageUtilizationPercent: number
  peakAllocationPercent: number
  overloadedHours: number
}

export default class ResourceOverloadDetector {
  readonly #deps: ResourceOverloadDetectorDeps

  constructor(deps: ResourceOverloadDetectorDeps = {}) {
    this.#deps = deps
  }

  async evaluate(request: ResourceOverloadEvaluateRequest): Promise<SignalObservation> {
    const loadService = this.#deps.resourceLoadService ?? new ResourceLoadService()
    const [current, previous] = await Promise.all([
      this.#load(loadService, request, request.windows.current.from, request.windows.current.to),
      this.#load(loadService, request, request.windows.previous.from, request.windows.previous.to),
    ])

    const currentHit = isOverloadHit(current)
    const previousHit = isOverloadHit(previous)
    const significant = isOverloadSignificant(current)
    const completenessGap = current.resourceCount === 0 ? 'NO_ACTIVE_RESOURCES' : null

    return {
      signalType: 'resource_overload',
      triggered: currentHit,
      significant,
      fieldsComplete: completenessGap === null,
      consecutiveCycles: currentHit && previousHit ? 2 : 1,
      completenessGap,
      dataInsufficient: false,
      insufficientReason: null,
      severity: currentHit ? (significant ? 'critical' : 'warning') : 'info',
      readings: {
        metric: 'resource_allocation_overload',
        resourceCount: current.resourceCount,
        overloadedResourceCount: current.overloadedResourceCount,
        overloadRatioPercent: current.overloadRatioPercent,
        teamAverageUtilizationPercent: current.teamAverageUtilizationPercent,
        peakAllocationPercent: current.peakAllocationPercent,
        overloadedHours: current.overloadedHours,
        overloadedResourceCountPrevious: previous.overloadedResourceCount,
        overloadRatioPercentPrevious: previous.overloadRatioPercent,
        overloadedHoursPrevious: previous.overloadedHours,
        coveredCycles: 2,
      },
      thresholds: {
        referencePercent: RESOURCE_OVERLOAD_REFERENCE_PERCENT,
        ratioPercent: RESOURCE_OVERLOAD_RATIO_PERCENT,
        countMin: RESOURCE_OVERLOAD_COUNT_MIN,
        hoursMin: RESOURCE_OVERLOAD_HOURS_MIN,
        ratioPercentSignificant: RESOURCE_OVERLOAD_RATIO_PERCENT_SIGNIFICANT,
        countSignificant: RESOURCE_OVERLOAD_COUNT_SIGNIFICANT,
        peakAllocationPercentSignificant: RESOURCE_PEAK_ALLOCATION_PERCENT_SIGNIFICANT,
      },
      hitConditions: currentHit ? ['resource_overload'] : [],
      // 团队聚合口径：不引用任何个人资源实体（D9 ③）。
      entityRefs: {},
      truncated: false,
    }
  }

  async #load(
    service: Pick<ResourceLoadService, 'load'>,
    request: ResourceOverloadEvaluateRequest,
    from: string,
    to: string,
  ): Promise<ResourceOverloadReadings> {
    const raw = await service.load(request.organizationId, request.projectId, from, to, 'team')
    if (!('resources' in raw)) {
      throw new ValidationException('资源负载读数不可用')
    }
    return summarizeResourceLoad(raw as ResourceLoadResult)
  }
}

/**
 * 团队聚合汇总（纯函数，便于单测直接断言）：单资源「过载」= 窗口内存在分配比例 > 100% 的日，
 * 超载工时 = 逐日 `max(allocatedHours - capacityHours, 0)` 之和。
 */
export function summarizeResourceLoad(load: ResourceLoadResult): ResourceOverloadReadings {
  let overloadedResourceCount = 0
  let peakAllocationPercent = 0
  let overloadedHours = 0

  for (const resource of load.resources ?? []) {
    let resourcePeak = 0
    for (const day of resource.days ?? []) {
      const percent = Number(day.totalAllocatedPercent ?? 0)
      resourcePeak = Math.max(resourcePeak, percent)
      const overload = Number(day.allocatedHours ?? 0) - Number(day.capacityHours ?? 0)
      if (overload > 0) overloadedHours += overload
    }
    peakAllocationPercent = Math.max(peakAllocationPercent, resourcePeak)
    if (resourcePeak > RESOURCE_OVERLOAD_REFERENCE_PERCENT) overloadedResourceCount += 1
  }

  const resourceCount = (load.resources ?? []).length
  return {
    resourceCount,
    overloadedResourceCount,
    overloadRatioPercent:
      resourceCount > 0 ? Number(((overloadedResourceCount / resourceCount) * 100).toFixed(2)) : 0,
    teamAverageUtilizationPercent: Number(load.teamAverageUtilizationPercent ?? 0),
    peakAllocationPercent: Number(peakAllocationPercent.toFixed(2)),
    overloadedHours: Number(overloadedHours.toFixed(2)),
  }
}

/** 触发线：超载资源 ≥ 2 个，且（超载占比 ≥ 25% 或窗口内超载工时 ≥ 8 小时）。 */
export function isOverloadHit(readings: ResourceOverloadReadings): boolean {
  if (readings.overloadedResourceCount < RESOURCE_OVERLOAD_COUNT_MIN) return false
  return (
    readings.overloadRatioPercent >= RESOURCE_OVERLOAD_RATIO_PERCENT ||
    readings.overloadedHours >= RESOURCE_OVERLOAD_HOURS_MIN
  )
}

/** 显著档：超载资源 ≥ 3 个，且（超载占比 ≥ 50% 或单资源峰值分配 ≥ 150%）。 */
export function isOverloadSignificant(readings: ResourceOverloadReadings): boolean {
  if (readings.overloadedResourceCount < RESOURCE_OVERLOAD_COUNT_SIGNIFICANT) return false
  return (
    readings.overloadRatioPercent >= RESOURCE_OVERLOAD_RATIO_PERCENT_SIGNIFICANT ||
    readings.peakAllocationPercent >= RESOURCE_PEAK_ALLOCATION_PERCENT_SIGNIFICANT
  )
}
