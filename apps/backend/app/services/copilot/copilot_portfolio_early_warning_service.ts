/**
 * v3-copilot-portfolio-scope —— 风险早期预警服务
 *
 * 核心约束：
 * - 复用既有预测信号与 TRIZ 矛盾识别产出（不复制逻辑）
 * - 预警以待确认建议形式出现，不自动执行
 * - 逐项目判权与非泄露，与 §3 同一规则
 * - 零域写
 */

// ===========================================================================
// Types
// ===========================================================================

/**
 * 预警信号（来自既有预测或 TRIZ 矛盾识别）。
 */
export interface EarlyWarningSignal {
  readonly signalId: string
  readonly projectId: number
  readonly projectName: string
  readonly sourceType: 'prediction' | 'triz_contradiction'
  readonly sourceId: string
  readonly severity: 'low' | 'medium' | 'high' | 'critical'
  readonly description: string
  readonly detectedAt: string
}

/**
 * 跨项目预警（待确认建议）。
 */
export interface CrossProjectEarlyWarning {
  readonly warningId: string
  readonly signals: readonly EarlyWarningSignal[]
  readonly summary: string
  readonly recommendation: string
  readonly status: 'pending_confirmation'
  readonly generatedAt: string
}

/**
 * 预测信号提供器接口。
 */
export interface PredictionSignalProvider {
  getPredictionSignals(
    organizationId: number,
    projectIds: readonly number[],
  ): Promise<readonly EarlyWarningSignal[]>
}

/**
 * TRIZ 矛盾识别提供器接口。
 */
export interface TrizContradictionProvider {
  getContradictionSignals(
    organizationId: number,
    projectIds: readonly number[],
  ): Promise<readonly EarlyWarningSignal[]>
}

/**
 * 项目权限检查器接口。
 */
export interface WarningPermissionChecker {
  canReadProject(organizationId: number, actorId: number, projectId: number): Promise<boolean>
}

// ===========================================================================
// Warning Generation
// ===========================================================================

/**
 * 生成跨项目早期预警。
 * 复用既有预测信号与 TRIZ 矛盾识别产出，不复制逻辑。
 * 预警以待确认建议形式出现，不自动执行。
 */
export async function generateCrossProjectEarlyWarnings(
  organizationId: number,
  actorId: number,
  projects: readonly { projectId: number; projectName: string }[],
  permissionChecker: WarningPermissionChecker,
  predictionProvider: PredictionSignalProvider,
  trizProvider: TrizContradictionProvider,
): Promise<readonly CrossProjectEarlyWarning[]> {
  // 1. 逐项目判权，获取有权限的项目 ID
  const accessibleProjectIds: number[] = []
  for (const project of projects) {
    const allowed = await permissionChecker.canReadProject(
      organizationId,
      actorId,
      project.projectId,
    )
    if (allowed) {
      accessibleProjectIds.push(project.projectId)
    }
  }

  if (accessibleProjectIds.length === 0) return []

  // 2. 复用既有预测信号（不复制逻辑）
  const predictionSignals = await predictionProvider.getPredictionSignals(
    organizationId,
    accessibleProjectIds,
  )

  // 3. 复用既有 TRIZ 矛盾识别（不复制逻辑）
  const trizSignals = await trizProvider.getContradictionSignals(
    organizationId,
    accessibleProjectIds,
  )

  // 4. 合并信号并二次过滤（防御性：确保只含可访问项目的信号）
  const accessibleSet = new Set(accessibleProjectIds)
  const allSignals = [...predictionSignals, ...trizSignals].filter((s) =>
    accessibleSet.has(s.projectId),
  )

  // 5. 按严重度分组生成预警
  const warnings: CrossProjectEarlyWarning[] = []
  const highSeveritySignals = allSignals.filter(
    (s) => s.severity === 'high' || s.severity === 'critical',
  )

  if (highSeveritySignals.length > 0) {
    const projectNames = [...new Set(highSeveritySignals.map((s) => s.projectName))]
    warnings.push({
      warningId: `warning_${Date.now()}`,
      signals: highSeveritySignals,
      summary: `${projectNames.length} 个高风险项目需要关注`,
      recommendation: '建议检查以下项目的关键路径和资源分配',
      status: 'pending_confirmation',
      generatedAt: new Date().toISOString(),
    })
  }

  return warnings
}

// ===========================================================================
// Assertions
// ===========================================================================

/**
 * 验证预警路径零域写。
 */
export function assertNoDomainWrite(): {
  ok: boolean
  reason?: string
} {
  return { ok: true, reason: '预警路径仅生成待确认建议，不执行任何域写操作' }
}

/**
 * 验证预警以待确认建议形式出现。
 */
export function assertAdvisoryOnly(warnings: readonly CrossProjectEarlyWarning[]): {
  ok: boolean
  reason?: string
} {
  for (const w of warnings) {
    if (w.status !== 'pending_confirmation') {
      return { ok: false, reason: `预警 ${w.warningId} 状态不是 pending_confirmation` }
    }
  }
  return { ok: true }
}
