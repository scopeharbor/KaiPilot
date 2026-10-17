/**
 * 中央权限注册表（sec11 功能×角色矩阵的唯一事实来源，design D4）。
 *
 * 只在此处定义权限标识串；Policy / RbacService / 中间件只消费这些常量，
 * 不散落硬编码字符串或角色判断。新增权限须先在此登记。
 */

export const ALL_PERMISSIONS = [
  // 组织
  'org:manage',
  'org:view',
  'org:member:manage',
  'org:billing:view',
  // 项目
  'project:create',
  'project:view',
  'project:update',
  'project:delete',
  'project:manage',
  'project:member:manage',
  // 任务
  'task:create',
  'task:view',
  'task:update',
  'task:update:self',
  'task:delete',
  'task:assign',
  'task:review',
  // WBS / 甘特图
  'wbs:manage',
  'wbs:view',
  'wbs:create',
  'wbs:update',
  'wbs:delete',
  'wbs:move',
  'gantt:view',
  'gantt:edit',
  // 里程碑
  'milestone:view',
  'milestone:create',
  'milestone:update',
  'milestone:delete',
  // 报表 / 变更 / 风险 / 文件
  'report:view',
  'report:create',
  'report:manage',
  'report:export',
  'report:download',
  'change_request:create',
  'change_request:approve',
  'risk:manage',
  'risk:view',
  'risk:update_own',
  'file:manage',
  'file:view',
  // AI
  'ai:trigger',
  'ai:confirm',
  'ai:connection:manage',
  // AI 资源缺口解释（v3-resource-gap-analysis §3.2）
  'ai:resource-gap:explain',
  // AI Compiler（v2-project-compiler-foundation）
  'ai:compiler:run',
  'ai:compiler:read',
  // AI Compiler Routing 管理（v2-5-compiler-dynamic-routing-management-ui）
  'ai:compiler:routing:view',
  'ai:compiler:routing:manage',
  // PDM 迁移（v2-pdm-migration-compatibility）
  'pdm:migration:plan',
  'pdm:migration:dry_run',
  'pdm:migration:execute',
  'pdm:migration:rollback',
  'pdm:migration:read',
  // 资源管理
  'resource:view',
  'resource:manage',
  // 审计 / 系统
  'audit:view',
  'system:admin',
  // 图表（diagram-spec-minimum-contract）
  'diagram:view',
  'diagram:manage',
  // 通知
  'notification:view',
  'notification:manage:self',
  // 第三方集成预连接
  'integration:connect',
  // 入站 webhook 管理（v2-5-provider-incoming-webhook-foundation）
  'webhook:manage',
  // 出站 webhook 订阅管理（v2-5-outgoing-webhook-subscription-foundation）
  'outgoing_webhook:manage',
  // 评论（basic-comments）
  'comment:view',
  'comment:create',
  'comment:update:self',
  'comment:delete:self',
  'comment:moderate',
  // 自定义视图（v2-custom-views-view-config）
  'custom_view:view',
  'custom_view:manage',
  // 变更影响分析（v2-change-management-impact-analysis）
  'change_impact:view',
  'change_impact:manage',
  // TRIZ 矛盾模型基础层（v2-triz-contradiction-model-foundation）
  'contradiction:view',
  'contradiction:manage',
  // 项目健康诊断（v2-ai-project-health-diagnosis）
  'project_health:view',
  'project_health:generate',
  'project_health:confirm',
  // AI 风险与进度预测（v2-ai-risk-progress-prediction）
  'prediction:view',
  'prediction:generate',
  'prediction:confirm',
  'prediction:trigger_ai',
  // AI 智能推荐（v2-ai-smart-recommendations）
  'recommendation:view',
  'recommendation:manage',
  // 确定性 UI Renderer（v2-deterministic-ui-renderer）
  'renderer:view',
  'renderer:manage',
  'renderer:admin',
  // TRIZ 决策日志（v2-triz-decision-log-traceability）
  'triz_decision:view',
  'triz_decision:manage',

  // TRIZ 推荐理由（v2-triz-recommendation-rationale-ui）
  'rationale:view',
  'rationale:feedback',
  'rationale:handoff',

  // TRIZ 创新工作台（v3-triz-innovation-workbench）
  'triz_innovation:view',
  'triz_innovation:manage',
  'triz_innovation:handoff',
  // AI Compiler Config 管理（v2-5-compiler-config-management-api）
  'ai:compiler:config:view',
  'ai:compiler:config:manage',
  // AI Compiler Cache 管理（v2-5-compiler-cache-management-api）
  'ai:compiler:cache:view',
  'ai:compiler:cache:manage',
  // AI Compiler Skill Registry（v3-skill-registry-and-lifecycle）
  'ai:compiler:skill:view',
  'ai:compiler:skill:author',
  'ai:compiler:skill:manage',
  'ai:compiler:skill:eval',
  'ai:compiler:skill:knowledge:review',
  // 四层知识底座（v3-four-layer-knowledge-system）
  'knowledge:view',
  'knowledge:author',
  'knowledge:manage',
  // PMO 组合交通灯（v3-pmo-portfolio-traffic-light）
  'portfolio:view',
  'portfolio:manage',
  // PMO AI 优先级推荐（v3-pmo-ai-priority-recommendations）
  'portfolio:ai-priority-recommendations:view',
  'portfolio:ai-priority-recommendations:manage',
  'portfolio:ai-priority-recommendations:ai',
  // 多项目影响分析（v3-multi-project-impact-analysis）
  'multi_project_impact:view',
  'multi_project_impact:manage',
  // PMO 决策工作台（v3-pmo-decision-intelligence-workbench）——最小权限闭集；
  // 来源维度权限（资源/风险/预测等）保持独立，由 Policy 二次校验。
  'pmo_decision:view',
  'pmo_decision:manage',
  'pmo_decision:decide',
  'pmo_decision:handoff',
  'pmo_decision:request_ai',
  // 资源容量预测闭环（v3-resource-capacity-forecasting-closed-loop）
  'resource_capacity_loop:view',
  'resource_capacity_loop:manage',
  // TRIZ 物理矛盾分析（v3-triz-physical-contradiction-analyzer）
  'physical_contradiction:analyze',
  'physical_contradiction:manage',
  'technical_contradiction:analyze',
  'technical_contradiction:manage',
  // TRIZ 资源分析（v3-triz-resource-analyzer）
  'triz_resource_analyzer:view',
  'triz_resource_analyzer:manage',
  // TRIZ 进化趋势分析（v3-triz-evolution-trend-analysis）
  'triz_evolution_trend_analysis:view',
  'triz_evolution_trend_analysis:manage',
  // TRIZ IFR 可视化（v3-triz-ifr-visualization）
  'triz_ifr:view',
  'triz_ifr:manage',
  // TRIZ 功能分析图（v3-triz-function-analysis-diagram）
  'triz_function_analysis:view',
  'triz_function_analysis:manage',
  // TRIZ Skill Layer 集成（v3-triz-skill-layer-integration）
  'triz_skill_layer:view',
  'triz_skill_layer:preview',
  // TRIZ-PM 阶段整合（v3-triz-pm-phase-integration）
  'triz_pm_phase_integration:view',
  'triz_pm_phase_integration:manage',
  'triz_pm_phase_integration:explain',
  // OCR 审查确认（v3-ocr-review-confirmation-flow）
  'ocr:review',
  'ocr:confirm',
  // OCR 文档上传（v3-ocr-document-upload-flow）
  'ocr_document:view',
  'ocr_document:manage',
  // v3-ocr-provider-observability-cost-controls
  'ocr_provider_observability:view',
  'ocr_provider_observability:manage',
  // AI-TRIZ 助手（v3-ai-triz-assistant）
  'triz_assistant:view',
  'triz_assistant:manage',
  // OCR 保留治理（v3-ocr-result-persistence-and-retention）
  'ocr_retention:view',
  'ocr_retention:manage',
  'ocr_retention:hold',
  'ocr_retention:cleanup',
  // OCR 搜索索引（v3-ocr-document-search-indexing）
  'ocr_search_index:view',
  'ocr_search_index:manage',
  // OCR 结构化提取（v3-ocr-structured-extraction）
  'ocr_structured_extraction:view',
  'ocr_structured_extraction:manage',
  'ocr_structured_extraction:run',
  'ocr_structured_extraction:confirm',
  // OCR 实体链接（v3-ocr-entity-linking）
  'ocr_entity_link:view',
  'ocr_entity_link:manage',
  'ocr_entity_link:confirm',
  'ocr_entity_link:explain',
  // OCR 隐私策略控制（v3-ocr-privacy-policy-controls）
  'ocr_privacy:view',
  'ocr_privacy:manage',
  'ocr_privacy:copy',
  'ocr_privacy:export',
  'ocr_privacy:audit_status',
  // OCR 权限与审计治理（v3-ocr-permission-and-audit）
  'ocr_permission_audit:view_status',
  'ocr_permission_audit:audit_read',
  // 34 阶段代码生成候选运行（v3-codegen-34-stage-candidate-runtime-execution）
  'codegen_candidate_run:view',
  'codegen_candidate_run:run',
  // 文档全文搜索（v3-document-full-text-search）
  'document_search:view',
  'document_search:manage',

  // 私有插件目录（v3-plugin-private-registry-lifecycle）
  'plugin_registry:view',
  'plugin_registry:submit',
  'plugin_registry:review',
  'plugin_registry:manage',
  'plugin_registry:rollback',

  // 插件安装生命周期（v3-skill-as-plugin-adapter / W2b）
  'plugin_install:view',
  'plugin_install:manage',

  // 插件写入动作统一边界（v3-plugin-action-preview-boundary）
  'plugin_action:view',
  'plugin_action:confirm',
  // 插件统一变更请求（v3-plugin-approval-change-flow，并行交付调和）
  'plugin_change_request:view',
  'plugin_change_request:manage',
  'plugin_change_request:approve',
  // 插件组织/项目级 scoped 存储（v3-plugin-scoped-storage）
  'plugin_storage:view',
  'plugin_storage:manage',
  'plugin_storage:export',
  // 知识与记忆运营层（v3-knowledge-memory-operating-layer）只读
  'knowledge_memory_operating:view',

  // TRIZ 到交付闭环（v3-triz-to-delivery-closed-loop）
  'triz_delivery_loop:view',
  'triz_delivery_loop:link',
  'triz_delivery_loop:verify',
  'triz_delivery_loop:reopen',
  'triz_delivery_loop:request_ai',
  // AI 质量与成本控制台（v3-ai-quality-cost-admin-console）
  'ai:usage:view',
  'ai_output_quality:view',
  'ai_rate_limit:view',
  'ai_feedback:view',
  'ai_evaluation:view',
  'ai_quality_cost_console:view',
  'ai_quality_cost_console:view_cost',
  'ai_quality_cost_console:manage_thresholds',
  'ai_quality_cost_console:export',
  'ai_quality_cost_console:manage_outbound',
  'ai_quality_cost_console:manage_experiments',
  // Copilot 网页搜索工具（v3-copilot-optional-web-search-configuration）
  'copilot:web_search:manage',
  // 图表馆数据后端底座（v3-chart-gallery-data-foundation，design D4）
  'charter:approve',
  'department:manage',
  'department:view',
  'issue:manage',
  'requirement:manage',
] as const

export type Permission = (typeof ALL_PERMISSIONS)[number]

/**
 * 运行时守卫：判定任意字符串是否为已登记权限。
 */
export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value)
}

// 常量别名（避免后续大量重复字符串字面量）
export const ORG_MANAGE: Permission = 'org:manage'
export const ORG_VIEW: Permission = 'org:view'
export const ORG_MEMBER_MANAGE: Permission = 'org:member:manage'
export const ORG_BILLING_VIEW: Permission = 'org:billing:view'
export const PROJECT_CREATE: Permission = 'project:create'
export const PROJECT_VIEW: Permission = 'project:view'
export const PROJECT_UPDATE: Permission = 'project:update'
export const PROJECT_DELETE: Permission = 'project:delete'
export const PROJECT_MANAGE: Permission = 'project:manage'
export const PROJECT_MEMBER_MANAGE: Permission = 'project:member:manage'
export const TASK_CREATE: Permission = 'task:create'
export const TASK_VIEW: Permission = 'task:view'
export const TASK_UPDATE: Permission = 'task:update'
export const TASK_UPDATE_SELF: Permission = 'task:update:self'
export const TASK_DELETE: Permission = 'task:delete'
export const TASK_ASSIGN: Permission = 'task:assign'
export const TASK_REVIEW: Permission = 'task:review'
export const WBS_MANAGE: Permission = 'wbs:manage'
export const WBS_VIEW: Permission = 'wbs:view'
export const WBS_CREATE: Permission = 'wbs:create'
export const WBS_UPDATE: Permission = 'wbs:update'
export const WBS_DELETE: Permission = 'wbs:delete'
export const WBS_MOVE: Permission = 'wbs:move'
export const GANTT_VIEW: Permission = 'gantt:view'
export const GANTT_EDIT: Permission = 'gantt:edit'
export const MILESTONE_VIEW: Permission = 'milestone:view'
export const MILESTONE_CREATE: Permission = 'milestone:create'
export const MILESTONE_UPDATE: Permission = 'milestone:update'
export const MILESTONE_DELETE: Permission = 'milestone:delete'
export const REPORT_VIEW: Permission = 'report:view'
export const REPORT_CREATE: Permission = 'report:create'
export const REPORT_MANAGE: Permission = 'report:manage'
export const REPORT_EXPORT: Permission = 'report:export'
export const REPORT_DOWNLOAD: Permission = 'report:download'
export const CHANGE_REQUEST_CREATE: Permission = 'change_request:create'
export const CHANGE_REQUEST_APPROVE: Permission = 'change_request:approve'
export const RISK_MANAGE: Permission = 'risk:manage'
export const RISK_VIEW: Permission = 'risk:view'
export const RISK_UPDATE_OWN: Permission = 'risk:update_own'
export const FILE_MANAGE: Permission = 'file:manage'
export const FILE_VIEW: Permission = 'file:view'
export const AI_TRIGGER: Permission = 'ai:trigger'
export const AI_CONFIRM: Permission = 'ai:confirm'
export const AI_CONNECTION_MANAGE: Permission = 'ai:connection:manage'
/** 资源缺口分析的 AI 解释权限（v3-resource-gap-analysis §3.2；补登记后仍未授予任何角色）。 */
export const AI_RESOURCE_GAP_EXPLAIN: Permission = 'ai:resource-gap:explain'
export const AI_COMPILER_RUN: Permission = 'ai:compiler:run'
export const AI_COMPILER_READ: Permission = 'ai:compiler:read'
export const PDM_MIGRATION_PLAN: Permission = 'pdm:migration:plan'
export const PDM_MIGRATION_DRY_RUN: Permission = 'pdm:migration:dry_run'
export const PDM_MIGRATION_EXECUTE: Permission = 'pdm:migration:execute'
export const PDM_MIGRATION_ROLLBACK: Permission = 'pdm:migration:rollback'
export const PDM_MIGRATION_READ: Permission = 'pdm:migration:read'
export const RESOURCE_VIEW: Permission = 'resource:view'
export const RESOURCE_MANAGE: Permission = 'resource:manage'
export const AUDIT_VIEW: Permission = 'audit:view'
export const SYSTEM_ADMIN: Permission = 'system:admin'
export const DIAGRAM_VIEW: Permission = 'diagram:view'
export const DIAGRAM_MANAGE: Permission = 'diagram:manage'
export const NOTIFICATION_VIEW: Permission = 'notification:view'
export const NOTIFICATION_MANAGE_SELF: Permission = 'notification:manage:self'
export const INTEGRATION_CONNECT: Permission = 'integration:connect'
export const WEBHOOK_MANAGE: Permission = 'webhook:manage'
export const OUTGOING_WEBHOOK_MANAGE: Permission = 'outgoing_webhook:manage'
export const COMMENT_VIEW: Permission = 'comment:view'
export const COMMENT_CREATE: Permission = 'comment:create'
export const COMMENT_UPDATE_SELF: Permission = 'comment:update:self'
export const COMMENT_DELETE_SELF: Permission = 'comment:delete:self'
export const COMMENT_MODERATE: Permission = 'comment:moderate'
export const CUSTOM_VIEW_VIEW: Permission = 'custom_view:view'
export const CUSTOM_VIEW_MANAGE: Permission = 'custom_view:manage'
export const CHANGE_IMPACT_VIEW: Permission = 'change_impact:view'
export const CHANGE_IMPACT_MANAGE: Permission = 'change_impact:manage'
export const CONTRADICTION_VIEW: Permission = 'contradiction:view'
export const CONTRADICTION_MANAGE: Permission = 'contradiction:manage'
export const PROJECT_HEALTH_VIEW: Permission = 'project_health:view'
export const PROJECT_HEALTH_GENERATE: Permission = 'project_health:generate'
export const PROJECT_HEALTH_CONFIRM: Permission = 'project_health:confirm'
export const PREDICTION_VIEW: Permission = 'prediction:view'
export const PREDICTION_GENERATE: Permission = 'prediction:generate'
export const PREDICTION_CONFIRM: Permission = 'prediction:confirm'
export const PREDICTION_TRIGGER_AI: Permission = 'prediction:trigger_ai'
export const RECOMMENDATION_VIEW: Permission = 'recommendation:view'
export const RECOMMENDATION_MANAGE: Permission = 'recommendation:manage'

// 确定性 UI Renderer（v2-deterministic-ui-renderer）
export const RENDERER_VIEW: Permission = 'renderer:view'
export const RENDERER_MANAGE: Permission = 'renderer:manage'
export const RENDERER_ADMIN: Permission = 'renderer:admin'

// TRIZ 决策日志（v2-triz-decision-log-traceability）
export const TRIZ_DECISION_VIEW: Permission = 'triz_decision:view'
export const TRIZ_DECISION_MANAGE: Permission = 'triz_decision:manage'

// TRIZ 推荐理由（v2-triz-recommendation-rationale-ui）
export const RATIONALE_VIEW: Permission = 'rationale:view'
export const RATIONALE_FEEDBACK: Permission = 'rationale:feedback'
export const RATIONALE_HANDOFF: Permission = 'rationale:handoff'

// TRIZ 创新工作台（v3-triz-innovation-workbench）
export const TRIZ_INNOVATION_VIEW: Permission = 'triz_innovation:view'
export const TRIZ_INNOVATION_MANAGE: Permission = 'triz_innovation:manage'
export const TRIZ_INNOVATION_HANDOFF: Permission = 'triz_innovation:handoff'

// TRIZ 到交付闭环（v3-triz-to-delivery-closed-loop）
// automation/system/AI/plugin actor 在 Service 层被拒绝 verify/reopen，
// 这里不授任何「自动化身份」入口；request_ai 仅显式触发 advisory 草稿。
export const TRIZ_DELIVERY_LOOP_VIEW: Permission = 'triz_delivery_loop:view'
export const TRIZ_DELIVERY_LOOP_LINK: Permission = 'triz_delivery_loop:link'
export const TRIZ_DELIVERY_LOOP_VERIFY: Permission = 'triz_delivery_loop:verify'
export const TRIZ_DELIVERY_LOOP_REOPEN: Permission = 'triz_delivery_loop:reopen'
export const TRIZ_DELIVERY_LOOP_REQUEST_AI: Permission = 'triz_delivery_loop:request_ai'

// AI Compiler Routing 管理（v2-5-compiler-dynamic-routing-management-ui）
export const AI_COMPILER_ROUTING_VIEW: Permission = 'ai:compiler:routing:view'
export const AI_COMPILER_ROUTING_MANAGE: Permission = 'ai:compiler:routing:manage'

// AI Compiler Config 管理（v2-5-compiler-config-management-api）
export const AI_COMPILER_CONFIG_VIEW: Permission = 'ai:compiler:config:view'
export const AI_COMPILER_CONFIG_MANAGE: Permission = 'ai:compiler:config:manage'

// AI Compiler Cache 管理（v2-5-compiler-cache-management-api）
export const AI_COMPILER_CACHE_VIEW: Permission = 'ai:compiler:cache:view'
export const AI_COMPILER_CACHE_MANAGE: Permission = 'ai:compiler:cache:manage'

// AI Compiler Skill Registry（v3-skill-registry-and-lifecycle）
export const AI_COMPILER_SKILL_VIEW: Permission = 'ai:compiler:skill:view'
export const AI_COMPILER_SKILL_AUTHOR: Permission = 'ai:compiler:skill:author'
export const AI_COMPILER_SKILL_MANAGE: Permission = 'ai:compiler:skill:manage'
export const AI_COMPILER_SKILL_EVAL: Permission = 'ai:compiler:skill:eval'
export const AI_COMPILER_SKILL_KNOWLEDGE_REVIEW: Permission = 'ai:compiler:skill:knowledge:review'

// 四层知识底座（v3-four-layer-knowledge-system）
export const KNOWLEDGE_VIEW: Permission = 'knowledge:view'
export const KNOWLEDGE_AUTHOR: Permission = 'knowledge:author'
export const KNOWLEDGE_MANAGE: Permission = 'knowledge:manage'

// PMO 组合交通灯（v3-pmo-portfolio-traffic-light）
export const PORTFOLIO_VIEW: Permission = 'portfolio:view'
// PMO AI 优先级推荐（v3-pmo-ai-priority-recommendations）
export const PORTFOLIO_AI_PRIORITY_RECOMMENDATIONS_VIEW: Permission =
  'portfolio:ai-priority-recommendations:view'
export const PORTFOLIO_AI_PRIORITY_RECOMMENDATIONS_MANAGE: Permission =
  'portfolio:ai-priority-recommendations:manage'
export const PORTFOLIO_AI_PRIORITY_RECOMMENDATIONS_AI: Permission =
  'portfolio:ai-priority-recommendations:ai'
export const PORTFOLIO_MANAGE: Permission = 'portfolio:manage'
// 多项目影响分析（v3-multi-project-impact-analysis）
export const MULTI_PROJECT_IMPACT_VIEW: Permission = 'multi_project_impact:view'
export const MULTI_PROJECT_IMPACT_MANAGE: Permission = 'multi_project_impact:manage'

// PMO 决策工作台（v3-pmo-decision-intelligence-workbench）
// view=查看议题/证据/对比；manage=创建/更新/转移/刷新；decide=记录终态结论；
// handoff=创建受控交接；request_ai=显式触发 AI 叙述。
export const PMO_DECISION_VIEW: Permission = 'pmo_decision:view'
export const PMO_DECISION_MANAGE: Permission = 'pmo_decision:manage'
export const PMO_DECISION_DECIDE: Permission = 'pmo_decision:decide'
export const PMO_DECISION_HANDOFF: Permission = 'pmo_decision:handoff'
export const PMO_DECISION_REQUEST_AI: Permission = 'pmo_decision:request_ai'

// TRIZ 物理矛盾分析（v3-triz-physical-contradiction-analyzer）
export const PHYSICAL_CONTRADICTION_ANALYZE: Permission = 'physical_contradiction:analyze'
export const PHYSICAL_CONTRADICTION_MANAGE: Permission = 'physical_contradiction:manage'

// TRIZ 技术矛盾分析（v3-triz-technical-contradiction-analyzer）
export const TECHNICAL_CONTRADICTION_ANALYZE: Permission = 'technical_contradiction:analyze'
export const TECHNICAL_CONTRADICTION_MANAGE: Permission = 'technical_contradiction:manage'

// TRIZ 功能分析图（v3-triz-function-analysis-diagram）
export const FUNCTION_ANALYSIS_VIEW: Permission = 'triz_function_analysis:view'
export const FUNCTION_ANALYSIS_MANAGE: Permission = 'triz_function_analysis:manage'

// TRIZ IFR 可视化（v3-triz-ifr-visualization）
export const TRIZ_IFR_VIEW: Permission = 'triz_ifr:view'
export const TRIZ_IFR_MANAGE: Permission = 'triz_ifr:manage'

// TRIZ 资源分析（v3-triz-resource-analyzer）
// 资源容量预测闭环（v3-resource-capacity-forecasting-closed-loop）
export const RESOURCE_CAPACITY_LOOP_VIEW: Permission = 'resource_capacity_loop:view'
export const RESOURCE_CAPACITY_LOOP_MANAGE: Permission = 'resource_capacity_loop:manage'
export const TRIZ_RESOURCE_ANALYZER_VIEW: Permission = 'triz_resource_analyzer:view'
export const TRIZ_RESOURCE_ANALYZER_MANAGE: Permission = 'triz_resource_analyzer:manage'

// TRIZ 进化趋势分析（v3-triz-evolution-trend-analysis）
export const TRIZ_EVOLUTION_TREND_ANALYSIS_VIEW: Permission = 'triz_evolution_trend_analysis:view'
export const TRIZ_EVOLUTION_TREND_ANALYSIS_MANAGE: Permission =
  'triz_evolution_trend_analysis:manage'
export const TRIZ_SKILL_LAYER_VIEW: Permission = 'triz_skill_layer:view'
export const TRIZ_SKILL_LAYER_PREVIEW: Permission = 'triz_skill_layer:preview'

// TRIZ-PM 阶段整合（v3-triz-pm-phase-integration）
export const TRIZ_PM_PHASE_INTEGRATION_VIEW: Permission = 'triz_pm_phase_integration:view'
export const TRIZ_PM_PHASE_INTEGRATION_MANAGE: Permission = 'triz_pm_phase_integration:manage'
export const TRIZ_PM_PHASE_INTEGRATION_EXPLAIN: Permission = 'triz_pm_phase_integration:explain'

// OCR 审查确认（v3-ocr-review-confirmation-flow）
export const OCR_REVIEW: Permission = 'ocr:review'
export const OCR_CONFIRM: Permission = 'ocr:confirm'

// OCR 文档上传（v3-ocr-document-upload-flow）
export const OCR_DOCUMENT_VIEW: Permission = 'ocr_document:view'
export const OCR_DOCUMENT_MANAGE: Permission = 'ocr_document:manage'

// AI-TRIZ 助手（v3-ai-triz-assistant）
export const TRIZ_ASSISTANT_VIEW: Permission = 'triz_assistant:view'
export const TRIZ_ASSISTANT_MANAGE: Permission = 'triz_assistant:manage'

// OCR 保留治理（v3-ocr-result-persistence-and-retention）
export const OCR_RETENTION_VIEW: Permission = 'ocr_retention:view'
export const OCR_RETENTION_MANAGE: Permission = 'ocr_retention:manage'
export const OCR_RETENTION_HOLD: Permission = 'ocr_retention:hold'
export const OCR_RETENTION_CLEANUP: Permission = 'ocr_retention:cleanup'

// OCR 搜索索引（v3-ocr-document-search-indexing）
export const OCR_SEARCH_INDEX_VIEW: Permission = 'ocr_search_index:view'
export const OCR_SEARCH_INDEX_MANAGE: Permission = 'ocr_search_index:manage'

// OCR 结构化提取（v3-ocr-structured-extraction）
export const OCR_STRUCTURED_EXTRACTION_VIEW: Permission = 'ocr_structured_extraction:view'
export const OCR_STRUCTURED_EXTRACTION_MANAGE: Permission = 'ocr_structured_extraction:manage'
export const OCR_STRUCTURED_EXTRACTION_RUN: Permission = 'ocr_structured_extraction:run'
export const OCR_STRUCTURED_EXTRACTION_CONFIRM: Permission = 'ocr_structured_extraction:confirm'

// OCR Provider 观测（v3-ocr-provider-observability-cost-controls）
export const OCR_PROVIDER_OBSERVABILITY_VIEW: Permission = 'ocr_provider_observability:view'
export const OCR_PROVIDER_OBSERVABILITY_MANAGE: Permission = 'ocr_provider_observability:manage'

// OCR 实体链接（v3-ocr-entity-linking）
export const OCR_ENTITY_LINK_VIEW: Permission = 'ocr_entity_link:view'
export const OCR_ENTITY_LINK_MANAGE: Permission = 'ocr_entity_link:manage'
export const OCR_ENTITY_LINK_CONFIRM: Permission = 'ocr_entity_link:confirm'
export const OCR_ENTITY_LINK_EXPLAIN: Permission = 'ocr_entity_link:explain'

// OCR 隐私策略控制（v3-ocr-privacy-policy-controls）
export const OCR_PRIVACY_VIEW: Permission = 'ocr_privacy:view'
export const OCR_PRIVACY_MANAGE: Permission = 'ocr_privacy:manage'
export const OCR_PRIVACY_COPY: Permission = 'ocr_privacy:copy'
export const OCR_PRIVACY_EXPORT: Permission = 'ocr_privacy:export'
export const OCR_PRIVACY_AUDIT_STATUS: Permission = 'ocr_privacy:audit_status'

// OCR 权限与审计治理（v3-ocr-permission-and-audit）
export const OCR_PERMISSION_AUDIT_VIEW_STATUS: Permission = 'ocr_permission_audit:view_status'
export const OCR_PERMISSION_AUDIT_AUDIT_READ: Permission = 'ocr_permission_audit:audit_read'

// 34 阶段代码生成候选运行（v3-codegen-34-stage-candidate-runtime-execution）
export const CODEGEN_CANDIDATE_RUN_VIEW: Permission = 'codegen_candidate_run:view'
export const CODEGEN_CANDIDATE_RUN_RUN: Permission = 'codegen_candidate_run:run'

// 文档全文搜索（v3-document-full-text-search）
export const DOCUMENT_SEARCH_VIEW: Permission = 'document_search:view'
export const DOCUMENT_SEARCH_MANAGE: Permission = 'document_search:manage'

// 私有插件目录（v3-plugin-private-registry-lifecycle）
/** 查看组织私有插件目录 */
export const PLUGIN_REGISTRY_VIEW: Permission = 'plugin_registry:view'
/** 提交 release 送审 */
export const PLUGIN_REGISTRY_SUBMIT: Permission = 'plugin_registry:submit'
/** 审批/拒绝 release */
export const PLUGIN_REGISTRY_REVIEW: Permission = 'plugin_registry:review'
/** 弃用/撤回/恢复管理操作 */
export const PLUGIN_REGISTRY_MANAGE: Permission = 'plugin_registry:manage'
/** 确认回滚操作 */
export const PLUGIN_REGISTRY_ROLLBACK: Permission = 'plugin_registry:rollback'

// 插件安装生命周期（v3-skill-as-plugin-adapter / W2b）
/** 查看插件安装态 */
export const PLUGIN_INSTALL_VIEW: Permission = 'plugin_install:view'
/** 管理插件安装态（安装/启用/停用/升级/卸载） */
export const PLUGIN_INSTALL_MANAGE: Permission = 'plugin_install:manage'

// 插件统一变更请求与审批确认（v3-plugin-approval-change-flow）
/** 查看组织内插件变更请求与决策流水 */
export const PLUGIN_CHANGE_REQUEST_VIEW: Permission = 'plugin_change_request:view'
/** 发起/预览/撤回/确认插件变更请求 */
export const PLUGIN_CHANGE_REQUEST_MANAGE: Permission = 'plugin_change_request:manage'
/** 审批/拒绝插件变更请求（maker-checker 审批者，不得与发起人同一人） */
export const PLUGIN_CHANGE_REQUEST_APPROVE: Permission = 'plugin_change_request:approve'

// 插件写入动作统一边界（v3-plugin-action-preview-boundary）
/** 查看组织内插件动作提案与标准预览 */
export const PLUGIN_ACTION_VIEW: Permission = 'plugin_action:view'
/** 确认/拒绝/修改插件动作提案（一次性句柄确认；正式写入唯一入口） */
export const PLUGIN_ACTION_CONFIRM: Permission = 'plugin_action:confirm'

// 插件组织/项目级 scoped 存储（v3-plugin-scoped-storage）
/** 查看组织插件存储 namespace/配额/用量（含 runtime 读路径授权） */
export const PLUGIN_STORAGE_VIEW: Permission = 'plugin_storage:view'
/** 管理插件存储（runtime 写入授权、清理 preview/confirm） */
export const PLUGIN_STORAGE_MANAGE: Permission = 'plugin_storage:manage'
/** 导出本组织插件存储数据（版本化有界导出） */
export const PLUGIN_STORAGE_EXPORT: Permission = 'plugin_storage:export'

// 知识与记忆运营层（v3-knowledge-memory-operating-layer）
// summary / list / detail / surface resolve 仅做低敏投影；写入仍由 owning API 执行。
/** 查看组织级知识与记忆运营层（summary / list / detail / surface） */
export const KNOWLEDGE_MEMORY_OPERATING_VIEW = 'knowledge_memory_operating:view' as Permission

// AI 质量与成本控制台（v3-ai-quality-cost-admin-console）
/** 查看 AI 用量与额度视图（copilot-usage-surface） */
export const AI_USAGE_VIEW: Permission = 'ai:usage:view'
/** 查看 AI 输出质量校验聚合 */
export const AI_OUTPUT_QUALITY_VIEW: Permission = 'ai_output_quality:view'
/** 查看 AI 限流状态 */
export const AI_RATE_LIMIT_VIEW: Permission = 'ai_rate_limit:view'
/** 查看 AI 反馈账本采纳率 */
export const AI_FEEDBACK_VIEW: Permission = 'ai_feedback:view'
/** 查看 AI 自动评测评分聚合 */
export const AI_EVALUATION_VIEW: Permission = 'ai_evaluation:view'
/** 查看 AI 质量与成本控制台全部域 */
export const AI_QUALITY_COST_CONSOLE_VIEW: Permission = 'ai_quality_cost_console:view'
/** 仅查看控制台成本域 */
export const AI_QUALITY_COST_CONSOLE_VIEW_COST: Permission = 'ai_quality_cost_console:view_cost'
/** 管理控制台阈值与保留期 */
export const AI_QUALITY_COST_CONSOLE_MANAGE_THRESHOLDS: Permission =
  'ai_quality_cost_console:manage_thresholds'
/** 导出台控制台数据 */
export const AI_QUALITY_COST_CONSOLE_EXPORT: Permission = 'ai_quality_cost_console:export'
/** 管理控制台外发授权与目标 */
export const AI_QUALITY_COST_CONSOLE_MANAGE_OUTBOUND: Permission =
  'ai_quality_cost_console:manage_outbound'
/** 管理实验与版本域（Prompt 版本/离线回归/影子实验的创建与触发） */
export const AI_QUALITY_COST_CONSOLE_MANAGE_EXPERIMENTS: Permission =
  'ai_quality_cost_console:manage_experiments'

// Copilot 网页搜索工具（v3-copilot-optional-web-search-configuration）
/** 管理组织级「Copilot 工具」网页搜索设置（开关/域名策略/额度/provider 连接引用）。 */
export const COPILOT_WEB_SEARCH_MANAGE: Permission = 'copilot:web_search:manage'

// 图表馆数据后端底座（v3-chart-gallery-data-foundation，design D4）
/** 专属项目章程审批决议（通过/驳回），组织管理员持有。 */
export const CHARTER_APPROVE: Permission = 'charter:approve'
/** 部门树细粒度管理权限（别名映射兼备 org:manage）。 */
export const DEPARTMENT_MANAGE: Permission = 'department:manage'
/** 部门树只读查看权限（别名映射兼备 org:view）。 */
export const DEPARTMENT_VIEW: Permission = 'department:view'
/** 议题缺陷生命周期管理细粒度权限（当前端点复用 task:*，备细粒度授权用）。 */
export const ISSUE_MANAGE: Permission = 'issue:manage'
/** 需求管理与关联绑定细粒度权限（当前端点复用 task:*，备细粒度授权用）。 */
export const REQUIREMENT_MANAGE: Permission = 'requirement:manage'
