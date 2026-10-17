// v3-triz-contradiction-copilot 任务 2.4 —— 只读工具 `list_project_signals`
//
// 语义：读取指定项目的被动雷达信号列表（低置信 → 角色首页建议队列；高置信 → 项目空间信号卡，
// 同一契约）。委托 W3 的 `ProjectSignalService.list`，并以 `ProjectSignalPolicy` 的**同款口径**
// 解析领域权限裁剪（`project:view` ∩ 领域权限：风险/缺陷类证据需 `risk:view`、
// 资源类需 `resource:view`、里程碑类需 `milestone:view`、进度类需 `task:view`）：
// 缺某一域权限时该类型信号的证据字段被裁剪为 null，而不是整体拒绝（spec 允许「裁剪或整条不可见」）。
//
// 只读：列表零写入（超期转 expired 只发生在检测写入路径），不触发模型调用、不落任何库。
// 跨组织 / 不存在的项目统一 404（RL-05，不泄露存在性）——先做组织级项目归属断言，
// 与 `list_project_risks` 同法。
import { PROJECT_VIEW } from '#rbac'
import {
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import app from '@adonisjs/core/services/app'
import Project from '#models/project'
import TenantScope from '#services/tenant_scope'
import ProjectSignalPolicy from '#policies/project_signal_policy'
import ProjectSignalService, {
  PROJECT_SIGNAL_LIST_DEFAULT_PER_PAGE,
  PROJECT_SIGNAL_LIST_MAX_PER_PAGE,
  type ProjectSignalDTO,
} from '#services/project_signal/project_signal_service'
import {
  PROJECT_SIGNAL_STATUSES,
  PROJECT_SIGNAL_TIERS,
  PROJECT_SIGNAL_TYPES,
  type ProjectSignalStatus,
  type ProjectSignalTier,
  type ProjectSignalType,
} from '#services/project_signal/signal_contracts'
import { asOptionalString, asPage, asPositiveInt } from './input_guards.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const LIST_PROJECT_SIGNALS_TOOL_NAME = 'list_project_signals'

export interface ListProjectSignalsParams {
  projectId: number
  /** 缺省 `open`（活跃视图）；`all` 查全部状态 */
  status?: ProjectSignalStatus | 'all'
  confidenceTier?: ProjectSignalTier
  signalType?: ProjectSignalType
  page?: number
  perPage?: number
}

export interface ListProjectSignalsResult {
  items: ProjectSignalDTO[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ListProjectSignalsDeps {
  signalService?: ProjectSignalService
  policy?: ProjectSignalPolicy
}

let signalServicePromise: Promise<ProjectSignalService> | null = null
function resolveSignalService(): Promise<ProjectSignalService> {
  signalServicePromise ??= app.container.make(ProjectSignalService)
  return signalServicePromise
}

let policyPromise: Promise<ProjectSignalPolicy> | null = null
function resolvePolicy(): Promise<ProjectSignalPolicy> {
  policyPromise ??= app.container.make(ProjectSignalPolicy)
  return policyPromise
}

/** 闭集收窄：入参只能是已登记的枚举值，未知值一律 422（不静默降级为空结果）。 */
function asEnum<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const text = asOptionalString(value, name)
  if (text === undefined) return undefined
  if (!(allowed as readonly string[]).includes(text)) {
    throw new ValidationException(`${name} 取值不在允许集合内（${allowed.join(' / ')}）`)
  }
  return text as T
}

/** 状态闭集收窄：在四种状态之外额外允许 `all`（全部状态视图）。 */
function asStatus(value: unknown): ProjectSignalStatus | 'all' | undefined {
  const text = asOptionalString(value, 'status')
  if (text === undefined) return undefined
  if (text === 'all') return 'all'
  if (!(PROJECT_SIGNAL_STATUSES as readonly string[]).includes(text)) {
    throw new ValidationException(
      'status 取值不在允许集合内（open / dismissed / adopted / expired / all）',
    )
  }
  return text as ProjectSignalStatus
}

export function createListProjectSignalsTool(
  deps?: ListProjectSignalsDeps,
): ToolDefinition<ListProjectSignalsParams, ListProjectSignalsResult> {
  return {
    name: LIST_PROJECT_SIGNALS_TOOL_NAME,
    description:
      '查询指定项目的被动雷达信号：按状态（open/dismissed/adopted/expired/all）、置信分层（low/high）、信号类型与分页过滤。返回信号类型、分层与理由、严重度、观测窗、读数证据（按调用方的领域权限裁剪）、状态流转痕迹与所需的领域权限码。只读，不触发检测、不产生任何写入。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1, description: '目标项目 ID' },
        status: {
          type: 'string',
          enum: [...PROJECT_SIGNAL_STATUSES, 'all'],
          description: '缺省 open（活跃信号）；all 表示全部状态',
        },
        confidenceTier: {
          type: 'string',
          enum: [...PROJECT_SIGNAL_TIERS],
          description: '置信分层：high 进项目空间信号卡，low 进角色首页建议队列',
        },
        signalType: {
          type: 'string',
          enum: [...PROJECT_SIGNAL_TYPES],
          description: '信号类型（进度偏差 / 风险突变 / 资源过载 / 里程碑滑移）',
        },
        page: { type: 'integer', minimum: 1, default: 1 },
        perPage: {
          type: 'integer',
          minimum: 1,
          maximum: PROJECT_SIGNAL_LIST_MAX_PER_PAGE,
          default: PROJECT_SIGNAL_LIST_DEFAULT_PER_PAGE,
        },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    requiredPermissions: [PROJECT_VIEW],
    sideEffect: 'read',
    handler: async (
      ctx: ToolExecutionContext,
      input: ListProjectSignalsParams,
    ): Promise<ToolExecutionResult<ListProjectSignalsResult>> => {
      const projectId = asPositiveInt(input.projectId, 'projectId')
      const status = asStatus(input.status)
      const confidenceTier = asEnum(input.confidenceTier, 'confidenceTier', PROJECT_SIGNAL_TIERS)
      const signalType = asEnum(input.signalType, 'signalType', PROJECT_SIGNAL_TYPES)
      const page = asPage(input.page, 'page', 1, 1000)
      const perPage = asPage(
        input.perPage,
        'perPage',
        PROJECT_SIGNAL_LIST_DEFAULT_PER_PAGE,
        PROJECT_SIGNAL_LIST_MAX_PER_PAGE,
      )

      // RL-05：先做组织级项目存在性断言（跨组织 / 不存在一律 404）
      const project = await TenantScope.forOrganization(Project.query(), ctx.organizationId)
        .where('id', projectId)
        .whereNull('deleted_at')
        .first()
      if (!project) throw new ResourceNotFoundException('项目不存在')

      // 领域权限裁剪：与 ProjectSignalPolicy 同款口径（缺域权限 ⇒ 证据被裁剪，不整体拒绝）
      const policy = deps?.policy ?? (await resolvePolicy())
      const decision = await policy.authorizeView(ctx.user, ctx.organizationId, projectId)
      if (!decision.allowed) {
        if (decision.reason === 'cross_org_denied')
          throw new ResourceNotFoundException('项目不存在')
        throw new PermissionDeniedException('缺少信号读取所需权限 (project:view)')
      }

      const service = deps?.signalService ?? (await resolveSignalService())
      const { data, meta } = await service.list({
        organizationId: ctx.organizationId,
        projectId,
        user: ctx.user,
        status: (status as ProjectSignalStatus | 'all' | undefined) ?? 'open',
        confidenceTier,
        signalType,
        page,
        perPage,
        domainAccess: decision.domainAccess,
      })

      return { status: 'SUCCESS', data: { items: data, meta } }
    },
  }
}
