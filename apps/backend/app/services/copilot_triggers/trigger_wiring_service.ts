/**
 * v3-copilot-proactive-triggers-and-fatigue-control §5 — 事件与巡检接线
 *
 * 核心设计纪律：
 * - 事件订阅接线：复用既有广播与审计流水
 * - 事件按 (归属, problemKind, 窗口) 合并后再评估（批量事件不逐条评估）
 * - 定时巡检注册：复用既有周期作业范式
 * - 巡检幂等键由 (ruleId, 归属, 巡检窗口) 推导
 * - 单个来源不可用时降级：跳过该来源规则并记录，不失败整轮
 * - 触发耗时与命中率的低敏计数
 *
 * 与既有能力的分工：
 * - TriggerRuleEvaluator：纯函数规则求值（§3）
 * - FatigueControlService：疲劳状态与窗口计数（§4）
 * - SourceSnapshotAdapter：来源快照读取（复用五来源既有路径）
 * - 本服务：事件折叠、调度协调、决策记录构建、指标计数
 *
 * 不做的事（Non-Goals）：
 * - 不创建任何建议算法或判定逻辑（五来源已交付）
 * - 不执行任何投递（通知、推送、外部请求）
 * - 不引入队列、定时器中间件或外部调度器
 */

import type {
  TriggerRule,
  TriggerEventRule,
  TriggerScheduleRule,
  TriggerDecisionRecord,
  TriggerEventKind,
} from '@aiproj/types'
import type { InboxProblemKind, InboxSourceKind } from '@aiproj/types'
import type {
  InjectedClock,
  TriggerEventInput,
  TriggerSweepInput,
  SourceSnapshot,
  FatigueState,
  RuleEvaluationResult,
} from './trigger_rule_evaluator.js'
import { TriggerRuleEvaluator } from './trigger_rule_evaluator.js'
import type { FatigueWindowConfig } from '@aiproj/types'
import type { FatigueControlService } from './fatigue_control_service.js'

// ---------------------------------------------------------------------------
// 来源快照适配器接口
// ---------------------------------------------------------------------------

/**
 * 来源快照适配器：规则求值时读取五来源的产出状态。
 * 复用既有来源的产出读取路径，不复制判定逻辑。
 */
export interface SourceSnapshotAdapter {
  /**
   * 获取指定来源在指定归属/项目上下文下的快照。
   * 来源不可用时返回 { available: false }，不抛异常。
   */
  getSnapshot(params: {
    sourceKind: InboxSourceKind
    organizationId: string
    projectId: string
    actorId: string
  }): Promise<SourceSnapshot>
}

// ---------------------------------------------------------------------------
// 低敏计数器
// ---------------------------------------------------------------------------

/**
 * 触发耗时与命中率的低敏计数。
 * 不含任何敏感信息（无规则 ID 列表、无归属 ID、无去重键）。
 */
export class TriggerMetricsCounter {
  #evaluations = 0
  #hits = 0
  #suppressions = 0
  #totalDurationMs = 0

  /** 记录一次规则求值（命中或抑制）。 */
  recordEvaluation(durationMs: number, matched: boolean, suppressed: boolean): void {
    this.#evaluations++
    this.#totalDurationMs += durationMs
    if (matched) this.#hits++
    if (suppressed) this.#suppressions++
  }

  /** 获取当前计数快照（低敏，不含归属 ID 或规则详情）。 */
  snapshot(): TriggerMetricsSnapshot {
    return {
      evaluations: this.#evaluations,
      hits: this.#hits,
      suppressions: this.#suppressions,
      totalDurationMs: this.#totalDurationMs,
      hitRate: this.#evaluations > 0 ? this.#hits / this.#evaluations : 0,
      avgDurationMs: this.#evaluations > 0 ? this.#totalDurationMs / this.#evaluations : 0,
    }
  }

  /** 重置所有计数（用于窗口切换或测试）。 */
  reset(): void {
    this.#evaluations = 0
    this.#hits = 0
    this.#suppressions = 0
    this.#totalDurationMs = 0
  }
}

/**
 * 低敏计数快照（供后续观测消费）。
 */
export interface TriggerMetricsSnapshot {
  /** 累计求值次数 */
  evaluations: number
  /** 累计命中次数 */
  hits: number
  /** 累计抑制次数 */
  suppressions: number
  /** 累计耗时（毫秒） */
  totalDurationMs: number
  /** 命中率 */
  hitRate: number
  /** 平均单次求值耗时（毫秒） */
  avgDurationMs: number
}

// ---------------------------------------------------------------------------
// 事件折叠键
// ---------------------------------------------------------------------------

/**
 * 事件折叠键：按 (actorId, problemKind, 窗口) 合并。
 * 同一折叠键的多个事件只评估一次，避免批量事件逐条评估。
 */
interface EventCollapseKey {
  actorId: string
  problemKind: InboxProblemKind
  /** 时间窗口标识：将 occurredAt 截断到固定粒度（默认 1 小时） */
  windowBucket: string
}

/**
 * 折叠后的事件组：一组共享相同 (actorId, problemKind, 窗口) 的事件。
 */
interface CollapsedEventGroup {
  /** 折叠键 */
  key: EventCollapseKey
  /** 该组中的所有原始事件输入 */
  events: TriggerEventInput[]
  /** 该组使用的第一条事件（用于元数据提取） */
  primary: TriggerEventInput
}

// ---------------------------------------------------------------------------
// 折叠窗口粒度
// ---------------------------------------------------------------------------

/**
 * 默认折叠窗口粒度（毫秒）。
 * 同一 actorId + problemKind + 此粒度内的所有事件合并为一条评估。
 * 1 小时 = 3,600,000 ms
 */
const DEFAULT_COLLAPSE_WINDOW_MS = 60 * 60 * 1000

/**
 * 巡检幂等键推导：(ruleId, actorId, sweepWindow)。
 */
function deriveSweepIdempotencyKey(ruleId: string, actorId: string, sweepWindow: string): string {
  return `${ruleId}::${actorId}::${sweepWindow}`
}

// ---------------------------------------------------------------------------
// 触发接线服务
// ---------------------------------------------------------------------------

export class TriggerWiringService {
  readonly #rules: TriggerRule[]
  readonly #evaluator: TriggerRuleEvaluator
  readonly #fatigueService: FatigueControlService
  readonly #sourceAdapter: SourceSnapshotAdapter
  readonly #clock: InjectedClock
  readonly #metrics: TriggerMetricsCounter
  readonly #collapseWindowMs: number

  constructor(deps: {
    rules: TriggerRule[]
    evaluator: TriggerRuleEvaluator
    fatigueService: FatigueControlService
    sourceAdapter: SourceSnapshotAdapter
    clock: InjectedClock
    collapseWindowMs?: number
  }) {
    this.#rules = deps.rules
    this.#evaluator = deps.evaluator
    this.#fatigueService = deps.fatigueService
    this.#sourceAdapter = deps.sourceAdapter
    this.#clock = deps.clock
    this.#metrics = new TriggerMetricsCounter()
    this.#collapseWindowMs = deps.collapseWindowMs ?? DEFAULT_COLLAPSE_WINDOW_MS
  }

  // -----------------------------------------------------------------------
  // 事件处理（§5.1, §5.2）
  // -----------------------------------------------------------------------

  /**
   * 处理单个或批量事件：折叠 → 评估 → 记录。
   *
   * 折叠策略：按 (actorId, problemKind, 时间窗口桶) 合并。
   * 同一折叠键的事件只评估一次，避免批量事件逐条评估。
   *
   * @param input 事件输入
   * @param opts 可选：覆盖规则列表、预填充去重键集合
   * @returns 触发决策记录列表（每条规则一个结果）
   */
  async handleEvent(
    input: TriggerEventInput,
    opts?: {
      rules?: TriggerRule[]
      existingDedupeKeys?: Set<string>
      existingSweepKeys?: Set<string>
    },
  ): Promise<TriggerWiringResult> {
    const rules = opts?.rules ?? this.#rules
    const eventRules = rules.filter((r): r is TriggerEventRule => r.source === 'event')
    const dedupeKeys = opts?.existingDedupeKeys ?? new Set<string>()
    const sweepKeys = opts?.existingSweepKeys ?? new Set<string>()

    // 1. 按折叠键分组（此处只有一个事件，但仍经过折叠逻辑以保持一致性）
    const groups = this.#collapseEvents([input])

    return this.#evaluateEventGroups(groups, eventRules, dedupeKeys, sweepKeys)
  }

  /**
   * 处理批量事件：折叠后按组评估。
   *
   * 核心约束：多个事件如果共享相同的 (actorId, problemKind, 窗口)，
   * 只评估一次而非逐条评估。
   *
   * @param inputs 事件输入列表
   * @param opts 可选：覆盖规则列表、预填充去重键集合
   * @returns 触发决策记录列表
   */
  async handleBatchEvents(
    inputs: TriggerEventInput[],
    opts?: {
      rules?: TriggerRule[]
      existingDedupeKeys?: Set<string>
      existingSweepKeys?: Set<string>
    },
  ): Promise<TriggerWiringResult> {
    const rules = opts?.rules ?? this.#rules
    const eventRules = rules.filter((r): r is TriggerEventRule => r.source === 'event')
    const dedupeKeys = opts?.existingDedupeKeys ?? new Set<string>()
    const sweepKeys = opts?.existingSweepKeys ?? new Set<string>()

    // 1. 折叠事件（§5.2：批量事件不逐条评估）
    const groups = this.#collapseEvents(inputs)

    return this.#evaluateEventGroups(groups, eventRules, dedupeKeys, sweepKeys)
  }

  // -----------------------------------------------------------------------
  // 定时巡检处理（§5.4, §5.5）
  // -----------------------------------------------------------------------

  /**
   * 处理定时巡检：评估所有匹配的定时规则。
   *
   * 巡检幂等键由 (ruleId, actorId, sweepWindow) 推导（§5.5）。
   * 同一窗口重复执行不产生重复条目。
   *
   * @param input 巡检输入
   * @param opts 可选：覆盖规则列表、预填充去重键集合
   * @returns 触发决策记录列表
   */
  async handleSweep(
    input: TriggerSweepInput,
    opts?: {
      rules?: TriggerRule[]
      existingDedupeKeys?: Set<string>
      existingSweepKeys?: Set<string>
    },
  ): Promise<TriggerWiringResult> {
    const rules = opts?.rules ?? this.#rules
    const scheduleRules = rules.filter((r): r is TriggerScheduleRule => r.source === 'schedule')
    const dedupeKeys = opts?.existingDedupeKeys ?? new Set<string>()
    const sweepKeys = opts?.existingSweepKeys ?? new Set<string>()

    const decisions: TriggerDecisionRecord[] = []
    const sourceUnavailable: InboxSourceKind[] = []

    for (const rule of scheduleRules) {
      const startTime = this.#clock.nowMs()

      try {
        // 1. 获取来源快照
        const sourceSnapshot = await this.#sourceAdapter.getSnapshot({
          sourceKind: rule.inboxSourceKind,
          organizationId: input.organizationId,
          projectId: input.projectId,
          actorId: input.actorId,
        })

        // 2. 来源不可用时降级（§5.7：跳过该来源规则并记录，不失败整轮）
        if (!sourceSnapshot.available) {
          sourceUnavailable.push(rule.inboxSourceKind)
          const evaluationDurationMs = this.#clock.nowMs() - startTime

          const record = this.#fatigueService.buildDecisionRecord({
            organizationId: input.organizationId,
            projectId: input.projectId,
            ruleId: rule.ruleId,
            actorId: input.actorId,
            outcome: 'source_unavailable',
            suppressionReason: 'source_unavailable',
            severity: rule.severity,
            problemKind: rule.problemKind,
            inboxSourceKind: rule.inboxSourceKind,
            windowKindCount: 0,
            windowGlobalCount: 0,
            kindCap: 0,
            globalCap: 0,
            kindCapExempt: false,
            timezoneFallback: false,
            frequencyReduced: false,
            sweepWindow: input.sweepWindow,
          })

          this.#metrics.recordEvaluation(evaluationDurationMs, false, true)
          decisions.push(record)
          continue
        }

        // 3. 获取疲劳状态
        const fatigueConfig = await this.#fatigueService.resolveWindowConfig({
          organizationId: input.organizationId,
          userId: input.actorId,
        })

        const fatigueState = await this.#fatigueService.getFatigueState({
          actorId: input.actorId,
          problemKind: rule.problemKind,
          organizationId: input.organizationId,
          windowConfig: fatigueConfig,
        })

        // 4. 构建已存在的去重键（含巡检幂等键）
        const effectiveDedupeKeys = new Set(dedupeKeys)
        const sweepKey = deriveSweepIdempotencyKey(rule.ruleId, input.actorId, input.sweepWindow)
        const effectiveSweepKeys = new Set(sweepKeys)
        effectiveSweepKeys.add(sweepKey)

        // 5. 求值规则
        const result = this.#evaluator.evaluateScheduleRule(
          rule,
          input,
          [sourceSnapshot],
          fatigueState,
          fatigueConfig,
          effectiveDedupeKeys,
          effectiveSweepKeys,
        )

        const evaluationDurationMs = this.#clock.nowMs() - startTime
        this.#metrics.recordEvaluation(
          evaluationDurationMs,
          result.matched,
          result.outcome === 'suppressed',
        )

        // 6. 构建决策记录
        const record = this.#buildDecisionFromEvaluation(
          result,
          input.organizationId,
          input.projectId,
          input.actorId,
          fatigueConfig,
          fatigueState,
          input.sweepWindow,
        )
        decisions.push(record)
      } catch (error) {
        // §5.7：单个来源不可用时降级，不失败整轮
        // 记录来源不可用并继续处理下一条规则
        const evaluationDurationMs = this.#clock.nowMs() - startTime
        this.#metrics.recordEvaluation(evaluationDurationMs, false, true)

        const record = this.#fatigueService.buildDecisionRecord({
          organizationId: input.organizationId,
          projectId: input.projectId,
          ruleId: rule.ruleId,
          actorId: input.actorId,
          outcome: 'source_unavailable',
          suppressionReason: 'source_unavailable',
          severity: rule.severity,
          problemKind: rule.problemKind,
          inboxSourceKind: rule.inboxSourceKind,
          windowKindCount: 0,
          windowGlobalCount: 0,
          kindCap: 0,
          globalCap: 0,
          kindCapExempt: false,
          timezoneFallback: false,
          frequencyReduced: false,
          sweepWindow: input.sweepWindow,
        })
        decisions.push(record)
      }
    }

    return { decisions, sourceUnavailable }
  }

  // -----------------------------------------------------------------------
  // 指标查询
  // -----------------------------------------------------------------------

  /**
   * 获取触发耗时与命中率的低敏计数快照。
   * 不含归属 ID 或规则详情，供后续观测消费。
   */
  getMetrics(): TriggerMetricsSnapshot {
    return this.#metrics.snapshot()
  }

  /** 重置指标计数（窗口切换或测试用）。 */
  resetMetrics(): void {
    this.#metrics.reset()
  }

  // -----------------------------------------------------------------------
  // 内部实现
  // -----------------------------------------------------------------------

  /**
   * 折叠事件：按 (actorId, problemKind, 时间窗口桶) 合并。
   * 同一折叠键的事件只评估一次（§5.2）。
   */
  #collapseEvents(inputs: TriggerEventInput[]): CollapsedEventGroup[] {
    const groupMap = new Map<string, CollapsedEventGroup>()

    for (const input of inputs) {
      const windowBucket = this.#computeWindowBucket(input.occurredAt)
      const key: EventCollapseKey = {
        actorId: input.actorId,
        problemKind: this.#inferProblemKind(input.eventKind),
        windowBucket,
      }
      const mapKey = `${key.actorId}::${key.problemKind}::${key.windowBucket}`

      const existing = groupMap.get(mapKey)
      if (existing) {
        existing.events.push(input)
      } else {
        groupMap.set(mapKey, {
          key,
          events: [input],
          primary: input,
        })
      }
    }

    return Array.from(groupMap.values())
  }

  /**
   * 按组评估事件规则。
   * 每个折叠组只评估一次，避免批量事件逐条评估。
   */
  async #evaluateEventGroups(
    groups: CollapsedEventGroup[],
    eventRules: TriggerEventRule[],
    dedupeKeys: Set<string>,
    _sweepKeys: Set<string>,
  ): Promise<TriggerWiringResult> {
    const decisions: TriggerDecisionRecord[] = []
    const sourceUnavailable: InboxSourceKind[] = []

    for (const group of groups) {
      // 查找匹配该事件种类的规则
      const matchingRules = eventRules.filter((r) => r.eventKind === group.primary.eventKind)

      for (const rule of matchingRules) {
        const startTime = this.#clock.nowMs()

        try {
          // 1. 获取来源快照
          const sourceSnapshot = await this.#sourceAdapter.getSnapshot({
            sourceKind: rule.inboxSourceKind,
            organizationId: group.primary.organizationId,
            projectId: group.primary.projectId,
            actorId: group.primary.actorId,
          })

          // 2. 来源不可用时降级（§5.7：跳过该来源规则并记录，不失败整轮）
          if (!sourceSnapshot.available) {
            sourceUnavailable.push(rule.inboxSourceKind)
            const evaluationDurationMs = this.#clock.nowMs() - startTime

            const record = this.#fatigueService.buildDecisionRecord({
              organizationId: group.primary.organizationId,
              projectId: group.primary.projectId,
              ruleId: rule.ruleId,
              actorId: group.primary.actorId,
              outcome: 'source_unavailable',
              suppressionReason: 'source_unavailable',
              severity: rule.severity,
              problemKind: rule.problemKind,
              inboxSourceKind: rule.inboxSourceKind,
              windowKindCount: 0,
              windowGlobalCount: 0,
              kindCap: 0,
              globalCap: 0,
              kindCapExempt: false,
              timezoneFallback: false,
              frequencyReduced: false,
              eventKind: group.primary.eventKind as TriggerEventKind,
            })

            this.#metrics.recordEvaluation(evaluationDurationMs, false, true)
            decisions.push(record)
            continue
          }

          // 3. 获取疲劳状态
          const fatigueConfig = await this.#fatigueService.resolveWindowConfig({
            organizationId: group.primary.organizationId,
            userId: group.primary.actorId,
          })

          const fatigueState = await this.#fatigueService.getFatigueState({
            actorId: group.primary.actorId,
            problemKind: rule.problemKind,
            organizationId: group.primary.organizationId,
            windowConfig: fatigueConfig,
          })

          // 4. 求值规则（折叠后每个组只评估一次）
          const result = this.#evaluator.evaluateEventRule(
            rule,
            group.primary,
            [sourceSnapshot],
            fatigueState,
            fatigueConfig,
            dedupeKeys,
          )

          const evaluationDurationMs = this.#clock.nowMs() - startTime
          this.#metrics.recordEvaluation(
            evaluationDurationMs,
            result.matched,
            result.outcome === 'suppressed',
          )

          // 5. 构建决策记录
          const record = this.#buildDecisionFromEvaluation(
            result,
            group.primary.organizationId,
            group.primary.projectId,
            group.primary.actorId,
            fatigueConfig,
            fatigueState,
            undefined, // event rules don't have sweepWindow
            group.primary.eventKind as TriggerEventKind,
          )
          decisions.push(record)
        } catch (error) {
          // §5.7：单个来源不可用时降级，不失败整轮
          const evaluationDurationMs = this.#clock.nowMs() - startTime
          this.#metrics.recordEvaluation(evaluationDurationMs, false, true)

          const record = this.#fatigueService.buildDecisionRecord({
            organizationId: group.primary.organizationId,
            projectId: group.primary.projectId,
            ruleId: rule.ruleId,
            actorId: group.primary.actorId,
            outcome: 'source_unavailable',
            suppressionReason: 'source_unavailable',
            severity: rule.severity,
            problemKind: rule.problemKind,
            inboxSourceKind: rule.inboxSourceKind,
            windowKindCount: 0,
            windowGlobalCount: 0,
            kindCap: 0,
            globalCap: 0,
            kindCapExempt: false,
            timezoneFallback: false,
            frequencyReduced: false,
            eventKind: group.primary.eventKind as TriggerEventKind,
          })
          decisions.push(record)
        }
      }
    }

    return { decisions, sourceUnavailable }
  }

  /**
   * 从求值结果构建决策记录（§5.9：低敏计数与记录）。
   */
  #buildDecisionFromEvaluation(
    result: RuleEvaluationResult,
    organizationId: string,
    projectId: string,
    actorId: string,
    fatigueConfig: FatigueWindowConfig,
    fatigueState: FatigueState & { timezoneFallback: boolean },
    sweepWindow?: string,
    eventKind?: TriggerEventKind,
  ): TriggerDecisionRecord {
    const kindCapExempt = result.severity === 'critical' && result.outcome !== 'suppressed'

    return this.#fatigueService.buildDecisionRecord({
      organizationId,
      projectId,
      ruleId: result.ruleId,
      actorId,
      outcome: result.outcome,
      suppressionReason: result.suppressionReason,
      severity: result.severity,
      problemKind: result.problemKind,
      inboxSourceKind: result.inboxSourceKind,
      windowKindCount: fatigueState.kindCount,
      windowGlobalCount: fatigueState.globalCount,
      kindCap: fatigueConfig.perKindCap,
      globalCap: fatigueConfig.globalCap,
      kindCapExempt,
      timezoneFallback: fatigueState.timezoneFallback,
      frequencyReduced: fatigueState.frequencyReduced,
      eventKind,
      sweepWindow,
    })
  }

  /**
   * 计算时间窗口桶：将 occurredAt 截断到固定粒度（默认 1 小时）。
   * 用于事件折叠键。
   */
  #computeWindowBucket(occurredAt: string): string {
    const ts = new Date(occurredAt).getTime()
    const bucket = Math.floor(ts / this.#collapseWindowMs)
    return String(bucket)
  }

  /**
   * 从事件种类推断问题种类（用于折叠键）。
   * 同一事件种类映射到同一问题种类，保证折叠正确。
   */
  #inferProblemKind(eventKind: string): InboxProblemKind {
    // 事件种类 → 问题种类的映射与规则注册表一致
    const mapping: Record<string, InboxProblemKind> = {
      task_overdue: 'schedule_risk',
      dependency_changed: 'dependency_block',
      resource_overload: 'resource_overload',
      milestone_risk: 'milestone_pressure',
      change_request_submitted: 'scope_change_impact',
    }
    return mapping[eventKind] ?? 'other'
  }
}

// ---------------------------------------------------------------------------
// 接线结果
// ---------------------------------------------------------------------------

/**
 * 触发接线结果（事件处理或巡检处理的输出）。
 */
export interface TriggerWiringResult {
  /** 决策记录列表（每条规则一个结果，含命中、抑制、不匹配、来源不可用） */
  decisions: TriggerDecisionRecord[]
  /** 不可用的来源列表（降级标注，不静默省略） */
  sourceUnavailable: InboxSourceKind[]
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建触发接线服务实例（方便依赖注入）。
 */
export function createTriggerWiringService(deps: {
  rules?: TriggerRule[]
  evaluator?: TriggerRuleEvaluator
  fatigueService: FatigueControlService
  sourceAdapter: SourceSnapshotAdapter
  clock: InjectedClock
  collapseWindowMs?: number
}): TriggerWiringService {
  return new TriggerWiringService({
    rules: deps.rules ?? [],
    evaluator: deps.evaluator ?? new TriggerRuleEvaluator(),
    fatigueService: deps.fatigueService,
    sourceAdapter: deps.sourceAdapter,
    clock: deps.clock,
    collapseWindowMs: deps.collapseWindowMs,
  })
}
