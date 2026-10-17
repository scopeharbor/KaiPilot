/**
 * 路由权限规则表（中央维护）。
 *
 * rbac_middleware 优先按 routeName 匹配，未命中再按 routePattern 匹配。
 * 未在表中注册的路由默认放行已认证用户（默认拒绝仅作用于已登记路由）。
 */

import {
  AI_COMPILER_READ,
  AI_COMPILER_RUN,
  AI_CONFIRM,
  AI_RESOURCE_GAP_EXPLAIN,
  AI_TRIGGER,
  AUDIT_VIEW,
  CHANGE_REQUEST_APPROVE,
  CHANGE_REQUEST_CREATE,
  CHANGE_IMPACT_MANAGE,
  CHANGE_IMPACT_VIEW,
  CHARTER_APPROVE,
  CODEGEN_CANDIDATE_RUN_RUN,
  CODEGEN_CANDIDATE_RUN_VIEW,
  CONTRADICTION_MANAGE,
  CONTRADICTION_VIEW,
  DIAGRAM_MANAGE,
  DIAGRAM_VIEW,
  FILE_MANAGE,
  FILE_VIEW,
  GANTT_EDIT,
  GANTT_VIEW,
  INTEGRATION_CONNECT,
  MILESTONE_CREATE,
  MILESTONE_VIEW,
  MULTI_PROJECT_IMPACT_MANAGE,
  MULTI_PROJECT_IMPACT_VIEW,
  OCR_PERMISSION_AUDIT_AUDIT_READ,
  OCR_PERMISSION_AUDIT_VIEW_STATUS,
  ORG_MANAGE,
  ORG_MEMBER_MANAGE,
  ORG_VIEW,
  PMO_DECISION_DECIDE,
  PMO_DECISION_HANDOFF,
  PMO_DECISION_MANAGE,
  PMO_DECISION_REQUEST_AI,
  PMO_DECISION_VIEW,
  PORTFOLIO_VIEW,
  PROJECT_CREATE,
  PROJECT_DELETE,
  PROJECT_MEMBER_MANAGE,
  PROJECT_UPDATE,
  PROJECT_VIEW,
  REPORT_CREATE,
  REPORT_MANAGE,
  REPORT_VIEW,
  REPORT_EXPORT,
  REPORT_DOWNLOAD,
  RESOURCE_CAPACITY_LOOP_MANAGE,
  RESOURCE_CAPACITY_LOOP_VIEW,
  RESOURCE_MANAGE,
  RESOURCE_VIEW,
  RISK_MANAGE,
  RISK_VIEW,
  SYSTEM_ADMIN,
  TASK_CREATE,
  TASK_DELETE,
  TASK_UPDATE,
  TASK_VIEW,
  TRIZ_DELIVERY_LOOP_LINK,
  TRIZ_DELIVERY_LOOP_REOPEN,
  TRIZ_DELIVERY_LOOP_REQUEST_AI,
  TRIZ_DELIVERY_LOOP_VERIFY,
  TRIZ_DELIVERY_LOOP_VIEW,
  WBS_CREATE,
  WBS_DELETE,
  WBS_MOVE,
  PREDICTION_VIEW,
  type Permission,
} from './permissions.js'

export interface RoutePermissionRule {
  method: string
  routeName?: string
  routePattern?: string
  permission: Permission
}

export const ROUTE_PERMISSION_RULES: RoutePermissionRule[] = [
  {
    method: 'POST',
    routeName: 'organizations.members.createAccount',
    permission: ORG_MEMBER_MANAGE,
  },
  // 项目
  {
    method: 'POST',
    routeName: 'projects.store',
    routePattern: '/api/v1/projects',
    permission: PROJECT_CREATE,
  },
  {
    method: 'POST',
    routeName: 'organizations.projects.store',
    routePattern: '/api/v1/organizations/:organizationId/projects',
    permission: PROJECT_CREATE,
  },
  {
    method: 'GET',
    routeName: 'projects.index',
    routePattern: '/api/v1/projects',
    permission: PROJECT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.projects.index',
    routePattern: '/api/v1/organizations/:organizationId/projects',
    permission: PROJECT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.show',
    routePattern: '/api/v1/projects/:id',
    permission: PROJECT_VIEW,
  },
  {
    method: 'PATCH',
    routeName: 'projects.update',
    routePattern: '/api/v1/projects/:id',
    permission: PROJECT_UPDATE,
  },
  {
    method: 'GET',
    routeName: 'projects.working-calendar.show',
    routePattern: '/api/v1/projects/:id/working-calendar',
    permission: PROJECT_VIEW,
  },
  {
    method: 'PATCH',
    routeName: 'projects.working-calendar.update',
    routePattern: '/api/v1/projects/:id/working-calendar',
    permission: PROJECT_UPDATE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.destroy',
    routePattern: '/api/v1/projects/:id',
    permission: PROJECT_DELETE,
  },
  {
    method: 'POST',
    routeName: 'projects.members.store',
    routePattern: '/api/v1/projects/:id/members',
    permission: PROJECT_MEMBER_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'projects.members.invite',
    routePattern: '/api/v1/projects/:id/members/invite',
    permission: PROJECT_MEMBER_MANAGE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.members.destroy',
    routePattern: '/api/v1/projects/:id/members/:userId',
    permission: PROJECT_MEMBER_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'projects.members.index',
    routePattern: '/api/v1/projects/:id/members',
    permission: PROJECT_VIEW,
  },
  {
    method: 'PATCH',
    routeName: 'projects.members.update',
    routePattern: '/api/v1/projects/:id/members/:userId',
    permission: PROJECT_MEMBER_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'projects.my-permissions',
    routePattern: '/api/v1/projects/:id/my-permissions',
    permission: PROJECT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.roles.index',
    routePattern: '/api/v1/projects/:id/roles',
    permission: PROJECT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.transfer',
    routePattern: '/api/v1/projects/:id/transfer-owner',
    permission: PROJECT_MEMBER_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'projects.archive',
    routePattern: '/api/v1/projects/:id/archive',
    permission: PROJECT_UPDATE,
  },
  {
    method: 'POST',
    routeName: 'projects.restore',
    routePattern: '/api/v1/projects/:id/restore',
    permission: PROJECT_UPDATE,
  },
  {
    method: 'GET',
    routeName: 'projects.dashboard',
    routePattern: '/api/v1/projects/:id/dashboard',
    permission: PROJECT_VIEW,
  },
  // v3-project-health-risk-command-center —— 指挥中心只读聚合（维度权限在 reader 前下推）
  {
    method: 'GET',
    routeName: 'projects.health-risk-command-center.show',
    routePattern: '/api/v1/projects/:id/health-risk-command-center',
    permission: PROJECT_VIEW,
  },

  // 任务（嵌套于 /projects/:projectId/tasks，spec task-management）
  // update / status 的行级权限（task:update ∨ task:update:self）由 controller 经 TaskPolicy 判定，不在此注册。
  {
    method: 'POST',
    routeName: 'projects.tasks.store',
    routePattern: '/api/v1/projects/:projectId/tasks',
    permission: TASK_CREATE,
  },
  {
    method: 'POST',
    routeName: 'projects.tasks.ai-draft',
    routePattern: '/api/v1/projects/:projectId/tasks/ai-draft',
    permission: TASK_CREATE,
  },
  {
    method: 'POST',
    routeName: 'projects.tasks.calendar-suggest',
    routePattern: '/api/v1/projects/:projectId/tasks/calendar-suggest',
    permission: TASK_CREATE,
  },
  {
    method: 'GET',
    routeName: 'projects.tasks.index',
    routePattern: '/api/v1/projects/:projectId/tasks',
    permission: TASK_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.tasks.role-hints',
    routePattern: '/api/v1/projects/:projectId/tasks/role-hints',
    permission: TASK_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.kanban.index',
    routePattern: '/api/v1/projects/:projectId/kanban',
    permission: TASK_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.list.index',
    routePattern: '/api/v1/projects/:projectId/list',
    permission: TASK_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.kanban.move',
    routePattern: '/api/v1/projects/:projectId/kanban/move',
    permission: TASK_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.tasks.batch',
    routePattern: '/api/v1/projects/:projectId/tasks/batch',
    permission: TASK_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.tasks.recycle-bin',
    routePattern: '/api/v1/projects/:projectId/tasks/recycle-bin',
    permission: TASK_DELETE,
  },
  {
    method: 'POST',
    routeName: 'projects.tasks.batch-restore',
    routePattern: '/api/v1/projects/:projectId/tasks/batch-restore',
    permission: TASK_DELETE,
  },
  {
    method: 'GET',
    routeName: 'projects.tasks.show',
    routePattern: '/api/v1/projects/:projectId/tasks/:taskId',
    permission: TASK_VIEW,
  },
  {
    method: 'DELETE',
    routeName: 'projects.tasks.destroy',
    routePattern: '/api/v1/projects/:projectId/tasks/:taskId',
    permission: TASK_DELETE,
  },
  {
    method: 'POST',
    routeName: 'projects.tasks.restore',
    routePattern: '/api/v1/projects/:projectId/tasks/:taskId/restore',
    permission: TASK_DELETE,
  },
  {
    method: 'GET',
    routeName: 'projects.tasks.dependencies.index',
    routePattern: '/api/v1/projects/:projectId/tasks/:taskId/dependencies',
    permission: TASK_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.dependencies.index',
    routePattern: '/api/v1/projects/:projectId/dependencies',
    permission: TASK_VIEW,
  },
  // 依赖写入需 task:update ∨ task:update:self 的 successor 行级判定，交由 controller/policy。

  // WBS / 甘特图
  {
    method: 'GET',
    routeName: 'projects.wbs-tree.index',
    routePattern: '/api/v1/projects/:projectId/wbs-tree',
    permission: TASK_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.wbs-nodes.store',
    routePattern: '/api/v1/projects/:projectId/wbs/nodes',
    permission: WBS_CREATE,
  },
  {
    method: 'PATCH',
    routeName: 'projects.wbs-nodes.update',
    routePattern: '/api/v1/projects/:projectId/wbs/nodes/:id',
    // collapsed 对所有可查看者开放；name 的 wbs:update 由 controller 按字段守护。
    permission: TASK_VIEW,
  },
  {
    method: 'DELETE',
    routeName: 'projects.wbs-nodes.destroy',
    routePattern: '/api/v1/projects/:projectId/wbs/nodes/:id',
    permission: WBS_DELETE,
  },
  {
    method: 'POST',
    routeName: 'projects.wbs-nodes.move',
    routePattern: '/api/v1/projects/:projectId/wbs/nodes/:id/move',
    permission: WBS_MOVE,
  },
  {
    method: 'GET',
    routeName: 'projects.gantt.index',
    routePattern: '/api/v1/projects/:id/gantt',
    permission: GANTT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.gantt-baseline.show',
    routePattern: '/api/v1/projects/:projectId/gantt/baseline',
    permission: TASK_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.gantt-baseline.store',
    routePattern: '/api/v1/projects/:projectId/gantt/baseline',
    permission: TASK_UPDATE,
  },

  // 里程碑（嵌套列表/创建；扁平 show/update/destroy 无 projectId，权限交由 controller/policy）。
  {
    method: 'GET',
    routeName: 'projects.milestones.index',
    routePattern: '/api/v1/projects/:projectId/milestones',
    permission: MILESTONE_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.milestones.store',
    routePattern: '/api/v1/projects/:projectId/milestones',
    permission: MILESTONE_CREATE,
  },

  // v2-ai-project-health-diagnosis —— 项目健康诊断
  // view/generate/confirm 的细粒度权限由 controller 经 Policy 二次判定，
  // 本层只注册最低准入权限（view）。
  {
    method: 'GET',
    routeName: 'projects.health-diagnoses.latest',
    routePattern: '/api/v1/projects/:projectId/health-diagnoses/latest',
    permission: PROJECT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.health-diagnoses.index',
    routePattern: '/api/v1/projects/:projectId/health-diagnoses',
    permission: PROJECT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.health-diagnoses.store',
    routePattern: '/api/v1/projects/:projectId/health-diagnoses',
    permission: PROJECT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.health-diagnoses.refresh',
    routePattern: '/api/v1/projects/:projectId/health-diagnoses/refresh',
    permission: PROJECT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.health-diagnoses.show',
    routePattern: '/api/v1/projects/:projectId/health-diagnoses/:id',
    permission: PROJECT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.health-diagnoses.ai-draft',
    routePattern: '/api/v1/projects/:projectId/health-diagnoses/:id/ai-draft',
    permission: PROJECT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.health-diagnoses.confirm',
    routePattern: '/api/v1/projects/:projectId/health-diagnoses/:id/confirm',
    permission: PROJECT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.health-diagnoses.reject',
    routePattern: '/api/v1/projects/:projectId/health-diagnoses/:id/reject',
    permission: PROJECT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.health-diagnoses.confirm-stale',
    routePattern: '/api/v1/projects/:projectId/health-diagnoses/:id/confirm-stale',
    permission: PROJECT_VIEW,
  },
  {
    method: 'PATCH',
    routeName: 'projects.gantt.update',
    routePattern: '/api/v1/projects/:id/gantt',
    permission: GANTT_EDIT,
  },

  // 资源管理
  {
    method: 'GET',
    routeName: 'projects.resources.index',
    routePattern: '/api/v1/projects/:projectId/resources',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.resources.store',
    routePattern: '/api/v1/projects/:projectId/resources',
    permission: RESOURCE_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'projects.resources.show',
    routePattern: '/api/v1/projects/:projectId/resources/:id',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'PATCH',
    routeName: 'projects.resources.update',
    routePattern: '/api/v1/projects/:projectId/resources/:id',
    permission: RESOURCE_MANAGE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.resources.destroy',
    routePattern: '/api/v1/projects/:projectId/resources/:id',
    permission: RESOURCE_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'projects.resources.load',
    routePattern: '/api/v1/projects/:projectId/resources/load',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.resources.allocations.index',
    routePattern: '/api/v1/projects/:projectId/resources/:resourceId/allocations',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.resources.allocations.store',
    routePattern: '/api/v1/projects/:projectId/resources/:resourceId/allocations',
    permission: RESOURCE_MANAGE,
  },
  {
    method: 'PATCH',
    routeName: 'projects.resources.allocations.update',
    routePattern: '/api/v1/projects/:projectId/resources/:resourceId/allocations/:id',
    permission: RESOURCE_MANAGE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.resources.allocations.destroy',
    routePattern: '/api/v1/projects/:projectId/resources/:resourceId/allocations/:id',
    permission: RESOURCE_MANAGE,
  },

  // 报表 / 变更 / 风险 / 文件
  {
    method: 'GET',
    routeName: 'projects.reports.index',
    routePattern: '/api/v1/projects/:id/reports',
    permission: REPORT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.reports.store',
    routePattern: '/api/v1/projects/:id/reports',
    permission: REPORT_CREATE,
  },
  {
    method: 'GET',
    routeName: 'projects.reports.export',
    routePattern: '/api/v1/projects/:projectId/reports/export',
    permission: REPORT_EXPORT,
  },
  {
    method: 'GET',
    routeName: 'reports.show',
    routePattern: '/api/v1/reports/:id',
    permission: REPORT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'reports.exports.store',
    routePattern: '/api/v1/reports/:id/exports',
    permission: REPORT_EXPORT,
  },
  {
    method: 'GET',
    routeName: 'reports.exports.download',
    routePattern: '/api/v1/reports/:id/exports/:exportId/download',
    permission: REPORT_DOWNLOAD,
  },
  // V2 报表系统（v2-reporting-system-upgrade）
  {
    method: 'GET',
    routeName: 'projects.reports.v2.templates',
    routePattern: '/api/v1/projects/:projectId/reports/v2/templates',
    permission: REPORT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.reports.v2.workspace',
    routePattern: '/api/v1/projects/:projectId/reports/v2/workspace',
    permission: REPORT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.reports.v2.preview',
    routePattern: '/api/v1/projects/:projectId/reports/v2/preview',
    permission: REPORT_CREATE,
  },
  {
    method: 'POST',
    routeName: 'projects.reports.v2.versions.create',
    routePattern: '/api/v1/projects/:projectId/reports/v2/versions',
    permission: REPORT_CREATE,
  },
  {
    method: 'GET',
    routeName: 'projects.reports.v2.versions.index',
    routePattern: '/api/v1/projects/:projectId/reports/v2/versions',
    permission: REPORT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.reports.v2.versions.show',
    routePattern: '/api/v1/projects/:projectId/reports/v2/versions/:versionId',
    permission: REPORT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.reports.v2.jobs.show',
    routePattern: '/api/v1/projects/:projectId/reports/v2/jobs/:jobId',
    permission: REPORT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.reports.v2.jobs.retry',
    routePattern: '/api/v1/projects/:projectId/reports/v2/jobs/:jobId/retry',
    permission: REPORT_CREATE,
  },
  {
    method: 'POST',
    routeName: 'projects.reports.v2.exports.create',
    routePattern: '/api/v1/projects/:projectId/reports/v2/versions/:versionId/exports',
    permission: REPORT_EXPORT,
  },
  {
    method: 'GET',
    routeName: 'projects.reports.v2.exports.index',
    routePattern: '/api/v1/projects/:projectId/reports/v2/versions/:versionId/exports',
    permission: REPORT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.reports.v2.exports.download',
    routePattern: '/api/v1/projects/:projectId/reports/v2/exports/:exportId/download',
    permission: REPORT_DOWNLOAD,
  },
  {
    method: 'PATCH',
    routeName: 'projects.reports.v2.ai-review',
    routePattern: '/api/v1/projects/:projectId/reports/v2/versions/:versionId/ai-review',
    permission: AI_CONFIRM,
  },
  {
    method: 'POST',
    routeName: 'projects.change-requests.store',
    routePattern: '/api/v1/projects/:id/change-requests',
    permission: CHANGE_REQUEST_CREATE,
  },
  {
    method: 'PATCH',
    routeName: 'change-requests.approve',
    routePattern: '/api/v1/change-requests/:id/approve',
    permission: CHANGE_REQUEST_APPROVE,
  },
  {
    method: 'GET',
    routeName: 'projects.risks.index',
    routePattern: '/api/v1/projects/:id/risks',
    permission: RISK_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.risks.store',
    routePattern: '/api/v1/projects/:id/risks',
    permission: RISK_MANAGE,
  },
  // 图表（diagram-spec-minimum-contract）
  {
    method: 'GET',
    routeName: 'projects.diagrams.index',
    routePattern: '/api/v1/projects/:projectId/diagrams',
    permission: DIAGRAM_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.diagrams.store',
    routePattern: '/api/v1/projects/:projectId/diagrams',
    permission: DIAGRAM_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'projects.files.index',
    routePattern: '/api/v1/projects/:id/files',
    permission: FILE_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.files.store',
    routePattern: '/api/v1/projects/:id/files',
    permission: FILE_MANAGE,
  },

  // AI
  {
    method: 'POST',
    routeName: 'ai.draft',
    routePattern: '/api/v1/ai/draft',
    permission: AI_TRIGGER,
  },
  {
    method: 'POST',
    routeName: 'ai.project-intents.analyze',
    routePattern: '/api/v1/ai/project-intents/analyze',
    permission: AI_TRIGGER,
  },
  {
    method: 'POST',
    routeName: 'ai.project-intents.analyze-jobs',
    routePattern: '/api/v1/ai/project-intents/analyze/jobs',
    permission: AI_TRIGGER,
  },
  {
    method: 'POST',
    routeName: 'ai.drafts.understanding-jobs',
    routePattern: '/api/v1/ai/project-drafts/understanding/jobs',
    permission: AI_TRIGGER,
  },
  {
    method: 'GET',
    routeName: 'ai.analysis-jobs.show',
    routePattern: '/api/v1/ai/analysis-jobs/:id',
    permission: AI_TRIGGER,
  },
  {
    method: 'POST',
    routeName: 'projects.ai.draft.legacy',
    routePattern: '/api/v1/projects/:projectId/ai/draft',
    permission: AI_TRIGGER,
  },
  {
    method: 'POST',
    routeName: 'ai.confirm',
    routePattern: '/api/v1/ai/confirm',
    permission: AI_CONFIRM,
  },

  // V2 轻量日历/消息集成预连接
  {
    method: 'GET',
    routeName: 'integrations.index',
    routePattern: '/api/v1/integrations',
    permission: INTEGRATION_CONNECT,
  },
  {
    method: 'GET',
    routeName: 'integrations.show',
    routePattern: '/api/v1/integrations/:provider',
    permission: INTEGRATION_CONNECT,
  },
  {
    method: 'POST',
    routeName: 'integrations.authorize',
    routePattern: '/api/v1/integrations/:provider/authorize',
    permission: INTEGRATION_CONNECT,
  },
  {
    method: 'POST',
    routeName: 'integrations.qr',
    routePattern: '/api/v1/integrations/:provider/qr',
    permission: INTEGRATION_CONNECT,
  },
  {
    method: 'POST',
    routeName: 'integrations.check',
    routePattern: '/api/v1/integrations/:provider/check',
    permission: INTEGRATION_CONNECT,
  },
  {
    method: 'POST',
    routeName: 'integrations.disconnect',
    routePattern: '/api/v1/integrations/:provider/disconnect',
    permission: INTEGRATION_CONNECT,
  },

  // 组织 / 审计
  {
    method: 'POST',
    routeName: 'organizations.store',
    routePattern: '/api/v1/organizations',
    permission: SYSTEM_ADMIN,
  },
  {
    method: 'GET',
    routeName: 'organizations.show',
    routePattern: '/api/v1/organizations/:id',
    permission: ORG_VIEW,
  },
  {
    method: 'PUT',
    routeName: 'organizations.update',
    routePattern: '/api/v1/organizations/:id',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.members.index',
    routePattern: '/api/v1/organizations/:id/members',
    permission: ORG_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.members.invite',
    routePattern: '/api/v1/organizations/:id/members/invite',
    permission: ORG_MEMBER_MANAGE,
  },
  {
    method: 'PUT',
    routeName: 'organizations.members.update',
    routePattern: '/api/v1/organizations/:id/members/:memberId',
    permission: ORG_MEMBER_MANAGE,
  },
  {
    method: 'DELETE',
    routeName: 'organizations.members.destroy',
    routePattern: '/api/v1/organizations/:id/members/:memberId',
    permission: ORG_MEMBER_MANAGE,
  },
  {
    method: 'DELETE',
    routeName: 'organizations.destroy',
    routePattern: '/api/v1/organizations/:id',
    permission: SYSTEM_ADMIN,
  },
  {
    method: 'POST',
    routeName: 'organizations.transfer',
    routePattern: '/api/v1/organizations/:id/transfer-owner',
    permission: ORG_MANAGE,
  },
  // 用户管理（全局系统管理员域）
  {
    method: 'GET',
    routeName: 'users.index',
    routePattern: '/api/v1/users',
    permission: SYSTEM_ADMIN,
  },
  {
    method: 'POST',
    routeName: 'users.store',
    routePattern: '/api/v1/users',
    permission: SYSTEM_ADMIN,
  },
  {
    method: 'GET',
    routeName: 'users.show',
    routePattern: '/api/v1/users/:id',
    permission: SYSTEM_ADMIN,
  },
  {
    method: 'PUT',
    routeName: 'users.update',
    routePattern: '/api/v1/users/:id',
    permission: SYSTEM_ADMIN,
  },
  {
    method: 'DELETE',
    routeName: 'users.destroy',
    routePattern: '/api/v1/users/:id',
    permission: SYSTEM_ADMIN,
  },
  {
    method: 'GET',
    routeName: 'audit_logs.index',
    routePattern: '/api/v1/audit-logs',
    permission: AUDIT_VIEW,
  },
  // AI Compiler（v2-project-compiler-foundation）
  {
    method: 'POST',
    routeName: 'compiler.runs.store',
    routePattern: '/api/v1/ai/compiler/runs',
    permission: AI_COMPILER_RUN,
  },
  {
    method: 'GET',
    routeName: 'compiler.runs.show',
    routePattern: '/api/v1/ai/compiler/runs/:id',
    permission: AI_COMPILER_READ,
  },
  {
    method: 'GET',
    routeName: 'compiler.runs.events',
    routePattern: '/api/v1/ai/compiler/runs/:id/events',
    permission: AI_COMPILER_READ,
  },
  {
    method: 'GET',
    routeName: 'compiler.runs.ledger',
    routePattern: '/api/v1/ai/compiler/runs/:id/ledger',
    permission: AI_COMPILER_READ,
  },
  {
    method: 'GET',
    routeName: 'compiler.runs.pdm',
    routePattern: '/api/v1/ai/compiler/runs/:id/pdm',
    permission: AI_COMPILER_READ,
  },
  {
    method: 'GET',
    routeName: 'compiler.runs.repair-history',
    routePattern: '/api/v1/ai/compiler/runs/:id/repair-history',
    permission: AI_COMPILER_READ,
  },
  {
    method: 'POST',
    routeName: 'compiler.runs.resume',
    routePattern: '/api/v1/ai/compiler/runs/:id/resume',
    permission: AI_COMPILER_RUN,
  },
  // 自定义视图（v2-custom-views-view-config）
  // 列表/详情需 TASK_VIEW（视图是任务视图的扩展）
  {
    method: 'GET',
    routeName: 'projects.custom-views.index',
    routePattern: '/api/v1/projects/:projectId/custom-views',
    permission: TASK_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.custom-views.show',
    routePattern: '/api/v1/projects/:projectId/custom-views/:viewId',
    permission: TASK_VIEW,
  },
  // 创建/更新/删除使用 manage 级权限（由 CustomViewPolicy 行级判定）
  {
    method: 'POST',
    routeName: 'projects.custom-views.store',
    routePattern: '/api/v1/projects/:projectId/custom-views',
    permission: TASK_VIEW,
  },
  {
    method: 'PATCH',
    routeName: 'projects.custom-views.update',
    routePattern: '/api/v1/projects/:projectId/custom-views/:viewId',
    permission: TASK_VIEW,
  },
  {
    method: 'DELETE',
    routeName: 'projects.custom-views.destroy',
    routePattern: '/api/v1/projects/:projectId/custom-views/:viewId',
    permission: TASK_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.custom-views.clone',
    routePattern: '/api/v1/projects/:projectId/custom-views/:viewId/clone',
    permission: TASK_VIEW,
  },
  {
    method: 'PUT',
    routeName: 'projects.custom-views.reorder',
    routePattern: '/api/v1/projects/:projectId/custom-views/reorder',
    permission: TASK_VIEW,
  },
  {
    method: 'PUT',
    routeName: 'projects.custom-views.default',
    routePattern: '/api/v1/projects/:projectId/custom-views/:viewId/default',
    permission: TASK_VIEW,
  },

  // V2 文件管理（v2-file-management-upgrade）
  {
    method: 'POST',
    routeName: 'projects.files.v2.versions.upload',
    routePattern: '/api/v1/projects/:projectId/files/v2/attachments/:attachmentId/versions',
    permission: FILE_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'projects.files.v2.versions.index',
    routePattern: '/api/v1/projects/:projectId/files/v2/attachments/:attachmentId/versions',
    permission: FILE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.files.v2.versions.download',
    routePattern: '/api/v1/projects/:projectId/files/v2/versions/:versionId/download',
    permission: FILE_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.files.v2.versions.rollback',
    routePattern:
      '/api/v1/projects/:projectId/files/v2/attachments/:attachmentId/versions/rollback',
    permission: FILE_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'projects.files.v2.tags.index',
    routePattern: '/api/v1/projects/:projectId/files/v2/tags',
    permission: FILE_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.files.v2.tags.store',
    routePattern: '/api/v1/projects/:projectId/files/v2/tags',
    permission: FILE_MANAGE,
  },
  {
    method: 'PATCH',
    routeName: 'projects.files.v2.tags.update',
    routePattern: '/api/v1/projects/:projectId/files/v2/tags/:tagId',
    permission: FILE_MANAGE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.files.v2.tags.destroy',
    routePattern: '/api/v1/projects/:projectId/files/v2/tags/:tagId',
    permission: FILE_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'projects.files.v2.tags.assign',
    routePattern: '/api/v1/projects/:projectId/files/v2/tags/assign',
    permission: FILE_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'projects.files.v2.links.store',
    routePattern: '/api/v1/projects/:projectId/files/v2/links',
    permission: FILE_MANAGE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.files.v2.links.destroy',
    routePattern: '/api/v1/projects/:projectId/files/v2/links/:linkId',
    permission: FILE_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'projects.files.v2.links.entity',
    routePattern: '/api/v1/projects/:projectId/files/v2/entity/:entityType/:entityId',
    permission: FILE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.files.v2.search',
    routePattern: '/api/v1/projects/:projectId/files/v2/search',
    permission: FILE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.files.v2.trash.index',
    routePattern: '/api/v1/projects/:projectId/files/v2/trash',
    permission: FILE_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.files.v2.trash.store',
    routePattern: '/api/v1/projects/:projectId/files/v2/trash/:attachmentId',
    permission: FILE_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'projects.files.v2.trash.restore',
    routePattern: '/api/v1/projects/:projectId/files/v2/trash/:attachmentId/restore',
    permission: FILE_MANAGE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.files.v2.trash.permanent',
    routePattern: '/api/v1/projects/:projectId/files/v2/trash/:attachmentId/permanent',
    permission: FILE_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'projects.files.v2.batch.delete',
    routePattern: '/api/v1/projects/:projectId/files/v2/batch/delete',
    permission: FILE_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'projects.files.v2.batch.restore',
    routePattern: '/api/v1/projects/:projectId/files/v2/batch/restore',
    permission: FILE_MANAGE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.files.v2.batch.permanent',
    routePattern: '/api/v1/projects/:projectId/files/v2/batch/permanent',
    permission: FILE_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'projects.files.v2.batch.tag',
    routePattern: '/api/v1/projects/:projectId/files/v2/batch/tag',
    permission: FILE_MANAGE,
  },

  // V2 变更影响分析（v2-change-management-impact-analysis）
  {
    method: 'POST',
    routeName: 'projects.impact-analyses.store',
    routePattern: '/api/v1/projects/:projectId/change-requests/:changeRequestId/impact-analyses',
    permission: CHANGE_IMPACT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.impact-analyses.index',
    routePattern: '/api/v1/projects/:projectId/change-requests/:changeRequestId/impact-analyses',
    permission: CHANGE_IMPACT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'impact-analyses.show',
    routePattern: '/api/v1/impact-analyses/:id',
    permission: CHANGE_IMPACT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'impact-analyses.refresh',
    routePattern: '/api/v1/impact-analyses/:id/refresh',
    permission: CHANGE_IMPACT_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'impact-analyses.confirm',
    routePattern: '/api/v1/impact-analyses/:id/confirm',
    permission: CHANGE_IMPACT_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'impact-analyses.confirm-stale',
    routePattern: '/api/v1/impact-analyses/:id/confirm-stale',
    permission: CHANGE_IMPACT_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'impact-analyses.ai-explanation',
    routePattern: '/api/v1/impact-analyses/:id/ai-explanation',
    permission: AI_TRIGGER,
  },
  // TRIZ 矛盾模型基础层
  {
    method: 'GET',
    routeName: 'projects.contradictions.index',
    routePattern: '/api/v1/projects/:projectId/contradictions',
    permission: CONTRADICTION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.contradictions.refresh',
    routePattern: '/api/v1/projects/:projectId/contradictions/refresh',
    permission: CONTRADICTION_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'projects.contradictions.show',
    routePattern: '/api/v1/projects/:projectId/contradictions/:contradictionId',
    permission: CONTRADICTION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.contradictions.confirm',
    routePattern: '/api/v1/projects/:projectId/contradictions/:contradictionId/confirm',
    permission: CONTRADICTION_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'projects.contradictions.dismiss',
    routePattern: '/api/v1/projects/:projectId/contradictions/:contradictionId/dismiss',
    permission: CONTRADICTION_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'projects.contradictions.explain',
    routePattern: '/api/v1/projects/:projectId/contradictions/:contradictionId/explain',
    permission: AI_TRIGGER,
  },
  // v2-ai-risk-progress-prediction —— AI 风险与进度预测
  // view/generate/confirm/trigger_ai 的细粒度权限由 controller 经 Policy 二次判定，
  // 本层只注册最低准入权限（view）。
  {
    method: 'POST',
    routeName: 'projects.predictions.store',
    routePattern: '/api/v1/projects/:projectId/predictions',
    permission: PREDICTION_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.predictions.index',
    routePattern: '/api/v1/projects/:projectId/predictions',
    permission: PREDICTION_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.predictions.latest',
    routePattern: '/api/v1/projects/:projectId/predictions/latest',
    permission: PREDICTION_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.predictions.show',
    routePattern: '/api/v1/projects/:projectId/predictions/:id',
    permission: PREDICTION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.predictions.confirm',
    routePattern: '/api/v1/projects/:projectId/predictions/:id/confirm',
    permission: PREDICTION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.predictions.dismiss',
    routePattern: '/api/v1/projects/:projectId/predictions/:id/dismiss',
    permission: PREDICTION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.predictions.ai-explanation',
    routePattern: '/api/v1/projects/:projectId/predictions/:id/ai-explanation',
    permission: PREDICTION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.predictions.ai-explanation.approve',
    routePattern: '/api/v1/projects/:projectId/predictions/:id/ai-explanation/approve',
    permission: PREDICTION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.predictions.ai-explanation.reject',
    routePattern: '/api/v1/projects/:projectId/predictions/:id/ai-explanation/reject',
    permission: PREDICTION_VIEW,
  },
  // v2-triz-compiler-analysis-layer —— TRIZ Compiler Analysis
  {
    method: 'GET',
    routeName: 'compiler.runs.triz-analysis.index',
    routePattern: '/api/v1/ai/compiler/runs/:runId/triz-analysis',
    permission: CONTRADICTION_VIEW,
  },
  {
    method: 'GET',
    routeName: 'compiler.runs.triz-analysis.show',
    routePattern: '/api/v1/ai/compiler/runs/:runId/triz-analysis/:artifactId',
    permission: CONTRADICTION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'compiler.runs.triz-analysis.handoff',
    routePattern: '/api/v1/ai/compiler/runs/:runId/triz-analysis/:artifactId/draft-handoff',
    permission: CONTRADICTION_VIEW,
  },
  // reads 需要 task:view，mutations 需要 task:update（由 controller 经 Policy 二次判定）
  {
    method: 'GET',
    routeName: 'projects.tasks.external-links.index',
    routePattern: '/api/v1/projects/:projectId/tasks/:taskId/external-links',
    permission: TASK_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.tasks.external-links.store',
    routePattern: '/api/v1/projects/:projectId/tasks/:taskId/external-links',
    permission: TASK_UPDATE,
  },
  {
    method: 'PUT',
    routeName: 'projects.tasks.external-links.update',
    routePattern: '/api/v1/projects/:projectId/tasks/:taskId/external-links/:linkId',
    permission: TASK_UPDATE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.tasks.external-links.destroy',
    routePattern: '/api/v1/projects/:projectId/tasks/:taskId/external-links/:linkId',
    permission: TASK_UPDATE,
  },
  {
    method: 'POST',
    routeName: 'projects.tasks.external-links.refresh',
    routePattern: '/api/v1/projects/:projectId/tasks/:taskId/external-links/:linkId/refresh',
    permission: TASK_UPDATE,
  },

  // 34 阶段代码生成候选运行（v3-codegen-34-stage-candidate-runtime-execution）
  // 创建执行用窄权限 codegen_candidate_run:run，不回落到任何通用写权限
  {
    method: 'POST',
    routeName: 'projects.compiler.codegen.candidate-runs.store',
    routePattern: '/api/v1/projects/:projectId/compiler/codegen/candidate-runs',
    permission: CODEGEN_CANDIDATE_RUN_RUN,
  },
  {
    method: 'GET',
    routeName: 'projects.compiler.codegen.candidate-runs.index',
    routePattern: '/api/v1/projects/:projectId/compiler/codegen/candidate-runs',
    permission: CODEGEN_CANDIDATE_RUN_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.compiler.codegen.candidate-runs.show',
    routePattern: '/api/v1/projects/:projectId/compiler/codegen/candidate-runs/:id',
    permission: CODEGEN_CANDIDATE_RUN_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.compiler.codegen.candidate-runs.stages',
    routePattern: '/api/v1/projects/:projectId/compiler/codegen/candidate-runs/:id/stages',
    permission: CODEGEN_CANDIDATE_RUN_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.compiler.codegen.candidate-runs.review-packet',
    routePattern: '/api/v1/projects/:projectId/compiler/codegen/candidate-runs/:id/review-packet',
    permission: CODEGEN_CANDIDATE_RUN_VIEW,
  },
  // OCR 权限/审计（v3-ocr-permission-and-audit §5.3）
  {
    method: 'GET',
    routeName: 'projects.ocr.permission-audit.status',
    routePattern: '/api/v1/projects/:projectId/ocr/permission-audit/status',
    permission: OCR_PERMISSION_AUDIT_VIEW_STATUS,
  },
  {
    method: 'POST',
    routeName: 'projects.ocr.permission-audit.decision-preview',
    routePattern: '/api/v1/projects/:projectId/ocr/permission-audit/decision-preview',
    permission: OCR_PERMISSION_AUDIT_VIEW_STATUS,
  },
  {
    method: 'GET',
    routeName: 'projects.ocr.permission-audit.audit-summaries',
    routePattern: '/api/v1/projects/:projectId/ocr/permission-audit/audit-summaries',
    permission: OCR_PERMISSION_AUDIT_AUDIT_READ,
  },

  {
    // v3-resource-capacity-forecasting-closed-loop —— 组织级容量闭环（读=VIEW，写=MANAGE）
    method: 'GET',
    routeName: 'organizations.resource-capacity-loops.index',
    routePattern: '/api/v1/organizations/:organizationId/resource-capacity-loops',
    permission: RESOURCE_CAPACITY_LOOP_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-capacity-loops.catalogue',
    routePattern: '/api/v1/organizations/:organizationId/resource-capacity-loops/catalogue',
    permission: RESOURCE_CAPACITY_LOOP_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.resource-capacity-loops.store',
    routePattern: '/api/v1/organizations/:organizationId/resource-capacity-loops',
    permission: RESOURCE_CAPACITY_LOOP_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-capacity-loops.show',
    routePattern: '/api/v1/organizations/:organizationId/resource-capacity-loops/:loopId',
    permission: RESOURCE_CAPACITY_LOOP_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.resource-capacity-loops.baseline-refresh',
    routePattern:
      '/api/v1/organizations/:organizationId/resource-capacity-loops/:loopId/baseline-refresh',
    permission: RESOURCE_CAPACITY_LOOP_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.resource-capacity-loops.scenarios.store',
    routePattern: '/api/v1/organizations/:organizationId/resource-capacity-loops/:loopId/scenarios',
    permission: RESOURCE_CAPACITY_LOOP_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.resource-capacity-loops.simulate',
    routePattern: '/api/v1/organizations/:organizationId/resource-capacity-loops/:loopId/simulate',
    permission: RESOURCE_CAPACITY_LOOP_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.resource-capacity-loops.select',
    routePattern: '/api/v1/organizations/:organizationId/resource-capacity-loops/:loopId/select',
    permission: RESOURCE_CAPACITY_LOOP_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.resource-capacity-loops.handoff',
    routePattern: '/api/v1/organizations/:organizationId/resource-capacity-loops/:loopId/handoff',
    permission: RESOURCE_CAPACITY_LOOP_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-capacity-loops.handoff-status',
    routePattern:
      '/api/v1/organizations/:organizationId/resource-capacity-loops/:loopId/handoffs/:receiptId/status',
    permission: RESOURCE_CAPACITY_LOOP_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.resource-capacity-loops.observations',
    routePattern:
      '/api/v1/organizations/:organizationId/resource-capacity-loops/:loopId/observations',
    permission: RESOURCE_CAPACITY_LOOP_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.resource-capacity-loops.review',
    routePattern: '/api/v1/organizations/:organizationId/resource-capacity-loops/:loopId/review',
    permission: RESOURCE_CAPACITY_LOOP_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.resource-capacity-loops.close',
    routePattern: '/api/v1/organizations/:organizationId/resource-capacity-loops/:loopId/close',
    permission: RESOURCE_CAPACITY_LOOP_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.resource-capacity-loops.cancel',
    routePattern: '/api/v1/organizations/:organizationId/resource-capacity-loops/:loopId/cancel',
    permission: RESOURCE_CAPACITY_LOOP_MANAGE,
  },
  // ─── v3-triz-to-delivery-closed-loop：项目级闭环（读=VIEW，link/verify/reopen/request_ai 分权）───
  {
    method: 'GET',
    routeName: 'projects.triz.delivery-loop.summary',
    routePattern: '/api/v1/projects/:projectId/triz/delivery-loop/summary',
    permission: TRIZ_DELIVERY_LOOP_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.triz.delivery-loop.items',
    routePattern: '/api/v1/projects/:projectId/triz/delivery-loop/items',
    permission: TRIZ_DELIVERY_LOOP_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.triz.delivery-loop.item-detail',
    routePattern: '/api/v1/projects/:projectId/triz/delivery-loop/items/:itemId',
    permission: TRIZ_DELIVERY_LOOP_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.triz.delivery-loop.links-preview',
    routePattern: '/api/v1/projects/:projectId/triz/delivery-loop/links/preview',
    permission: TRIZ_DELIVERY_LOOP_LINK,
  },
  {
    method: 'POST',
    routeName: 'projects.triz.delivery-loop.links-confirm',
    routePattern: '/api/v1/projects/:projectId/triz/delivery-loop/links/confirm',
    permission: TRIZ_DELIVERY_LOOP_LINK,
  },
  {
    method: 'POST',
    routeName: 'projects.triz.delivery-loop.verifications',
    routePattern: '/api/v1/projects/:projectId/triz/delivery-loop/items/:itemId/verifications',
    permission: TRIZ_DELIVERY_LOOP_VERIFY,
  },
  {
    method: 'POST',
    routeName: 'projects.triz.delivery-loop.reopen',
    routePattern: '/api/v1/projects/:projectId/triz/delivery-loop/items/:itemId/reopen',
    permission: TRIZ_DELIVERY_LOOP_REOPEN,
  },
  {
    method: 'POST',
    routeName: 'projects.triz.delivery-loop.ai-draft',
    routePattern: '/api/v1/projects/:projectId/triz/delivery-loop/items/:itemId/ai-draft',
    permission: TRIZ_DELIVERY_LOOP_REQUEST_AI,
  },
  // ── v3-chart-gallery-data-foundation（design D4 映射矩阵 + D5 端点树）──────
  // 项目章程
  {
    method: 'GET',
    routeName: 'projects.charter.show',
    routePattern: '/api/v1/projects/:projectId/charter',
    permission: PROJECT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.charter.store',
    routePattern: '/api/v1/projects/:projectId/charter',
    permission: PROJECT_UPDATE,
  },
  {
    method: 'PATCH',
    routeName: 'projects.charter.update',
    routePattern: '/api/v1/projects/:projectId/charter',
    permission: PROJECT_UPDATE,
  },
  {
    method: 'POST',
    routeName: 'projects.charter.submit',
    routePattern: '/api/v1/projects/:projectId/charter/submit',
    permission: PROJECT_UPDATE,
  },
  {
    method: 'POST',
    routeName: 'projects.charter.approve',
    routePattern: '/api/v1/projects/:projectId/charter/approve',
    permission: CHARTER_APPROVE,
  },
  // 需求 + RTM
  {
    method: 'GET',
    routeName: 'projects.requirements.index',
    routePattern: '/api/v1/projects/:projectId/requirements',
    permission: TASK_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.requirements.store',
    routePattern: '/api/v1/projects/:projectId/requirements',
    permission: TASK_CREATE,
  },
  {
    method: 'GET',
    routeName: 'projects.requirements.rtm-matrix',
    routePattern: '/api/v1/projects/:projectId/requirements/rtm-matrix',
    permission: TASK_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.requirements.show',
    routePattern: '/api/v1/projects/:projectId/requirements/:id',
    permission: TASK_VIEW,
  },
  {
    method: 'PATCH',
    routeName: 'projects.requirements.update',
    routePattern: '/api/v1/projects/:projectId/requirements/:id',
    permission: TASK_UPDATE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.requirements.destroy',
    routePattern: '/api/v1/projects/:projectId/requirements/:id',
    permission: PROJECT_UPDATE,
  },
  {
    method: 'POST',
    routeName: 'projects.requirements.bind-task',
    routePattern: '/api/v1/projects/:projectId/requirements/:id/tasks',
    permission: TASK_UPDATE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.requirements.unbind-task',
    routePattern: '/api/v1/projects/:projectId/requirements/:id/tasks/:taskId',
    permission: TASK_UPDATE,
  },
  // 议题缺陷
  {
    method: 'GET',
    routeName: 'projects.issues.index',
    routePattern: '/api/v1/projects/:projectId/issues',
    permission: TASK_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.issues.store',
    routePattern: '/api/v1/projects/:projectId/issues',
    permission: TASK_CREATE,
  },
  {
    method: 'GET',
    routeName: 'projects.issues.show',
    routePattern: '/api/v1/projects/:projectId/issues/:id',
    permission: TASK_VIEW,
  },
  {
    method: 'PATCH',
    routeName: 'projects.issues.update',
    routePattern: '/api/v1/projects/:projectId/issues/:id',
    permission: TASK_UPDATE,
  },
  {
    method: 'PATCH',
    routeName: 'projects.issues.change-status',
    routePattern: '/api/v1/projects/:projectId/issues/:id/status',
    permission: TASK_UPDATE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.issues.destroy',
    routePattern: '/api/v1/projects/:projectId/issues/:id',
    permission: PROJECT_UPDATE,
  },
  // 干系人登记表
  {
    method: 'GET',
    routeName: 'projects.stakeholders.index',
    routePattern: '/api/v1/projects/:projectId/stakeholders',
    permission: PROJECT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.stakeholders.store',
    routePattern: '/api/v1/projects/:projectId/stakeholders',
    permission: PROJECT_UPDATE,
  },
  {
    method: 'GET',
    routeName: 'projects.stakeholders.show',
    routePattern: '/api/v1/projects/:projectId/stakeholders/:id',
    permission: PROJECT_VIEW,
  },
  {
    method: 'PATCH',
    routeName: 'projects.stakeholders.update',
    routePattern: '/api/v1/projects/:projectId/stakeholders/:id',
    permission: PROJECT_UPDATE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.stakeholders.destroy',
    routePattern: '/api/v1/projects/:projectId/stakeholders/:id',
    permission: PROJECT_UPDATE,
  },
  // 沟通管理计划
  {
    method: 'GET',
    routeName: 'projects.communication-plans.index',
    routePattern: '/api/v1/projects/:projectId/communication-plans',
    permission: PROJECT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'projects.communication-plans.store',
    routePattern: '/api/v1/projects/:projectId/communication-plans',
    permission: PROJECT_UPDATE,
  },
  {
    method: 'GET',
    routeName: 'projects.communication-plans.show',
    routePattern: '/api/v1/projects/:projectId/communication-plans/:id',
    permission: PROJECT_VIEW,
  },
  {
    method: 'PATCH',
    routeName: 'projects.communication-plans.update',
    routePattern: '/api/v1/projects/:projectId/communication-plans/:id',
    permission: PROJECT_UPDATE,
  },
  {
    method: 'DELETE',
    routeName: 'projects.communication-plans.destroy',
    routePattern: '/api/v1/projects/:projectId/communication-plans/:id',
    permission: PROJECT_UPDATE,
  },
  // 组织部门树（OBS，组织级）
  {
    method: 'GET',
    routeName: 'departments.index',
    routePattern: '/api/v1/departments',
    permission: ORG_VIEW,
  },
  {
    method: 'POST',
    routeName: 'departments.store',
    routePattern: '/api/v1/departments',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'departments.show',
    routePattern: '/api/v1/departments/:id',
    permission: ORG_VIEW,
  },
  {
    method: 'PATCH',
    routeName: 'departments.update',
    routePattern: '/api/v1/departments/:id',
    permission: ORG_MANAGE,
  },
  {
    method: 'DELETE',
    routeName: 'departments.destroy',
    routePattern: '/api/v1/departments/:id',
    permission: ORG_MANAGE,
  },
  // 项目级聚合端点（RACI / OBS / 度量）
  {
    method: 'GET',
    routeName: 'projects.raci-matrix.show',
    routePattern: '/api/v1/projects/:projectId/raci-matrix',
    permission: TASK_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.obs-tree.show',
    routePattern: '/api/v1/projects/:projectId/obs-tree',
    permission: PROJECT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.metrics.evm',
    routePattern: '/api/v1/projects/:projectId/metrics/evm',
    permission: PROJECT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.metrics.evm-s-curve',
    routePattern: '/api/v1/projects/:projectId/metrics/evm/s-curve',
    permission: PROJECT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.metrics.burndown',
    routePattern: '/api/v1/projects/:projectId/metrics/burndown',
    permission: PROJECT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.metrics.lob',
    routePattern: '/api/v1/projects/:projectId/metrics/lob',
    permission: TASK_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.metrics.control-chart',
    routePattern: '/api/v1/projects/:projectId/metrics/control-chart',
    permission: PROJECT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'projects.metrics.pareto',
    routePattern: '/api/v1/projects/:projectId/metrics/pareto',
    permission: PROJECT_VIEW,
  },

  // ── 组织级端点族 RBAC 规则（v3-tech-debt-backlog-sweep §6.3）──

  // 1. BI 聚合
  {
    method: 'GET',
    routeName: 'organizations.bi.aggregations.index',
    routePattern: '/api/v1/organizations/:organizationId/bi/aggregations',
    permission: PORTFOLIO_VIEW,
  },

  // 2. BI 自定义报表构建器
  {
    method: 'GET',
    routeName: 'organizations.bi.custom-reports.registry',
    routePattern: '/api/v1/organizations/:organizationId/bi/custom-reports/registry',
    permission: REPORT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.custom-reports.preview',
    routePattern: '/api/v1/organizations/:organizationId/bi/custom-reports/preview',
    permission: REPORT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.bi.custom-reports.definitions.list',
    routePattern: '/api/v1/organizations/:organizationId/bi/custom-reports/definitions',
    permission: REPORT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.custom-reports.definitions.create',
    routePattern: '/api/v1/organizations/:organizationId/bi/custom-reports/definitions',
    permission: REPORT_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.bi.custom-reports.definitions.show',
    routePattern:
      '/api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId',
    permission: REPORT_VIEW,
  },
  {
    method: 'PUT',
    routeName: 'organizations.bi.custom-reports.definitions.update',
    routePattern:
      '/api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId',
    permission: REPORT_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.custom-reports.definitions.copy',
    routePattern:
      '/api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId/copy',
    permission: REPORT_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.custom-reports.definitions.set-default',
    routePattern:
      '/api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId/set-default',
    permission: REPORT_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.custom-reports.definitions.archive',
    routePattern:
      '/api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId/archive',
    permission: REPORT_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.custom-reports.definitions.restore',
    routePattern:
      '/api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId/restore',
    permission: REPORT_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.bi.custom-reports.definitions.versions',
    routePattern:
      '/api/v1/organizations/:organizationId/bi/custom-reports/definitions/:definitionId/versions',
    permission: REPORT_VIEW,
  },

  // 3. BI Dashboard Builder
  {
    method: 'GET',
    routeName: 'organizations.bi.dashboards.registry',
    routePattern: '/api/v1/organizations/:organizationId/bi/dashboards/registry',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.bi.dashboards.index',
    routePattern: '/api/v1/organizations/:organizationId/bi/dashboards',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.bi.dashboards.current',
    routePattern: '/api/v1/organizations/:organizationId/bi/dashboards/current',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.bi.dashboards.show',
    routePattern: '/api/v1/organizations/:organizationId/bi/dashboards/:id',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.dashboards.preview',
    routePattern: '/api/v1/organizations/:organizationId/bi/dashboards/preview',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.dashboards.store',
    routePattern: '/api/v1/organizations/:organizationId/bi/dashboards',
    permission: ORG_MANAGE,
  },
  {
    method: 'PUT',
    routeName: 'organizations.bi.dashboards.update',
    routePattern: '/api/v1/organizations/:organizationId/bi/dashboards/:id',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.dashboards.copy',
    routePattern: '/api/v1/organizations/:organizationId/bi/dashboards/:id/copy',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.dashboards.set-default',
    routePattern: '/api/v1/organizations/:organizationId/bi/dashboards/:id/set-default',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.dashboards.archive',
    routePattern: '/api/v1/organizations/:organizationId/bi/dashboards/:id/archive',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.dashboards.restore',
    routePattern: '/api/v1/organizations/:organizationId/bi/dashboards/:id/restore',
    permission: ORG_MANAGE,
  },
  {
    method: 'DELETE',
    routeName: 'organizations.bi.dashboards.destroy',
    routePattern: '/api/v1/organizations/:organizationId/bi/dashboards/:id',
    permission: ORG_MANAGE,
  },

  // 4. BI 报表模板库
  {
    method: 'GET',
    routeName: 'organizations.bi.report-templates.index',
    routePattern: '/api/v1/organizations/:organizationId/bi/report-templates',
    permission: REPORT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.bi.report-templates.show',
    routePattern: '/api/v1/organizations/:organizationId/bi/report-templates/:templateId',
    permission: REPORT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.bi.report-templates.preview',
    routePattern: '/api/v1/organizations/:organizationId/bi/report-templates/:templateId/preview',
    permission: REPORT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.report-templates.instantiate',
    routePattern:
      '/api/v1/organizations/:organizationId/bi/report-templates/:templateId/instantiate',
    permission: REPORT_CREATE,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.report-templates.copy.preview',
    routePattern:
      '/api/v1/organizations/:organizationId/bi/report-templates/:templateId/copy/preview',
    permission: REPORT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.report-templates.copy.confirm',
    routePattern:
      '/api/v1/organizations/:organizationId/bi/report-templates/:templateId/copy/confirm',
    permission: REPORT_CREATE,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.report-templates.copy',
    routePattern: '/api/v1/organizations/:organizationId/bi/report-templates/:templateId/copy',
    permission: REPORT_CREATE,
  },
  {
    method: 'PATCH',
    routeName: 'organizations.bi.report-templates.copies.update',
    routePattern: '/api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId',
    permission: REPORT_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.report-templates.copies.archive',
    routePattern:
      '/api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId/archive',
    permission: REPORT_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.bi.report-templates.copies.restore',
    routePattern:
      '/api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId/restore',
    permission: REPORT_MANAGE,
  },

  // 5. BI 风险热力图
  {
    method: 'GET',
    routeName: 'organizations.bi.risk-heatmap.index',
    routePattern: '/api/v1/organizations/:organizationId/bi/risk-heatmap',
    permission: RISK_VIEW,
  },

  // 6. BI 趋势分析
  {
    method: 'GET',
    routeName: 'organizations.bi.trends.index',
    routePattern: '/api/v1/organizations/:organizationId/bi/trends',
    permission: PORTFOLIO_VIEW,
  },

  // 7. 跨项目资源调配
  {
    method: 'POST',
    routeName: 'organizations.cross-project-allocations.drafts.create',
    routePattern: '/api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts',
    permission: RESOURCE_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.cross-project-allocations.drafts.list',
    routePattern: '/api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.cross-project-allocations.drafts.show',
    routePattern:
      '/api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'PUT',
    routeName: 'organizations.cross-project-allocations.drafts.items.update',
    routePattern:
      '/api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId/items',
    permission: RESOURCE_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.cross-project-allocations.drafts.preview',
    routePattern:
      '/api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId/preview',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.cross-project-allocations.drafts.confirm',
    routePattern:
      '/api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId/confirm',
    permission: RESOURCE_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.cross-project-allocations.drafts.apply',
    routePattern:
      '/api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId/apply',
    permission: RESOURCE_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.cross-project-allocations.drafts.cancel',
    routePattern:
      '/api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId/cancel',
    permission: RESOURCE_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.cross-project-allocations.candidates',
    routePattern:
      '/api/v1/organizations/:organizationId/cross-project-resource-allocations/candidates',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.cross-project-allocations.drafts.conflicts',
    routePattern:
      '/api/v1/organizations/:organizationId/cross-project-resource-allocations/drafts/:draftId/conflicts',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.cross-project-allocations.drill-down',
    routePattern:
      '/api/v1/organizations/:organizationId/cross-project-resource-allocations/drill-down',
    permission: RESOURCE_VIEW,
  },

  // 8. 组织级 Dashboard
  {
    method: 'GET',
    routeName: 'organizations.dashboard.show',
    routePattern: '/api/v1/organizations/:organizationId/dashboard',
    permission: PORTFOLIO_VIEW,
  },

  // 9. Dashboard 布局管理
  {
    method: 'GET',
    routeName: 'organizations.dashboard.layouts.index',
    routePattern: '/api/v1/organizations/:organizationId/dashboard/layouts',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.dashboard.layouts.current',
    routePattern: '/api/v1/organizations/:organizationId/dashboard/layouts/current',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.dashboard.layouts.show',
    routePattern: '/api/v1/organizations/:organizationId/dashboard/layouts/:layoutId',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.dashboard.layouts.preview',
    routePattern: '/api/v1/organizations/:organizationId/dashboard/layouts/preview',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.dashboard.layouts.personal.store',
    routePattern: '/api/v1/organizations/:organizationId/dashboard/layouts/personal',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.dashboard.layouts.shared.store',
    routePattern: '/api/v1/organizations/:organizationId/dashboard/layouts/shared',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.dashboard.layouts.copy',
    routePattern: '/api/v1/organizations/:organizationId/dashboard/layouts/:layoutId/copy',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'PUT',
    routeName: 'organizations.dashboard.layouts.default',
    routePattern: '/api/v1/organizations/:organizationId/dashboard/layouts/:layoutId/default',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.dashboard.layouts.reset',
    routePattern: '/api/v1/organizations/:organizationId/dashboard/layouts/reset',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'DELETE',
    routeName: 'organizations.dashboard.layouts.destroy',
    routePattern: '/api/v1/organizations/:organizationId/dashboard/layouts/:layoutId',
    permission: ORG_MANAGE,
  },

  // 10. 跨项目依赖 CRUD
  {
    method: 'GET',
    routeName: 'organizations.multi-project-dependencies.index',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-dependencies',
    permission: ORG_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.multi-project-dependencies.graph',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-dependencies/graph',
    permission: ORG_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.multi-project-dependencies.suggestions',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-dependencies/suggestions',
    permission: ORG_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.multi-project-dependencies.show',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-dependencies/:dependencyId',
    permission: ORG_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.preview-create',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-dependencies/preview-create',
    permission: ORG_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.confirm-create',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-dependencies/confirm-create',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.confirm',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-dependencies/confirm',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.preview-update',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-dependencies/preview-update',
    permission: ORG_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.confirm-update',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-dependencies/confirm-update',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.preview-archive',
    routePattern:
      '/api/v1/organizations/:organizationId/multi-project-dependencies/preview-archive',
    permission: ORG_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.confirm-archive',
    routePattern:
      '/api/v1/organizations/:organizationId/multi-project-dependencies/confirm-archive',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.preview-restore',
    routePattern:
      '/api/v1/organizations/:organizationId/multi-project-dependencies/preview-restore',
    permission: ORG_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.confirm-restore',
    routePattern:
      '/api/v1/organizations/:organizationId/multi-project-dependencies/confirm-restore',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.preview-delete',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-dependencies/preview-delete',
    permission: ORG_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.confirm-delete',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-dependencies/confirm-delete',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.drill-down',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-dependencies/drill-down',
    permission: ORG_VIEW,
  },

  // 11. 跨项目依赖检测
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.detections.plan',
    routePattern:
      '/api/v1/organizations/:organizationId/multi-project-dependencies/detections/plan',
    permission: ORG_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.detections.run',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-dependencies/detections/run',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.multi-project-dependencies.detections.runs.list',
    routePattern:
      '/api/v1/organizations/:organizationId/multi-project-dependencies/detections/runs',
    permission: ORG_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.multi-project-dependencies.detections.results.list',
    routePattern:
      '/api/v1/organizations/:organizationId/multi-project-dependencies/detections/results',
    permission: ORG_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.multi-project-dependencies.detections.results.show',
    routePattern:
      '/api/v1/organizations/:organizationId/multi-project-dependencies/detections/results/:resultId',
    permission: ORG_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.detections.results.ignore',
    routePattern:
      '/api/v1/organizations/:organizationId/multi-project-dependencies/detections/results/:resultId/ignore',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.detections.results.reopen',
    routePattern:
      '/api/v1/organizations/:organizationId/multi-project-dependencies/detections/results/:resultId/reopen',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-dependencies.detections.draft-bridge',
    routePattern:
      '/api/v1/organizations/:organizationId/multi-project-dependencies/detections/draft-bridge',
    permission: ORG_MANAGE,
  },

  // 12. 多项目影响分析
  {
    method: 'POST',
    routeName: 'organizations.multi-project-impact-analyses.plan',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-impact-analyses/plan',
    permission: MULTI_PROJECT_IMPACT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-impact-analyses.run',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-impact-analyses/run',
    permission: MULTI_PROJECT_IMPACT_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.multi-project-impact-analyses.list',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-impact-analyses',
    permission: MULTI_PROJECT_IMPACT_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.multi-project-impact-analyses.read',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-impact-analyses/:snapshotId',
    permission: MULTI_PROJECT_IMPACT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-impact-analyses.refresh',
    routePattern:
      '/api/v1/organizations/:organizationId/multi-project-impact-analyses/:snapshotId/refresh',
    permission: MULTI_PROJECT_IMPACT_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-impact-analyses.what-if',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-impact-analyses/what-if',
    permission: MULTI_PROJECT_IMPACT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-impact-analyses.export',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-impact-analyses/export',
    permission: MULTI_PROJECT_IMPACT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-impact-analyses.follow-up',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-impact-analyses/follow-up',
    permission: MULTI_PROJECT_IMPACT_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-impact-analyses.ai-explanation',
    routePattern:
      '/api/v1/organizations/:organizationId/multi-project-impact-analyses/ai-explanation',
    permission: MULTI_PROJECT_IMPACT_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.multi-project-impact-analyses.drill-down',
    routePattern: '/api/v1/organizations/:organizationId/multi-project-impact-analyses/drill-down',
    permission: MULTI_PROJECT_IMPACT_VIEW,
  },

  // 13. OKR 层级与级联管理
  {
    method: 'GET',
    routeName: 'organizations.okr.cycles.list',
    routePattern: '/api/v1/organizations/:organizationId/okrs/cycles',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.cycles.create',
    routePattern: '/api/v1/organizations/:organizationId/okrs/cycles',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.cycles.show',
    routePattern: '/api/v1/organizations/:organizationId/okrs/cycles/:cycleId',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'PUT',
    routeName: 'organizations.okr.cycles.update',
    routePattern: '/api/v1/organizations/:organizationId/okrs/cycles/:cycleId',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.cycles.archive',
    routePattern: '/api/v1/organizations/:organizationId/okrs/cycles/:cycleId/archive',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.cycles.restore',
    routePattern: '/api/v1/organizations/:organizationId/okrs/cycles/:cycleId/restore',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.objectives.list',
    routePattern: '/api/v1/organizations/:organizationId/okrs/objectives',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.objectives.create',
    routePattern: '/api/v1/organizations/:organizationId/okrs/objectives',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.objectives.show',
    routePattern: '/api/v1/organizations/:organizationId/okrs/objectives/:objectiveId',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'PUT',
    routeName: 'organizations.okr.objectives.update',
    routePattern: '/api/v1/organizations/:organizationId/okrs/objectives/:objectiveId',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.objectives.archive',
    routePattern: '/api/v1/organizations/:organizationId/okrs/objectives/:objectiveId/archive',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.objectives.restore',
    routePattern: '/api/v1/organizations/:organizationId/okrs/objectives/:objectiveId/restore',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.tree',
    routePattern: '/api/v1/organizations/:organizationId/okrs/tree',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.key-results.list',
    routePattern: '/api/v1/organizations/:organizationId/okrs/key-results',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.key-results.create',
    routePattern: '/api/v1/organizations/:organizationId/okrs/key-results',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.key-results.show',
    routePattern: '/api/v1/organizations/:organizationId/okrs/key-results/:keyResultId',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'PUT',
    routeName: 'organizations.okr.key-results.update',
    routePattern: '/api/v1/organizations/:organizationId/okrs/key-results/:keyResultId',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.key-results.archive',
    routePattern: '/api/v1/organizations/:organizationId/okrs/key-results/:keyResultId/archive',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.key-results.progress',
    routePattern: '/api/v1/organizations/:organizationId/okrs/key-results/:keyResultId/progress',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.key-results.progress-history',
    routePattern:
      '/api/v1/organizations/:organizationId/okrs/key-results/:keyResultId/progress-history',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.alignments.create',
    routePattern: '/api/v1/organizations/:organizationId/okrs/alignments',
    permission: ORG_MANAGE,
  },
  {
    method: 'DELETE',
    routeName: 'organizations.okr.alignments.remove',
    routePattern: '/api/v1/organizations/:organizationId/okrs/alignments/:alignmentId',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.alignments.list',
    routePattern: '/api/v1/organizations/:organizationId/okrs/objectives/:objectiveId/alignments',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.evidence.create',
    routePattern: '/api/v1/organizations/:organizationId/okrs/evidence',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.evidence.list',
    routePattern: '/api/v1/organizations/:organizationId/okrs/evidence',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.ai-drafts.generate',
    routePattern: '/api/v1/organizations/:organizationId/okrs/ai-drafts',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.ai-drafts.confirm',
    routePattern: '/api/v1/organizations/:organizationId/okrs/ai-drafts/confirm',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.backflow.suggestions.list',
    routePattern: '/api/v1/organizations/:organizationId/okrs/backflow/suggestions',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.backflow.suggestions.show',
    routePattern: '/api/v1/organizations/:organizationId/okrs/backflow/suggestions/:suggestionId',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.backflow.recalculate',
    routePattern: '/api/v1/organizations/:organizationId/okrs/backflow/recalculate',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.backflow.batch-recalculate',
    routePattern: '/api/v1/organizations/:organizationId/okrs/backflow/batch-recalculate',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.backflow.confirm',
    routePattern: '/api/v1/organizations/:organizationId/okrs/backflow/confirm',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.backflow.reject',
    routePattern: '/api/v1/organizations/:organizationId/okrs/backflow/reject',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.cascade-plans.create',
    routePattern: '/api/v1/organizations/:organizationId/okrs/cascade-plans',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.cascade-plans.list',
    routePattern: '/api/v1/organizations/:organizationId/okrs/cascade-plans',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.cascade-plans.show',
    routePattern: '/api/v1/organizations/:organizationId/okrs/cascade-plans/:planId',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.cascade-plans.confirm',
    routePattern: '/api/v1/organizations/:organizationId/okrs/cascade-plans/:planId/confirm',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.cascade-plans.reject',
    routePattern: '/api/v1/organizations/:organizationId/okrs/cascade-plans/:planId/reject',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.relations.create',
    routePattern: '/api/v1/organizations/:organizationId/okrs/relations',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.relations.list',
    routePattern: '/api/v1/organizations/:organizationId/okrs/relations',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.relations.show',
    routePattern: '/api/v1/organizations/:organizationId/okrs/relations/:relationId',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'PUT',
    routeName: 'organizations.okr.relations.update',
    routePattern: '/api/v1/organizations/:organizationId/okrs/relations/:relationId',
    permission: ORG_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.relations.archive',
    routePattern: '/api/v1/organizations/:organizationId/okrs/relations/:relationId/archive',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.health.show',
    routePattern: '/api/v1/organizations/:organizationId/okrs/objectives/:objectiveId/health',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.health.list',
    routePattern: '/api/v1/organizations/:organizationId/okrs/health',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.matrix',
    routePattern: '/api/v1/organizations/:organizationId/okrs/matrix',
    permission: PORTFOLIO_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.okr.ai-cascade-suggestions',
    routePattern: '/api/v1/organizations/:organizationId/okrs/ai-cascade-suggestions',
    permission: ORG_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.okr.dashboard.summary',
    routePattern: '/api/v1/organizations/:organizationId/okrs/dashboard',
    permission: PORTFOLIO_VIEW,
  },

  // 14. PMO 决策工作台
  {
    method: 'GET',
    routeName: 'organizations.decision-workbench.cases.index',
    routePattern: '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases',
    permission: PMO_DECISION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.decision-workbench.cases.store',
    routePattern: '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases',
    permission: PMO_DECISION_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.decision-workbench.cases.show',
    routePattern: '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId',
    permission: PMO_DECISION_VIEW,
  },
  {
    method: 'PUT',
    routeName: 'organizations.decision-workbench.cases.update',
    routePattern: '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId',
    permission: PMO_DECISION_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.decision-workbench.cases.transition',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/transition',
    permission: PMO_DECISION_DECIDE,
  },
  {
    method: 'GET',
    routeName: 'organizations.decision-workbench.options.index',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/options',
    permission: PMO_DECISION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.decision-workbench.options.store',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/options',
    permission: PMO_DECISION_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.decision-workbench.options.deactivate',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/options/deactivate',
    permission: PMO_DECISION_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.decision-workbench.positions.index',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/positions',
    permission: PMO_DECISION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.decision-workbench.positions.store',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/positions',
    permission: PMO_DECISION_MANAGE,
  },
  {
    method: 'POST',
    routeName: 'organizations.decision-workbench.evidence.refresh',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/evidence/refresh',
    permission: PMO_DECISION_MANAGE,
  },
  {
    method: 'GET',
    routeName: 'organizations.decision-workbench.evidence.snapshots',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/evidence/snapshots',
    permission: PMO_DECISION_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.decision-workbench.comparison.show',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/comparison',
    permission: PMO_DECISION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.decision-workbench.readiness.check',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/readiness',
    permission: PMO_DECISION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.decision-workbench.outcomes.store',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/outcomes',
    permission: PMO_DECISION_DECIDE,
  },
  {
    method: 'GET',
    routeName: 'organizations.decision-workbench.outcomes.index',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/outcomes',
    permission: PMO_DECISION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.decision-workbench.handoffs.store',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/handoffs',
    permission: PMO_DECISION_HANDOFF,
  },
  {
    method: 'GET',
    routeName: 'organizations.decision-workbench.handoffs.index',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/handoffs',
    permission: PMO_DECISION_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.decision-workbench.targets',
    routePattern: '/api/v1/organizations/:organizationId/pmo/decision-workbench/handoff-targets',
    permission: PMO_DECISION_VIEW,
  },
  {
    method: 'POST',
    routeName: 'organizations.decision-workbench.ai.narrative',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/ai/narrative',
    permission: PMO_DECISION_REQUEST_AI,
  },
  {
    method: 'POST',
    routeName: 'organizations.decision-workbench.lens.execute',
    routePattern:
      '/api/v1/organizations/:organizationId/pmo/decision-workbench/cases/:decisionId/plugin-lens',
    permission: PMO_DECISION_VIEW,
  },

  // 15. 资源争用检测
  {
    method: 'GET',
    routeName: 'organizations.resource-contentions.summary',
    routePattern: '/api/v1/organizations/:organizationId/resource-contentions/summary',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-contentions.items',
    routePattern: '/api/v1/organizations/:organizationId/resource-contentions/items',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-contentions.matrix',
    routePattern: '/api/v1/organizations/:organizationId/resource-contentions/matrix',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-contentions.detail',
    routePattern: '/api/v1/organizations/:organizationId/resource-contentions/:contentionId',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-contentions.evidence',
    routePattern:
      '/api/v1/organizations/:organizationId/resource-contentions/:contentionId/evidence',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-contentions.suggestions',
    routePattern:
      '/api/v1/organizations/:organizationId/resource-contentions/:contentionId/suggestions',
    permission: RESOURCE_VIEW,
  },

  // 16. 资源需求预测
  {
    method: 'GET',
    routeName: 'organizations.resource-demand-forecasting.summary',
    routePattern: '/api/v1/organizations/:organizationId/resource-demand-forecasting/summary',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-demand-forecasting.demand-curves',
    routePattern: '/api/v1/organizations/:organizationId/resource-demand-forecasting/demand-curves',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-demand-forecasting.gap-analysis',
    routePattern: '/api/v1/organizations/:organizationId/resource-demand-forecasting/gap-analysis',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-demand-forecasting.project-drivers',
    routePattern:
      '/api/v1/organizations/:organizationId/resource-demand-forecasting/project-drivers',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-demand-forecasting.skill-drivers',
    routePattern: '/api/v1/organizations/:organizationId/resource-demand-forecasting/skill-drivers',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-demand-forecasting.trend-baseline',
    routePattern:
      '/api/v1/organizations/:organizationId/resource-demand-forecasting/trend-baseline',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-demand-forecasting.drill-down',
    routePattern: '/api/v1/organizations/:organizationId/resource-demand-forecasting/drill-down',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-demand-forecasting.ai-advisory',
    routePattern: '/api/v1/organizations/:organizationId/resource-demand-forecasting/ai-advisory',
    permission: RESOURCE_VIEW,
  },

  // 17. 组织级资源缺口分析
  {
    method: 'GET',
    routeName: 'organizations.resource-gaps.summary',
    routePattern: '/api/v1/organizations/:organizationId/resource-gaps/summary',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-gaps.by-role',
    routePattern: '/api/v1/organizations/:organizationId/resource-gaps/by-role',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-gaps.by-skill',
    routePattern: '/api/v1/organizations/:organizationId/resource-gaps/by-skill',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-gaps.by-timebucket',
    routePattern: '/api/v1/organizations/:organizationId/resource-gaps/by-timebucket',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-gaps.by-project',
    routePattern: '/api/v1/organizations/:organizationId/resource-gaps/by-project',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-gaps.by-portfolio',
    routePattern: '/api/v1/organizations/:organizationId/resource-gaps/by-portfolio',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-gaps.explanation',
    routePattern: '/api/v1/organizations/:organizationId/resource-gaps/explanation',
    permission: AI_RESOURCE_GAP_EXPLAIN,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-gaps.drill-down',
    routePattern: '/api/v1/organizations/:organizationId/resource-gaps/drill-down',
    permission: RESOURCE_VIEW,
  },

  // 18. 组织资源池
  {
    method: 'GET',
    routeName: 'organizations.resource-pool.catalogue',
    routePattern: '/api/v1/organizations/:organizationId/resource-pool/catalogue',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-pool.summary',
    routePattern: '/api/v1/organizations/:organizationId/resource-pool/summary',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-pool.resources',
    routePattern: '/api/v1/organizations/:organizationId/resource-pool/resources',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-pool.skills',
    routePattern: '/api/v1/organizations/:organizationId/resource-pool/skills',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-pool.capacity',
    routePattern: '/api/v1/organizations/:organizationId/resource-pool/capacity',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-pool.conflicts',
    routePattern: '/api/v1/organizations/:organizationId/resource-pool/conflicts',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-pool.demand-gaps',
    routePattern: '/api/v1/organizations/:organizationId/resource-pool/demand-gaps',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organizations.resource-pool.drill-down',
    routePattern: '/api/v1/organizations/:organizationId/resource-pool/drill-down',
    permission: RESOURCE_VIEW,
  },

  // 19. 组织技能矩阵（路由名前缀为单数 organization）
  {
    method: 'GET',
    routeName: 'organization.resource-skill-matrix.summary',
    routePattern: '/api/v1/organizations/:organizationId/resource-skill-matrix/summary',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organization.resource-skill-matrix.matrix',
    routePattern: '/api/v1/organizations/:organizationId/resource-skill-matrix/matrix',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organization.resource-skill-matrix.coverage',
    routePattern: '/api/v1/organizations/:organizationId/resource-skill-matrix/coverage',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organization.resource-skill-matrix.gaps',
    routePattern: '/api/v1/organizations/:organizationId/resource-skill-matrix/gaps',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organization.resource-skill-matrix.candidates',
    routePattern: '/api/v1/organizations/:organizationId/resource-skill-matrix/candidates',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organization.resource-skill-matrix.skill-detail',
    routePattern: '/api/v1/organizations/:organizationId/resource-skill-matrix/skill-detail',
    permission: RESOURCE_VIEW,
  },
  {
    method: 'GET',
    routeName: 'organization.resource-skill-matrix.drill-down',
    routePattern: '/api/v1/organizations/:organizationId/resource-skill-matrix/drill-down',
    permission: RESOURCE_VIEW,
  },

  // 20. 战略执行驾驶舱
  {
    method: 'GET',
    routeName: 'organizations.strategy-execution-cockpit.show',
    routePattern: '/api/v1/organizations/:organizationId/strategy-execution-cockpit',
    permission: PORTFOLIO_VIEW,
  },
]
