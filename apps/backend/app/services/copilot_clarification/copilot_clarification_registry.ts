/**
 * Copilot 澄清字段注册表（任务 3.1–3.7）
 *
 * 各 destination 可声明自己的澄清字段；注册通过共享形状完成，
 * 不引入 per-destination 阻断规则——三档语义全局统一。
 *
 * 本模块是纯函数/纯数据，不依赖 AdonisJS 容器、数据库或 HTTP。
 */
import {
  type RegisteredClarificationField,
  type ClarificationTier,
  type ClarificationImpactSeverity,
  type CopilotClarificationQuestionType,
  validateClarificationFieldRegistry,
  sortClarificationQuestionsByImpact,
} from '@aiproj/types'

// ── 注册表内部存储 ──

/** destination → fields 的扁平注册表。 */
const registry = new Map<string, readonly RegisteredClarificationField[]>()

/**
 * 注册一个 destination 的澄清字段集合。
 * 校验失败时抛出错误（含 issues），防止无效字段进入注册表。
 */
export function registerClarificationFields(
  destination: string,
  fields: readonly RegisteredClarificationField[],
): void {
  // 校验所有字段
  const validation = validateClarificationFieldRegistry(fields)
  if (!validation.valid) {
    throw new Error(
      `澄清字段注册失败（destination=${destination}）：\n${validation.issues.join('\n')}`,
    )
  }
  // 确保字段归属正确
  fields.forEach((f) => {
    if (f.destination !== destination) {
      throw new Error(
        `字段 ${f.fieldId} 的 destination=${f.destination} 与注册目标 ${destination} 不匹配`,
      )
    }
  })
  registry.set(destination, fields)
}

/** 获取某个 destination 的已注册字段（不可变副本）。 */
export function getRegisteredFields(destination: string): readonly RegisteredClarificationField[] {
  return registry.get(destination) ?? []
}

/** 获取所有已注册的 destination。 */
export function getRegisteredDestinations(): string[] {
  return Array.from(registry.keys())
}

/** 获取所有已注册字段（跨 destination 扁平化）。 */
export function getAllRegisteredFields(): readonly RegisteredClarificationField[] {
  const all: RegisteredClarificationField[] = []
  for (const fields of registry.values()) {
    all.push(...fields)
  }
  return all
}

/** 清空注册表（仅测试用）。 */
export function clearClarificationRegistry(): void {
  registry.clear()
}

// ── 适配既有 13 字段目录 ──

/**
 * 将既有 ai_intent/card-catalog 的 13 字段适配为 RegisteredClarificationField 格式。
 * 不改动 ai_intent 现有向导行为，只增加一个可查询的注册视图。
 *
 * 适配规则：
 * - fieldId = ClarificationField 字段名
 * - destination = 'project-intake'
 * - tier = defaultCategory
 * - title/description/impactScope/questionType/quickOptions 从 CardDefinition 映射
 * - defaultValue 从 CardDefinition.defaultValue 映射（null 时不设 defaultValue）
 */
export function adaptProjectIntakeCatalog(
  catalog: Record<
    string,
    {
      field: string
      defaultCategory: ClarificationTier
      title: string
      description: string
      impactScope: readonly { domain: string; severity: ClarificationImpactSeverity }[]
      questionType: CopilotClarificationQuestionType
      quickOptions: readonly { label: string; value: string | number; recommended?: boolean }[]
      defaultValue: {
        value: string | number | readonly (string | number)[]
        marker: { source: string; reason: string; confidence: number; needsConfirmation: boolean }
      } | null
      defaultConfidence: number
      defaultReasoning: string
    }
  >,
): readonly RegisteredClarificationField[] {
  return Object.values(catalog).map((card) => ({
    fieldId: card.field,
    destination: 'project-intake',
    tier: card.defaultCategory,
    title: card.title,
    description: card.description,
    impactScope: card.impactScope.map((s) => ({ domain: s.domain, severity: s.severity })),
    questionType: card.questionType,
    quickOptions: card.quickOptions.map((o) => ({
      label: o.label,
      value: o.value,
      ...(o.recommended !== undefined ? { recommended: o.recommended } : {}),
    })),
    ...(card.defaultValue
      ? {
          defaultValue: {
            value: card.defaultValue.value,
            sourceStrength: mapDefaultConfidenceToSourceStrength(card.defaultConfidence),
            reason: card.defaultValue.marker.reason,
          },
        }
      : {}),
  }))
}

/**
 * 从旧版 confidence 数值映射到新的 sourceStrength 档位。
 * 这是适配层，不影响实际运行时行为。
 */
function mapDefaultConfidenceToSourceStrength(
  confidence: number,
):
  | 'domain_standard'
  | 'organization_config'
  | 'project_history'
  | 'catalog_median'
  | 'unsupported_guess' {
  if (confidence >= 85) return 'domain_standard'
  if (confidence >= 70) return 'organization_config'
  if (confidence >= 60) return 'project_history'
  if (confidence >= 40) return 'catalog_median'
  return 'unsupported_guess'
}

/**
 * 按 severity 排序的便捷函数（任务 3.5）。
 * 高影响在前；同 severity 按 tier（critical 优先）；再按 fieldId 字典序。
 */
export { sortClarificationQuestionsByImpact }
