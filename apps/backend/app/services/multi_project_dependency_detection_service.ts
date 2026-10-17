import { ValidationException } from '#exceptions/api_exception'
import MultiProjectDependencyDetectionRun from '#models/multi_project_dependency_detection_run'
import MultiProjectDependencyDetectionResult from '#models/multi_project_dependency_detection_result'
import Project from '#models/project'
import OrganizationMember from '#models/organization_member'
import AuditService, { AuditEvent } from '#services/audit_service'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import {
  normalizeDetectionScope,
  hashDetectionScope,
  fingerprintDetectionResult,
  classifyDetectionSeverity,
  classifyDetectionConfidence,
  isValidDetectionResultTransition,
  buildPlanToken,
  DEFAULT_DETECTION_RULE_SET,
} from '@aiproj/types'
import type {
  DetectionScope,
  NormalizedDetectionScope,
  DetectionPlan,
  DetectionRun,
  DetectionResult,
  DetectionRuleId,
  DetectionSeverity,
  DetectionConfidenceBand,
  DetectionResultStatus,
  DetectionWarningCode,
  DetectionRunStatus,
} from '@aiproj/types'

// ─── Internal Types ─────────────────────────────────────────────────────────────

interface SourceSnapshot {
  scopeHash: string
  ruleSetKey: string
  organizationId: number
  freshness: DetectionPlan['sourceFreshness']
  permissionFingerprint: string
  dependencyFacts: MultiProjectDependencyFact[]
  projectSummaries: ProjectSummary[]
  localTaskDeps: LocalTaskDep[]
  warnings: DetectionWarningCode[]
}

interface MultiProjectDependencyFact {
  id: number
  providerProjectId: number | null
  providerEndpointType: string
  providerEndpointId: number | null
  consumerProjectId: number | null
  consumerEndpointType: string
  consumerEndpointId: number | null
  type: string
  category: string
  status: string
  lagDays: number
  bufferDays: number
  riskLevel: string
  freshnessStatus: string
  createdAt: string
  updatedAt: string | null
}

interface ProjectSummary {
  id: number
  name: string | null
  status: string | null
  startDate: string | null
  endDate: string | null
  visible: boolean
}

interface LocalTaskDep {
  predecessorTaskId: number
  successorTaskId: number
  projectId: number
  type: string
}

interface RuleOutput {
  ruleId: DetectionRuleId
  severity: DetectionSeverity
  confidence: DetectionConfidenceBand
  rationale: string
  evidenceSummary: string | null
  evidenceHash: string | null
  affectedEndpointHashes: string[]
  warnings: DetectionWarningCode[]
  draftEligible: boolean
  isBlocking: boolean
  propagationDays: number
  evidenceCount: number
  matchQuality: number
}

// ─── Config ────────────────────────────────────────────────────────────────────

const DETECTION_PLAN_TTL_MS = 5 * 60 * 1000
const DETECTION_RUN_TTL_DAYS = 30

// ─── Service ───────────────────────────────────────────────────────────────────

@inject()
export default class MultiProjectDependencyDetectionService {
  constructor(protected auditService: AuditService) {}

  // ─── Member Check Helper ─────────────────────────────────────────────────────

  /** 成员行**或**组织所有者才放行（owner 可能没有 organization_members 行）。 */
  private async checkMember(organizationId: number, userId: number): Promise<number> {
    const belongs = await OrganizationMember.belongsToOrganization(organizationId, userId)
    if (!belongs) throw new ValidationException('非组织成员')
    return Number(organizationId)
  }

  // ─── Plan ────────────────────────────────────────────────────────────────────

  async planDetection(scope: DetectionScope, auth: { userId: number }): Promise<DetectionPlan> {
    const orgId = Number(scope.organizationId)
    await this.checkMember(orgId, auth.userId)

    const normalized = normalizeDetectionScope(scope)
    const scopeHash = hashDetectionScope(normalized)
    const ruleSet = DEFAULT_DETECTION_RULE_SET

    const freshness = await this.collectSourceFreshness(orgId)
    const visibleProjectIds = await this.getVisibleProjectIds(normalized, orgId)

    const enabledRules = ruleSet.rules.filter((r) => r.enabled).map((r) => r.id)

    const plan: Omit<DetectionPlan, 'planToken'> = {
      scopeHash,
      normalizedScope: normalized,
      ruleSetKey: ruleSet.key,
      ruleSetLabel: ruleSet.label,
      enabledRules,
      estimatedCost: {
        projectCount: visibleProjectIds.length,
        dependencyEdgeCount: 0,
        taskDependencyContextCount: 0,
        estimatedRules: enabledRules.length,
      },
      sourceFreshness: freshness,
      permissionSummary: {
        canReadAllProjects:
          normalized.projectIds.length === 0 ||
          visibleProjectIds.length >= normalized.projectIds.length,
        partialRedactionExpected: visibleProjectIds.length < normalized.projectIds.length,
      },
      warnings: [],
      expiresAt: new Date(Date.now() + DETECTION_PLAN_TTL_MS).toISOString(),
      createdAt: new Date().toISOString(),
    }

    const planToken = buildPlanToken(plan)
    const fullPlan: DetectionPlan = { ...plan, planToken }

    await this.auditService.log({
      event: AuditEvent.DEPENDENCY_DETECTION_PLANNED,
      userId: auth.userId,
      organizationId: orgId,
      metadata: {
        scopeHash,
        ruleSetKey: ruleSet.key,
      },
    })

    return fullPlan
  }

  // ─── Run ─────────────────────────────────────────────────────────────────────

  async runDetection(
    organizationId: number,
    planToken: string,
    auth: { userId: number },
  ): Promise<{ run: DetectionRun; results: DetectionResult[] }> {
    await this.checkMember(organizationId, auth.userId)
    const scopeHash = planToken.substring(0, 8)

    const snapshot = await this.buildSourceSnapshot(organizationId)

    const runRecord = await MultiProjectDependencyDetectionRun.create({
      organizationId,
      actorId: auth.userId,
      planToken,
      scopeHash,
      ruleSetKey: DEFAULT_DETECTION_RULE_SET.key,
      sourceFreshnessHash: this.hashFreshness(snapshot.freshness),
      status: 'running' as DetectionRunStatus,
      resultCount: 0,
      resultSummary: null,
      warnings: snapshot.warnings,
      startedAt: DateTime.now(),
    })

    const ruleOutputs = await this.executeAllRules(snapshot)
    const results: DetectionResult[] = []

    for (const output of ruleOutputs) {
      const fingerprint = fingerprintDetectionResult(
        output.ruleId,
        scopeHash,
        output.affectedEndpointHashes,
      )

      const resultRecord = await MultiProjectDependencyDetectionResult.create({
        organizationId,
        runId: runRecord.id,
        ruleId: output.ruleId,
        severity:
          output.severity ||
          classifyDetectionSeverity({
            ruleId: output.ruleId,
            propagationDays: output.propagationDays,
            isBlocking: output.isBlocking,
          }),
        confidence:
          output.confidence ||
          classifyDetectionConfidence({
            evidenceCount: output.evidenceCount,
            matchQuality: output.matchQuality,
          }),
        status: 'open' as DetectionResultStatus,
        fingerprint,
        rationale: output.rationale,
        evidenceSummary: output.evidenceSummary,
        evidenceHash: output.evidenceHash,
        affectedEndpointHashes: output.affectedEndpointHashes,
        sourceFreshness: {
          dependencyFactsHash: snapshot.freshness.dependencyFactsHash,
          snapshotCreatedAt: new Date().toISOString(),
        },
        warnings: output.warnings,
        redactionState: output.warnings.length > 0 ? 'partial' : 'none',
        draftEligible: output.draftEligible,
      })

      results.push(this.toResultDTO(resultRecord))
    }

    const summary = this.aggregateResultSummary(results)
    runRecord.status = 'completed' as DetectionRunStatus
    runRecord.resultCount = results.length
    runRecord.resultSummary = summary
    runRecord.completedAt = DateTime.now()
    runRecord.expiresAt = DateTime.now().plus({ days: DETECTION_RUN_TTL_DAYS })
    await runRecord.save()

    await this.auditService.log({
      event: AuditEvent.DEPENDENCY_DETECTION_RUN,
      userId: auth.userId,
      organizationId,
      metadata: {
        runId: runRecord.id,
        scopeHash,
        ruleSetKey: DEFAULT_DETECTION_RULE_SET.key,
        sourceFreshnessHash: snapshot.freshness.dependencyFactsHash,
        resultCount: results.length,
      },
    })

    return { run: this.toRunDTO(runRecord), results }
  }

  // ─── List Runs ───────────────────────────────────────────────────────────────

  async listRuns(
    organizationId: number,
    auth: { userId: number },
    query: { page?: number; perPage?: number; status?: string; sort?: string } = {},
  ): Promise<{ data: DetectionRun[]; meta: any }> {
    await this.checkMember(organizationId, auth.userId)
    const page = query.page ?? 1
    const perPage = Math.min(query.perPage ?? 20, 100)

    let q = MultiProjectDependencyDetectionRun.query()
      .where('organization_id', organizationId)
      .orderBy('created_at', 'desc')

    if (query.status) {
      q = q.where('status', query.status)
    }

    const result = await q.paginate(page, perPage)

    return {
      data: result.all().map((r) => this.toRunDTO(r)),
      meta: {
        total: Number(result.total),
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  // ─── List Results ────────────────────────────────────────────────────────────

  async listResults(
    organizationId: number,
    auth: { userId: number },
    query: {
      page?: number
      perPage?: number
      runId?: number
      severity?: string
      confidence?: string
      status?: string
      ruleId?: string
      sort?: string
    } = {},
  ): Promise<{ data: DetectionResult[]; meta: any }> {
    await this.checkMember(organizationId, auth.userId)
    const page = query.page ?? 1
    const perPage = Math.min(query.perPage ?? 20, 100)

    let q = MultiProjectDependencyDetectionResult.query()
      .where('organization_id', organizationId)
      .orderBy('created_at', 'desc')

    if (query.runId) q = q.where('run_id', query.runId)
    if (query.severity) q = q.where('severity', query.severity)
    if (query.confidence) q = q.where('confidence', query.confidence)
    if (query.status) q = q.where('status', query.status)
    if (query.ruleId) q = q.where('rule_id', query.ruleId)

    const result = await q.paginate(page, perPage)

    return {
      data: result.all().map((r) => this.toResultDTO(r)),
      meta: {
        total: Number(result.total),
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  // ─── Detail ──────────────────────────────────────────────────────────────────

  async getResult(
    organizationId: number,
    resultId: number,
    auth: { userId: number },
  ): Promise<DetectionResult | null> {
    await this.checkMember(organizationId, auth.userId)
    const record = await MultiProjectDependencyDetectionResult.query()
      .where('id', resultId)
      .where('organization_id', organizationId)
      .first()
    return record ? this.toResultDTO(record) : null
  }

  // ─── Ignore ──────────────────────────────────────────────────────────────────

  async ignoreResult(
    organizationId: number,
    resultId: number,
    reasonHash: string | undefined,
    auth: { userId: number },
  ): Promise<DetectionResult> {
    await this.checkMember(organizationId, auth.userId)
    const record = await MultiProjectDependencyDetectionResult.query()
      .where('id', resultId)
      .where('organization_id', organizationId)
      .first()
    if (!record) throw new ValidationException('检测结果不存在')

    const fromStatus = record.status as DetectionResultStatus
    if (!isValidDetectionResultTransition(fromStatus, 'ignored')) {
      throw new ValidationException(`不允许从 ${fromStatus} 转换到 ignored`)
    }

    record.status = 'ignored'
    record.ignoreReasonHash = reasonHash ?? null
    record.updatedAt = DateTime.now()
    await record.save()

    await this.auditService.log({
      event: AuditEvent.DEPENDENCY_DETECTION_RESULT_IGNORED,
      userId: auth.userId,
      organizationId,
      metadata: { resultId, fromStatus, toStatus: 'ignored', reasonHash: reasonHash ?? null },
    })

    return this.toResultDTO(record)
  }

  // ─── Reopen ──────────────────────────────────────────────────────────────────

  async reopenResult(
    organizationId: number,
    resultId: number,
    reasonHash: string | undefined,
    auth: { userId: number },
  ): Promise<DetectionResult> {
    await this.checkMember(organizationId, auth.userId)
    const record = await MultiProjectDependencyDetectionResult.query()
      .where('id', resultId)
      .where('organization_id', organizationId)
      .first()
    if (!record) throw new ValidationException('检测结果不存在')

    const fromStatus = record.status as DetectionResultStatus
    if (!isValidDetectionResultTransition(fromStatus, 'reopened')) {
      throw new ValidationException(`不允许从 ${fromStatus} 转换到 reopened`)
    }

    record.status = 'reopened'
    record.ignoreReasonHash = null
    record.updatedAt = DateTime.now()
    await record.save()

    await this.auditService.log({
      event: AuditEvent.DEPENDENCY_DETECTION_RESULT_REOPENED,
      userId: auth.userId,
      organizationId,
      metadata: { resultId, fromStatus, toStatus: 'reopened', reasonHash: reasonHash ?? null },
    })

    return this.toResultDTO(record)
  }

  // ─── Draft Bridge ────────────────────────────────────────────────────────────

  async buildDraftBridge(
    organizationId: number,
    resultId: number,
    auth: { userId: number },
  ): Promise<any> {
    await this.checkMember(organizationId, auth.userId)
    const record = await MultiProjectDependencyDetectionResult.query()
      .where('id', resultId)
      .where('organization_id', organizationId)
      .first()
    if (!record) throw new ValidationException('检测结果不存在')
    if (!record.draftEligible) throw new ValidationException('该检测结果不支持生成 CRUD 草案')
    if (record.redactionState === 'full')
      throw new ValidationException('该检测结果因脱敏限制无法生成草案')

    const fromStatus = record.status as DetectionResultStatus
    if (fromStatus !== 'open' && fromStatus !== 'reopened') {
      throw new ValidationException(`当前状态 ${fromStatus} 不支持生成草案`)
    }

    record.status = 'convertedToDraft'
    record.updatedAt = DateTime.now()
    await record.save()

    const draftOutput = {
      sourceDetectionResultId: record.id,
      sourceDetectionResultHash: record.fingerprint,
      providerEndpoint: {
        projectId: 0,
        endpointType: 'project' as const,
        endpointId: null as number | null,
        label: null as string | null,
      },
      consumerEndpoint: {
        projectId: 0,
        endpointType: 'project' as const,
        endpointId: null as number | null,
        label: null as string | null,
      },
      dependencyType: 'fs',
      category: 'deliverable',
      suggestedLagDays: 0,
      suggestedBufferDays: record.severity === 'critical' ? 14 : 7,
      evidenceHash: record.evidenceHash,
      redactionState: record.redactionState,
      warningCodes:
        typeof record.warnings === 'string' ? JSON.parse(record.warnings) : (record.warnings ?? []),
      freshnessSignature:
        typeof record.sourceFreshness === 'string'
          ? JSON.parse(record.sourceFreshness).dependencyFactsHash || ''
          : (record.sourceFreshness as any)?.dependencyFactsHash || '',
      confirmationRequired: true as const,
      expiresAt: new Date(Date.now() + DETECTION_PLAN_TTL_MS).toISOString(),
    }

    await this.auditService.log({
      event: AuditEvent.DEPENDENCY_DETECTION_DRAFT_BRIDGE,
      userId: auth.userId,
      organizationId,
      metadata: { resultId, resultHash: record.fingerprint },
    })

    return draftOutput
  }

  // ─── Source Snapshot ─────────────────────────────────────────────────────────

  private async buildSourceSnapshot(organizationId: number): Promise<SourceSnapshot> {
    const freshness = await this.collectSourceFreshness(organizationId)
    const scopeHash = hashDetectionScope({
      organizationId,
      projectIds: [],
      dateWindowStart: null,
      dateWindowEnd: null,
      maxProjects: 100,
      maxEdges: 5000,
      maxTasksPerProject: 500,
      ruleSetKey: 'default',
    })

    return {
      scopeHash,
      ruleSetKey: 'default',
      organizationId,
      freshness,
      permissionFingerprint: 'perm_fp_default',
      dependencyFacts: [],
      projectSummaries: [],
      localTaskDeps: [],
      warnings: [],
    }
  }

  private async collectSourceFreshness(
    organizationId: number,
  ): Promise<DetectionPlan['sourceFreshness']> {
    const now = new Date().toISOString()
    return {
      dependencyFactsHash: `fh_${now.substring(0, 10)}_${organizationId}`,
      projectSummaryHash: `ph_${now.substring(0, 10)}_${organizationId}`,
      milestoneSummaryHash: `mh_${now.substring(0, 10)}_${organizationId}`,
      taskSummaryHash: `th_${now.substring(0, 10)}_${organizationId}`,
      localTaskDepsHash: `ltd_${now.substring(0, 10)}_${organizationId}`,
      resourceContentionHash: null,
      riskHeatmapHash: null,
      okrAlignmentHash: null,
      biAggregationHash: null,
    }
  }

  private async getVisibleProjectIds(
    scope: NormalizedDetectionScope,
    organizationId: number,
  ): Promise<number[]> {
    let q = Project.query().where('organization_id', organizationId).select('id')
    if (scope.projectIds.length > 0) {
      q = q.whereIn('id', scope.projectIds)
    }
    q = q.limit(scope.maxProjects)
    const projects = await q
    return projects.map((p) => p.id)
  }

  private hashFreshness(freshness: DetectionPlan['sourceFreshness']): string {
    const payload = JSON.stringify(freshness)
    let hash = 2166136261
    for (let i = 0; i < payload.length; i++) {
      hash ^= payload.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
  }

  // ─── Rule Execution ──────────────────────────────────────────────────────────

  private async executeAllRules(snapshot: SourceSnapshot): Promise<RuleOutput[]> {
    const outputs: RuleOutput[] = []
    outputs.push(...this.detectMissingDependencies(snapshot))
    outputs.push(...this.detectDuplicateEquivalents(snapshot))
    outputs.push(...this.detectSelfDependencies(snapshot))
    outputs.push(...this.detectCycleRisks(snapshot))
    outputs.push(...this.detectBufferShortfalls(snapshot))
    outputs.push(...this.detectScheduleConflicts(snapshot))
    outputs.push(...this.detectStatusConflicts(snapshot))
    outputs.push(...this.detectBlockedChains(snapshot))
    outputs.push(...this.detectStaleEvidence(snapshot))
    outputs.push(...this.detectOrphanedExternalRefs(snapshot))
    outputs.push(...this.detectDataQualityWarnings(snapshot))
    return outputs
  }

  private detectMissingDependencies(snapshot: SourceSnapshot): RuleOutput[] {
    const results: RuleOutput[] = []
    const facts = snapshot.dependencyFacts
    if (facts.length === 0) return results

    const projectMap = new Map<number, ProjectSummary>()
    for (const p of snapshot.projectSummaries) {
      if (p.visible) projectMap.set(p.id, p)
    }

    const hasConsumer = new Set<number>()
    const hasProvider = new Set<number>()
    for (const f of facts) {
      if (f.consumerProjectId) hasConsumer.add(f.consumerProjectId)
      if (f.providerProjectId) hasProvider.add(f.providerProjectId)
    }

    for (const [pId, p] of projectMap) {
      for (const [qId, q] of projectMap) {
        if (pId === qId) continue
        if (p.status === 'active' && q.status === 'active') {
          const hasDependency = facts.some(
            (f) =>
              (f.providerProjectId === pId && f.consumerProjectId === qId) ||
              (f.providerProjectId === qId && f.consumerProjectId === pId),
          )
          if (!hasDependency) {
            results.push({
              ruleId: 'missing_dependency',
              severity: 'medium',
              confidence: 'low',
              rationale: `项目 ${p.name || pId} 和项目 ${q.name || qId} 均处于活跃状态但未记录跨项目依赖`,
              evidenceSummary: `project_a=${pId}, project_b=${qId}, both_active=true`,
              evidenceHash: `md_${pId}_${qId}`,
              affectedEndpointHashes: [`proj_${pId}`, `proj_${qId}`],
              warnings: [],
              draftEligible: true,
              isBlocking: false,
              propagationDays: 0,
              evidenceCount: 1,
              matchQuality: 0.3,
            })
          }
        }
      }
    }
    return results
  }

  private detectDuplicateEquivalents(snapshot: SourceSnapshot): RuleOutput[] {
    const results: RuleOutput[] = []
    const facts = snapshot.dependencyFacts
    const seen = new Map<string, number>()

    for (const f of facts) {
      const key = `${f.providerProjectId}-${f.providerEndpointType}-${f.consumerProjectId}-${f.consumerEndpointType}-${f.type}-${f.category}`
      if (seen.has(key)) {
        const otherId = seen.get(key)!
        results.push({
          ruleId: 'duplicate_equivalent',
          severity: 'medium',
          confidence: 'high',
          rationale: `依赖 ID=${f.id} 与 ID=${otherId} 可能重复`,
          evidenceSummary: `dep1=${otherId}, dep2=${f.id}, key=${key}`,
          evidenceHash: `dup_${otherId}_${f.id}`,
          affectedEndpointHashes: [`dep_${otherId}`, `dep_${f.id}`],
          warnings: [],
          draftEligible: false,
          isBlocking: false,
          propagationDays: 0,
          evidenceCount: 2,
          matchQuality: 0.95,
        })
      } else {
        seen.set(key, f.id)
      }
    }
    return results
  }

  private detectSelfDependencies(snapshot: SourceSnapshot): RuleOutput[] {
    const results: RuleOutput[] = []
    for (const f of snapshot.dependencyFacts) {
      if (
        f.providerProjectId &&
        f.consumerProjectId &&
        f.providerProjectId === f.consumerProjectId
      ) {
        results.push({
          ruleId: 'self_dependency',
          severity: 'high',
          confidence: 'high',
          rationale: `项目 ${f.providerProjectId} 创建了指向自身的跨项目依赖（ID=${f.id}）`,
          evidenceSummary: `project_id=${f.providerProjectId}, dep_id=${f.id}`,
          evidenceHash: `self_${f.id}`,
          affectedEndpointHashes: [`dep_${f.id}`],
          warnings: [],
          draftEligible: false,
          isBlocking: true,
          propagationDays: 0,
          evidenceCount: 1,
          matchQuality: 1.0,
        })
      }
    }
    return results
  }

  private detectCycleRisks(snapshot: SourceSnapshot): RuleOutput[] {
    const results: RuleOutput[] = []
    const facts = snapshot.dependencyFacts.filter((f) => f.status !== 'archived')
    const adj = new Map<number, number[]>()
    for (const f of facts) {
      if (f.providerProjectId && f.consumerProjectId) {
        if (!adj.has(f.providerProjectId)) adj.set(f.providerProjectId, [])
        adj.get(f.providerProjectId)!.push(f.consumerProjectId)
      }
    }

    const visited = new Set<number>()
    const recStack = new Set<number>()
    let cycleFound = false

    const dfs = (node: number): boolean => {
      visited.add(node)
      recStack.add(node)
      const neighbors = adj.get(node) || []
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true
        } else if (recStack.has(neighbor)) {
          return true
        }
      }
      recStack.delete(node)
      return false
    }

    for (const node of adj.keys()) {
      if (!visited.has(node) && dfs(node)) {
        cycleFound = true
        break
      }
    }

    if (cycleFound) {
      results.push({
        ruleId: 'cycle_risk',
        severity: 'critical',
        confidence: 'medium',
        rationale: '检测到跨项目依赖中存在循环路径',
        evidenceSummary: `cycle_detected_in_org=${snapshot.organizationId}`,
        evidenceHash: `cycle_${snapshot.scopeHash}`,
        affectedEndpointHashes: [],
        warnings: [],
        draftEligible: false,
        isBlocking: true,
        propagationDays: 0,
        evidenceCount: 1,
        matchQuality: 0.5,
      })
    }
    return results
  }

  private detectBufferShortfalls(snapshot: SourceSnapshot): RuleOutput[] {
    const results: RuleOutput[] = []
    for (const f of snapshot.dependencyFacts) {
      if (f.status === 'active' && f.bufferDays < 7) {
        const shortfall = Math.max(0, 14 - f.bufferDays)
        results.push({
          ruleId: 'buffer_shortfall',
          severity: f.bufferDays < 3 ? 'critical' : 'high',
          confidence: 'medium',
          rationale: `依赖 ID=${f.id} 缓冲天数（${f.bufferDays}天）不足，建议至少 14 天`,
          evidenceSummary: `dep_id=${f.id}, buffer_days=${f.bufferDays}, min_recommended=14`,
          evidenceHash: `buf_${f.id}`,
          affectedEndpointHashes: [`dep_${f.id}`],
          warnings: [],
          draftEligible: true,
          isBlocking: f.bufferDays < 3,
          propagationDays: shortfall,
          evidenceCount: 2,
          matchQuality: 0.7,
        })
      }
    }
    return results
  }

  private detectScheduleConflicts(snapshot: SourceSnapshot): RuleOutput[] {
    const results: RuleOutput[] = []
    const projects = snapshot.projectSummaries.filter((p) => p.visible)
    for (const f of snapshot.dependencyFacts) {
      if (f.status === 'active') {
        const provider = projects.find((p) => p.id === f.providerProjectId)
        const consumer = projects.find((p) => p.id === f.consumerProjectId)
        if (provider && consumer && provider.endDate && consumer.startDate) {
          const gapDays = Math.ceil(
            (new Date(consumer.startDate).getTime() - new Date(provider.endDate).getTime()) /
              (1000 * 60 * 60 * 24),
          )
          if (gapDays < f.lagDays + f.bufferDays) {
            results.push({
              ruleId: 'schedule_conflict',
              severity: gapDays < 0 ? 'critical' : 'high',
              confidence: 'medium',
              rationale: `依赖 ID=${f.id} 排程可能冲突：gap=${gapDays}天 < lag=${f.lagDays}天 + buffer=${f.bufferDays}天`,
              evidenceSummary: `dep_id=${f.id}, gap_days=${gapDays}, lag=${f.lagDays}, buffer=${f.bufferDays}`,
              evidenceHash: `sched_${f.id}`,
              affectedEndpointHashes: [
                `dep_${f.id}`,
                `proj_${f.providerProjectId}`,
                `proj_${f.consumerProjectId}`,
              ],
              warnings: [],
              draftEligible: false,
              isBlocking: gapDays < 0,
              propagationDays: Math.abs(gapDays),
              evidenceCount: 3,
              matchQuality: 0.8,
            })
          }
        }
      }
    }
    return results
  }

  private detectStatusConflicts(snapshot: SourceSnapshot): RuleOutput[] {
    const results: RuleOutput[] = []
    for (const f of snapshot.dependencyFacts) {
      if (f.status === 'active') {
        const provider = snapshot.projectSummaries.find((p) => p.id === f.providerProjectId)
        const consumer = snapshot.projectSummaries.find((p) => p.id === f.consumerProjectId)
        if (consumer?.status === 'completed' && provider?.status === 'active') {
          results.push({
            ruleId: 'status_conflict',
            severity: 'high',
            confidence: 'high',
            rationale: `消费方项目 ${f.consumerProjectId} 已标记完成，但提供方项目 ${f.providerProjectId} 仍在活跃`,
            evidenceSummary: `consumer_status=completed, provider_status=active, dep_id=${f.id}`,
            evidenceHash: `status_${f.id}`,
            affectedEndpointHashes: [
              `dep_${f.id}`,
              `proj_${f.providerProjectId}`,
              `proj_${f.consumerProjectId}`,
            ],
            warnings: [],
            draftEligible: false,
            isBlocking: false,
            propagationDays: 0,
            evidenceCount: 3,
            matchQuality: 0.9,
          })
        }
      }
    }
    return results
  }

  private detectBlockedChains(snapshot: SourceSnapshot): RuleOutput[] {
    const results: RuleOutput[] = []
    const facts = snapshot.dependencyFacts.filter(
      (f) => f.status === 'active' && f.riskLevel === 'critical',
    )
    for (const f of facts) {
      const downstream = snapshot.dependencyFacts.filter(
        (d) => d.providerProjectId === f.consumerProjectId && d.status === 'active',
      )
      if (downstream.length > 0) {
        results.push({
          ruleId: 'blocked_chain',
          severity: downstream.length > 2 ? 'critical' : 'high',
          confidence: 'medium',
          rationale: `依赖 ID=${f.id}（critical）下游有 ${downstream.length} 条活跃依赖可能被阻塞`,
          evidenceSummary: `blocker_dep=${f.id}, downstream_count=${downstream.length}`,
          evidenceHash: `chain_${f.id}`,
          affectedEndpointHashes: [`dep_${f.id}`, ...downstream.map((d) => `dep_${d.id}`)],
          warnings: [],
          draftEligible: false,
          isBlocking: downstream.length > 2,
          propagationDays: downstream.length * 7,
          evidenceCount: 2 + downstream.length,
          matchQuality: 0.7,
        })
      }
    }
    return results
  }

  private detectStaleEvidence(snapshot: SourceSnapshot): RuleOutput[] {
    const results: RuleOutput[] = []
    const now = new Date()
    const staleThresholdDays = 30
    for (const f of snapshot.dependencyFacts) {
      if (f.status === 'active' && f.updatedAt) {
        const ageDays = Math.ceil(
          (now.getTime() - new Date(f.updatedAt).getTime()) / (1000 * 60 * 60 * 24),
        )
        if (ageDays > staleThresholdDays) {
          results.push({
            ruleId: 'stale_evidence',
            severity: 'low',
            confidence: 'medium',
            rationale: `依赖 ID=${f.id} 证据已过期 ${ageDays} 天（阈值: ${staleThresholdDays} 天）`,
            evidenceSummary: `dep_id=${f.id}, age_days=${ageDays}, threshold=${staleThresholdDays}`,
            evidenceHash: `stale_${f.id}`,
            affectedEndpointHashes: [`dep_${f.id}`],
            warnings: ['STALE_SOURCE'],
            draftEligible: false,
            isBlocking: false,
            propagationDays: 0,
            evidenceCount: 2,
            matchQuality: 0.6,
          })
        }
      }
    }
    return results
  }

  private detectOrphanedExternalRefs(snapshot: SourceSnapshot): RuleOutput[] {
    const results: RuleOutput[] = []
    for (const f of snapshot.dependencyFacts) {
      if (
        (f.providerEndpointType === 'external' || f.consumerEndpointType === 'external') &&
        f.status === 'active' &&
        f.freshnessStatus === 'stale'
      ) {
        results.push({
          ruleId: 'orphaned_external_ref',
          severity: 'low',
          confidence: 'low',
          rationale: `依赖 ID=${f.id} 引用了孤立的过期外部引用`,
          evidenceSummary: `dep_id=${f.id}, endpoint_type=external, freshness=stale`,
          evidenceHash: `orphan_${f.id}`,
          affectedEndpointHashes: [`dep_${f.id}`],
          warnings: ['STALE_SOURCE'],
          draftEligible: false,
          isBlocking: false,
          propagationDays: 0,
          evidenceCount: 1,
          matchQuality: 0.4,
        })
      }
    }
    return results
  }

  private detectDataQualityWarnings(snapshot: SourceSnapshot): RuleOutput[] {
    const results: RuleOutput[] = []
    for (const f of snapshot.dependencyFacts) {
      const issues: string[] = []
      if (!f.type) issues.push('缺失依赖类型')
      if (!f.category) issues.push('缺失依赖类别')
      if (f.lagDays < -365 || f.lagDays > 365) issues.push('lag 天数异常')
      if (issues.length > 0) {
        results.push({
          ruleId: 'data_quality_warning',
          severity: 'low',
          confidence: 'medium',
          rationale: `依赖 ID=${f.id} 存在数据质量问题：${issues.join('；')}`,
          evidenceSummary: `dep_id=${f.id}, issues=${issues.join(',')}`,
          evidenceHash: `dq_${f.id}`,
          affectedEndpointHashes: [`dep_${f.id}`],
          warnings: ['DATA_QUALITY_WARNING' as DetectionWarningCode],
          draftEligible: false,
          isBlocking: false,
          propagationDays: 0,
          evidenceCount: issues.length,
          matchQuality: 0.5,
        })
      }
    }
    return results
  }

  // ─── DTO Mappers ─────────────────────────────────────────────────────────────

  private toRunDTO(record: MultiProjectDependencyDetectionRun): DetectionRun {
    return {
      id: record.id,
      organizationId: record.organizationId,
      actorId: record.actorId,
      planToken: record.planToken,
      scopeHash: record.scopeHash,
      ruleSetKey: record.ruleSetKey,
      sourceFreshnessHash: record.sourceFreshnessHash,
      status: record.status as DetectionRunStatus,
      resultCount: record.resultCount,
      resultSummary:
        typeof record.resultSummary === 'string'
          ? JSON.parse(record.resultSummary)
          : (record.resultSummary ?? { critical: 0, high: 0, medium: 0, low: 0, info: 0 }),
      warnings:
        typeof record.warnings === 'string' ? JSON.parse(record.warnings) : (record.warnings ?? []),
      startedAt: record.startedAt?.toISO() ?? null,
      completedAt: record.completedAt?.toISO() ?? null,
      expiresAt: record.expiresAt?.toISO() ?? null,
      createdAt: record.createdAt?.toISO() ?? new Date().toISOString(),
      updatedAt: record.updatedAt?.toISO() ?? new Date().toISOString(),
    }
  }

  private toResultDTO(record: MultiProjectDependencyDetectionResult): DetectionResult {
    const sourceFreshness =
      typeof record.sourceFreshness === 'string'
        ? JSON.parse(record.sourceFreshness)
        : (record.sourceFreshness ?? { dependencyFactsHash: '', snapshotCreatedAt: '' })

    return {
      id: record.id,
      runId: record.runId,
      organizationId: record.organizationId,
      ruleId: record.ruleId as DetectionRuleId,
      severity: record.severity as DetectionSeverity,
      confidence: record.confidence as DetectionConfidenceBand,
      status: record.status as DetectionResultStatus,
      fingerprint: record.fingerprint,
      rationale: record.rationale,
      evidenceSummary: record.evidenceSummary,
      evidenceHash: record.evidenceHash,
      affectedEndpointHashes:
        typeof record.affectedEndpointHashes === 'string'
          ? JSON.parse(record.affectedEndpointHashes)
          : (record.affectedEndpointHashes ?? []),
      sourceFreshness: {
        dependencyFactsHash: sourceFreshness.dependencyFactsHash || '',
        snapshotCreatedAt: sourceFreshness.snapshotCreatedAt || '',
      },
      warnings:
        typeof record.warnings === 'string' ? JSON.parse(record.warnings) : (record.warnings ?? []),
      redactionState: record.redactionState as any,
      draftEligible: record.draftEligible,
      ignoreReasonHash: record.ignoreReasonHash,
      aiAdvisory: record.aiAdvisory as any,
      createdAt: record.createdAt?.toISO() ?? new Date().toISOString(),
      updatedAt: record.updatedAt?.toISO() ?? new Date().toISOString(),
    }
  }

  private aggregateResultSummary(results: DetectionResult[]): Record<DetectionSeverity, number> {
    const summary: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    for (const r of results) {
      summary[r.severity] = (summary[r.severity] || 0) + 1
    }
    return summary as Record<DetectionSeverity, number>
  }
}
