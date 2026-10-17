/**
 * v3-copilot-structured-and-diagram-output —— 结构化输出策略解析器。
 *
 * 职责：
 * - 结构化产出复用 `ai_m0/schema.ts` 既有策略分支（Task 5.1）
 * - 连接不支持严格 schema 时按既有降级链处理并标记（Task 5.3）
 * - 能力不支持时块缺席并给出原因（Task 5.5）
 *
 * 约束：
 * - 不新建第二套能力判定（Task 5.1 / D4）
 * - 复用 `ai_connections.capabilities` 的 `supportsStrictSchema` 字段
 * - 降级链：strict schema → prompt strategy → mock
 */

import type { AiM0Strategy } from '@aiproj/types'
import type { CopilotBlockAbsentReason } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 策略类型
// ---------------------------------------------------------------------------

/**
 * 结构化输出策略判定结果。
 *
 * 复用既有 `AiM0Strategy` 语义：
 * - `structured_output` = 连接支持严格 schema（可用 JSON Schema 约束输出）
 * - `prompt` = 连接不支持严格 schema（靠 prompt 引导，结构化块缺席）
 */
export type CopilotStructuredOutputStrategy = 'structured_output' | 'prompt'

export interface CopilotStructuredOutputStrategyResult {
  /** 选定的策略。 */
  readonly strategy: CopilotStructuredOutputStrategy
  /** 是否为降级（连接不支持严格 schema）。 */
  readonly degraded: boolean
  /** 降级原因（degraded=true 时有值）。 */
  readonly degradationReason?: string
  /** 块缺席记录（能力不支持时）。 */
  readonly absentBlock?: {
    readonly blockType: 'table' | 'list' | 'diagram'
    readonly reason: CopilotBlockAbsentReason
    readonly detail: string
  }
}

// ---------------------------------------------------------------------------
// 策略解析器
// ---------------------------------------------------------------------------

/**
 * 解析结构化输出策略。
 *
 * Task 5.1: 复用 `ai_m0/schema.ts` 的既有策略分支，不新建判定。
 * Task 5.3: 连接不支持严格 schema 时按既有降级链处理并标记。
 * Task 5.5: 能力不支持时块缺席并给出原因。
 *
 * @param connectionCapabilities - 连接的能力声明（来自 `ai_connections.capabilities`）
 * @param defaultStrategy - 默认策略（缺省 'prompt'）
 */
export function resolveStructuredOutputStrategy(
  connectionCapabilities: {
    supportsStrictSchema?: boolean
  } | null,
  defaultStrategy: CopilotStructuredOutputStrategy = 'prompt',
): CopilotStructuredOutputStrategyResult {
  // Task 5.1: 复用既有能力判定（supportsStrictSchema）
  const supportsStrictSchema = connectionCapabilities?.supportsStrictSchema ?? false

  if (supportsStrictSchema) {
    return {
      strategy: 'structured_output',
      degraded: false,
    }
  }

  // Task 5.3: 降级链处理
  if (connectionCapabilities !== null) {
    // 连接存在但不支持严格 schema → 降级
    return {
      strategy: defaultStrategy,
      degraded: true,
      degradationReason: '当前连接不支持严格 schema 输出，结构化块降级为缺席',
      absentBlock: {
        blockType: 'table',
        reason: 'capability_unsupported',
        detail: '当前连接不支持严格 schema 输出，结构化块缺席',
      },
    }
  }

  // 连接不存在（fallback/mock）→ 使用默认策略
  return {
    strategy: defaultStrategy,
    degraded: defaultStrategy === 'structured_output',
    degradationReason:
      defaultStrategy === 'structured_output' ? '未找到连接信息，使用默认策略' : undefined,
  }
}

/**
 * 将 CopilotStructuredOutputStrategy 映射为 AiM0Strategy。
 * Task 5.1: 复用既有策略分支映射。
 *
 * 注意：`AiM0Strategy` 封闭枚举只有 `prompt | native | tool`（`AI_M0_STRATEGIES`）——
 * 严格 schema 约束输出对应的是 **native** 分支（适配器在 `strategy === 'native'` 且带
 * jsonSchema 时走原生结构化输出），不存在名为 `structured_output` 的 AiM0 策略。
 * 此前返回 `'structured_output'` 在类型上越界（TS2322），下游适配器也不认识它。
 */
export function toAiM0Strategy(strategy: CopilotStructuredOutputStrategy): AiM0Strategy {
  return strategy === 'structured_output' ? 'native' : 'prompt'
}
