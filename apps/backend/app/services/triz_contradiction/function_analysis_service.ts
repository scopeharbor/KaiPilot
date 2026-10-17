import TrizFunctionAnalysisRun from '#models/triz_function_analysis_run'
import TrizFunctionAnalysisNode from '#models/triz_function_analysis_node'
import TrizFunctionAnalysisEdge from '#models/triz_function_analysis_edge'
import TrizFunctionAnalysisIssueCandidate from '#models/triz_function_analysis_issue_candidate'
import AuditService, { AuditEvent } from '#services/audit_service'
import FunctionAnalysisInputCollector from '#services/triz_contradiction/function_analysis_input_collector'
import FunctionAnalysisRuleEngine from '#services/triz_contradiction/function_analysis_rule_engine'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type {
  FunctionAnalysisRun,
  FunctionComponentNode,
  FunctionRelationEdge,
  FunctionIssueCandidate,
  FunctionAnalysisLayoutMetadata,
  FunctionAnalysisHandoffInput,
  FunctionAnalysisWarningCode,
  FunctionIssueCandidateStatus,
  CreateFunctionAnalysisRequest,
  ListFunctionAnalysesQuery,
  ListFunctionIssuesQuery,
  ReviewFunctionIssueRequest,
} from '@aiproj/types'
import {
  FUNCTION_ANALYSIS_RULESET_VERSION,
  FUNCTION_ANALYSIS_LAYOUT_VERSION,
  computeFunctionAnalysisInputSignature,
  computeFunctionAnalysisIdempotencyKey,
  computeFunctionAnalysisOutputHash,
  compareFunctionIssueCandidate,
} from '@aiproj/types'

/**
 * 功能分析图服务（v3-triz-function-analysis-diagram §4.3–§4.8）。
 *
 * 确定性优先的编排：收集输入 → 规则引擎 → 持久化。
 * 所有收集和计算在事务外完成；事务仅持久化。
 */
@inject()
export default class FunctionAnalysisService {
  constructor(
    private collector: FunctionAnalysisInputCollector,
    private ruleEngine: FunctionAnalysisRuleEngine,
    private audit: AuditService,
  ) {}

  /**
   * 创建功能分析运行（幂等）。
   */
  async createAnalysis(
    organizationId: number,
    projectId: number,
    actorId: number,
    request: CreateFunctionAnalysisRequest,
  ): Promise<
    FunctionAnalysisRun & {
      nodes: FunctionComponentNode[]
      edges: FunctionRelationEdge[]
      issues: FunctionIssueCandidate[]
    }
  > {
    // 事务外：收集输入
    const collected = await this.collector.collect({
      organizationId,
      projectId,
      actorId,
      manualComponents: request.manualComponents,
      userContext: request.userContext,
    })

    // 事务外：计算签名
    const inputSignature = computeFunctionAnalysisInputSignature(collected)
    const idempotencyKey = computeFunctionAnalysisIdempotencyKey(
      organizationId,
      projectId,
      actorId,
      inputSignature,
      request.idempotencyKey,
    )

    // 幂等检查
    const existing = await this.findExistingRun(organizationId, projectId, idempotencyKey)
    if (existing) {
      if (existing.inputSignature === inputSignature && existing.status === 'completed') {
        return this.assembleRunResponse(existing)
      }
      await this.markRunStale(existing)
    }

    // 事务外：运行规则引擎
    const { nodes, edges, issues: rawIssues, layout } = this.ruleEngine.generate(collected)

    // 计算节点和边的入度/出度
    const inDegree = new Map<string, number>()
    const outDegree = new Map<string, number>()
    for (const e of edges) {
      inDegree.set(e.toNodeKey, (inDegree.get(e.toNodeKey) ?? 0) + 1)
      outDegree.set(e.fromNodeKey, (outDegree.get(e.fromNodeKey) ?? 0) + 1)
    }

    // 为节点填充入度/出度和布局位置
    for (const n of nodes) {
      n.metrics.inDegree = inDegree.get(n.nodeKey) ?? 0
      n.metrics.outDegree = outDegree.get(n.nodeKey) ?? 0
      n.metrics.totalWeight = n.metrics.inDegree + n.metrics.outDegree
      n.position = layout.nodePositions[n.nodeKey] ?? null
      n.sourceHashes = collected.sourceHashes
    }

    // 为边填充 sourceHashes
    for (const e of edges) {
      e.sourceHashes = collected.sourceHashes
    }

    // 为 issues 填充 sourceHashes
    for (const iss of rawIssues) {
      iss.sourceHashes = collected.sourceHashes
    }

    // 稳定排序
    rawIssues.sort(compareFunctionIssueCandidate)

    // 计算 output hash
    const nodeKeys = nodes.map((n) => n.nodeKey)
    const edgeKeys = edges.map((e) => e.edgeKey)
    const issueKeys = rawIssues.map((i) => i.issueKey)
    const outputHash = computeFunctionAnalysisOutputHash(nodeKeys, edgeKeys, issueKeys)

    // 为每个 issue 计算 output hash
    for (const iss of rawIssues) {
      iss.outputHash = outputHash
    }

    // 构建 warning 摘要
    const warningSummary = this.buildWarningSummary(collected.warnings)

    // 事务内：持久化
    const run = await db.transaction(async (trx) => {
      const newRun = await TrizFunctionAnalysisRun.create(
        {
          organizationId,
          projectId,
          actorId,
          status: warningSummary.length > 0 ? 'completed_with_warnings' : 'completed',
          inputSignature,
          outputHash,
          ruleVersion: FUNCTION_ANALYSIS_RULESET_VERSION,
          layoutVersion: FUNCTION_ANALYSIS_LAYOUT_VERSION,
          idempotencyKey,
          sourceSummaryJson: this.buildSourceSummary(collected),
          warningSummaryJson: warningSummary,
          nodeCount: nodes.length,
          edgeCount: edges.length,
          issueCount: rawIssues.length,
          completedAt: DateTime.now(),
        },
        { client: trx },
      )

      // 持久化节点
      for (const n of nodes) {
        await TrizFunctionAnalysisNode.create(
          {
            runId: newRun.id,
            organizationId,
            projectId,
            nodeKey: n.nodeKey,
            label: n.label,
            componentType: n.componentType,
            scope: n.scope,
            nodeStatus: n.status,
            sourceRefsJson: n.sourceRefs,
            sourceHashesJson: n.sourceHashes,
            metricsJson: n.metrics,
            positionJson: n.position,
            warningCodesJson: n.warningCodes,
          },
          { client: trx },
        )
      }

      // 持久化边
      for (const e of edges) {
        await TrizFunctionAnalysisEdge.create(
          {
            runId: newRun.id,
            organizationId,
            projectId,
            edgeKey: e.edgeKey,
            fromNodeKey: e.fromNodeKey,
            toNodeKey: e.toNodeKey,
            functionType: e.functionType,
            label: e.label,
            strength: e.strength,
            confidence: e.confidence,
            evidenceRefsJson: e.evidenceRefs,
            sourceHashesJson: e.sourceHashes,
            warningCodesJson: e.warningCodes,
          },
          { client: trx },
        )
      }

      // 持久化问题候选
      for (const iss of rawIssues) {
        await TrizFunctionAnalysisIssueCandidate.create(
          {
            runId: newRun.id,
            organizationId,
            projectId,
            issueKey: iss.issueKey,
            issueType: iss.issueType,
            severity: iss.severity,
            confidence: iss.confidence,
            impactScore: iss.impactScore,
            candidateStatus: iss.status,
            nodeRefsJson: iss.nodeRefs,
            edgeRefsJson: iss.edgeRefs,
            rationaleSummary: iss.rationaleSummary,
            suggestedActionsJson: iss.suggestedActions,
            sourceHashesJson: iss.sourceHashes,
            aiExplanationRef: iss.aiExplanationRef,
            reviewedBy: iss.reviewedBy,
            reviewedAt: iss.reviewedAt ? DateTime.fromISO(iss.reviewedAt) : null,
            warningCodesJson: iss.warningCodes,
            outputHash: iss.outputHash,
          },
          { client: trx },
        )
      }

      return newRun
    })

    // 审计
    await this.audit.log({
      event: AuditEvent.FUNCTION_ANALYSIS_RUN,
      userId: actorId,
      organizationId,
      projectId,
      metadata: {
        runId: run.id,
        inputSignature,
        outputHash,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        issueCount: rawIssues.length,
        warningCount: warningSummary.length,
      },
    })

    return this.assembleRunResponse(run)
  }

  /** 列出项目的分析运行 */
  async listRuns(
    organizationId: number,
    projectId: number,
    query: ListFunctionAnalysesQuery,
  ): Promise<{
    data: FunctionAnalysisRun[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    let dbQuery = TrizFunctionAnalysisRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')

    if (query.status) {
      dbQuery = dbQuery.where('status', query.status)
    }

    const result = await dbQuery.paginate(page, perPage)

    return {
      data: result.all().map((r) => this.toRunDTO(r)),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  /** 读取单个运行详情 */
  async getRun(
    organizationId: number,
    projectId: number,
    runId: number,
  ): Promise<FunctionAnalysisRun> {
    const run = await TrizFunctionAnalysisRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!run) {
      throw new ResourceNotFoundException('功能分析运行不存在')
    }

    return this.toRunDTO(run)
  }

  /** 获取图（节点+边+布局+问题摘要+警告） */
  async getGraph(
    organizationId: number,
    projectId: number,
    runId: number,
  ): Promise<{
    nodes: FunctionComponentNode[]
    edges: FunctionRelationEdge[]
    layout: FunctionAnalysisLayoutMetadata
    issuesSummary: Array<{
      issueKey: string
      issueType: string
      severity: string
      status: string
      rationaleSummary: string
    }>
    warnings: FunctionAnalysisWarningCode[]
  }> {
    const run = await this.findRunOrFail(organizationId, projectId, runId)

    const nodes = await TrizFunctionAnalysisNode.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    const edges = await TrizFunctionAnalysisEdge.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    const issues = await TrizFunctionAnalysisIssueCandidate.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    const nodePositions: Record<string, { x: number; y: number }> = {}
    for (const n of nodes) {
      if (n.positionJson) {
        nodePositions[n.nodeKey] = n.positionJson
      }
    }

    const layout: FunctionAnalysisLayoutMetadata = {
      layoutVersion: run.layoutVersion,
      algorithm: 'layered',
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      nodePositions,
    }

    await this.audit.log({
      event: AuditEvent.FUNCTION_ANALYSIS_GRAPH_READ,
      userId: null,
      organizationId,
      projectId,
      metadata: { runId },
    })

    return {
      nodes: nodes.map((n) => this.toNodeDTO(n)),
      edges: edges.map((e) => this.toEdgeDTO(e)),
      layout,
      issuesSummary: issues.map((i) => ({
        issueKey: i.issueKey,
        issueType: i.issueType,
        severity: i.severity,
        status: i.candidateStatus,
        rationaleSummary: i.rationaleSummary,
      })),
      warnings: run.warningSummaryJson.map((w) => w.code as FunctionAnalysisWarningCode),
    }
  }

  /** 列出运行的问题候选 */
  async listIssues(
    organizationId: number,
    projectId: number,
    runId: number,
    query: ListFunctionIssuesQuery,
  ): Promise<{
    data: FunctionIssueCandidate[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    let dbQuery = TrizFunctionAnalysisIssueCandidate.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('impact_score', 'desc')

    if (query.issueType) {
      dbQuery = dbQuery.where('issue_type', query.issueType)
    }
    if (query.severity) {
      dbQuery = dbQuery.where('severity', query.severity)
    }
    if (query.status) {
      dbQuery = dbQuery.where('candidate_status', query.status)
    }
    if (query.stale !== undefined) {
      if (query.stale) {
        dbQuery = dbQuery.where('candidate_status', 'blocked_stale')
      } else {
        dbQuery = dbQuery.whereNot('candidate_status', 'blocked_stale')
      }
    }

    const result = await dbQuery.paginate(page, perPage)

    return {
      data: result.all().map((i) => this.toIssueDTO(i)),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  /** 审查问题候选 */
  async reviewIssue(
    organizationId: number,
    projectId: number,
    runId: number,
    issueKey: string,
    actorId: number,
    request: ReviewFunctionIssueRequest,
  ): Promise<{
    issueKey: string
    status: FunctionIssueCandidateStatus
    reviewedBy: number
    reviewedAt: string
  }> {
    const issue = await TrizFunctionAnalysisIssueCandidate.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('issue_key', issueKey)
      .first()

    if (!issue) {
      throw new ResourceNotFoundException('功能分析问题候选不存在')
    }

    // 陈旧阻止审查
    if (issue.candidateStatus === 'blocked_stale') {
      throw new ValidationException('候选已陈旧，无法审查。请重新分析。')
    }

    const statusMap: Record<string, FunctionIssueCandidateStatus> = {
      reviewed: 'reviewed',
      dismissed: 'dismissed',
      needs_more_info: 'needs_more_info',
    }

    const newStatus = statusMap[request.action]
    if (!newStatus) {
      throw new ValidationException('无效的审查动作')
    }

    issue.candidateStatus = newStatus
    issue.reviewedBy = actorId
    issue.reviewedAt = DateTime.now()
    await issue.save()

    await this.audit.log({
      event: AuditEvent.FUNCTION_ANALYSIS_ISSUE_REVIEW,
      userId: actorId,
      organizationId,
      projectId,
      metadata: {
        runId,
        issueKey,
        action: request.action,
        reason: request.reason ?? null,
      },
    })

    return {
      issueKey: issue.issueKey,
      status: issue.candidateStatus,
      reviewedBy: actorId,
      reviewedAt: issue.reviewedAt!.toISO()!,
    }
  }

  /** 创建 Workbench 预览 */
  async createWorkbenchPreview(
    organizationId: number,
    projectId: number,
    runId: number,
    issueKey: string,
    actorId: number,
  ): Promise<FunctionAnalysisHandoffInput & { targetType: 'workbench' }> {
    const issue = await this.findIssueOrFail(organizationId, projectId, runId, issueKey)

    const blockingWarnings: FunctionAnalysisWarningCode[] = []
    if (issue.candidateStatus === 'blocked_stale') {
      blockingWarnings.push('HANDOFF_BLOCKED_STALE')
    }

    await this.audit.log({
      event: AuditEvent.FUNCTION_ANALYSIS_WORKBENCH_PREVIEW,
      userId: actorId,
      organizationId,
      projectId,
      metadata: { runId, issueKey, stale: blockingWarnings.length > 0 },
    })

    return {
      ...this.toHandoffInput(issue, actorId, organizationId, projectId),
      targetType: 'workbench',
    }
  }

  /** 创建 Decision 预览 */
  async createDecisionPreview(
    organizationId: number,
    projectId: number,
    runId: number,
    issueKey: string,
    actorId: number,
  ): Promise<FunctionAnalysisHandoffInput & { targetType: 'decision_log' }> {
    const issue = await this.findIssueOrFail(organizationId, projectId, runId, issueKey)

    const blockingWarnings: FunctionAnalysisWarningCode[] = []
    if (issue.candidateStatus === 'blocked_stale') {
      blockingWarnings.push('HANDOFF_BLOCKED_STALE')
    }

    await this.audit.log({
      event: AuditEvent.FUNCTION_ANALYSIS_DECISION_PREVIEW,
      userId: actorId,
      organizationId,
      projectId,
      metadata: { runId, issueKey, stale: blockingWarnings.length > 0 },
    })

    return {
      ...this.toHandoffInput(issue, actorId, organizationId, projectId),
      targetType: 'decision_log',
    }
  }

  /** 创建 Draft Handoff 预览 */
  async createDraftHandoffPreview(
    organizationId: number,
    projectId: number,
    runId: number,
    issueKey: string,
    actorId: number,
  ): Promise<FunctionAnalysisHandoffInput & { targetType: 'draft_layer' }> {
    const issue = await this.findIssueOrFail(organizationId, projectId, runId, issueKey)

    const blockingWarnings: FunctionAnalysisWarningCode[] = []
    if (issue.candidateStatus === 'blocked_stale') {
      blockingWarnings.push('HANDOFF_BLOCKED_STALE')
    }

    await this.audit.log({
      event: AuditEvent.FUNCTION_ANALYSIS_DRAFT_HANDOFF_PREVIEW,
      userId: actorId,
      organizationId,
      projectId,
      metadata: { runId, issueKey, stale: blockingWarnings.length > 0 },
    })

    return {
      ...this.toHandoffInput(issue, actorId, organizationId, projectId),
      targetType: 'draft_layer',
    }
  }

  // ─── Private helpers ───

  private async findExistingRun(
    organizationId: number,
    projectId: number,
    idempotencyKey: string,
  ): Promise<TrizFunctionAnalysisRun | null> {
    return TrizFunctionAnalysisRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('idempotency_key', idempotencyKey)
      .first()
  }

  private async markRunStale(run: TrizFunctionAnalysisRun): Promise<void> {
    run.status = 'stale'
    await run.save()
    await TrizFunctionAnalysisIssueCandidate.query()
      .where('run_id', run.id)
      .update({ candidateStatus: 'blocked_stale', updatedAt: DateTime.now() })
  }

  private async findRunOrFail(
    organizationId: number,
    projectId: number,
    runId: number,
  ): Promise<TrizFunctionAnalysisRun> {
    const run = await TrizFunctionAnalysisRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!run) {
      throw new ResourceNotFoundException('功能分析运行不存在')
    }

    return run
  }

  private async findIssueOrFail(
    organizationId: number,
    projectId: number,
    runId: number,
    issueKey: string,
  ): Promise<TrizFunctionAnalysisIssueCandidate> {
    const issue = await TrizFunctionAnalysisIssueCandidate.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('issue_key', issueKey)
      .first()

    if (!issue) {
      throw new ResourceNotFoundException('功能分析问题候选不存在')
    }

    return issue
  }

  private async assembleRunResponse(run: TrizFunctionAnalysisRun): Promise<
    FunctionAnalysisRun & {
      nodes: FunctionComponentNode[]
      edges: FunctionRelationEdge[]
      issues: FunctionIssueCandidate[]
    }
  > {
    const nodes = await TrizFunctionAnalysisNode.query()
      .where('run_id', run.id)
      .orderBy('id', 'asc')

    const edges = await TrizFunctionAnalysisEdge.query()
      .where('run_id', run.id)
      .orderBy('id', 'asc')

    const issues = await TrizFunctionAnalysisIssueCandidate.query()
      .where('run_id', run.id)
      .orderBy('impact_score', 'desc')

    return {
      ...this.toRunDTO(run),
      nodes: nodes.map((n) => this.toNodeDTO(n)),
      edges: edges.map((e) => this.toEdgeDTO(e)),
      issues: issues.map((i) => this.toIssueDTO(i)),
    }
  }

  private buildWarningSummary(
    collectorWarnings: Array<{ code: string; message: string }>,
  ): Array<{ code: FunctionAnalysisWarningCode; message: string }> {
    const seen = new Set<string>()
    const result: Array<{ code: FunctionAnalysisWarningCode; message: string }> = []
    for (const w of collectorWarnings) {
      const key = `${w.code}:${w.message}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push({
          code: w.code as FunctionAnalysisWarningCode,
          message: w.message,
        })
      }
    }
    return result
  }

  private buildSourceSummary(
    collected: Awaited<ReturnType<FunctionAnalysisInputCollector['collect']>>,
  ): Record<string, { count: number; hash: string }> {
    return {
      tasks: { count: collected.taskComponents.length, hash: collected.sourceHashes.tasks ?? '' },
      dependencies: {
        count: collected.dependencySummary.length,
        hash: collected.sourceHashes.dependencies ?? '',
      },
      resources: {
        count: collected.resourceSummary.length,
        hash: collected.sourceHashes.resources ?? '',
      },
      risks: { count: collected.riskSummary.length, hash: collected.sourceHashes.risks ?? '' },
      contradictions: {
        count: collected.contradictionRefs.length,
        hash: collected.sourceHashes.contradictions ?? '',
      },
    }
  }

  private toHandoffInput(
    issue: TrizFunctionAnalysisIssueCandidate,
    actorId: number,
    organizationId: number,
    projectId: number,
  ): FunctionAnalysisHandoffInput {
    return {
      runId: issue.runId,
      issueKey: issue.issueKey,
      nodeRefs: issue.nodeRefsJson,
      edgeRefs: issue.edgeRefsJson,
      issueType: issue.issueType,
      rationaleSummary: issue.rationaleSummary,
      suggestedActions: issue.suggestedActionsJson,
      sourceHashes: issue.sourceHashesJson,
      warnings: issue.warningCodesJson,
      idempotencyKey: `handoff-${issue.issueKey}`,
      actorId,
      organizationId,
      projectId,
    }
  }

  // ─── DTO mappers ───

  private toRunDTO(run: TrizFunctionAnalysisRun): FunctionAnalysisRun {
    return {
      id: run.id,
      organizationId: run.organizationId,
      projectId: run.projectId,
      actorId: run.actorId,
      status: run.status,
      inputSignature: run.inputSignature,
      outputHash: run.outputHash ?? '',
      ruleVersion: run.ruleVersion,
      layoutVersion: run.layoutVersion,
      idempotencyKey: run.idempotencyKey,
      sourceSummary: run.sourceSummaryJson,
      warningSummary: run.warningSummaryJson as FunctionAnalysisRun['warningSummary'],
      nodeCount: run.nodeCount,
      edgeCount: run.edgeCount,
      issueCount: run.issueCount,
      costSummary: run.costSummaryJson,
      createdAt: run.createdAt.toISO()!,
      updatedAt: run.updatedAt?.toISO() ?? null,
      completedAt: run.completedAt?.toISO() ?? null,
      archivedAt: run.archivedAt?.toISO() ?? null,
    }
  }

  private toNodeDTO(node: TrizFunctionAnalysisNode): FunctionComponentNode {
    return {
      nodeKey: node.nodeKey,
      label: node.label,
      componentType: node.componentType,
      scope: node.scope,
      status: node.nodeStatus,
      sourceRefs: node.sourceRefsJson,
      sourceHashes: node.sourceHashesJson,
      metrics: node.metricsJson,
      position: node.positionJson,
      warningCodes: node.warningCodesJson,
    }
  }

  private toEdgeDTO(edge: TrizFunctionAnalysisEdge): FunctionRelationEdge {
    return {
      edgeKey: edge.edgeKey,
      fromNodeKey: edge.fromNodeKey,
      toNodeKey: edge.toNodeKey,
      functionType: edge.functionType,
      label: edge.label,
      strength: edge.strength,
      confidence: edge.confidence,
      evidenceRefs: edge.evidenceRefsJson,
      sourceHashes: edge.sourceHashesJson,
      warningCodes: edge.warningCodesJson,
    }
  }

  private toIssueDTO(issue: TrizFunctionAnalysisIssueCandidate): FunctionIssueCandidate {
    return {
      issueKey: issue.issueKey,
      issueType: issue.issueType,
      severity: issue.severity,
      confidence: issue.confidence,
      impactScore: issue.impactScore,
      status: issue.candidateStatus,
      nodeRefs: issue.nodeRefsJson,
      edgeRefs: issue.edgeRefsJson,
      rationaleSummary: issue.rationaleSummary,
      suggestedActions: issue.suggestedActionsJson,
      sourceHashes: issue.sourceHashesJson,
      aiExplanationRef: issue.aiExplanationRef,
      reviewedBy: issue.reviewedBy,
      reviewedAt: issue.reviewedAt?.toISO() ?? null,
      warningCodes: issue.warningCodesJson,
      outputHash: issue.outputHash,
      createdAt: issue.createdAt.toISO()!,
      updatedAt: issue.updatedAt?.toISO() ?? null,
    }
  }
}
