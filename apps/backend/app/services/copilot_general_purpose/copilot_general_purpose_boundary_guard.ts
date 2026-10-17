/**
 * Copilot 通用问答模式 — 读写双向边界守卫（v3-copilot-general-purpose-mode）
 *
 * 职责：
 * - 强制 global scope：项目作用域来源不合格且不发起查询（decision 2）
 * - 结构性禁写：不依赖领域仓储或模型写入 API（decision 2）
 * - 动作卡片在本模式下不可用（decision 2）
 * - 记忆仅允许 user scope（decision 4）
 */

import type { GeneralPurposeMemoryScope } from '@aiproj/types'

// ===========================================================================
// 读隔离守卫
// ===========================================================================

/**
 * 断言在通用模式下不发起任何项目查询。
 * 返回 read_isolated 标记——调用方据此跳过所有项目数据检索。
 *
 * 本函数不执行查询，而是返回一个判定标记，供上层调用链消费。
 * 这意味着「零条项目查询被发起」由调用链结构保证，而非运行时过滤。
 */
export function assertGlobalScopeReadIsolation(): {
  readonly scope: 'global'
  readonly projectSourcesEligible: false
  readonly projectQueryIssued: false
} {
  return {
    scope: 'global',
    projectSourcesEligible: false,
    projectQueryIssued: false,
  }
}

/**
 * 检查一个来源在 global scope 下是否合格。
 * 项目域来源一律不合格。
 */
export function isSourceEligibleInGlobalScope(sourceKind: string): boolean {
  // 项目域来源（copilot-shared-contracts.ts COPILOT_SOURCE_KINDS 项目域子集）
  const projectDomainSources = [
    'project_facts',
    'task',
    'wbs_node',
    'dependency',
    'resource_assignment',
    'risk',
    'milestone',
    'schedule',
    'scope_document',
    'project_field',
    'document',
  ]
  return !projectDomainSources.includes(sourceKind)
}

// ===========================================================================
// 写禁守卫
// ===========================================================================

/** 通用模式下被禁止的写入 API 模式（反面清单）。 */
const FORBIDDEN_WRITE_PATTERNS = [
  'Repository.create',
  'Repository.save',
  'Repository.update',
  'Repository.delete',
  'Repository.insert',
  'Model.create',
  'Model.save',
  'Model.update',
  'Model.delete',
  'draft_layer',
  'confirmAndPersist',
]

/**
 * 领域仓储/模型的命名约定：以 Repository 或 Model 结尾即视为领域写入面。
 *
 * FORBIDDEN_WRITE_PATTERNS 里的条目是**方法路径**（如 `Repository.create`），
 * 只用它判定依赖名会把 `TaskRepository`、`ProjectModel` 这类**依赖本身**放行——
 * 而 spec 「Mode has no write dependency」要禁的正是这类依赖。
 */
const FORBIDDEN_DEPENDENCY_SUFFIXES = ['repository', 'model']

/**
 * 检查一个服务依赖是否在通用模式下被允许。
 * 通用模式不依赖领域仓储或模型写入 API（spec Scenario: Mode has no write dependency）。
 */
export function isDependencyAllowedInGeneralPurposeMode(dependencyName: string): boolean {
  const normalized = dependencyName.toLowerCase()
  if (FORBIDDEN_DEPENDENCY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return false
  }
  return !FORBIDDEN_WRITE_PATTERNS.some((pattern) => normalized.includes(pattern.toLowerCase()))
}

// ===========================================================================
// 动作守卫
// ===========================================================================

/** 通用模式下不可用的动作类型。 */
const FORBIDDEN_ACTION_TYPES = ['preview', 'review-entry', 'handoff-candidate']

/**
 * 检查动作类型在通用模式下是否可用。
 * 返回 false 表示该动作在通用模式下不可用（spec Scenario: No business write is possible）。
 */
export function isActionTypeAllowedInGeneralPurpose(actionType: string): boolean {
  return !FORBIDDEN_ACTION_TYPES.includes(actionType)
}

// ===========================================================================
// 记忆 scope 守卫
// ===========================================================================

/** 通用模式下允许的记忆 scope 白名单。 */
const ALLOWED_MEMORY_SCOPES: readonly GeneralPurposeMemoryScope[] = ['user']

/**
 * 检查记忆 scope 在通用模式下是否被允许（spec Scenario: Project and organization memory are never selected）。
 */
export function isMemoryScopeAllowedInGeneralPurposeGuard(
  scope: string,
): scope is GeneralPurposeMemoryScope {
  return (ALLOWED_MEMORY_SCOPES as readonly string[]).includes(scope)
}

/**
 * 过滤记忆候选：移除项目与组织 scope 条目。
 * 通用模式下仅保留用户 scope 记忆。
 */
export function filterMemoryCandidatesForGeneralPurpose<T extends { readonly scope: string }>(
  candidates: readonly T[],
): readonly T[] {
  return candidates.filter((c) => isMemoryScopeAllowedInGeneralPurposeGuard(c.scope))
}

// ===========================================================================
// 上下文清理守卫
// ===========================================================================

/**
 * 验证切换到通用模式时项目上下文已清理（spec Scenario: Entering general mode drops project context）。
 */
export function verifyProjectContextCleared(context: Record<string, unknown>): {
  readonly cleared: boolean
  readonly remainingKeys: readonly string[]
} {
  const projectKeys = Object.keys(context).filter(
    (k) =>
      k.startsWith('project') ||
      k.startsWith('projectId') ||
      k.startsWith('organization') ||
      k === 'currentProject' ||
      k === 'projectContext',
  )
  return {
    cleared: projectKeys.length === 0,
    remainingKeys: projectKeys,
  }
}

/**
 * 验证切换回项目 scope 时通用回答不被当作项目事实（spec Scenario: Leaving general mode drops general claims）。
 */
export function verifyGeneralClaimsNotCarried(
  generalAnswers: readonly string[],
  projectFacts: readonly string[],
): {
  readonly valid: boolean
  readonly overlapCount: number
} {
  const overlap = generalAnswers.filter((a) => projectFacts.includes(a))
  return {
    valid: overlap.length === 0,
    overlapCount: overlap.length,
  }
}
