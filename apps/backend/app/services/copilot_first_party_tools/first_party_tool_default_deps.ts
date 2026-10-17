// apps/backend — 官方四工具默认依赖工厂（v3-copilot-first-party-tool-pack）
//
// 将 FirstPartyToolAdapterDeps 绑定到既有宿主服务（全部只读路径）：
// - 项目查询/项目头：ProjectService.list / ProjectService.get（组织隔离 + 成员可见性）
// - 周报事实：tasks 只读聚合薄 facade + RiskService.list 计数
// - TRIZ 建议：TrizSkillLayerService.getSummary（RBAC resolveProjectPermissions 语义一致）
// - 风险解释：RiskService.list（组织+项目双隔离）
// - 周报渲染：report_v2 fakeAiDraft 纯函数（provider='fake'；绝不调用 generateAiDraft 落库）
//
// 零网络、零 provider、零正式表写入。

import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { REPORT_WARNING_CODES } from '@aiproj/types'

import type { FirstPartyToolAdapterDeps } from './first_party_tool_dispatcher.js'
import { userIdFromActorKey } from './first_party_tool_dispatcher.js'

/** 有界上限：单次项目查询最多取回的行数（与工具声明 limit 上限一致）。 */
const MAX_PROJECT_LIST_ROWS = 20

export async function buildDefaultFirstPartyToolDeps(): Promise<FirstPartyToolAdapterDeps> {
  const { default: ProjectService } = await import('#services/project_service')
  const { default: RiskService } = await import('#services/risk_service')
  const { default: RbacService } = await import('#services/rbac_service')
  const { default: ProjectPolicy } = await import('#policies/project_policy')
  const { default: TrizSkillLayerService } =
    await import('#services/triz_skill_layer/triz_skill_layer_service')
  const { isTrizSkillLayerEnabled } =
    await import('#services/triz_skill_layer/triz_skill_layer_feature_flag')
  const { default: User } = await import('#models/user')
  const { buildAiInput, fakeAiDraft } = await import('#services/report_v2/ai_draft_service')

  const projectService: InstanceType<typeof ProjectService> =
    await app.container.make(ProjectService)
  const riskService: InstanceType<typeof RiskService> = await app.container.make(RiskService)
  const rbac: InstanceType<typeof RbacService> = await app.container.make(RbacService)
  const projectPolicy: InstanceType<typeof ProjectPolicy> = await app.container.make(ProjectPolicy)
  const triz: InstanceType<typeof TrizSkillLayerService> =
    await app.container.make(TrizSkillLayerService)

  async function loadUser(userId: number): Promise<InstanceType<typeof User> | null> {
    return (await User.find(userId)) ?? null
  }

  return {
    listVisibleProjects: async ({ organizationId, userId, search, status, limit }) => {
      const user = await loadUser(userId)
      if (!user) return []
      const perPage = Math.min(MAX_PROJECT_LIST_ROWS, Math.max(1, limit))
      const res = await projectService.list(organizationId, user, {
        ...(search !== undefined ? { search } : {}),
        ...(status !== undefined ? { status } : {}),
        page: 1,
        perPage,
      })
      // 有界投影：只保留低敏摘要字段
      return res.data.map((p) => ({
        projectId: p.id,
        name: p.name,
        code: p.code ?? null,
        status: p.status,
        priority: p.priority ?? null,
      }))
    },

    getVisibleProjectHeader: async ({ organizationId, projectId, userId }) => {
      const user = await loadUser(userId)
      if (!user) return null
      // 成员可见性：复用既有 ProjectPolicy.view（与项目详情 HTTP 链一致）
      let visible = false
      try {
        visible = await projectPolicy.view(user, organizationId, projectId)
      } catch {
        visible = false
      }
      if (!visible) return null
      try {
        // get 内部做组织隔离与 404；成员可见性已由上方 Policy 校验
        const { project } = await projectService.get(organizationId, projectId)
        return { name: project.name, status: project.status }
      } catch {
        return null
      }
    },

    getWeeklyFacts: async ({ projectId, weekStartISODate: _weekStartISODate, weekEndISODate }) => {
      try {
        // 薄只读 facade：任务计数按项目范围聚合（调用前已通过 getVisibleProjectHeader 校验可见性）
        const rows = await db
          .from('tasks')
          .where('project_id', projectId)
          .whereNull('deleted_at')
          .select(
            db.raw(`count(*) as total`),
            db.raw(`sum(case when status = 'completed' then 1 else 0 end) as completed`),
            db.raw(
              `sum(case when status <> 'completed' and end_date is not null and end_date < ? then 1 else 0 end) as overdue`,
              [weekEndISODate],
            ),
          )
        const openRisk = await db
          .from('risks')
          .where('project_id', projectId)
          .whereNull('deleted_at')
          .whereNotIn('status', ['closed', 'cancelled'])
          .count('* as total')
        const totalTasks = Number(rows[0]?.total ?? 0)
        return {
          accessible: true,
          totalTasks,
          completedTasks: Number(rows[0]?.completed ?? 0),
          overdueTasks: Number(rows[0]?.overdue ?? 0),
          openRisks: Number(openRisk[0]?.total ?? 0),
        }
      } catch {
        // 数据源不可访问：只标注缺口，不抛错、不重试、不披露原因细节
        return {
          accessible: false,
          totalTasks: 0,
          completedTasks: 0,
          overdueTasks: 0,
          openRisks: 0,
        }
      }
    },

    getTrizAdvisory: async ({ organizationId, projectId, userId, problem }) => {
      const user = await loadUser(userId)
      if (!user) {
        return {
          activationState: '未激活（账号不可用）',
          availableDestinationCount: 0,
          guidance: '',
        }
      }
      if (!isTrizSkillLayerEnabled()) {
        // feature flag 关闭：合成引导降级（synthetic），零 Skill 执行、零写入
        return {
          activationState: '未激活（TRIZ 技能层功能关闭）',
          availableDestinationCount: 0,
          guidance: '',
        }
      }
      let permissions = new Set<string>()
      try {
        permissions = new Set(await rbac.resolveProjectPermissions(user, projectId))
      } catch {
        permissions = new Set()
      }
      const summary = await triz.getSummary(organizationId, projectId, user.id, permissions)
      const availableDestinations = summary.profiles
        .filter((p) => p.availability === 'available')
        .map((p) => p.destinationKey)
      const activated = summary.featureFlagEnabled && summary.activationSummary.hasActiveActivations
      return {
        activationState: activated
          ? `已激活（${availableDestinations.length} 个可用目的地）`
          : '未激活（无可用技能激活）',
        availableDestinationCount: availableDestinations.length,
        guidance:
          `问题「${problem.slice(0, 120)}」建议沿 TRIZ 流程推进：识别矛盾 → 选择发明原理 → 评估理想度。` +
          (activated ? `当前可路由目的地 ${availableDestinations.length} 个。` : ''),
      }
    },

    listExplainableRisks: async ({ organizationId, projectId, keyword, limit }) => {
      const res = await riskService.list(organizationId, projectId, {
        ...(keyword !== undefined ? { search: keyword } : {}),
        page: 1,
        perPage: Math.min(10, Math.max(1, limit)),
      })
      return res.data.map((r) => ({
        id: r.id,
        title: r.title,
        riskLevel: String(r.riskLevel ?? ''),
        score: Number(r.score ?? 0),
        status: r.status,
        category: r.category ?? null,
      }))
    },

    renderWeeklyDraft: ({
      projectName,
      fromDate,
      toDate,
      totalTasks,
      completedPercent,
      overdueTaskCount,
      warningMessages,
    }) => {
      const input = buildAiInput(
        'project-weekly',
        projectName,
        { fromDate, toDate },
        { totalTasks, completedPercent, overdueTaskCount },
        warningMessages.map((message, i) => ({
          level: 'warning' as const,
          code: REPORT_WARNING_CODES.DATASOURCE_EMPTY,
          message,
          context: { sourceRef: `note:${i}` },
        })),
      )
      // fakeAiDraft：确定性中文模板，provider='fake'，providerCalls=0
      return { draft: fakeAiDraft(input).draft }
    },

    now: () => DateTime.now().toISO()!,
  }
}

/** 便捷绑定：构建默认依赖并按会话上下文产出 executeTool 闭包。 */
export async function createFirstPartyToolExecuteTool(ctx: {
  organizationId: number
  actorId: string
  projectId?: number
}) {
  const { bindFirstPartyToolExecuteTool } = await import('./first_party_tool_dispatcher.js')
  userIdFromActorKey(ctx.actorId) // 提前 fail-closed 校验 actor key 形态
  return bindFirstPartyToolExecuteTool(await buildDefaultFirstPartyToolDeps(), ctx)
}
