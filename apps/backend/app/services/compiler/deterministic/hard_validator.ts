/**
 * Deterministic Engine —— Hard Validator（硬校验）与 Auto-fix。
 *
 * 包含 compiler hard validator rule registry，提供 blocking、warning、info 三类规则结果。
 * 自动修正只生成 candidate patch 和 diff，禁止直接修改正式项目数据。
 *
 * @aiproj/backend
 */

import type {
  AutoFixCandidate,
  DeterministicEngineResult,
  HardValidationReport,
  ValidationRuleResult,
} from '@aiproj/compiler-spec'
import type { DeterministicContext, HardValidationService } from './interfaces.js'

export type HardValidationRule = {
  ruleId: string
  description: string
  autoFixable: boolean
  requiresHumanReview: boolean
  evaluate: (result: DeterministicEngineResult) => {
    severity: 'blocking' | 'warning' | 'info'
    message: string
    path: string
    entityIds?: string[]
    autoFix?: AutoFixCandidate
  } | null
}

export class HardValidator implements HardValidationService {
  readonly name = 'hard_validator'

  // 所有已注册的规则
  readonly #rules: HardValidationRule[] = []

  constructor() {
    this.#registerBaselineRules()
  }

  /** 注册自定义规则。 */
  registerRule(rule: HardValidationRule): void {
    this.#rules.push(rule)
  }

  async validate(
    engineResult: DeterministicEngineResult,
    _context: DeterministicContext,
  ): Promise<HardValidationReport> {
    const rules: ValidationRuleResult[] = []
    const blocking: ValidationRuleResult[] = []
    const warnings: ValidationRuleResult[] = []
    const infos: ValidationRuleResult[] = []
    const autoFixCandidates: AutoFixCandidate[] = []

    for (const rule of this.#rules) {
      const evaluation = rule.evaluate(engineResult)
      if (!evaluation) continue

      const ruleResult: ValidationRuleResult = {
        ruleId: rule.ruleId,
        severity: evaluation.severity,
        path: evaluation.path,
        message: evaluation.message,
        sourceStageId: 'deterministic_hard_validation',
        autoFixable: rule.autoFixable && !!evaluation.autoFix,
        requiresHumanReview: rule.requiresHumanReview,
        entityIds: evaluation.entityIds ?? [],
      }

      rules.push(ruleResult)

      switch (evaluation.severity) {
        case 'blocking':
          blocking.push(ruleResult)
          break
        case 'warning':
          warnings.push(ruleResult)
          break
        case 'info':
          infos.push(ruleResult)
          break
      }

      if (evaluation.autoFix) {
        autoFixCandidates.push(evaluation.autoFix)
      }
    }

    return {
      passed: blocking.length === 0,
      rules,
      blocking,
      warnings,
      infos,
      autoFixCandidates,
    }
  }

  /** 注册 baseline 规则集。 */
  #registerBaselineRules(): void {
    // ── Graph Consistency ──
    this.registerRule({
      ruleId: 'GRAPH_BLOCKING_CHECK',
      description: 'graph validation 如有 blocking 则阻断 hard validation',
      autoFixable: false,
      requiresHumanReview: true,
      evaluate(result) {
        if (result.graphValidation && !result.graphValidation.passed) {
          return {
            severity: 'blocking',
            message: `Graph validation 未通过: ${result.graphValidation.blocking.map((b) => b.ruleId).join(', ')}`,
            path: '/validation/graph',
            entityIds: result.graphValidation.blocking.flatMap((b) => b.entityIds),
          }
        }
        return null
      },
    })

    // ── Schedule Consistency ──
    this.registerRule({
      ruleId: 'SCHEDULE_BLOCKING_CHECK',
      description: 'schedule 如有 blocking 则阻断 hard validation',
      autoFixable: false,
      requiresHumanReview: true,
      evaluate(result) {
        if (result.schedule?.blocked) {
          return {
            severity: 'blocking',
            message: `Schedule 未完成: ${result.schedule.warnings.join(', ')}`,
            path: '/computed/schedule',
          }
        }
        return null
      },
    })

    // ── Schedule Date Consistency ──
    this.registerRule({
      ruleId: 'SCHEDULE_DATE_INVALID',
      description: '检查排期日期有效性（结束日期 >= 开始日期）',
      autoFixable: true,
      requiresHumanReview: false,
      evaluate(result) {
        if (!result.schedule) return null
        const invalid: string[] = []
        for (const [tid, s] of Object.entries(result.schedule.scheduled)) {
          if (s.plannedEnd < s.plannedStart) {
            invalid.push(tid)
          }
        }
        if (invalid.length > 0) {
          return {
            severity: 'blocking',
            message: `任务 ${invalid.join(', ')} 结束日期早于开始日期`,
            path: '/computed/schedule',
            entityIds: invalid,
            autoFix: {
              patchId: `fix_schedule_date_${Date.now()}`,
              ruleId: 'SCHEDULE_DATE_INVALID',
              description: '重排无效日期任务',
              path: '/computed/schedule',
              before: invalid.map((tid) => result.schedule!.scheduled[tid]),
              after: '需要 schedule engine 重算',
            },
          }
        }
        return null
      },
    })

    // ── Critical Path Consistency ──
    this.registerRule({
      ruleId: 'CRITICAL_PATH_BLOCKING_CHECK',
      description: 'critical path 不可计算时阻断',
      autoFixable: false,
      requiresHumanReview: true,
      evaluate(result) {
        if (result.criticalPath?.blocked) {
          return {
            severity: 'blocking',
            message: `Critical path 不可计算: ${result.criticalPath.blockedReason ?? '未知原因'}`,
            path: '/computed/criticalPath',
          }
        }
        return null
      },
    })

    // ── Resource Load Baseline ──
    this.registerRule({
      ruleId: 'RESOURCE_OVERLOAD_CHECK',
      description: '资源超载警告',
      autoFixable: false,
      requiresHumanReview: true,
      evaluate(result) {
        if (result.resourceLoad?.hasOverload) {
          return {
            severity: 'warning',
            message: `资源超载: ${result.resourceLoad.overloadDays} 个日期桶超载`,
            path: '/computed/resourceLoad',
          }
        }
        return null
      },
    })

    // ── Resource Leveling Not Supported ──
    this.registerRule({
      ruleId: 'RESOURCE_LEVELING_NOT_SUPPORTED',
      description: '自动资源平衡在当前版本不可用',
      autoFixable: false,
      requiresHumanReview: false,
      evaluate(result) {
        // 如果 resourceLoad 存在且有超载，提示不可自动平衡
        if (result.resourceLoad?.hasOverload) {
          return {
            severity: 'info',
            message:
              '自动资源平衡 (RESOURCE_LEVELING) 在本版本中不可用。不会自动调整任务日期或分配。',
            path: '/computed/resourceLoad',
          }
        }
        return null
      },
    })

    // ── Schema Consistency ──
    this.registerRule({
      ruleId: 'SCHEMA_CONSISTENCY_CHECK',
      description: '检查 deterministic 各子结果是否一致',
      autoFixable: false,
      requiresHumanReview: true,
      evaluate(result) {
        const issues: string[] = []

        if (result.schedule && result.schedule.blocked !== result.blocked) {
          issues.push('schedule blocked 状态与整体 blocked 状态不一致')
        }

        if (issues.length > 0) {
          return {
            severity: 'warning',
            message: `Schema 不一致: ${issues.join('; ')}`,
            path: '/',
          }
        }
        return null
      },
    })

    // ── Auto-fix Validation ──
    this.registerRule({
      ruleId: 'AUTO_FIX_REQUIRES_REVALIDATION',
      description: 'auto-fix 后必须重新 validation',
      autoFixable: false,
      requiresHumanReview: false,
      evaluate(result) {
        if (
          result.hardValidation?.autoFixCandidates &&
          result.hardValidation.autoFixCandidates.length > 0
        ) {
          return {
            severity: 'warning',
            message: `${result.hardValidation.autoFixCandidates.length} 个 auto-fix 候选已生成，需重新 validation`,
            path: '/validation/autoFix',
          }
        }
        return null
      },
    })
  }

  /** 获取已注册规则数量。 */
  get ruleCount(): number {
    return this.#rules.length
  }
}
