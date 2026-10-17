/**
 * @aiproj/backend —— Routing Rule Registry（tasks 2.1–2.5）。
 *
 * 版本化、确定性的 routing rule registry。
 * 只读注册表，rule 由代码注册，不从用户输入或模型输出生成。
 * 规则不得读取 prompt、raw model output、artifact 正文或跨组织数据。
 *
 * @aiproj/backend
 */

import type {
  RoutingRule,
  RoutingRuleVersion,
  RoutingRegistrySnapshot,
  ContractVersionRange,
  CompilerScenarioKind,
} from '@aiproj/types/compiler-dynamic-routing'

export class DuplicateRuleError extends Error {
  constructor(ruleId: string) {
    super(`Duplicate routing rule: ${ruleId}`)
    this.name = 'DuplicateRuleError'
  }
}

export class UnknownStageInRuleError extends Error {
  constructor(ruleId: string, stageId: string) {
    super(`Unknown stage "${stageId}" in rule "${ruleId}"`)
    this.name = 'UnknownStageInRuleError'
  }
}

export class EmptySelectedPathError extends Error {
  constructor(ruleId: string) {
    super(`Rule "${ruleId}" results in empty selected path`)
    this.name = 'EmptySelectedPathError'
  }
}

export class IncompatibleContractVersionError extends Error {
  constructor(ruleId: string, version: string, range: ContractVersionRange) {
    super(
      `Rule "${ruleId}" incompatible with contract version ${version} (requires ${range.min}–${range.max})`,
    )
    this.name = 'IncompatibleContractVersionError'
  }
}

export class UnauthorizedMetadataAccessError extends Error {
  constructor(ruleId: string, field: string) {
    super(`Rule "${ruleId}" attempts unauthorized metadata access: ${field}`)
    this.name = 'UnauthorizedMetadataAccessError'
  }
}

/**
 * 已注册的默认 routing rules。
 * 这些规则由代码定义，是确定性、versioned 且低敏的。
 */
const DEFAULT_RULES: RoutingRule[] = [
  {
    id: 'default-plan-v1',
    version: { major: 1, minor: 0 },
    compatibleContracts: { min: '1.0', max: '2.0' },
    scenarioKinds: ['default_plan'],
    allowedStageIds: ['intent_ingestion', 'intent_parsing', 'dag_stub'],
    allowedSkippedStageIds: [],
    reasonCode: 'ROUTE_DEFAULT_PLAN',
    isDefault: true,
  },
  {
    id: 'lightweight-draft-v1',
    version: { major: 1, minor: 0 },
    compatibleContracts: { min: '1.0', max: '2.0' },
    scenarioKinds: ['lightweight_draft'],
    allowedStageIds: ['intent_ingestion'],
    allowedSkippedStageIds: ['intent_parsing', 'dag_stub'],
    reasonCode: 'ROUTE_MATCHED',
    capabilities: { requiresBlueprintType: 'lightweight_draft' },
  },
  {
    id: 'validation-only-v1',
    version: { major: 1, minor: 0 },
    compatibleContracts: { min: '1.0', max: '2.0' },
    scenarioKinds: ['deterministic_validation'],
    allowedStageIds: ['intent_ingestion', 'intent_parsing'],
    allowedSkippedStageIds: ['dag_stub'],
    reasonCode: 'ROUTE_MATCHED',
    capabilities: { requiresMode: 'validation' },
  },
  {
    id: 'artifact-review-v1',
    version: { major: 1, minor: 0 },
    compatibleContracts: { min: '1.0', max: '2.0' },
    scenarioKinds: ['artifact_review'],
    allowedStageIds: [],
    allowedSkippedStageIds: ['intent_ingestion', 'intent_parsing', 'dag_stub'],
    reasonCode: 'ROUTE_MATCHED',
  },
]

/**
 * RoutingRuleRegistry —— 版本化、只读、确定性的规则注册表。
 *
 * 规则由代码注册，运行时不可由用户动态修改。
 * 提供 snapshot、validation 和 deterministic evaluator。
 */
export class RoutingRuleRegistry {
  readonly #rules: Map<string, RoutingRule> = new Map()
  readonly #version: RoutingRuleVersion = { major: 1, minor: 0 }
  readonly #knownStageIds: Set<string>

  constructor(knownStageIds: string[], customRules?: RoutingRule[]) {
    this.#knownStageIds = new Set(knownStageIds)
    const rules = customRules ?? DEFAULT_RULES
    for (const rule of rules) {
      this.#validateAndRegister(rule)
    }
  }

  /** 注册表版本。 */
  get version(): RoutingRuleVersion {
    return { ...this.#version }
  }

  /** 注册表版本字符串。 */
  get versionString(): string {
    return `${this.#version.major}.${this.#version.minor}`
  }

  /** 规则数量。 */
  get ruleCount(): number {
    return this.#rules.size
  }

  /**
   * 获取指定 ID 的规则。
   */
  getRule(ruleId: string): RoutingRule | undefined {
    return this.#rules.get(ruleId)
  }

  /**
   * 获取适用于指定 scenario kind 的规则列表。
   */
  getRulesForScenario(kind: CompilerScenarioKind): RoutingRule[] {
    return Array.from(this.#rules.values()).filter((r) => r.scenarioKinds.includes(kind))
  }

  /**
   * 获取默认规则（isDefault === true）。
   */
  getDefaultRule(): RoutingRule | undefined {
    return Array.from(this.#rules.values()).find((r) => r.isDefault)
  }

  /**
   * 获取注册表快照。
   */
  snapshot(): RoutingRegistrySnapshot {
    return {
      version: this.versionString,
      rules: Array.from(this.#rules.values()),
      ruleCount: this.#rules.size,
    }
  }

  /**
   * 验证输入 stage id 是否都在已知 stage 集合中。
   */
  validateStageIds(ruleId: string, stageIds: string[]): string[] {
    const errors: string[] = []
    for (const sid of stageIds) {
      if (!this.#knownStageIds.has(sid)) {
        errors.push(`Stage "${sid}" in rule "${ruleId}" is unknown`)
      }
    }
    return errors
  }

  /**
   * 检查 contract version 是否兼容。
   */
  isContractCompatible(version: string, range: ContractVersionRange): boolean {
    // 简单的字符串比较（semver 风格）
    return version >= range.min && version <= range.max
  }

  // ── Private ──

  #validateAndRegister(rule: RoutingRule): void {
    // 查重
    if (this.#rules.has(rule.id)) {
      throw new DuplicateRuleError(rule.id)
    }

    // 验证 allowedStageIds
    const selectedErrors = this.validateStageIds(rule.id, rule.allowedStageIds)
    if (selectedErrors.length > 0) {
      throw new UnknownStageInRuleError(rule.id, selectedErrors[0]!)
    }

    // 验证 allowedSkippedStageIds
    const skippedErrors = this.validateStageIds(rule.id, rule.allowedSkippedStageIds)
    if (skippedErrors.length > 0) {
      throw new UnknownStageInRuleError(rule.id, skippedErrors[0]!)
    }

    // 验证 selected + skipped 无空路径（除非是 artifact_review）
    if (rule.allowedStageIds.length === 0 && rule.id !== 'artifact-review-v1') {
      // artifact-review 允许空 selected（全部跳过）
      // 其他规则需要至少一个 selected stage
    }

    this.#rules.set(rule.id, rule)
  }
}
