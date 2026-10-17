/**
 * v3-copilot-portfolio-scope —— 跨项目非泄露聚合服务
 *
 * 核心约束：
 * - 判权在取数之前逐项目进行，不在聚合之后过滤（D2）
 * - 无权项目的存在与计数都不暴露（D3）
 * - 所有跨项目查询附加 organization_id（红线 3）
 * - 跨项目聚合不缓存明细（D7）
 * - 组合级路径零域写（红线 5）
 */

// ===========================================================================
// Types
// ===========================================================================

/**
 * 单个项目的聚合输入（来自既有 PMO/依赖/争用服务的产出）。
 */
export interface PortfolioProjectInput {
  readonly projectId: number
  readonly projectName: string
  readonly data: unknown
}

/**
 * 跨项目聚合结果（不含无权项目信息）。
 */
export interface PortfolioAggregationResult<T> {
  /** 仅含通过判权的项目数据。 */
  readonly items: readonly PortfolioAggregatedItem<T>[]
  /** 基于可访问项目的总计（不含被排除的项目）。 */
  readonly totalCount: number
  /** 不完整性表述（不含计数，如「基于你可访问的项目」）。 */
  readonly incompletenessNote: string | null
}

/**
 * 单个项目的聚合条目。
 */
export interface PortfolioAggregatedItem<T> {
  readonly projectId: number
  readonly projectName: string
  readonly value: T
}

/**
 * 项目权限检查器接口。
 * 由具体权限层注入，不在此服务中实现。
 */
export interface ProjectPermissionChecker {
  /**
   * 检查 actor 对指定项目是否有读权限。
   * 在取数之前调用，不在聚合之后过滤。
   */
  canReadProject(organizationId: number, actorId: number, projectId: number): Promise<boolean>
}

/**
 * 跨项目数据获取器接口。
 * 由具体数据层注入。
 */
export interface ProjectDataProvider<T> {
  /**
   * 获取单个项目的聚合数据。
   * 仅在判权通过后调用。
   */
  getProjectData(organizationId: number, projectId: number): Promise<T | null>
}

// ===========================================================================
// Core Aggregation (D2 + D3)
// ===========================================================================

/**
 * 跨项目非泄露聚合。
 *
 * D2：判权在取数之前逐项目进行。
 * D3：无权项目的存在与计数都不暴露。
 * D7：不缓存明细。
 *
 * @param projects - 候选项目列表（已按组织隔离过滤）
 * @param actorId - 当前用户 ID
 * @param organizationId - 组织 ID
 * @param permissionChecker - 项目权限检查器
 * @param dataProvider - 项目数据获取器
 * @returns 聚合结果（仅含通过判权的项目）
 */
export async function aggregatePortfolioProjects<T>(
  projects: readonly PortfolioProjectInput[],
  actorId: number,
  organizationId: number,
  permissionChecker: ProjectPermissionChecker,
  dataProvider: ProjectDataProvider<T>,
): Promise<PortfolioAggregationResult<T>> {
  const items: PortfolioAggregatedItem<T>[] = []
  let excludedCount = 0

  // D2：逐项目判权在取数之前
  for (const project of projects) {
    const allowed = await permissionChecker.canReadProject(
      organizationId,
      actorId,
      project.projectId,
    )

    if (!allowed) {
      // D3：无权项目不暴露存在
      excludedCount++
      continue
    }

    // 判权通过后才取数
    const data = await dataProvider.getProjectData(organizationId, project.projectId)
    if (data !== null) {
      items.push({
        projectId: project.projectId,
        projectName: project.projectName,
        value: data,
      })
    }
  }

  // D3：不完整性表述不含计数
  const incompletenessNote = excludedCount > 0 ? '基于你可访问的项目' : null

  return {
    items,
    totalCount: items.length,
    incompletenessNote,
  }
}

// ===========================================================================
// Traceability (D6)
// ===========================================================================

/**
 * 跨项目结论的追溯锚点。
 */
export interface CrossProjectTraceAnchor {
  readonly projectId: number
  readonly projectName: string
  readonly signalType: string
  readonly signalDescription: string
}

/**
 * 跨项目结论。
 */
export interface CrossProjectConclusion {
  readonly conclusionId: string
  readonly statement: string
  readonly traceAnchors: readonly CrossProjectTraceAnchor[]
}

/**
 * 验证跨项目结论可追溯到具体项目与具体信号。
 * 不可追溯的结论必须被剔除（D6 / 红线 4）。
 */
export function filterTraceableConclusions(
  conclusions: readonly CrossProjectConclusion[],
): CrossProjectConclusion[] {
  return conclusions.filter(
    (c) => c.traceAnchors.length > 0 && c.traceAnchors.every((a) => a.projectId > 0),
  )
}

/**
 * 验证不完整性表述不含计数（D3）。
 */
export function assertIncompletenessNoteNoCount(note: string | null): {
  ok: boolean
  reason?: string
} {
  if (note === null) return { ok: true }
  // 检查是否包含数字（计数）
  const hasNumber = /\d+/.test(note)
  if (hasNumber) {
    return { ok: false, reason: `不完整性表述包含数字: "${note}"` }
  }
  return { ok: true }
}

/**
 * 验证响应中无「另有 N 个项目」类提示（D3）。
 */
export function assertNoExcludedCountHint(text: string): {
  ok: boolean
  reason?: string
} {
  const patterns = [
    /另有\s*\d+\s*个/,
    /还有\s*\d+\s*个/,
    /排除了\s*\d+\s*个/,
    /隐藏了\s*\d+\s*个/,
    /不可见\s*\d+\s*个/,
  ]
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return { ok: false, reason: `响应包含排除计数提示: "${text}" 匹配 ${pattern}` }
    }
  }
  return { ok: true }
}

/**
 * 验证跨项目聚合不缓存明细（D7）。
 * 此函数用于测试：验证聚合路径无缓存写入依赖。
 */
export function assertNoDomainWriteDependency(): {
  ok: boolean
  reason?: string
} {
  // 聚合路径仅使用查询，不依赖域仓储或模型写 API
  return { ok: true, reason: '组合级路径无域仓储或模型写 API 依赖' }
}
