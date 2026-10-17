/**
 * 看板「在此列新建任务」的 AI 补全端点（2026-09-28）。
 *
 * `POST /api/v1/projects/:projectId/tasks/ai-draft`：一句话 → 模型补成任务卡草稿（含拆分建议）。
 * 只返回草稿、不落库；创建仍走 `POST /projects/:projectId/tasks`（用户确认后）。
 * 权限同建任务（task:create，路由级 RBAC 注册）；模型输出经实时面板旁路逐字显示。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import Project from '#models/project'
import type User from '#models/user'
import TaskService from '#services/task_service'
import { resolveAdapter } from '#services/ai_m0/resolver'
import {
  isLiveOutputId,
  liveOutputHub,
  liveOutputOwner,
  streamCallToLiveOutput,
} from '#services/ai_live_output/live_output_hub'
import { draftTaskWithAi } from '#services/ai_planning/task_ai_draft_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'

@inject()
export default class TaskAiDraftsController {
  constructor(private readonly tasks: TaskService) {}

  async store(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const body = ctx.request.body() as {
      description?: unknown
      connectionId?: number
      modelId?: number
      liveOutputId?: string
      /** 互动调整：用户对上一版草稿的修改意见。 */
      instruction?: unknown
      /** 互动调整：上一版草稿。 */
      previous?: unknown
    }
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (description.length < 2 || description.length > 1_000) {
      throw new ValidationException('请用 2–1000 字描述要做的事')
    }

    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
    if (instruction.length > 500) throw new ValidationException('修改意见请控制在 500 字以内')
    const previous =
      instruction && body.previous && typeof body.previous === 'object' ? body.previous : null

    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')

    const [workPackages, roleHints, taskRows] = await Promise.all([
      db
        .from('wbs_nodes')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .whereNull('task_id')
        .orderBy('path', 'asc')
        .limit(120)
        .select('id', 'code', 'name') as Promise<
        Array<{ id: number | string; code: string | null; name: string }>
      >,
      this.tasks.roleHints(organizationId, projectId),
      db
        .from('tasks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .orderBy('id', 'desc')
        .limit(60)
        .select('name') as Promise<Array<{ name: string }>>,
    ])

    const liveId =
      isLiveOutputId(body.liveOutputId) &&
      liveOutputHub.claim(body.liveOutputId, liveOutputOwner(organizationId, user.id))
        ? body.liveOutputId
        : null
    try {
      const resolved = await resolveAdapter({
        connectionId: body.connectionId,
        modelId: body.modelId,
        organizationId,
        requiredCapabilities: ['chat'],
        recordContext: {
          organizationId,
          userId: user.id,
          connectionId: body.connectionId ?? null,
          modelId: body.modelId ?? null,
          capability: 'chat',
          surface: 'task-ai-draft',
          workflowName: 'task-ai-draft',
        },
      })
      const draft = await streamCallToLiveOutput(
        liveId,
        '补全任务卡',
        '1',
        (onText, onReasoning) =>
          draftTaskWithAi({
            gateway: resolved.gateway,
            now: new Date(),
            onText,
            onReasoning,
            refine: previous ? { previous, instruction } : null,
            context: {
              description,
              projectName: project.name,
              projectStart: project.startDate?.toISODate?.() ?? null,
              projectEnd: project.endDate?.toISODate?.() ?? null,
              workPackages: workPackages.map((row) => ({
                id: Number(row.id),
                code: row.code,
                name: row.name,
              })),
              roles: roleHints.map((item) => item.role),
              existingTaskNames: taskRows.map((row) => row.name),
            },
          }),
        resolved.model,
      )
      const wbsNode = workPackages.find((row) => Number(row.id) === draft.wbsNodeId)
      return ctx.response.ok({
        data: {
          ...draft,
          wbsNodeName: wbsNode ? `${wbsNode.code ? `${wbsNode.code} ` : ''}${wbsNode.name}` : null,
        },
      })
    } catch (error) {
      ctx.logger.warn({ err: error }, '任务卡 AI 补全失败')
      return ctx.response.status(502).send({
        error: {
          code: 'AI_SERVICE_ERROR',
          message: 'AI 这次没能补全任务卡，请稍后再试，或直接手动填写。',
        },
      })
    } finally {
      if (liveId) liveOutputHub.close(liveId)
    }
  }
}
