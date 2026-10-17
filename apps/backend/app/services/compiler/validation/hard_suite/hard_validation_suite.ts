/**
 * @aiproj/backend —— HardValidationSuite：确定性规则执行套件。
 *
 * 消费 deterministic engine 的输出（schema parse、graph、schedule、critical path、
 * resource load、diff、stage metadata），不调用 LLM。
 * 支持全量校验和增量校验入口。
 *
 * 结果归一化：
 * - not_applicable：规则不适用当前 profile
 * - input_missing：所需确定性输入缺失
 * - passed：规则通过
 * - warning：规则产生警告
 * - blocking：规则产生阻断
 *
 * @aiproj/backend
 */

import type {
  V2HardValidationReport,
  HardValidationInputSignature,
  HardValidationIssue,
  HardValidationNotApplicable,
} from '@aiproj/compiler-spec'
import { type HvRuleRegistry } from '../registry/hv_registry.js'

// ── Deterministic Input Interface ──

/**
 * Deterministic 引擎输出的接口抽象。
 * 接入 deterministic baseline 时通过此接口获取事实。
 * 若接口未完成，用 HardValidationSuite 自带的 fixture adapter 保持可编译和测试。
 */
export interface DeterministicInputProvider {
  /** 是否所有必需输入可用。 */
  allRequiredAvailable(ruleIds: string[]): boolean
  /** 获取 graph validation 结果。 */
  getGraphValidation(): unknown
  /** 获取 schedule 结果。 */
  getSchedule(): unknown
  /** 获取 critical path 结果。 */
  getCriticalPath(): unknown
  /** 获取 resource load 结果。 */
  getResourceLoad(): unknown
  /** 获取 diff 结果。 */
  getDiff(): unknown
  /** 获取 PDM snapshot。 */
  getPdmSnapshot(): unknown
}

// ── Input Signature Builder ──

function buildInputSignature(provider: DeterministicInputProvider): HardValidationInputSignature {
  return {
    schemaParsed: true,
    graphAvailable: !!provider.getGraphValidation(),
    scheduleAvailable: !!provider.getSchedule(),
    criticalPathAvailable: !!provider.getCriticalPath(),
    resourceLoadAvailable: !!provider.getResourceLoad(),
    diffAvailable: !!provider.getDiff(),
    stageMetadataAvailable: true,
    pdmSnapshotId: undefined,
  }
}

// ── Rule Evaluation Interface ──

export interface HvRuleEvaluator {
  /** 评估一条或多条规则。返回 issue 列表。 */
  evaluate(
    ruleIds: string[],
    provider: DeterministicInputProvider,
  ): Promise<{ issues: HardValidationIssue[]; autoFixable: boolean }>
}

// ── HardValidationSuite ──

/**
 * Hard Validation 执行套件。
 *
 * 职责：
 * 1. 从 registry 获取规则列表
 * 2. 按 profile 筛选适用规则
 * 3. 检查输入可用性 → not_applicable / input_missing
 * 4. 调用 rule evaluator 执行
 * 5. 归一化结果并生成报告
 * 6. 支持增量校验（记录 skipped rules）
 */
export class HardValidationSuite {
  readonly #registry: HvRuleRegistry
  readonly #evaluator: HvRuleEvaluator

  constructor(registry: HvRuleRegistry, evaluator: HvRuleEvaluator) {
    this.#registry = registry
    this.#evaluator = evaluator
  }

  /** 执行全量硬校验。 */
  async validate(
    provider: DeterministicInputProvider,
    profileId: string,
    stageId: string,
  ): Promise<V2HardValidationReport> {
    return this.#runValidation(provider, profileId, stageId, false, [], [])
  }

  /** 执行增量硬校验。 */
  async validateIncremental(
    provider: DeterministicInputProvider,
    profileId: string,
    stageId: string,
    changedPaths: string[],
    changedEntityIds: string[],
  ): Promise<V2HardValidationReport> {
    return this.#runValidation(provider, profileId, stageId, true, changedPaths, changedEntityIds)
  }

  /** 核心校验逻辑。 */
  async #runValidation(
    provider: DeterministicInputProvider,
    profileId: string,
    stageId: string,
    isIncremental: boolean,
    changedPaths: string[],
    changedEntityIds: string[],
  ): Promise<V2HardValidationReport> {
    const allRules = this.#registry.getAllRules()

    // ── 按 profile 和输入可用性分类 ──
    const inputSignature = buildInputSignature(provider)
    const notApplicableRules: HardValidationNotApplicable[] = []
    const inputMissingRuleIds: string[] = []
    const executableRuleIds: string[] = []
    const skippedRules: { ruleIds: string[]; reason: string }[] = []

    for (const rule of allRules) {
      // 检查 profile 适用性
      if (
        !rule.applicableProfiles.includes('all') &&
        !rule.applicableProfiles.includes(profileId as any)
      ) {
        notApplicableRules.push({
          ruleId: rule.ruleId,
          reason: `Profile "${profileId}" 不适用此规则`,
          category: rule.category,
        })
        continue
      }

      // 检查输入可用性
      if (!this.#inputsAvailable(rule.requiredInputs, inputSignature)) {
        notApplicableRules.push({
          ruleId: rule.ruleId,
          reason: `所需输入缺失: ${rule.requiredInputs.join(', ')}`,
          category: rule.category,
        })
        inputMissingRuleIds.push(rule.ruleId)
        continue
      }

      // 增量模式：判断是否需跳过
      if (isIncremental && !this.#isRuleAffected(rule, changedPaths, changedEntityIds)) {
        skippedRules.push({
          ruleIds: [rule.ruleId],
          reason: '增量校验：未检测到相关变更',
        })
        continue
      }

      executableRuleIds.push(rule.ruleId)
    }

    // ── 执行规则 ──
    const issues: HardValidationIssue[] = []
    let totalAutoFixable = 0

    // 按 implementation 分组执行（避免重复评估同一实现）
    const implGroups = this.#groupByImplementation(executableRuleIds)
    for (const [implId, ruleIds] of implGroups) {
      // 检查 provider 对 implementation 所有必需输入的可用性
      const impl = this.#registry.getImplementation(implId)
      if (impl && !this.#inputsAvailable(impl.requiredInputs, inputSignature)) {
        // implementation 层面输入缺失 → 所有关联规则标记 input_missing
        for (const rid of ruleIds) {
          issues.push({
            ruleId: rid,
            severity: 'not_applicable',
            category: this.#registry.getRule(rid)?.category ?? 'stage_metadata',
            path: '/validation/input',
            message: `Implementation "${implId}" 输入缺失`,
            affectedEntityIds: [],
            autoFixable: false,
            requiresHumanReview: false,
            sourceStageId: stageId,
            evidence: `Missing inputs: ${impl.requiredInputs.join(', ')}`,
            implementationId: implId,
          })
        }
        continue
      }

      try {
        const result = await this.#evaluator.evaluate(ruleIds, provider)
        for (const issue of result.issues) {
          issues.push({ ...issue, sourceStageId: stageId, implementationId: implId })
          if (result.autoFixable) totalAutoFixable++
        }
      } catch (err) {
        // 评估异常 → 全部标记 blocking
        const msg = err instanceof Error ? err.message : String(err)
        for (const rid of ruleIds) {
          issues.push({
            ruleId: rid,
            severity: 'blocking',
            category: this.#registry.getRule(rid)?.category ?? 'stage_metadata',
            path: '/validation/evaluate',
            message: `规则评估异常: ${msg}`,
            affectedEntityIds: [],
            autoFixable: false,
            requiresHumanReview: true,
            sourceStageId: stageId,
            evidence: `Evaluation error: ${msg}`,
            implementationId: implId,
          })
        }
      }
    }

    // ── 统计 ──
    const blocking = issues.filter((i) => i.severity === 'blocking')
    const warnings = issues.filter((i) => i.severity === 'warning')
    const infos = issues.filter((i) => i.severity === 'info')
    const passedCount =
      executableRuleIds.length -
      issues.filter(
        (i) => i.severity === 'warning' || i.severity === 'blocking' || i.severity === 'info',
      ).length

    return {
      validationId: `hv-${stageId}-${Date.now()}`,
      stageId,
      pdmSnapshotId: undefined,
      rulesetVersion: '1.0',
      summary: {
        totalRules: allRules.length,
        passed: Math.max(0, passedCount),
        blocking: blocking.length,
        warnings: warnings.length,
        infos: infos.length,
        notApplicable: notApplicableRules.length,
        inputMissing: inputMissingRuleIds.length,
      },
      issues,
      notApplicableRules,
      inputSignature,
      isFullValidation: !isIncremental,
      skippedRules,
      generatedAt: new Date().toISOString(),
    }
  }

  /** 检查所需输入是否可用。 */
  #inputsAvailable(requiredInputs: string[], sig: HardValidationInputSignature): boolean {
    const mapping: Record<string, boolean> = {
      pdm_schema_parse: sig.schemaParsed,
      graph_validation: sig.graphAvailable,
      schedule_result: sig.scheduleAvailable,
      critical_path_result: sig.criticalPathAvailable,
      resource_load_result: sig.resourceLoadAvailable,
      diff_result: sig.diffAvailable,
      stage_metadata: sig.stageMetadataAvailable,
      pdm_snapshot: true,
    }
    for (const input of requiredInputs) {
      if (!mapping[input]) return false
    }
    return true
  }

  /** 增量模式：判断规则是否受变更影响。 */
  #isRuleAffected(
    rule: import('../registry/hv_registry.js').HvRegistryEntry,
    _changedPaths: string[],
    _changedEntityIds: string[],
  ): boolean {
    // 简化判断：日期/schedule 相关规则遇日期变更必须执行，描述相关规则遇内容变更执行
    if (
      rule.category === 'date_schedule' &&
      _changedPaths.some((p) => p.includes('plannedStart') || p.includes('plannedEnd'))
    ) {
      return true
    }
    if (
      rule.category === 'structure' &&
      _changedPaths.some((p) => p.includes('dependencies') || p.includes('dependsOn'))
    ) {
      return true
    }
    if (rule.category === 'reference_integrity' && _changedEntityIds.length > 0) {
      return true
    }
    // 默认：任何变更都跑 schema/numeric/raci/risk
    if (['schema_parse', 'numeric', 'raci', 'risk'].includes(rule.category)) {
      return true
    }
    // 资源类变更
    if (
      rule.category === 'resource' &&
      (_changedPaths.some((p) => p.includes('resource') || p.includes('assignment')) ||
        _changedEntityIds.some((e) => e.startsWith('RS')))
    ) {
      return true
    }
    return false
  }

  /** 按 implementationId 对规则 ID 分组。 */
  #groupByImplementation(ruleIds: string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>()
    for (const rid of ruleIds) {
      const rule = this.#registry.getRule(rid)
      const implId = rule?.implementationId ?? rid
      if (!groups.has(implId)) groups.set(implId, [])
      groups.get(implId)!.push(rid)
    }
    return groups
  }
}
