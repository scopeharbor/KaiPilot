// v3-triz-contradiction-copilot W1 —— 上下文包组装服务（tasks 1.3）。
//
// 职责（design「架构（AI-as-ARIZ-Engine）」的「上下文包组装」一行 + spec「AI-as-ARIZ 后台语义映射」第 2 条）：
// - 只读取**当前项目**的事实：任务与关键路径、风险登记册、资源分配与负载、里程碑、变更请求；
// - 逐域权限裁剪：无该域权限 ⇒ 该域整体缺席，且**不发起**该域读取（不留越权读数、不留空壳）；
// - 组织隔离：项目归属断言走 TenantScope（跨组织/不存在统一 404，RL-05 不泄露存在性）；
// - 输出**有界**结构化上下文：实体 ID 白名单 + 读数摘要（供 1.4 的 contextRefs 反幻觉校验）。
//
// 边界：
// - 全程只读：零业务表写入、零模型调用、零外部外发；不复用写路径，不改既有服务契约；
// - 低敏：上下文不含 PM 陈述原文、prompt、模型输出等全文，只含实体 ID / 枚举 / 数值 / 有界标题；
// - 读取失败不吞错（fail-closed）：不把读取失败伪装成「空读数」，也不把跨组织伪装成空结果；
// - 预算上限只允许收紧：调用方传入的限制若大于默认值一律被忽略（见 resolveLimits）。
import Project from '#models/project'
import Task from '#models/task'
import {
  ValidationException,
  PermissionDeniedException,
  ResourceNotFoundException,
} from '#exceptions/api_exception'
import type User from '#models/user'
import TenantScope from '#services/tenant_scope'
import RbacService from '#services/rbac_service'
import ProjectEvmService, { type EvmScheduleStatus } from '#services/project_evm_service'
import RiskService from '#services/risk_service'
import ResourceLoadService, { type ResourceLoadResult } from '#services/resource_load_service'
import MilestoneService from '#services/milestone_service'
import ChangeRequestService from '#services/change_request_service'
import {
  CHANGE_REQUEST_CREATE,
  MILESTONE_VIEW,
  PROJECT_VIEW,
  RESOURCE_VIEW,
  RISK_VIEW,
  TASK_VIEW,
  type Permission,
} from '#rbac'
import type { PermissionCheckResult } from '#types/auth'
import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'

// ---------------------------------------------------------------------------
// 域与权限映射
// ---------------------------------------------------------------------------

export type TrizContextDomainKey = 'tasks' | 'risks' | 'resources' | 'milestones' | 'changeRequests'

/** 固定域序：白名单、裁剪原因与体积收缩都按此序输出，保证同一输入同一结果。 */
export const TRIZ_CONTEXT_DOMAIN_ORDER: readonly TrizContextDomainKey[] = [
  'tasks',
  'risks',
  'resources',
  'milestones',
  'changeRequests',
]

/**
 * 域 → 领域读取权限（spec「对话求解的 RBAC 与组织隔离」第 1 条：逐项校验）。
 *
 * 变更请求沿用既有 `ChangeRequestPolicy.view` 的口径（`change_request:create` 即项目成员可见），
 * 不新造权限码、不做 RBAC 迁移（design D17 ③ 同类结论）。
 */
export const TRIZ_CONTEXT_DOMAIN_PERMISSIONS: Readonly<Record<TrizContextDomainKey, Permission>> = {
  tasks: TASK_VIEW,
  risks: RISK_VIEW,
  resources: RESOURCE_VIEW,
  milestones: MILESTONE_VIEW,
  changeRequests: CHANGE_REQUEST_CREATE,
}

// ---------------------------------------------------------------------------
// 预算上限（默认值只允许收紧）
// ---------------------------------------------------------------------------

export interface TrizContextPackLimits {
  maxTaskItems: number
  maxCriticalPathTaskIds: number
  maxRiskItems: number
  maxResourceItems: number
  maxMilestoneItems: number
  maxChangeRequestItems: number
  maxEntityIds: number
  maxSerializedBytes: number
}

export const TRIZ_CONTEXT_PACK_LIMITS: Readonly<TrizContextPackLimits> = {
  maxTaskItems: 20,
  maxCriticalPathTaskIds: 20,
  maxRiskItems: 15,
  maxResourceItems: 15,
  maxMilestoneItems: 15,
  maxChangeRequestItems: 10,
  maxEntityIds: 100,
  maxSerializedBytes: 16 * 1024,
}

/** 体积下限：即便调用方传更小的上限，也不会把包压到装不下骨架。 */
const MIN_SERIALIZED_BYTES = 512

/** 资源负载观测窗（天）：资源域读数只看自 asOf 起的一段有界窗口，避免全周期负载重算。 */
const RESOURCE_WINDOW_DAYS = 14

/** 有界标题长度：超出即截断加省略号（低敏，不落长文本）。 */
const LABEL_MAX_LENGTH = 48

/**
 * 解析生效上限：默认值只允许**收紧**，调用方传入更大的值一律忽略（spec D7 同类语义）。
 */
export function resolveTrizContextPackLimits(
  overrides?: Partial<TrizContextPackLimits>,
): TrizContextPackLimits {
  const resolved: TrizContextPackLimits = { ...TRIZ_CONTEXT_PACK_LIMITS }
  if (!overrides) return resolved
  for (const key of Object.keys(TRIZ_CONTEXT_PACK_LIMITS) as (keyof TrizContextPackLimits)[]) {
    const value = overrides[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const tightened = Math.floor(value)
    if (tightened < 1) continue
    if (tightened < resolved[key]) resolved[key] = tightened
  }
  if (resolved.maxSerializedBytes < MIN_SERIALIZED_BYTES) {
    resolved.maxSerializedBytes = MIN_SERIALIZED_BYTES
  }
  return resolved
}

// ---------------------------------------------------------------------------
// 上下文包结构
// ---------------------------------------------------------------------------

export type TrizContextPackWarning = 'DOMAIN_TRIMMED' | 'CONTEXT_TRUNCATED'

export interface TrizContextTrimmedDomain {
  domain: TrizContextDomainKey
  requiredPermission: Permission
  reason: 'missing_permission'
}

export interface TrizContextTaskFact {
  id: number
  label: string
  status: string
  priority: string
  progressPercent: number
  isCriticalPath: boolean
  overdue: boolean
  startDate: string | null
  endDate: string | null
  milestoneId: number | null
  assigneeId: number | null
}

export interface TrizContextTaskDomain {
  readings: {
    total: number
    criticalPathCount: number
    overdueCount: number
    schedule: {
      spi: number
      sv: number
      scheduleStatus: EvmScheduleStatus
      hasBaseline: boolean
    }
  }
  items: TrizContextTaskFact[]
  criticalPathTaskIds: number[]
  truncated: boolean
}

export interface TrizContextRiskFact {
  id: number
  label: string
  category: string
  riskLevel: string
  status: string
  priority: string
  score: number
  probability: number
  impact: number
}

export interface TrizContextRiskDomain {
  readings: {
    total: number
    /** 风险矩阵占用格（probability × impact → count），空格不输出。 */
    matrixCells: Array<{ probability: number; impact: number; count: number }>
  }
  items: TrizContextRiskFact[]
  truncated: boolean
}

export interface TrizContextResourceFact {
  id: number
  label: string
  role: string
  dailyCapacityHours: number
  /** 观测窗内整体利用率（%）。 */
  utilizationPercent: number
  /** 观测窗内单日峰值分配比例（%），超配判据用峰值。 */
  peakDayUtilizationPercent: number
  overallocated: boolean
}

export interface TrizContextResourceDomain {
  readings: {
    windowFrom: string
    windowTo: string
    resourceCount: number
    teamAverageUtilizationPercent: number
    overloadedResourceCount: number
  }
  items: TrizContextResourceFact[]
  truncated: boolean
}

export interface TrizContextMilestoneFact {
  id: number
  label: string
  displayStatus: string
  storedStatus: string
  plannedDate: string | null
  derived: boolean
}

export interface TrizContextMilestoneDomain {
  readings: {
    total: number
    byDisplayStatus: Record<string, number>
  }
  items: TrizContextMilestoneFact[]
  truncated: boolean
}

export interface TrizContextChangeRequestFact {
  id: number
  label: string
  changeType: string
  status: string
  priority: string
}

export interface TrizContextChangeRequestDomain {
  readings: {
    total: number
    pendingApprovalCount: number
  }
  items: TrizContextChangeRequestFact[]
  truncated: boolean
}

/** 缺席的域（无权限）以 `undefined` 表达：不返回空壳，避免下游把「无权限」误读成「无数据」。 */
export interface TrizContextPackDomains {
  tasks?: TrizContextTaskDomain
  risks?: TrizContextRiskDomain
  resources?: TrizContextResourceDomain
  milestones?: TrizContextMilestoneDomain
  changeRequests?: TrizContextChangeRequestDomain
}

export type TrizContextEntityKind = 'task' | 'risk' | 'resource' | 'milestone' | 'change_request'

export const TRIZ_CONTEXT_ENTITY_KINDS: readonly TrizContextEntityKind[] = [
  'task',
  'risk',
  'resource',
  'milestone',
  'change_request',
]

/** 实体 ID 白名单：只含本次上下文实际读到的本项目实体（反幻觉校验的唯一依据）。 */
export interface TrizContextEntityWhitelist {
  taskIds: number[]
  riskIds: number[]
  resourceIds: number[]
  milestoneIds: number[]
  changeRequestIds: number[]
  /** 规范引用集合，形如 `task:12` / `change_request:3`，供 contextRefs 直接比对。 */
  refs: string[]
}

export interface TrizContextPack {
  organizationId: number
  projectId: number
  capturedAt: string
  asOfDate: string
  domains: TrizContextPackDomains
  entityWhitelist: TrizContextEntityWhitelist
  trimmedDomains: TrizContextTrimmedDomain[]
  warnings: TrizContextPackWarning[]
  truncated: boolean
  limits: TrizContextPackLimits
}

export interface TrizContextPackRequest {
  organizationId: number
  projectId: number
  user: User
  /** 评估日 'YYYY-MM-DD'，默认今日；只影响读数口径，不影响权限裁剪。 */
  asOfDate?: string
  limits?: Partial<TrizContextPackLimits>
}

/**
 * contextRefs 白名单校验（反幻觉关卡的一半，1.4 的 Schema 校验直接复用）：
 * 引用不存在于白名单即返回 false，调用方须丢弃或降级该实体绑定。
 */
export function isContextRefWhitelisted(pack: TrizContextPack, ref: string): boolean {
  if (typeof ref !== 'string') return false
  const separatorIndex = ref.indexOf(':')
  if (separatorIndex <= 0) return false
  const kind = ref.slice(0, separatorIndex)
  const id = ref.slice(separatorIndex + 1)
  if (!/^\d+$/.test(id)) return false
  if (!(TRIZ_CONTEXT_ENTITY_KINDS as readonly string[]).includes(kind)) return false
  return pack.entityWhitelist.refs.includes(ref)
}

// ---------------------------------------------------------------------------
// 依赖（既有两个领域服务 + 只读权限判定）
// ---------------------------------------------------------------------------

/**
 * 权限判定端口：与 `RbacService.check` 签名一致（可直接注入 RbacService），
 * 单测可替换为确定性假实现以覆盖「缺某领域权限」的分支。
 */
export interface TrizContextPermissionChecker {
  check(
    user: User,
    permission: Permission,
    organizationId: number,
    projectId?: number,
  ): Promise<PermissionCheckResult>
}

export interface TrizContextPackDeps {
  permissionChecker: TrizContextPermissionChecker
  evmService: ProjectEvmService
  riskService: RiskService
  resourceLoadService: ResourceLoadService
  milestoneService: MilestoneService
  changeRequestService: ChangeRequestService
}

/** 各依赖服务均无状态副作用，按调用点解析即得容器单例。 */
async function resolveDefaultDeps(): Promise<TrizContextPackDeps> {
  return {
    permissionChecker: await app.container.make(RbacService),
    evmService: await app.container.make(ProjectEvmService),
    riskService: await app.container.make(RiskService),
    resourceLoadService: await app.container.make(ResourceLoadService),
    milestoneService: await app.container.make(MilestoneService),
    changeRequestService: await app.container.make(ChangeRequestService),
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 有界标题：折叠空白并截断，杜绝长文本正文进入上下文。 */
export function boundContextLabel(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value ?? '')
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= LABEL_MAX_LENGTH) return collapsed
  return `${collapsed.slice(0, LABEL_MAX_LENGTH)}…`
}

function serializedByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function toIsoDate(value: DateTime | null | undefined): string | null {
  return value ? value.toISODate() : null
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export default class TrizContextPackService {
  readonly #overrides: Partial<TrizContextPackDeps>

  constructor(overrides: Partial<TrizContextPackDeps> = {}) {
    this.#overrides = overrides
  }

  /**
   * 组装上下文包。调用顺序即红线顺序：先组织隔离，再基线权限，最后逐域裁剪读取。
   */
  async assemble(request: TrizContextPackRequest): Promise<TrizContextPack> {
    const deps: TrizContextPackDeps = { ...(await resolveDefaultDeps()), ...this.#overrides }
    const limits = resolveTrizContextPackLimits(request.limits)
    const asOfDate = this.#normalizeAsOfDate(request.asOfDate)
    const { organizationId, projectId, user } = request

    await this.#assertProjectInOrganization(organizationId, projectId)

    const projectView = await deps.permissionChecker.check(
      user,
      PROJECT_VIEW,
      organizationId,
      projectId,
    )
    if (!projectView.allowed) {
      // 与 AiToolsPolicy 同口径：判定器报跨组织时统一 404，严禁以 403 泄露资源存在性（RL-05）。
      if (projectView.reason === 'cross_org_denied') {
        throw new ResourceNotFoundException('项目不存在')
      }
      throw new PermissionDeniedException('缺少项目查看权限 (project:view)')
    }

    const trimmedDomains: TrizContextTrimmedDomain[] = []
    const allowedDomains = new Set<TrizContextDomainKey>()
    for (const domain of TRIZ_CONTEXT_DOMAIN_ORDER) {
      const permission = TRIZ_CONTEXT_DOMAIN_PERMISSIONS[domain]
      const result = await deps.permissionChecker.check(user, permission, organizationId, projectId)
      if (result.allowed) {
        allowedDomains.add(domain)
      } else {
        trimmedDomains.push({
          domain,
          requiredPermission: permission,
          reason: 'missing_permission',
        })
      }
    }

    const domains: TrizContextPackDomains = {}
    if (allowedDomains.has('tasks')) {
      domains.tasks = await this.#buildTaskDomain(deps, organizationId, projectId, asOfDate, limits)
    }
    if (allowedDomains.has('risks')) {
      domains.risks = await this.#buildRiskDomain(deps, organizationId, projectId, limits)
    }
    if (allowedDomains.has('resources')) {
      domains.resources = await this.#buildResourceDomain(
        deps,
        organizationId,
        projectId,
        asOfDate,
        limits,
      )
    }
    if (allowedDomains.has('milestones')) {
      domains.milestones = await this.#buildMilestoneDomain(deps, organizationId, projectId, limits)
    }
    if (allowedDomains.has('changeRequests')) {
      domains.changeRequests = await this.#buildChangeRequestDomain(
        deps,
        organizationId,
        projectId,
        limits,
      )
    }

    const pack: TrizContextPack = {
      organizationId,
      projectId,
      capturedAt: new Date().toISOString(),
      asOfDate,
      domains,
      entityWhitelist: emptyWhitelist(),
      trimmedDomains,
      warnings: trimmedDomains.length > 0 ? ['DOMAIN_TRIMMED'] : [],
      truncated: false,
      limits,
    }

    this.#applyBounds(pack, limits)

    pack.entityWhitelist = buildWhitelist(pack, limits.maxEntityIds)
    pack.truncated = isAnyDomainTruncated(pack) || didWhitelistTruncate(pack, limits.maxEntityIds)
    if (pack.truncated && !pack.warnings.includes('CONTEXT_TRUNCATED')) {
      pack.warnings.push('CONTEXT_TRUNCATED')
    }

    return pack
  }

  // ── 组织隔离与输入归一 ────────────────────────────────────────────

  /**
   * 组织级项目存在性断言：跨组织/不存在统一 404（RL-05）。
   * 后续每个域的读取都建立在「项目属于当前组织」之上。
   */
  async #assertProjectInOrganization(organizationId: number, projectId: number): Promise<void> {
    const project = await TenantScope.forOrganization(Project.query(), organizationId)
      .where('id', projectId)
      .whereNull('deleted_at')
      .first()
    if (!project) {
      throw new ResourceNotFoundException('项目不存在')
    }
  }

  #normalizeAsOfDate(input?: string): string {
    if (input === undefined) {
      return DateTime.now().toISODate()!
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      throw new ValidationException('asOfDate 必须为 YYYY-MM-DD')
    }
    const parsed = DateTime.fromISO(input)
    if (!parsed.isValid) {
      throw new ValidationException('asOfDate 不是合法日期')
    }
    return parsed.toISODate()!
  }

  // ── 任务与关键路径 ────────────────────────────────────────────────

  /**
   * 任务域：模型只读投影（与 `get_gantt_snapshot` 同法）取全项目任务，
   * 使关键路径计数与逾期计数覆盖全量而非单页；进度读数复用既有 EVM 服务。
   *
   * 组织隔离口径：`tasks` 表没有 `organization_id` 列（项目内实体），
   * 因此隔离靠**前置的项目归属断言**（`#assertProjectInOrganization`，TenantScope 组织级过滤）
   * 加 `project_id` 约束达成；同组织其它项目的任务不可能进入读数（有单测覆盖）。
   */
  async #buildTaskDomain(
    deps: TrizContextPackDeps,
    organizationId: number,
    projectId: number,
    asOfDate: string,
    limits: TrizContextPackLimits,
  ): Promise<TrizContextTaskDomain> {
    const tasks = await Task.query()
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .select(
        'id',
        'name',
        'status',
        'priority',
        'progress_percent',
        'start_date',
        'end_date',
        'is_critical_path',
        'milestone_id',
        'assignee_id',
      )
      .orderBy('id')

    const indicators = await deps.evmService.getIndicators(organizationId, projectId, asOfDate)

    const facts = tasks.map((task) => ({
      id: task.id,
      label: boundContextLabel(task.name),
      status: task.status,
      priority: task.priority,
      progressPercent: Number(task.progressPercent ?? 0),
      isCriticalPath: Boolean(task.isCriticalPath),
      overdue: isOverdue(task, asOfDate),
      startDate: toIsoDate(task.startDate),
      endDate: toIsoDate(task.endDate),
      milestoneId: task.milestoneId,
      assigneeId: task.assigneeId,
    }))

    // 确定性取页：逾期 → 关键路径 → 截止日升序（无日期靠后）→ id 升序
    const items = [...facts].sort(compareTaskFacts).slice(0, limits.maxTaskItems)

    const criticalPathTaskIds = facts
      .filter((fact) => fact.isCriticalPath)
      .map((fact) => fact.id)
      .slice(0, limits.maxCriticalPathTaskIds)

    return {
      readings: {
        total: facts.length,
        criticalPathCount: facts.filter((fact) => fact.isCriticalPath).length,
        overdueCount: facts.filter((fact) => fact.overdue).length,
        schedule: {
          spi: indicators.spi,
          sv: indicators.sv,
          scheduleStatus: indicators.scheduleStatus,
          hasBaseline: indicators.hasBaseline,
        },
      },
      items,
      criticalPathTaskIds,
      truncated:
        facts.length > items.length ||
        facts.filter((fact) => fact.isCriticalPath).length > criticalPathTaskIds.length,
    }
  }

  // ── 风险登记册 ────────────────────────────────────────────────────

  async #buildRiskDomain(
    deps: TrizContextPackDeps,
    organizationId: number,
    projectId: number,
    limits: TrizContextPackLimits,
  ): Promise<TrizContextRiskDomain> {
    const { data, meta } = await deps.riskService.list(organizationId, projectId, {
      sort: '-score',
      perPage: limits.maxRiskItems,
    })
    const matrix = await deps.riskService.matrix(organizationId, projectId)

    const items = data
      .map((risk) => ({
        id: risk.id,
        label: boundContextLabel(risk.title),
        category: risk.category,
        riskLevel: risk.riskLevel,
        status: risk.status,
        priority: risk.priority,
        score: Number(risk.score ?? 0),
        probability: Number(risk.probability ?? 0),
        impact: Number(risk.impact ?? 0),
      }))
      .sort((a, b) => b.score - a.score || a.id - b.id)

    const matrixCells = matrix.cells
      .filter((cell) => cell.count > 0)
      .map((cell) => ({ probability: cell.probability, impact: cell.impact, count: cell.count }))

    return {
      readings: { total: meta.total, matrixCells },
      items,
      truncated: meta.total > items.length,
    }
  }

  // ── 资源分配与负载 ────────────────────────────────────────────────

  async #buildResourceDomain(
    deps: TrizContextPackDeps,
    organizationId: number,
    projectId: number,
    asOfDate: string,
    limits: TrizContextPackLimits,
  ): Promise<TrizContextResourceDomain> {
    const windowFrom = asOfDate
    const windowTo = DateTime.fromISO(asOfDate)
      .plus({ days: RESOURCE_WINDOW_DAYS - 1 })
      .toISODate()!

    const raw = await deps.resourceLoadService.load(
      organizationId,
      projectId,
      windowFrom,
      windowTo,
      'team',
    )
    if (!('resources' in raw)) {
      throw new ValidationException('资源负载读数不可用')
    }
    const load = raw as ResourceLoadResult

    const facts = load.resources.map((resource) => {
      const peakDayUtilizationPercent = resource.days.reduce(
        (peak, day) => Math.max(peak, Number(day.totalAllocatedPercent ?? 0)),
        0,
      )
      return {
        id: resource.resourceId,
        label: boundContextLabel(resource.resourceName),
        role: resource.role,
        dailyCapacityHours: Number(resource.dailyCapacityHours ?? 0),
        utilizationPercent: Number(resource.overallUtilizationPercent ?? 0),
        peakDayUtilizationPercent,
        overallocated: peakDayUtilizationPercent > 100,
      }
    })

    const items = [...facts]
      .sort(
        (a, b) =>
          Number(b.overallocated) - Number(a.overallocated) ||
          b.peakDayUtilizationPercent - a.peakDayUtilizationPercent ||
          a.id - b.id,
      )
      .slice(0, limits.maxResourceItems)

    return {
      readings: {
        windowFrom,
        windowTo,
        resourceCount: facts.length,
        teamAverageUtilizationPercent: Number(load.teamAverageUtilizationPercent ?? 0),
        overloadedResourceCount: facts.filter((fact) => fact.overallocated).length,
      },
      items,
      truncated: facts.length > items.length,
    }
  }

  // ── 里程碑 ────────────────────────────────────────────────────────

  async #buildMilestoneDomain(
    deps: TrizContextPackDeps,
    organizationId: number,
    projectId: number,
    limits: TrizContextPackLimits,
  ): Promise<TrizContextMilestoneDomain> {
    const views = await deps.milestoneService.listForProject(organizationId, projectId)

    const facts = views.map((view) => ({
      id: view.milestone.id,
      label: boundContextLabel(view.milestone.name),
      displayStatus: view.displayStatus,
      storedStatus: view.storedStatus,
      plannedDate: toIsoDate(view.milestone.plannedDate),
      derived: view.derived,
    }))

    const items = [...facts]
      .sort(
        (a, b) =>
          MILESTONE_STATUS_PRIORITY[a.displayStatus] - MILESTONE_STATUS_PRIORITY[b.displayStatus] ||
          compareNullableDateAsc(a.plannedDate, b.plannedDate) ||
          a.id - b.id,
      )
      .slice(0, limits.maxMilestoneItems)

    const byDisplayStatus: Record<string, number> = {}
    for (const fact of facts) {
      byDisplayStatus[fact.displayStatus] = (byDisplayStatus[fact.displayStatus] ?? 0) + 1
    }

    return {
      readings: { total: facts.length, byDisplayStatus },
      items,
      truncated: facts.length > items.length,
    }
  }

  // ── 变更请求 ──────────────────────────────────────────────────────

  async #buildChangeRequestDomain(
    deps: TrizContextPackDeps,
    organizationId: number,
    projectId: number,
    limits: TrizContextPackLimits,
  ): Promise<TrizContextChangeRequestDomain> {
    const { data, meta } = await deps.changeRequestService.list(organizationId, projectId, {
      sort: '-createdAt',
      perPage: limits.maxChangeRequestItems,
    })

    let pendingApprovalCount = 0
    for (const status of PENDING_APPROVAL_STATUSES) {
      const page = await deps.changeRequestService.list(organizationId, projectId, {
        status,
        perPage: 1,
      })
      pendingApprovalCount += page.meta.total
    }

    const items = data.map((changeRequest) => ({
      id: changeRequest.id,
      label: boundContextLabel(changeRequest.title),
      changeType: changeRequest.changeType,
      status: changeRequest.status,
      priority: changeRequest.priority,
    }))

    return {
      readings: { total: meta.total, pendingApprovalCount },
      items,
      truncated: meta.total > items.length,
    }
  }

  // ── 有界收缩 ──────────────────────────────────────────────────────

  /**
   * 体积收缩：超出字节上限时按固定域序从尾部逐条丢弃（只减条目，不动读数与白名单语义），
   * 丢到最后仍有骨架，循环必然终止。被丢弃的域标记 `truncated`。
   *
   * 分工：**条目数是硬上限**（逐域 slice，见各域构造）；字节上限是二级护栏，
   * 靠丢条目逼近。包的骨架（读数 + 上限回显 + 白名单/裁剪清单）约 1.4KB，
   * 因此 `maxSerializedBytes` 应设在骨架之上（默认 16KB）；设到骨架以下时包会
   * 被压到最简（条目全丢）并如实标记 `truncated`，不会假装达标。
   */
  #applyBounds(pack: TrizContextPack, limits: TrizContextPackLimits): void {
    let bytes = serializedByteLength(pack)
    if (bytes <= limits.maxSerializedBytes) return

    const shrinkSteps: Array<() => boolean> = [
      () => popTail(pack.domains.changeRequests),
      () => popTail(pack.domains.milestones),
      () => popTail(pack.domains.resources),
      () => popTail(pack.domains.risks),
      () => popTail(pack.domains.tasks),
      () => popCriticalPathTail(pack.domains.tasks),
    ]

    while (bytes > limits.maxSerializedBytes) {
      let shrank = false
      for (const step of shrinkSteps) {
        if (!step()) continue
        shrank = true
        bytes = serializedByteLength(pack)
        if (bytes <= limits.maxSerializedBytes) break
      }
      if (!shrank) break
    }
  }
}

// ---------------------------------------------------------------------------
// 纯函数辅助
// ---------------------------------------------------------------------------

const MILESTONE_STATUS_PRIORITY: Record<string, number> = {
  missed: 0,
  at_risk: 1,
  planned: 2,
  not_started: 3,
  achieved: 4,
}

const PENDING_APPROVAL_STATUSES = ['submitted', 'under_review'] as const

const TERMINAL_TASK_STATUSES = new Set(['completed', 'cancelled'])

function isOverdue(task: Task, asOfDate: string): boolean {
  const endDate = task.endDate ? task.endDate.toISODate() : null
  if (!endDate) return false
  if (TERMINAL_TASK_STATUSES.has(task.status)) return false
  return endDate < asOfDate
}

function compareTaskFacts(a: TrizContextTaskFact, b: TrizContextTaskFact): number {
  return (
    Number(b.overdue) - Number(a.overdue) ||
    Number(b.isCriticalPath) - Number(a.isCriticalPath) ||
    compareNullableDateAsc(a.endDate, b.endDate) ||
    a.id - b.id
  )
}

/** 日期升序，null 视为最大（排最后）。 */
function compareNullableDateAsc(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : 1
}

interface BoundedDomain {
  items: Array<{ id: number }>
  truncated: boolean
}

function popTail(domain: BoundedDomain | undefined): boolean {
  if (!domain || domain.items.length === 0) return false
  domain.items.pop()
  domain.truncated = true
  return true
}

function popCriticalPathTail(domain: TrizContextTaskDomain | undefined): boolean {
  if (!domain || domain.criticalPathTaskIds.length === 0) return false
  domain.criticalPathTaskIds.pop()
  domain.truncated = true
  return true
}

function isAnyDomainTruncated(pack: TrizContextPack): boolean {
  return TRIZ_CONTEXT_DOMAIN_ORDER.some((domain) => pack.domains[domain]?.truncated === true)
}

function emptyWhitelist(): TrizContextEntityWhitelist {
  return {
    taskIds: [],
    riskIds: [],
    resourceIds: [],
    milestoneIds: [],
    changeRequestIds: [],
    refs: [],
  }
}

/**
 * 由最终保留的条目重建白名单：任何不在包内的实体 ID 都不可能进入白名单，
 * 于是 1.4 的白名单校验天然拒绝模型编造的 ID。
 *
 * 各 kind 数组由**截断后的 refs 反推**，保证「数组 ↔ refs」双向一致：
 * 不会出现 id 在白名单数组里却不在 refs 中（或反之）的半截白名单。
 */
function buildWhitelist(pack: TrizContextPack, maxEntityIds: number): TrizContextEntityWhitelist {
  const refs: string[] = []
  for (const id of collectEntityIds(pack, 'task')) refs.push(`task:${id}`)
  for (const id of collectEntityIds(pack, 'risk')) refs.push(`risk:${id}`)
  for (const id of collectEntityIds(pack, 'resource')) refs.push(`resource:${id}`)
  for (const id of collectEntityIds(pack, 'milestone')) refs.push(`milestone:${id}`)
  for (const id of collectEntityIds(pack, 'change_request')) refs.push(`change_request:${id}`)

  const capped = refs.slice(0, maxEntityIds)
  const whitelist = emptyWhitelist()
  whitelist.taskIds = idsOfKind(capped, 'task')
  whitelist.riskIds = idsOfKind(capped, 'risk')
  whitelist.resourceIds = idsOfKind(capped, 'resource')
  whitelist.milestoneIds = idsOfKind(capped, 'milestone')
  whitelist.changeRequestIds = idsOfKind(capped, 'change_request')
  whitelist.refs = capped
  return whitelist
}

function collectEntityIds(pack: TrizContextPack, kind: TrizContextEntityKind): number[] {
  switch (kind) {
    case 'task':
      return uniqueSorted([
        ...(pack.domains.tasks?.items ?? []).map((item) => item.id),
        ...(pack.domains.tasks?.criticalPathTaskIds ?? []),
      ])
    case 'risk':
      return uniqueSorted((pack.domains.risks?.items ?? []).map((item) => item.id))
    case 'resource':
      return uniqueSorted((pack.domains.resources?.items ?? []).map((item) => item.id))
    case 'milestone':
      return uniqueSorted((pack.domains.milestones?.items ?? []).map((item) => item.id))
    case 'change_request':
      return uniqueSorted((pack.domains.changeRequests?.items ?? []).map((item) => item.id))
  }
}

function idsOfKind(refs: readonly string[], kind: TrizContextEntityKind): number[] {
  const prefix = `${kind}:`
  return refs.filter((ref) => ref.startsWith(prefix)).map((ref) => Number(ref.slice(prefix.length)))
}

function didWhitelistTruncate(pack: TrizContextPack, maxEntityIds: number): boolean {
  const total = TRIZ_CONTEXT_ENTITY_KINDS.reduce(
    (sum, kind) => sum + collectEntityIds(pack, kind).length,
    0,
  )
  return total > maxEntityIds
}

function uniqueSorted(ids: readonly number[]): number[] {
  return Array.from(new Set(ids)).sort((a, b) => a - b)
}
