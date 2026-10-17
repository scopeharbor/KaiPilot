import { DateTime } from 'luxon'
import {
  MULTI_PROJECT_IMPACT_DEFAULTS,
  computeScopeHash,
  computeSourceFreshnessHash,
  computePermissionFingerprint,
  computeSnapshotInputHash,
  computeSnapshotOutputHash,
  fnv1aHash,
  normalizeMultiProjectImpactScope,
  classifySeverityFromDelay,
  computeBufferAbsorptionSummary,
  isBlockingMultiProjectImpactSeverity,
  detectMultiProjectImpactSnapshotStale,
  emptyMultiProjectImpactSeverityDistribution,
  makeMultiProjectImpactWarning,
  isFollowUpTargetAvailable,
  buildManualSummaryDraft,
} from '@aiproj/types'
import type {
  MultiProjectImpactScope,
  MultiProjectImpactPlan,
  MultiProjectImpactSnapshot,
  MultiProjectImpactPropagationPath,
  MultiProjectImpactAffectedEndpoint,
  MultiProjectImpactPathEntry,
  MultiProjectImpactWhatIfScenario,
  MultiProjectImpactWhatIfOutput,
  MultiProjectImpactFollowUpDraft,
  MultiProjectImpactAiExplanation,
  MultiProjectImpactWarning,
  MultiProjectImpactSeverity,
  MultiProjectImpactVisibility,
  MultiProjectImpactRedactionReason,
  MultiProjectImpactFollowUpTarget,
} from '@aiproj/types'

import MultiProjectImpactPlanModel from '#models/multi_project_impact_plan'
import MultiProjectImpactSnapshotModel from '#models/multi_project_impact_snapshot'
import type MultiProjectImpactAnalysisPolicy from '#policies/multi_project_impact_analysis_policy'
import type { ImpactPolicyActor } from '#policies/multi_project_impact_analysis_policy'
import type AuditService from '#services/audit_service'
import { isMultiProjectImpactAnalysisEnabled } from '#services/multi_project_impact_feature_flag'

// ─── Source Snapshot Reader 接口（DI 注入点） ──────────────────────

export interface DependencyFactSource {
  getActiveDependencyEdges(
    organizationId: number,
    projectIds: number[],
  ): Promise<{
    edges: Array<{
      fromType: string
      fromId: number
      fromLabel: string
      fromProjectId: number
      toType: string
      toId: number
      toLabel: string
      toProjectId: number
      relationshipType: string
      bufferDays: number
      lagDays: number
      visibility: MultiProjectImpactVisibility
      redactionReason?: MultiProjectImpactRedactionReason | null
    }>
    freshnessHash: string
  }>
}

export interface DetectionResultSource {
  getDetectionResults(
    organizationId: number,
    projectIds: number[],
  ): Promise<{ resultHashes: string[]; freshnessHash: string }>
}

export interface RiskSummarySource {
  getRiskSummaries(
    organizationId: number,
    projectIds: number[],
  ): Promise<{ summaryHashes: string[]; freshnessHash: string }>
}

export interface ResourceSummarySource {
  getResourceSummaries(
    organizationId: number,
    projectIds: number[],
  ): Promise<{ summaryHashes: string[]; freshnessHash: string }>
}

export interface OkrSummarySource {
  getOkrSummaries(
    organizationId: number,
    projectIds: number[],
  ): Promise<{ summaryHashes: string[]; freshnessHash: string }>
}

export interface BiSummarySource {
  getBiSummaries(
    organizationId: number,
    projectIds: number[],
  ): Promise<{ summaryHashes: string[]; freshnessHash: string }>
}

export interface ProjectTaskSource {
  getProjectTaskDependencyContext(
    organizationId: number,
    projectIds: number[],
  ): Promise<{
    internalDeps: Array<{
      predecessorId: number
      successorId: number
      type: string
      lagDays: number
      predecessorTaskName: string
      successorTaskName: string
      predecessorProjectId: number
      successorProjectId: number
    }>
    freshnessHash: string
  }>
}

export interface AiExplanationAdapter {
  generateExplanation(
    snapshot: MultiProjectImpactSnapshot,
    focus?: string | null,
  ): Promise<MultiProjectImpactAiExplanation>
}

// ─── 服务 ──────────────────────────────────────────────────────────

export default class MultiProjectImpactAnalysisService {
  constructor(
    private policy: MultiProjectImpactAnalysisPolicy,
    private audit: AuditService,
    private dependencyFactSource: DependencyFactSource,
    private detectionResultSource: DetectionResultSource,
    private riskSummarySource: RiskSummarySource,
    private resourceSummarySource: ResourceSummarySource,
    private okrSummarySource: OkrSummarySource,
    private biSummarySource: BiSummarySource,
    private projectTaskSource: ProjectTaskSource,
    private aiExplanationAdapter?: AiExplanationAdapter,
  ) {}

  // ─── §5.2 Analysis Plan Builder ─────────────────────────────────

  async planAnalysis(
    organizationId: number,
    scope: MultiProjectImpactScope,
    actor: ImpactPolicyActor,
  ): Promise<MultiProjectImpactPlan> {
    const normalizedScope = normalizeMultiProjectImpactScope(scope)
    const scopeHash = computeScopeHash(normalizedScope)
    const ruleVersion = MULTI_PROJECT_IMPACT_DEFAULTS.RULE_VERSION

    // 收集 source freshness
    const [depFacts, detection, risks, resources, okrs, biSummaries] = await Promise.all([
      this.dependencyFactSource.getActiveDependencyEdges(
        organizationId,
        normalizedScope.projectIds,
      ),
      this.detectionResultSource.getDetectionResults(organizationId, normalizedScope.projectIds),
      this.riskSummarySource.getRiskSummaries(organizationId, normalizedScope.projectIds),
      this.resourceSummarySource.getResourceSummaries(organizationId, normalizedScope.projectIds),
      this.okrSummarySource.getOkrSummaries(organizationId, normalizedScope.projectIds),
      this.biSummarySource.getBiSummaries(organizationId, normalizedScope.projectIds),
    ])

    const sourceFreshnessHash = computeSourceFreshnessHash({
      dependencyFactHashes: [depFacts.freshnessHash],
      detectionResultHashes: [detection.freshnessHash],
      riskSummaryHashes: [risks.freshnessHash],
      resourceSummaryHashes: [resources.freshnessHash],
      okrSummaryHashes: [okrs.freshnessHash],
      biSummaryHashes: [biSummaries.freshnessHash],
      manualExternalRefHashes: [],
    })

    const permissionFingerprint = computePermissionFingerprint({
      actorId: actor.id,
      organizationId,
      permissions: actor.permissions,
      visibleProjectIds: actor.visibleProjectIds,
    })

    const runToken = fnv1aHash(`run-${organizationId}-${scopeHash}-${Date.now()}`)
    const expiresAt = new Date(Date.now() + MULTI_PROJECT_IMPACT_DEFAULTS.PLAN_TTL_MS)

    const warnings: MultiProjectImpactWarning[] = []
    const hiddenProjects = this.policy.getHiddenProjectIds(actor, normalizedScope.projectIds)
    if (hiddenProjects.length > 0) {
      warnings.push(
        makeMultiProjectImpactWarning(
          'hidden_project_present',
          '部分项目不可见，影响分析结果将包含脱敏标记',
        ),
      )
    }

    const plan: MultiProjectImpactPlan = {
      runToken,
      scopeHash,
      ruleVersion,
      sourceFreshnessHash,
      permissionFingerprint,
      expiresAt: expiresAt.toISOString(),
      estimatedCost: {
        approximateNodes: Math.min(
          normalizedScope.projectIds.length * 50,
          normalizedScope.maxNodes,
        ),
        approximateEdges: depFacts.edges.length,
        estimatedDurationMs: Math.max(100, depFacts.edges.length * 2),
      },
      warnings,
      scope: normalizedScope,
    }

    // 持久化 plan
    await MultiProjectImpactPlanModel.create({
      organizationId,
      actorId: actor.id,
      runToken,
      scopeHash,
      ruleVersion,
      sourceFreshnessHash,
      permissionFingerprint,
      scopeJson: JSON.stringify(normalizedScope),
      expiresAt: DateTime.fromJSDate(expiresAt),
    })

    await this.audit.log({
      event: 'MULTI_PROJECT_IMPACT_PLAN' as any,
      userId: actor.id,
      organizationId,
      entityType: 'multi_project_impact_plan',
      entityId: 0,
      metadata: { scopeHash, ruleVersion, projectCount: normalizedScope.projectIds.length },
    })

    return plan
  }

  // ─── §5.3 §5.4 有界邻接表 Graph Builder + 确定性下游传播 ────────

  async runAnalysis(
    organizationId: number,
    runToken: string,
    actor: ImpactPolicyActor,
  ): Promise<MultiProjectImpactSnapshot> {
    // 验证 plan
    const planRecord = await MultiProjectImpactPlanModel.query()
      .where('organization_id', organizationId)
      .where('run_token', runToken)
      .first()

    if (!planRecord || planRecord.expiresAt < DateTime.now()) {
      throw new Error('分析计划不存在或已过期')
    }

    const scope: MultiProjectImpactScope = JSON.parse(planRecord.scopeJson)
    const scopeHash = planRecord.scopeHash
    const ruleVersion = planRecord.ruleVersion
    const permissionFingerprint = planRecord.permissionFingerprint

    // 收集 source 数据
    const [depFacts, internalDeps] = await Promise.all([
      this.dependencyFactSource.getActiveDependencyEdges(organizationId, scope.projectIds),
      this.projectTaskSource.getProjectTaskDependencyContext(organizationId, scope.projectIds),
    ])

    const sourceFreshnessHash = computeSourceFreshnessHash({
      dependencyFactHashes: [depFacts.freshnessHash],
      detectionResultHashes: [],
      riskSummaryHashes: [],
      resourceSummaryHashes: [],
      okrSummaryHashes: [],
      biSummaryHashes: [],
      manualExternalRefHashes: [],
    })

    const inputHash = computeSnapshotInputHash({
      scopeHash,
      sourceFreshnessHash,
      dependencyGraphSignature: fnv1aHash(
        `graph-${depFacts.edges.length}-${internalDeps.internalDeps.length}`,
      ),
      ruleVersion,
      permissionFingerprint,
    })

    // 构建有界邻接表
    const { propagationPaths, severityDistribution, warnings } = this.buildPropagationGraph(
      scope,
      depFacts.edges,
      internalDeps.internalDeps,
      actor,
    )

    const outputHash = computeSnapshotOutputHash(propagationPaths, severityDistribution)

    const totalAffected = propagationPaths.reduce((sum, p) => sum + p.affectedEndpoints.length, 0)
    const maxDepth = Math.max(0, ...propagationPaths.map((p) => p.depth))
    const allDelayDays = propagationPaths.flatMap((p) =>
      p.affectedEndpoints.map((ep) => ep.propagatedDelayDays),
    )
    const averageDelayDays =
      allDelayDays.length > 0 ? allDelayDays.reduce((a, b) => a + b, 0) / allDelayDays.length : 0

    const blockedEndpoints = propagationPaths.reduce(
      (sum, p) =>
        sum +
        p.affectedEndpoints.filter((ep) => isBlockingMultiProjectImpactSeverity(ep.severity))
          .length,
      0,
    )

    const now = new Date()
    const expiresAt = new Date(
      now.getTime() + MULTI_PROJECT_IMPACT_DEFAULTS.SNAPSHOT_TTL_DAYS * 24 * 3600 * 1000,
    )

    const snapshotRecord = await MultiProjectImpactSnapshotModel.create({
      organizationId,
      actorId: actor.id,
      scopeHash,
      sourceFreshnessHash,
      dependencyGraphSignature: fnv1aHash(`graph-${depFacts.edges.length}`),
      ruleVersion,
      permissionFingerprint,
      inputHash,
      outputHash,
      status: 'completed',
      sourceSummaryJson: JSON.stringify({
        sourceType: scope.sources?.[0]?.sourceType ?? 'project',
        sourceCount: scope.sources?.length ?? 0,
        projectCount: scope.projectIds.length,
      }),
      propagationSummaryJson: JSON.stringify({
        propagationPaths,
        totalAffectedEndpoints: totalAffected,
        severityDistribution,
        blockedEndpoints,
        maxDepth,
        averageDelayDays,
      }),
      warningsJson: JSON.stringify(warnings),
      evidenceReferencesJson: JSON.stringify(
        propagationPaths.flatMap((p) => p.affectedEndpoints.map((ep) => ep.evidenceHash)),
      ),
      isStale: false,
      generatedAt: DateTime.fromJSDate(now),
      expiresAt: DateTime.fromJSDate(expiresAt),
      createdBy: actor.id,
    })

    await this.audit.log({
      event: 'MULTI_PROJECT_IMPACT_RUN' as any,
      userId: actor.id,
      organizationId,
      entityType: 'multi_project_impact_snapshot',
      entityId: snapshotRecord.id,
      metadata: {
        scopeHash,
        ruleVersion,
        sourceFreshnessHash,
        totalAffected,
        severityDistribution,
        warningCodes: warnings.map((w) => w.code),
      },
    })

    return this.toSnapshotDto(snapshotRecord, propagationPaths, severityDistribution, warnings)
  }

  /**
   * 构建有界邻接表并执行确定性 BFS 传播
   */
  private buildPropagationGraph(
    scope: MultiProjectImpactScope,
    crossProjectEdges: Array<{
      fromType: string
      fromId: number
      fromLabel: string
      fromProjectId: number
      toType: string
      toId: number
      toLabel: string
      toProjectId: number
      relationshipType: string
      bufferDays: number
      lagDays: number
      visibility: MultiProjectImpactVisibility
      redactionReason?: MultiProjectImpactRedactionReason | null
    }>,
    _internalDeps: Array<{
      predecessorId: number
      successorId: number
      type: string
      lagDays: number
      predecessorTaskName: string
      successorTaskName: string
      predecessorProjectId: number
      successorProjectId: number
    }>,
    _actor: ImpactPolicyActor,
  ): {
    propagationPaths: MultiProjectImpactPropagationPath[]
    severityDistribution: Record<MultiProjectImpactSeverity, number>
    warnings: MultiProjectImpactWarning[]
  } {
    const severityDistribution = emptyMultiProjectImpactSeverityDistribution()
    const warnings: MultiProjectImpactWarning[] = []
    const propagationPaths: MultiProjectImpactPropagationPath[] = []

    // 源点选择
    const sources =
      scope.sources ??
      scope.projectIds.map((pid) => ({
        sourceType: 'project' as const,
        sourceId: pid,
        sourceLabel: `项目 ${pid}`,
        projectId: pid,
      }))

    let edgeCount = 0
    let nodeCount = scope.projectIds.length

    for (const source of sources.slice(0, 10)) {
      const entries: MultiProjectImpactPathEntry[] = []
      const affectedEndpoints: MultiProjectImpactAffectedEndpoint[] = []
      let totalDelayDays = 0
      let depth = 0

      // 查找以该 source 为起点的跨项目依赖边
      const downstreamEdges = crossProjectEdges
        .filter((e) => e.fromProjectId === source.projectId)
        .slice(0, scope.maxEdges)

      edgeCount += downstreamEdges.length

      for (const edge of downstreamEdges) {
        if (edgeCount > scope.maxEdges) {
          warnings.push(
            makeMultiProjectImpactWarning('edge_limit_reached', '已达到边数上限，部分链路未分析'),
          )
          break
        }
        if (depth >= scope.maxPropagationDepth) {
          warnings.push(
            makeMultiProjectImpactWarning('propagation_depth_limit_reached', '已达到传播深度上限'),
          )
          break
        }

        const bufferSummary = computeBufferAbsorptionSummary(edge.lagDays, edge.bufferDays)
        const isOnCriticalPath = edge.relationshipType === 'cross_project_dependency' // 简化判断
        const severity = classifySeverityFromDelay(
          bufferSummary.propagatedDelayDays,
          isOnCriticalPath,
          edge.bufferDays > 0,
        )

        const entry: MultiProjectImpactPathEntry = {
          fromType: edge.fromType,
          fromId: edge.visibility === 'visible' ? edge.fromId : 0,
          fromLabel: edge.visibility === 'visible' ? edge.fromLabel : '',
          fromProjectId: edge.visibility === 'visible' ? edge.fromProjectId : 0,
          toType: edge.toType,
          toId: edge.visibility === 'visible' ? edge.toId : 0,
          toLabel: edge.visibility === 'visible' ? edge.toLabel : '',
          toProjectId: edge.visibility === 'visible' ? edge.toProjectId : 0,
          relationshipType: edge.relationshipType,
          delayDays: edge.lagDays,
          bufferDays: edge.bufferDays,
          visibility: edge.visibility,
          redactionReason: edge.redactionReason ?? null,
          evidenceHash: fnv1aHash(`${edge.fromId}-${edge.toId}`),
        }
        entries.push(entry)

        const endpoint: MultiProjectImpactAffectedEndpoint = {
          endpointType: edge.toType,
          endpointId: edge.visibility === 'visible' ? edge.toId : 0,
          endpointLabel: edge.visibility === 'visible' ? edge.toLabel : '',
          projectId: edge.visibility === 'visible' ? edge.toProjectId : 0,
          projectLabel: edge.visibility === 'visible' ? `项目 ${edge.toProjectId}` : '',
          depth: depth + 1,
          propagatedDelayDays: bufferSummary.propagatedDelayDays,
          bufferAbsorbedDays: bufferSummary.absorbedDays,
          remainingBufferDays: bufferSummary.remainingBufferDays,
          leadLagAdjustmentDays: 0,
          severity,
          affectedDimensions: ['schedule'],
          visibility: edge.visibility,
          redactionReason: edge.redactionReason ?? null,
          evidenceHash: fnv1aHash(`ep-${edge.toId}`),
        }
        affectedEndpoints.push(endpoint)

        totalDelayDays += bufferSummary.propagatedDelayDays
        depth = Math.max(depth, 1)
        severityDistribution[severity] = (severityDistribution[severity] ?? 0) + 1
        nodeCount++
      }

      if (entries.length > 0) {
        propagationPaths.push({
          sourceRef: {
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            sourceLabel: source.sourceLabel,
            projectId: source.projectId,
          },
          entries,
          totalDelayDays,
          depth,
          affectedEndpoints,
        })
      }
    }

    if (nodeCount >= scope.maxNodes) {
      warnings.push(makeMultiProjectImpactWarning('node_limit_reached', '已达到节点数上限'))
    }

    return { propagationPaths, severityDistribution, warnings }
  }

  // ─── §5.6 Snapshot persistence, read, stale detection, refresh ──

  async listSnapshots(
    organizationId: number,
    filters: {
      projectIds?: number[]
      status?: string
      isStale?: boolean
      severity?: string
      page?: number
      perPage?: number
      sort?: string
    },
  ): Promise<{
    data: MultiProjectImpactSnapshot[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = filters.page ?? MULTI_PROJECT_IMPACT_DEFAULTS.DEFAULT_PAGE
    const perPage = Math.min(
      filters.perPage ?? MULTI_PROJECT_IMPACT_DEFAULTS.DEFAULT_PER_PAGE,
      MULTI_PROJECT_IMPACT_DEFAULTS.MAX_PER_PAGE,
    )

    let query = MultiProjectImpactSnapshotModel.query()
      .where('organization_id', organizationId)
      .orderBy('created_at', 'desc')

    if (filters.status) query = query.where('status', filters.status)
    if (filters.isStale !== undefined) query = query.where('is_stale', filters.isStale)

    const paginator = await query.paginate(page, perPage)
    const meta = paginator.getMeta()

    const data = paginator.all().map((r) => this.toSnapshotDtoFromRecord(r))
    return {
      data,
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  async readSnapshot(
    organizationId: number,
    snapshotId: number,
  ): Promise<MultiProjectImpactSnapshot> {
    const record = await MultiProjectImpactSnapshotModel.query()
      .where('organization_id', organizationId)
      .where('id', snapshotId)
      .first()

    if (!record) throw new Error('影响分析快照不存在')

    return this.toSnapshotDtoFromRecord(record)
  }

  async detectStale(
    organizationId: number,
    snapshotId: number,
  ): Promise<{ isStale: boolean; reason: string | null }> {
    const record = await MultiProjectImpactSnapshotModel.query()
      .where('organization_id', organizationId)
      .where('id', snapshotId)
      .first()

    if (!record) throw new Error('快照不存在')

    return detectMultiProjectImpactSnapshotStale({
      generatedAt: record.generatedAt.toISO()!,
      expiresAt: record.expiresAt.toISO()!,
      ruleVersion: record.ruleVersion,
      currentRuleVersion: MULTI_PROJECT_IMPACT_DEFAULTS.RULE_VERSION,
      sourceFreshnessChanged: false,
      permissionFingerprintChanged: false,
      dependencyGraphChanged: false,
    })
  }

  async refreshSnapshot(
    organizationId: number,
    snapshotId: number,
    actor: ImpactPolicyActor,
  ): Promise<MultiProjectImpactSnapshot> {
    const oldRecord = await MultiProjectImpactSnapshotModel.query()
      .where('organization_id', organizationId)
      .where('id', snapshotId)
      .first()

    if (!oldRecord) throw new Error('快照不存在')

    const latestPlan = await MultiProjectImpactPlanModel.query()
      .where('organization_id', organizationId)
      .where('scope_hash', oldRecord.scopeHash)
      .orderBy('created_at', 'desc')
      .first()
    const scope: MultiProjectImpactScope = JSON.parse(
      latestPlan?.scopeJson ??
        '{"projectIds":[],"maxPropagationDepth":5,"maxNodes":500,"maxEdges":1000,"maxScenarios":5}',
    )

    const plan = await this.planAnalysis(organizationId, scope, actor)
    const newSnapshot = await this.runAnalysis(organizationId, plan.runToken, actor)

    // 标记旧快照为 stale
    oldRecord.isStale = true
    oldRecord.staleReason = 'source_data_changed'
    await oldRecord.save()

    await this.audit.log({
      event: 'MULTI_PROJECT_IMPACT_REFRESH' as any,
      userId: actor.id,
      organizationId,
      entityType: 'multi_project_impact_snapshot',
      entityId: newSnapshot.id,
      metadata: { previousSnapshotId: snapshotId },
    })

    return newSnapshot
  }

  // ─── §5.5 What-if Scenario Runner ────────────────────────────────

  async runWhatIf(
    organizationId: number,
    snapshotId: number,
    scenarios: MultiProjectImpactWhatIfScenario[],
    _actor: ImpactPolicyActor,
  ): Promise<MultiProjectImpactWhatIfOutput[]> {
    const snapshot = await this.readSnapshot(organizationId, snapshotId)

    const outputs: MultiProjectImpactWhatIfOutput[] = []
    for (const scenario of scenarios) {
      const scenarioHash = fnv1aHash(JSON.stringify(scenario))

      // 模拟 what-if：基于现有传播路径计算 delta
      const baseline = {
        totalAffected: snapshot.propagationSummary.totalAffectedEndpoints,
        severityDistribution: { ...snapshot.propagationSummary.severityDistribution },
        blockedEndpoints: snapshot.propagationSummary.blockedEndpoints,
      }

      // 应用假设（简化：delay 会增加 affected）
      const scenarioOutput = { ...baseline }
      if (scenario.params.delayDays && scenario.params.delayDays > 0) {
        const extraDays = scenario.params.delayDays
        // 超出 buffer 的天数会传播
        const extraAffected = Math.ceil(extraDays / 3) // 简化：每 3 天多一个受影响项
        scenarioOutput.totalAffected += extraAffected
        scenarioOutput.blockedEndpoints += Math.ceil(extraAffected / 2)
        if (extraDays > 10)
          scenarioOutput.severityDistribution.blocker =
            (scenarioOutput.severityDistribution.blocker ?? 0) + 1
        else if (extraDays > 3)
          scenarioOutput.severityDistribution.critical =
            (scenarioOutput.severityDistribution.critical ?? 0) + 1
      }

      const output: MultiProjectImpactWhatIfOutput = {
        scenarioHash,
        scenario,
        assumptions: [scenario.assumption],
        baseline,
        scenarioOutput,
        changedEndpoints: {
          added: [],
          removed: [],
          severityChanged: [],
        },
        comparisonHash: fnv1aHash(JSON.stringify({ baseline, scenarioOutput })),
        isHypothetical: true,
        isApplied: false,
      }

      outputs.push(output)
    }

    await this.audit.log({
      event: 'MULTI_PROJECT_IMPACT_WHAT_IF' as any,
      userId: _actor.id,
      organizationId,
      entityType: 'multi_project_impact_snapshot',
      entityId: snapshotId,
      metadata: {
        scenarioCount: scenarios.length,
        scenarioTypes: scenarios.map((s) => s.scenarioType),
      },
    })

    return outputs
  }

  // ─── §5.7 Follow-up Draft Bridge ─────────────────────────────────

  async buildFollowUpDraft(
    organizationId: number,
    snapshotId: number,
    affectedEndpointHashes: string[],
    targetCapability: MultiProjectImpactFollowUpTarget,
    _actor: ImpactPolicyActor,
  ): Promise<MultiProjectImpactFollowUpDraft> {
    const snapshot = await this.readSnapshot(organizationId, snapshotId)

    const availableTargets: MultiProjectImpactFollowUpTarget[] = [
      'manual_risk_draft',
      'change_request_summary',
      'report_summary',
      'manual_summary',
    ]

    if (!isFollowUpTargetAvailable(targetCapability, availableTargets)) {
      return buildManualSummaryDraft({
        snapshotId,
        affectedEndpointHashes,
        reason: `目标能力 ${targetCapability} 尚未启用，请人工处理。`,
      })
    }

    // 可用目标：返回对应草案
    const draft: MultiProjectImpactFollowUpDraft = {
      sourceSnapshotId: snapshotId,
      sourceSnapshotHash: snapshot.outputHash ?? fnv1aHash(`snapshot-${snapshotId}`),
      affectedEndpointHashes,
      targetCapability,
      draftPayload: {
        action: `build_${targetCapability}_draft`,
        source: 'multi_project_impact_analysis',
        snapshotId,
        affectedEndpointHashes,
      },
      warnings: snapshot.warnings,
      redactionState: [],
      freshnessSignature: snapshot.sourceFreshnessHash,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      confirmationRequired: true,
      isManualFallback: false,
    }

    await this.audit.log({
      event: 'MULTI_PROJECT_IMPACT_FOLLOW_UP' as any,
      userId: _actor.id,
      organizationId,
      entityType: 'multi_project_impact_snapshot',
      entityId: snapshotId,
      metadata: { targetCapability, endpointHashCount: affectedEndpointHashes.length },
    })

    return draft
  }

  // ─── §5.8 AI Explanation ─────────────────────────────────────────

  async getAiExplanation(
    organizationId: number,
    snapshotId: number,
    _actor: ImpactPolicyActor,
    focus?: string | null,
  ): Promise<MultiProjectImpactAiExplanation> {
    const snapshot = await this.readSnapshot(organizationId, snapshotId)

    if (!this.aiExplanationAdapter) {
      return {
        snapshotId,
        snapshotHash: snapshot.outputHash ?? '',
        provider: null,
        model: null,
        explanation: 'AI 解释服务未配置。确定性影响分析结果仍然有效。',
        confidence: 0,
        assumptions: [],
        followUpQuestions: [],
        advisoryOnly: true,
        confirmationRequired: true,
        applied: false,
        generatedAt: new Date().toISOString(),
        tokenCost: null,
      }
    }

    const aiResult = await this.aiExplanationAdapter.generateExplanation(snapshot, focus)

    await this.audit.log({
      event: 'MULTI_PROJECT_IMPACT_AI_EXPLANATION' as any,
      userId: _actor.id,
      organizationId,
      entityType: 'multi_project_impact_snapshot',
      entityId: snapshotId,
      metadata: {
        aiProvider: aiResult.provider,
        aiModel: aiResult.model,
        snapshotHash: snapshot.outputHash,
      },
    })

    return aiResult
  }

  // ─── §5.9 Export ─────────────────────────────────────────────────

  async exportSnapshot(
    organizationId: number,
    snapshotId: number,
    format: 'json' | 'csv',
    _actor: ImpactPolicyActor,
  ): Promise<{ snapshotId: number; snapshotHash: string; format: string; content: string }> {
    const snapshot = await this.readSnapshot(organizationId, snapshotId)
    const snapshotHash = snapshot.outputHash ?? ''

    let content: string
    if (format === 'json') {
      content = JSON.stringify(
        {
          snapshotId,
          snapshotHash,
          generatedAt: snapshot.generatedAt,
          propagationSummary: snapshot.propagationSummary,
          warnings: snapshot.warnings,
          isStale: snapshot.isStale,
        },
        null,
        2,
      )
    } else {
      const headers =
        'endpoint_type,endpoint_id,project_id,severity,propagated_delay_days,buffer_absorbed_days,depth'
      const rows = snapshot.propagationSummary.propagationPaths.flatMap((p) =>
        p.affectedEndpoints.map(
          (ep) =>
            `${ep.endpointType},${ep.endpointId},${ep.projectId},${ep.severity},${ep.propagatedDelayDays},${ep.bufferAbsorbedDays},${p.depth}`,
        ),
      )
      content = `${headers}\n${rows.join('\n')}`
    }

    await this.audit.log({
      event: 'MULTI_PROJECT_IMPACT_EXPORT' as any,
      userId: _actor.id,
      organizationId,
      entityType: 'multi_project_impact_snapshot',
      entityId: snapshotId,
      metadata: { format, snapshotHash },
    })

    return { snapshotId, snapshotHash, format, content }
  }

  // ─── 特性开关 ─────────────────────────────────────────────────────

  isFeatureEnabled(): boolean {
    return isMultiProjectImpactAnalysisEnabled()
  }

  // ─── DTO 转换 helpers ─────────────────────────────────────────────

  private toSnapshotDtoFromRecord(
    record: MultiProjectImpactSnapshotModel,
  ): MultiProjectImpactSnapshot {
    const propagationSummaryJson = record.propagationSummaryJson
      ? JSON.parse(record.propagationSummaryJson)
      : {
          propagationPaths: [],
          totalAffectedEndpoints: 0,
          severityDistribution: emptyMultiProjectImpactSeverityDistribution(),
          blockedEndpoints: 0,
          maxDepth: 0,
          averageDelayDays: 0,
        }

    const warningsJson: MultiProjectImpactWarning[] = record.warningsJson
      ? JSON.parse(record.warningsJson)
      : []

    return {
      id: record.id,
      organizationId: record.organizationId,
      actorId: record.actorId,
      scopeHash: record.scopeHash,
      sourceFreshnessHash: record.sourceFreshnessHash,
      dependencyGraphSignature: record.dependencyGraphSignature,
      ruleVersion: record.ruleVersion,
      permissionFingerprint: record.permissionFingerprint,
      inputHash: record.inputHash,
      outputHash: record.outputHash ?? '',
      status: record.status as MultiProjectImpactSnapshot['status'],
      generatedAt: record.generatedAt.toISO()!,
      expiresAt: record.expiresAt.toISO()!,
      sourceSummary: record.sourceSummaryJson
        ? JSON.parse(record.sourceSummaryJson)
        : { sourceType: 'project' },
      propagationSummary: propagationSummaryJson,
      warnings: warningsJson,
      isStale: record.isStale,
      staleReason: record.staleReason as MultiProjectImpactSnapshot['staleReason'],
      evidenceReferences: record.evidenceReferencesJson
        ? JSON.parse(record.evidenceReferencesJson)
        : [],
      createdAt: record.createdAt.toISO()!,
      createdBy: record.createdBy,
    }
  }

  private toSnapshotDto(
    record: MultiProjectImpactSnapshotModel,
    propagationPaths: MultiProjectImpactPropagationPath[],
    severityDistribution: Record<MultiProjectImpactSeverity, number>,
    warnings: MultiProjectImpactWarning[],
  ): MultiProjectImpactSnapshot {
    const totalAffected = propagationPaths.reduce((s, p) => s + p.affectedEndpoints.length, 0)
    return {
      id: record.id,
      organizationId: record.organizationId,
      actorId: record.actorId,
      scopeHash: record.scopeHash,
      sourceFreshnessHash: record.sourceFreshnessHash,
      dependencyGraphSignature: record.dependencyGraphSignature,
      ruleVersion: record.ruleVersion,
      permissionFingerprint: record.permissionFingerprint,
      inputHash: record.inputHash,
      outputHash: record.outputHash ?? '',
      status: record.status as MultiProjectImpactSnapshot['status'],
      generatedAt: record.generatedAt.toISO()!,
      expiresAt: record.expiresAt.toISO()!,
      sourceSummary: record.sourceSummaryJson
        ? JSON.parse(record.sourceSummaryJson)
        : { sourceType: 'project' },
      propagationSummary: {
        propagationPaths,
        totalAffectedEndpoints: totalAffected,
        severityDistribution,
        blockedEndpoints: propagationPaths.reduce(
          (s, p) =>
            s +
            p.affectedEndpoints.filter((ep) => isBlockingMultiProjectImpactSeverity(ep.severity))
              .length,
          0,
        ),
        maxDepth: Math.max(0, ...propagationPaths.map((p) => p.depth)),
        averageDelayDays:
          totalAffected > 0
            ? propagationPaths
                .flatMap((p) => p.affectedEndpoints.map((ep) => ep.propagatedDelayDays))
                .reduce((a, b) => a + b, 0) / totalAffected
            : 0,
      },
      warnings,
      isStale: record.isStale,
      staleReason: record.staleReason as MultiProjectImpactSnapshot['staleReason'],
      evidenceReferences: record.evidenceReferencesJson
        ? JSON.parse(record.evidenceReferencesJson)
        : [],
      createdAt: record.createdAt.toISO()!,
      createdBy: record.createdBy,
    }
  }
}
