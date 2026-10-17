import type {
  ResourceAnalysisCollectorOutput,
  ResourceSnapshot,
  ResourceOpportunityCandidate,
  OpportunityType,
  OpportunitySeverity,
  ResourceSourceRef,
  ResourceWarningCode,
} from '@aiproj/types'
import {
  computeResourceKey,
  computeResourceOpportunityKey,
  compareResourceOpportunity,
  computeResourceOpportunityImpactScore,
  RESOURCE_RULESET_VERSION,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'

/**
 * TRIZ 资源机会规则引擎（v3-triz-resource-analyzer §4.4–§4.5）。
 *
 * 从授权收集的输出中生成资源快照和未利用机会候选。
 * 所有逻辑确定性别、不修改数据、不调 AI。
 */
@inject()
export default class TrizResourceOpportunityRuleEngine {
  readonly ruleVersion = RESOURCE_RULESET_VERSION

  evaluate(input: ResourceAnalysisCollectorOutput): {
    resources: ResourceSnapshot[]
    opportunities: ResourceOpportunityCandidate[]
    warnings: Array<{ code: ResourceWarningCode; message: string }>
  } {
    const resources = this.buildResourceSnapshots(input)
    const opportunities = this.detectOpportunities(input, resources)
    return { resources, opportunities, warnings: [] }
  }

  // ── 资源快照构造 ──
  private buildResourceSnapshots(input: ResourceAnalysisCollectorOutput): ResourceSnapshot[] {
    const resources: ResourceSnapshot[] = []

    // 从正式资源摘要构建
    for (const summary of input.projectResourceSummary) {
      const key = computeResourceKey(summary.resourceKind, 'project_registry', summary.label)
      const sourceRef: ResourceSourceRef = {
        origin: 'project_registry',
        entityType: 'resource',
        entityId: summary.resourceId,
        lowSensitiveTitle: `项目资源：${summary.label}`,
        hash: summary.hash,
      }
      resources.push({
        resourceKey: key,
        label: summary.label,
        resourceKind: summary.resourceKind,
        systemScope: summary.systemScope,
        origin: 'project_registry',
        availability: summary.availability,
        utilizationState: summary.utilizationState,
        utilizationRate: input.resourceUtilization,
        accessibility: 0.8,
        costRating: 'unknown',
        capacity: null,
        sourceRefs: [sourceRef],
        sourceHashes: { [sourceRef.origin]: sourceRef.hash },
        constraintCodes: [],
        warningCodes: [],
        metrics: {},
      })
    }

    // 从任务数推断人力资源
    if (input.memberCount > 0) {
      const memberKey = computeResourceKey('human', 'project_registry', '项目团队')
      const hash = `members-${input.memberCount}`
      resources.push({
        resourceKey: memberKey,
        label: '项目团队',
        resourceKind: 'human',
        systemScope: 'internal_system',
        origin: 'project_registry',
        availability: input.memberCount > 2 ? 'high' : 'medium',
        utilizationState:
          input.resourceUtilization && input.resourceUtilization > 0.9
            ? 'fully_utilized'
            : 'partially_utilized',
        utilizationRate: input.resourceUtilization,
        accessibility: 0.9,
        costRating: 'high',
        capacity: `${input.memberCount} 人`,
        sourceRefs: [
          {
            origin: 'project_registry',
            entityType: 'project',
            entityId: input.projectId,
            lowSensitiveTitle: `项目成员 (${input.memberCount} 人)`,
            hash,
          },
        ],
        sourceHashes: { project_registry: hash },
        constraintCodes: [],
        warningCodes: [],
        metrics: { memberCount: input.memberCount },
      })
    }

    // 从用户补充草稿构建
    for (const draft of input.manualResourceDrafts) {
      const key = computeResourceKey(draft.resourceKind, 'user_supplied', draft.label)
      resources.push({
        resourceKey: key,
        label: draft.label,
        resourceKind: draft.resourceKind,
        systemScope: draft.systemScope,
        origin: 'user_supplied',
        availability: draft.availability,
        utilizationState: draft.utilizationState,
        utilizationRate: null,
        accessibility: 0.5,
        costRating: draft.costRating,
        capacity: draft.capacity,
        sourceRefs: [
          {
            origin: 'user_supplied',
            entityType: 'manual_draft',
            entityId: null,
            lowSensitiveTitle: `用户补充：${draft.description}`,
            hash: `manual-${key}`,
          },
        ],
        sourceHashes: { user_supplied: `manual-${key}` },
        constraintCodes: [],
        warningCodes: [],
        metrics: {},
      })
    }

    // 从风险摘要推断信息/知识资源
    if (input.activeRiskCount > 0) {
      const riskKey = computeResourceKey('information', 'risk_register', '风险洞察')
      resources.push({
        resourceKey: riskKey,
        label: '风险洞察',
        resourceKind: 'information',
        systemScope: 'internal_system',
        origin: 'risk_register',
        availability: input.activeRiskCount > 0 ? 'high' : 'medium',
        utilizationState: 'partially_utilized',
        utilizationRate: null,
        accessibility: 0.7,
        costRating: 'low',
        capacity: `${input.activeRiskCount} 条`,
        sourceRefs: [
          {
            origin: 'risk_register',
            entityType: 'risk',
            entityId: null,
            lowSensitiveTitle: `活跃风险 (${input.activeRiskCount})`,
            hash: input.sourceHashes.risks ?? 'na',
          },
        ],
        sourceHashes: { risk_register: input.sourceHashes.risks ?? 'na' },
        constraintCodes: [],
        warningCodes: [],
        metrics: { activeRiskCount: input.activeRiskCount, highRiskCount: input.highRiskCount },
      })
    }

    return resources
  }

  // ── 机会检测 ──
  private detectOpportunities(
    input: ResourceAnalysisCollectorOutput,
    resources: ResourceSnapshot[],
  ): ResourceOpportunityCandidate[] {
    const opps: ResourceOpportunityCandidate[] = []

    // RO-001: idle_capacity — 有闲置资源
    const idleResources = resources.filter(
      (r) => r.utilizationState === 'idle' || r.utilizationState === 'partially_utilized',
    )
    if (idleResources.length > 0) {
      opps.push(
        this.makeCandidate('idle_capacity', 'RO-001', idleResources, input, {
          title: '存在闲置或低利用资源可调配',
          summary: `检测到 ${idleResources.length} 个资源处于闲置或低利用状态，可重新调配以缓解关键路径压力或支持新需求。`,
          actions: ['查看依据', '加入方案篮子', '记录审查'],
        }),
      )
    }

    // RO-002: substitute_resource — 高成本/高利用资源的替代
    const highCostResources = resources.filter(
      (r) =>
        r.costRating === 'high' &&
        (r.utilizationState === 'fully_utilized' || r.utilizationState === 'overloaded'),
    )
    if (highCostResources.length > 0 && resources.some((r) => r.costRating === 'low')) {
      const lowCostResources = resources.filter((r) => r.costRating === 'low')
      opps.push(
        this.makeCandidate('substitute_resource', 'RO-002', highCostResources, input, {
          title: '高成本资源存在低成本替代可能',
          summary: `${highCostResources.length} 个高成本资源处于高利用状态，存在 ${lowCostResources.length} 个低成本资源可能替代。`,
          actions: ['查看依据', '加入方案篮子', '记录审查'],
        }),
      )
    }

    // RO-003: reuse_existing_asset — 功能分析/IFR/Compiler 有复用机会
    const hasExistingArtifacts =
      input.functionAnalysisRefs.length > 0 ||
      input.ifrRefs.length > 0 ||
      input.compilerTrizArtifactSummaries.length > 0
    if (hasExistingArtifacts) {
      const existingResources = resources.filter((r) => r.origin === 'project_registry')
      opps.push(
        this.makeCandidate('reuse_existing_asset', 'RO-003', existingResources, input, {
          title: '可用资产存在复用机会',
          summary: '功能分析、IFR 或 Compiler 产物表明项目中已有资产可复用，减少重复投入。',
          actions: ['查看依据', '加入方案篮子', '记录审查'],
        }),
      )
    }

    // RO-004: external_low_cost_resource — 用户补充的外部低成本资源
    const userResources = resources.filter((r) => r.origin === 'user_supplied')
    if (userResources.length > 0) {
      opps.push(
        this.makeCandidate('external_low_cost_resource', 'RO-004', userResources, input, {
          title: '存在外部低成本资源机会',
          summary: `用户补充了 ${userResources.length} 个外部或低成本资源选项，可考虑引入以降低成本或缓解瓶颈。`,
          actions: ['查看依据', '加入方案篮子', '记录审查'],
        }),
      )
    }

    // RO-005: information_gap — 知识引用少
    if (input.knowledgeRefCount < 2 && input.taskTotal > 10) {
      const infoResources = resources.filter((r) => r.resourceKind === 'information')
      opps.push(
        this.makeCandidate('information_gap', 'RO-005', infoResources, input, {
          title: '项目信息/知识资源不足',
          summary: `项目有 ${input.taskTotal} 个任务但仅有 ${input.knowledgeRefCount} 个文件/知识引用，可能存在信息缺口影响决策质量。`,
          actions: ['查看依据', '记录审查'],
        }),
      )
    }

    // RO-006: automation_opportunity — 重复任务或高频操作
    if (input.taskTotal > 20 && resources.some((r) => r.resourceKind === 'technical')) {
      const techResources = resources.filter((r) => r.resourceKind === 'technical')
      opps.push(
        this.makeCandidate('automation_opportunity', 'RO-006', techResources, input, {
          title: '大项目存在自动化机会',
          summary: `项目有 ${input.taskTotal} 个任务，技术资源可用于自动化重复流程，提高效率。`,
          actions: ['查看依据', '加入方案篮子', '记录审查'],
        }),
      )
    }

    // RO-007: overload_relief — 资源超载
    if (input.resourceOverloadCount > 0) {
      const overloaded = resources.filter((r) => r.utilizationState === 'overloaded')
      opps.push(
        this.makeCandidate('overload_relief', 'RO-007', overloaded, input, {
          title: '资源超载需要缓解',
          summary: `${input.resourceOverloadCount} 个资源超载，需调配、替代或增加资源以缓解瓶颈。`,
          actions: ['查看依据', '加入方案篮子', '记录审查', '生成资源预览'],
        }),
      )
    }

    // RO-008: environmental_resource — 闲置服务器/存储等
    const envResources = resources.filter(
      (r) =>
        r.resourceKind === 'technical' &&
        (r.systemScope === 'supersystem' || r.systemScope === 'external_environment') &&
        r.utilizationState === 'partially_utilized',
    )
    if (envResources.length > 0) {
      opps.push(
        this.makeCandidate('environmental_resource', 'RO-008', envResources, input, {
          title: '环境/基础设施资源可优化利用',
          summary: `${envResources.length} 个超系统或外部环境资源处于低利用状态，可考虑复用其闲置算力、存储或网络。`,
          actions: ['查看依据', '加入方案篮子', '记录审查'],
        }),
      )
    }

    // RO-009: constraint_as_resource — 风险/约束可转化为机会
    if (input.highRiskCount > 0) {
      const riskResources = resources.filter((r) => r.origin === 'risk_register')
      opps.push(
        this.makeCandidate('constraint_as_resource', 'RO-009', riskResources, input, {
          title: '高风险项可转化为资源机会',
          summary: `${input.highRiskCount} 个高风险项中存在通过资源调配消除或转化为机会的可能性。`,
          actions: ['查看依据', '加入方案篮子', '记录审查'],
        }),
      )
    }

    // 稳定排序
    return opps.sort(compareResourceOpportunity)
  }

  // ── 候选构造辅助 ──
  private makeCandidate(
    type: OpportunityType,
    ruleId: string,
    refResources: ResourceSnapshot[],
    input: ResourceAnalysisCollectorOutput,
    opts: { title: string; summary: string; actions: string[] },
  ): ResourceOpportunityCandidate {
    const resourceKeys = refResources.map((r) => r.resourceKey)
    const resourceRefs: ResourceSourceRef[] = refResources.map((r) => ({
      origin: r.origin,
      entityType: 'resource_snapshot',
      entityId: null,
      lowSensitiveTitle: r.label,
      hash: r.sourceHashes[r.origin] ?? '',
    }))
    const sourceHashes = { ...input.sourceHashes }
    const confidence = refResources.length > 1 ? 0.75 : 0.55
    const severity = this.inferSeverity(type, input)

    return {
      opportunityKey: computeResourceOpportunityKey(type, ruleId, resourceKeys),
      opportunityType: type,
      ruleId,
      status: 'unreviewed',
      severity,
      confidence,
      impactScore: computeResourceOpportunityImpactScore(severity, confidence, refResources.length),
      title: opts.title,
      rationaleSummary: opts.summary,
      resourceRefs,
      targetRefs: [],
      suggestedActions: opts.actions,
      sourceHashes,
      warningCodes: [],
      aiExplanationRef: null,
      reviewedBy: null,
      reviewedAt: null,
      outputHash: '',
      createdAt: new Date().toISOString(),
      updatedAt: null,
    }
  }

  private inferSeverity(
    type: OpportunityType,
    _input: ResourceAnalysisCollectorOutput,
  ): OpportunitySeverity {
    switch (type) {
      case 'overload_relief':
        return 'critical'
      case 'idle_capacity':
      case 'substitute_resource':
        return 'high'
      case 'automation_opportunity':
      case 'external_low_cost_resource':
        return 'medium'
      default:
        return 'low'
    }
  }
}
