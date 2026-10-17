/**
 * v2-5-compiler-dynamic-routing-management-ui（切片 A/C/B, tasks 3.3/4.1/5.8）—— CompilerRoutingService。
 *
 * 组装低敏投影（切片 A）、只读模拟（切片 C）、受控规则写流（切片 B）。
 * Controller 只做 HTTP 解析/响应格式化；业务逻辑下沉到本 service。
 */
import { RoutingRuleRegistry } from './routing_rule_registry.js'
import { readPersistedDecision } from './routing_decision_persistence.js'
import type {
  RoutingRegistrySnapshotView,
  RoutingRuleView,
  RoutingDecisionSummaryView,
  RoutingRuleAuthoringRequest,
  RoutingRulePreviewResponse,
  RoutingRuleCommittedView,
  CompilerScenarioKind,
  RoutingRule,
} from '@aiproj/types/compiler-dynamic-routing'
import RoutingRuleModel from '#models/routing_rule'
import AuditService from '#services/audit_service'
import { randomUUID } from 'node:crypto'

// ── 已知 stage ids（与 production_handlers 注册对齐） ──

const KNOWN_STAGE_IDS = ['intent_ingestion', 'intent_parsing', 'dag_stub']

// ── 切片 A：只读观测 ──

/**
 * 获取注册表快照的低敏投影。
 * 合并代码 DEFAULT_RULES + 本组织已启用持久化规则。
 */
export async function getRegistrySnapshot(
  organizationId: number,
): Promise<RoutingRegistrySnapshotView> {
  // 获取本组织已启用持久化规则
  const persistedRules = await RoutingRuleModel.forOrganization(organizationId)
    .where('enabled', true)
    .orderBy('rule_id', 'asc')

  // 构建 registry（代码默认 + 组织持久化）
  const customRules = persistedRules.map(toRoutingRule)
  const registry = new RoutingRuleRegistry(KNOWN_STAGE_IDS, undefined)
  // 持久化规则经同一闸门注册
  const persistedViews: RoutingRuleView[] = []
  for (const pr of customRules) {
    try {
      // 用独立 registry 校验（不污染代码默认 registry）
      const testRegistry = new RoutingRuleRegistry(KNOWN_STAGE_IDS, [pr])
      testRegistry.snapshot() // 触发 validateAndRegister
      persistedViews.push(toRuleView(pr, 'org_persisted', true))
    } catch {
      // 校验失败的持久化规则跳过（不污染快照）
    }
  }

  const codeViews: RoutingRuleView[] = registry
    .snapshot()
    .rules.map((r) => toRuleView(r, 'code_default', true))

  const allRules = [...codeViews, ...persistedViews]

  return {
    version: registry.versionString,
    rules: allRules,
    ruleCount: allRules.length,
  }
}

/**
 * 获取 per-run 路由决策低敏摘要与 drift。
 */
export async function getRunRoutingDecision(
  organizationId: number,
  runId: number,
): Promise<RoutingDecisionSummaryView> {
  const result = await readPersistedDecision(organizationId, runId)
  return {
    hasDecision: result.hasDecision,
    decision: result.summary,
    drift: result.drift,
  }
}

// ── 切片 C：只读路由模拟（re-export from simulate_service） ──

export { simulate } from './routing_simulate_service.js'

// ── 切片 B：受控规则编排 ──

/** 活跃确认 token 存储（进程内，TTL 短）。 */
const pendingConfirms = new Map<
  string,
  { request: RoutingRuleAuthoringRequest; organizationId: number; expiresAt: number }
>()

/**
 * 构建规则编排预览/差异（确认前不落库）。
 */
export async function buildRulePreview(
  organizationId: number,
  request: RoutingRuleAuthoringRequest,
): Promise<RoutingRulePreviewResponse> {
  // 查找旧规则
  const existing = await RoutingRuleModel.forOrganization(organizationId)
    .where('rule_id', request.id)
    .where('version_major', request.version.major)
    .where('version_minor', request.version.minor)
    .first()

  const before: RoutingRuleView | null = existing
    ? toRuleView(fromModel(existing), 'org_persisted', existing.enabled)
    : null

  const after: RoutingRuleView = toRuleView(
    authoringToRoutingRule(request),
    'org_persisted',
    request.enabled,
  )

  const confirmToken = randomUUID()
  pendingConfirms.set(confirmToken, {
    request,
    organizationId,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 分钟 TTL
  })

  return {
    before,
    after,
    affectedScenarioKinds: request.scenarioKinds,
    affectedStageIds: [...request.allowedStageIds, ...request.allowedSkippedStageIds],
    confirmToken,
    previewOnly: true,
  }
}

/**
 * 确认并落库规则变更（携带 confirmToken 才落库）。
 */
export async function confirmAndCommitRule(
  confirmToken: string,
  userId: number,
): Promise<RoutingRuleCommittedView> {
  const pending = pendingConfirms.get(confirmToken)
  if (!pending || pending.expiresAt < Date.now()) {
    throw new Error('Invalid or expired confirmation token')
  }
  pendingConfirms.delete(confirmToken)

  const { request, organizationId } = pending

  // 落库（upsert：同 org+rule_id+version 更新，否则新建）
  const existing = await RoutingRuleModel.forOrganization(organizationId)
    .where('rule_id', request.id)
    .where('version_major', request.version.major)
    .where('version_minor', request.version.minor)
    .first()

  let model: RoutingRuleModel
  if (existing) {
    existing.scenarioKinds = request.scenarioKinds
    existing.allowedStageIds = request.allowedStageIds
    existing.allowedSkippedStageIds = request.allowedSkippedStageIds
    existing.reasonCode = request.reasonCode
    existing.isDefault = request.isDefault ?? false
    existing.enabled = request.enabled
    await existing.save()
    model = existing
  } else {
    model = await RoutingRuleModel.create({
      organizationId,
      ruleId: request.id,
      versionMajor: request.version.major,
      versionMinor: request.version.minor,
      compatibleMin: request.compatibleContracts.min,
      compatibleMax: request.compatibleContracts.max,
      scenarioKinds: request.scenarioKinds,
      allowedStageIds: request.allowedStageIds,
      allowedSkippedStageIds: request.allowedSkippedStageIds,
      reasonCode: request.reasonCode,
      isDefault: request.isDefault ?? false,
      enabled: request.enabled,
      createdBy: userId,
    })
  }

  // 审计
  await new AuditService().log({
    event: 'AI_COMPILER_ROUTING_RULE_CREATED',
    userId,
    organizationId,
    metadata: {
      ruleId: request.id,
      version: `${request.version.major}.${request.version.minor}`,
      action: existing ? 'update' : 'create',
    },
  })

  return {
    committed: true,
    rule: toRuleView(fromModel(model), 'org_persisted', model.enabled),
    auditEvent: 'AI_COMPILER_ROUTING_RULE_CREATED',
  }
}

// ── Helpers ──

function toRuleView(
  rule: RoutingRule,
  source: 'code_default' | 'org_persisted',
  enabled: boolean,
): RoutingRuleView {
  return {
    id: rule.id,
    version: rule.version,
    compatibleContracts: rule.compatibleContracts,
    scenarioKinds: rule.scenarioKinds,
    allowedStageIds: rule.allowedStageIds,
    allowedSkippedStageIds: rule.allowedSkippedStageIds,
    reasonCode: rule.reasonCode,
    isDefault: rule.isDefault ?? false,
    enabled,
    source,
  }
}

function toRoutingRule(model: RoutingRuleModel): RoutingRule {
  return {
    id: model.ruleId,
    version: { major: model.versionMajor, minor: model.versionMinor },
    compatibleContracts: { min: model.compatibleMin, max: model.compatibleMax },
    scenarioKinds: model.scenarioKinds as CompilerScenarioKind[],
    allowedStageIds: model.allowedStageIds,
    allowedSkippedStageIds: model.allowedSkippedStageIds,
    reasonCode: model.reasonCode as RoutingRule['reasonCode'],
    isDefault: model.isDefault,
  }
}

function fromModel(model: RoutingRuleModel): RoutingRule {
  return toRoutingRule(model)
}

function authoringToRoutingRule(req: RoutingRuleAuthoringRequest): RoutingRule {
  return {
    id: req.id,
    version: req.version,
    compatibleContracts: req.compatibleContracts,
    scenarioKinds: req.scenarioKinds,
    allowedStageIds: req.allowedStageIds,
    allowedSkippedStageIds: req.allowedSkippedStageIds,
    reasonCode: req.reasonCode,
    isDefault: req.isDefault ?? false,
  }
}
