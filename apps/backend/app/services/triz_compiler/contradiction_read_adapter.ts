/**
 * v2-triz-compiler-analysis-layer —— 矛盾只读 Adapter（tasks 3.1-3.3）。
 *
 * 从 TRIZ 矛盾模型读取已确认/最新候选矛盾的低敏 snapshot。
 * Compiler 只能通过此 Adapter 消费矛盾数据。
 * 严格禁止调用 refresh、confirm、dismiss、explain 等写操作。
 */
import ProjectContradiction from '#models/project_contradiction'
import type ContradictionPolicy from '#policies/contradiction_policy'
import type User from '#models/user'
import type { ContradictionStatus } from '@aiproj/types'
import { isInventivePrincipleId, type TrizAnalysisSourceRef } from '@aiproj/types'

export interface ContradictionReadOptions {
  /** 是否包含 draft 待确认候选（默认 false — 仅 confirmed） */
  includeDraft?: boolean
  /** 最多返回矛盾数量（默认 50） */
  limit?: number
  /** 按严重度降序排序（默认 true） */
  sortBySeverity?: boolean
}

export class TrizContradictionReadAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrizContradictionReadAdapterError'
  }
}

/**
 * TrizContradictionReadAdapter —— Compiler 对 TRIZ 矛盾的只读访问层。
 *
 * - 强制执行 organizationId、projectId、contradiction:view 权限
 * - 只返回低敏 ref（不包含完整 evidence、AI 解释正文、敏感路径等）
 * - 禁止调用矛盾 refresh/confirm/dismiss/explain/supersede
 */
export class TrizContradictionReadAdapter {
  constructor(private policy: ContradictionPolicy) {}

  /**
   * 读取当前用户可见的 contradictions 低敏 snapshot。
   * 权限不足时静默返回空数组（不泄漏数量/标题）。
   */
  async getAuthorizedSnapshots(
    user: User,
    organizationId: number,
    projectId: number,
    options: ContradictionReadOptions = {},
  ): Promise<TrizAnalysisSourceRef[]> {
    const { includeDraft = false, limit = 50, sortBySeverity = true } = options

    // 1. 权限检查 — 无 contradiction:view 则静默返回空
    const canView = await this.policy.view(user, organizationId, projectId)
    if (!canView) {
      return []
    }

    // 2. 构建查询（只读，不触发任何 side-effect）
    const statuses: ContradictionStatus[] = ['confirmed']
    if (includeDraft) {
      statuses.push('draft')
    }

    const query = ProjectContradiction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereIn('status', statuses)
      .select(
        'id',
        'key',
        'title',
        'type',
        'status',
        'severity',
        'confidence',
        'stale',
        'stale_reason',
        'rule_version',
        'input_signature',
        'output_hash',
        'improving_parameter_key',
        'worsening_parameter_key',
        'parameter_key',
        'requirement_a',
        'requirement_b',
        'suggested_principles',
        'evidence',
        'created_at',
        'updated_at',
      )

    // 按严重度降序（critical → high → medium → low）
    if (sortBySeverity) {
      query.orderByRaw(
        "CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END",
      )
      // 同严重度内按置信度降序
      query.orderBy('confidence', 'desc')
    }

    query.limit(Math.min(limit, 200)) // 上限 200

    const contradictions = await query

    // 3. 映射为低敏 ref
    return contradictions.map((c) => this.toLowSensitivityRef(c))
  }

  /**
   * 查询单个矛盾的低敏 ref（用于 detail/handoff 等场景）。
   * 无权限时返回 null（不泄漏存在性）。
   */
  async getSnapshotByKey(
    user: User,
    organizationId: number,
    projectId: number,
    key: string,
  ): Promise<TrizAnalysisSourceRef | null> {
    const canView = await this.policy.view(user, organizationId, projectId)
    if (!canView) return null

    const contradiction = await ProjectContradiction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('key', key)
      .first()

    if (!contradiction) return null
    return this.toLowSensitivityRef(contradiction)
  }

  /**
   * 检查项目是否有可见的矛盾（用于 Compiler 预判是否应加入 TRIZ stage）。
   * 无权限时同样静默返回 false。
   */
  async hasVisibleContradictions(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    const canView = await this.policy.view(user, organizationId, projectId)
    if (!canView) return false

    const count = await ProjectContradiction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereIn('status', ['confirmed'])
      .limit(1)
      .count('* as count')

    return (count[0].$extras?.count ?? 0) > 0
  }

  /**
   * 获取矛盾统计（仅已确认的矛盾，用于 Dashboard 摘要）。
   */
  async getContradictionStats(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<{
    totalConfirmed: number
    highestSeverity: string | null
    staleCount: number
  } | null> {
    const canView = await this.policy.view(user, organizationId, projectId)
    if (!canView) return null

    const rows = await ProjectContradiction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereIn('status', ['confirmed'])
      .select('severity', 'stale')

    let highestSeverity: string | null = null
    let staleCount = 0

    for (const row of rows) {
      if (row.stale) staleCount++
      if (
        !highestSeverity ||
        row.severity === 'critical' ||
        (row.severity === 'high' && highestSeverity !== 'critical')
      ) {
        highestSeverity = row.severity
      }
    }

    return {
      totalConfirmed: rows.length,
      highestSeverity,
      staleCount,
    }
  }

  // ── Private Helpers ──

  /**
   * 将矛盾记录映射为低敏 Compiler ref。
   * 不包含：完整 evidence 正文、AI 解释全文、敏感文件路径等。
   *
   * 注意：ProjectContradiction 是 Lucid 模型实例，列名 snake_case 通过 @column 映射为
   * camelCase 属性，故此处必须用 camelCase（inputSignature / outputHash / ruleVersion 等）读取；
   * 早期用 snake_case 访问会得到 undefined（签名/hash/参数 key 全空），已修正。
   */
  private toLowSensitivityRef(contradiction: any): TrizAnalysisSourceRef {
    // 只提取 evidence refs（不包含完整证据正文）
    const rawEvidence = contradiction.evidence ?? []
    const evidenceRefs: string[] = Array.isArray(rawEvidence)
      ? rawEvidence.map((_: any, i: number) => `ev:${String(contradiction.key)}:${i}`)
      : []

    // 提取建议原理的轻量 ref
    const rawPrinciples = contradiction.suggestedPrinciples ?? []
    const suggestedPrinciples = Array.isArray(rawPrinciples)
      ? rawPrinciples.flatMap((p: any) => {
          const principleId = String(p.principleId ?? p.principle_id ?? '')
          if (!isInventivePrincipleId(principleId)) return []
          return [
            {
              principleId,
              name: String(p.name ?? ''),
            },
          ]
        })
      : []

    return {
      key: String(contradiction.key ?? ''),
      title: String(contradiction.title ?? ''),
      type: contradiction.type ?? 'technical',
      status: contradiction.status ?? 'draft',
      severity: contradiction.severity ?? 'medium',
      confidence: Number(contradiction.confidence ?? 0),
      stale: Boolean(contradiction.stale ?? false),
      staleReason: contradiction.staleReason ?? null,
      ruleVersion: String(contradiction.ruleVersion ?? ''),
      inputSignature: String(contradiction.inputSignature ?? ''),
      outputHash: contradiction.outputHash ?? null,
      improvingParameterKey: contradiction.improvingParameterKey ?? null,
      worseningParameterKey: contradiction.worseningParameterKey ?? null,
      parameterKey: contradiction.parameterKey ?? null,
      requirementA: contradiction.requirementA ?? null,
      requirementB: contradiction.requirementB ?? null,
      suggestedPrinciples,
      evidenceRefs,
      contradictionId: Number(contradiction.id ?? 0),
    }
  }
}
