import type { CommandContext, CommandEffect, RegisteredCommand } from '@/lib/command-registry/types'

/**
 * 自然语言命令候选类型（design.md D1 / spec「命令面板必须支持自然语言候选命令」）。
 *
 * 安全边界：
 * - `effect` 复用 registry 的 `CommandEffect`，类型层不含 `'write'`；
 * - 可执行候选必须引用既有 `RegisteredCommand`（`command` 字段），
 *   执行时复用原命令对象，不新建写入通道（design.md D3）；
 * - 写意图候选 `requiresReview` 必为 true，只打开表单/确认界面；
 * - 阻断候选 `commandId`/`effect` 为 null 且无 `command`，不可执行。
 */

/** 置信度分级（design.md D2）：high 主候选 / medium 多候选 / low 空态或阻断。 */
export type NaturalLanguageConfidence = 'high' | 'medium' | 'low'

/** 阻断原因：写意图没有可承接的 `open-form`/`open-confirm` 命令（design.md D3）。 */
export type NaturalLanguageBlockedReason = 'write-intent-no-safe-open-target'

/** 一条自然语言解析候选。 */
export interface NaturalLanguageCommandCandidate {
  /** 命中的 registry 命令 ID；阻断候选为 null。 */
  commandId: string | null
  /** 展示标签（可执行候选与 registry 命令一致）。 */
  label: string
  /** 与 registry 相同的安全副作用类型；阻断候选为 null。 */
  effect: CommandEffect | null
  confidence: NaturalLanguageConfidence
  /** 匹配原因（展示给用户）。 */
  reason: string
  /** 写意图候选为 true：选中后只打开表单/确认界面，落库需人工确认。 */
  requiresReview: boolean
  /** 预览摘要（展示给用户）。 */
  previewText: string
  /** 阻断候选的阻断原因；可执行候选无。 */
  blockedReason?: NaturalLanguageBlockedReason
  /** 原 registry 命令对象引用（执行复用，design.md D3）；阻断候选无。 */
  command?: RegisteredCommand
}

/** 解析结果策略：主候选 / 多候选 / 阻断 / 空态。 */
export type NaturalLanguageResultStrategy = 'primary' | 'multiple' | 'blocked' | 'empty'

/** 自然语言解析结果。 */
export interface NaturalLanguageCommandResult {
  strategy: NaturalLanguageResultStrategy
  candidates: NaturalLanguageCommandCandidate[]
  /** strategy 为 empty 时的澄清/高级搜索提示。 */
  emptyHint?: string
}

/**
 * 解析器接口（design.md D2）。本 change 只提供确定性本地实现；
 * 未来接入 AIGateway 或后端 `/api/v1` 解析端点必须另开 change 并经用户授权。
 */
export type NaturalLanguageCommandResolver = (
  input: string,
  visibleCommands: RegisteredCommand[],
  ctx: CommandContext,
) => NaturalLanguageCommandResult
