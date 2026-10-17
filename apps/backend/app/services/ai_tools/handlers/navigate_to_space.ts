// v3-ai-tools-orchestration-layer W2 —— 工具 `navigate_to_space`
//
// 纯坐标计算（navigate 副作用，数据库零写入）：
// 1. 委托 ProjectService.get 校验项目存在性与组织归属（跨组织自动 404，RL-05）；
// 2. 依项目 ID / 镜头 / 深度 / 目标 ID 计算前端标准空间坐标与路由路径。
//
// 契约类型（ToolDefinition 等）取自 W1 的 `#services/ai_tools/registry`（design D4）。
import {
  AI_COMPILER_SKILL_VIEW,
  ORG_VIEW,
  PLUGIN_INSTALL_VIEW,
  PLUGIN_REGISTRY_VIEW,
  PORTFOLIO_VIEW,
  PROJECT_VIEW,
  RESOURCE_CAPACITY_LOOP_VIEW,
  RESOURCE_VIEW,
  RISK_VIEW,
  SYSTEM_ADMIN,
  type Permission,
} from '#rbac'
import OrganizationMember from '#models/organization_member'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import ProjectService from '#services/project_service'
import RbacService from '#services/rbac_service'
import app from '@adonisjs/core/services/app'
import { asPositiveInt, asOptionalString } from './input_guards.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const NAVIGATE_TO_SPACE_TOOL_NAME = 'navigate_to_space'

/**
 * 组织/全局视窗镜头白名单（v3-ui-next-org-portfolio-domains W10 · tasks 10.5，
 * 与前端 space-coordinates 17 条组织/全局坐标一一对应）：
 * 组织组合层（/next/organization/**）与全局资源/技能矩阵/问题风险入口
 * （/next/resources/**、/next/risks）——组织 ID 由 JWT 租户上下文决定，
 * URL 不含 organizationId，路径无 `:id` 段。容量环详情动态路由
 * [loopId] 不设镜头，统一落列表页。
 */
export const ORG_NAVIGATE_TO_SPACE_LENSES = [
  'org_overview',
  'org_bi_dashboards',
  'org_bi_risk_heatmap',
  'org_bi_trends',
  'org_okrs',
  'org_okr_dashboard',
  'org_resource_pool',
  'org_resource_gaps',
  'org_resource_contentions',
  'org_resource_demand',
  'org_capacity_loops',
  'org_cross_project_allocation',
  'org_plugin_directory',
  'org_plugin_policies',
  'global_resources',
  'global_skill_matrix',
  'global_risks',
] as const

export type OrgNavigateToSpaceLens = (typeof ORG_NAVIGATE_TO_SPACE_LENSES)[number]

/**
 * 组织镜头静态路径表（零占位全局绝对路径；容量环详情动态路由不设 lens → 列表页）。
 */
export const ORG_LENS_PATH_BY_LENS: Record<OrgNavigateToSpaceLens, string> = {
  org_overview: '/next/organization',
  org_bi_dashboards: '/next/organization/bi/dashboards',
  org_bi_risk_heatmap: '/next/organization/bi/risk-heatmap',
  org_bi_trends: '/next/organization/bi/trends',
  org_okrs: '/next/organization/okrs',
  org_okr_dashboard: '/next/organization/okrs/dashboard',
  org_resource_pool: '/next/organization/resource-pool',
  org_resource_gaps: '/next/organization/resource-gaps',
  org_resource_contentions: '/next/organization/resource-contentions',
  org_resource_demand: '/next/organization/resource-demand-forecasting',
  org_capacity_loops: '/next/organization/resource-capacity-loops',
  org_cross_project_allocation: '/next/organization/cross-project-resource-allocation',
  org_plugin_directory: '/next/organization/plugin-directory',
  org_plugin_policies: '/next/organization/plugin-policies',
  global_resources: '/next/resources',
  global_skill_matrix: '/next/resources/skill-matrix',
  global_risks: '/next/risks',
}

/** 查静态路径表；非组织镜头返回 undefined（沿用既有项目镜头路径拼装）。 */
export function orgLensPath(lens: string): string | undefined {
  return (ORG_LENS_PATH_BY_LENS as Record<string, string>)[lens]
}

/**
 * 组织镜头准入权限集（任一集合即可，与 design RBAC 矩阵/页守卫口径一致；
 * 页面级 policy 列级明细门并集——skill_matrix 含 ai:compiler:skill:view）。
 */
export const ORG_LENS_PERMISSION_SETS: Record<OrgNavigateToSpaceLens, readonly Permission[]> = {
  org_overview: [ORG_VIEW, PORTFOLIO_VIEW],
  org_bi_dashboards: [ORG_VIEW, PORTFOLIO_VIEW],
  org_bi_risk_heatmap: [ORG_VIEW, PORTFOLIO_VIEW],
  org_bi_trends: [ORG_VIEW, PORTFOLIO_VIEW],
  org_okrs: [ORG_VIEW, PORTFOLIO_VIEW],
  org_okr_dashboard: [ORG_VIEW, PORTFOLIO_VIEW],
  org_resource_pool: [RESOURCE_VIEW, PORTFOLIO_VIEW],
  org_resource_gaps: [RESOURCE_VIEW, PORTFOLIO_VIEW],
  org_resource_contentions: [ORG_VIEW, RESOURCE_VIEW, PORTFOLIO_VIEW],
  org_resource_demand: [RESOURCE_VIEW, PORTFOLIO_VIEW],
  org_capacity_loops: [RESOURCE_CAPACITY_LOOP_VIEW],
  org_cross_project_allocation: [RESOURCE_VIEW, PORTFOLIO_VIEW],
  org_plugin_directory: [PLUGIN_REGISTRY_VIEW],
  org_plugin_policies: [PLUGIN_INSTALL_VIEW],
  global_resources: [RESOURCE_VIEW, PORTFOLIO_VIEW],
  global_skill_matrix: [RESOURCE_VIEW, PORTFOLIO_VIEW, AI_COMPILER_SKILL_VIEW],
  global_risks: [ORG_VIEW, RISK_VIEW],
}

/** 任一权限满足即放行（系统管理员经 RbacService 哨兵直通）；全不满足抛 403。 */
async function assertOrgLensAllowed(
  ctx: ToolExecutionContext,
  lens: OrgNavigateToSpaceLens,
  rbac: RbacService,
): Promise<void> {
  for (const permission of ORG_LENS_PERMISSION_SETS[lens]) {
    const result = await rbac.check(ctx.user, permission, ctx.organizationId)
    if (result.allowed) return
  }
  throw new PermissionDeniedException('缺少导航至该组织/全局空间所需权限')
}

/**
 * PMO 组合层目标页白名单（v3-ui-next-pmo-domain W9 · tasks 9.5，与前端
 * space-coordinates 8 条 PMO 坐标及 ai-colleague rule_nav_pmo_* 规则一一对应）：
 * lens='pmo' + target 定位组合仪表盘（/next/pmo）与 7 个功能页（红绿灯报告/分组
 * 视图/优先级评分/AI 优先级推荐/决策工作台/跨项目依赖/影响分析）——PMO 为组织层
 * 组合视角（Decision 2），与 org_* 及 global_* 镜头同族全域导航：URL 不含
 * organizationId 与项目 ID 段，组织 ID 由 JWT 租户上下文决定；决策详情动态路由
 * [decisionId] 不设 target，统一落决策队列列表页（列表行内下钻详情）。
 */
export const PMO_NAVIGATE_TO_SPACE_TARGETS = [
  'pmo-overview',
  'pmo-traffic-light',
  'pmo-grouping-views',
  'pmo-priority-scoring',
  'pmo-ai-priority-recommendations',
  'pmo-decisions',
  'pmo-dependencies',
  'pmo-impact-analysis',
] as const

export type PmoNavigateToSpaceTarget = (typeof PMO_NAVIGATE_TO_SPACE_TARGETS)[number]

/** PMO 目标页静态路径表（零占位全局绝对路径；决策详情动态路由不设 target → 列表页）。 */
export const PMO_TARGET_PATH_BY_TARGET: Record<PmoNavigateToSpaceTarget, string> = {
  'pmo-overview': '/next/pmo',
  'pmo-traffic-light': '/next/pmo/traffic-light',
  'pmo-grouping-views': '/next/pmo/grouping-views',
  'pmo-priority-scoring': '/next/pmo/priority-scoring',
  'pmo-ai-priority-recommendations': '/next/pmo/ai-priority-recommendations',
  'pmo-decisions': '/next/pmo/decisions',
  'pmo-dependencies': '/next/pmo/dependencies',
  'pmo-impact-analysis': '/next/pmo/impact-analysis',
}

/**
 * 查静态路径表：lens='pmo' 且 target 合法（或省略）时返回新轨全局绝对路径；
 * 省略 target 落组合仪表盘 /next/pmo；未知 target 返回 undefined（由 handler
 * 以 422 拒绝，schema enum 在编排层已先行约束）。
 */
export function pmoTargetPath(target: string | undefined): string | undefined {
  if (target === undefined) return '/next/pmo'
  return (PMO_TARGET_PATH_BY_TARGET as Record<string, string>)[target]
}

/**
 * PMO 目标页准入权限集（design Decision 8：组织镜头 requiredPermissions 取
 * portfolio:view——页面级 policy 在目标页各自终裁，导航仅做坐标计算不代行页权）。
 */
export const PMO_TARGET_PERMISSION_SETS: Record<PmoNavigateToSpaceTarget, readonly Permission[]> = {
  'pmo-overview': [PORTFOLIO_VIEW],
  'pmo-traffic-light': [PORTFOLIO_VIEW],
  'pmo-grouping-views': [PORTFOLIO_VIEW],
  'pmo-priority-scoring': [PORTFOLIO_VIEW],
  'pmo-ai-priority-recommendations': [PORTFOLIO_VIEW],
  'pmo-decisions': [PORTFOLIO_VIEW],
  'pmo-dependencies': [PORTFOLIO_VIEW],
  'pmo-impact-analysis': [PORTFOLIO_VIEW],
}

/** 任一权限满足即放行（系统管理员哨兵直通）；全不满足抛 403（零路径产出）。 */
async function assertPmoTargetAllowed(
  ctx: ToolExecutionContext,
  target: PmoNavigateToSpaceTarget,
  rbac: RbacService,
): Promise<void> {
  for (const permission of PMO_TARGET_PERMISSION_SETS[target]) {
    const result = await rbac.check(ctx.user, permission, ctx.organizationId)
    if (result.allowed) return
  }
  throw new PermissionDeniedException('缺少导航至 PMO 组合层所需权限')
}

/**
 * 设置空间目标页白名单（v3-ui-next-settings-admin-domains W9 · tasks 9.8，
 * 与前端 15 节设置空间路由对应）：
 * lens='settings' + targetId/target 定位设置门户（/next/settings）与 13 个设置细页。
 * 未注册目标回落门户路径（/next/settings），绝不拼装假路径（RL-14）。
 */
export const NAVIGATE_TO_SPACE_SETTINGS_TARGETS = [
  'profile',
  'organization',
  'ai-connections',
  'ai-usage',
  'compiler-skills',
  'integrations',
  'audit-logs',
  'multitenancy',
  'security/compliance',
  'security/dlp',
  'security/kms',
  'security/sso',
  'security/two-factor',
] as const

export type NavigateToSpaceSettingsTarget = (typeof NAVIGATE_TO_SPACE_SETTINGS_TARGETS)[number]

/**
 * 管理后台目标页白名单（v3-ui-next-settings-admin-domains W9 · tasks 9.8，
 * 与前端 6 控制台管理后台路由对应）：
 * lens='admin' + targetId/target 定位管理后台门户（/next/admin）与 6 控制台细页。
 * 未注册目标回落门户路径（/next/admin），绝不拼装假路径（RL-14）。
 */
export const NAVIGATE_TO_SPACE_ADMIN_TARGETS = [
  'users',
  'audit-logs',
  'multitenancy',
  'ai-quality-cost',
  'compiler-routing',
  'release-trust',
] as const

export type NavigateToSpaceAdminTarget = (typeof NAVIGATE_TO_SPACE_ADMIN_TARGETS)[number]

/** 校验设置空间准入：登录态 + 当前组织在籍（RL-05/D-BE）。超级管理员直通。 */
async function assertSettingsAllowed(ctx: ToolExecutionContext): Promise<void> {
  if (!ctx.user) {
    throw new PermissionDeniedException('缺少导航至设置空间所需权限')
  }
  if (ctx.user.isSuperAdmin) return
  if (!ctx.organizationId) {
    throw new PermissionDeniedException('缺少导航至设置空间所需权限')
  }
  const belongs = await OrganizationMember.belongsToOrganization(ctx.organizationId, ctx.user.id)
  if (!belongs) {
    throw new PermissionDeniedException('缺少导航至设置空间所需权限')
  }
}

/** 校验管理后台准入：system:admin（RL-05/D-BE）。无权限返回既有拒绝语义。 */
async function assertAdminAllowed(ctx: ToolExecutionContext, rbac: RbacService): Promise<void> {
  if (!ctx.user) {
    throw new PermissionDeniedException('缺少导航至管理后台所需权限')
  }
  const result = await rbac.check(ctx.user, SYSTEM_ADMIN, ctx.organizationId)
  if (!result.allowed) {
    throw new PermissionDeniedException('缺少导航至管理后台所需权限')
  }
}

/**
 * 前端镜头白名单。原与 v3-ui-next-project-space LensSwitcher 的 ProjectSpaceLensId
 * 对齐；v3-ui-next-chart-gallery 起扩充 `'charts'`（图表馆空间，独立深层路由
 * `/next/projects/:id/charts[/:chartId]`，不属于主工作面 LensSwitcher）；
 * v3-ui-next-reports-domain 扩充 `'reports'`（项目报表中心空间，独立深层路由
 * `/next/projects/:id/reports`，支持 tab/template 查询参数直达周期报表预填视图）；
 * v3-ui-next-risk-change-domains 扩充 `'risks'` 与 `'change_requests'`（风险管理 /
 * 变更请求治理功能域空间，新轨深层路由 `/next/projects/:id/risks` 与
 * `/next/projects/:id/change-requests`，同样不属于 LensSwitcher）；
 * v3-ui-next-resource-team-domains 扩充 `'resources' | 'members' | 'files'`
 * （资源工作台 / 成员团队 / 项目文件库协同管理功能域空间，新轨深层路由
 * `/next/projects/:id/resources|members|files`，与 LensSwitcher 六镜头正交）；
 * v3-ui-next-help-knowledge-domain 扩充 `'help' | 'knowledge'`（帮助中心 / 知识底座
 * 全局视窗，新轨路由 `/next/help` 与 `/next/knowledge`——不属任何项目空间，
 * 路径无 `:id` 段，handler 对两镜头跳过项目存在性/组织归属校验）；
 * v3-ui-next-org-portfolio-domains 扩充 `'org_*' | 'global_*'` 组织/全局视窗镜头
 * （17 项见 ORG_NAVIGATE_TO_SPACE_LENSES，新轨路由 `/next/organization/**`、
 * `/next/resources/**`、`/next/risks`——同样无 `:id` 段，handler 对组织镜头跳过
 * 项目存在性/组织归属校验，改按逐镜头权限集合在 ctx 组织上下文内判定）；
 * v3-ui-next-pmo-domain 扩充 `'pmo'`（PMO 组合层，新轨路由 `/next/pmo[/target]`，
 * target 白名单见 PMO_NAVIGATE_TO_SPACE_TARGETS——组织级全域镜头同 org_* 与
 * global_*：跳过项目校验、忽略附带 projectId，按 target 权限集合在 ctx 组织上下文
 * 内判定）；
 * v3-ui-next-settings-admin-domains 扩充 `'settings' | 'admin' | 'project_settings'`
 * （设置空间全局视窗 /next/settings[/target]、管理后台全局视窗 /next/admin[/target]、
 * 项目设置深层路由 /next/projects/:id/settings）。
 */
export const NAVIGATE_TO_SPACE_LENSES = [
  'kanban',
  'gantt',
  'wbs',
  'list',
  'calendar',
  'charts',
  'reports',
  'risks',
  'change_requests',
  'resources',
  'members',
  'files',
  'help',
  'knowledge',
  'pmo',
  'settings',
  'admin',
  'project_settings',
  ...ORG_NAVIGATE_TO_SPACE_LENSES,
] as const

export type NavigateToSpaceLens = (typeof NAVIGATE_TO_SPACE_LENSES)[number]

/** 图表馆具体图表标识白名单（第一层 8 项；kanban 由图表馆页重定向至看板工作面）。 */
export const NAVIGATE_TO_SPACE_CHART_IDS = [
  'resource-load',
  'risk-register',
  'aon-network',
  'milestone-timeline',
  'fishbone',
  'rbs',
  'scatter-plot',
  'kanban',
] as const

export type NavigateToSpaceChartId = (typeof NAVIGATE_TO_SPACE_CHART_IDS)[number]

/** 报表中心初始模式白名单（与前端 ?tab= 深链契约对齐）。 */
export const NAVIGATE_TO_SPACE_REPORT_TABS = ['preset', 'periodic', 'versions'] as const

/** 周期报表模板白名单（前端 rule_nav_periodic_weekly/monthly 预填参数）。 */
export const NAVIGATE_TO_SPACE_REPORT_TEMPLATES = [
  'weekly-ai-summary',
  'monthly-ai-summary',
] as const

/**
 * 报表中心规范路径：`/next/projects/:id/reports`；
 * 携带 tab（preset/periodic/versions）与 template（周报/月报模板）时拼装查询串，
 * 直达对应模式与预填模板（tab/template 均受 enum 约束，handler 侧再防御校验）。
 */
export function buildReportsSpacePath(
  projectId: number,
  tab: string | undefined,
  template: string | undefined,
): string {
  const base = `/next/projects/${projectId}/reports`
  const params: string[] = []
  if (tab !== undefined && (NAVIGATE_TO_SPACE_REPORT_TABS as readonly string[]).includes(tab)) {
    params.push(`tab=${encodeURIComponent(tab)}`)
  }
  if (
    template !== undefined &&
    (NAVIGATE_TO_SPACE_REPORT_TEMPLATES as readonly string[]).includes(template)
  ) {
    params.push(`template=${encodeURIComponent(template)}`)
  }
  return params.length > 0 ? `${base}?${params.join('&')}` : base
}

export interface NavigateToSpaceParams {
  /** 目标项目 ID（仅项目镜头必需；help/knowledge、pmo、settings/admin 与组织镜头可省略且不参与校验）。 */
  projectId?: number
  lens: string
  depth?: string
  targetId?: number | string
  /** 仅 lens='charts' 时生效：具体图表标识（如 fishbone），省略则直达图表馆目录。 */
  chart?: string
  /** 仅 lens='reports' 时生效：报表中心初始模式（preset/periodic/versions）。 */
  tab?: string
  /** 仅 lens='reports' 时生效：周期报表模板标识（如 weekly-ai-summary），与 tab 组合成深链。 */
  template?: string
  /**
   * 镜头域显式声明（v3-ui-next-pmo-domain W9 · tasks 9.5）：project（缺省）为项目镜头；
   * organization 为组织/全局镜头（help/knowledge、pmo、settings/admin 与 org_* 及 global_*，忽略 projectId）。
   * 解析以镜头本身为准——lens 属全域镜头时无论 scope 取值均按全域处理。
   */
  scope?: 'project' | 'organization'
  /** 仅 lens='pmo' / lens='settings' / lens='admin' 时生效：PMO、设置或管理后台目标页标识。 */
  target?: string
}

export interface NavigateToSpaceResult {
  /** 项目 ID；help/knowledge、pmo 与组织镜头等全域镜头无项目载体，恒为 null。 */
  projectId: number | null
  lens: string
  depth: string
  targetId: number | null
  path: string
}

export interface NavigateToSpaceDeps {
  projectService: ProjectService
  rbacService?: RbacService
}

let projectServicePromise: Promise<ProjectService> | null = null
function resolveProjectService(): Promise<ProjectService> {
  projectServicePromise ??= app.container.make(ProjectService)
  return projectServicePromise
}

let rbacServicePromise: Promise<RbacService> | null = null
function resolveRbacService(): Promise<RbacService> {
  rbacServicePromise ??= app.container.make(RbacService)
  return rbacServicePromise
}

export function createNavigateToSpaceTool(
  deps?: NavigateToSpaceDeps,
): ToolDefinition<NavigateToSpaceParams, NavigateToSpaceResult> {
  return {
    name: NAVIGATE_TO_SPACE_TOOL_NAME,
    description:
      '将用户导航到指定项目的目标镜头空间（看板/甘特图/WBS/列表/日历/图表馆/报表中心/风险管理/变更请求/资源工作台/成员团队/项目文件库/项目设置），或直达帮助中心（/next/help）与知识底座（/next/knowledge）全局视窗，或设置空间（/next/settings）与管理后台（/next/admin），或组织组合层/全局视窗（/next/organization/** 组织概览/BI 仪表盘/风险热力图/趋势分析/OKR 层级与仪表盘/资源池/缺口分析/争用检测/需求预测/容量闭环/跨项目调配/插件目录/插件策略，/next/resources 与 /next/resources/skill-matrix 全局资源/技能矩阵，/next/risks 问题与风险入口），或 PMO 组合层（/next/pmo 组合仪表盘与 /next/pmo/{traffic-light,grouping-views,priority-scoring,ai-priority-recommendations,decisions,dependencies,impact-analysis} 功能页，经 lens=pmo + target 定位），返回标准空间坐标（镜头、深度、目标 ID）与前端路由路径。图表馆支持 chart 参数直达具体图表镜头；报表中心支持 tab/template 参数直达周期报表预填视图。帮助中心/知识底座与组织/PMO/设置/管理后台镜头为全域导航：无需项目上下文，组织与 PMO 镜头按组织上下文逐镜头/逐目标权限判定（任一集合权限即放行）；设置空间要求组织在籍；管理后台要求 system:admin。只计算坐标，不修改任何数据。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'integer',
          minimum: 1,
          description:
            '目标项目 ID（projectId 仅项目级镜头必填，全域镜头（help/knowledge/org_*/pmo/settings/admin）省略）',
        },
        lens: {
          type: 'string',
          enum: [...NAVIGATE_TO_SPACE_LENSES],
          description:
            '目标镜头（kanban/gantt/wbs/list/calendar/charts/reports/risks/change_requests/resources/members/files/help/knowledge/pmo/settings/admin/project_settings/org_*；help/knowledge、pmo、settings/admin 与 org_*/global_* 为无项目载体全域视窗）',
        },
        depth: { type: 'string', enum: ['workbench'], default: 'workbench' },
        targetId: {
          description: '镜头内目标实体 ID（如任务 ID）或设置/管理后台目标页标识',
        },
        scope: {
          type: 'string',
          enum: ['project', 'organization'],
          description:
            '镜头域显式声明（v3-ui-next-pmo-domain W9）：project 为项目镜头；organization 为组织/全局镜头（help/knowledge/pmo/settings/admin 与 org_*/global_*，忽略 projectId）。解析以镜头本身为准——lens 属于全域镜头时无论 scope 取值均按全域处理',
        },
        target: {
          type: 'string',
          enum: [
            ...PMO_NAVIGATE_TO_SPACE_TARGETS,
            ...NAVIGATE_TO_SPACE_SETTINGS_TARGETS,
            ...NAVIGATE_TO_SPACE_ADMIN_TARGETS,
          ],
          description: 'PMO、设置或管理后台目标页标识（省略或未注册则回落门户路径）',
        },
        chart: {
          type: 'string',
          enum: [...NAVIGATE_TO_SPACE_CHART_IDS],
          description:
            'lens=charts 时的具体图表标识（resource-load/risk-register/aon-network/milestone-timeline/fishbone/rbs/scatter-plot/kanban）',
        },
        tab: {
          type: 'string',
          enum: ['preset', 'periodic', 'versions'],
          description: 'lens=reports 时的报表中心初始模式（预设/周期/版本审阅）',
        },
        template: {
          type: 'string',
          enum: ['weekly-ai-summary', 'monthly-ai-summary'],
          description: 'lens=reports 时的周期报表模板（周报/月报），与 tab=periodic 组合预填',
        },
      },
      // required 契约：已在 pmo 批次收口；schema required 仅锁定 ['lens']；
      // projectId 仅项目级镜头必填，全域镜头（help/knowledge/org_*/pmo）省略；
      // 项目镜头缺 projectId 由 handler 维持 422。
      required: ['lens'],
      additionalProperties: false,
    },
    requiredPermissions: [PROJECT_VIEW],
    sideEffect: 'navigate',
    handler: async (
      ctx: ToolExecutionContext,
      input: NavigateToSpaceParams,
    ): Promise<ToolExecutionResult<NavigateToSpaceResult>> => {
      const lens = asOptionalString(input.lens, 'lens') ?? 'kanban'
      const depth = asOptionalString(input.depth, 'depth') ?? 'workbench'
      let targetId: number | null = null
      let targetStr: string | undefined = asOptionalString(input.target, 'target')
      if (lens === 'settings' || lens === 'admin') {
        if (typeof input.targetId === 'string' && !targetStr) {
          targetStr = asOptionalString(input.targetId, 'targetId')
        }
      } else if (input.targetId !== undefined && input.targetId !== null) {
        targetId = asPositiveInt(input.targetId, 'targetId')
      }
      const chart = input.chart === undefined ? null : asOptionalString(input.chart, 'chart')
      const orgLens = orgLensPath(lens)
      // PMO 组合层目标页静态路径：lens='pmo' 时省略 target 落组合仪表盘；
      // 未知 target 显式 422 拒绝（schema enum 已在编排层先行约束，此处为
      // 直接调用 handler 的防御分支，绝不回退旧轨 /projects/null/pmo 假路径）。
      let pmoPath: string | undefined
      if (lens === 'pmo') {
        pmoPath = pmoTargetPath(input.target)
        if (pmoPath === undefined) {
          throw new ValidationException('PMO 目标页无效')
        }
      }
      const isGlobalLens =
        lens === 'help' ||
        lens === 'knowledge' ||
        lens === 'settings' ||
        lens === 'admin' ||
        pmoPath !== undefined ||
        orgLens !== undefined

      // 全域镜头（帮助中心/知识底座、PMO 组合层、设置空间/管理后台与组织/全局视窗，路径无 :id 项目段）：
      // 不要求 projectId、跳过项目存在性与组织归属校验（即便调用方附带 projectId
      // 也忽略，全域导航不因项目不可见而受阻）；PMO 与组织镜头按权限判定；
      // 设置空间镜头要求登录态 + 当前组织在籍；管理后台要求 system:admin；
      // 其余项目镜头维持既有校验（跨组织/不存在统一 404，绝不泄露存在性，RL-05）。
      const projectId = isGlobalLens ? null : asPositiveInt(input.projectId, 'projectId')
      if (projectId !== null) {
        const projectService = deps?.projectService ?? (await resolveProjectService())
        await projectService.get(ctx.organizationId, projectId)
      }
      if (pmoPath !== undefined) {
        const rbacService = deps?.rbacService ?? (await resolveRbacService())
        const pmoTarget: PmoNavigateToSpaceTarget =
          input.target === undefined ? 'pmo-overview' : (input.target as PmoNavigateToSpaceTarget)
        await assertPmoTargetAllowed(ctx, pmoTarget, rbacService)
      }
      if (orgLens !== undefined) {
        const rbacService = deps?.rbacService ?? (await resolveRbacService())
        await assertOrgLensAllowed(ctx, lens as OrgNavigateToSpaceLens, rbacService)
      }
      if (lens === 'settings') {
        await assertSettingsAllowed(ctx)
      }
      if (lens === 'admin') {
        const rbacService = deps?.rbacService ?? (await resolveRbacService())
        await assertAdminAllowed(ctx, rbacService)
      }

      let settingsPath = '/next/settings'
      if (
        targetStr &&
        (NAVIGATE_TO_SPACE_SETTINGS_TARGETS as readonly string[]).includes(targetStr)
      ) {
        settingsPath = `/next/settings/${targetStr}`
      }

      let adminPath = '/next/admin'
      if (targetStr && (NAVIGATE_TO_SPACE_ADMIN_TARGETS as readonly string[]).includes(targetStr)) {
        adminPath = `/next/admin/${targetStr}`
      }

      const path =
        pmoPath !== undefined
          ? pmoPath
          : orgLens !== undefined
            ? orgLens
            : lens === 'help'
              ? '/next/help'
              : lens === 'knowledge'
                ? '/next/knowledge'
                : lens === 'settings'
                  ? settingsPath
                  : lens === 'admin'
                    ? adminPath
                    : lens === 'project_settings'
                      ? `/next/projects/${projectId}/settings`
                      : lens === 'charts'
                        ? `/next/projects/${projectId}/charts${chart ? `/${chart}` : ''}`
                        : lens === 'reports'
                          ? buildReportsSpacePath(projectId!, input.tab, input.template)
                          : lens === 'risks'
                            ? `/next/projects/${projectId}/risks`
                            : lens === 'change_requests'
                              ? `/next/projects/${projectId}/change-requests`
                              : lens === 'resources' || lens === 'members' || lens === 'files'
                                ? `/next/projects/${projectId}/${lens}`
                                : `/projects/${projectId}/${lens}${targetId ? `/${targetId}` : ''}`

      return {
        status: 'SUCCESS',
        data: { projectId, lens, depth, targetId, path },
      }
    },
  }
}
