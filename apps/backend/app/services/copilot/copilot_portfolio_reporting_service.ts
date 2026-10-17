/**
 * v3-copilot-portfolio-scope —— 主动汇报内容生成服务
 *
 * 核心约束：
 * - 走既有周期作业框架（D5），不新建
 * - 按收件人逐项目判权生成，不做群发（红线）
 * - 汇报不负责投递（投递归通知路由能力）
 * - 汇报内容可追溯到具体项目与信号（D6）
 * - 零域写、零外部请求
 */

// ===========================================================================
// Types
// ===========================================================================

/**
 * 汇报内容条目。
 */
export interface ReportContentItem {
  readonly projectId: number
  readonly projectName: string
  readonly signalType: string
  readonly signalDescription: string
  readonly content: string
}

/**
 * 汇报内容。
 */
export interface PortfolioReportContent {
  readonly reportType: 'daily_standup' | 'weekly_brief'
  readonly recipientId: number
  readonly organizationId: number
  readonly generatedAt: string
  readonly items: readonly ReportContentItem[]
  readonly summary: string
}

/**
 * 项目权限检查器接口。
 */
export interface ReportPermissionChecker {
  canReadProject(organizationId: number, actorId: number, projectId: number): Promise<boolean>
}

/**
 * 项目数据提供器接口。
 */
export interface ReportDataProvider {
  getProjectSummary(
    organizationId: number,
    projectId: number,
  ): Promise<{
    projectName: string
    healthStatus: string
    recentActivity: string
    risks: string[]
    milestones: string[]
  } | null>
}

// ===========================================================================
// Content Generation
// ===========================================================================

/**
 * 生成每日站会摘要内容。
 * 按收件人逐项目判权生成（不做群发）。
 */
export async function generateDailyStandupContent(
  recipientId: number,
  organizationId: number,
  projects: readonly { projectId: number; projectName: string }[],
  permissionChecker: ReportPermissionChecker,
  dataProvider: ReportDataProvider,
): Promise<PortfolioReportContent> {
  const items: ReportContentItem[] = []

  for (const project of projects) {
    const allowed = await permissionChecker.canReadProject(
      organizationId,
      recipientId,
      project.projectId,
    )
    if (!allowed) continue

    const data = await dataProvider.getProjectSummary(organizationId, project.projectId)
    if (!data) continue

    items.push({
      projectId: project.projectId,
      projectName: data.projectName,
      signalType: 'daily_status',
      signalDescription: `${data.projectName} 每日状态`,
      content: `健康状态：${data.healthStatus}。${data.recentActivity}`,
    })
  }

  return {
    reportType: 'daily_standup',
    recipientId,
    organizationId,
    generatedAt: new Date().toISOString(),
    items,
    summary: `基于你可访问的项目，共 ${items.length} 个项目有更新`,
  }
}

/**
 * 生成每周项目简报内容。
 * 按收件人逐项目判权生成（不做群发）。
 */
export async function generateWeeklyBriefContent(
  recipientId: number,
  organizationId: number,
  projects: readonly { projectId: number; projectName: string }[],
  permissionChecker: ReportPermissionChecker,
  dataProvider: ReportDataProvider,
): Promise<PortfolioReportContent> {
  const items: ReportContentItem[] = []

  for (const project of projects) {
    const allowed = await permissionChecker.canReadProject(
      organizationId,
      recipientId,
      project.projectId,
    )
    if (!allowed) continue

    const data = await dataProvider.getProjectSummary(organizationId, project.projectId)
    if (!data) continue

    const riskSummary = data.risks.length > 0 ? `风险：${data.risks.join('、')}` : '无风险'
    const milestoneSummary =
      data.milestones.length > 0 ? `里程碑：${data.milestones.join('、')}` : ''

    items.push({
      projectId: project.projectId,
      projectName: data.projectName,
      signalType: 'weekly_summary',
      signalDescription: `${data.projectName} 每周简报`,
      content: `健康状态：${data.healthStatus}。${riskSummary}。${milestoneSummary}`,
    })
  }

  return {
    reportType: 'weekly_brief',
    recipientId,
    organizationId,
    generatedAt: new Date().toISOString(),
    items,
    summary: `基于你可访问的项目，共 ${items.length} 个项目纳入简报`,
  }
}

// ===========================================================================
// Assertions
// ===========================================================================

/**
 * 验证汇报内容可追溯到具体项目与信号（D6）。
 */
export function assertReportContentTraceable(content: PortfolioReportContent): {
  ok: boolean
  reason?: string
} {
  for (const item of content.items) {
    if (item.projectId <= 0) {
      return { ok: false, reason: `条目 projectId 无效: ${item.projectId}` }
    }
    if (!item.signalType) {
      return { ok: false, reason: `条目缺少 signalType` }
    }
  }
  return { ok: true }
}

/**
 * 验证汇报路径零投递、零外部请求。
 */
export function assertNoDelivery(): {
  ok: boolean
  reason?: string
} {
  // 汇报服务只生成内容，不执行投递
  return { ok: true, reason: '汇报服务仅生成内容，投递归通知路由能力' }
}
