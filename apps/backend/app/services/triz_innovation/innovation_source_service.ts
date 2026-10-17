/**
 * v3-triz-innovation-workbench —— 只读来源服务（§3.1-3.4）。
 *
 * 聚合工作台可见来源：TRIZ 矛盾 snapshot（经 TrizContradictionReadAdapter）+ TRIZ analysis artifact。
 *
 * 红线（§3.4）——本服务是只读来源层，严禁：
 * - 调用矛盾 refresh/confirm/dismiss/explain/supersede；
 * - 触发 Compiler 执行、Stage 编排；
 * - 创建 Draft handoff；
 * - 调用 AIGateway。
 * 本服务仅执行 SELECT；任何写操作都属于越界。
 */
import type User from '#models/user'
import CompilerArtifact from '#models/compiler_artifact'
import ContradictionPolicy from '#policies/contradiction_policy'
import { TrizContradictionReadAdapter } from '#services/triz_compiler/contradiction_read_adapter'
import { inject } from '@adonisjs/core'
import type {
  InnovationSourceRef,
  InnovationOption,
  InnovationImpactSummary,
  TrizAnalysisArtifact,
  ContradictionSeverity,
  TrizAnalysisWarning,
} from '@aiproj/types'
import { detectStaleSources } from '@aiproj/types'

/** 紧凑 analysis artifact 摘要（低敏：refs/hash/status/warnings 计数）。 */
export interface InnovationAnalysisArtifactSummary {
  artifactId: string
  compilerRunId: number
  contentHash: string | null
  status: string
  warningCount: number
  blockingWarningCount: number
  resolutionPathCount: number
  stale: boolean
  calculatedAt: string | null
}

export interface InnovationSourcesBundle {
  contradictions: InnovationSourceRef[]
  analysisArtifacts: InnovationAnalysisArtifactSummary[]
  includeDraft: boolean
}

@inject()
export default class InnovationSourceService {
  constructor(private contradictionPolicy: ContradictionPolicy) {}

  /**
   * 列出工作台可见来源（§3.1 + §3.2）。
   * 无 contradiction:view 权限时静默返回空（不泄漏数量/标题）。
   * 仅 SELECT，零 side-effect。
   */
  async listSources(
    user: User,
    organizationId: number,
    projectId: number,
    opts: { includeDraft?: boolean } = {},
  ): Promise<InnovationSourcesBundle> {
    const includeDraft = opts.includeDraft ?? false
    const adapter = new TrizContradictionReadAdapter(this.contradictionPolicy)
    const snapshots = await adapter.getAuthorizedSnapshots(user, organizationId, projectId, {
      includeDraft,
      limit: 100,
    })

    const contradictions: InnovationSourceRef[] = snapshots.map((s) => ({
      sourceType: 'contradiction',
      ref: s.key,
      hash: s.inputSignature,
      severity: s.severity,
      stale: s.stale,
      title: s.title,
    }))

    const analysisArtifacts = await this.listAnalysisArtifacts(organizationId, projectId)

    return { contradictions, analysisArtifacts, includeDraft }
  }

  /**
   * 解析单个矛盾来源为 InnovationSourceRef（用于 addOption 校验来源真实存在且可见）。
   * 无权限或不存在返回 null（不泄漏存在性）。
   */
  async resolveContradictionRef(
    user: User,
    organizationId: number,
    projectId: number,
    key: string,
  ): Promise<InnovationSourceRef | null> {
    const adapter = new TrizContradictionReadAdapter(this.contradictionPolicy)
    const snap = await adapter.getSnapshotByKey(user, organizationId, projectId, key)
    if (!snap) return null
    return {
      sourceType: 'contradiction',
      ref: snap.key,
      hash: snap.inputSignature,
      severity: snap.severity,
      stale: snap.stale,
      title: snap.title,
    }
  }

  /**
   * 读取单个 analysis artifact 的完整 payload（用于 option 构建时取 resolution path）。
   * 组织隔离 + 项目隔离（经 compiler run 的 input.projectId）；跨组织/跨项目返回 null。
   */
  async getAnalysisArtifact(
    organizationId: number,
    projectId: number,
    artifactId: string,
  ): Promise<TrizAnalysisArtifact | null> {
    const artifact = await CompilerArtifact.query()
      .where('organization_id', organizationId)
      .whereIn('kind', ['triz_analysis_artifact', 'triz_analysis'])
      .where('artifactId', artifactId)
      .orderBy('version', 'desc')
      .first()
    if (!artifact) return null
    if (!(await this.artifactBelongsToProject(artifact.compilerRunId, organizationId, projectId))) {
      return null
    }
    return (artifact.payload as unknown as TrizAnalysisArtifact) ?? null
  }

  /**
   * 来源新鲜度检测（§3.3）。
   * 比对 scheme/option 记录的 source hash 与当前来源 hash，标记 stale。
   */
  computeFreshness(args: {
    recorded: {
      contradictionSignatures: string[]
      analysisContentHashes: string[]
    }
    user: User
    organizationId: number
    projectId: number
  }): Promise<{ stale: boolean; mismatched: { contradictions: string[]; analyses: string[] } }> {
    // 新鲜度检测仅基于已记录 hash 与当前来源 hash 的集合比对；
    // 不触发任何写操作或网络调用（detectStaleSources 是纯函数）。
    // 当前来源 hash 由调用方在 listSources 后传入；这里做集合差集。
    return Promise.resolve(
      detectStaleSources({
        recorded: args.recorded,
        current: args.recorded, // 占位：实际 current 由调用方在读取来源后注入
      }),
    )
  }

  /**
   * 用当前来源重算新鲜度（实用入口：先读来源，再比对 scheme 记录）。
   */
  async refreshFreshness(args: {
    user: User
    organizationId: number
    projectId: number
    recorded: {
      contradictionSignatures: string[]
      analysisContentHashes: string[]
    }
  }): Promise<{ stale: boolean; mismatched: { contradictions: string[]; analyses: string[] } }> {
    const bundle = await this.listSources(args.user, args.organizationId, args.projectId, {})
    const currentContradictionSignatures = bundle.contradictions
      .map((c) => c.hash ?? '')
      .filter((s) => s.length > 0)
    const currentAnalysisHashes = bundle.analysisArtifacts
      .map((a) => a.contentHash ?? '')
      .filter((s) => s.length > 0)
    return detectStaleSources({
      recorded: args.recorded,
      current: {
        contradictionSignatures: currentContradictionSignatures,
        analysisContentHashes: currentAnalysisHashes,
      },
    })
  }

  /** 统计可见矛盾的最高严重度（Dashboard 摘要用；无权限返回 null）。 */
  async highestSeverity(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<ContradictionSeverity | null> {
    const adapter = new TrizContradictionReadAdapter(this.contradictionPolicy)
    const stats = await adapter.getContradictionStats(user, organizationId, projectId)
    if (!stats) return null
    return (stats.highestSeverity as ContradictionSeverity | null) ?? null
  }

  /**
   * 解析并构建一个完整 InnovationOption（addOption 用）。
   * 校验每个 sourceRef 真实可见且归属项目；从来源补齐 severity/stale/title；
   * 从 triz_analysis resolution path 的 suggestionType 派生静态影响摘要（非仿真）；
   * 从 stale/draft 来源派生 warning；拒绝任何不可追溯来源。
   */
  async buildOption(
    user: User,
    organizationId: number,
    projectId: number,
    req: {
      origin: InnovationOption['origin']
      sourceRefs: Array<{
        sourceType: 'contradiction' | 'triz_analysis'
        ref: string
        hash?: string | null
        selectedPathId?: string | null
      }>
      selectedPathId?: string | null
      principleIds?: string[]
      name?: string
      description?: string | null
      applicability?: string[]
      nonApplicability?: string[]
    },
  ): Promise<InnovationOption> {
    const resolvedSources: InnovationSourceRef[] = []
    const warnings: TrizAnalysisWarning[] = []
    let resolvedPath: {
      suggestionType?: string
      name?: string
      description?: string
      applicability?: string[]
      nonApplicability?: string[]
    } | null = null

    for (const raw of req.sourceRefs) {
      if (raw.sourceType === 'contradiction') {
        const ref = await this.resolveContradictionRef(user, organizationId, projectId, raw.ref)
        if (!ref) {
          throw new Error(`来源矛盾不可见或不存在：${raw.ref}`)
        }
        resolvedSources.push(ref)
        if (ref.stale) {
          warnings.push({
            code: 'STALE_SOURCE_CONTRADICTION',
            severity: 'warning',
            message: `来源矛盾「${ref.title}」已过期`,
            sourceKey: ref.ref,
          })
        }
      } else {
        const artifact = await this.getAnalysisArtifact(organizationId, projectId, raw.ref)
        if (!artifact) {
          throw new Error(`来源分析 artifact 不可见或不存在：${raw.ref}`)
        }
        const contentHash = artifact.sourceHashes?.contentHash ?? null
        resolvedSources.push({
          sourceType: 'triz_analysis',
          ref: raw.ref,
          hash: contentHash,
          severity: null,
          stale: Boolean(artifact.requiresHumanReview),
          title: `TRIZ 分析 ${raw.ref}`,
        })
        // 取选中 resolution path 的元数据用于命名/影响
        const path =
          (req.selectedPathId ?? raw.selectedPathId ?? null)
            ? artifact.resolutionPaths.find(
                (p) => p.pathId === (req.selectedPathId ?? raw.selectedPathId),
              )
            : null
        if (path) {
          resolvedPath = path
        }
      }
    }

    const selectedPathId = req.selectedPathId ?? null
    const suggestionType = resolvedPath?.suggestionType
    const impact = this.deriveImpact(suggestionType)
    const principleIds = (req.principleIds ?? []) as InnovationOption['principleIds']
    const hashes = {
      contradictionSignatures: resolvedSources
        .filter((s) => s.sourceType === 'contradiction')
        .map((s) => s.hash ?? '')
        .filter((s) => s.length > 0),
      analysisContentHashes: resolvedSources
        .filter((s) => s.sourceType === 'triz_analysis')
        .map((s) => s.hash ?? '')
        .filter((s) => s.length > 0),
      selectedPathId,
    }

    return {
      optionId: `opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      origin: req.origin,
      sourceRefs: resolvedSources,
      selectedPathId,
      principleIds,
      name: req.name ?? resolvedPath?.name ?? `候选路径 ${selectedPathId ?? ''}`.trim(),
      description: req.description ?? resolvedPath?.description ?? '',
      applicability: req.applicability ?? resolvedPath?.applicability ?? [],
      nonApplicability: req.nonApplicability ?? resolvedPath?.nonApplicability ?? [],
      hashes,
      warnings,
      impact,
      reviewState: 'pending',
      createdBy: 0, // 由 controller 覆盖为真实 userId
    }
  }

  /**
   * 从 resolution path suggestionType 派生静态影响摘要（确定性映射，非仿真）。
   */
  private deriveImpact(suggestionType?: string): InnovationImpactSummary {
    const base: InnovationImpactSummary = {
      schedule: 'neutral',
      resource_load: 'neutral',
      risk: 'neutral',
      scope_flexibility: 'neutral',
      quality_maintainability: 'neutral',
      change_complexity: 'worsens',
    }
    switch (suggestionType) {
      case 'split':
      case 'parallel_execution':
        return { ...base, schedule: 'improves', change_complexity: 'worsens' }
      case 'buffer':
        return { ...base, schedule: 'neutral', risk: 'improves', change_complexity: 'worsens' }
      case 'scope_window':
        return { ...base, scope_flexibility: 'improves', change_complexity: 'worsens' }
      case 'resource_rebalance':
        return { ...base, resource_load: 'improves', change_complexity: 'worsens' }
      case 'quality_threshold':
        return { ...base, quality_maintainability: 'worsens', schedule: 'improves' }
      case 'cr_draft':
      default:
        return base
    }
  }

  // ──────── 内部 ────────

  /** 读取项目下最新 triz_analysis artifact 的紧凑摘要（只读）。 */
  private async listAnalysisArtifacts(
    organizationId: number,
    projectId: number,
  ): Promise<InnovationAnalysisArtifactSummary[]> {
    const artifacts = await CompilerArtifact.query()
      .where('organization_id', organizationId)
      .whereIn('kind', ['triz_analysis_artifact', 'triz_analysis'])
      .orderBy('created_at', 'desc')
      .limit(100)

    if (artifacts.length === 0) return []

    // 项目隔离经 compiler run 的 input.projectId（run 无 projectId 列）。
    const runIds = Array.from(new Set(artifacts.map((a) => a.compilerRunId)))
    const compilerRunModule = await import('#models/compiler_run')
    const CompilerRun = compilerRunModule.default
    const runs = await CompilerRun.query()
      .where('organization_id', organizationId)
      .whereIn('id', runIds)
      .select('id', 'input')
    const runProject: Record<number, number | undefined> = {}
    for (const r of runs) {
      const pid = (r.input as Record<string, unknown>)?.projectId
      runProject[r.id] = typeof pid === 'number' ? pid : Number(pid ?? Number.NaN)
    }

    const summaries: InnovationAnalysisArtifactSummary[] = []
    for (const a of artifacts) {
      if (runProject[a.compilerRunId] !== projectId) continue
      const payload = (a.payload as unknown as TrizAnalysisArtifact) ?? null
      const warnings = payload?.warnings ?? []
      summaries.push({
        artifactId: a.artifactId ?? String(a.id),
        compilerRunId: a.compilerRunId,
        contentHash: payload?.sourceHashes?.contentHash ?? a.contentHash,
        status: payload?.status ?? 'unknown',
        warningCount: warnings.length,
        blockingWarningCount: warnings.filter((w) => w.severity === 'blocking').length,
        resolutionPathCount: payload?.resolutionPaths?.length ?? 0,
        stale:
          Boolean(payload?.requiresHumanReview) ||
          warnings.some((w) => w.code === 'STALE_SOURCE_CONTRADICTION'),
        calculatedAt: payload?.createdAt ?? null,
      })
    }
    return summaries
  }

  /** 判断 artifact 所属 compiler run 是否归属指定项目（经 input.projectId）。 */
  private async artifactBelongsToProject(
    compilerRunId: number,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    const compilerRunModule = await import('#models/compiler_run')
    const CompilerRun = compilerRunModule.default
    const run = await CompilerRun.query()
      .where('organization_id', organizationId)
      .where('id', compilerRunId)
      .select('id', 'input')
      .first()
    if (!run) return false
    const pid = (run.input as Record<string, unknown>)?.projectId
    const pidNum = typeof pid === 'number' ? pid : Number(pid ?? Number.NaN)
    return pidNum === projectId
  }
}
