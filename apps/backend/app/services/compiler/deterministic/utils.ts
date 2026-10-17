/**
 * Deterministic Engine —— 通用工具。
 *
 * 包含 EngineEvidenceBuilder、InputSignature 等公用组件。
 *
 * @aiproj/backend
 */

import { createHash } from 'node:crypto'
import type { EngineEvidence } from '@aiproj/compiler-spec'

// ── InputSignature ──

/**
 * 为同一输入生成稳定 hash。
 * 用于证据追踪和缓存。
 */
export function computeInputSignature(input: unknown): string {
  const json = JSON.stringify(input, Object.keys(input as object).sort())
  return `sha256:${createHash('sha256').update(json, 'utf-8').digest('hex')}`
}

/**
 * 对已序列化的 JSON 字符串计算签名（避免重复序列化）。
 */
export function computeInputSignatureFromJson(json: string): string {
  return `sha256:${createHash('sha256').update(json, 'utf-8').digest('hex')}`
}

// ── Engine Version ──

export const DETERMINISTIC_ENGINE_VERSION = '2.0.0'
export const DETERMINISTIC_RULE_SET_VERSION = '1.0'

// ── EngineEvidenceBuilder ──

export class EngineEvidenceBuilder {
  readonly #stageId: string
  readonly #inputSignature: string
  readonly #outputSummary: Record<string, unknown> = {}
  #blockingCount = 0
  #warningCount = 0
  #diffRuleIds: string[] = []

  constructor(stageId: string, inputSignature: string) {
    this.#stageId = stageId
    this.#inputSignature = inputSignature
  }

  /** 记录输出摘要。 */
  setOutputSummary(summary: Record<string, unknown>): this {
    Object.assign(this.#outputSummary, summary)
    return this
  }

  /** 记录 blocking 计数。 */
  setBlockingCount(count: number): this {
    this.#blockingCount = count
    return this
  }

  /** 记录 warning 计数。 */
  setWarningCount(count: number): this {
    this.#warningCount = count
    return this
  }

  /** 添加 diff rule IDs。 */
  addDiffRuleIds(ids: string[]): this {
    this.#diffRuleIds.push(...ids)
    return this
  }

  /** 构建 EngineEvidence。 */
  build(extraMeta?: Record<string, unknown>): EngineEvidence {
    return {
      stageId: this.#stageId,
      engineVersion: DETERMINISTIC_ENGINE_VERSION,
      ruleSetVersion: DETERMINISTIC_RULE_SET_VERSION,
      inputSignature: this.#inputSignature,
      outputSummary: { ...this.#outputSummary },
      diffSummary: {
        totalChanges: this.#diffRuleIds.length,
        ruleIds: [...this.#diffRuleIds],
      },
      validationResult: {
        passed: this.#blockingCount === 0,
        blockingCount: this.#blockingCount,
        warningCount: this.#warningCount,
      },
      metadata: extraMeta ?? {},
    }
  }
}

// ── DeterministicEngineResultBuilder ──

import type { DeterministicEngineResult } from '@aiproj/compiler-spec'
import type {
  CriticalPathResult,
  GraphValidationResult,
  HardValidationReport,
  PdmDiff,
  ResourceLoadResult,
  ScheduleResult,
} from '@aiproj/compiler-spec'

export class DeterministicEngineResultBuilder {
  readonly #evidence: EngineEvidence[] = []
  schedule?: ScheduleResult
  graphValidation?: GraphValidationResult
  criticalPath?: CriticalPathResult
  resourceLoad?: ResourceLoadResult
  hardValidation?: HardValidationReport
  diff?: PdmDiff

  withSchedule(value: ScheduleResult): this {
    this.schedule = value
    return this
  }

  withGraphValidation(value: GraphValidationResult): this {
    this.graphValidation = value
    return this
  }

  withCriticalPath(value: CriticalPathResult): this {
    this.criticalPath = value
    return this
  }

  withResourceLoad(value: ResourceLoadResult): this {
    this.resourceLoad = value
    return this
  }

  withHardValidation(value: HardValidationReport): this {
    this.hardValidation = value
    return this
  }

  withDiff(value: PdmDiff): this {
    this.diff = value
    return this
  }

  addEvidence(evidence: EngineEvidence): this {
    this.#evidence.push(evidence)
    return this
  }

  build(): DeterministicEngineResult {
    const blockingSummary: string[] = []

    if (this.graphValidation) {
      for (const b of this.graphValidation.blocking) {
        blockingSummary.push(b.ruleId)
      }
    }
    if (this.hardValidation) {
      for (const b of this.hardValidation.blocking) {
        blockingSummary.push(b.ruleId)
      }
    }

    const blocked = blockingSummary.length > 0

    return {
      schedule: this.schedule,
      graphValidation: this.graphValidation,
      criticalPath: this.criticalPath,
      resourceLoad: this.resourceLoad,
      hardValidation: this.hardValidation,
      diff: this.diff,
      evidence: [...this.#evidence],
      blocked,
      blockingSummary,
    }
  }
}
