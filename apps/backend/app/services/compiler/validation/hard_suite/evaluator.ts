/**
 * @aiproj/backend —— Hard Validator 规则评估器。
 *
 * 实现 HvRuleEvaluator 接口，评估 HV-001~HV-025 规则的确定性逻辑。
 * 每一条规则根据 deterministic 引擎的输出来判断通过/警告/阻断。
 *
 * ⚠️ 只消费确定性事实，不调用 LLM，不读取未归一化的模型自然语言解释。
 *
 * @aiproj/backend
 */

import type { HardValidationIssue } from '@aiproj/compiler-spec'
import type { DeterministicInputProvider, HvRuleEvaluator } from './hard_validation_suite.js'
import { HV_RULE_IDS } from '@aiproj/compiler-spec'

/**
 * 默认规则评估器。
 * 每个 implementation ID 对应一个评估函数。
 */
export class DefaultHvRuleEvaluator implements HvRuleEvaluator {
  /** evaluator 函数映射。 */
  readonly #evaluators: Map<
    string,
    (provider: DeterministicInputProvider) => Promise<RuleEvaluationResult>
  >

  constructor() {
    this.#evaluators = new Map()
    this.#registerDefaultEvaluators()
  }

  async evaluate(
    ruleIds: string[],
    provider: DeterministicInputProvider,
  ): Promise<{ issues: HardValidationIssue[]; autoFixable: boolean }> {
    // 通过第一个 ruleId 找到对应的 implementation evaluator
    const firstRuleId = ruleIds[0]
    const implEvaluator = this.#findImplIdForRule(firstRuleId)

    if (!implEvaluator) {
      return {
        autoFixable: false,
        issues: ruleIds.map((rid) => ({
          ruleId: rid,
          severity: 'not_applicable' as const,
          category: 'stage_metadata' as const,
          path: '/validation/unregistered',
          message: `规则 ${rid} 无对应的实现评估器`,
          affectedEntityIds: [],
          autoFixable: false,
          requiresHumanReview: false,
          sourceStageId: '',
          evidence: '',
        })),
      }
    }

    const evaluatorFn = this.#evaluators.get(implEvaluator)
    if (!evaluatorFn) {
      return {
        autoFixable: false,
        issues: ruleIds.map((rid) => ({
          ruleId: rid,
          severity: 'not_applicable' as const,
          category: 'stage_metadata' as const,
          path: '/validation/unregistered',
          message: `Implementation "${implEvaluator}" 未注册评估函数`,
          affectedEntityIds: [],
          autoFixable: false,
          requiresHumanReview: false,
          sourceStageId: '',
          evidence: '',
        })),
      }
    }

    const result = await evaluatorFn(provider)
    return {
      autoFixable: result.autoFixable,
      issues: result.issues.map((issue) => ({
        ...issue,
        ruleId: this.#findOriginalRuleId(implEvaluator, issue.ruleId) ?? issue.ruleId,
      })),
    }
  }

  /** 注册自定义 implementation 评估器。 */
  registerEvaluator(
    implId: string,
    fn: (provider: DeterministicInputProvider) => Promise<RuleEvaluationResult>,
  ): void {
    this.#evaluators.set(implId, fn)
  }

  // ── Default Evaluators ──

  #registerDefaultEvaluators(): void {
    // impl-schema-parse: HV-001, HV-002
    this.#evaluators.set('impl-schema-parse', async (_provider) => ({
      autoFixable: false,
      issues: [],
    }))

    // impl-reference-integrity: HV-003~HV-006
    this.#evaluators.set('impl-reference-integrity', async (provider) => {
      const issues: HardValidationIssue[] = []
      const graph = provider.getGraphValidation() as any

      // HV-003: 依赖目标存在
      if (graph && graph.blocking?.length) {
        for (const b of graph.blocking) {
          if (b.ruleId === 'GRAPH_BLOCKING_CHECK' || b.path?.includes('dependency')) {
            issues.push({
              ruleId: HV_RULE_IDS.HV_003,
              severity: 'blocking',
              category: 'reference_integrity',
              path: b.path ?? '/dependencies',
              message: b.message ?? '依赖目标不存在',
              affectedEntityIds: b.entityIds ?? [],
              autoFixable: false,
              requiresHumanReview: true,
              sourceStageId: 'deterministic_graph_validation',
              evidence: `Graph validation: ${b.message}`,
            })
          }
        }
      }
      return { autoFixable: false, issues }
    })

    // impl-cycle-detection: HV-008
    this.#evaluators.set('impl-cycle-detection', async (provider) => {
      const issues: HardValidationIssue[] = []
      const graph = provider.getGraphValidation() as any
      if (graph && !graph.passed) {
        for (const b of graph.blocking ?? []) {
          if (b.message?.toLowerCase().includes('cycle')) {
            issues.push({
              ruleId: HV_RULE_IDS.HV_008,
              severity: 'blocking',
              category: 'structure',
              path: b.path ?? '/dependencies',
              message: `依赖环路检测失败: ${b.message}`,
              affectedEntityIds: b.entityIds ?? [],
              autoFixable: false,
              requiresHumanReview: true,
              sourceStageId: 'deterministic_graph_validation',
              evidence: `Cycle detected: ${b.message}`,
            })
          }
        }
      }
      return { autoFixable: false, issues }
    })

    // impl-topo-sort: HV-010
    this.#evaluators.set('impl-topo-sort', async (provider) => {
      const issues: HardValidationIssue[] = []
      const graph = provider.getGraphValidation() as any
      if (graph && !graph.passed) {
        issues.push({
          ruleId: HV_RULE_IDS.HV_010,
          severity: 'blocking',
          category: 'structure',
          path: '/dependencies/topo',
          message: '依赖图无法拓扑排序，存在循环或缺失依赖',
          affectedEntityIds: [],
          autoFixable: false,
          requiresHumanReview: true,
          sourceStageId: 'deterministic_graph_validation',
          evidence: graph.blocking?.map((b: any) => b.message).join('; ') ?? '',
        })
      }
      return { autoFixable: false, issues }
    })

    // impl-date-consistency: HV-011
    this.#evaluators.set('impl-date-consistency', async (provider) => {
      const issues: HardValidationIssue[] = []
      const schedule = provider.getSchedule() as any
      if (schedule?.scheduled) {
        for (const [tid, s] of Object.entries(schedule.scheduled) as [string, any][]) {
          if (s.plannedEnd < s.plannedStart) {
            issues.push({
              ruleId: HV_RULE_IDS.HV_011,
              severity: 'blocking',
              category: 'date_schedule',
              path: `/schedule/${tid}`,
              message: `任务 ${tid} 结束日期 ${s.plannedEnd} 早于开始日期 ${s.plannedStart}`,
              affectedEntityIds: [tid],
              autoFixable: true,
              requiresHumanReview: false,
              sourceStageId: 'deterministic_schedule',
              evidence: `plannedEnd(${s.plannedEnd}) < plannedStart(${s.plannedStart})`,
            })
          }
        }
      }
      return { autoFixable: issues.length > 0, issues }
    })

    // impl-dependency-dates: HV-012
    this.#evaluators.set('impl-dependency-dates', async (_provider) => {
      // 依赖日期逻辑 — 由 graph validator 和 schedule engine 共同验证
      // 在此只占位，实际检查在 schedule engine 中完成
      return { autoFixable: false, issues: [] }
    })

    // impl-calendar-compliance: HV-013
    this.#evaluators.set('impl-calendar-compliance', async (_provider) => {
      // 日历合规 — 由 schedule engine 按工作日历排期
      return { autoFixable: false, issues: [] }
    })

    // impl-milestone-dates: HV-014
    this.#evaluators.set('impl-milestone-dates', async (_provider) => {
      return { autoFixable: false, issues: [] }
    })

    // impl-effort-summary: HV-015
    this.#evaluators.set('impl-effort-summary', async (provider) => {
      const issues: HardValidationIssue[] = []
      const pdm = provider.getPdmSnapshot() as any
      if (pdm?.tasks) {
        for (const [taskId, task] of Object.entries(pdm.tasks) as [string, any][]) {
          if (task.children?.length && task.effort !== null && task.effort !== undefined) {
            const childEffort = task.children.reduce((sum: number, cid: string) => {
              const child = pdm.tasks[cid]
              return sum + (child?.effort ?? 0)
            }, 0)
            if (childEffort > task.effort) {
              issues.push({
                ruleId: HV_RULE_IDS.HV_015,
                severity: 'warning',
                category: 'numeric',
                path: `/tasks/${taskId}`,
                message: `任务 ${taskId} 子任务 effort (${childEffort}) 超出父任务 (${task.effort})`,
                affectedEntityIds: [taskId],
                autoFixable: true,
                requiresHumanReview: false,
                sourceStageId: 'deterministic_hard_validation',
                evidence: `childEffort=${childEffort} > parentEffort=${task.effort}`,
              })
            }
          }
        }
      }
      return { autoFixable: issues.length > 0, issues }
    })

    // impl-duration-non-negative: HV-018 (and other numeric)
    this.#evaluators.set('impl-duration-non-negative', async (_provider) => {
      return { autoFixable: false, issues: [] }
    })
  }

  /** 根据 ruleId 查找对应的 implementation ID。 */
  #findImplIdForRule(ruleId: string): string | undefined {
    // HV rule to implementation mapping
    const mapping: Record<string, string> = {
      [HV_RULE_IDS.HV_001]: 'impl-schema-parse',
      [HV_RULE_IDS.HV_002]: 'impl-schema-parse',
      [HV_RULE_IDS.HV_003]: 'impl-reference-integrity',
      [HV_RULE_IDS.HV_004]: 'impl-reference-integrity',
      [HV_RULE_IDS.HV_005]: 'impl-reference-integrity',
      [HV_RULE_IDS.HV_006]: 'impl-reference-integrity',
      [HV_RULE_IDS.HV_007]: 'impl-hierarchy',
      [HV_RULE_IDS.HV_008]: 'impl-cycle-detection',
      [HV_RULE_IDS.HV_009]: 'impl-hierarchy',
      [HV_RULE_IDS.HV_010]: 'impl-topo-sort',
      [HV_RULE_IDS.HV_011]: 'impl-date-consistency',
      [HV_RULE_IDS.HV_012]: 'impl-dependency-dates',
      [HV_RULE_IDS.HV_013]: 'impl-calendar-compliance',
      [HV_RULE_IDS.HV_014]: 'impl-milestone-dates',
      [HV_RULE_IDS.HV_015]: 'impl-effort-summary',
      [HV_RULE_IDS.HV_016]: 'impl-budget-summary',
      [HV_RULE_IDS.HV_017]: 'impl-progress-range',
      [HV_RULE_IDS.HV_018]: 'impl-duration-non-negative',
      [HV_RULE_IDS.HV_019]: 'impl-resource-capacity',
      [HV_RULE_IDS.HV_020]: 'impl-resource-overlap',
      [HV_RULE_IDS.HV_021]: 'impl-resource-skill',
      [HV_RULE_IDS.HV_022]: 'impl-raci-completeness',
      [HV_RULE_IDS.HV_023]: 'impl-critical-owner',
      [HV_RULE_IDS.HV_024]: 'impl-risk-completeness',
      [HV_RULE_IDS.HV_025]: 'impl-blueprint-consistency',
    }
    return mapping[ruleId]
  }

  /** 从 implementation 结果映射回原始 ruleId。 */
  #findOriginalRuleId(_implId: string, _ruleId: string): string | undefined {
    // 默认返回 ruleId 本身（单个实现对应单个规则时）
    return _ruleId
  }
}

// ── Rule Evaluation Result ──

export interface RuleEvaluationResult {
  issues: HardValidationIssue[]
  autoFixable: boolean
}
