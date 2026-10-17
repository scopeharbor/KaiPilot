/**
 * v3-prompt-version-registry —— prompt 版本注册表共享契约。
 *
 * 存标识不存内容：注册表只存 prompt 名、版本号、内容 hash、生效范围与创建时间。
 * 全文留在代码或配置中；注册表提供的是**标识与归因**，不是存储。
 *
 * 字段命名对齐 OTel GenAI `gen_ai.prompt.name`；版本走 `aiproj_` 前缀。
 * 内容 hash 由 prompt 内容确定性推导（sha256），用于校验"运行时用的是不是注册的那一版"。
 *
 * 红线：不存 prompt 全文、不存模型输出、不存 token、不存 secret。
 */
import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// §1 注册表条目类型
// ---------------------------------------------------------------------------

/**
 * 注册条目的生效范围：按能力面与策略两个维度。
 * 与统一账本的 aiproj_capability / aiproj_surface 对齐。
 */
export interface PromptVersionScope {
  /** 能力面列表，如 ['draft', 'risk', 'triz']。空数组表示全局生效。 */
  capabilities: string[]
  /** 策略列表，如 ['copilot', 'compiler']。空数组表示全策略生效。 */
  strategies: string[]
}

/**
 * 注册表条目。字段中无可容纳长文本的列。
 */
export interface PromptVersionEntry {
  /** prompt 唯一名称（如 'risk-suggest', 'triz-contradiction'）。全局唯一。 */
  promptName: string
  /** 语义化版本号（如 '1.0.0', '2.1.0'）。版本号表达意图，hash 表达事实。 */
  version: string
  /** prompt 内容的确定性内容 hash（sha256 前 16 hex）。同内容同 hash，内容变 hash 变。 */
  contentHash: string
  /** 生效范围：影响哪些能力面与策略。 */
  effectiveScope: PromptVersionScope
  /** 注册时间 ISO 8601。 */
  createdAt: string
}

/**
 * 注册表查询结果。
 */
export interface PromptVersionQueryResult {
  entries: PromptVersionEntry[]
  total: number
}

// ---------------------------------------------------------------------------
// §2 确定性 hash
// ---------------------------------------------------------------------------

/**
 * 计算 prompt 内容的确定性 hash（sha256 前 16 hex）。
 * 同内容同 hash，内容变 hash 变。
 *
 * @param promptContent prompt 全文
 * @returns 16 字符 hex hash
 */
export function computePromptContentHash(promptContent: string): string {
  return createHash('sha256').update(promptContent, 'utf8').digest('hex').slice(0, 16)
}

/**
 * 校验运行时 prompt 与注册版本的 hash 是否一致。
 *
 * @param runtimeContent 运行时构造的 prompt 内容
 * @param registeredHash 注册表中的 contentHash
 * @returns true = hash 一致，false = 不一致（未注册变体在跑）
 */
export function verifyPromptHash(runtimeContent: string, registeredHash: string): boolean {
  return computePromptContentHash(runtimeContent) === registeredHash
}

// ---------------------------------------------------------------------------
// §3 常量
// ---------------------------------------------------------------------------

/** 未注册标记 —— 当 prompt 名不在注册表中时使用。 */
export const PROMPT_VERSION_UNREGISTERED = 'unregistered' as const

/** 本地版本字段前缀（OTel 未定义版本字段，本地扩展）。 */
export const PROMPT_VERSION_LOCAL_PREFIX = 'aiproj_' as const

/** 版本字段名（本地扩展）。 */
export const PROMPT_VERSION_FIELD = 'aiproj_prompt_version' as const

/** 名称字段名（OTel 标准对齐）。 */
export const PROMPT_NAME_FIELD = 'prompt_name' as const

// ---------------------------------------------------------------------------
// §4 类型守卫
// ---------------------------------------------------------------------------

/** 判断是否为 PromptVersionEntry 的形状。 */
export function isPromptVersionEntry(value: unknown): value is PromptVersionEntry {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.promptName === 'string' &&
    typeof obj.version === 'string' &&
    typeof obj.contentHash === 'string' &&
    obj.effectiveScope !== undefined &&
    typeof obj.createdAt === 'string'
  )
}

/** 判断版本号格式是否合法（语义化版本或单调递增整数）。 */
export function isValidPromptVersion(version: string): boolean {
  // 语义化版本 x.y.z 或整数版本
  return /^\d+(\.\d+){0,2}$/.test(version)
}

// ---------------------------------------------------------------------------
// §5 命名空间违规检测
// ---------------------------------------------------------------------------

/**
 * 检测本地版本字段是否冒充标准键。
 * 版本字段必须出现在 aiproj_ 前缀下，不得以 gen_ai.* 输出。
 */
export function findPromptVersionNamespacingViolations(
  attributes: Record<string, unknown>,
): string[] {
  const violations: string[] = []
  for (const key of Object.keys(attributes)) {
    // 如果键包含 prompt 相关语义且不在 aiproj_ 前缀下
    if (
      (key === 'gen_ai_prompt_version' || key === 'gen_ai.prompt.version') &&
      !key.startsWith('aiproj_')
    ) {
      violations.push(key)
    }
  }
  return violations
}
