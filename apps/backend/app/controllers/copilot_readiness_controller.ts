/**
 * v3-copilot-productized-operating-entry —— readiness 只读端点控制器（任务 3.6）。
 *
 * 只做 HTTP 解析、组织上下文解析、依赖装配与统一 envelope；
 * 判定与聚合下沉到 `services/copilot_entry/copilot_operating_entry_service`。
 *
 * 契约：成功 `{ data }`；错误 `{ error: { code, message, details? } }`。
 * 红线：
 * - **GET 只读**：零域写、零会话写、零审计写、零入口专用表；
 * - **禁止**调用模型/provider/公网；readiness 只评估宿主可证明的本地前置条件；
 * - 不可访问 scope 一律 fail closed，不回显其名称/ID/计数/存在性。
 */

import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import { PermissionDeniedException } from '#exceptions/api_exception'
import { copilotReadinessQueryValidator } from '#validators/copilot_readiness_validator'
import CopilotEntryPolicy from '#policies/copilot_entry_policy'
import RbacService from '#services/rbac_service'
import Project from '#models/project'
import { copilotSessionService } from '../services/copilot_session/index.js'
import { CopilotPluginToolSnapshotService } from '#services/copilot_plugin_tools/plugin_tool_snapshot_service'
import {
  buildCopilotPluginToolSnapshotDeps,
  copilotToolActorKey,
} from '#services/copilot_plugin_tools/plugin_tool_snapshot_default_deps'
import {
  CopilotOperatingEntryService,
  type CopilotEntryRequestContext,
  type CopilotEntrySessionProjection,
  type CopilotEntryToolSnapshotProjection,
} from '#services/copilot_entry/copilot_operating_entry_service'

@inject()
export default class CopilotReadinessController {
  constructor(
    private readonly entryPolicy: CopilotEntryPolicy,
    private readonly rbac: RbacService,
  ) {}

  /**
   * GET /api/v1/copilot/readiness —— 宿主就绪快照。
   *
   * 组织取自请求级租户上下文（唯一合法来源）；`projectId` 只是待复核的 scope 输入。
   */
  async show(ctx: HttpContext) {
    const { request, response } = ctx
    const user = this.requireUser(ctx)
    const organizationId = ctx.tenant?.organizationId ?? null

    const query = await copilotReadinessQueryValidator.validate({
      projectId: request.input('projectId'),
    })

    const entryContext: CopilotEntryRequestContext = {
      actorId: user.id,
      organizationId: organizationId === null ? null : Number(organizationId),
      ...(query.projectId !== undefined ? { requestedProjectId: query.projectId } : {}),
    }

    const service = new CopilotOperatingEntryService({
      canUseCopilot: async (context) =>
        this.entryPolicy.canUseCopilot(user, context.organizationId as number),
      canAccessProject: async (context, projectId) =>
        this.entryPolicy.canAccessProject(user, context.organizationId as number, projectId),
      hasPermission: async (context, permission) =>
        this.entryPolicy.hasPermission(
          user,
          context.organizationId as number,
          permission,
          context.requestedProjectId,
        ),
      getProjectLabel: async (context, projectId) => {
        const project = await Project.query()
          .where('id', projectId)
          .where('organization_id', context.organizationId as number)
          .whereNull('deleted_at')
          .first()
        return project?.name ?? null
      },
      getRecentSession: async (context, scope) => {
        const result = await copilotSessionService.listSessions({
          organizationId: context.organizationId as number,
          actorId: context.actorId,
          scope: scope.kind === 'project' ? 'project' : 'global',
          includeArchived: false,
          page: 1,
          perPage: 1,
          sortField: 'updatedAt',
          sortOrder: 'desc',
        })
        const session = result.data[0]
        if (!session) return null
        // 项目级 scope 只接受归属同一已授权项目的会话（不跨项目复用）。
        if (scope.kind === 'project') {
          const attributedProjectId = Number(
            (session.attribution as { projectId?: unknown } | null)?.projectId ?? Number.NaN,
          )
          if (attributedProjectId !== scope.projectId) return null
        }
        const projection: CopilotEntrySessionProjection = {
          sessionId: session.sessionId,
          title: session.title ?? null,
          scope: session.scope,
          updatedAt: session.updatedAt?.toISO() ?? session.createdAt?.toISO() ?? null,
          archived: Boolean(session.archived),
          status: session.status,
        }
        return projection
      },
      getToolSnapshot: async (context, scope): Promise<CopilotEntryToolSnapshotProjection> => {
        const snapshotService = new CopilotPluginToolSnapshotService(
          buildCopilotPluginToolSnapshotDeps(user, this.rbac),
        )
        const { snapshot } = await snapshotService.resolveSnapshot({
          organizationId: context.organizationId as number,
          actorId: copilotToolActorKey(context.actorId),
          ...(scope.kind === 'project' ? { projectId: scope.projectId as number } : {}),
        })
        // 只投影允许字段并绑定 revision；`exclusions` 绝不外发。
        return {
          revision: snapshot.digest,
          generatedAt: snapshot.generatedAt,
          entries: snapshot.entries.map((entry) => ({
            toolId: entry.toolId,
            name: entry.name,
            sideEffectClass: entry.sideEffectClass,
            pluginId: entry.pluginId,
            pluginVersion: entry.pluginVersion,
            toolDigest: entry.toolDigest,
          })),
        }
      },
      now: () => new Date().toISOString(),
    })

    const snapshot = await service.evaluate(entryContext)
    return response.ok({ data: snapshot })
  }

  private requireUser(ctx: HttpContext): User {
    const user = ctx.authUser ?? ctx.auth?.user
    if (!user) throw new PermissionDeniedException('缺少认证上下文')
    return user as User
  }
}
