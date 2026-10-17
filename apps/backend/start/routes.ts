/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'
import { authThrottle } from '#start/limiter'

const UsersController = () => import('#controllers/users_controller')
const OrganizationsController = () => import('#controllers/organizations_controller')
const OrganizationMembersController = () => import('#controllers/organization_members_controller')
const OrganizationSelectionController = () =>
  import('#controllers/organization_selection_controller')
const ProjectsController = () => import('#controllers/projects_controller')
const ProjectMembersController = () => import('#controllers/project_members_controller')
const ProjectDashboardController = () => import('#controllers/project_dashboard_controller')
const ProjectHealthRiskCommandCenterController = () =>
  import('#controllers/project_health_risk_command_center_controller')
const ProjectTimelineController = () => import('#controllers/project_timeline_controller')
const TasksController = () => import('#controllers/tasks_controller')
const KanbanController = () => import('#controllers/kanban_controller')
const TaskListViewController = () => import('#controllers/task_list_view_controller')
const TaskCalendarController = () => import('#controllers/task_calendar_controller')
const WbsNodesController = () => import('#controllers/wbs_nodes_controller')
const TaskDependenciesController = () => import('#controllers/task_dependencies_controller')
const GanttSchedulingController = () => import('#controllers/gantt_scheduling_controller')
const GanttBaselinesController = () => import('#controllers/gantt_baselines_controller')
const MilestonesController = () => import('#controllers/milestones_controller')
const AiM0Controller = () => import('#controllers/ai_m0_controller')
const AiM0EvaluationsController = () => import('#controllers/ai_m0_evaluations_controller')
const AiConnectionsController = () => import('#controllers/ai_connections_controller')
const CalendarDisplayController = () => import('#controllers/calendar_display_controller')
const CopilotWebSearchSettingsController = () =>
  import('#controllers/copilot_web_search_settings_controller')
const AiModelCatalogController = () => import('#controllers/ai_model_catalog_controller')
const AiModelPricingController = () => import('#controllers/ai_model_pricing_controller')
const AiOcrController = () => import('#controllers/ai_ocr_controller')
const AiProjectIntentsController = () => import('#controllers/ai_project_intents_controller')
const AiLiveOutputController = () => import('#controllers/ai_live_output_controller')
const AiProjectDraftsController = () => import('#controllers/ai_project_drafts_controller')
const AuditLogsController = () => import('#controllers/audit_logs_controller')
const RisksController = () => import('#controllers/risks_controller')
const ResourcesController = () => import('#controllers/resources_controller')
const ResourceAllocationsController = () => import('#controllers/resource_allocations_controller')
const DevOnlyMiddleware = () => import('#middleware/dev_only_middleware')
const ChangeRequestsController = () => import('#controllers/change_requests_controller')
const ChangeImpactController = () => import('#controllers/change_impact_controller')
const ProjectFilesController = () => import('#controllers/project_files_controller')
const ProjectAttachmentsController = () => import('#controllers/project_attachments_controller')
const DiagramsController = () => import('#controllers/diagrams_controller')
const ReportsController = () => import('#controllers/reports_controller')
const ReportV2Controller = () => import('#controllers/report_v2_controller')
const NotificationsController = () => import('#controllers/notifications_controller')
const CommentsController = () => import('#controllers/comments_controller')
const CustomViewsController = () => import('#controllers/custom_views_controller')
const CompilerController = () => import('#controllers/compiler_controller')
const CompilerTemplateController = () => import('#controllers/compiler_template_controller')
const RiskV2Controller = () => import('#controllers/risk_v2_controller')
const FileV2Controller = () => import('#controllers/file_v2_controller')
const DraftLayerController = () => import('#controllers/draft_layer_controller')
const PeriodicReportController = () => import('#controllers/periodic_report_controller')
const TraceabilityController = () => import('#controllers/traceability_controller')
const IntegrationsController = () => import('#controllers/integrations_controller')
const WebhooksController = () => import('#controllers/webhooks_controller')
const SearchController = () => import('#controllers/search_controller')
const ProjectHealthDiagnosesController = () =>
  import('#controllers/project_health_diagnoses_controller')
const ContradictionsController = () => import('#controllers/contradictions_controller')
const ProjectPredictionsController = () => import('#controllers/project_predictions_controller')
const ProjectRecommendationsController = () =>
  import('#controllers/project_recommendations_controller')
const TaskExternalLinksController = () => import('#controllers/task_external_links_controller')
const LinkCandidatesController = () => import('#controllers/link_candidates_controller')
const TrizCompilerAnalysisController = () =>
  import('#controllers/triz_compiler_analysis_controller')
const CompilerRoutingController = () => import('#controllers/compiler_routing_controller')
const CompilerConfigController = () => import('#controllers/compiler_config_controller')
const CompilerCacheController = () => import('#controllers/compiler_cache_controller')
const CompilerSkillsController = () => import('#controllers/compiler_skills_controller')
const SkillKnowledgeAuthoringController = () =>
  import('#controllers/skill_knowledge_authoring_controller')
const TrizDecisionLogController = () => import('#controllers/triz_decision_log_controller')
const TrizRationaleController = () => import('#controllers/triz_rationale_controller')
const TrizInnovationController = () => import('#controllers/triz_innovation_controller')
const KnowledgeController = () => import('#controllers/knowledge_controller')
const OrganizationResourcePoolController = () =>
  import('#controllers/organization_resource_pool_controller')
const ResourceDemandForecastingController = () =>
  import('#controllers/resource_demand_forecasting_controller')
const ResourceContentionDetectionController = () =>
  import('#controllers/resource_contention_detection_controller')
const ResourceGapAnalysisController = () => import('#controllers/resource_gap_analysis_controller')
const CrossProjectAllocationController = () =>
  import('#controllers/cross_project_allocation_controller')
// v3-resource-capacity-forecasting-closed-loop —— 组织级容量闭环
const ResourceCapacityLoopController = () =>
  import('#controllers/resource_capacity_loop_controller')
const OkrController = () => import('#controllers/okr_controller')
const OkrProgressBackflowController = () => import('#controllers/okr_progress_backflow_controller')
const OkrDashboardController = () => import('#controllers/okr_dashboard_controller')
const MultiProjectDependenciesController = () =>
  import('#controllers/multi_project_dependencies_controller')
const MultiProjectImpactAnalysisController = () =>
  import('#controllers/multi_project_impact_analysis_controller')
const PhysicalContradictionAnalyzerController = () =>
  import('#controllers/physical_contradiction_analyzer_controller')
const TechnicalContradictionAnalyzerController = () =>
  import('#controllers/triz_technical_contradiction_analyzer_controller')
const TrizResourceAnalyzerController = () =>
  import('#controllers/triz_resource_analyzer_controller')
const TrizEvolutionTrendAnalysisController = () =>
  import('#controllers/triz_evolution_trend_analysis_controller')
const OcrReviewController = () => import('#controllers/ocr_review_controller')
const OcrDocumentJobsController = () => import('#controllers/ocr_document_jobs_controller')
const OcrRetentionController = () => import('#controllers/ocr_retention_controller')
const OcrDocumentSearchIndexController = () =>
  import('#controllers/ocr_document_search_index_controller')
const DocumentSearchController = () => import('#controllers/document_search_controller')
const OcrProviderObservabilityController = () =>
  import('#controllers/ocr_provider_observability_controller')
const TrizPmPhaseIntegrationController = () =>
  import('#controllers/triz_pm_phase_integration_controller')
const TrizAssistantController = () => import('#controllers/triz_assistant_controller')
const TrizFunctionAnalysisController = () =>
  import('#controllers/triz_function_analysis_controller')
const TrizContradictionMatrixController = () =>
  import('#controllers/triz_contradiction_matrix_controller')

const TrizDecisionCenterController = () => import('#controllers/triz_decision_center_controller')
const TrizDeliveryLoopController = () => import('#controllers/triz_delivery_loop_controller')
const TrizIfrVisualizationController = () =>
  import('#controllers/triz_ifr_visualization_controller')
const TrizSkillLayerController = () => import('#controllers/triz_skill_layer_controller')
// v3-triz-contradiction-copilot（W2）—— 矛盾求解对话流（新轨）
const TrizCopilotAnalysesController = () => import('#controllers/triz_copilot_analyses_controller')
// v3-triz-contradiction-copilot（W3）—— 被动雷达信号（新轨，独立于既有预测/推荐端点）
const ProjectSignalsController = () => import('#controllers/project_signals_controller')
// v3-triz-contradiction-copilot（W4）—— 分馆产物 CRUD 与只读查询（新轨，独立于既有 TRIZ 端点）
const TrizGalleryArtifactsController = () =>
  import('#controllers/triz_gallery_artifacts_controller')
const TrizGalleryController = () => import('#controllers/triz_gallery_controller')
const DocumentInlineCommentsController = () =>
  import('#controllers/document_inline_comments_controller')
const OcrStructuredExtractionController = () =>
  import('#controllers/ocr_structured_extraction_controller')
const OcrEntityLinkingController = () => import('#controllers/ocr_entity_linking_controller')
const OcrPrivacyController = () => import('#controllers/ocr_privacy_controller')
const OcrPermissionAuditController = () => import('#controllers/ocr_permission_audit_controller')
const OcrBatchQueueController = () => import('#controllers/ocr_batch_queue_controller')
const DocumentIntelligenceController = () => import('#controllers/document_intelligence_controller')
const CodegenCandidateRunController = () => import('#controllers/codegen_candidate_run_controller')
const TwoFactorController = () => import('#controllers/two_factor_controller')

router.get('/', () => {
  return { hello: 'world' }
})

// 健康检查端点（T050 local-release-runbook）
// 三端点语义分离：综合 / 就绪 / 存活，保持公开无认证（D2/D4/D8）。
router.get('/api/v1/health', [controllers.Health, 'index']).as('health.index')
router.get('/api/v1/health/ready', [controllers.Health, 'ready']).as('health.ready')
router.get('/api/v1/health/live', [controllers.Health, 'live']).as('health.live')

// 知识与记忆运营层（v3-knowledge-memory-operating-layer）—— 只读 GET endpoint。
// 路由无条件注册；feature flag 关闭时由 controller 前置 short-circuit 返回
// `FEATURE_NOT_ENABLED` 并且**零 adapter 调用**（任务 §4.1/§4.2）。
// 启动期 gate 会把 flag 固化在 boot 时刻，无法按请求验证 on/off 两条路径，故不采用。
const KnowledgeMemoryOperatingController = () =>
  import('#controllers/knowledge_memory_operating_controller')
router
  .group(() => {
    router
      .get('/summary', [KnowledgeMemoryOperatingController, 'summary'])
      .as('knowledge_memory_operating.summary')
    router
      .get('/items', [KnowledgeMemoryOperatingController, 'listItems'])
      .as('knowledge_memory_operating.items.index')
    router
      .get('/items/:kind/:scopedRef', [KnowledgeMemoryOperatingController, 'showItem'])
      .as('knowledge_memory_operating.items.show')
    router
      .get('/items/:kind/:scopedRef/surfaces/:surface', [
        KnowledgeMemoryOperatingController,
        'showItemSurface',
      ])
      .as('knowledge_memory_operating.items.surface')
  })
  .prefix('/api/v1/knowledge-memory')
  .use(middleware.auth())

// 前端 AI 使用事件接收端点（v3-frontend-ai-usage-telemetry）
const FrontendTelemetryController = () => import('#controllers/frontend_telemetry_controller')
router
  .post('/api/v1/frontend-telemetry', [FrontendTelemetryController, 'store'])
  .as('frontend-telemetry.store')
router
  .get('/api/v1/frontend-telemetry/aggregate', [FrontendTelemetryController, 'aggregate'])
  .as('frontend-telemetry.aggregate')

router
  .group(() => {
    router
      .group(() => {
        // TODO-DEBT: signup 别名保留一个迭代，用于前端兼容，后续移除。
        router.post('signup', [controllers.Auth, 'register']).as('auth.signup')
        router.post('register', [controllers.Auth, 'register']).as('auth.register')
        router.post('login', [controllers.Auth, 'login']).as('auth.login')
        // 登录第二步：兑换 2FA 挑战票据。必须与 login 同组（未认证 + authThrottle）——
        // 会话正是它要产出的东西，挂 middleware.auth() 会让整条链路自锁。
        router
          .post('login/two-factor', [controllers.Auth, 'loginTwoFactor'])
          .as('auth.login.twoFactor')
        // 登录期绑定（enrollment-at-login）：取二维码 / 暂时跳过。
        router
          .post('login/two-factor/enrollment', [controllers.Auth, 'loginTwoFactorEnrollment'])
          .as('auth.login.twoFactor.enrollment')
        router
          .post('login/two-factor/skip', [controllers.Auth, 'loginTwoFactorSkip'])
          .as('auth.login.twoFactor.skip')
        router.get('google/config', [controllers.Auth, 'googleConfig']).as('auth.google.config')
        router
          .get('google/authorize', [controllers.Auth, 'googleAuthorize'])
          .as('auth.google.authorize')
        router
          .get('google/callback', [controllers.Auth, 'googleCallback'])
          .as('auth.google.callback')
        router.post('refresh', [controllers.Auth, 'refresh']).as('auth.refresh')
      })
      .prefix('auth')
      .as('auth')
      .use(authThrottle)

    router
      .group(() => {
        router.get('me', [controllers.Auth, 'me']).as('auth.me')
      })
      .prefix('auth')
      .use(middleware.auth())

    router
      .group(() => {
        // TODO-DEBT: /account/profile 临时别名，后续统一归并到 /api/v1/users/me。
        router.get('profile', [controllers.Auth, 'me']).as('auth.profile')
        router.post('logout', [controllers.Auth, 'logout']).as('auth.logout')
        // v3-multitenant-tenant-identification §4.1：受保护的组织选择流程。
        // 与未认证的 `auth/refresh?organizationId=` 旧路径并存：后者保留兼容，
        // 新路径带 owner fallback 与统一 404 非泄露语义。
        router
          .get('organization-selection', [OrganizationSelectionController, 'show'])
          .as('organizationSelection.show')
        router
          .post('organization-selection', [OrganizationSelectionController, 'store'])
          .as('organizationSelection.store')

        // 两步验证自助管理（仅当前会话用户本人；无按 userId 操作他人的入口）。
        router.get('two-factor', [TwoFactorController, 'show']).as('twoFactor.show')
        router.post('two-factor/setup', [TwoFactorController, 'setup']).as('twoFactor.setup')
        router.post('two-factor/confirm', [TwoFactorController, 'confirm']).as('twoFactor.confirm')
        router.post('two-factor/disable', [TwoFactorController, 'disable']).as('twoFactor.disable')
        router
          .post('two-factor/recovery-codes', [TwoFactorController, 'regenerateRecoveryCodes'])
          .as('twoFactor.recoveryCodes')
      })
      .prefix('account')
      .as('account')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/', [UsersController, 'index']).as('users.index')
        router.post('/', [UsersController, 'store']).as('users.store')
        router.get('/:id', [UsersController, 'show']).as('users.show')
        // 管理员代为重置他人两步验证（高风险兜底；本项目无邮件设施，只能人工核身）。
        // 权限门在 controller 内显式判 system:admin。
        router
          .post('/:id/two-factor/reset', [TwoFactorController, 'adminReset'])
          .as('users.twoFactor.reset')
        router.put('/:id', [UsersController, 'update']).as('users.update')
        router.delete('/:id', [UsersController, 'destroy']).as('users.destroy')
      })
      .prefix('users')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/', [ProjectsController, 'index']).as('projects.index')
        router.post('/', [ProjectsController, 'store']).as('projects.store')
        router.get('/:id', [ProjectsController, 'show']).as('projects.show')
        router.patch('/:id', [ProjectsController, 'update']).as('projects.update')
        router
          .get('/:id/working-calendar', [ProjectsController, 'workingCalendar'])
          .as('projects.working-calendar.show')
        router
          .patch('/:id/working-calendar', [ProjectsController, 'updateWorkingCalendar'])
          .as('projects.working-calendar.update')
        router.delete('/:id', [ProjectsController, 'destroy']).as('projects.destroy')
        router.post('/:id/archive', [ProjectsController, 'archive']).as('projects.archive')
        router.post('/:id/restore', [ProjectsController, 'restore']).as('projects.restore')
        router.get('/:id/dashboard', [ProjectDashboardController, 'show']).as('projects.dashboard')
        // v3-project-health-risk-command-center —— 项目健康风险指挥中心只读聚合
        router
          .get('/:id/health-risk-command-center', [
            ProjectHealthRiskCommandCenterController,
            'show',
          ])
          .as('projects.health-risk-command-center.show')
        router.get('/:id/timeline', [ProjectTimelineController, 'index']).as('projects.timeline')

        router.get('/:id/members', [ProjectMembersController, 'index']).as('projects.members.index')
        router.get('/:id/roles', [ProjectMembersController, 'roles']).as('projects.roles.index')
        router
          .get('/:id/my-permissions', [ProjectMembersController, 'myPermissions'])
          .as('projects.my-permissions')
        router
          .post('/:id/members', [ProjectMembersController, 'store'])
          .as('projects.members.store')
        router
          .post('/:id/members/invite', [ProjectMembersController, 'invite'])
          .as('projects.members.invite')
        router
          .patch('/:id/members/:userId', [ProjectMembersController, 'update'])
          .as('projects.members.update')
        router
          .delete('/:id/members/:userId', [ProjectMembersController, 'destroy'])
          .as('projects.members.destroy')
        router
          .post('/:id/transfer-owner', [ProjectMembersController, 'transfer'])
          .as('projects.transfer')
      })
      .prefix('projects')
      .use(middleware.auth())

    // 任务：嵌套于 /projects/:projectId/tasks（spec task-management）
    // update/status 路由的行级权限（task:update vs task:update:self）由 controller 经 TaskPolicy 判定，
    // 不在 rbac 中间件层挂权限（OR 语义单一权限无法表达）。
    router
      .group(() => {
        router.get('/', [TasksController, 'index']).as('projects.tasks.index')
        router.post('/', [TasksController, 'store']).as('projects.tasks.store')
        router.post('/batch', [TasksController, 'batch']).as('projects.tasks.batch')
        // 看板「在此列新建任务」：一句话 → AI 补全任务卡草稿（不落库）
        router
          .post('/ai-draft', [() => import('#controllers/task_ai_drafts_controller'), 'store'])
          .as('projects.tasks.ai-draft')
        // 日历快速新建：选日期 + 原地输入 → AI 补全成可直接建的任务行（不落库）
        router
          .post('/calendar-suggest', [
            () => import('#controllers/calendar_quick_creates_controller'),
            'store',
          ])
          .as('projects.tasks.calendar-suggest')
        router.get('/recycle-bin', [TasksController, 'recycleBin']).as('projects.tasks.recycle-bin')
        router.get('/role-hints', [TasksController, 'roleHints']).as('projects.tasks.role-hints')
        router
          .post('/batch-restore', [TasksController, 'batchRestore'])
          .as('projects.tasks.batch-restore')
        router.get('/:taskId', [TasksController, 'show']).as('projects.tasks.show')
        router.patch('/:taskId', [TasksController, 'update']).as('projects.tasks.update')
        router.delete('/:taskId', [TasksController, 'destroy']).as('projects.tasks.destroy')
        router.post('/:taskId/restore', [TasksController, 'restore']).as('projects.tasks.restore')
        router.post('/:taskId/status', [TasksController, 'status']).as('projects.tasks.status')
        router
          .get('/:taskId/dependencies', [TaskDependenciesController, 'index'])
          .as('projects.tasks.dependencies.index')
        router
          .post('/:taskId/dependencies', [TaskDependenciesController, 'store'])
          .as('projects.tasks.dependencies.store')
        // v2-github-gitlab-light-links —— 任务外部链接
        router
          .get('/:taskId/external-links', [TaskExternalLinksController, 'index'])
          .as('projects.tasks.external-links.index')
        router
          .post('/:taskId/external-links', [TaskExternalLinksController, 'create'])
          .as('projects.tasks.external-links.store')
        router
          .put('/:taskId/external-links/:linkId', [TaskExternalLinksController, 'update'])
          .as('projects.tasks.external-links.update')
        router
          .delete('/:taskId/external-links/:linkId', [TaskExternalLinksController, 'destroy'])
          .as('projects.tasks.external-links.destroy')
        router
          .post('/:taskId/external-links/:linkId/refresh', [TaskExternalLinksController, 'refresh'])
          .as('projects.tasks.external-links.refresh')

        // v2-5-code-repository-auto-linking —— 链接候选
        router
          .get('/:taskId/link-candidates', [LinkCandidatesController, 'index'])
          .as('projects.tasks.link-candidates.index')
        router
          .post('/:taskId/link-candidates/:candidateId/confirm', [
            LinkCandidatesController,
            'confirm',
          ])
          .as('projects.tasks.link-candidates.confirm')
        router
          .post('/:taskId/link-candidates/:candidateId/ignore', [
            LinkCandidatesController,
            'ignore',
          ])
          .as('projects.tasks.link-candidates.ignore')
      })
      .prefix('/projects/:projectId/tasks')
      .use(middleware.auth())

    router
      .get('/projects/:projectId/dependencies', [TaskDependenciesController, 'projectIndex'])
      .as('projects.dependencies.index')
      .use(middleware.auth())

    router
      .delete('/dependencies/:id', [TaskDependenciesController, 'destroy'])
      .as('dependencies.destroy')
      .use(middleware.auth())

    router
      .post('/projects/:projectId/gantt/schedule', [GanttSchedulingController, 'schedule'])
      .as('projects.gantt.schedule')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/', [GanttBaselinesController, 'show']).as('projects.gantt-baseline.show')
        router.post('/', [GanttBaselinesController, 'store']).as('projects.gantt-baseline.store')
      })
      .prefix('/projects/:projectId/gantt/baseline')
      .use(middleware.auth())

    // v2-ai-project-health-diagnosis —— 项目健康诊断
    router
      .group(() => {
        router
          .get('/latest', [ProjectHealthDiagnosesController, 'latest'])
          .as('projects.health-diagnoses.latest')
        router
          .get('/', [ProjectHealthDiagnosesController, 'index'])
          .as('projects.health-diagnoses.index')
        router
          .post('/', [ProjectHealthDiagnosesController, 'store'])
          .as('projects.health-diagnoses.store')
        router
          .post('/refresh', [ProjectHealthDiagnosesController, 'refresh'])
          .as('projects.health-diagnoses.refresh')
        router
          .get('/:id', [ProjectHealthDiagnosesController, 'show'])
          .as('projects.health-diagnoses.show')
        router
          .post('/:id/ai-draft', [ProjectHealthDiagnosesController, 'generateAiDraft'])
          .as('projects.health-diagnoses.ai-draft')
        router
          .post('/:id/confirm', [ProjectHealthDiagnosesController, 'confirm'])
          .as('projects.health-diagnoses.confirm')
        router
          .post('/:id/reject', [ProjectHealthDiagnosesController, 'reject'])
          .as('projects.health-diagnoses.reject')
        router
          .post('/:id/confirm-stale', [ProjectHealthDiagnosesController, 'confirmStale'])
          .as('projects.health-diagnoses.confirm-stale')
      })
      .prefix('/projects/:projectId/health-diagnoses')
      .use(middleware.auth())

    // v2-triz-contradiction-model-foundation —— TRIZ 矛盾模型基础层
    router
      .group(() => {
        router.get('/', [ContradictionsController, 'index']).as('projects.contradictions.index')
        router
          .post('/refresh', [ContradictionsController, 'refresh'])
          .as('projects.contradictions.refresh')
        router
          .get('/:contradictionId', [ContradictionsController, 'show'])
          .as('projects.contradictions.show')
        router
          .post('/:contradictionId/confirm', [ContradictionsController, 'confirm'])
          .as('projects.contradictions.confirm')
        router
          .post('/:contradictionId/dismiss', [ContradictionsController, 'dismiss'])
          .as('projects.contradictions.dismiss')
        router
          .post('/:contradictionId/explain', [ContradictionsController, 'explain'])
          .as('projects.contradictions.explain')
      })
      .prefix('/projects/:projectId/contradictions')
      .use(middleware.auth())

    // v2-triz-decision-log-traceability —— TRIZ 决策日志
    router
      .group(() => {
        router
          .get('/', [TrizDecisionLogController, 'index'])
          .as('projects.triz-decision-logs.index')
        router
          .get('/subject-lookup', [TrizDecisionLogController, 'subjectLookup'])
          .as('projects.triz-decision-logs.subject-lookup')
        router
          .post('/draft-reason', [TrizDecisionLogController, 'draftReason'])
          .as('projects.triz-decision-logs.draft-reason')
        router
          .get('/:decisionLogId', [TrizDecisionLogController, 'show'])
          .as('projects.triz-decision-logs.show')
        router
          .post('/', [TrizDecisionLogController, 'store'])
          .as('projects.triz-decision-logs.store')
        router
          .post('/:decisionLogId/supersede', [TrizDecisionLogController, 'supersede'])
          .as('projects.triz-decision-logs.supersede')
      })
      .prefix('/projects/:projectId/triz-decision-logs')
      .use(middleware.auth())

    // v3-triz-decision-center —— TRIZ 决策中心
    router
      .group(() => {
        router
          .get('/summary', [TrizDecisionCenterController, 'summary'])
          .as('projects.triz-decision-center.summary')
        router
          .get('/items', [TrizDecisionCenterController, 'index'])
          .as('projects.triz-decision-center.items.index')
        router
          .get('/items/:itemId', [TrizDecisionCenterController, 'show'])
          .as('projects.triz-decision-center.items.show')
        router
          .get('/readiness', [TrizDecisionCenterController, 'readiness'])
          .as('projects.triz-decision-center.readiness')
      })
      .prefix('/projects/:projectId/triz-decision-center')
      .use(middleware.auth())

    // v3-triz-to-delivery-closed-loop —— TRIZ 到交付闭环
    // 路由无条件注册；feature flag 关闭时 controller 内 short-circuit 返回 404 非泄露。
    router
      .group(() => {
        router
          .get('/summary', [TrizDeliveryLoopController, 'summary'])
          .as('projects.triz.delivery-loop.summary')
        router
          .get('/items', [TrizDeliveryLoopController, 'index'])
          .as('projects.triz.delivery-loop.items')
        router
          .get('/items/:itemId', [TrizDeliveryLoopController, 'show'])
          .as('projects.triz.delivery-loop.item-detail')
        router
          .get('/items/:itemId/ready', [TrizDeliveryLoopController, 'showReadiness'])
          .as('projects.triz.delivery-loop.item-ready')
        router
          .post('/links/preview', [TrizDeliveryLoopController, 'linksPreview'])
          .as('projects.triz.delivery-loop.links-preview')
        router
          .post('/links/confirm', [TrizDeliveryLoopController, 'linksConfirm'])
          .as('projects.triz.delivery-loop.links-confirm')
        router
          .post('/items/:itemId/verifications', [TrizDeliveryLoopController, 'storeVerification'])
          .as('projects.triz.delivery-loop.verifications')
        router
          .post('/items/:itemId/reopen', [TrizDeliveryLoopController, 'storeReopen'])
          .as('projects.triz.delivery-loop.reopen')
      })
      .prefix('/projects/:projectId/triz/delivery-loop')
      .use(middleware.auth())

    // v3-triz-ifr-visualization —— TRIZ IFR 可视化
    router
      .group(() => {
        router
          .get('/preview', [TrizIfrVisualizationController, 'preview'])
          .as('projects.triz-ifr-visualizations.preview')
        router
          .get('/', [TrizIfrVisualizationController, 'index'])
          .as('projects.triz-ifr-visualizations.index')
        router
          .get('/:ifrId', [TrizIfrVisualizationController, 'show'])
          .as('projects.triz-ifr-visualizations.show')
        router
          .post('/', [TrizIfrVisualizationController, 'save'])
          .as('projects.triz-ifr-visualizations.save')
        router
          .post('/ai-draft', [TrizIfrVisualizationController, 'aiDraft'])
          .as('projects.triz-ifr-visualizations.ai-draft')
        router
          .get('/:ifrId/freshness', [TrizIfrVisualizationController, 'freshness'])
          .as('projects.triz-ifr-visualizations.freshness')
        router
          .post('/:ifrId/handoff-preview', [TrizIfrVisualizationController, 'handoffPreview'])
          .as('projects.triz-ifr-visualizations.handoff-preview')
        router
          .post('/:ifrId/handoff-candidate', [TrizIfrVisualizationController, 'handoffCandidate'])
          .as('projects.triz-ifr-visualizations.handoff-candidate')
      })
      .prefix('/projects/:projectId/triz/ifr-visualizations')
      .use(middleware.auth())

    // v2-triz-recommendation-rationale-ui —— TRIZ 推荐理由
    router
      .group(() => {
        router
          .get('/:targetType/:targetId', [TrizRationaleController, 'show'])
          .as('projects.triz-rationale.show')
        router
          .post('/:targetType/:targetId/feedback', [TrizRationaleController, 'feedback'])
          .as('projects.triz-rationale.feedback')
        router
          .post('/:targetType/:targetId/handoff', [TrizRationaleController, 'handoff'])
          .as('projects.triz-rationale.handoff')
      })
      .prefix('/projects/:projectId/triz-rationale')
      .use(middleware.auth())

    // v3-triz-innovation-workbench —— TRIZ 创新工作台
    router
      .group(() => {
        router
          .get('/sources', [TrizInnovationController, 'sourcesIndex'])
          .as('projects.triz-workbench.sources')
        router
          .get('/schemes', [TrizInnovationController, 'index'])
          .as('projects.triz-workbench.schemes.index')
        router
          .post('/schemes', [TrizInnovationController, 'store'])
          .as('projects.triz-workbench.schemes.store')
        router
          .get('/schemes/:schemeId', [TrizInnovationController, 'show'])
          .as('projects.triz-workbench.schemes.show')
        router
          .patch('/schemes/:schemeId', [TrizInnovationController, 'update'])
          .as('projects.triz-workbench.schemes.update')
        router
          .post('/schemes/:schemeId/abandon', [TrizInnovationController, 'abandon'])
          .as('projects.triz-workbench.schemes.abandon')
        router
          .post('/schemes/:schemeId/options', [TrizInnovationController, 'addOption'])
          .as('projects.triz-workbench.options.store')
        router
          .delete('/schemes/:schemeId/options/:optionId', [
            TrizInnovationController,
            'removeOption',
          ])
          .as('projects.triz-workbench.options.destroy')
        router
          .post('/schemes/:schemeId/comparison', [TrizInnovationController, 'compare'])
          .as('projects.triz-workbench.comparison')
        router
          .post('/schemes/:schemeId/narrative', [TrizInnovationController, 'generateNarrative'])
          .as('projects.triz-workbench.narrative')
        router
          .post('/schemes/:schemeId/draft-handoff', [TrizInnovationController, 'draftHandoff'])
          .as('projects.triz-workbench.draft-handoff')
      })
      .prefix('/projects/:projectId/triz-workbench')
      .use(middleware.auth())

    // v3-triz-contradiction-copilot（W2）—— 矛盾求解对话流（新轨，独立于既有 TRIZ 端点）
    router
      .group(() => {
        router
          .post('/', [TrizCopilotAnalysesController, 'store'])
          .as('projects.triz-copilot.analyses.store')
        router
          .get('/', [TrizCopilotAnalysesController, 'index'])
          .as('projects.triz-copilot.analyses.index')
        router
          .get('/:analysisId', [TrizCopilotAnalysesController, 'show'])
          .as('projects.triz-copilot.analyses.show')
        router
          .post('/:analysisId/override', [TrizCopilotAnalysesController, 'override'])
          .as('projects.triz-copilot.analyses.override')
      })
      .prefix('/projects/:projectId/triz-copilot/analyses')
      .use(middleware.auth())

    // v3-triz-contradiction-copilot（W3）—— 被动雷达信号（只读列表 + 状态流转；业务表零写入）
    router
      .group(() => {
        router.get('/', [ProjectSignalsController, 'index']).as('projects.signals.index')
        router
          .post('/:signalId/dismiss', [ProjectSignalsController, 'dismiss'])
          .as('projects.signals.dismiss')
        router
          .post('/:signalId/adopt', [ProjectSignalsController, 'adopt'])
          .as('projects.signals.adopt')
        router.post('/detect', [ProjectSignalsController, 'detect']).as('projects.signals.detect')
      })
      .prefix('/projects/:projectId/signals')
      .use(middleware.auth())

    // v3-triz-copilot-followups（B5）—— 参数只读投影端点（零写）
    router
      .group(() => {
        router
          .get('/parameters', [TrizCopilotAnalysesController, 'parameters'])
          .as('projects.triz-copilot.parameters')
      })
      .prefix('/projects/:projectId/triz-copilot')
      .use(middleware.auth())

    // v3-triz-contradiction-copilot（W4）—— 分馆产物 CRUD（读 project:view / 写 diagram:manage）
    router
      .group(() => {
        router
          .get('/', [TrizGalleryArtifactsController, 'index'])
          .as('projects.triz-gallery-artifacts.index')
        router
          .post('/', [TrizGalleryArtifactsController, 'store'])
          .as('projects.triz-gallery-artifacts.store')
        router
          .get('/:artifactId', [TrizGalleryArtifactsController, 'show'])
          .as('projects.triz-gallery-artifacts.show')
        router
          .get('/:artifactId/versions', [TrizGalleryArtifactsController, 'versions'])
          .as('projects.triz-gallery-artifacts.versions')
        router
          .patch('/:artifactId', [TrizGalleryArtifactsController, 'update'])
          .as('projects.triz-gallery-artifacts.update')
        router
          .delete('/:artifactId', [TrizGalleryArtifactsController, 'destroy'])
          .as('projects.triz-gallery-artifacts.destroy')
      })
      .prefix('/projects/:projectId/triz-gallery-artifacts')
      .use(middleware.auth())

    // v3-triz-contradiction-copilot（W4）—— 分馆只读查询（矩阵参数对 / 预填脚手架；零写）
    router
      .group(() => {
        router
          .get('/matrix-principles', [TrizGalleryController, 'matrixPrinciples'])
          .as('projects.triz-gallery.matrix-principles')
        router
          .get('/prefill', [TrizGalleryController, 'prefillDraft'])
          .as('projects.triz-gallery.prefill')
      })
      .prefix('/projects/:projectId/triz-gallery')
      .use(middleware.auth())

    // v3-triz-physical-contradiction-analyzer —— 物理矛盾分析
    router
      .group(() => {
        router
          .post('/', [PhysicalContradictionAnalyzerController, 'create'])
          .as('projects.physical-contradiction-analyses.create')
        router
          .get('/', [PhysicalContradictionAnalyzerController, 'index'])
          .as('projects.physical-contradiction-analyses.index')
        router
          .get('/:runId', [PhysicalContradictionAnalyzerController, 'show'])
          .as('projects.physical-contradiction-analyses.show')
        router
          .get('/:runId/candidates', [PhysicalContradictionAnalyzerController, 'candidates'])
          .as('projects.physical-contradiction-analyses.candidates')
        router
          .post('/:runId/candidates/:candidateKey/explain', [
            PhysicalContradictionAnalyzerController,
            'explain',
          ])
          .as('projects.physical-contradiction-analyses.explain')
        router
          .post('/:runId/candidates/:candidateKey/review', [
            PhysicalContradictionAnalyzerController,
            'review',
          ])
          .as('projects.physical-contradiction-analyses.review')
        router
          .post('/:runId/candidates/:candidateKey/confirmation-preview', [
            PhysicalContradictionAnalyzerController,
            'confirmationPreview',
          ])
          .as('projects.physical-contradiction-analyses.confirmation-preview')
        router
          .post('/:runId/candidates/:candidateKey/handoff-preview', [
            PhysicalContradictionAnalyzerController,
            'handoffPreview',
          ])
          .as('projects.physical-contradiction-analyses.handoff-preview')
      })
      .prefix('/projects/:projectId/triz/physical-contradiction-analyses')
      .use(middleware.auth())

    // v3-triz-technical-contradiction-analyzer —— 技术矛盾分析
    router
      .group(() => {
        router
          .post('/', [TechnicalContradictionAnalyzerController, 'create'])
          .as('projects.technical-contradiction-analyses.create')
        router
          .get('/', [TechnicalContradictionAnalyzerController, 'index'])
          .as('projects.technical-contradiction-analyses.index')
        router
          .get('/:runId', [TechnicalContradictionAnalyzerController, 'show'])
          .as('projects.technical-contradiction-analyses.show')
        router
          .get('/:runId/candidates', [TechnicalContradictionAnalyzerController, 'candidates'])
          .as('projects.technical-contradiction-analyses.candidates')
        router
          .post('/:runId/candidates/:candidateId/explain', [
            TechnicalContradictionAnalyzerController,
            'explain',
          ])
          .as('projects.technical-contradiction-analyses.explain')
        router
          .post('/:runId/candidates/:candidateId/review', [
            TechnicalContradictionAnalyzerController,
            'review',
          ])
          .as('projects.technical-contradiction-analyses.review')
        router
          .post('/:runId/candidates/:candidateId/confirmation-preview', [
            TechnicalContradictionAnalyzerController,
            'confirmationPreview',
          ])
          .as('projects.technical-contradiction-analyses.confirmation-preview')
        router
          .post('/:runId/candidates/:candidateId/handoff-preview', [
            TechnicalContradictionAnalyzerController,
            'handoffPreview',
          ])
          .as('projects.technical-contradiction-analyses.handoff-preview')
      })
      .prefix('/projects/:projectId/triz/technical-contradiction-analyses')
      .use(middleware.auth())

    // v3-triz-resource-analyzer —— TRIZ 资源分析器
    router
      .group(() => {
        router
          .post('/', [TrizResourceAnalyzerController, 'create'])
          .as('projects.triz-resource-analyses.create')
        router
          .get('/', [TrizResourceAnalyzerController, 'index'])
          .as('projects.triz-resource-analyses.index')
        router
          .get('/:runId', [TrizResourceAnalyzerController, 'show'])
          .as('projects.triz-resource-analyses.show')
        router
          .get('/:runId/resources', [TrizResourceAnalyzerController, 'resources'])
          .as('projects.triz-resource-analyses.resources')
        router
          .get('/:runId/opportunities', [TrizResourceAnalyzerController, 'opportunities'])
          .as('projects.triz-resource-analyses.opportunities')
        router
          .post('/:runId/opportunities/:opportunityId/explain', [
            TrizResourceAnalyzerController,
            'explain',
          ])
          .as('projects.triz-resource-analyses.explain')
        router
          .post('/:runId/opportunities/:opportunityId/review', [
            TrizResourceAnalyzerController,
            'review',
          ])
          .as('projects.triz-resource-analyses.review')
        router
          .post('/:runId/opportunities/:opportunityId/workbench-preview', [
            TrizResourceAnalyzerController,
            'workbenchPreview',
          ])
          .as('projects.triz-resource-analyses.workbench-preview')
        router
          .post('/:runId/opportunities/:opportunityId/decision-preview', [
            TrizResourceAnalyzerController,
            'decisionPreview',
          ])
          .as('projects.triz-resource-analyses.decision-preview')
        router
          .post('/:runId/opportunities/:opportunityId/draft-preview', [
            TrizResourceAnalyzerController,
            'draftPreview',
          ])
          .as('projects.triz-resource-analyses.draft-preview')
        router
          .post('/:runId/opportunities/:opportunityId/resource-preview', [
            TrizResourceAnalyzerController,
            'resourcePreview',
          ])
          .as('projects.triz-resource-analyses.resource-preview')
      })
      .prefix('/projects/:projectId/triz/resource-analyses')
      .use(middleware.auth())

    // v3-triz-evolution-trend-analysis —— TRIZ 进化趋势分析
    router
      .group(() => {
        router
          .post('/', [TrizEvolutionTrendAnalysisController, 'create'])
          .as('projects.triz-evolution-trend-analyses.create')
        router
          .get('/', [TrizEvolutionTrendAnalysisController, 'index'])
          .as('projects.triz-evolution-trend-analyses.index')
        router
          .get('/:runId', [TrizEvolutionTrendAnalysisController, 'show'])
          .as('projects.triz-evolution-trend-analyses.show')
        router
          .get('/:runId/trends', [TrizEvolutionTrendAnalysisController, 'trends'])
          .as('projects.triz-evolution-trend-analyses.trends')
        router
          .get('/:runId/risks', [TrizEvolutionTrendAnalysisController, 'risks'])
          .as('projects.triz-evolution-trend-analyses.risks')
        router
          .get('/:runId/history', [TrizEvolutionTrendAnalysisController, 'history'])
          .as('projects.triz-evolution-trend-analyses.history')
        router
          .post('/:runId/risks/:riskId/explain', [TrizEvolutionTrendAnalysisController, 'explain'])
          .as('projects.triz-evolution-trend-analyses.explain')
        router
          .post('/:runId/risks/:riskId/review', [TrizEvolutionTrendAnalysisController, 'review'])
          .as('projects.triz-evolution-trend-analyses.review')
        router
          .post('/:runId/risks/:riskId/workbench-preview', [
            TrizEvolutionTrendAnalysisController,
            'workbenchPreview',
          ])
          .as('projects.triz-evolution-trend-analyses.workbench-preview')
        router
          .post('/:runId/risks/:riskId/decision-preview', [
            TrizEvolutionTrendAnalysisController,
            'decisionPreview',
          ])
          .as('projects.triz-evolution-trend-analyses.decision-preview')
        router
          .post('/:runId/risks/:riskId/draft-preview', [
            TrizEvolutionTrendAnalysisController,
            'draftPreview',
          ])
          .as('projects.triz-evolution-trend-analyses.draft-preview')
        router
          .post('/:runId/risks/:riskId/risk-preview', [
            TrizEvolutionTrendAnalysisController,
            'riskPreview',
          ])
          .as('projects.triz-evolution-trend-analyses.risk-preview')
      })
      .prefix('/projects/:projectId/triz/evolution-trend-analyses')
      .use(middleware.auth())

    // v3-triz-skill-layer-integration —— TRIZ Skill Layer 集成
    router
      .group(() => {
        router
          .get('/summary', [TrizSkillLayerController, 'summary'])
          .as('projects.triz-skill-layer.summary')
        router
          .get('/destinations', [TrizSkillLayerController, 'destinations'])
          .as('projects.triz-skill-layer.destinations')
        router
          .post('/route-preview', [TrizSkillLayerController, 'routePreview'])
          .as('projects.triz-skill-layer.route-preview')
        router
          .post('/handoff-preview', [TrizSkillLayerController, 'handoffPreview'])
          .as('projects.triz-skill-layer.handoff-preview')
      })
      .prefix('/projects/:projectId/triz/skill-layer')
      .use(middleware.auth())

    // v3-triz-pm-phase-integration —— TRIZ-PM 阶段整合
    router
      .group(() => {
        router
          .post('/', [TrizPmPhaseIntegrationController, 'createRun'])
          .as('projects.triz-pm-phase-integration.create')
        router
          .get('/', [TrizPmPhaseIntegrationController, 'listRuns'])
          .as('projects.triz-pm-phase-integration.index')
        router
          .get('/:runId', [TrizPmPhaseIntegrationController, 'getRun'])
          .as('projects.triz-pm-phase-integration.show')
        router
          .get('/:runId/phases', [TrizPmPhaseIntegrationController, 'listPhases'])
          .as('projects.triz-pm-phase-integration.phases')
        router
          .get('/:runId/phases/:phaseId', [TrizPmPhaseIntegrationController, 'getPhase'])
          .as('projects.triz-pm-phase-integration.phase')
        router
          .post('/:runId/review', [TrizPmPhaseIntegrationController, 'reviewPhase'])
          .as('projects.triz-pm-phase-integration.review')
        router
          .post('/:runId/explain', [TrizPmPhaseIntegrationController, 'explainPhase'])
          .as('projects.triz-pm-phase-integration.explain')
        router
          .post('/:runId/handoff-preview', [TrizPmPhaseIntegrationController, 'handoffPreview'])
          .as('projects.triz-pm-phase-integration.handoff-preview')
      })
      .prefix('/projects/:projectId/triz/pm-phase-integration')
      .use(middleware.auth())

    // v3-ai-triz-assistant —— AI-TRIZ 助手
    router
      .group(() => {
        router
          .get('/runs', [TrizAssistantController, 'listRuns'])
          .as('projects.triz-assistant.runs.index')
        router
          .get('/runs/:runId', [TrizAssistantController, 'runDetail'])
          .as('projects.triz-assistant.runs.show')
        router
          .post('/submit', [TrizAssistantController, 'submitMessage'])
          .as('projects.triz-assistant.submit')
        router
          .post('/runs/:runId/feedback', [TrizAssistantController, 'recordFeedback'])
          .as('projects.triz-assistant.feedback')
        router
          .post('/preview', [TrizAssistantController, 'previewAction'])
          .as('projects.triz-assistant.preview')
      })
      .prefix('/projects/:projectId/triz/assistant')
      .use(middleware.auth())

    // v3-triz-function-analysis-diagram —— TRIZ 功能分析图
    router
      .group(() => {
        router
          .post('/', [TrizFunctionAnalysisController, 'create'])
          .as('projects.function-analysis-diagrams.create')
        router
          .get('/', [TrizFunctionAnalysisController, 'index'])
          .as('projects.function-analysis-diagrams.index')
        router
          .get('/:runId', [TrizFunctionAnalysisController, 'show'])
          .as('projects.function-analysis-diagrams.show')
        router
          .get('/:runId/graph', [TrizFunctionAnalysisController, 'graph'])
          .as('projects.function-analysis-diagrams.graph')
        router
          .get('/:runId/issues', [TrizFunctionAnalysisController, 'issues'])
          .as('projects.function-analysis-diagrams.issues')
        router
          .post('/:runId/issues/:issueId/explain', [TrizFunctionAnalysisController, 'explain'])
          .as('projects.function-analysis-diagrams.explain')
        router
          .post('/:runId/issues/:issueId/review', [TrizFunctionAnalysisController, 'review'])
          .as('projects.function-analysis-diagrams.review')
        router
          .post('/:runId/issues/:issueId/workbench-preview', [
            TrizFunctionAnalysisController,
            'workbenchPreview',
          ])
          .as('projects.function-analysis-diagrams.workbench-preview')
        router
          .post('/:runId/issues/:issueId/decision-preview', [
            TrizFunctionAnalysisController,
            'decisionPreview',
          ])
          .as('projects.function-analysis-diagrams.decision-preview')
        router
          .post('/:runId/issues/:issueId/handoff-preview', [
            TrizFunctionAnalysisController,
            'handoffPreview',
          ])
          .as('projects.function-analysis-diagrams.handoff-preview')
      })
      .prefix('/projects/:projectId/triz/function-analysis-diagrams')
      .use(middleware.auth())

    // v3-triz-contradiction-matrix-ui —— TRIZ 矛盾矩阵审查 UI
    router
      .group(() => {
        router
          .get('/', [TrizContradictionMatrixController, 'show'])
          .as('projects.triz.contradiction-matrix.show')
        router
          .post('/handoff', [TrizContradictionMatrixController, 'handoff'])
          .as('projects.triz.contradiction-matrix.handoff')
      })
      .prefix('/projects/:projectId/triz/contradiction-matrix')
      .use(middleware.auth())

    // v2-ai-risk-progress-prediction —— 预测快照
    router
      .group(() => {
        router.post('/', [ProjectPredictionsController, 'store']).as('projects.predictions.store')
        router.get('/', [ProjectPredictionsController, 'index']).as('projects.predictions.index')
        router
          .get('/latest', [ProjectPredictionsController, 'latest'])
          .as('projects.predictions.latest')
        router.get('/:id', [ProjectPredictionsController, 'show']).as('projects.predictions.show')
        router
          .post('/:id/confirm', [ProjectPredictionsController, 'confirm'])
          .as('projects.predictions.confirm')
        router
          .post('/:id/dismiss', [ProjectPredictionsController, 'dismiss'])
          .as('projects.predictions.dismiss')
        router
          .post('/:id/ai-explanation', [ProjectPredictionsController, 'generateAiExplanation'])
          .as('projects.predictions.ai-explanation')
        router
          .post('/:id/ai-explanation/approve', [
            ProjectPredictionsController,
            'approveAiExplanation',
          ])
          .as('projects.predictions.ai-explanation.approve')
        router
          .post('/:id/ai-explanation/reject', [ProjectPredictionsController, 'rejectAiExplanation'])
          .as('projects.predictions.ai-explanation.reject')
      })
      .prefix('/projects/:projectId/predictions')
      .use(middleware.auth())

    // AI 智能推荐（v2-ai-smart-recommendations）
    router
      .group(() => {
        router
          .get('/', [ProjectRecommendationsController, 'index'])
          .as('projects.recommendations.index')
        router
          .get('/summary', [ProjectRecommendationsController, 'summary'])
          .as('projects.recommendations.summary')
        router
          .post('/refresh', [ProjectRecommendationsController, 'refresh'])
          .as('projects.recommendations.refresh')
        router
          .get('/:id', [ProjectRecommendationsController, 'show'])
          .as('projects.recommendations.show')
        router
          .put('/:id/status', [ProjectRecommendationsController, 'updateStatus'])
          .as('projects.recommendations.status')
        router
          .post('/:id/ai-explanation', [ProjectRecommendationsController, 'generateAiExplanation'])
          .as('projects.recommendations.ai-explanation')
        router
          .post('/:id/ai-explanation/approve', [
            ProjectRecommendationsController,
            'approveAiExplanation',
          ])
          .as('projects.recommendations.ai-explanation.approve')
        router
          .post('/:id/ai-explanation/reject', [
            ProjectRecommendationsController,
            'rejectAiExplanation',
          ])
          .as('projects.recommendations.ai-explanation.reject')
        router
          .post('/:id/convert', [ProjectRecommendationsController, 'convert'])
          .as('projects.recommendations.convert')
      })
      .prefix('/projects/:projectId/recommendations')
      .use(middleware.auth())

    // 资源管理（resource-allocation-and-load）
    router
      .group(() => {
        router.get('/', [ResourcesController, 'index']).as('projects.resources.index')
        router.post('/', [ResourcesController, 'store']).as('projects.resources.store')
        router.get('/load', [ResourcesController, 'getLoad']).as('projects.resources.load')
        router.get('/planning', [ResourcesController, 'planning']).as('projects.resources.planning')
        router
          .get('/conflicts', [ResourcesController, 'conflicts'])
          .as('projects.resources.conflicts')
        router
          .get('/requirements', [ResourcesController, 'requirements'])
          .as('projects.resources.requirements.index')
        router
          .post('/requirements', [ResourcesController, 'storeRequirement'])
          .as('projects.resources.requirements.store')
        router
          .patch('/requirements/:requirementId', [ResourcesController, 'updateRequirement'])
          .as('projects.resources.requirements.update')
        router
          .delete('/requirements/:requirementId', [ResourcesController, 'destroyRequirement'])
          .as('projects.resources.requirements.destroy')
        router
          .get('/requirements/:requirementId/matches', [ResourcesController, 'matchRequirement'])
          .as('projects.resources.requirements.matches')
        router
          .post('/suggestions/preview', [ResourcesController, 'previewSuggestions'])
          .as('projects.resources.suggestions.preview')
        router
          .post('/suggestions/apply', [ResourcesController, 'applySuggestions'])
          .as('projects.resources.suggestions.apply')
        router
          .post('/suggestions/leveling', [ResourcesController, 'unsupportedLeveling'])
          .as('projects.resources.suggestions.leveling')
        router
          .get('/ai-analysis', [ResourcesController, 'getAiAnalysis'])
          .as('projects.resources.ai-analysis')
        router.get('/:id', [ResourcesController, 'show']).as('projects.resources.show')
        router.patch('/:id', [ResourcesController, 'update']).as('projects.resources.update')
        router.delete('/:id', [ResourcesController, 'destroy']).as('projects.resources.destroy')

        router
          .get('/:resourceId/availability-exceptions', [
            ResourcesController,
            'availabilityExceptions',
          ])
          .as('projects.resources.availability-exceptions.index')
        router
          .post('/:resourceId/availability-exceptions', [
            ResourcesController,
            'storeAvailabilityException',
          ])
          .as('projects.resources.availability-exceptions.store')
        router
          .patch('/:resourceId/availability-exceptions/:exceptionId', [
            ResourcesController,
            'updateAvailabilityException',
          ])
          .as('projects.resources.availability-exceptions.update')
        router
          .delete('/:resourceId/availability-exceptions/:exceptionId', [
            ResourcesController,
            'destroyAvailabilityException',
          ])
          .as('projects.resources.availability-exceptions.destroy')

        router
          .get('/:resourceId/allocations', [ResourceAllocationsController, 'index'])
          .as('projects.resources.allocations.index')
        router
          .post('/:resourceId/allocations', [ResourceAllocationsController, 'store'])
          .as('projects.resources.allocations.store')
        router
          .patch('/:resourceId/allocations/:id', [ResourceAllocationsController, 'update'])
          .as('projects.resources.allocations.update')
        router
          .delete('/:resourceId/allocations/:id', [ResourceAllocationsController, 'destroy'])
          .as('projects.resources.allocations.destroy')
      })
      .prefix('/projects/:projectId/resources')
      .use(middleware.auth())

    // 里程碑：嵌套列表/创建（milestone-management，spec）。
    // index/store 的 milestone:view/create 与跨组织 404 由 rbac 中间件按路由表守卫；
    // 扁平 show/update/destroy（无 projectId）的写/查权限由 controller 经 MilestonePolicy 判定。
    router
      .group(() => {
        router.get('/', [MilestonesController, 'index']).as('projects.milestones.index')
        router.post('/', [MilestonesController, 'store']).as('projects.milestones.store')
      })
      .prefix('/projects/:projectId/milestones')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/:id', [MilestonesController, 'show']).as('milestones.show')
        router.patch('/:id', [MilestonesController, 'update']).as('milestones.update')
        router.delete('/:id', [MilestonesController, 'destroy']).as('milestones.destroy')
      })
      .prefix('/milestones')
      .use(middleware.auth())

    // risk-register-and-ai-suggestions / T030 —— 风险登记册 CRUD + 矩阵 + AI 建议
    router
      .group(() => {
        router.get('/', [RisksController, 'index']).as('projects.risks.index')
        router.post('/', [RisksController, 'store']).as('projects.risks.store')
        router.get('/matrix', [RisksController, 'matrix']).as('projects.risks.matrix')
        router
          .post('/ai-suggestions', [RisksController, 'aiSuggestions'])
          .as('projects.risks.ai-suggestions')
        router
          .post('/ai-suggestions/:batchId/accept', [RisksController, 'acceptAiSuggestion'])
          .as('projects.risks.ai-suggestions.accept')
        router
          .post('/ai-suggestions/:batchId/reject', [RisksController, 'rejectAiSuggestion'])
          .as('projects.risks.ai-suggestions.reject')
      })
      .prefix('/projects/:projectId/risks')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/:id', [RisksController, 'show']).as('risks.show')
        router.patch('/:id', [RisksController, 'update']).as('risks.update')
        router.delete('/:id', [RisksController, 'destroy']).as('risks.destroy')
        router.post('/:id/status', [RisksController, 'transitionStatus']).as('risks.status')
      })
      .prefix('/risks')
      .use(middleware.auth())

    // v2-risk-management-full —— 风险工作台、矩阵配置、应对计划、候选评估
    router
      .group(() => {
        router
          .get('/workbench/summary', [RiskV2Controller, 'summary'])
          .as('projects.risks.v2.summary')
        router.get('/workbench/trend', [RiskV2Controller, 'trend']).as('projects.risks.v2.trend')
        router
          .get('/workbench/review-queue', [RiskV2Controller, 'reviewQueue'])
          .as('projects.risks.v2.review-queue')
        // 矩阵配置
        router
          .get('/matrix-config', [RiskV2Controller, 'getMatrixConfig'])
          .as('projects.risks.v2.matrix-config.get')
        router
          .put('/matrix-config', [RiskV2Controller, 'updateMatrixConfig'])
          .as('projects.risks.v2.matrix-config.update')
        // 应对计划
        router
          .get('/:riskId/response-plans', [RiskV2Controller, 'listResponsePlans'])
          .as('projects.risks.v2.response-plans.index')
        router
          .post('/:riskId/response-plans', [RiskV2Controller, 'createResponsePlan'])
          .as('projects.risks.v2.response-plans.store')
        router
          .patch('/:riskId/response-plans/:planId', [RiskV2Controller, 'updateResponsePlan'])
          .as('projects.risks.v2.response-plans.update')
        router
          .delete('/:riskId/response-plans/:planId', [RiskV2Controller, 'deleteResponsePlan'])
          .as('projects.risks.v2.response-plans.delete')
        // 复查
        router.post('/:riskId/review', [RiskV2Controller, 'review']).as('projects.risks.v2.review')
        // 风险历史
        router
          .get('/:riskId/history', [RiskV2Controller, 'history'])
          .as('projects.risks.v2.history')
        // 规则候选评估
        router
          .post('/evaluate-candidates', [RiskV2Controller, 'evaluateCandidates'])
          .as('projects.risks.v2.evaluate-candidates')
        router
          .post('/candidates/:candidateId/accept', [RiskV2Controller, 'acceptCandidate'])
          .as('projects.risks.v2.candidates.accept')
        router
          .post('/candidates/:candidateId/reject', [RiskV2Controller, 'rejectCandidate'])
          .as('projects.risks.v2.candidates.reject')
        // 知识库模板
        router
          .get('/knowledge-templates', [RiskV2Controller, 'listTemplates'])
          .as('projects.risks.v2.templates.index')
        router
          .post('/knowledge-templates', [RiskV2Controller, 'createTemplate'])
          .as('projects.risks.v2.templates.store')
      })
      .prefix('/projects/:projectId/risks')
      .use(middleware.auth())
    router
      .group(() => {
        router.get('/', [DiagramsController, 'index']).as('projects.diagrams.index')
        router.post('/', [DiagramsController, 'store']).as('projects.diagrams.store')
      })
      .prefix('/projects/:projectId/diagrams')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/:id', [DiagramsController, 'show']).as('diagrams.show')
        router.patch('/:id', [DiagramsController, 'update']).as('diagrams.update')
        router.delete('/:id', [DiagramsController, 'destroy']).as('diagrams.destroy')
        router.get('/:id/mermaid', [DiagramsController, 'mermaid']).as('diagrams.mermaid')
      })
      .prefix('/diagrams')
      .use(middleware.auth())

    // 预设项目报表（preset-project-reports / V1 报表白名单四模板）
    router
      .group(() => {
        router.get('/', [ReportsController, 'index']).as('projects.reports.index')
        router.post('/', [ReportsController, 'store']).as('projects.reports.store')
        router
          .get('/export', [ReportsController, 'exportProjectLegacy'])
          .as('projects.reports.export')
      })
      .prefix('/projects/:projectId/reports')
      .use(middleware.auth())

    // V2 报表系统（v2-reporting-system-upgrade）
    router
      .group(() => {
        router
          .get('/templates', [ReportV2Controller, 'listTemplates'])
          .as('projects.reports.v2.templates')
        router
          .get('/workspace', [ReportV2Controller, 'workspaceSummary'])
          .as('projects.reports.v2.workspace')
        router.post('/preview', [ReportV2Controller, 'preview']).as('projects.reports.v2.preview')
        router
          .post('/versions', [ReportV2Controller, 'createVersion'])
          .as('projects.reports.v2.versions.create')
        router
          .get('/versions', [ReportV2Controller, 'listVersions'])
          .as('projects.reports.v2.versions.index')
        router
          .get('/versions/:versionId', [ReportV2Controller, 'showVersion'])
          .as('projects.reports.v2.versions.show')
        router
          .get('/jobs/:jobId', [ReportV2Controller, 'showJob'])
          .as('projects.reports.v2.jobs.show')
        router
          .post('/jobs/:jobId/retry', [ReportV2Controller, 'retryJob'])
          .as('projects.reports.v2.jobs.retry')
        router
          .post('/versions/:versionId/exports', [ReportV2Controller, 'createExport'])
          .as('projects.reports.v2.exports.create')
        router
          .get('/versions/:versionId/exports', [ReportV2Controller, 'listExports'])
          .as('projects.reports.v2.exports.index')
        router
          .get('/exports/:exportId/download', [ReportV2Controller, 'downloadExport'])
          .as('projects.reports.v2.exports.download')
        router
          .patch('/versions/:versionId/ai-review', [ReportV2Controller, 'aiReview'])
          .as('projects.reports.v2.ai-review')

        // AI 周期报表端点
        router
          .post('/periodic/preview', [PeriodicReportController, 'previewPeriodic'])
          .as('projects.reports.v2.periodic.preview')
        router
          .post('/periodic/generate', [PeriodicReportController, 'generatePeriodic'])
          .as('projects.reports.v2.periodic.generate')
        router
          .get('/periodic/jobs/:jobId', [PeriodicReportController, 'showPeriodicJob'])
          .as('projects.reports.v2.periodic.jobs.show')
        router
          .post('/periodic/jobs/:jobId/retry', [PeriodicReportController, 'retryPeriodicJob'])
          .as('projects.reports.v2.periodic.jobs.retry')
        router
          .patch('/periodic/versions/:versionId/review', [
            PeriodicReportController,
            'reviewPeriodicDraft',
          ])
          .as('projects.reports.v2.periodic.review')
        router
          .post('/periodic/versions/:versionId/exports', [
            PeriodicReportController,
            'requestPeriodicExport',
          ])
          .as('projects.reports.v2.periodic.exports.create')
        router
          .get('/periodic/exports/:exportId/download', [
            PeriodicReportController,
            'downloadPeriodicExport',
          ])
          .as('projects.reports.v2.periodic.exports.download')
      })
      .prefix('/projects/:projectId/reports/v2')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/:id', [ReportsController, 'show']).as('reports.show')
        router.post('/:id/exports', [ReportsController, 'exportStore']).as('reports.exports.store')
        router
          .get('/:id/exports/:exportId/download', [ReportsController, 'exportDownload'])
          .as('reports.exports.download')
      })
      .prefix('/reports')
      .use(middleware.auth())

    // simple-change-approval / T031 —— 变更请求 CRUD + 简单审批状态流
    // 嵌套路由：index/store（project scope）
    router
      .group(() => {
        router.get('/', [ChangeRequestsController, 'index']).as('projects.change-requests.index')
        router.post('/', [ChangeRequestsController, 'store']).as('projects.change-requests.store')
      })
      .prefix('/projects/:projectId/change-requests')
      .use(middleware.auth())

    // 扁平路由：show/update + 动作端点（跨项目定位，组织隔离在 Service 层）
    router
      .group(() => {
        router.get('/:id', [ChangeRequestsController, 'show']).as('change-requests.show')
        router.patch('/:id', [ChangeRequestsController, 'update']).as('change-requests.update')
        router
          .post('/:id/submit', [ChangeRequestsController, 'submit'])
          .as('change-requests.submit')
        router
          .post('/:id/approve', [ChangeRequestsController, 'approve'])
          .as('change-requests.approve')
        router
          .post('/:id/reject', [ChangeRequestsController, 'reject'])
          .as('change-requests.reject')
        router
          .post('/:id/return', [ChangeRequestsController, 'returnForRevision'])
          .as('change-requests.return')
        router
          .post('/:id/mark-implemented', [ChangeRequestsController, 'markImplemented'])
          .as('change-requests.mark-implemented')
        router.post('/:id/close', [ChangeRequestsController, 'close']).as('change-requests.close')
        router
          .post('/:id/cancel', [ChangeRequestsController, 'cancel'])
          .as('change-requests.cancel')
        router
          .post('/:id/ai-impact', [ChangeRequestsController, 'aiImpact'])
          .as('change-requests.ai-impact')
      })
      .prefix('/change-requests')
      .use(middleware.auth())

    // V2 变更影响分析（v2-change-management-impact-analysis）
    // 嵌套路由：项目/变更请求级
    router
      .group(() => {
        router
          .post('/', [ChangeImpactController, 'createAnalysis'])
          .as('projects.impact-analyses.store')
        router
          .get('/', [ChangeImpactController, 'listAnalyses'])
          .as('projects.impact-analyses.index')
      })
      .prefix('/projects/:projectId/change-requests/:changeRequestId/impact-analyses')
      .use(middleware.auth())

    // 扁平路由：单条分析操作
    router
      .group(() => {
        router.get('/:id', [ChangeImpactController, 'getAnalysis']).as('impact-analyses.show')
        router
          .post('/:id/refresh', [ChangeImpactController, 'refreshAnalysis'])
          .as('impact-analyses.refresh')
        router
          .post('/:id/confirm', [ChangeImpactController, 'confirmAnalysis'])
          .as('impact-analyses.confirm')
        router
          .post('/:id/confirm-stale', [ChangeImpactController, 'confirmStaleAnalysis'])
          .as('impact-analyses.confirm-stale')
        router
          .post('/:id/ai-explanation', [ChangeImpactController, 'generateAiExplanation'])
          .as('impact-analyses.ai-explanation')
      })
      .prefix('/impact-analyses')
      .use(middleware.auth())

    // 文件库与附件（project-files-and-attachments / T033）
    router
      .group(() => {
        router.get('/', [ProjectFilesController, 'index']).as('projects.files.index')
        router.post('/', [ProjectFilesController, 'store']).as('projects.files.store')
        router
          .patch('/:documentId/rename', [ProjectFilesController, 'rename'])
          .as('projects.files.rename')
        router.post('/:documentId/move', [ProjectFilesController, 'move']).as('projects.files.move')
        router
          .delete('/:documentId', [ProjectFilesController, 'destroy'])
          .as('projects.files.destroy')
        router
          .get('/:documentId/content', [ProjectFilesController, 'markdownContent'])
          .as('projects.files.content')
        router
          .post('/:documentId/formula-copied', [ProjectFilesController, 'markdownFormulaCopied'])
          .as('projects.files.formula-copied')
      })
      .prefix('/projects/:projectId/files')
      .use(middleware.auth())

    // 文档 Markdown 导入/导出（v3-document-markdown-import-export §3.4）
    router
      .group(() => {
        router
          .post('/import/preview', [ProjectFilesController, 'markdownImportPreview'])
          .as('projects.files.markdown.import-preview')
        router
          .post('/import/confirm', [ProjectFilesController, 'markdownImportConfirm'])
          .as('projects.files.markdown.import-confirm')
        router
          .get('/export/:documentId', [ProjectFilesController, 'markdownExportSingle'])
          .as('projects.files.markdown.export-single')
        router
          .post('/export/tree', [ProjectFilesController, 'markdownExportTree'])
          .as('projects.files.markdown.export-tree')
      })
      .prefix('/projects/:projectId/files/markdown')
      .use(middleware.auth())

    // 文档内联批注（v3-document-inline-comments）
    router
      .group(() => {
        router
          .get('/', [DocumentInlineCommentsController, 'index'])
          .as('projects.documents.inline-comments.index')
        router
          .post('/', [DocumentInlineCommentsController, 'store'])
          .as('projects.documents.inline-comments.store')
        router
          .get('/:anchorId', [DocumentInlineCommentsController, 'show'])
          .as('projects.documents.inline-comments.show')
        router
          .post('/:anchorId/replies', [DocumentInlineCommentsController, 'reply'])
          .as('projects.documents.inline-comments.reply')
        router
          .post('/:anchorId/resolve', [DocumentInlineCommentsController, 'resolve'])
          .as('projects.documents.inline-comments.resolve')
        router
          .post('/:anchorId/reopen', [DocumentInlineCommentsController, 'reopen'])
          .as('projects.documents.inline-comments.reopen')
        router
          .delete('/:anchorId', [DocumentInlineCommentsController, 'destroy'])
          .as('projects.documents.inline-comments.destroy')
        router
          .patch('/:anchorId/reanchor', [DocumentInlineCommentsController, 'reanchor'])
          .as('projects.documents.inline-comments.reanchor')
      })
      .prefix('/api/v1/projects/:projectId/documents/:documentId/inline-comments')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/', [ProjectAttachmentsController, 'index']).as('projects.attachments.index')
        router.post('/', [ProjectAttachmentsController, 'store']).as('projects.attachments.store')
        router
          .get('/:attachmentId/download', [ProjectAttachmentsController, 'download'])
          .as('projects.attachments.download')
        router
          .delete('/:attachmentId', [ProjectAttachmentsController, 'destroy'])
          .as('projects.attachments.destroy')
      })
      .prefix('/projects/:projectId/attachments')
      .use(middleware.auth())

    // V3 OCR 文档上传流（v3-ocr-document-upload-flow §7.2）
    router
      .group(() => {
        router.post('/', [OcrDocumentJobsController, 'create']).as('projects.ocr.jobs.create')
        router.get('/', [OcrDocumentJobsController, 'list']).as('projects.ocr.jobs.list')
        router.get('/:id', [OcrDocumentJobsController, 'detail']).as('projects.ocr.jobs.detail')
        router
          .get('/:id/candidates', [OcrDocumentJobsController, 'candidates'])
          .as('projects.ocr.jobs.candidates')
        router
          .post('/:id/retry', [OcrDocumentJobsController, 'retry'])
          .as('projects.ocr.jobs.retry')
        router
          .post('/:id/confirm', [OcrDocumentJobsController, 'confirm'])
          .as('projects.ocr.jobs.confirm')
        router
          .get('/:id/extractions', [OcrDocumentJobsController, 'extractions'])
          .as('projects.ocr.jobs.extractions')
      })
      .prefix('/projects/:projectId/ocr/document-jobs')
      .use(middleware.auth())

    // V3 OCR 审查确认流（v3-ocr-review-confirmation-flow §4.5）
    router
      .group(() => {
        router.get('/:jobId/review', [OcrReviewController, 'review']).as('projects.ocr.review')
        router
          .get('/:jobId/accepted-extractions', [OcrReviewController, 'acceptedExtractions'])
          .as('projects.ocr.accepted-extractions')
        router
          .post('/:jobId/confirmation-preview', [OcrReviewController, 'confirmationPreview'])
          .as('projects.ocr.confirmation-preview')
        router
          .post('/:jobId/confirmation-save', [OcrReviewController, 'confirmationSave'])
          .as('projects.ocr.confirmation-save')
      })
      .prefix('/projects/:projectId/ocr/document-jobs')
      .use(middleware.auth())

    // V3 OCR 保留治理（v3-ocr-result-persistence-and-retention §6）
    router
      .group(() => {
        router
          .get('/policy', [OcrRetentionController, 'readPolicy'])
          .as('projects.ocr.retention.policy.read')
        router
          .put('/policy', [OcrRetentionController, 'updatePolicy'])
          .as('projects.ocr.retention.policy.update')
        router
          .get('/status', [OcrRetentionController, 'getStatus'])
          .as('projects.ocr.retention.status')
        router
          .get('/accepted-extractions', [OcrRetentionController, 'getAcceptedExtractions'])
          .as('projects.ocr.retention.accepted-extractions')
        router
          .post('/cleanup/preview', [OcrRetentionController, 'previewCleanup'])
          .as('projects.ocr.retention.cleanup.preview')
        router
          .post('/cleanup/execute', [OcrRetentionController, 'executeCleanup'])
          .as('projects.ocr.retention.cleanup.execute')
        router
          .get('/holds', [OcrRetentionController, 'listHolds'])
          .as('projects.ocr.retention.holds.list')
        router
          .post('/holds', [OcrRetentionController, 'setHold'])
          .as('projects.ocr.retention.holds.set')
        router
          .delete('/holds/:holdId', [OcrRetentionController, 'releaseHold'])
          .as('projects.ocr.retention.holds.release')
      })
      .prefix('/projects/:projectId/ocr/retention')
      .use(middleware.auth())

    // OCR 搜索索引（v3-ocr-document-search-indexing）
    router
      .group(() => {
        router
          .get('/', [OcrDocumentSearchIndexController, 'list'])
          .as('projects.ocr.search-index.list')
        router
          .post('/preview', [OcrDocumentSearchIndexController, 'preview'])
          .as('projects.ocr.search-index.preview')
        router
          .post('/execute', [OcrDocumentSearchIndexController, 'execute'])
          .as('projects.ocr.search-index.execute')
        router
          .post('/reindex-preview', [OcrDocumentSearchIndexController, 'reindexPreview'])
          .as('projects.ocr.search-index.reindex.preview')
        router
          .post('/reindex-execute', [OcrDocumentSearchIndexController, 'reindexExecute'])
          .as('projects.ocr.search-index.reindex.execute')
        router
          .post('/unindex-preview', [OcrDocumentSearchIndexController, 'unindexPreview'])
          .as('projects.ocr.search-index.unindex.preview')
        router
          .post('/unindex-execute', [OcrDocumentSearchIndexController, 'unindexExecute'])
          .as('projects.ocr.search-index.unindex.execute')
      })
      .prefix('/projects/:projectId/ocr/search-index')
      .use(middleware.auth())

    // 文档全文搜索索引（v3-document-full-text-search）
    router
      .group(() => {
        router
          .get('/status', [DocumentSearchController, 'status'])
          .as('projects.document-search.status')
        router
          .post('/reindex', [DocumentSearchController, 'reindex'])
          .as('projects.document-search.reindex')
      })
      .prefix('/projects/:projectId/document-search')
      .use(middleware.auth())

    // OCR 结构化提取（v3-ocr-structured-extraction §5.11）
    router
      .group(() => {
        // ── 提取配置（Profile）管理 ──
        router
          .get('profiles', [OcrStructuredExtractionController, 'listProfiles'])
          .as('projects.ocr.structured-extraction.profiles.index')
        router
          .get('profiles/:id', [OcrStructuredExtractionController, 'getProfile'])
          .as('projects.ocr.structured-extraction.profiles.show')
        router
          .post('profiles', [OcrStructuredExtractionController, 'createProfile'])
          .as('projects.ocr.structured-extraction.profiles.store')
        router
          .put('profiles/:id', [OcrStructuredExtractionController, 'updateProfile'])
          .as('projects.ocr.structured-extraction.profiles.update')
        router
          .patch('profiles/:id/archive', [OcrStructuredExtractionController, 'archiveProfile'])
          .as('projects.ocr.structured-extraction.profiles.archive')
        // ── 提取运行（Run）管理 ──
        router
          .post('runs', [OcrStructuredExtractionController, 'createRun'])
          .as('projects.ocr.structured-extraction.runs.store')
        router
          .get('runs', [OcrStructuredExtractionController, 'listRuns'])
          .as('projects.ocr.structured-extraction.runs.index')
        router
          .get('runs/:id', [OcrStructuredExtractionController, 'getRun'])
          .as('projects.ocr.structured-extraction.runs.show')
        router
          .get('runs/:id/candidates', [OcrStructuredExtractionController, 'getCandidates'])
          .as('projects.ocr.structured-extraction.runs.candidates')
        // ── 确认：预览 + 保存 ──
        router
          .post('preview', [OcrStructuredExtractionController, 'previewConfirmation'])
          .as('projects.ocr.structured-extraction.preview')
        router
          .post('save', [OcrStructuredExtractionController, 'saveConfirmation'])
          .as('projects.ocr.structured-extraction.save')
        // ── 快照（Snapshot）查询 ──
        router
          .get('snapshots', [OcrStructuredExtractionController, 'listSnapshots'])
          .as('projects.ocr.structured-extraction.snapshots.index')
        router
          .get('snapshots/:id', [OcrStructuredExtractionController, 'getSnapshot'])
          .as('projects.ocr.structured-extraction.snapshots.show')
      })
      .prefix('/projects/:projectId/ocr/structured-extraction')
      .use(middleware.auth())

    // OCR Provider 观测与成本控制（v3-ocr-provider-observability-cost-controls）
    router
      .group(() => {
        router
          .get('/summary', [OcrProviderObservabilityController, 'summary'])
          .as('projects.ocr.provider-observability.summary')
        router
          .get('/events', [OcrProviderObservabilityController, 'events'])
          .as('projects.ocr.provider-observability.events')
      })
      .prefix('/projects/:projectId/ocr/provider-observability')
      .use(middleware.auth())

    // OCR 实体链接（v3-ocr-entity-linking）
    router
      .group(() => {
        // Runs
        router
          .post('/runs', [OcrEntityLinkingController, 'createRun'])
          .as('projects.ocr.entity-links.runs.store')
        router
          .get('/runs', [OcrEntityLinkingController, 'listRuns'])
          .as('projects.ocr.entity-links.runs.index')
        router
          .get('/runs/:id', [OcrEntityLinkingController, 'getRun'])
          .as('projects.ocr.entity-links.runs.show')
        router
          .get('/runs/:id/candidates', [OcrEntityLinkingController, 'listCandidates'])
          .as('projects.ocr.entity-links.runs.candidates')
        // Preview / Confirm
        router
          .post('/preview', [OcrEntityLinkingController, 'preview'])
          .as('projects.ocr.entity-links.preview')
        router
          .post('/confirm', [OcrEntityLinkingController, 'confirm'])
          .as('projects.ocr.entity-links.confirm')
        // Supersede / Reject
        router
          .post('/:id/supersede', [OcrEntityLinkingController, 'supersede'])
          .as('projects.ocr.entity-links.supersede')
        router
          .post('/:id/reject', [OcrEntityLinkingController, 'reject'])
          .as('projects.ocr.entity-links.reject')
        // Optional AI Explain
        router
          .post('/explain', [OcrEntityLinkingController, 'explain'])
          .as('projects.ocr.entity-links.explain')
      })
      .prefix('/projects/:projectId/ocr/entity-links')
      .use(middleware.auth())

    // OCR 隐私策略控制（v3-ocr-privacy-policy-controls §6.5）
    router
      .group(() => {
        router
          .get('/policy', [OcrPrivacyController, 'readPolicy'])
          .as('projects.ocr.privacy.policy.read')
        router
          .put('/policy', [OcrPrivacyController, 'updatePolicy'])
          .as('projects.ocr.privacy.policy.update')
        router
          .get('/status', [OcrPrivacyController, 'readStatus'])
          .as('projects.ocr.privacy.status')
        router
          .post('/decision-preview', [OcrPrivacyController, 'decisionPreview'])
          .as('projects.ocr.privacy.decision-preview')
        router
          .post('/export-preview', [OcrPrivacyController, 'exportPreview'])
          .as('projects.ocr.privacy.export-preview')
        router
          .post('/export-execute', [OcrPrivacyController, 'exportExecute'])
          .as('projects.ocr.privacy.export-execute')
        router
          .get('/runs', [OcrPrivacyController, 'listRuns'])
          .as('projects.ocr.privacy.runs.index')
        router
          .get('/runs/:runId', [OcrPrivacyController, 'runDetail'])
          .as('projects.ocr.privacy.runs.show')
      })
      .prefix('/projects/:projectId/ocr/privacy')
      .use(middleware.auth())

    // OCR 权限/审计（v3-ocr-permission-and-audit §5.2）
    router
      .group(() => {
        router
          .get('/status', [OcrPermissionAuditController, 'status'])
          .as('projects.ocr.permission-audit.status')
        router
          .post('/decision-preview', [OcrPermissionAuditController, 'decisionPreview'])
          .as('projects.ocr.permission-audit.decision-preview')
        router
          .get('/audit-summaries', [OcrPermissionAuditController, 'auditSummaries'])
          .as('projects.ocr.permission-audit.audit-summaries')
      })
      .prefix('/projects/:projectId/ocr/permission-audit')
      .use(middleware.auth())

    // OCR 批量/队列（v3-ocr-batch-and-queue-processing §5.1–5.2）
    router
      .group(() => {
        router
          .post('/batches', [OcrBatchQueueController, 'create'])
          .as('projects.ocr.batches.store')
        router.get('/batches', [OcrBatchQueueController, 'list']).as('projects.ocr.batches.index')
        router
          .get('/batches/:id', [OcrBatchQueueController, 'detail'])
          .as('projects.ocr.batches.show')
        router
          .post('/batches/:id/retry', [OcrBatchQueueController, 'retry'])
          .as('projects.ocr.batches.retry')
        router
          .post('/batches/:id/cancel', [OcrBatchQueueController, 'cancel'])
          .as('projects.ocr.batches.cancel')
        router
          .post('/batches/:id/resume', [OcrBatchQueueController, 'resume'])
          .as('projects.ocr.batches.resume')
        router
          .get('/queue/summary', [OcrBatchQueueController, 'queueSummary'])
          .as('projects.ocr.queue.summary')
        router.get('/queue', [OcrBatchQueueController, 'queueList']).as('projects.ocr.queue.index')
        router
          .post('/queue/drain', [OcrBatchQueueController, 'drain'])
          .as('projects.ocr.queue.drain')
      })
      .prefix('/projects/:projectId/ocr')
      .use(middleware.auth())

    // 文档智能工作台（v3-document-intelligence-workbench §3.19）
    // 只读增量端点：仅 GET，无任何 POST/PATCH/DELETE 工作台旁路；
    // 敏感写入继续由既有 owning API（OCR review/search-index/extraction/entity-link）执行。
    router
      .group(() => {
        router
          .get('/', [DocumentIntelligenceController, 'sources'])
          .as('projects.document-intelligence.sources')
        router
          .get('/:sourceKind/:sourceId', [DocumentIntelligenceController, 'sourceDetail'])
          .as('projects.document-intelligence.sources.detail')
      })
      .prefix('/projects/:projectId/document-intelligence/sources')
      .use(middleware.auth())

    // 34 阶段代码生成候选运行（v3-codegen-34-stage-candidate-runtime-execution）
    // 只读查询 + 创建执行；无任何把候选转正的端点（红线 1）
    router
      .group(() => {
        router
          .post('/', [CodegenCandidateRunController, 'store'])
          .as('projects.compiler.codegen.candidate-runs.store')
        router
          .get('/', [CodegenCandidateRunController, 'index'])
          .as('projects.compiler.codegen.candidate-runs.index')
        router
          .get('/:id', [CodegenCandidateRunController, 'show'])
          .as('projects.compiler.codegen.candidate-runs.show')
        router
          .get('/:id/stages', [CodegenCandidateRunController, 'stages'])
          .as('projects.compiler.codegen.candidate-runs.stages')
        router
          .get('/:id/review-packet', [CodegenCandidateRunController, 'reviewPacket'])
          .as('projects.compiler.codegen.candidate-runs.review-packet')
      })
      .prefix('/projects/:projectId/compiler/codegen/candidate-runs')
      .use(middleware.auth())

    // V2 文件管理（v2-file-management-upgrade）
    router
      .group(() => {
        // === 版本 ===
        router
          .post('/attachments/:attachmentId/versions', [FileV2Controller, 'uploadVersion'])
          .as('projects.files.v2.versions.upload')
        router
          .get('/attachments/:attachmentId/versions', [FileV2Controller, 'listVersions'])
          .as('projects.files.v2.versions.index')
        router
          .get('/versions/:versionId/download', [FileV2Controller, 'downloadVersion'])
          .as('projects.files.v2.versions.download')
        router
          .post('/attachments/:attachmentId/versions/rollback', [
            FileV2Controller,
            'rollbackVersion',
          ])
          .as('projects.files.v2.versions.rollback')

        // === 标签 ===
        router.get('/tags', [FileV2Controller, 'listTags']).as('projects.files.v2.tags.index')
        router.post('/tags', [FileV2Controller, 'createTag']).as('projects.files.v2.tags.store')
        router
          .patch('/tags/:tagId', [FileV2Controller, 'updateTag'])
          .as('projects.files.v2.tags.update')
        router
          .delete('/tags/:tagId', [FileV2Controller, 'deleteTag'])
          .as('projects.files.v2.tags.destroy')
        router
          .post('/tags/assign', [FileV2Controller, 'assignTags'])
          .as('projects.files.v2.tags.assign')

        // === 实体关联 ===
        router.post('/links', [FileV2Controller, 'createLink']).as('projects.files.v2.links.store')
        router
          .delete('/links/:linkId', [FileV2Controller, 'deleteLink'])
          .as('projects.files.v2.links.destroy')
        router
          .get('/entity/:entityType/:entityId', [FileV2Controller, 'listEntityFiles'])
          .as('projects.files.v2.links.entity')

        // === 搜索 ===
        router.get('/search', [FileV2Controller, 'search']).as('projects.files.v2.search')

        // === 回收站 ===
        router.get('/trash', [FileV2Controller, 'listTrash']).as('projects.files.v2.trash.index')
        router
          .post('/trash/:attachmentId', [FileV2Controller, 'trash'])
          .as('projects.files.v2.trash.store')
        router
          .post('/trash/:attachmentId/restore', [FileV2Controller, 'restore'])
          .as('projects.files.v2.trash.restore')
        router
          .delete('/trash/:attachmentId/permanent', [FileV2Controller, 'permanentDelete'])
          .as('projects.files.v2.trash.permanent')

        // === 批量操作 ===
        router
          .post('/batch/delete', [FileV2Controller, 'batchDelete'])
          .as('projects.files.v2.batch.delete')
        router
          .post('/batch/restore', [FileV2Controller, 'batchRestore'])
          .as('projects.files.v2.batch.restore')
        router
          .delete('/batch/permanent', [FileV2Controller, 'batchPermanentDelete'])
          .as('projects.files.v2.batch.permanent')
        router.post('/batch/tag', [FileV2Controller, 'batchTag']).as('projects.files.v2.batch.tag')
      })
      .prefix('/projects/:projectId/files/v2')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/', [KanbanController, 'index']).as('projects.kanban.index')
        router.post('/move', [KanbanController, 'move']).as('projects.kanban.move')
      })
      .prefix('/projects/:projectId/kanban')
      .use(middleware.auth())

    router
      .get('/projects/:projectId/list', [TaskListViewController, 'index'])
      .as('projects.list.index')
      .use(middleware.auth())

    router
      .get('/projects/:projectId/calendar', [TaskCalendarController, 'index'])
      .as('projects.calendar.index')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/wbs-tree', [WbsNodesController, 'index']).as('projects.wbs-tree.index')
        router.post('/wbs/nodes', [WbsNodesController, 'store']).as('projects.wbs-nodes.store')
        router
          .patch('/wbs/nodes/:id', [WbsNodesController, 'update'])
          .as('projects.wbs-nodes.update')
        router
          .post('/wbs/nodes/:id/move', [WbsNodesController, 'move'])
          .as('projects.wbs-nodes.move')
        router
          .delete('/wbs/nodes/:id', [WbsNodesController, 'destroy'])
          .as('projects.wbs-nodes.destroy')
      })
      .prefix('/projects/:projectId')
      .use(middleware.auth())

    // 自定义视图（v2-custom-views-view-config）
    router
      .group(() => {
        router.get('/', [CustomViewsController, 'index']).as('projects.custom-views.index')
        router.post('/', [CustomViewsController, 'store']).as('projects.custom-views.store')
        router.get('/:viewId', [CustomViewsController, 'show']).as('projects.custom-views.show')
        router
          .patch('/:viewId', [CustomViewsController, 'update'])
          .as('projects.custom-views.update')
        router
          .delete('/:viewId', [CustomViewsController, 'destroy'])
          .as('projects.custom-views.destroy')
        router
          .post('/:viewId/clone', [CustomViewsController, 'clone'])
          .as('projects.custom-views.clone')
        router
          .put('/reorder', [CustomViewsController, 'reorder'])
          .as('projects.custom-views.reorder')
        router
          .put('/:viewId/default', [CustomViewsController, 'setDefault'])
          .as('projects.custom-views.default')
      })
      .prefix('/projects/:projectId/custom-views')
      .use(middleware.auth())

    // v2-deterministic-ui-renderer —— 渲染器配置（§7.1 P0）
    const RendererConfigsController = () => import('#controllers/renderer_configs_controller')
    router
      .group(() => {
        router
          .post('/validate', [RendererConfigsController, 'validate'])
          .as('projects.renderer-configs.validate')
        router
          .post('/preview', [RendererConfigsController, 'preview'])
          .as('projects.renderer-configs.preview')
        router
          .post('/confirm', [RendererConfigsController, 'confirm'])
          .as('projects.renderer-configs.confirm')
        router
          .put('/overrides', [RendererConfigsController, 'saveOverrides'])
          .as('projects.renderer-configs.overrides.save')
        router
          .delete('/overrides/:viewId', [RendererConfigsController, 'resetOverrides'])
          .as('projects.renderer-configs.overrides.reset')
      })
      .prefix('/projects/:projectId/renderer-configs')
      .use(middleware.auth())

    router
      .group(() => {
        router
          .get('/:organizationId/projects', [ProjectsController, 'indexForOrganization'])
          .as('organizations.projects.index')
        router
          .post('/:organizationId/projects', [ProjectsController, 'storeForOrganization'])
          .as('organizations.projects.store')
        router.get('/', [OrganizationsController, 'index']).as('organizations.index')
        router.post('/', [OrganizationsController, 'store']).as('organizations.store')
        router.get('/:id', [OrganizationsController, 'show']).as('organizations.show')
        router.put('/:id', [OrganizationsController, 'update']).as('organizations.update')
        router.delete('/:id', [OrganizationsController, 'destroy']).as('organizations.destroy')
        router
          .get('/:id/members', [OrganizationMembersController, 'index'])
          .as('organizations.members.index')
        router
          .post('/:id/members/invite', [OrganizationMembersController, 'invite'])
          .as('organizations.members.invite')
        router
          .post('/:id/members/accounts', [OrganizationMembersController, 'createAccount'])
          .as('organizations.members.createAccount')
        router
          .put('/:id/members/:memberId', [OrganizationMembersController, 'update'])
          .as('organizations.members.update')
        router
          .delete('/:id/members/:memberId', [OrganizationMembersController, 'destroy'])
          .as('organizations.members.destroy')
        router
          .post('/:id/transfer-owner', [OrganizationsController, 'transfer'])
          .as('organizations.transfer')
        router
          .get('/:organizationId/signals', [
            () => import('#controllers/organization_signals_controller'),
            'index',
          ])
          .as('organizations.signals.index')
      })
      .prefix('organizations')
      .use(middleware.auth())

    // ai-gateway-abstraction / T034 —— AI 连接管理(正式 RBAC,与 dev sandbox 隔离)。
    // 权限:list/show 复用 auth+组织隔离;store/update/destroy/test 需 ai:connection:manage(Policy 判定)。
    router
      .group(() => {
        router.get('/', [AiConnectionsController, 'index']).as('ai.connections.index')
        router.post('/', [AiConnectionsController, 'store']).as('ai.connections.store')
        router.get('/:id', [AiConnectionsController, 'show']).as('ai.connections.show')
        router.patch('/:id', [AiConnectionsController, 'update']).as('ai.connections.update')
        router.delete('/:id', [AiConnectionsController, 'destroy']).as('ai.connections.destroy')
        router.post('/:id/test', [AiConnectionsController, 'test']).as('ai.connections.test')
        // 模型定价（2026-10-01）：第三方中转 / 私有模型可人工定价或绑定目录条目，
        // show 为只读（含历史用量回算），写操作需 ai:connection:manage。
        router
          .get('/:id/models/:modelId/pricing', [AiModelPricingController, 'show'])
          .as('ai.connections.models.pricing.show')
        router
          .put('/:id/models/:modelId/pricing', [AiModelPricingController, 'update'])
          .as('ai.connections.models.pricing.update')
        router
          .post('/:id/models/:modelId/pricing/catalog', [AiModelPricingController, 'applyCatalog'])
          .as('ai.connections.models.pricing.catalog')
        router
          .get('/:id/models/:modelId/pricing/candidates', [AiModelPricingController, 'candidates'])
          .as('ai.connections.models.pricing.candidates')
        router
          .post('/:id/models/:modelId/pricing/prefill', [AiModelPricingController, 'prefill'])
          .as('ai.connections.models.pricing.prefill')
        router
          .delete('/:id/models/:modelId/pricing', [AiModelPricingController, 'destroy'])
          .as('ai.connections.models.pricing.destroy')
      })
      .prefix('/ai/connections')
      .use(middleware.auth())

    // 日历曆法显示设定（个人 > 项目 > 组织 > 默认）：读只需登录；写按层校验权限。
    router
      .group(() => {
        router.get('/', [CalendarDisplayController, 'show']).as('calendar-display.show')
        router.put('/', [CalendarDisplayController, 'update']).as('calendar-display.update')
      })
      .prefix('/settings/calendar-display')
      .use(middleware.auth())

    // 日历第 3 批：「我的日历」（跨项目，只看指派给我的）与个人工作日历（休假 / 个人工作日，只改自己的）。
    router
      .group(() => {
        router
          .get('/calendar', [() => import('#controllers/my_calendar_controller'), 'index'])
          .as('me.calendar.index')
        router
          .get('/working-calendar', [
            () => import('#controllers/my_calendar_controller'),
            'showWorkingCalendar',
          ])
          .as('me.working-calendar.show')
        router
          .put('/working-calendar', [
            () => import('#controllers/my_calendar_controller'),
            'updateWorkingCalendar',
          ])
          .as('me.working-calendar.update')
      })
      .prefix('/me')
      .use(middleware.auth())

    // v3-copilot-optional-web-search-configuration —— Copilot 工具：网页搜索设置。
    // 读（show/status）只需 auth + 组织隔离；写（update）需 copilot:web_search:manage。
    // GET 只回低敏投影（configured + masked label），永不回 credential。
    router
      .group(() => {
        router
          .get('/', [CopilotWebSearchSettingsController, 'show'])
          .as('copilot-tools.web-search.show')
        router
          .put('/', [CopilotWebSearchSettingsController, 'update'])
          .as('copilot-tools.web-search.update')
        router
          .get('/status', [CopilotWebSearchSettingsController, 'status'])
          .as('copilot-tools.web-search.status')
      })
      .prefix('/settings/copilot-tools/web-search')
      .use(middleware.auth())

    // v3-ai-model-catalog-search-and-pricing —— models.dev 目录搜索、匹配与刷新。
    router
      .group(() => {
        router.get('/search', [AiModelCatalogController, 'search']).as('ai.model-catalog.search')
        router.get('/match', [AiModelCatalogController, 'match']).as('ai.model-catalog.match')
        router
          .get('/providers/:providerId', [AiModelCatalogController, 'provider'])
          .as('ai.model-catalog.providers.show')
        router
          .post('/refresh', [AiModelCatalogController, 'refresh'])
          .as('ai.model-catalog.refresh')
      })
      .prefix('/ai/model-catalog')
      .use(middleware.auth())

    // v2-5-third-party-ocr-provider-foundation -- OCR 预览候选，只返回候选数据，不写正式记录。
    router
      .post('/ai/ocr/preview', [AiOcrController, 'preview'])
      .as('ai.ocr.preview')
      .use(middleware.auth())

    // v2-lightweight-calendar-message-integrations —— 第三方日历/消息集成预连接。
    router
      .get('/integrations/:provider/callback', [IntegrationsController, 'callback'])
      .as('integrations.callback')

    router
      .group(() => {
        router.get('/', [IntegrationsController, 'index']).as('integrations.index')
        router.get('/:provider', [IntegrationsController, 'show']).as('integrations.show')
        router
          .post('/:provider/authorize', [IntegrationsController, 'authorize'])
          .as('integrations.authorize')
        router.post('/:provider/qr', [IntegrationsController, 'qr']).as('integrations.qr')
        router.post('/:provider/check', [IntegrationsController, 'check']).as('integrations.check')
        router
          .post('/:provider/disconnect', [IntegrationsController, 'disconnect'])
          .as('integrations.disconnect')
      })
      .prefix('/integrations')
      .use(middleware.auth())

    // v2-5-provider-incoming-webhook-foundation —— per-provider 入站 webhook 接收底座。
    // 接收端点公开、免登录（与 OAuth callback 一样在 auth 组外），安全边界由 HMAC 签名承担。
    // v2-5-webhook-ip-allowlist —— 在应用层验签之前先做网络层来源 IP 收敛（纵深防御）。
    // 默认关闭时该中间件 no-op；开启后未命中 CIDR 清单的来源在解析 body/验签前即被 403。
    router
      .post('/webhooks/:provider', [WebhooksController, 'receive'])
      .as('webhooks.receive')
      .use(middleware.webhookIpAllowlist())

    // webhook 管理 API：受 auth + webhook:manage Policy + 组织隔离门控。
    router
      .group(() => {
        router.get('/', [WebhooksController, 'index']).as('webhooks.index')
        router.post('/', [WebhooksController, 'store']).as('webhooks.store')
        router.patch('/:id', [WebhooksController, 'update']).as('webhooks.update')
        router.post('/:id/enable', [WebhooksController, 'enable']).as('webhooks.enable')
        router.post('/:id/disable', [WebhooksController, 'disable']).as('webhooks.disable')
        router.post('/:id/rotate', [WebhooksController, 'rotate']).as('webhooks.rotate')
        router.get('/:id/deliveries', [WebhooksController, 'deliveries']).as('webhooks.deliveries')
      })
      .prefix('/webhooks')
      .use(middleware.auth())

    // v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 订阅管理 API。
    // 全部受 auth + outgoing_webhook:manage Policy + 组织隔离门控；本 change 不含投递路由。
    const OutgoingWebhooksController = () => import('#controllers/outgoing_webhooks_controller')
    router
      .group(() => {
        router.get('/', [OutgoingWebhooksController, 'index']).as('outgoing-webhooks.index')
        router.post('/', [OutgoingWebhooksController, 'store']).as('outgoing-webhooks.store')
        router.patch('/:id', [OutgoingWebhooksController, 'update']).as('outgoing-webhooks.update')
        router
          .post('/:id/deactivate', [OutgoingWebhooksController, 'deactivate'])
          .as('outgoing-webhooks.deactivate')
        router
          .post('/:id/rotate', [OutgoingWebhooksController, 'rotate'])
          .as('outgoing-webhooks.rotate')
      })
      .prefix('/outgoing-webhooks')
      .use(middleware.auth())

    // v2-5-outgoing-webhook-delivery-ledger -- 出站 webhook 投递账本 API。
    // 受 auth + outgoing_webhook:manage Policy + 组织隔离门控；默认 fixture 投递，
    // feature-off（OUTGOING_WEBHOOK_DELIVERY_ENABLED）禁用 enqueue/send/manualRetry/pause，读仍安全。
    const OutgoingWebhookDeliveriesController = () =>
      import('#controllers/outgoing_webhook_deliveries_controller')
    router
      .group(() => {
        router
          .get('/', [OutgoingWebhookDeliveriesController, 'index'])
          .as('outgoing-webhook-deliveries.index')
        router
          .get('/:id', [OutgoingWebhookDeliveriesController, 'show'])
          .as('outgoing-webhook-deliveries.show')
        router
          .get('/:id/attempts', [OutgoingWebhookDeliveriesController, 'attempts'])
          .as('outgoing-webhook-deliveries.attempts')
        router
          .post('/:id/retry', [OutgoingWebhookDeliveriesController, 'retry'])
          .as('outgoing-webhook-deliveries.retry')
        router
          .post('/:id/pause', [OutgoingWebhookDeliveriesController, 'pause'])
          .as('outgoing-webhook-deliveries.pause')
        router
          .post('/:id/unpause', [OutgoingWebhookDeliveriesController, 'unpause'])
          .as('outgoing-webhook-deliveries.unpause')
      })
      .prefix('/outgoing-webhook-deliveries')
      .use(middleware.auth())

    // v2-5-webhook-batched-delivery -- 出站 webhook 批量投递 API。
    // 受 auth + outgoing_webhook:manage Policy + 组织隔离门控；默认 fixture 投递，
    // feature-off（OUTGOING_WEBHOOK_BATCH_ENABLED）禁用批量投递，读仍安全。
    const OutgoingWebhookBatchDeliveriesController = () =>
      import('#controllers/outgoing_webhook_batch_deliveries_controller')
    router
      .group(() => {
        router
          .get('/', [OutgoingWebhookBatchDeliveriesController, 'index'])
          .as('outgoing-webhook-batch-deliveries.index')
        router
          .get(':batchId', [OutgoingWebhookBatchDeliveriesController, 'show'])
          .as('outgoing-webhook-batch-deliveries.show')
        router
          .post(':batchId/retry', [OutgoingWebhookBatchDeliveriesController, 'retry'])
          .as('outgoing-webhook-batch-deliveries.retry')
      })
      .prefix('/outgoing-webhook-batch-deliveries')
      .use(middleware.auth())

    // v2-5-webhook-templates-and-stats -- 出站 webhook 模板目录与投递统计 API。
    // 受 auth + outgoing_webhook:manage Policy + 组织隔离门控；模板只读操作无 feature-off 门控，
    // 模板应用（apply）和统计需 feature-off 门控（design D5）。
    const OutgoingWebhookTemplatesController = () =>
      import('#controllers/outgoing_webhook_templates_controller')
    const OutgoingWebhookStatsController = () =>
      import('#controllers/outgoing_webhook_stats_controller')
    router
      .group(() => {
        // 模板目录（只读）
        router
          .get('/', [OutgoingWebhookTemplatesController, 'index'])
          .as('outgoing-webhook-templates.index')
        router
          .get('/:id', [OutgoingWebhookTemplatesController, 'show'])
          .as('outgoing-webhook-templates.show')
        router
          .get('/:id/prefill', [OutgoingWebhookTemplatesController, 'prefill'])
          .as('outgoing-webhook-templates.prefill')
        // 模板应用（写操作，需要 feature-off 门控）
        router
          .post('/apply', [OutgoingWebhookTemplatesController, 'apply'])
          .as('outgoing-webhook-templates.apply')
      })
      .prefix('/outgoing-webhook-templates')
      .use(middleware.auth())

    // 投递统计（只读，需要 feature-off 门控返回值）
    router
      .get('/outgoing-webhook-stats', [OutgoingWebhookStatsController, 'index'])
      .as('outgoing-webhook-stats.index')
      .use(middleware.auth())

    // ai-intent-and-clarification / T035 —— 只生成可审查的确认上下文，不写正式项目数据。
    router
      .post('/ai/project-intents/analyze', [AiProjectIntentsController, 'analyze'])
      .as('ai.project-intents.analyze')
      .use(middleware.auth())

    router
      .post('/ai/project-intents/analyze/jobs', [AiProjectIntentsController, 'analyzeJob'])
      .as('ai.project-intents.analyze-jobs')
      .use(middleware.auth())
    router
      .get('/ai/analysis-jobs/:id', [AiProjectIntentsController, 'showAnalysisJob'])
      .as('ai.analysis-jobs.show')
      .use(middleware.auth())

    // 长需求整理（超过 8,000 字时先整理成需求清单给用户确认）；只读、不落库。
    router
      .post('/ai/project-intents/brief', [AiProjectIntentsController, 'brief'])
      .as('ai.project-intents.brief')
      .use(middleware.auth())

    // 需求附件读成文字（Word / PDF / 文本 / 图片识别）；只返回文字给输入框、不落库。
    router
      .post('/ai/project-intents/attachment', [AiProjectIntentsController, 'attachment'])
      .as('ai.project-intents.attachment')
      .use(middleware.auth())

    // 实时输出旁路：意图分析 / 项目理解等待期间订阅模型正在吐出的文字（只读、仅本人频道）。
    router
      .get('/ai/live-output/:id', [AiLiveOutputController, 'show'])
      .as('ai.live-output.show')
      .use(middleware.auth())

    // 只读的「解释当前澄清问题」流式端点：不推进澄清、不写 ledger、不落库。
    router
      .post('/ai/project-intents/explain', [AiProjectIntentsController, 'explain'])
      .as('ai.project-intents.explain')
      .use(middleware.auth())

    router
      .post('/projects/:projectId/ai/draft', [AiProjectDraftsController, 'legacyProjectDraft'])
      .as('projects.ai.draft.legacy')
      .use(middleware.auth())

    // ai-draft-generation / T036·T037 —— 草案生成/审查/确认导入。生成阶段零正式落库，
    // 确认导入在单事务内创建正式项目数据（Policy 判定 ai:trigger / ai:confirm+project:create）。
    router
      .group(() => {
        router.post('/stream', [AiProjectDraftsController, 'stream']).as('ai.drafts.stream')
        router
          .post('/understanding', [AiProjectDraftsController, 'understanding'])
          .as('ai.drafts.understanding')
        router
          .post('/understanding/jobs', [AiProjectDraftsController, 'understandingJob'])
          .as('ai.drafts.understanding-jobs')
        // 生成前评估能否如期完成 + 就此对话商量（只读、不落库；用户确认的决定随 context 进生成）。
        router
          .post('/feasibility', [AiProjectDraftsController, 'feasibility'])
          .as('ai.drafts.feasibility')
        router
          .post('/feasibility/negotiate', [AiProjectDraftsController, 'negotiate'])
          .as('ai.drafts.feasibility.negotiate')
        router
          .post('/:id/validations', [AiProjectDraftsController, 'validate'])
          .as('ai.drafts.validations.store')
        router.post('/:id/ai-fix', [AiProjectDraftsController, 'aiFix']).as('ai.drafts.ai_fix')
        router
          .get('/:id/validations/latest', [AiProjectDraftsController, 'latestValidation'])
          .as('ai.drafts.validations.latest')
        router.get('/:id', [AiProjectDraftsController, 'show']).as('ai.drafts.show')
        router.get('/:id/events', [AiProjectDraftsController, 'events']).as('ai.drafts.events')
        router.post('/:id/save', [AiProjectDraftsController, 'save']).as('ai.drafts.save')
        router.post('/:id/reject', [AiProjectDraftsController, 'reject']).as('ai.drafts.reject')
        router.post('/:id/retry', [AiProjectDraftsController, 'retry']).as('ai.drafts.retry')
        router.post('/:id/confirm', [AiProjectDraftsController, 'confirm']).as('ai.drafts.confirm')
        // 审查页协商调整：看现状 → 预览重排 → 确认存成新草案版本（仍需审查后转正）。
        router
          .get('/:id/replan', [AiProjectDraftsController, 'replanAssessment'])
          .as('ai.drafts.replan')
        router
          .post('/:id/replan/preview', [AiProjectDraftsController, 'replanPreview'])
          .as('ai.drafts.replan.preview')
        router
          .post('/:id/replan/apply', [AiProjectDraftsController, 'replanApply'])
          .as('ai.drafts.replan.apply')
        router
          .post('/:id/replan/negotiate', [AiProjectDraftsController, 'negotiate'])
          .as('ai.drafts.replan.negotiate')
      })
      .prefix('/ai/project-drafts')
      .use(middleware.auth())

    // audit-log-critical-actions / T006 —— 审计日志查询端点
    // 权限由 rbac_middleware 校验 audit:view，sysadmin 全局 / org_admin 本组织。
    router
      .group(() => {
        router.get('/', [AuditLogsController, 'index']).as('audit_logs.index')
        router.get('/stats', [AuditLogsController, 'stats']).as('audit_logs.stats')
        router.get('/:id', [AuditLogsController, 'show']).as('audit_logs.show')
      })
      .prefix('/audit-logs')
      .use(middleware.auth())

    // notification-feedback-minimum + v2-notification-center —— 站内通知/V2 通知中心
    router
      .group(() => {
        router.get('/', [NotificationsController, 'index']).as('notifications.index')
        router
          .get('/unread-count', [NotificationsController, 'unreadCount'])
          .as('notifications.unread-count')
        router
          .patch('/:id/read', [NotificationsController, 'markRead'])
          .as('notifications.mark-read')
        router
          .patch('/read-all', [NotificationsController, 'markAllRead'])
          .as('notifications.mark-all-read')
        // V2 通知中心：批量操作
        router.post('/batch', [NotificationsController, 'batch']).as('notifications.batch')
      })
      .prefix('/notifications')
      .use(middleware.auth())

    // v2-collaboration-comments-mentions —— V2 评论系统
    // V2 统一实体评论路由（entityType + entityId 参数驱动）
    // V1 路由保持原路径兼容（无 entityType 时回退 V1 行为）
    router
      .group(() => {
        // V1 兼容：项目级评论列表/创建
        router
          .get('/v1-project', [CommentsController, 'indexProject'])
          .as('projects.comments.index-v1')
        router
          .post('/v1-project', [CommentsController, 'storeProject'])
          .as('projects.comments.store-v1')
        // V2 统一创建（需 entityType/entityId body 参数）
        router.post('/', [CommentsController, 'store']).as('v2.comments.store')
        // 统一列表
        router.get('/', [CommentsController, 'index']).as('v2.comments.index')
        // 提及候选
        router
          .get('/mention-candidates', [CommentsController, 'mentionCandidates'])
          .as('comments.mention-candidates')
      })
      .prefix('/projects/:projectId/comments')
      .use(middleware.auth())

    // 单条评论操作
    router
      .group(() => {
        router.get('/:commentId', [CommentsController, 'show']).as('comments.show')
        router.patch('/:commentId', [CommentsController, 'update']).as('comments.update')
        router.delete('/:commentId', [CommentsController, 'destroy']).as('comments.destroy')
        router.post('/:commentId/resolve', [CommentsController, 'resolve']).as('comments.resolve')
        router.post('/:commentId/reopen', [CommentsController, 'reopen']).as('comments.reopen')
      })
      .prefix('/projects/:projectId/comments')
      .use(middleware.auth())

    // V1 兼容：任务级评论
    router
      .group(() => {
        router.get('/', [CommentsController, 'indexTask']).as('projects.tasks.comments.index')
        router.post('/', [CommentsController, 'storeTask']).as('projects.tasks.comments.store')
      })
      .prefix('/projects/:projectId/tasks/:taskId/comments')
      .use(middleware.auth())

    // ai-structured-output-poc / M0 sandbox（dev-only，红线 1 硬保零落库，spec §1.1 决策 =
    // OpenAI 兼容 + response_format=json_schema/tool calling；未提供 key 时 Adapter 降级 Mock，
    // 结果**不得**用于 M0 判定）。
    router
      .group(() => {
        router.get('/inputs', [AiM0Controller, 'listInputs']).as('dev.ai-m0.inputs')
        router.post('/generate/once', [AiM0Controller, 'generateOnce']).as('dev.ai-m0.once')
        router.post('/generate/stream', [AiM0Controller, 'generateStream']).as('dev.ai-m0.stream')
        router.post('/evaluation/plan', [AiM0EvaluationsController, 'plan']).as('dev.ai-m0.plan')
        router
          .post('/evaluation/execute', [AiM0EvaluationsController, 'execute'])
          .as('dev.ai-m0.execute')
      })
      .prefix('/dev/ai-m0')
      .use([DevOnlyMiddleware, middleware.auth()])

    // v2-ai-draft-layer-preview-diff-apply —— Draft Layer API。
    router
      .group(() => {
        router.post('/sessions', [DraftLayerController, 'create']).as('draft-layer.sessions.create')
        router.get('/sessions/:id', [DraftLayerController, 'show']).as('draft-layer.sessions.show')
        router
          .post('/sessions/:id/preview', [DraftLayerController, 'preview'])
          .as('draft-layer.sessions.preview')
        router
          .get('/sessions/:id/diff', [DraftLayerController, 'diff'])
          .as('draft-layer.sessions.diff')
        router
          .post('/sessions/:id/decisions', [DraftLayerController, 'decide'])
          .as('draft-layer.sessions.decisions')
        router
          .post('/sessions/:id/bulk-decisions', [DraftLayerController, 'bulkDecide'])
          .as('draft-layer.sessions.bulk-decisions')
        router
          .post('/sessions/:id/dry-run', [DraftLayerController, 'dryRun'])
          .as('draft-layer.sessions.dry-run')
        router
          .post('/sessions/:id/apply', [DraftLayerController, 'apply'])
          .as('draft-layer.sessions.apply')
        router
          .post('/sessions/:id/discard', [DraftLayerController, 'discard'])
          .as('draft-layer.sessions.discard')
      })
      .prefix('/ai/draft-layer')
      .use(middleware.auth())

    // v3-copilot-memory-user-and-project —— Copilot 跨对话记忆 CRUD + 导出。
    const CopilotMemoryController = () => import('#controllers/copilot_memory_controller')
    router
      .group(() => {
        router.get('/', [CopilotMemoryController, 'index']).as('copilot-memory.index')
        router.get('/:id', [CopilotMemoryController, 'show']).as('copilot-memory.show')
        router
          .post('/:id/confirm', [CopilotMemoryController, 'confirm'])
          .as('copilot-memory.confirm')
        router.post('/:id/ignore', [CopilotMemoryController, 'ignore']).as('copilot-memory.ignore')
        router.patch('/:id', [CopilotMemoryController, 'update']).as('copilot-memory.update')
        router
          .post('/:id/invalidate', [CopilotMemoryController, 'invalidate'])
          .as('copilot-memory.invalidate')
        router.delete('/:id', [CopilotMemoryController, 'destroy']).as('copilot-memory.destroy')
        router.get('/export', [CopilotMemoryController, 'export']).as('copilot-memory.export')
      })
      .prefix('/ai/memory')
      .use(middleware.auth())

    // v3-copilot-action-and-preview-boundary —— Copilot 动作提交与确认（内部转交既有草案层）。
    const CopilotActionController = () => import('#controllers/copilot_action_controller')
    router
      .group(() => {
        router.post('/submit', [CopilotActionController, 'submit']).as('copilot-actions.submit')
        router.post('/confirm', [CopilotActionController, 'confirm']).as('copilot-actions.confirm')
      })
      .prefix('/ai/copilot-actions')
      .use(middleware.auth())

    // v3-copilot-general-purpose-mode —— 通用问答端点（global scope，结构性禁写）。
    const CopilotGeneralPurposeController = () =>
      import('#controllers/copilot_general_purpose_controller')
    router
      .group(() => {
        router
          .post('/', [CopilotGeneralPurposeController, 'handle'])
          .as('copilot-general-purpose.handle')
      })
      .prefix('/ai/general-purpose')
      .use(middleware.auth())

    // v3-ai-tools-orchestration-layer —— 平台级 AI 工具编排层（Server-Authoritative Tool Registry）。
    // 统一控制面：auth 中间件收敛身份认证；ai:trigger/ai:confirm 与工具级领域 RBAC、
    // 租户隔离（RL-05）与 RL-12 审计在 AiToolsExecutorService/AiToolsPolicy 内收敛。
    const AiToolsController = () => import('#controllers/ai_tools_controller')
    router
      .group(() => {
        router.get('/', [AiToolsController, 'index']).as('ai.tools.index')
        router.post('/execute', [AiToolsController, 'execute']).as('ai.tools.execute')
        router.post('/confirm', [AiToolsController, 'confirm']).as('ai.tools.confirm')
        router.post('/plan', [AiToolsController, 'plan']).as('ai.tools.plan')
        router.post('/member-names', [AiToolsController, 'memberNames']).as('ai.tools.member_names')
        router.post('/page-vision', [AiToolsController, 'pageVision']).as('ai.tools.page_vision')
        router
          .post('/suggest-replies', [AiToolsController, 'suggestReplies'])
          .as('ai.tools.suggest_replies')
        router
          .post('/theater-answer', [AiToolsController, 'theaterAnswer'])
          .as('ai.tools.theater_answer')
      })
      .prefix('/ai/tools')
      .use(middleware.auth())

    // v2-project-compiler-foundation —— Compiler API。
    router
      .group(() => {
        // v3-template-compiler-plugin-integration: template selection before runs
        router
          .get('/templates', [CompilerTemplateController, 'list'])
          .as('compiler.templates.index')
        router
          .get('/templates/:templateId', [CompilerTemplateController, 'getDetail'])
          .as('compiler.templates.show')
        router.post('/runs', [CompilerController, 'startRun']).as('compiler.runs.store')
        router.get('/runs/:id', [CompilerController, 'getRun']).as('compiler.runs.show')
        router.get('/runs/:id/events', [CompilerController, 'getEvents']).as('compiler.runs.events')
        router.get('/runs/:id/ledger', [CompilerController, 'getLedger']).as('compiler.runs.ledger')
        router.get('/runs/:id/pdm', [CompilerController, 'getPdm']).as('compiler.runs.pdm')
        router
          .get('/runs/:id/repair-history', [CompilerController, 'getRepairHistory'])
          .as('compiler.runs.repair-history')
        router.post('/runs/:id/resume', [CompilerController, 'resume']).as('compiler.runs.resume')
        router
          .get('/runs/:id/observability-summary', [CompilerController, 'getObservabilitySummary'])
          .as('compiler.runs.observability-summary')
        // v2-triz-compiler-analysis-layer —— TRIZ 分析 API
        router
          .get('/runs/:runId/triz-analysis', [TrizCompilerAnalysisController, 'index'])
          .as('compiler.runs.triz-analysis.index')
        router
          .get('/runs/:runId/triz-analysis/:artifactId', [TrizCompilerAnalysisController, 'show'])
          .as('compiler.runs.triz-analysis.show')
        router
          .post('/runs/:runId/triz-analysis/:artifactId/draft-handoff', [
            TrizCompilerAnalysisController,
            'handoff',
          ])
          .as('compiler.runs.triz-analysis.handoff')
        // v2-5-compiler-dynamic-routing-management-ui —— Routing 管理 API
        // 切片 A：只读观测
        router
          .get('/routing/rules', [CompilerRoutingController, 'getRules'])
          .as('compiler.routing.rules.index')
        router
          .get('/runs/:id/routing-decision', [CompilerRoutingController, 'getRunRoutingDecision'])
          .as('compiler.runs.routing-decision')
        // 切片 C：只读模拟
        router
          .post('/routing/simulate', [CompilerRoutingController, 'simulateRouting'])
          .as('compiler.routing.simulate')
        // 切片 B：受控编排（预览→确认两步）
        router
          .post('/routing/rules', [CompilerRoutingController, 'previewRule'])
          .as('compiler.routing.rules.preview')
        router
          .patch('/routing/rules', [CompilerRoutingController, 'confirmRule'])
          .as('compiler.routing.rules.confirm')

        // v2-5-compiler-config-management-api —— Compiler 配置管理
        // 切片 1：只读解析
        router
          .get('/config', [CompilerConfigController, 'getEffective'])
          .as('compiler.config.effective')
        router
          .get('/config/profile', [CompilerConfigController, 'getProfile'])
          .as('compiler.config.profile')
        // 切片 2：只读 preview/差异
        router
          .post('/config/preview', [CompilerConfigController, 'preview'])
          .as('compiler.config.preview')
        // 切片 3：受控编排写入
        router.post('/config', [CompilerConfigController, 'create']).as('compiler.config.create')
        router
          .patch('/config/activate', [CompilerConfigController, 'activate'])
          .as('compiler.config.activate')

        // v3-skill-registry-and-lifecycle —— Skill Registry API（D6/D9）
        // 切片 1：只读列表/详情/查询/匹配
        router.get('/skills', [CompilerSkillsController, 'index']).as('compiler.skills.index')
        router.get('/skills/:id', [CompilerSkillsController, 'show']).as('compiler.skills.show')
        router
          .post('/skills/match', [CompilerSkillsController, 'match'])
          .as('compiler.skills.match')
        // 切片 2：创建/编辑/删除（仅 draft，author 权限）
        router.post('/skills', [CompilerSkillsController, 'store']).as('compiler.skills.store')
        router
          .patch('/skills/:id', [CompilerSkillsController, 'update'])
          .as('compiler.skills.update')
        router
          .delete('/skills/:id', [CompilerSkillsController, 'destroy'])
          .as('compiler.skills.destroy')
        // 切片 3：受治理生命周期转移（manage 权限）
        router
          .post('/skills/:id/lifecycle', [CompilerSkillsController, 'lifecycle'])
          .as('compiler.skills.lifecycle')
        // v3-initial-skill-software-development —— 基于内置 Skill 创建副本（author 权限）
        router
          .post('/skills/:id/duplicate', [CompilerSkillsController, 'duplicate'])
          .as('compiler.skills.duplicate')
        // v3-skill-knowledge-authoring —— Skill 知识包创作子资源（D7）
        // 子资源挂载：/skills/:skillId/knowledge
        router
          .get('/skills/:skillId/knowledge/draft', [SkillKnowledgeAuthoringController, 'getDraft'])
          .as('compiler.skills.knowledge.draft.get')
        router
          .put('/skills/:skillId/knowledge/draft', [SkillKnowledgeAuthoringController, 'putDraft'])
          .as('compiler.skills.knowledge.draft.put')
        router
          .post('/skills/:skillId/knowledge/preview', [
            SkillKnowledgeAuthoringController,
            'preview',
          ])
          .as('compiler.skills.knowledge.preview')
        router
          .post('/skills/:skillId/knowledge/commit', [SkillKnowledgeAuthoringController, 'commit'])
          .as('compiler.skills.knowledge.commit')
        router
          .post('/skills/:skillId/knowledge/ai-assist', [
            SkillKnowledgeAuthoringController,
            'aiAssist',
          ])
          .as('compiler.skills.knowledge.ai-assist')
        // 切片 2：只读失效预览（no-delete/no-execute）
        router
          .post('/cache/invalidation/preview', [CompilerCacheController, 'previewInvalidation'])
          .as('compiler.cache.invalidation.preview')

        // 切片 1：缓存清单只读（此前漏注册路由，GET /cache 恒 404；
        // 由 v3-backend-type-debt-closure 全量回归暴露后补登记）
        router
          .get('/cache', [CompilerCacheController, 'getInventory'])
          .as('compiler.cache.inventory')

        // v3-skill-eval-system —— Skill 评估子资源（eval 权限 + feature flag 守卫）
        router
          .group(() => {
            const SkillEvalController = () => import('#controllers/compiler/skill_eval_controller')
            router
              .post('/quality', [SkillEvalController, 'runQuality'])
              .as('compiler.skills.eval.quality')
            router
              .post('/benchmark', [SkillEvalController, 'runBenchmark'])
              .as('compiler.skills.eval.benchmark')
            router
              .get('/reports', [SkillEvalController, 'listReports'])
              .as('compiler.skills.eval.reports')
            router
              .get('/reports/:id', [SkillEvalController, 'getReport'])
              .as('compiler.skills.eval.report')
            router
              .get('/effect-metrics', [SkillEvalController, 'getEffectMetrics'])
              .as('compiler.skills.eval.metrics')
            router
              .post('/ai-assist', [SkillEvalController, 'aiAssist'])
              .as('compiler.skills.eval.ai-assist')
          })
          .prefix('/skills/:skillId/eval')
          .use(middleware.skillEvalFeatureGuard())
          .as('compiler.skills.eval.ai-assist')
        // 切片 3：受控失效写入（需显式确认 + 审计）
        router
          .post('/cache/invalidation', [CompilerCacheController, 'invalidate'])
          .as('compiler.cache.invalidation')
      })
      .prefix('/ai/compiler')
      .use(middleware.auth())

    // dev-only 调试入口（只用于快速验证骨架编译）
    router
      .group(() => {
        router.get('/dev/compiler/status', async ({ response }) => {
          return response.ok({ message: 'Compiler debug endpoints ready (dev-only)' })
        })
      })
      .prefix('/ai')
      .use([DevOnlyMiddleware, middleware.auth()])

    // v3-four-layer-knowledge-system —— 四层知识底座 API
    router
      .group(() => {
        // 检索/列表（view 权限）
        router.get('/', [KnowledgeController, 'index']).as('knowledge.index')
        router.get('/:id', [KnowledgeController, 'show']).as('knowledge.show')
        // 创建（author 权限）
        router.post('/', [KnowledgeController, 'create']).as('knowledge.create')
        // 人工确认转正（manage 权限）
        router.post('/:id/confirm', [KnowledgeController, 'confirm']).as('knowledge.confirm')
        // 生命周期转移（manage 权限）
        router
          .post('/:id/transition', [KnowledgeController, 'transitionLifecycle'])
          .as('knowledge.transition')
        // AI 结构化（author 权限）
        router.post('/structure', [KnowledgeController, 'structure']).as('knowledge.structure')
      })
      .prefix('/knowledge')
      .use(middleware.auth())

    // v2-traceability-source-attribution —— Traceability API。
    router
      .group(() => {
        router
          .get('/runs/:runId/attributions', [TraceabilityController, 'listByCompilerRun'])
          .as('traceability.attributions.list')
        router
          .get('/runs/:runId/attributions/:id', [TraceabilityController, 'getAttribution'])
          .as('traceability.attributions.show')
        router
          .get('/projects/:projectId/entities/:entityType/:entityId/source-attribution', [
            TraceabilityController,
            'getEntitySourceAttribution',
          ])
          .as('traceability.entity.attribution')
        router
          .get('/projects/:projectId/traceability/links', [
            TraceabilityController,
            'listProjectTraceabilityLinks',
          ])
          .as('traceability.links.list')
      })
      .prefix('/ai/compiler')
      .use(middleware.auth())

    // v2-advanced-search —— 高级搜索
    router
      .group(() => {
        router.post('/', [SearchController, 'search']).as('search.exec')
        router.get('/suggestions', [SearchController, 'suggestions']).as('search.suggestions')
      })
      .prefix('/search')
      .use(middleware.auth())

    // v2-5-pwa-web-push-notifications —— PWA Web Push 推送订阅
    const PwaWebPushController = () => import('#controllers/pwa_web_push_controller')
    // 能力状态端点公开（无需认证）
    router.get('/push/capability', [PwaWebPushController, 'capability']).as('push.capability')
    // 订阅管理端点需要认证
    router
      .group(() => {
        router
          .get('/subscription', [PwaWebPushController, 'subscriptionStatus'])
          .as('push.subscription-status')
        router.post('/subscribe', [PwaWebPushController, 'subscribe']).as('push.subscribe')
        router.post('/unsubscribe', [PwaWebPushController, 'unsubscribe']).as('push.unsubscribe')
      })
      .prefix('/push')
      .use(middleware.auth())

    // v3-organization-dashboard-layout-builder —— 组织 Dashboard 布局编排 API
    const OrganizationDashboardLayoutController = () =>
      import('#controllers/organization_dashboard_layout_controller')
    router
      .group(() => {
        router
          .get('/', [OrganizationDashboardLayoutController, 'index'])
          .as('organizations.dashboard.layouts.index')
        router
          .get('/current', [OrganizationDashboardLayoutController, 'current'])
          .as('organizations.dashboard.layouts.current')
        router
          .get('/:layoutId', [OrganizationDashboardLayoutController, 'show'])
          .as('organizations.dashboard.layouts.show')
        router
          .post('/preview', [OrganizationDashboardLayoutController, 'preview'])
          .as('organizations.dashboard.layouts.preview')
        router
          .post('/personal', [OrganizationDashboardLayoutController, 'savePersonal'])
          .as('organizations.dashboard.layouts.personal.store')
        router
          .post('/shared', [OrganizationDashboardLayoutController, 'saveShared'])
          .as('organizations.dashboard.layouts.shared.store')
        router
          .post('/:layoutId/copy', [OrganizationDashboardLayoutController, 'copy'])
          .as('organizations.dashboard.layouts.copy')
        router
          .put('/:layoutId/default', [OrganizationDashboardLayoutController, 'setDefault'])
          .as('organizations.dashboard.layouts.default')
        router
          .post('/reset', [OrganizationDashboardLayoutController, 'reset'])
          .as('organizations.dashboard.layouts.reset')
        router
          .delete('/:layoutId', [OrganizationDashboardLayoutController, 'destroy'])
          .as('organizations.dashboard.layouts.destroy')
      })
      .prefix('/organizations/:organizationId/dashboard/layouts')
      .use(middleware.auth())

    // v3-pmo-portfolio-dashboard —— PMO 组合 Dashboard 只读 API
    const PortfolioDashboardController = () => import('#controllers/portfolio_dashboard_controller')
    router
      .group(() => {
        router
          .get('/', [PortfolioDashboardController, 'summary'])
          .as('pmo.portfolio-dashboard.summary')
        router
          .get('/projects', [PortfolioDashboardController, 'projects'])
          .as('pmo.portfolio-dashboard.projects')
        router
          .get('/groups', [PortfolioDashboardController, 'groups'])
          .as('pmo.portfolio-dashboard.groups')
        router
          .get('/trends', [PortfolioDashboardController, 'trends'])
          .as('pmo.portfolio-dashboard.trends')
        router
          .get('/metrics/:metricKey', [PortfolioDashboardController, 'metricDetail'])
          .as('pmo.portfolio-dashboard.metrics.show')
      })
      .prefix('/pmo/portfolio-dashboard')
      .use(middleware.auth())

    // v3-pmo-portfolio-grouping-views —— PMO 组合分组视图受控写入 API
    const PortfolioGroupingViewController = () =>
      import('#controllers/portfolio_grouping_view_controller')
    router
      .group(() => {
        router.get('/', [PortfolioGroupingViewController, 'index']).as('pmo.grouping-views.list')
        router
          .post('/preview', [PortfolioGroupingViewController, 'preview'])
          .as('pmo.grouping-views.preview')
        router
          .get('/:id', [PortfolioGroupingViewController, 'show'])
          .as('pmo.grouping-views.detail')
        router.post('/', [PortfolioGroupingViewController, 'store']).as('pmo.grouping-views.store')
        router
          .put('/:id', [PortfolioGroupingViewController, 'update'])
          .as('pmo.grouping-views.update')
        router
          .delete('/:id', [PortfolioGroupingViewController, 'destroy'])
          .as('pmo.grouping-views.destroy')
        router
          .post('/:id/duplicate', [PortfolioGroupingViewController, 'duplicate'])
          .as('pmo.grouping-views.duplicate')
        router
          .post('/:id/set-default', [PortfolioGroupingViewController, 'setDefault'])
          .as('pmo.grouping-views.set-default')
      })
      .prefix('/pmo/grouping-views')
      .use(middleware.auth())

    // v3-resource-skill-matrix —— 资源技能矩阵只读 API
    const ResourceSkillMatrixController = () =>
      import('#controllers/resource_skill_matrix_controller')
    router
      .group(() => {
        router
          .get('/summary', [ResourceSkillMatrixController, 'summary'])
          .as('organization.resource-skill-matrix.summary')
        router
          .get('/matrix', [ResourceSkillMatrixController, 'matrix'])
          .as('organization.resource-skill-matrix.matrix')
        router
          .get('/coverage', [ResourceSkillMatrixController, 'coverage'])
          .as('organization.resource-skill-matrix.coverage')
        router
          .get('/gaps', [ResourceSkillMatrixController, 'gaps'])
          .as('organization.resource-skill-matrix.gaps')
        router
          .get('/candidates', [ResourceSkillMatrixController, 'candidates'])
          .as('organization.resource-skill-matrix.candidates')
        router
          .get('/skill-detail', [ResourceSkillMatrixController, 'skillDetail'])
          .as('organization.resource-skill-matrix.skill-detail')
        router
          .get('/drill-down', [ResourceSkillMatrixController, 'drillDown'])
          .as('organization.resource-skill-matrix.drill-down')
      })
      .prefix('/organizations/:organizationId/resource-skill-matrix')
      .use(middleware.auth())

    // v3-resource-demand-forecasting —— 资源需求预测只读 API
    router
      .group(() => {
        router
          .get('/summary', [ResourceDemandForecastingController, 'summary'])
          .as('organizations.resource-demand-forecasting.summary')
        router
          .get('/demand-curves', [ResourceDemandForecastingController, 'demandCurves'])
          .as('organizations.resource-demand-forecasting.demand-curves')
        router
          .get('/gap-analysis', [ResourceDemandForecastingController, 'gapAnalysis'])
          .as('organizations.resource-demand-forecasting.gap-analysis')
        router
          .get('/project-drivers', [ResourceDemandForecastingController, 'projectDrivers'])
          .as('organizations.resource-demand-forecasting.project-drivers')
        router
          .get('/skill-drivers', [ResourceDemandForecastingController, 'skillDrivers'])
          .as('organizations.resource-demand-forecasting.skill-drivers')
        router
          .get('/trend-baseline', [ResourceDemandForecastingController, 'trendBaseline'])
          .as('organizations.resource-demand-forecasting.trend-baseline')
        router
          .get('/drill-down', [ResourceDemandForecastingController, 'drillDown'])
          .as('organizations.resource-demand-forecasting.drill-down')
        router
          .get('/ai-advisory', [ResourceDemandForecastingController, 'aiAdvisory'])
          .as('organizations.resource-demand-forecasting.ai-advisory')
      })
      .prefix('/organizations/:organizationId/resource-demand-forecasting')
      .use(middleware.auth())

    // v3-organization-resource-pool —— 组织资源池只读 API
    router
      .group(() => {
        router
          .get('/catalogue', [OrganizationResourcePoolController, 'catalogue'])
          .as('organizations.resource-pool.catalogue')
        router
          .get('/summary', [OrganizationResourcePoolController, 'summary'])
          .as('organizations.resource-pool.summary')
        router
          .get('/resources', [OrganizationResourcePoolController, 'resources'])
          .as('organizations.resource-pool.resources')
        router
          .get('/skills', [OrganizationResourcePoolController, 'skills'])
          .as('organizations.resource-pool.skills')
        router
          .get('/capacity', [OrganizationResourcePoolController, 'capacity'])
          .as('organizations.resource-pool.capacity')
        router
          .get('/conflicts', [OrganizationResourcePoolController, 'conflicts'])
          .as('organizations.resource-pool.conflicts')
        router
          .get('/demand-gaps', [OrganizationResourcePoolController, 'demandGaps'])
          .as('organizations.resource-pool.demand-gaps')
        router
          .get('/drill-down', [OrganizationResourcePoolController, 'drillDown'])
          .as('organizations.resource-pool.drill-down')
      })
      .prefix('/organizations/:organizationId/resource-pool')
      .use(middleware.auth())

    // v3-resource-gap-analysis —— 组织级资源缺口分析只读 API
    router
      .group(() => {
        router
          .get('/summary', [ResourceGapAnalysisController, 'summary'])
          .as('organizations.resource-gaps.summary')
        router
          .get('/by-role', [ResourceGapAnalysisController, 'byRole'])
          .as('organizations.resource-gaps.by-role')
        router
          .get('/by-skill', [ResourceGapAnalysisController, 'bySkill'])
          .as('organizations.resource-gaps.by-skill')
        router
          .get('/by-timebucket', [ResourceGapAnalysisController, 'byTimebucket'])
          .as('organizations.resource-gaps.by-timebucket')
        router
          .get('/by-project', [ResourceGapAnalysisController, 'byProject'])
          .as('organizations.resource-gaps.by-project')
        router
          .get('/by-portfolio', [ResourceGapAnalysisController, 'byPortfolio'])
          .as('organizations.resource-gaps.by-portfolio')
        router
          .get('/explanation', [ResourceGapAnalysisController, 'explanation'])
          .as('organizations.resource-gaps.explanation')
        router
          .get('/drill-down', [ResourceGapAnalysisController, 'drillDown'])
          .as('organizations.resource-gaps.drill-down')
      })
      .prefix('/organizations/:organizationId/resource-gaps')
      .use(middleware.auth())

    // v3-cross-project-resource-allocation —— 跨项目资源调配 API
    router
      .group(() => {
        // 草案 CRUD
        router
          .post('/drafts', [CrossProjectAllocationController, 'createDraft'])
          .as('organizations.cross-project-allocations.drafts.create')
        router
          .get('/drafts', [CrossProjectAllocationController, 'listDrafts'])
          .as('organizations.cross-project-allocations.drafts.list')
        router
          .get('/drafts/:draftId', [CrossProjectAllocationController, 'getDraft'])
          .as('organizations.cross-project-allocations.drafts.show')
        router
          .put('/drafts/:draftId/items', [CrossProjectAllocationController, 'updateItems'])
          .as('organizations.cross-project-allocations.drafts.items.update')

        // 预览 / 确认 / 应用 / 取消
        router
          .post('/drafts/:draftId/preview', [CrossProjectAllocationController, 'previewDraft'])
          .as('organizations.cross-project-allocations.drafts.preview')
        router
          .post('/drafts/:draftId/confirm', [CrossProjectAllocationController, 'confirmDraft'])
          .as('organizations.cross-project-allocations.drafts.confirm')
        router
          .post('/drafts/:draftId/apply', [CrossProjectAllocationController, 'applyDraft'])
          .as('organizations.cross-project-allocations.drafts.apply')
        router
          .post('/drafts/:draftId/cancel', [CrossProjectAllocationController, 'cancelDraft'])
          .as('organizations.cross-project-allocations.drafts.cancel')

        // 候选 / 冲突 / 下钻
        router
          .get('/candidates', [CrossProjectAllocationController, 'listCandidates'])
          .as('organizations.cross-project-allocations.candidates')
        router
          .get('/drafts/:draftId/conflicts', [CrossProjectAllocationController, 'listConflicts'])
          .as('organizations.cross-project-allocations.drafts.conflicts')
        router
          .get('/drill-down', [CrossProjectAllocationController, 'drillDown'])
          .as('organizations.cross-project-allocations.drill-down')
      })
      .prefix('/organizations/:organizationId/cross-project-resource-allocations')
      .use(middleware.auth())
      .use(middleware.crossProjectAllocationFeatureGuard())

    // v3-resource-contention-detection —— 资源争用检测只读 API
    router
      .group(() => {
        router
          .get('/summary', [ResourceContentionDetectionController, 'summary'])
          .as('organizations.resource-contentions.summary')
        router
          .get('/items', [ResourceContentionDetectionController, 'items'])
          .as('organizations.resource-contentions.items')
        router
          .get('/matrix', [ResourceContentionDetectionController, 'matrix'])
          .as('organizations.resource-contentions.matrix')
        router
          .get('/:contentionId', [ResourceContentionDetectionController, 'detail'])
          .as('organizations.resource-contentions.detail')
        router
          .get('/:contentionId/evidence', [ResourceContentionDetectionController, 'evidence'])
          .as('organizations.resource-contentions.evidence')
        router
          .get('/:contentionId/suggestions', [ResourceContentionDetectionController, 'suggestions'])
          .as('organizations.resource-contentions.suggestions')
      })
      .prefix('/organizations/:organizationId/resource-contentions')
      .use(middleware.auth())

    // v3-okr-hierarchy-management —— OKR 层级管理 API
    router
      .group(() => {
        // Cycles
        router.get('/cycles', [OkrController, 'listCycles']).as('organizations.okr.cycles.list')
        router.post('/cycles', [OkrController, 'createCycle']).as('organizations.okr.cycles.create')
        router
          .get('/cycles/:cycleId', [OkrController, 'getCycle'])
          .as('organizations.okr.cycles.show')
        router
          .put('/cycles/:cycleId', [OkrController, 'updateCycle'])
          .as('organizations.okr.cycles.update')
        router
          .post('/cycles/:cycleId/archive', [OkrController, 'archiveCycle'])
          .as('organizations.okr.cycles.archive')
        router
          .post('/cycles/:cycleId/restore', [OkrController, 'restoreCycle'])
          .as('organizations.okr.cycles.restore')

        // Objectives
        router
          .get('/objectives', [OkrController, 'listObjectives'])
          .as('organizations.okr.objectives.list')
        router
          .post('/objectives', [OkrController, 'createObjective'])
          .as('organizations.okr.objectives.create')
        router
          .get('/objectives/:objectiveId', [OkrController, 'getObjective'])
          .as('organizations.okr.objectives.show')
        router
          .put('/objectives/:objectiveId', [OkrController, 'updateObjective'])
          .as('organizations.okr.objectives.update')
        router
          .post('/objectives/:objectiveId/archive', [OkrController, 'archiveObjective'])
          .as('organizations.okr.objectives.archive')
        router
          .post('/objectives/:objectiveId/restore', [OkrController, 'restoreObjective'])
          .as('organizations.okr.objectives.restore')

        // Tree
        router.get('/tree', [OkrController, 'getTree']).as('organizations.okr.tree')

        // Key Results
        router
          .get('/key-results', [OkrController, 'listKeyResults'])
          .as('organizations.okr.key-results.list')
        router
          .post('/key-results', [OkrController, 'createKeyResult'])
          .as('organizations.okr.key-results.create')
        router
          .get('/key-results/:keyResultId', [OkrController, 'getKeyResult'])
          .as('organizations.okr.key-results.show')
        router
          .put('/key-results/:keyResultId', [OkrController, 'updateKeyResult'])
          .as('organizations.okr.key-results.update')
        router
          .post('/key-results/:keyResultId/archive', [OkrController, 'archiveKeyResult'])
          .as('organizations.okr.key-results.archive')

        // Progress
        router
          .post('/key-results/:keyResultId/progress', [OkrController, 'updateProgress'])
          .as('organizations.okr.key-results.progress')
        router
          .get('/key-results/:keyResultId/progress-history', [OkrController, 'getProgressHistory'])
          .as('organizations.okr.key-results.progress-history')

        // Alignments
        router
          .post('/alignments', [OkrController, 'createAlignment'])
          .as('organizations.okr.alignments.create')
        router
          .delete('/alignments/:alignmentId', [OkrController, 'removeAlignment'])
          .as('organizations.okr.alignments.remove')
        router
          .get('/objectives/:objectiveId/alignments', [OkrController, 'listAlignments'])
          .as('organizations.okr.alignments.list')

        // Evidence
        router
          .post('/evidence', [OkrController, 'createEvidence'])
          .as('organizations.okr.evidence.create')
        router
          .get('/evidence', [OkrController, 'listEvidence'])
          .as('organizations.okr.evidence.list')

        // AI Draft
        router
          .post('/ai-drafts', [OkrController, 'generateAiDraft'])
          .as('organizations.okr.ai-drafts.generate')
        router
          .post('/ai-drafts/confirm', [OkrController, 'confirmAiDraft'])
          .as('organizations.okr.ai-drafts.confirm')

        // Backflow
        router
          .get('/backflow/suggestions', [OkrProgressBackflowController, 'listSuggestions'])
          .as('organizations.okr.backflow.suggestions.list')
        router
          .get('/backflow/suggestions/:suggestionId', [
            OkrProgressBackflowController,
            'getSuggestion',
          ])
          .as('organizations.okr.backflow.suggestions.show')
        router
          .post('/backflow/recalculate', [OkrProgressBackflowController, 'recalculateKeyResult'])
          .as('organizations.okr.backflow.recalculate')
        router
          .post('/backflow/batch-recalculate', [OkrProgressBackflowController, 'batchRecalculate'])
          .as('organizations.okr.backflow.batch-recalculate')
        router
          .post('/backflow/confirm', [OkrProgressBackflowController, 'confirmSuggestion'])
          .as('organizations.okr.backflow.confirm')
        router
          .post('/backflow/reject', [OkrProgressBackflowController, 'rejectSuggestion'])
          .as('organizations.okr.backflow.reject')

        // v3-okr-cascade-and-alignment —— OKR 级联与对齐 API
        const OkrCascadeAlignmentController = () =>
          import('#controllers/okr_cascade_alignment_controller')
        router
          .post('/cascade-plans', [OkrCascadeAlignmentController, 'createCascadePlan'])
          .as('organizations.okr.cascade-plans.create')
        router
          .get('/cascade-plans', [OkrCascadeAlignmentController, 'listCascadePlans'])
          .as('organizations.okr.cascade-plans.list')
        router
          .get('/cascade-plans/:planId', [OkrCascadeAlignmentController, 'getCascadePlan'])
          .as('organizations.okr.cascade-plans.show')
        router
          .post('/cascade-plans/:planId/confirm', [
            OkrCascadeAlignmentController,
            'confirmCascadeItems',
          ])
          .as('organizations.okr.cascade-plans.confirm')
        router
          .post('/cascade-plans/:planId/reject', [
            OkrCascadeAlignmentController,
            'rejectCascadeItems',
          ])
          .as('organizations.okr.cascade-plans.reject')

        // Cross-objective relations
        router
          .post('/relations', [OkrCascadeAlignmentController, 'createRelation'])
          .as('organizations.okr.relations.create')
        router
          .get('/relations', [OkrCascadeAlignmentController, 'listRelations'])
          .as('organizations.okr.relations.list')
        router
          .get('/relations/:relationId', [OkrCascadeAlignmentController, 'getRelation'])
          .as('organizations.okr.relations.show')
        router
          .put('/relations/:relationId', [OkrCascadeAlignmentController, 'updateRelation'])
          .as('organizations.okr.relations.update')
        router
          .post('/relations/:relationId/archive', [
            OkrCascadeAlignmentController,
            'archiveRelation',
          ])
          .as('organizations.okr.relations.archive')

        // Health
        router
          .get('/objectives/:objectiveId/health', [OkrCascadeAlignmentController, 'getHealth'])
          .as('organizations.okr.health.show')
        router
          .get('/health', [OkrCascadeAlignmentController, 'listHealth'])
          .as('organizations.okr.health.list')

        // Matrix
        router
          .get('/matrix', [OkrCascadeAlignmentController, 'getMatrix'])
          .as('organizations.okr.matrix')

        // AI cascade suggestions
        router
          .post('/ai-cascade-suggestions', [
            OkrCascadeAlignmentController,
            'generateAiCascadeSuggestions',
          ])
          .as('organizations.okr.ai-cascade-suggestions')

        // v3-okr-dashboard —— OKR 只读 Dashboard 摘要
        router
          .get('/dashboard', [OkrDashboardController, 'summary'])
          .as('organizations.okr.dashboard.summary')
      })
      .prefix('/organizations/:organizationId/okrs')
      .use(middleware.auth())

    // v3-organization-dashboard —— 组织级 Dashboard 只读摘要
    const OrganizationDashboardController = () =>
      import('#controllers/organization_dashboard_controller')
    router
      .group(() => {
        router
          .get('/', [OrganizationDashboardController, 'show'])
          .as('organizations.dashboard.show')
      })
      .prefix('/organizations/:organizationId/dashboard')
      .use(middleware.auth())

    // v3-strategy-execution-cockpit —— 战略执行驾驶舱只读摘要
    const StrategyExecutionCockpitController = () =>
      import('#controllers/strategy_execution_cockpit_controller')
    router
      .group(() => {
        router
          .get('/', [StrategyExecutionCockpitController, 'show'])
          .as('organizations.strategy-execution-cockpit.show')
      })
      .prefix('/organizations/:organizationId/strategy-execution-cockpit')
      .use(middleware.auth())

    // v3-resource-capacity-forecasting-closed-loop —— 组织级容量闭环（feature flag 关闭时零数据）
    router
      .group(() => {
        router
          .get('/catalogue', [ResourceCapacityLoopController, 'index'])
          .as('organizations.resource-capacity-loops.catalogue')
        router
          .post('/', [ResourceCapacityLoopController, 'store'])
          .as('organizations.resource-capacity-loops.store')
        router
          .get('/', [ResourceCapacityLoopController, 'index'])
          .as('organizations.resource-capacity-loops.index')
        router
          .get('/:loopId', [ResourceCapacityLoopController, 'show'])
          .as('organizations.resource-capacity-loops.show')
        router
          .post('/:loopId/baseline-refresh', [ResourceCapacityLoopController, 'refreshBaseline'])
          .as('organizations.resource-capacity-loops.baseline-refresh')
        router
          .post('/:loopId/scenarios', [ResourceCapacityLoopController, 'storeScenario'])
          .as('organizations.resource-capacity-loops.scenarios.store')
        router
          .post('/:loopId/simulate', [ResourceCapacityLoopController, 'simulate'])
          .as('organizations.resource-capacity-loops.simulate')
        router
          .post('/:loopId/select', [ResourceCapacityLoopController, 'select'])
          .as('organizations.resource-capacity-loops.select')
        router
          .post('/:loopId/handoff', [ResourceCapacityLoopController, 'handoff'])
          .as('organizations.resource-capacity-loops.handoff')
        router
          .get('/:loopId/handoffs/:receiptId/status', [
            ResourceCapacityLoopController,
            'handoffStatus',
          ])
          .as('organizations.resource-capacity-loops.handoff-status')
        router
          .post('/:loopId/observations', [ResourceCapacityLoopController, 'captureObservation'])
          .as('organizations.resource-capacity-loops.observations')
        router
          .post('/:loopId/review', [ResourceCapacityLoopController, 'review'])
          .as('organizations.resource-capacity-loops.review')
        router
          .post('/:loopId/close', [ResourceCapacityLoopController, 'close'])
          .as('organizations.resource-capacity-loops.close')
        router
          .post('/:loopId/cancel', [ResourceCapacityLoopController, 'cancel'])
          .as('organizations.resource-capacity-loops.cancel')
      })
      .prefix('/organizations/:organizationId/resource-capacity-loops')
      .use(middleware.auth())

    // v3-pmo-decision-intelligence-workbench —— PMO 决策工作台（feature flag 可回滚）
    const DecisionWorkbenchController = () => import('#controllers/decision_workbench_controller')
    router
      .group(() => {
        // 决策议题队列与生命周期
        router
          .get('/cases', [DecisionWorkbenchController, 'index'])
          .as('organizations.decision-workbench.cases.index')
        router
          .post('/cases', [DecisionWorkbenchController, 'store'])
          .as('organizations.decision-workbench.cases.store')
        router
          .get('/cases/:decisionId', [DecisionWorkbenchController, 'show'])
          .as('organizations.decision-workbench.cases.show')
        router
          .put('/cases/:decisionId', [DecisionWorkbenchController, 'update'])
          .as('organizations.decision-workbench.cases.update')
        router
          .post('/cases/:decisionId/transition', [DecisionWorkbenchController, 'transition'])
          .as('organizations.decision-workbench.cases.transition')
        // 方案
        router
          .get('/cases/:decisionId/options', [DecisionWorkbenchController, 'listOptions'])
          .as('organizations.decision-workbench.options.index')
        router
          .post('/cases/:decisionId/options', [DecisionWorkbenchController, 'createOption'])
          .as('organizations.decision-workbench.options.store')
        router
          .post('/cases/:decisionId/options/deactivate', [
            DecisionWorkbenchController,
            'deactivateOption',
          ])
          .as('organizations.decision-workbench.options.deactivate')
        // 参与者立场
        router
          .get('/cases/:decisionId/positions', [DecisionWorkbenchController, 'listPositions'])
          .as('organizations.decision-workbench.positions.index')
        router
          .post('/cases/:decisionId/positions', [DecisionWorkbenchController, 'recordPosition'])
          .as('organizations.decision-workbench.positions.store')
        // 证据快照
        router
          .post('/cases/:decisionId/evidence/refresh', [
            DecisionWorkbenchController,
            'refreshEvidence',
          ])
          .as('organizations.decision-workbench.evidence.refresh')
        router
          .get('/cases/:decisionId/evidence/snapshots', [
            DecisionWorkbenchController,
            'listSnapshots',
          ])
          .as('organizations.decision-workbench.evidence.snapshots')
        // 对比与 readiness
        router
          .get('/cases/:decisionId/comparison', [DecisionWorkbenchController, 'compare'])
          .as('organizations.decision-workbench.comparison.show')
        router
          .post('/cases/:decisionId/readiness', [DecisionWorkbenchController, 'readiness'])
          .as('organizations.decision-workbench.readiness.check')
        // 人工结论（唯一终态入口；无 apply/confirm）
        router
          .post('/cases/:decisionId/outcomes', [DecisionWorkbenchController, 'submitOutcome'])
          .as('organizations.decision-workbench.outcomes.store')
        router
          .get('/cases/:decisionId/outcomes', [DecisionWorkbenchController, 'listOutcomes'])
          .as('organizations.decision-workbench.outcomes.index')
        // 受控 handoff
        router
          .post('/cases/:decisionId/handoffs', [DecisionWorkbenchController, 'createHandoff'])
          .as('organizations.decision-workbench.handoffs.store')
        router
          .get('/cases/:decisionId/handoffs', [DecisionWorkbenchController, 'listHandoffs'])
          .as('organizations.decision-workbench.handoffs.index')
        // 闭集 target 目录
        router
          .get('/handoff-targets', [DecisionWorkbenchController, 'targets'])
          .as('organizations.decision-workbench.targets')
        // 可选 advisory lens（显式触发；输出仅为非信任草稿评注，不进入确定性核心）
        router
          .post('/cases/:decisionId/ai/narrative', [DecisionWorkbenchController, 'aiNarrative'])
          .as('organizations.decision-workbench.ai.narrative')
        router
          .post('/cases/:decisionId/plugin-lens', [DecisionWorkbenchController, 'pluginLens'])
          .as('organizations.decision-workbench.lens.execute')
      })
      .prefix('/organizations/:organizationId/pmo/decision-workbench')
      .use(middleware.auth())

    // v3-pmo-portfolio-traffic-light —— PMO 组合交通灯只读 API + 复核标记
    const PortfolioTrafficLightController = () =>
      import('#controllers/portfolio_traffic_light_controller')
    router
      .group(() => {
        router.get('/', [PortfolioTrafficLightController, 'index']).as('pmo.traffic-light.index')
        router
          .get('/counts', [PortfolioTrafficLightController, 'counts'])
          .as('pmo.traffic-light.counts')
        router
          .get('/:projectId', [PortfolioTrafficLightController, 'show'])
          .as('pmo.traffic-light.show')
        router
          .post('/:projectId/review', [PortfolioTrafficLightController, 'review'])
          .as('pmo.traffic-light.review')
      })
      .prefix('/pmo/traffic-light')
      .use(middleware.auth())

    // v3-pmo-investment-distribution —— PMO 投资分布只读 API（此前控制器已实现但路由漏注册，
    // 全部端点 404；v3-backend-type-debt-closure 全量回归暴露后补登记）
    const PmoInvestmentDistributionController = () =>
      import('#controllers/pmo_investment_distribution_controller')
    router
      .group(() => {
        router
          .get('/', [PmoInvestmentDistributionController, 'summary'])
          .as('pmo.investment-distribution.summary')
        router
          .get('/catalogue', [PmoInvestmentDistributionController, 'catalogue'])
          .as('pmo.investment-distribution.catalogue')
        router
          .get('/trends', [PmoInvestmentDistributionController, 'trends'])
          .as('pmo.investment-distribution.trends')
        router
          .get('/buckets/:bucketKey', [PmoInvestmentDistributionController, 'drillDown'])
          .as('pmo.investment-distribution.drill-down')
      })
      .prefix('/pmo/investment-distribution')
      .use(middleware.auth())

    // v3-pmo-priority-scoring-model —— PMO 优先级评分只读 API
    const PortfolioPriorityScoringController = () =>
      import('#controllers/portfolio_priority_scoring_controller')
    router
      .group(() => {
        router
          .get('/summary', [PortfolioPriorityScoringController, 'summary'])
          .as('pmo.priority-scoring.summary')
        router
          .get('/projects', [PortfolioPriorityScoringController, 'projects'])
          .as('pmo.priority-scoring.projects')
        router
          .get('/groups', [PortfolioPriorityScoringController, 'groups'])
          .as('pmo.priority-scoring.groups')
        router
          .get('/weights', [PortfolioPriorityScoringController, 'weights'])
          .as('pmo.priority-scoring.weights')
        router
          .get('/projects/:id', [PortfolioPriorityScoringController, 'projectDetail'])
          .as('pmo.priority-scoring.projects.show')
      })
      .prefix('/pmo/priority-scoring')
      .use(middleware.auth())

    // v3-pmo-ai-priority-recommendations —— PMO AI 优先级推荐 API（缺口 G1 补注册：
    // 控制器早已实现但从未登记路由，全部端点运行期 404；v3-ui-next-pmo-domain W9 ·
    // tasks 9.6 按控制器头部声明的端点全集补登记，route name 前缀
    // pmo.ai-priority-recommendations.*。动作内沿用 PmoAiPriorityRecommendationPolicy
    // 授权，不做 ROUTE_PERMISSION_RULES 注册——与相邻 PMO 组保持一致）
    const PmoAiPriorityRecommendationsController = () =>
      import('#controllers/pmo_ai_priority_recommendations_controller')
    router
      .group(() => {
        router
          .get('/', [PmoAiPriorityRecommendationsController, 'index'])
          .as('pmo.ai-priority-recommendations.index')
        router
          .get('/summary', [PmoAiPriorityRecommendationsController, 'summary'])
          .as('pmo.ai-priority-recommendations.summary')
        router
          .get('/:id', [PmoAiPriorityRecommendationsController, 'show'])
          .as('pmo.ai-priority-recommendations.show')
        router
          .post('/refresh', [PmoAiPriorityRecommendationsController, 'refresh'])
          .as('pmo.ai-priority-recommendations.refresh')
        router
          .post('/:id/ai-rationale', [PmoAiPriorityRecommendationsController, 'aiRationale'])
          .as('pmo.ai-priority-recommendations.ai-rationale')
        router
          .post('/:id/status', [PmoAiPriorityRecommendationsController, 'updateStatus'])
          .as('pmo.ai-priority-recommendations.update-status')
      })
      .prefix('/pmo/ai-priority-recommendations')
      .use(middleware.auth())

    // v3-bi-trend-analysis —— BI 趋势分析只读 API
    const BiTrendAnalysisController = () => import('#controllers/bi_trend_analysis_controller')
    router
      .group(() => {
        router.get('/', [BiTrendAnalysisController, 'index']).as('organizations.bi.trends.index')
      })
      .prefix('/organizations/:organizationId/bi/trends')
      .use(middleware.auth())

    // v3-bi-data-aggregation-service —— BI 数据聚合只读 API
    const BiAggregationController = () => import('#controllers/bi_aggregation_controller')
    router
      .group(() => {
        router
          .get('/', [BiAggregationController, 'index'])
          .as('organizations.bi.aggregations.index')
      })
      .prefix('/organizations/:organizationId/bi/aggregations')
      .use(middleware.auth())

    // v3-bi-risk-heatmap —— BI 风险热力图只读 API
    const BiRiskHeatmapController = () => import('#controllers/bi_risk_heatmap_controller')
    router
      .group(() => {
        router
          .get('/', [BiRiskHeatmapController, 'index'])
          .as('organizations.bi.risk-heatmap.index')
      })
      .prefix('/organizations/:organizationId/bi/risk-heatmap')
      .use(middleware.auth())

    // v3-bi-report-template-library —— BI 报表模板库 API
    const BiReportTemplateController = () => import('#controllers/bi_report_template_controller')
    router
      .group(() => {
        // 只读端点
        router
          .get('/', [BiReportTemplateController, 'index'])
          .as('organizations.bi.report-templates.index')
        router
          .get('/:templateId', [BiReportTemplateController, 'show'])
          .as('organizations.bi.report-templates.show')
        router
          .get('/:templateId/preview', [BiReportTemplateController, 'preview'])
          .as('organizations.bi.report-templates.preview')
        // 实例化入口
        router
          .post('/:templateId/instantiate', [BiReportTemplateController, 'instantiate'])
          .as('organizations.bi.report-templates.instantiate')
        // 自定义副本写端点（支持 builtin 与 plugin，插件带快照）
        router
          .post('/:templateId/copy/preview', [BiReportTemplateController, 'previewCopy'])
          .as('organizations.bi.report-templates.copy.preview')
        router
          .post('/:templateId/copy/confirm', [BiReportTemplateController, 'confirmCopy'])
          .as('organizations.bi.report-templates.copy.confirm')
        router
          .post('/:templateId/copy', [BiReportTemplateController, 'saveCopy'])
          .as('organizations.bi.report-templates.copy')
        router
          .patch('/copies/:copyId', [BiReportTemplateController, 'updateCopy'])
          .as('organizations.bi.report-templates.copies.update')
        router
          .post('/copies/:copyId/archive', [BiReportTemplateController, 'archiveCopy'])
          .as('organizations.bi.report-templates.copies.archive')
        router
          .post('/copies/:copyId/restore', [BiReportTemplateController, 'restoreCopy'])
          .as('organizations.bi.report-templates.copies.restore')
      })
      .prefix('/organizations/:organizationId/bi/report-templates')
      .use(middleware.auth())

    // v3-bi-custom-report-builder —— BI 自定义报表构建器 API
    const BiCustomReportController = () => import('#controllers/bi_custom_report_controller')
    router
      .group(() => {
        // 数据源目录
        router
          .get('/registry', [BiCustomReportController, 'registry'])
          .as('organizations.bi.custom-reports.registry')
        // 无副作用预览
        router
          .post('/preview', [BiCustomReportController, 'preview'])
          .as('organizations.bi.custom-reports.preview')
        // 定义 CRUD
        router
          .get('/definitions', [BiCustomReportController, 'list'])
          .as('organizations.bi.custom-reports.definitions.list')
        router
          .post('/definitions', [BiCustomReportController, 'create'])
          .as('organizations.bi.custom-reports.definitions.create')
        router
          .get('/definitions/:definitionId', [BiCustomReportController, 'get'])
          .as('organizations.bi.custom-reports.definitions.show')
        router
          .put('/definitions/:definitionId', [BiCustomReportController, 'update'])
          .as('organizations.bi.custom-reports.definitions.update')
        router
          .post('/definitions/:definitionId/copy', [BiCustomReportController, 'copy'])
          .as('organizations.bi.custom-reports.definitions.copy')
        router
          .post('/definitions/:definitionId/set-default', [BiCustomReportController, 'setDefault'])
          .as('organizations.bi.custom-reports.definitions.set-default')
        router
          .post('/definitions/:definitionId/archive', [BiCustomReportController, 'archive'])
          .as('organizations.bi.custom-reports.definitions.archive')
        router
          .post('/definitions/:definitionId/restore', [BiCustomReportController, 'restore'])
          .as('organizations.bi.custom-reports.definitions.restore')
        router
          .get('/definitions/:definitionId/versions', [BiCustomReportController, 'versions'])
          .as('organizations.bi.custom-reports.definitions.versions')
      })
      .prefix('/organizations/:organizationId/bi/custom-reports')
      .use(middleware.auth())

    // v3-bi-dashboard-builder —— BI Dashboard Builder API
    const BiDashboardController = () => import('#controllers/bi_dashboard_controller')

    router
      .group(() => {
        router
          .get('/registry', [BiDashboardController, 'registry'])
          .as('organizations.bi.dashboards.registry')
        router.get('/', [BiDashboardController, 'list']).as('organizations.bi.dashboards.index')
        router
          .get('/current', [BiDashboardController, 'current'])
          .as('organizations.bi.dashboards.current')
        router.get('/:id', [BiDashboardController, 'detail']).as('organizations.bi.dashboards.show')
        router
          .post('/preview', [BiDashboardController, 'preview'])
          .as('organizations.bi.dashboards.preview')
        router.post('/', [BiDashboardController, 'create']).as('organizations.bi.dashboards.store')
        router
          .put('/:id', [BiDashboardController, 'update'])
          .as('organizations.bi.dashboards.update')
        router
          .post('/:id/copy', [BiDashboardController, 'copy'])
          .as('organizations.bi.dashboards.copy')
        router
          .post('/:id/set-default', [BiDashboardController, 'setDefault'])
          .as('organizations.bi.dashboards.set-default')
        router
          .post('/:id/archive', [BiDashboardController, 'archive'])
          .as('organizations.bi.dashboards.archive')
        router
          .post('/:id/restore', [BiDashboardController, 'restore'])
          .as('organizations.bi.dashboards.restore')
        router
          .delete('/:id', [BiDashboardController, 'destroy'])
          .as('organizations.bi.dashboards.destroy')
      })
      .prefix('/organizations/:organizationId/bi/dashboards')
      .use(middleware.auth())

    // ── 跨项目依赖 CRUD ──
    // v3-multi-project-dependency-crud — 组织级跨项目依赖事实的 CRUD API
    router
      .group(() => {
        // List & Detail
        router
          .get('/', [MultiProjectDependenciesController, 'index'])
          .as('organizations.multi-project-dependencies.index')
        // Graph
        router
          .get('/graph', [MultiProjectDependenciesController, 'graph'])
          .as('organizations.multi-project-dependencies.graph')
        // Suggestions
        router
          .get('/suggestions', [MultiProjectDependenciesController, 'suggestions'])
          .as('organizations.multi-project-dependencies.suggestions')
        router
          .get('/:dependencyId', [MultiProjectDependenciesController, 'show'])
          .as('organizations.multi-project-dependencies.show')
        // Create
        router
          .post('/preview-create', [MultiProjectDependenciesController, 'previewCreate'])
          .as('organizations.multi-project-dependencies.preview-create')
        router
          .post('/confirm-create', [MultiProjectDependenciesController, 'confirmCreate'])
          .as('organizations.multi-project-dependencies.confirm-create')
        router
          .post('/confirm', [MultiProjectDependenciesController, 'confirm'])
          .as('organizations.multi-project-dependencies.confirm')
        // Update
        router
          .post('/preview-update', [MultiProjectDependenciesController, 'previewUpdate'])
          .as('organizations.multi-project-dependencies.preview-update')
        router
          .post('/confirm-update', [MultiProjectDependenciesController, 'confirmUpdate'])
          .as('organizations.multi-project-dependencies.confirm-update')
        // Archive
        router
          .post('/preview-archive', [MultiProjectDependenciesController, 'previewArchive'])
          .as('organizations.multi-project-dependencies.preview-archive')
        router
          .post('/confirm-archive', [MultiProjectDependenciesController, 'confirmArchive'])
          .as('organizations.multi-project-dependencies.confirm-archive')
        // Restore
        router
          .post('/preview-restore', [MultiProjectDependenciesController, 'previewRestore'])
          .as('organizations.multi-project-dependencies.preview-restore')
        router
          .post('/confirm-restore', [MultiProjectDependenciesController, 'confirmRestore'])
          .as('organizations.multi-project-dependencies.confirm-restore')
        // Delete
        router
          .post('/preview-delete', [MultiProjectDependenciesController, 'previewDelete'])
          .as('organizations.multi-project-dependencies.preview-delete')
        router
          .post('/confirm-delete', [MultiProjectDependenciesController, 'confirmDelete'])
          .as('organizations.multi-project-dependencies.confirm-delete')
        // Drill-down
        router
          .post('/drill-down', [MultiProjectDependenciesController, 'drillDown'])
          .as('organizations.multi-project-dependencies.drill-down')
      })
      .prefix('/organizations/:organizationId/multi-project-dependencies')
      .use(middleware.auth())
      .use(middleware.mpdCrudFeatureGuard())

    // ── 跨项目依赖检测 ──
    // v3-multi-project-dependency-detection — 组织级跨项目依赖检测 API
    const MultiProjectDependencyDetectionController = () =>
      import('#controllers/multi_project_dependency_detection_controller')
    router
      .group(() => {
        // Plan & Run
        router
          .post('/plan', [MultiProjectDependencyDetectionController, 'plan'])
          .as('organizations.multi-project-dependencies.detections.plan')
        router
          .post('/run', [MultiProjectDependencyDetectionController, 'run'])
          .as('organizations.multi-project-dependencies.detections.run')
        // Runs
        router
          .get('/runs', [MultiProjectDependencyDetectionController, 'listRuns'])
          .as('organizations.multi-project-dependencies.detections.runs.list')
        // Results
        router
          .get('/results', [MultiProjectDependencyDetectionController, 'listResults'])
          .as('organizations.multi-project-dependencies.detections.results.list')
        router
          .get('/results/:resultId', [MultiProjectDependencyDetectionController, 'showResult'])
          .as('organizations.multi-project-dependencies.detections.results.show')
        // Lifecycle
        router
          .post('/results/:resultId/ignore', [
            MultiProjectDependencyDetectionController,
            'ignoreResult',
          ])
          .as('organizations.multi-project-dependencies.detections.results.ignore')
        router
          .post('/results/:resultId/reopen', [
            MultiProjectDependencyDetectionController,
            'reopenResult',
          ])
          .as('organizations.multi-project-dependencies.detections.results.reopen')
        // Draft Bridge
        router
          .post('/draft-bridge', [MultiProjectDependencyDetectionController, 'buildDraftBridge'])
          .as('organizations.multi-project-dependencies.detections.draft-bridge')
      })
      .prefix('/organizations/:organizationId/multi-project-dependencies/detections')
      .use(middleware.auth())
      .use(middleware.mpdCrudFeatureGuard())

    // ── 多项目影响分析 ──
    // v3-multi-project-impact-analysis — 组织级多项目影响分析 API
    router
      .group(() => {
        // Plan & Run
        router
          .post('/plan', [MultiProjectImpactAnalysisController, 'plan'])
          .as('organizations.multi-project-impact-analyses.plan')
        router
          .post('/run', [MultiProjectImpactAnalysisController, 'run'])
          .as('organizations.multi-project-impact-analyses.run')
        // Snapshots
        router
          .get('/', [MultiProjectImpactAnalysisController, 'list'])
          .as('organizations.multi-project-impact-analyses.list')
        router
          .get('/:snapshotId', [MultiProjectImpactAnalysisController, 'read'])
          .as('organizations.multi-project-impact-analyses.read')
        router
          .post('/:snapshotId/refresh', [MultiProjectImpactAnalysisController, 'refresh'])
          .as('organizations.multi-project-impact-analyses.refresh')
        // What-if
        router
          .post('/what-if', [MultiProjectImpactAnalysisController, 'whatIf'])
          .as('organizations.multi-project-impact-analyses.what-if')
        // Export
        router
          .post('/export', [MultiProjectImpactAnalysisController, 'export'])
          .as('organizations.multi-project-impact-analyses.export')
        // Follow-up draft
        router
          .post('/follow-up', [MultiProjectImpactAnalysisController, 'followUp'])
          .as('organizations.multi-project-impact-analyses.follow-up')
        // AI explanation
        router
          .post('/ai-explanation', [MultiProjectImpactAnalysisController, 'aiExplanation'])
          .as('organizations.multi-project-impact-analyses.ai-explanation')
        // Drill-down
        router
          .post('/drill-down', [MultiProjectImpactAnalysisController, 'drillDown'])
          .as('organizations.multi-project-impact-analyses.drill-down')
      })
      .prefix('/organizations/:organizationId/multi-project-impact-analyses')
      .use(middleware.auth())

    // v3-plugin-runtime-health-diagnostics —— 插件运行健康只读诊断（组织隔离 + 低敏）
    const PluginRuntimeHealthController = () =>
      import('#controllers/plugin_runtime_health_controller')
    router
      .group(() => {
        router
          .get('/snapshots', [PluginRuntimeHealthController, 'snapshots'])
          .as('plugin-runtime-health.snapshots')
        router
          .get('/installations/:id/events', [PluginRuntimeHealthController, 'events'])
          .as('plugin-runtime-health.events')
        router
          .post('/installations/:id/probe', [PluginRuntimeHealthController, 'triggerProbe'])
          .as('plugin-runtime-health.probe')
      })
      .prefix('/plugin-health')
      .use(middleware.auth())
  })
  .prefix('/api/v1')

// ── API v2 路由组（feature-gated） ──────────────────────────────────────
// 见 v2-5-api-v2-surface change。
// 默认关闭；启用需设置 API_V2_ENABLED=true。
// 所有 v2 端点须在 api_v2_admission.ts 中有对应准入条目。
const V2ApiCapabilitiesController = () => import('#controllers/v2/api_v2_capabilities_controller')
const V2ApiCompilerController = () => import('#controllers/v2/api_v2_compiler_controller')
const V2ApiStreamingController = () => import('#controllers/v2/api_v2_streaming_controller')
const V2ApiGanttController = () => import('#controllers/v2/api_v2_gantt_controller')

router
  .group(() => {
    router.get('/capabilities', [V2ApiCapabilitiesController, 'index']).as('api.v2.capabilities')

    router
      .group(() => {
        router.get('/', [V2ApiCompilerController, 'index']).as('api.v2.compiler.runs.index')
        router.post('/', [V2ApiCompilerController, 'startRun']).as('api.v2.compiler.runs.store')
        router.get('/:id', [V2ApiCompilerController, 'getRun']).as('api.v2.compiler.runs.show')
        router
          .get('/:id/events', [V2ApiCompilerController, 'getEvents'])
          .as('api.v2.compiler.runs.events')
        router
          .post('/:id/resume', [V2ApiCompilerController, 'resume'])
          .as('api.v2.compiler.runs.resume')
        router
          .post('/:id/replay', [V2ApiCompilerController, 'replay'])
          .as('api.v2.compiler.runs.replay')
      })
      .prefix('/ai/compiler/runs')
      .use(middleware.auth())

    router
      .group(() => {
        router
          .get('/replay/:draftId', [V2ApiStreamingController, 'replay'])
          .as('api.v2.streaming.replay')
        router
          .get('/status/:draftId', [V2ApiStreamingController, 'status'])
          .as('api.v2.streaming.status')
      })
      .prefix('/streaming')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('/', [V2ApiGanttController, 'listSessions']).as('api.v2.gantt.whatif.index')
        router
          .get('/:sessionId', [V2ApiGanttController, 'showSession'])
          .as('api.v2.gantt.whatif.show')
        router
          .post('/:sessionId/apply', [V2ApiGanttController, 'applySession'])
          .as('api.v2.gantt.whatif.apply')
      })
      .prefix('/projects/:projectId/gantt/whatif')
      .use(middleware.auth())
  })
  .prefix('/api/v2')
  .use(middleware.apiV2Gate())

// ── v3-unified-ai-budget-and-quota —— 只读预算状态查询 API ──
const BudgetStatusController = () => import('#controllers/budget_status_controller')

router
  .group(() => {
    router
      .get('/status', [BudgetStatusController, 'getBudgetStatus'])
      .as('api.v1.organizations.ai-budget.status')
  })
  .prefix('/api/v1/organizations/:organizationId/ai-budget')
  .use(middleware.auth())

// ── v3-copilot-session-persistence-and-history —— Copilot 会话持久化 API ──
const CopilotSessionController = () => import('#controllers/copilot_session_controller')

router
  .group(() => {
    router.post('/', [CopilotSessionController, 'store']).as('copilot-sessions.store')
    router.get('/', [CopilotSessionController, 'index']).as('copilot-sessions.index')
    router.get('/:sessionId', [CopilotSessionController, 'show']).as('copilot-sessions.show')
    router
      .get('/:sessionId/messages', [CopilotSessionController, 'messages'])
      .as('copilot-sessions.messages')
    router
      .patch('/:sessionId/rename', [CopilotSessionController, 'rename'])
      .as('copilot-sessions.rename')
    router
      .post('/:sessionId/archive', [CopilotSessionController, 'archive'])
      .as('copilot-sessions.archive')
    router
      .delete('/:sessionId', [CopilotSessionController, 'destroy'])
      .as('copilot-sessions.destroy')
    router
      .get('/:sessionId/export', [CopilotSessionController, 'export'])
      .as('copilot-sessions.export')
    router
      .post('/:sessionId/resume', [CopilotSessionController, 'resume'])
      .as('copilot-sessions.resume')
  })
  .prefix('/api/v1/copilot-sessions')
  .use(middleware.auth())

// ── v3-copilot-session-retention-and-compliance —— 会话保留治理 API ──
const CopilotSessionRetentionController = () =>
  import('#controllers/copilot_session_retention_controller')

router
  .group(() => {
    router
      .get('/policy', [CopilotSessionRetentionController, 'readPolicy'])
      .as('copilot-retention.policy')
    router
      .put('/policy', [CopilotSessionRetentionController, 'updatePolicy'])
      .as('copilot-retention.update-policy')
    router
      .get('/status', [CopilotSessionRetentionController, 'getStatus'])
      .as('copilot-retention.status')
    router
      .get('/sessions', [CopilotSessionRetentionController, 'listSessions'])
      .as('copilot-retention.sessions')
    router
      .get('/:sessionId/summary', [CopilotSessionRetentionController, 'getSessionSummary'])
      .as('copilot-retention.session-summary')
    router
      .post('/:sessionId/delete', [CopilotSessionRetentionController, 'requestDeletion'])
      .as('copilot-retention.delete')
    router
      .post('/cleanup', [CopilotSessionRetentionController, 'executeCleanup'])
      .as('copilot-retention.cleanup')
    router
      .get('/:sessionId/deletion-status', [CopilotSessionRetentionController, 'getDeletionStatus'])
      .as('copilot-retention.deletion-status')
  })
  .prefix('/api/v1/copilot-sessions/retention')
  .use(middleware.auth())

// ── v3-ai-request-tracing —— AI 追踪只读查询 API ──
const AiTraceController = () => import('#controllers/ai_trace_controller')

router
  .group(() => {
    router.get('/traces/:traceId', [AiTraceController, 'show']).as('api.v1.ai.traces.show')
    router
      .get('/traces/sessions/:conversationId', [AiTraceController, 'sessionAggregation'])
      .as('api.v1.ai.traces.session-aggregation')
    router
      .get('/traces/workflows/:workflowName', [AiTraceController, 'workflowAggregation'])
      .as('api.v1.ai.traces.workflow-aggregation')
    router.get('/traces/orphans', [AiTraceController, 'orphans']).as('api.v1.ai.traces.orphans')
  })
  .prefix('/api/v1/ai')
  .use(middleware.auth())

// ── v3-unified-ai-output-quality-ledger —— 质量校验结果只读聚合 API ──
const QualityValidationController = () => import('#controllers/quality_validation_controller')

router
  .group(() => {
    router
      .get('/aggregate', [QualityValidationController, 'aggregate'])
      .as('api.v1.quality.aggregate')
    router.get('/health', [QualityValidationController, 'health']).as('api.v1.quality.health')
    router
      .get('/repair-effectiveness', [QualityValidationController, 'repairEffectiveness'])
      .as('api.v1.quality.repair-effectiveness')
    router.get('/trends', [QualityValidationController, 'trends']).as('api.v1.quality.trends')
    router
      .get('/projections', [QualityValidationController, 'projections'])
      .as('api.v1.quality.projections')
  })
  .prefix('/api/v1/quality')
  .use(middleware.auth())

// ── v3-copilot-suggestion-inbox —— 五来源 AI 建议收件箱 API ──
const CopilotSuggestionInboxController = () =>
  import('#controllers/copilot_suggestion_inbox_controller')

router
  .group(() => {
    router
      .get('/', [CopilotSuggestionInboxController, 'index'])
      .as('api.v1.copilot-suggestion-inbox.index')
    router
      .get('/unread-count', [CopilotSuggestionInboxController, 'unreadCount'])
      .as('api.v1.copilot-suggestion-inbox.unread-count')
    router
      .post('/:id/action', [CopilotSuggestionInboxController, 'action'])
      .as('api.v1.copilot-suggestion-inbox.action')
    router
      .post('/refresh', [CopilotSuggestionInboxController, 'refresh'])
      .as('api.v1.copilot-suggestion-inbox.refresh')
  })
  .prefix('/api/v1/copilot-suggestion-inbox')
  .use(middleware.auth())

// ── v3-copilot-routing-decision-ledger —— 路由决策账本 API（只读）──
const CopilotRoutingLedgerController = () =>
  import('#controllers/copilot_routing_ledger_controller')

router
  .group(() => {
    router
      .get('/', [CopilotRoutingLedgerController, 'index'])
      .as('api.v1.copilot-routing-decisions.index')
    router
      .get('/violations', [CopilotRoutingLedgerController, 'violations'])
      .as('api.v1.copilot-routing-decisions.violations')
    router
      .get('/evaluation', [CopilotRoutingLedgerController, 'evaluation'])
      .as('api.v1.copilot-routing-decisions.evaluation')
  })
  .prefix('/api/v1/copilot-routing-decisions')
  .use(middleware.auth())

// ── v3-plugin-private-registry-lifecycle —— 私有插件目录 API ──
const PluginRegistryController = () => import('#controllers/plugin_registry_controller')

router
  .group(() => {
    router.get('/', [PluginRegistryController, 'index']).as('api.v1.plugin-registry.index')
    router
      .get('/review-queue', [PluginRegistryController, 'reviewQueue'])
      .as('api.v1.plugin-registry.review-queue')
    router
      .get('/resolve', [PluginRegistryController, 'resolve'])
      .as('api.v1.plugin-registry.resolve')
    router.get('/:entryId', [PluginRegistryController, 'show']).as('api.v1.plugin-registry.show')
    router
      .post('/commands/preview', [PluginRegistryController, 'preview'])
      .as('api.v1.plugin-registry.commands.preview')
    router
      .post('/commands/:handle/confirm', [PluginRegistryController, 'confirm'])
      .as('api.v1.plugin-registry.commands.confirm')
  })
  .prefix('/api/v1/organizations/:organizationId/plugin-registry')
  .use(middleware.auth())

// ── v3-organization-private-plugin-directory —— 组织私有目录投影与受控管理动作 API ──
// 只读 GET + 受控写：写入口**全部**委托统一插件变更流（kind=registry-release-change），
// 绝不直接更新 registry release 状态或安装行（design.md D2/D3/D4）。
const PluginDirectoryController = () => import('#controllers/plugin_directory_controller')

router
  .group(() => {
    router
      .get('/releases', [PluginDirectoryController, 'index'])
      .as('api.v1.plugin-directory.releases.index')
    router
      .get('/releases/:releaseId', [PluginDirectoryController, 'show'])
      .as('api.v1.plugin-directory.releases.show')
    router
      .get('/releases/:releaseId/affected-installations', [
        PluginDirectoryController,
        'affectedInstallations',
      ])
      .as('api.v1.plugin-directory.releases.affected-installations')
    router
      .get('/releases/:releaseId/rollback-preview', [PluginDirectoryController, 'rollbackPreview'])
      .as('api.v1.plugin-directory.releases.rollback-preview')
    router
      .post('/releases/:releaseId/changes', [PluginDirectoryController, 'createChange'])
      .as('api.v1.plugin-directory.releases.changes.store')
    router
      .post('/changes/:requestUid/confirm', [PluginDirectoryController, 'confirmChange'])
      .as('api.v1.plugin-directory.changes.confirm')
  })
  .prefix('/api/v1/organizations/:organizationId/plugin-directory')
  .use(middleware.auth())

// ── v3-skill-as-plugin-adapter —— 插件安装生命周期 API（W2b）──
const PluginInstallationsController = () => import('#controllers/plugin_installations_controller')

router
  .group(() => {
    router
      .get('/', [PluginInstallationsController, 'index'])
      .as('api.v1.plugin-installations.index')
    router
      .get('/:pluginId', [PluginInstallationsController, 'show'])
      .as('api.v1.plugin-installations.show')
    router
      .post('/commands/preview', [PluginInstallationsController, 'preview'])
      .as('api.v1.plugin-installations.commands.preview')
    router
      .post('/commands/confirm', [PluginInstallationsController, 'confirm'])
      .as('api.v1.plugin-installations.commands.confirm')
  })
  .prefix('/api/v1/organizations/:organizationId/plugin-installations')
  .use(middleware.auth())

// ── v3-plugin-approval-change-flow —— 插件统一变更请求与审批确认 API ──
const PluginChangeRequestsController = () =>
  import('#controllers/plugin_change_requests_controller')

router
  .group(() => {
    router
      .get('/', [PluginChangeRequestsController, 'index'])
      .as('api.v1.plugin-change-requests.index')
    router
      .post('/', [PluginChangeRequestsController, 'store'])
      .as('api.v1.plugin-change-requests.store')
    router
      .get('/:requestUid', [PluginChangeRequestsController, 'show'])
      .as('api.v1.plugin-change-requests.show')
    router
      .post('/:requestUid/preview', [PluginChangeRequestsController, 'preview'])
      .as('api.v1.plugin-change-requests.preview')
    router
      .post('/:requestUid/approve', [PluginChangeRequestsController, 'approve'])
      .as('api.v1.plugin-change-requests.approve')
    router
      .post('/:requestUid/reject', [PluginChangeRequestsController, 'reject'])
      .as('api.v1.plugin-change-requests.reject')
    router
      .post('/:requestUid/withdraw', [PluginChangeRequestsController, 'withdraw'])
      .as('api.v1.plugin-change-requests.withdraw')
    router
      .post('/:requestUid/confirm-handle', [PluginChangeRequestsController, 'confirmHandle'])
      .as('api.v1.plugin-change-requests.confirm-handle')
    router
      .post('/:requestUid/confirm', [PluginChangeRequestsController, 'confirm'])
      .as('api.v1.plugin-change-requests.confirm')
  })
  .prefix('/api/v1/organizations/:organizationId/plugin-change-requests')
  .use(middleware.auth())

// ── v3-plugin-policy-bundles —— 组织插件策略包管理（读=成员，写=owner/admin 且走统一变更流）──
const PluginPolicyBundlesController = () => import('#controllers/plugin_policy_bundles_controller')

router
  .group(() => {
    router
      .get('/', [PluginPolicyBundlesController, 'index'])
      .as('api.v1.plugin-policy-bundles.index')
    router
      .post('/copy', [PluginPolicyBundlesController, 'copy'])
      .as('api.v1.plugin-policy-bundles.copy')
    router
      .get('/:bundleId', [PluginPolicyBundlesController, 'show'])
      .as('api.v1.plugin-policy-bundles.show')
    router
      .post('/:bundleId/activation', [PluginPolicyBundlesController, 'changeActivation'])
      .as('api.v1.plugin-policy-bundles.change-activation')
    router
      .get('/changes/:requestUid/impact', [PluginPolicyBundlesController, 'impact'])
      .as('api.v1.plugin-policy-bundles.impact')
  })
  .prefix('/api/v1/organizations/:organizationId/plugin-policy-bundles')
  .use(middleware.auth())

// ── v3-command-palette-plugin-action-pack —— 官方命令包资格快照（只读）──
const PluginCommandSnapshotController = () =>
  import('#controllers/plugin_command_snapshot_controller')

router
  .group(() => {
    router
      .get('/', [PluginCommandSnapshotController, 'index'])
      .as('api.v1.plugin-command-snapshots.index')
  })
  .prefix('/api/v1/organizations/:organizationId/plugin-command-snapshots')
  .use(middleware.auth())

// ── v3-plugin-action-preview-boundary —— 插件写入动作统一边界 API ──
const PluginActionsController = () => import('#controllers/plugin_actions_controller')

router
  .group(() => {
    router.get('/:proposalUid', [PluginActionsController, 'show']).as('api.v1.plugin-actions.show')
    router
      .post('/:proposalUid/preview', [PluginActionsController, 'preview'])
      .as('api.v1.plugin-actions.preview')
    router
      .post('/:proposalUid/decision', [PluginActionsController, 'decide'])
      .as('api.v1.plugin-actions.decision')
    router
      .post('/:proposalUid/confirm', [PluginActionsController, 'confirm'])
      .as('api.v1.plugin-actions.confirm')
  })
  .prefix('/api/v1/organizations/:organizationId/plugin-actions')
  .use(middleware.auth())

// ── v3-skill-as-plugin-adapter —— 插件 Skill Adapter 解析 API（W4a）──
const PluginSkillAdaptersController = () => import('#controllers/plugin_skill_adapters_controller')

router
  .group(() => {
    router
      .get('/', [PluginSkillAdaptersController, 'index'])
      .as('api.v1.plugin-skill-adapters.index')
    router
      .get('/:pluginId', [PluginSkillAdaptersController, 'show'])
      .as('api.v1.plugin-skill-adapters.show')
  })
  .prefix('/api/v1/organizations/:organizationId/plugin-skill-adapters')
  .use(middleware.auth())

// ── v3-copilot-live-submission-channel —— Copilot 回合端点（生产提交通道）──
// ── v3-copilot-live-streaming-output —— 流式回合端点（SSE 增量输出）──
const CopilotTurnController = () => import('#controllers/copilot_turn_controller')

router
  .group(() => {
    router.post('/turns', [CopilotTurnController, 'store']).as('api.v1.copilot.turns.store')
    router
      .post('/turns/stream', [CopilotTurnController, 'storeStream'])
      .as('api.v1.copilot.turns.stream')
  })
  .prefix('/api/v1/copilot')
  .use(middleware.auth())

// ── v3-copilot-productized-operating-entry —— 入口就绪快照（GET 只读）──
const CopilotReadinessController = () => import('#controllers/copilot_readiness_controller')

router
  .group(() => {
    router
      .get('/readiness', [CopilotReadinessController, 'show'])
      .as('api.v1.copilot.readiness.show')
  })
  .prefix('/api/v1/copilot')
  .use(middleware.auth())

// ── v3-plugin-permission-audit-and-observation —— 插件权限决策查询与观察 ──
const PluginPermissionDecisionController = () =>
  import('#controllers/plugin_permission_decision_controller')

router
  .group(() => {
    router
      .get('/', [PluginPermissionDecisionController, 'index'])
      .as('api.v1.plugin-permission-decisions.index')
    router
      .get('/aggregate', [PluginPermissionDecisionController, 'aggregate'])
      .as('api.v1.plugin-permission-decisions.aggregate')
  })
  .prefix('/api/v1/organizations/:organizationId/plugin-permission-decisions')
  .use(middleware.auth())

// ── v3-plugin-permission-audit-and-observation —— Observation 投影端点 ──
const PluginPermissionObservationController = () =>
  import('#controllers/plugin_permission_observation_controller')

router
  .group(() => {
    router
      .get('/', [PluginPermissionObservationController, 'index'])
      .as('api.v1.plugin-permission-observations.index')
  })
  .prefix('/api/v1/organizations/:organizationId/plugin-permission-observations')
  .use(middleware.auth())

// ── v3-triz-plugin-pack —— TRIZ 官方插件包受控适配 API（W5a）──
const TrizPluginPackController = () => import('#controllers/triz_plugin_pack_controller')

router
  .group(() => {
    router.get('/health', [TrizPluginPackController, 'health']).as('api.v1.triz-pack.health')
    router
      .get('/contributions', [TrizPluginPackController, 'contributions'])
      .as('api.v1.triz-pack.contributions')
    router.post('/execute', [TrizPluginPackController, 'execute']).as('api.v1.triz-pack.execute')
  })
  .prefix('/api/v1/organizations/:organizationId/plugins/triz-pack')
  .use(middleware.auth())

// ── v3-copilot-usage-and-quota-surface —— 用量与额度只读视图 ──
const AiUsageSurfaceController = () => import('#controllers/ai_usage_surface_controller')
const AiCostSettingsController = () => import('#controllers/ai_cost_settings_controller')

router
  .group(() => {
    router.get('/', [AiUsageSurfaceController, 'index']).as('api.v1.ai.usage-surface.index')
  })
  .prefix('/api/v1/ai/usage-surface')
  .use(middleware.auth())

router
  .group(() => {
    router.get('/', [AiCostSettingsController, 'show']).as('api.v1.ai.cost-settings.show')
    router.put('/', [AiCostSettingsController, 'update']).as('api.v1.ai.cost-settings.update')
  })
  .prefix('/api/v1/ai/cost-settings')
  .use(middleware.auth())

// ── v3-plugin-scoped-storage —— 插件组织/项目级 scoped 存储 API ──
const PluginStorageRuntimeController = () =>
  import('#controllers/plugin_storage_runtime_controller')
const PluginStorageAdminController = () => import('#controllers/plugin_storage_admin_controller')

// runtime 面：宿主功能代表已启用插件读写其 namespace（RBAC view/manage + 服务层合取门）
router
  .group(() => {
    router
      .get('/entries', [PluginStorageRuntimeController, 'index'])
      .as('api.v1.plugin-storage.runtime.entries.index')
    router
      .get('/entries/:key', [PluginStorageRuntimeController, 'show'])
      .as('api.v1.plugin-storage.runtime.entries.show')
    router
      .put('/entries/:key', [PluginStorageRuntimeController, 'put'])
      .as('api.v1.plugin-storage.runtime.entries.put')
    router
      .delete('/entries/:key', [PluginStorageRuntimeController, 'destroy'])
      .as('api.v1.plugin-storage.runtime.entries.destroy')
  })
  .prefix('/api/v1/organizations/:organizationId/plugin-storage/runtime/:pluginId')
  .use(middleware.auth())

// 管理面：配额/用量清单、清理 preview/confirm、版本化导出
router
  .group(() => {
    router
      .get('/namespaces', [PluginStorageAdminController, 'namespaces'])
      .as('api.v1.plugin-storage.namespaces.index')
    router
      .post('/namespaces/:namespaceId/cleanup-preview', [
        PluginStorageAdminController,
        'cleanupPreview',
      ])
      .as('api.v1.plugin-storage.namespaces.cleanup-preview')
    router
      .post('/cleanup-confirm', [PluginStorageAdminController, 'cleanupConfirm'])
      .as('api.v1.plugin-storage.cleanup-confirm')
    router
      .post('/export', [PluginStorageAdminController, 'export'])
      .as('api.v1.plugin-storage.export')
  })
  .prefix('/api/v1/organizations/:organizationId/plugin-storage')
  .use(middleware.auth())

// ── v3-global-ai-rate-limiting —— 限流状态 API ──
const RateLimitController = () => import('#controllers/rate_limit_controller')

router
  .group(() => {
    router
      .get('/status', [RateLimitController, 'status'])
      .as('api.v1.organizations.ai-rate-limits.status')
  })
  .prefix('/api/v1/organizations/:organizationId/ai-rate-limits')
  .use(middleware.auth())

// ── v3-unified-ai-feedback-ledger —— 反馈账本只读聚合 API ──
const UnifiedAiFeedbackController = () => import('#controllers/unified_ai_feedback_controller')

router
  .group(() => {
    router
      .get('/aggregate', [UnifiedAiFeedbackController, 'aggregate'])
      .as('api.v1.organizations.ai-feedback.aggregate')
    router
      .get('/events', [UnifiedAiFeedbackController, 'events'])
      .as('api.v1.organizations.ai-feedback.events')
    router
      .get('/downstream', [UnifiedAiFeedbackController, 'downstream'])
      .as('api.v1.organizations.ai-feedback.downstream')
  })
  .prefix('/api/v1/organizations/:organizationId/ai-feedback')
  .use(middleware.auth())

// ── v3-ai-automated-evaluation —— 评测评分聚合 API ──
const EvaluationScoreController = () => import('#controllers/evaluation_score_controller')

router
  .group(() => {
    router
      .get('/aggregate', [EvaluationScoreController, 'aggregate'])
      .as('api.v1.organizations.ai-evaluation-scores.aggregate')
    router
      .get('/trends', [EvaluationScoreController, 'trends'])
      .as('api.v1.organizations.ai-evaluation-scores.trends')
  })
  .prefix('/api/v1/organizations/:organizationId/ai-evaluation-scores')
  .use(middleware.auth())

// ── v3-chart-gallery-data-foundation（design D5 端点树）─────────────────
// 图表馆数据底座 HTTP surface：章程 / 需求+RTM / 议题 / 干系人 / 沟通计划 /
// 部门树(OBS) / 项目度量聚合。权限门禁：start/rbac/routes.ts 中央路由规则表
// （跨租户项目统一 404）；审计埋点按 change 决策不做（已记录为后续项）。
const ProjectChartersController = () => import('#controllers/project_charters_controller')
const RequirementsController = () => import('#controllers/requirements_controller')
const IssuesController = () => import('#controllers/issues_controller')
const ProjectStakeholdersController = () => import('#controllers/project_stakeholders_controller')
const CommunicationPlansController = () => import('#controllers/communication_plans_controller')
const DepartmentsController = () => import('#controllers/departments_controller')
const ProjectMetricsController = () => import('#controllers/project_metrics_controller')

// 项目章程（每项目一份）
router
  .group(() => {
    router.get('/', [ProjectChartersController, 'show']).as('projects.charter.show')
    router.post('/', [ProjectChartersController, 'store']).as('projects.charter.store')
    router.patch('/', [ProjectChartersController, 'update']).as('projects.charter.update')
    router.post('/submit', [ProjectChartersController, 'submit']).as('projects.charter.submit')
    router.post('/approve', [ProjectChartersController, 'approve']).as('projects.charter.approve')
  })
  .prefix('/api/v1/projects/:projectId/charter')
  .use(middleware.auth())

// 需求 + RTM 追溯矩阵
router
  .group(() => {
    router.get('/', [RequirementsController, 'index']).as('projects.requirements.index')
    router.post('/', [RequirementsController, 'store']).as('projects.requirements.store')
    router
      .get('/rtm-matrix', [RequirementsController, 'rtmMatrix'])
      .as('projects.requirements.rtm-matrix')
    router.get('/:id', [RequirementsController, 'show']).as('projects.requirements.show')
    router.patch('/:id', [RequirementsController, 'update']).as('projects.requirements.update')
    router.delete('/:id', [RequirementsController, 'destroy']).as('projects.requirements.destroy')
    router
      .post('/:id/tasks', [RequirementsController, 'bindTask'])
      .as('projects.requirements.bind-task')
    router
      .delete('/:id/tasks/:taskId', [RequirementsController, 'unbindTask'])
      .as('projects.requirements.unbind-task')
  })
  .prefix('/api/v1/projects/:projectId/requirements')
  .use(middleware.auth())

// 议题与缺陷追踪
router
  .group(() => {
    router.get('/', [IssuesController, 'index']).as('projects.issues.index')
    router.post('/', [IssuesController, 'store']).as('projects.issues.store')
    router.get('/:id', [IssuesController, 'show']).as('projects.issues.show')
    router.patch('/:id', [IssuesController, 'update']).as('projects.issues.update')
    router
      .patch('/:id/status', [IssuesController, 'changeStatus'])
      .as('projects.issues.change-status')
    router.delete('/:id', [IssuesController, 'destroy']).as('projects.issues.destroy')
  })
  .prefix('/api/v1/projects/:projectId/issues')
  .use(middleware.auth())

// 利害关系人登记表（?view=quadrant 四象限聚合）
router
  .group(() => {
    router.get('/', [ProjectStakeholdersController, 'index']).as('projects.stakeholders.index')
    router.post('/', [ProjectStakeholdersController, 'store']).as('projects.stakeholders.store')
    router.get('/:id', [ProjectStakeholdersController, 'show']).as('projects.stakeholders.show')
    router
      .patch('/:id', [ProjectStakeholdersController, 'update'])
      .as('projects.stakeholders.update')
    router
      .delete('/:id', [ProjectStakeholdersController, 'destroy'])
      .as('projects.stakeholders.destroy')
  })
  .prefix('/api/v1/projects/:projectId/stakeholders')
  .use(middleware.auth())

// 沟通管理计划
router
  .group(() => {
    router
      .get('/', [CommunicationPlansController, 'index'])
      .as('projects.communication-plans.index')
    router
      .post('/', [CommunicationPlansController, 'store'])
      .as('projects.communication-plans.store')
    router
      .get('/:id', [CommunicationPlansController, 'show'])
      .as('projects.communication-plans.show')
    router
      .patch('/:id', [CommunicationPlansController, 'update'])
      .as('projects.communication-plans.update')
    router
      .delete('/:id', [CommunicationPlansController, 'destroy'])
      .as('projects.communication-plans.destroy')
  })
  .prefix('/api/v1/projects/:projectId/communication-plans')
  .use(middleware.auth())

// 组织部门树（OBS，组织级 CRUD）
router
  .group(() => {
    router.get('/', [DepartmentsController, 'index']).as('departments.index')
    router.post('/', [DepartmentsController, 'store']).as('departments.store')
    router.get('/:id', [DepartmentsController, 'show']).as('departments.show')
    router.patch('/:id', [DepartmentsController, 'update']).as('departments.update')
    router.delete('/:id', [DepartmentsController, 'destroy']).as('departments.destroy')
  })
  .prefix('/api/v1/departments')
  .use(middleware.auth())

// 项目级聚合只读端点（RACI / OBS / 度量）
router
  .group(() => {
    router.get('/', [ProjectMetricsController, 'raciMatrix']).as('projects.raci-matrix.show')
  })
  .prefix('/api/v1/projects/:projectId/raci-matrix')
  .use(middleware.auth())

router
  .group(() => {
    router.get('/', [ProjectMetricsController, 'obsTree']).as('projects.obs-tree.show')
  })
  .prefix('/api/v1/projects/:projectId/obs-tree')
  .use(middleware.auth())

router
  .group(() => {
    router.get('/evm', [ProjectMetricsController, 'evm']).as('projects.metrics.evm')
    router
      .get('/evm/s-curve', [ProjectMetricsController, 'evmSCurve'])
      .as('projects.metrics.evm-s-curve')
    router.get('/burndown', [ProjectMetricsController, 'burndown']).as('projects.metrics.burndown')
    router.get('/lob', [ProjectMetricsController, 'lob']).as('projects.metrics.lob')
    router
      .get('/control-chart', [ProjectMetricsController, 'controlChart'])
      .as('projects.metrics.control-chart')
    router.get('/pareto', [ProjectMetricsController, 'pareto']).as('projects.metrics.pareto')
  })
  .prefix('/api/v1/projects/:projectId/metrics')
  .use(middleware.auth())
