/**
 * ContractReadOnlyGuard —— Contract 只读保护，拒绝任何 LLM 输出修改 Contract 的写入路径。
 *
 * LLM Stage 只能读取 Contract 中与当前 Stage/实体相关的最小上下文。
 * 任何试图返回 Contract 字段、修改预期实体或新增实体的输出都会触发校验警告。
 *
 * @aiproj/backend compiler
 */

import type { GenerationContract } from '@aiproj/compiler-spec'

export interface ContractViolation {
  field: string
  reason: string
  details: string
}

export interface GuardResult {
  /** 是否检测到 Contract 写入企图。 */
  hasViolation: boolean
  /** 违规详情列表。 */
  violations: ContractViolation[]
}

/** Contract 保留字段（LLM 输出中禁止出现）。 */
const CONTRACT_RESERVED_TOP_KEYS = new Set([
  'generationContract',
  'contract',
  'expectedEntities',
  'contractMeta',
  'contractVersion',
])

/** 可疑的 Contract 修改模式。 */
const CONTRACT_MODIFICATION_PATTERNS = [
  /contract\s*(version|hash|meta)/i,
  /expected[_\s]?entit(y|ies)/i,
  /quality[_\s]?gate/i,
]

/**
 * ContractReadOnlyGuard —— 校验 LLM 输出是否包含 Contract 写入企图。
 *
 * 用法：
 * 在每个 LLM Stage 输出后调用 `guard` 方法。
 * 返回 hasViolation=true 时，Executor 应记录验证警告并忽略相关字段。
 */
export class ContractReadOnlyGuard {
  /**
   * 校验 LLM Stage 输出是否试图修改 Contract。
   *
   * @param llmOutput  LLM Stage 返回的原始输出对象
   * @param contract   当前运行的 GenerationContract（用于对比引用）
   * @returns          GuardResult
   */
  guard(llmOutput: Record<string, unknown>, _contract: GenerationContract): GuardResult {
    const violations: ContractViolation[] = []
    const topKeys = Object.keys(llmOutput)

    // 1. 扫描顶级保留键
    for (const key of topKeys) {
      const lowerKey = key.toLowerCase().replace(/[_-]/g, '')
      const isContractKey = [...CONTRACT_RESERVED_TOP_KEYS].some(
        (reserved) => reserved.toLowerCase() === lowerKey,
      )
      if (isContractKey) {
        violations.push({
          field: key,
          reason: 'contract_field_prohibited',
          details: `LLM输出包含 Contract 保留字段 "${key}"，LLM 禁止创建或修改 Contract`,
        })
      }
    }

    // 2. 扫描嵌套对象中的 Contract 修改模式
    for (const key of topKeys) {
      const value = llmOutput[key]
      if (typeof value === 'object' && value !== null) {
        const valueStr = JSON.stringify(value)
        for (const pattern of CONTRACT_MODIFICATION_PATTERNS) {
          if (pattern.test(valueStr)) {
            violations.push({
              field: key,
              reason: 'contract_modification_suspected',
              details: `LLM输出在 "${key}" 字段中包含疑似 Contract 修改内容`,
            })
          }
        }
      }
    }

    // 3. 拒绝新增预期实体
    if (llmOutput.expectedEntities || llmOutput.expected_entities) {
      violations.push({
        field: 'expectedEntities',
        reason: 'contract_entity_addition_prohibited',
        details: 'LLM 不得新增预期实体；Contract 中的实体列表只能由确定性 Compiler 修改',
      })
    }

    return {
      hasViolation: violations.length > 0,
      violations,
    }
  }

  /**
   * 从 LLM 上下文（prompt context）中提取 Contract 的最小安全子集。
   * 只暴露当前 Stage 需要的实体信息，不暴露完整 Contract。
   *
   * @param contract     完整 Contract
   * @param stageId      当前 Stage ID
   * @param entityIds    当前 Stage 涉及的实体 ID 列表
   * @returns            Contract 的安全子集
   */
  extractStageContext(
    contract: GenerationContract,
    _stageId: string,
    entityIds: string[],
  ): Record<string, unknown> {
    const relevantEntities = contract.expectedEntities.filter((e) => entityIds.includes(e.entityId))

    return {
      contractVersion: contract.meta.contractVersion,
      relevantEntities: relevantEntities.map((e) => ({
        entityId: e.entityId,
        entityType: e.entityType,
        label: e.label,
        required: e.required,
      })),
    }
  }
}
