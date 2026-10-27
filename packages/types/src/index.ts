// @aiproj/types — 跨端共享类型入口。
//
// 后续 change（如 setup-database-schema、manage-projects）将在此定义
// User / Organization / Project / Task 等领域类型，供前后端共享。

/** 占位类型，后续 change 会替换为真实领域类型。 */
export type Placeholder = never

// ai-structured-output-poc / M0 —— 草案 schema 与 AIMarker 契约（前后端共享）。
// 后端 (AdonisJS NodeNext) 要求 `.js` 扩展。前端通过 next.config `transpilePackages`
// 让 Next 编译 @aiproj/types 源码，webpack 会自动匹配 `.ts`。
export * from './ai-m0.js'

// ai-gateway-abstraction / T034 —— AI 模型连接契约(前后端共享,自研双协议 Adapter)。
export * from './ai-connection.js'
export * from './ai-colleague-app-map.js'
export * from './entity-codes.js'
export * from './calendar-display.js'
export * from './personal-calendar.js'

// v3-ai-model-catalog-search-and-pricing —— models.dev 目录、价格与上下文限制契约。
export * from './ai-model-catalog.js'

// v2-5-third-party-ocr-provider-foundation —— 第三方 OCR 预览候选共享契约。
export * from './ai-ocr.js'

// audit-log-critical-actions / T006 —— 审计日志前后端共享类型。
export * from './audit-log.js'

// ai-intent-and-clarification / T035 —— 项目意图、三级问题与确认上下文契约。
export * from './ai-intent.js'
export * from './ai-analysis-job.js'

// ai-draft-generation / T036·T037 —— 生产级项目草案、SSE 事件、选择集、确认与校验契约。
export * from './ai-draft.js'

// resource-allocation-and-load —— 资源、分配与负载类型（前后端共享）。
export * from './resource.js'

// risk-register-and-ai-suggestions —— 风险登记册与 AI 建议类型（前后端共享）。
export * from './risk.js'

// diagram-spec-minimum-contract —— V1 DiagramSpec 最小共享契约（前后端共享）。
export * from './diagram-spec.js'

// preset-project-reports —— V1 预设项目报表共享契约（前后端共享）。
export * from './report.js'

// working-calendar-settings —— 项目级工作日历设置契约（前后端共享）。
export * from './working-calendar.js'

// dashboard-metrics-reconciliation —— Dashboard 指标字典与对账契约（前后端共享）。
export * from './dashboard-metrics.js'

// v2-custom-views-view-config —— 自定义视图共享契约（前后端共享）。
export * from './custom-views.js'

// basic-comments —— 评论系统共享契约（前后端共享）。
export * from './comment.js'
export * from './copilot-comment-agent-fixtures.js'

// v2-change-management-impact-analysis —— 变更影响分析共享契约（前后端共享）。
export * from './change-impact-analysis.js'

// v2-triz-contradiction-model-foundation —— TRIZ 矛盾模型基础层共享契约（前后端共享）。
export * from './triz-contradiction.js'

// v2-triz-compiler-analysis-layer —— TRIZ Compiler 分析层共享契约（前后端共享）。
export * from './triz-compiler-analysis.js'

// v2-triz-ai-clarification-cards —— TRIZ AI 澄清卡片共享契约（前后端共享）。
export * from './triz-clarification-cards.js'

// v2-ai-draft-layer-preview-diff-apply —— Draft Layer 共享契约（前后端共享）。
export * from './ai-draft-layer.js'

// v2-lightweight-calendar-message-integrations —— 第三方日历/消息集成预连接契约。
export * from './integration.js'

// v2-advanced-search —— 高级搜索共享契约（前后端共享）。
export * from './search.js'

// v2-advanced-search —— 高级搜索后端 DTO 类型（后端专用，不引入共享包）。
// 后端搜索类型定义在 apps/backend/app/types/dto.ts

// v2-ai-project-health-diagnosis —— 项目健康诊断共享契约（前后端共享）。
export * from './project-health-diagnosis.js'

// v2-ai-risk-progress-prediction —— AI 风险与进度预测共享契约（前后端共享）。
export {
  AI_EXPLANATION_FAILURE_CODES,
  AI_EXPLANATION_STATUSES,
  EVIDENCE_VISIBILITY,
  PREDICTION_CONFIDENCE_BANDS,
  PREDICTION_SEVERITIES,
  PREDICTION_SEVERITY_ORDER,
  PREDICTION_SIGNAL_TYPES,
  PREDICTION_SIGNAL_TYPE_LABELS,
  PREDICTION_SNAPSHOT_STATUSES,
  PREDICTION_WINDOWS,
  predictionSeverityScore,
  type AiCostSummary as PredictionAiCostSummary,
  type AiExplanationFailureCode,
  type AiExplanationStatus,
  type ApproveAiExplanationRequest,
  type ApproveAiExplanationResponse,
  type ConfirmPredictionRequest,
  type ConfirmPredictionResponse,
  type CreatePredictionRequest,
  type CreatePredictionResponse,
  type DashboardPredictionSummary,
  type DismissPredictionRequest,
  type DismissPredictionResponse,
  type EvidenceVisibility,
  type GenerateAiExplanationRequest,
  type GenerateAiExplanationResponse,
  type GetPredictionResponse,
  type ListPredictionsQuery,
  type ListPredictionsResponse,
  type PredictionAiExplanation,
  type PredictionConfidenceBand,
  type PredictionConfirmation,
  type PredictionDataWarning,
  type PredictionEvidenceRef,
  type PredictionSeverity,
  type PredictionSignal,
  type PredictionSignalInput,
  type PredictionSignalType,
  type PredictionSnapshot,
  type PredictionSnapshotListItem,
  type PredictionSnapshotStatus,
  type PredictionWindow,
  type RejectAiExplanationRequest,
  type RejectAiExplanationResponse,
} from './prediction.js'

// v2-ai-smart-recommendations —— AI 智能推荐共享契约（前后端共享）。
export * from './recommendation.js'

// v2-github-gitlab-light-links —— GitHub/GitLab 轻量外部链接共享契约。
export * from './external-link.js'

// v2-5-code-repository-ci-status-display —— 代码仓库 CI/check 只读状态摘要共享契约。
export * from './code-repository-ci.js'

// v2-deterministic-ui-renderer —— 确定性 UI Renderer 共享契约（前后端共享）。
export {
  type AiRendererCandidate,
  type CalendarViewConfig,
  type CandidateStatus as RendererCandidateStatus,
  type ConfigHash,
  type ConfigSourceMetadata,
  type ConfigSourceType,
  type DashboardViewConfig,
  type DashboardWidgetConfig,
  type DataQueryConfig,
  type DataQueryFilter,
  type DataQuerySort,
  type DataQuerySource,
  type DefaultEntryResolveResult,
  type DependencyViewConfig,
  type FallbackLevel,
  type FallbackState,
  type GanttViewConfig,
  type KanbanViewConfig,
  type ListViewConfig,
  type ProjectViewConfig,
  type RendererDashboardSummary,
  type RendererViewType,
  type ResourceViewConfig,
  type RiskMatrixViewConfig,
  type TimelineViewConfig,
  type UserViewOverride,
  type UserViewOverrideEntry,
  type ValidationIssue,
  type ValidationResult,
  type ValidationSeverity,
  type ViewConfig,
  type ViewSpecificConfig,
  type WbsViewConfig,
  type WidgetType,
} from './renderer.js'

// v2-5-shared-contract-versioning diagram-spec-fixtures —— DiagramSpec 测试夹具（§4.2 P1）。
export * from './diagram-spec-fixtures.js'

// v2-triz-decision-log-traceability —— TRIZ 决策日志共享契约（前后端共享）。
export * from './triz-decision-log.js'

// v2-triz-recommendation-rationale-ui —— TRIZ 推荐理由共享契约（前后端共享）。
export * from './triz-recommendation-rationale.js'

// v3-triz-innovation-workbench —— TRIZ 创新工作台共享契约（前后端共享）。
export {
  IMPACT_DIMENSIONS as TRIZ_INNOVATION_IMPACT_DIMENSIONS,
  IMPACT_DIRECTIONS,
  INNOVATION_HANDOFF_STATUSES,
  INNOVATION_OPTION_ORIGINS,
  INNOVATION_REVIEW_STATES,
  INNOVATION_SCHEME_MAX_OPTIONS,
  INNOVATION_SCHEME_SCHEMA_VERSION,
  INNOVATION_SCHEME_STATUSES,
  INNOVATION_SORT_FIELDS,
  INNOVATION_SOURCE_TYPES,
  TRIZ_INNOVATION_WORKBENCH_SOURCE_TYPE,
  compareInnovationOptions,
  computeHandoffIdempotencyKey,
  computeInnovationOptionHash,
  computeInnovationSchemeHash,
  detectStaleSources,
  impactDirectionWeight,
  isImpactDimension,
  isImpactDirection,
  isInnovationOptionOrigin,
  isInnovationReviewState,
  isInnovationSchemeStatus,
  isInnovationSourceType,
  rankWarningSeverity,
  sortWarningsBySeverity as sortInnovationWarningsBySeverity,
  validateInnovationComparison,
  validateInnovationHandoffInput,
  validateInnovationNarrative,
  validateInnovationOption,
  validateInnovationScheme,
  type AddOptionRequest,
  type CreateInnovationSchemeRequest,
  type ImpactDimension,
  type ImpactDirection,
  type InnovationComparisonCell,
  type InnovationDashboardSummary,
  type InnovationDashboardSummaryResponse,
  type InnovationDraftHandoffInput,
  type InnovationDraftHandoffResponse,
  type InnovationHandoffMeta,
  type InnovationHandoffStatus,
  type InnovationImpactSummary,
  type InnovationNarrativeCost,
  type InnovationNarrativeResponse,
  type InnovationOption,
  type InnovationOptionHashes,
  type InnovationOptionOrigin,
  type InnovationReviewState,
  type InnovationScheme,
  type InnovationSchemeComparison,
  type InnovationSchemeComparisonResponse,
  type InnovationSchemeDTO,
  type InnovationSchemeDetailResponse,
  type InnovationSchemeNarrative,
  type InnovationSchemeStatus,
  type InnovationScore,
  type InnovationSortField,
  type InnovationSourceRef,
  type InnovationSourceType,
  type InnovationWorkbenchSourcesResponse,
  type ListInnovationSchemesResponse,
} from './triz-innovation-workbench.js'

// v2-5-shared-contract-versioning —— 共享契约版本化、契约目录与迁移适配器注册表（前后端共享）。
export * from './contract-versioning.js'

// v2-5-shared-contract-versioning compatibility-matrix —— 契约兼容矩阵 runner（§5 P0）。
export { runCompatibilityMatrix, type MatrixRunResult } from './compatibility-matrix.js'

// v2-5-streaming-progress-contract —— 统一流式进度事件契约（V2.5 W1 共享可见性基础）。
export * from './progress-streaming.js'

// v2-5-streaming-progress-contract fixtures —— StreamingProgressEnvelope 兼容矩阵夹具。
export * from './progress-streaming-fixtures.js'

// v2-5-agent-observation-mcp-fabric-baseline —— Agent Observation Plane 共享契约。
export * from './observation.js'

// v2-5-agent-observation-mcp-fabric-baseline fixtures —— Observation Manifest 兼容矩阵夹具。
export * from './observation-fixtures.js'

// v2-5-agent-observation-mcp-fabric-baseline compiler —— 本地 Agent Observation 编译器。
export * from './observation-compiler.js'

// v2-5-compiler-34-stage-code-generation-pipeline —— Compiler 34-stage code generation candidate contract.
export * from './compiler-code-generation.js'

// v3-v2-5-compatibility-gate —— V3 对 V2.5 GA 的兼容治理门共享契约（类型/账本/规则引擎，纯 TS 零依赖）。
export * from './v3-v2-5-compatibility-gate.js'
export * from './v3-v2-5-compatibility-gate-ledger.js'
export * from './v3-v2-5-compatibility-gate-rules.js'

// v2-5-streaming-websocket-service —— Streaming WebSocket Service 共享契约（前后端共享）。
export * from './streaming-websocket.js'

// v2-5-compiler-ab-compilation-framework —— Compiler A/B compilation 共享契约（前后端共享）。
export * from './compiler-ab-compilation.js'

// v2-5-compiler-config-management-api —— Compiler 配置档案共享契约（前后端共享）。
export * from './compiler-config-management.js'

// v2-5-compiler-cache-management-api —— Compiler 缓存运维管理共享契约（前后端共享）。
export * from './compiler-cache-management.js'

// v2-5-code-repository-auto-linking —— Repository reference link candidate 共享契约。
export * from './link-candidate.js'

// v2-5-provider-incoming-webhook-foundation —— per-provider 入站 webhook 接收底座契约。
export * from './incoming-webhook.js'

// v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 订阅管理面契约。
export * from './outgoing-webhook.js'

// v2-5-outgoing-webhook-delivery-ledger -- 出站 webhook 投递账本/HMAC/重试/手动重试契约。
export * from './outgoing-webhook-delivery.js'

// v2-5-webhook-templates-and-stats -- 出站 webhook 模板目录与投递统计共享契约。
export * from './outgoing-webhook-template.js'
// 内置模板目录（静态 catalog，前后端共用）。
export * from './outgoing-webhook-template-catalog.js'

// v2-5-pwa-web-push-notifications -- PWA Web Push 通知共享契约。
export * from './pwa-web-push.js'

// v2-5-typescript-sdk-core —— /api/v1 API envelope / 错误 / 项目 / 任务 DTO（前后端共享）。
export * from './api-contracts.js'

// v2-5-typescript-sdk-full-api-coverage —— full SDK 覆盖所需的跨域稳定 DTO。
export * from './api-full-contracts.js'

// v3-skill-registry-and-lifecycle —— Skill Registry 共享契约与确定性纯函数引擎（前后端共享）。
export * from './compiler-skill.js'

// v3-initial-skill-software-development —— 官方内置 Skill 种子目录与「软件开发」Skill 内容定义。
export * from './compiler-skill-builtin-seeds.js'

// v3-skill-activation-rules-engine —— Skill 激活规则引擎（项目级激活决策与组合层，前后端共享）。
export * from './skill-activation.js'

// v3-four-layer-knowledge-system —— 四层知识底座共享契约与确定性纯函数引擎（前后端共享）。
export * from './knowledge-layers.js'

// v3-skill-knowledge-authoring —— Skill 知识包创作契约与确定性纯函数引擎（前后端共享）。
export * from './skill-knowledge-authoring.js'

// v3-skill-eval-system —— Skill 评估系统契约与确定性纯函数引擎（前后端共享）。
export * from './skill-eval.js'

// v3-unified-ai-output-quality-ledger —— 跨能力面 AI 产出校验结果统一账本契约（前后端共享）。
export * from './unified-ai-output-quality.js'
export * from './unified-ai-output-quality-fixtures.js'

// v3-skill-compiler-integration —— Skill 知识注入 Compiler Context Packet 共享契约与纯函数（前后端共享）。
export * from './skill-compiler-integration.js'

// v3-pmo-portfolio-dashboard —— PMO 组合 Dashboard 共享契约（前后端共享）。
export * from './pmo-portfolio-dashboard.js'

// v3-pmo-portfolio-traffic-light —— PMO 组合交通灯共享契约（前后端共享）。
export * from './pmo-portfolio-traffic-light.js'

// v3-pmo-investment-distribution —— PMO 非财务投入分布共享契约（前后端共享）。
export * from './pmo-investment-distribution.js'
export * from './pmo-investment-distribution-fixtures.js'

// v3-pmo-ai-priority-recommendations —— PMO AI 优先级推荐共享契约（前后端共享）。
export * from './pmo-ai-priority-recommendations.js'

// v3-pmo-portfolio-grouping-views —— PMO 组合分组视图共享契约（前后端共享）。
export * from './pmo-portfolio-grouping-views.js'
export * from './pmo-portfolio-grouping-views-fixtures.js'

// v3-organization-dashboard —— 组织级 Dashboard 共享契约与 API fixture（前后端共享）。
export * from './organization-dashboard.js'
export * from './organization-dashboard-fixtures.js'

// plan policy —— 组织套餐层级前后端共享契约（free 个人工作区不授企业能力）。
export * from './organization-plan.js'

// v3-organization-dashboard-layout-builder —— 组织 Dashboard 布局编排共享契约（前后端共享）。
export * from './organization-dashboard-layout.js'

// v3-pmo-priority-scoring-model —— PMO 优先级评分模型共享契约（前后端共享）。
export * from './pmo-priority-scoring-model.js'
export * from './pmo-priority-scoring-model-fixtures.js'

// v3-organization-resource-pool —— 组织资源池共享契约（前后端共享）。
export * from './organization-resource-pool.js'
export * from './organization-resource-pool-fixtures.js'

// v3-database-schema-expansion —— 项目组合事实共享契约（前后端共享）。
export * from './project-facts.js'
export * from './project-facts-fixtures.js'

// v3-resource-skill-matrix —— 资源技能矩阵共享契约（前后端共享）。
export * from './resource-skill-matrix.js'
export * from './resource-skill-matrix-fixtures.js'

// v3-resource-demand-forecasting —— 资源需求预测共享契约（前后端共享）。
export * from './resource-demand-forecasting.js'

// v3-cross-project-resource-allocation —— 跨项目资源分配共享契约（前后端共享）。
export * from './cross-project-resource-allocation.js'
export * from './cross-project-resource-allocation-pure.js'

// v3-resource-contention-detection —— 资源争用检测共享契约（前后端共享）。
export * from './resource-contention-detection.js'

// v3-resource-gap-analysis —— 资源缺口分析共享契约（前后端共享）。
export * from './resource-gap-analysis.js'

// v3-okr-hierarchy-management —— OKR 层级管理共享契约（前后端共享）。
export * from './okr.js'

// v3-okr-progress-backflow —— OKR 进度回流共享契约（前后端共享）。
export * from './okr-progress-backflow.js'

// v3-okr-dashboard —— OKR 只读 Dashboard 共享契约（前后端共享）。
export * from './okr-dashboard.js'

// v3-strategy-execution-cockpit —— 战略执行驾驶舱共享契约、纯函数与夹具（前后端共享）。
export * from './strategy-execution-cockpit.js'
export * from './strategy-execution-cockpit-fixtures.js'

// v3-bi-trend-analysis —— BI 趋势分析共享契约与确定性趋势纯函数（前后端共享）。
export * from './bi-trend-analysis.js'

// v3-bi-risk-heatmap —— BI 风险热力图共享契约与确定性风险评分纯函数（前后端共享）。
export * from './bi-risk-heatmap.js'

// v3-bi-custom-report-builder —— BI 自定义报表构建器共享契约（前后端共享）。
export * from './bi-custom-report-builder.js'

// v3-bi-report-template-library —— BI 报表模板库共享契约与零运行时依赖纯函数（前后端共享）。
export * from './bi-report-template-library.js'

// v3-bi-dashboard-builder —— BI Dashboard Builder 共享契约（前后端共享）。
export * from './bi-dashboard-builder.js'

// v3-multi-project-dependency-detection —— 多项目依赖检测共享契约与确定性纯函数（前后端共享）。
export * from './multi-project-dependency-detection.js'

// v3-bi-data-aggregation-service —— BI 数据聚合服务共享契约与确定性纯函数（前后端共享）。
export * from './bi-data-aggregation-service.js'

// v3-multi-project-dependency-crud —— 跨项目依赖 CRUD 共享契约（前后端共享）。
export * from './multi-project-dependency-crud.js'

// v3-multi-project-dependency-model —— 跨项目依赖管理共享契约、纯函数与夹具（前后端共享）。
export * from './multi-project-dependency-model.js'
export * from './multi-project-dependency-fixtures.js'
export * from './multi-project-dependency-crud-helpers.js'
export * from './multi-project-dependency-crud-fixtures.js'

// v3-multi-project-dependency-graph —— 多项目依赖图谱 UI 共享合同、纯函数与夹具（前后端共享）。
export * from './multi-project-dependency-graph.js'
export * from './multi-project-dependency-graph-fixtures.js'

// v3-multi-project-impact-analysis —— 多项目影响分析共享契约、纯函数与夹具（前后端共享）。
export * from './multi-project-impact-analysis.js'
export * from './multi-project-impact-analysis.fixtures.js'

// v3-triz-contradiction-matrix-ui —— TRIZ 矛盾矩阵审查 UI 共享契约、纯函数与夹具（前后端共享）。
export {
  MATRIX_AVAILABLE_ACTIONS,
  MATRIX_CELL_STATES,
  MATRIX_CONTRADICTION_TYPES,
  MATRIX_SEVERITY_FILTERS,
  SORT_DIRECTIONS,
  SORT_DIRECTIONS as MATRIX_SORT_DIRECTIONS,
  type SortDirection as MatrixSortDirection,
  MATRIX_SORT_FIELDS,
  MATRIX_SOURCE_TYPE_FILTERS,
  MATRIX_STALE_FILTERS,
  MATRIX_STATUS_FILTERS,
  aggregateWarnings,
  aggregateWarnings as aggregateMatrixWarnings,
  compareParameterKeys,
  compareParameterKeys as compareMatrixParameterKeys,
  compareSeverity as compareMatrixSeverity,
  computeAggregateSeverity,
  computeAggregateSeverity as computeMatrixAggregateSeverity,
  computeMatrixCellKey,
  computeMatrixHandoffIdempotencyKey,
  computeTensionKey,
  isCellFullyStale,
  isMatrixAvailableAction,
  isMatrixCellState,
  isMatrixSortField,
  normalizeIdempotencyKey,
  normalizeIdempotencyKey as normalizeMatrixIdempotencyKey,
  resolveAvailableActions,
  resolveAvailableActions as resolveMatrixAvailableActions,
  resolveCellState,
  sortMatrixSourceRefs,
  validateMatrixFilters,
  validateMatrixHandoffInput,
  type GetMatrixRequest,
  type GetMatrixResponse,
  type MatrixAvailableAction,
  type MatrixCatalogMetadata,
  type MatrixCell,
  type MatrixCellState,
  type MatrixContradictionTypeFilter,
  type MatrixFilters,
  type MatrixHandoffInput,
  type MatrixHandoffRequest,
  type MatrixHandoffResponse,
  type MatrixParameterAxis,
  type MatrixPhysicalTension,
  type MatrixSelectedCell,
  type MatrixSelectedTension,
  type MatrixSeverityFilter,
  type MatrixSortField,
  type MatrixSourceRef,
  type MatrixSourceType,
  type MatrixSourceTypeFilter,
  type MatrixStaleFilter,
  type MatrixStatusFilter,
  type MatrixWarningSummary,
  type TrizContradictionMatrix,
} from './triz-contradiction-matrix.js'
export {
  buildAuthorizedAnalysisRef,
  buildAuthorizedContradictionRef,
  buildCatalogMetadata,
  buildEmptyCell as buildMatrixEmptyCell,
  buildEmptyWarningSummary as buildMatrixEmptyWarningSummary,
  buildHiddenCell as buildMatrixHiddenCell,
  buildHiddenSourceRef,
  buildMatrixDTO,
  buildMatrixHandoffInput,
  buildNormalCell as buildMatrixNormalCell,
  buildParameterAxis as buildMatrixParameterAxis,
  buildPhysicalTension as buildMatrixPhysicalTension,
  buildStaleCell as buildMatrixStaleCell,
  buildStaleSourceRef,
  buildWarningSummary as buildMatrixWarningSummary,
} from './triz-contradiction-matrix-fixtures.js'

// v3-triz-physical-contradiction-analyzer —— TRIZ 物理矛盾分析器共享契约（前后端共享）。
export * from './triz-physical-contradiction.js'

// v3-triz-decision-center —— TRIZ 决策中心共享契约（前后端共享）。
export * from './triz-decision-center.js'

// v3-triz-technical-contradiction-analyzer —— TRIZ 技术矛盾分析器共享契约（前后端共享）。
export * from './triz-technical-contradiction.js'

// v3-triz-ifr-visualization —— TRIZ IFR（最终理想解）可视化共享契约与确定性纯函数引擎（前后端共享）。
export * from './triz-ifr-visualization.js'

// v3-triz-function-analysis-diagram —— TRIZ 功能分析图共享契约（前后端共享）。
export * from './triz-function-analysis-diagram.js'

// v3-triz-resource-analyzer —— TRIZ 资源分析器共享契约（前后端共享）。
export * from './triz-resource-analyzer.js'

// v3-triz-evolution-trend-analysis —— TRIZ 进化趋势分析共享契约（前后端共享）。
export * from './triz-evolution-trend-analysis.js'

// v3-ai-triz-assistant —— AI-TRIZ 助手共享契约（前后端共享）。
export * from './ai-triz-assistant.js'

// v3-triz-skill-layer-integration —— TRIZ × Skill System 集成层共享契约（前后端共享）。
export * from './triz-skill-layer-integration.js'

// v3-triz-pm-phase-integration —— TRIZ-PM 阶段整合共享契约（前后端共享）。
export * from './triz-pm-phase-integration.js'

// v3-ocr-document-upload-flow —— OCR 文档上传/选择作业与候选审查共享契约（前后端共享）。
export * from './ocr-document-upload.js'
export * from './ocr-document-upload-fixtures.js'
// normalizeIdempotencyKey 同时由 triz-contradiction-matrix 与 ocr-document-upload 导出；
// 矩阵版为权威，OCR 文件版另起别名。
export { normalizeIdempotencyKey as normalizeOcrIdempotencyKey } from './ocr-document-upload.js'

// v3-ocr-review-confirmation-flow —— OCR 审查确认流共享契约（前后端共享）。
// 注意：computeAcceptedExtractionHash 与 ocr-document-upload 冲突，上传版为权威（下方消歧）。
export * from './ocr-review-confirmation.js'
export * from './ocr-review-confirmation-fixtures.js'

// v3-document-inline-comments —— 文档正文内联批注共享契约（前后端共享）。
export * from './document-inline-comments.js'

// v3-ocr-result-persistence-and-retention —— OCR 结果生命周期治理共享契约（前后端共享）。
export * from './ocr-result-retention.js'
export * from './ocr-result-retention-fixtures.js'

// v3-ocr-document-search-indexing —— OCR 文档搜索索引共享契约（前后端共享）。
export * from './ocr-document-search-indexing.js'
export * from './ocr-document-search-indexing-fixtures.js'

// v3-ocr-structured-extraction —— OCR 结构化提取共享契约（前后端共享）。
export * from './ocr-structured-extraction.js'
export * from './ocr-structured-extraction-fixtures.js'

// v3-document-intelligence-workbench —— 项目级文档智能工作台共享契约（前后端共享）。
export * from './document-intelligence-workbench.js'
export * from './document-intelligence-workbench-fixtures.js'

// v3-knowledge-memory-operating-layer —— 组织级知识与记忆运营层共享契约（前后端共享）。
export * from './knowledge-memory-operating-layer.js'
export * from './knowledge-memory-operating-layer-fixtures.js'

// v3-ocr-provider-observability-cost-controls —— OCR provider 观测与成本控制共享契约（前后端共享）。
export {
  OCR_PROVIDER_ATTEMPT_STATUSES,
  OCR_PROVIDER_ERROR_CATEGORIES,
  OCR_PROVIDER_WARNING_CODES,
  OCR_BUDGET_DECISION_STATUSES,
  OCR_RATE_LIMIT_DECISION_STATUSES,
  OCR_COST_STATUSES,
  OCR_BUDGET_SCOPES,
  OCR_BUDGET_SOFT_LIMIT_ACTIONS,
  type OcrProviderAttemptStatus,
  type OcrProviderErrorCategory,
  type OcrProviderWarningCode,
  type OcrBudgetDecisionStatus,
  type OcrRateLimitDecisionStatus,
  type OcrCostStatus,
  type OcrBudgetScope,
  type OcrBudgetSoftLimitAction,
  type OcrProviderSafeRef,
  type OcrCostEstimate,
  type OcrProviderUsageSummary,
  type OcrProviderAttemptEvent,
  type OcrBudgetDecision,
  type OcrRateLimitDecision,
  type OcrBudgetPreflightInput,
  type OcrBudgetPreflightResult,
  type OcrBudgetPostflightInput,
  type OcrRateLimitPreflightInput,
  type OcrRateLimitPreflightResult,
  type OcrProviderObservabilitySummary,
  type OcrProviderObservabilityFilters,
  type OcrProviderObservabilityEventItem,
  type OcrProviderObservabilityEventList,
  type OcrPricingSnapshot,
  computeOcrProviderIdempotencyKey,
  computeOcrBudgetIdempotencyKey,
  computeOcrRateLimitIdempotencyKey,
  computeOcrInputHash,
  computeOcrOutputHash,
  computeOcrObservabilitySummaryHash,
  buildOcrProviderSafeRef,
  aggregateOcrWarnings as aggregateOcrProviderWarnings,
  isOcrWarningBlocking,
  redactOcrProviderObservabilityMetadata,
  redactOcrProviderError,
  estimateOcrCost,
  estimateOcrCostFallback,
  normalizeOcrErrorCategory,
  isOcrProviderAttemptStatus,
  isOcrBudgetDecisionStatus,
  isOcrRateLimitDecisionStatus,
  isOcrCostStatus,
  isOcrProviderWarningCode,
  resolveOcrBudgetDecisionStatus,
  checkOcrRateLimitCapacity,
  buildOcrProviderObservabilitySummary,
} from './ocr-provider-observability.js'

export {
  ocrProviderAttemptFixture,
  ocrProviderSafeRefFixture,
  ocrProviderUsageSummaryFixture,
  ocrCostEstimateFixture,
  ocrBudgetDecisionFixture,
  ocrRateLimitDecisionFixture,
  ocrBudgetPreflightResultFixture,
  ocrRateLimitPreflightResultFixture,
  ocrProviderObservabilitySummaryFixture,
  ocrProviderAttemptFixtures,
  ocrProviderAttemptFailureFixture,
  ocrProviderAttemptBudgetBlockedFixture,
  ocrProviderAttemptRateLimitedFixture,
  ocrProviderAttemptUnknownCostFixture,
  ocrProviderAttemptNoUsageFixture,
} from './ocr-provider-observability-fixtures.js'

// ─── star export 名称冲突消歧 ────────────────────────────────────────────────
// ESM 下多个 `export *` 导出同名符号时，该名称会被静默剔除（消费方拿到 undefined），
// 且 webpack 会报 "conflicting star exports"。显式具名导出优先级高于 star export，
// 故此处指定权威导出（沿用先声明模块），并为后声明模块保留带域前缀的别名。

// `sortWarningsBySeverity`：TRIZ 分析层（TrizAnalysisWarning[]）为权威，
// 跨项目依赖版接受 MultiProjectWarningCode[]，语义不同故另起别名。
export { sortWarningsBySeverity } from './triz-compiler-analysis.js'
export { sortWarningsBySeverity as sortMultiProjectWarningsBySeverity } from './multi-project-dependency-model.js'

// `isValidLifecycleTransition`：依赖模型版（active/at_risk/blocked/resolved/archived）为权威，
// CRUD helpers 版走 active/archived/deleted 三态，语义不同故另起别名。
export { isValidLifecycleTransition } from './multi-project-dependency-model.js'
export { isValidLifecycleTransition as isValidDepCrudLifecycleTransition } from './multi-project-dependency-crud-helpers.js'

// `isSourceHashStale`：推荐理由版 `(hash, hash[])` 为权威（后端 rationale service 在用），
// 决策中心版为 `(hash, hash)` 单值比对，OCR 文件版亦为 `(hash, hash)` 单值比对故另起别名。
export { isSourceHashStale } from './triz-recommendation-rationale.js'
export { isSourceHashStale as isDecisionSourceHashStale } from './triz-decision-center.js'
export { isSourceHashStale as isOcrDocSourceHashStale } from './ocr-document-upload.js'
// OCR 审查确认版同为 `(hash, hash)` 单值比对，此前被上面的具名导出静默遮蔽，补域前缀别名。
export { isSourceHashStale as isOcrReviewSourceHashStale } from './ocr-review-confirmation.js'

// `sortWarningsBySeverity`：OCR 搜索索引版接受 OcrSearchIndexWarningCode[]，与 TRIZ 版
// (TrizAnalysisWarning[]) 语义不同，另起别名。
export { sortWarningsBySeverity as sortOcrSearchIndexWarningsBySeverity } from './ocr-document-search-indexing.js'

// `computePreviewHash`：OCR 搜索索引版接受 OcrSearchIndexPreviewEntry[]，
// 与 AI Draft Layer 版（baselineSummary, currentSummary, entityHashes）语义不同，另起别名。
export { computePreviewHash as computeOcrSearchIndexPreviewHash } from './ocr-document-search-indexing.js'

// `normalizeIdempotencyKey`：OCR 搜索索引版与 OCR 文档上传版、TRIZ 矛盾矩阵版签名不同，
// 另起别名。
export { normalizeIdempotencyKey as normalizeOcrSearchIndexIdempotencyKey } from './ocr-document-search-indexing.js'

// `computeIdempotencyKeyHash`：OCR 搜索索引版 (raw: string) => string，
// 与跨项目依赖 CRUD helpers 版 (5 args) 语义不同，另起别名。
export { computeIdempotencyKeyHash as computeOcrSearchIndexIdempotencyKeyHash } from './ocr-document-search-indexing.js'

// `computeAcceptedExtractionHash`：ocr-document-upload 版为权威，
// ocr-review-confirmation 版语义相同但签名略有不同。
export { computeAcceptedExtractionHash } from './ocr-document-upload.js'
export { computeAcceptedExtractionHash as computeReviewAcceptedExtractionHash } from './ocr-review-confirmation.js'

// `computePreviewHash`：ai-draft-layer 版为权威，
// ocr-document-search-indexing 版语义不同（见上文 computeOcrSearchIndexPreviewHash）。
export { computePreviewHash } from './ai-draft-layer.js'
// OCR 审查确认版签名为 (sourceHash, candidateHash, selectedTextHash, pageRefs)，
// 此前被上面的具名导出静默遮蔽，补域前缀别名。
export { computePreviewHash as computeOcrReviewPreviewHash } from './ocr-review-confirmation.js'

// `computeIdempotencyKeyHash`：multi-project-dependency-crud-helpers 版为权威。
export { computeIdempotencyKeyHash } from './multi-project-dependency-crud-helpers.js'

// `isSourceStale`：PMO 组合看板版 `(lastUpdatedAt, thresholdMinutes)` 判时间新鲜度为权威，
// TRIZ-PM 阶段整合版为 `(currentHash, snapshottedHash)` 哈希比对，语义不同故另起别名。
export { isSourceStale } from './pmo-portfolio-dashboard.js'
export { isSourceStale as isPhaseSourceStale } from './triz-pm-phase-integration.js'

// `computeInputSignature`：TRIZ 矛盾版（ContradictionInputSnapshot）为权威，
// OCR 文档上传版接受 sourceKind/attachment/model 参数对象，语义不同故另起别名。
export { computeInputSignature } from './triz-contradiction.js'
export { computeInputSignature as computeOcrDocInputSignature } from './ocr-document-upload.js'
// `computeSourceHash`：enterprise-dlp-engine 与 ocr-document-upload 各有一个同名
// 但签名完全不同的实现（前者 `(sourceRef, contentDigest)`，后者接 attachment 描述对象）。
// 下方 DLP 版的显式 re-export 会盖掉这里的 `export *`，OCR 版在此消歧导出。
export { computeSourceHash as computeOcrDocSourceHash } from './ocr-document-upload.js'

// `buildPreviewResponse`：OCR 搜索索引 fixtures 版（entries + overrides）为权威，
// OCR 结构化提取 fixtures 版仅接受 overrides，语义不同故另起别名。
export { buildPreviewResponse } from './ocr-document-search-indexing-fixtures.js'
export { buildPreviewResponse as buildOcrStructuredExtractionPreviewResponse } from './ocr-structured-extraction-fixtures.js'

// `buildRedlineSummary`：OCR 审查确认版（OcrConfirmationRedlineSummary）为权威，
// OCR 结构化提取 fixtures 版返回 OcrStructuredExtractionRedlineSummary，另起别名。
export { buildRedlineSummary } from './ocr-review-confirmation.js'
export { buildRedlineSummary as buildOcrStructuredExtractionRedlineSummary } from './ocr-structured-extraction-fixtures.js'

// `ApiErrorEnvelope` / `PaginationMeta`：跨项目依赖模型另起了同名类型，
// 与既有通用契约冲突。通用契约为权威，依赖域版本改用带域前缀的别名。
export type { ApiErrorEnvelope } from './api-contracts.js'
export type { ApiErrorEnvelope as MultiProjectApiErrorEnvelope } from './multi-project-dependency-model.js'
export type { PaginationMeta } from './resource.js'
export type { PaginationMeta as MultiProjectPaginationMeta } from './multi-project-dependency-model.js'

// v3-ocr-entity-linking —— OCR 实体链接共享契约（前后端共享）。
// 注意：computePreviewHash / aggregateWarnings / computeConfirmationHash 与其他模块冲突，加域前缀别名。
// 避免 star export 导致的冲突，所有导出均通过显式具名导出。
export {
  // ── 枚举 ──
  OCR_ENTITY_MENTION_TYPES,
  OCR_ENTITY_LINK_RUN_STATUSES,
  OCR_ENTITY_LINK_CANDIDATE_STATUSES,
  OCR_ENTITY_LINK_LIFECYCLE_STATUSES,
  OCR_TARGET_KINDS,
  OCR_MATCH_REASONS,
  OCR_ENTITY_LINK_WARNING_CODES,
  OCR_ENTITY_LINK_PERMISSION_ACTIONS,
  OCR_ENTITY_LINK_AUDIT_ACTIONS,
  // ── 类型守卫 ──
  isOcrEntityMentionType,
  isOcrEntityLinkRunStatus,
  isOcrEntityLinkCandidateStatus,
  isOcrEntityLinkLifecycleStatus,
  isOcrTargetKind,
  isOcrMatchReason,
  isOcrEntityLinkWarningCode,
  isOcrEntityLinkPermissionAction,
  isOcrEntityLinkAuditAction,
  // ── 纯函数 ──
  computeEntityLinkRunInputSignature,
  computeCandidateKey,
  computePreviewHash as computeEntityLinkPreviewHash,
  computeConfirmationHash as computeEntityLinkConfirmationHash,
  redactTargetTitle as redactEntityLinkTargetTitle,
  aggregateWarnings as aggregateEntityLinkWarnings,
  redactSummary as redactEntityLinkSummary,
  DEFAULT_REDLINE_SUMMARY as ENTITY_LINK_DEFAULT_REDLINE_SUMMARY,
  // ── DTO 类型 ──
  type CreateOcrEntityLinkRunRequest,
  type OcrEntityLinkRunInputSignature,
  type OcrEntityLinkRunSummary,
  type OcrEntityLinkRunDetail,
  type OcrEntityLinkSourceExtractionRef,
  type OcrEntityLinkCandidate,
  type OcrEntityLinkSpanOffset,
  type OcrEntityLinkTargetSuggestion,
  type OcrEntityLinkPreview,
  type OcrEntityLinkSourceSpanSummary,
  type OcrEntityLinkAdvisoryPayload,
  type OcrEntityLinkConfirmedLink,
  type OcrEntityLinkStaleSummary,
  type OcrEntityLinkWarning,
  type OcrEntityLinkRedlineSummary,
  type ConfirmOcrEntityLinkRequest,
  type SupersedeOcrEntityLinkRequest,
  type ExplainOcrEntityLinkRequest,
  type OcrEntityLinkExplanation,
  type OcrEntityLinkCostSummary,
  type OcrEntityLinkListFilters,
  type OcrEntityLinkTargetSummary,
  type OcrEntityMentionType,
  type OcrEntityLinkRunStatus,
  type OcrEntityLinkCandidateStatus,
  type OcrEntityLinkLifecycleStatus,
  type OcrTargetKind,
  type OcrMatchReason,
  type OcrEntityLinkWarningCode,
  type OcrEntityLinkPermissionAction,
  type OcrEntityLinkAuditAction,
} from './ocr-entity-linking.js'

export {
  // ── Fixtures ──
  buildSpanOffset,
  buildSourceExtractionRef,
  buildTargetSuggestion,
  buildTargetSummary,
  buildWarning,
  buildStaleSummary,
  buildCandidate,
  buildUnmatchedCandidate,
  buildRunSummary,
  buildAdvisoryPayload,
  buildPreview,
  buildConfirmedLink,
  fixtureAcceptedTextSmall,
  fixtureAcceptedTextLarge,
  fixtureCandidateSet,
} from './ocr-entity-linking-fixtures.js'

// v3-document-markdown-import-export —— 项目文档 Markdown 导入/导出共享契约（前后端共享）。
// 注意：buildWarning 与 ocr-entity-linking-fixtures 同名，entity-linking 版为权威，
// 本模块通过显式具名导出（不走 star export）避免冲突剔除。
export {
  // ── 限额常量 ──
  MARKDOWN_IMPORT_MAX_BYTES,
  MARKDOWN_IMPORT_MAX_LINES,
  MARKDOWN_IMPORT_MAX_TITLE_LENGTH,
  MARKDOWN_EXPORT_MAX_FILENAME_LENGTH,
  MARKDOWN_EXPORT_MAX_SNIPPET_LENGTH,
  MARKDOWN_EXPORT_MAX_HEADING_DEPTH,
  MARKDOWN_BUNDLE_MAX_ITEMS,
  MARKDOWN_BUNDLE_MAX_BYTES,
  // ── 枚举 ──
  MARKDOWN_IMPORT_MODES,
  MARKDOWN_ALLOWED_ACTIONS,
  MARKDOWN_EXPORT_ITEM_STATUSES,
  MARKDOWN_WARNING_CODES,
  // ── 类型守卫 ──
  isMarkdownImportMode,
  isMarkdownWarningCode,
  isMarkdownAllowedAction,
  // ── 纯函数 ──
  normalizeMarkdownText,
  extractFrontmatterTitle,
  inferMarkdownTitle,
  safeMarkdownFilename,
  extractMarkdownSnippet,
  markdownFnv1aHash,
  computeMarkdownPreviewHash,
  computeMarkdownSourceDocumentHash,
  computeMarkdownExportHash,
  computeMarkdownBundleHash,
  sortMarkdownExportItems,
  summarizeMarkdownExportManifest,
  sortMarkdownWarnings,
  collectMarkdownWarningCodes,
  redactMarkdownAuditMetadata,
  buildMarkdownAuditMetadata,
  // ── DTO 类型 ──
  type MarkdownImportMode,
  type MarkdownAllowedAction,
  type MarkdownExportItemStatus,
  type MarkdownWarningCode,
  type MarkdownWarning,
  type MarkdownImportPreviewRequest,
  type MarkdownImportPreviewTarget,
  type MarkdownImportPreview,
  type MarkdownImportConfirmRequest,
  type MarkdownImportConfirmResult,
  type MarkdownExportSingleRequest,
  type MarkdownExportSingleResult,
  type MarkdownExportTreeRequest,
  type MarkdownExportTreeItem,
  type MarkdownExportBundleManifest,
  type MarkdownExportTreeResult,
} from './document-markdown-import-export.js'

export {
  // ── Fixtures（Markdown 域；buildWarning 走域前缀别名）──
  mdFixtureContent,
  mdFixtureWithFrontmatter,
  mdFixtureUnsupportedFeatures,
  buildPreviewTarget,
  buildWarning as buildMarkdownWarning,
  buildMarkdownImportPreview,
  buildMarkdownPreviewRequest,
  buildMarkdownConfirmRequest,
  buildMarkdownConfirmResult,
  buildReplacePreview,
  buildStaleReplacePreview,
  buildSingleExportResult,
  buildMarkdownBundleManifest,
  buildSelectedTreePartialFailure,
  buildMarkdownExportTreeResult,
  buildLargeMarkdownFixture,
} from './document-markdown-import-export-fixtures.js'

// v3-document-formula-support —— 项目文档公式渲染共享契约、纯函数与夹具（前后端共享）。
export * from './document-formula-support.js'
export * from './document-formula-support-fixtures.js'

// v3-ocr-privacy-policy-controls —— OCR 隐私策略控制共享契约（前后端共享）。
export * from './ocr-privacy-policy-controls.js'
export * from './ocr-privacy-policy-controls-fixtures.js'

// v3-ocr-ui-in-documents —— OCR 文档工作台 UI 共享契约、纯函数与夹具（前后端共享）。
// 注意：SortDirection 与 custom-views 冲突，OCR 版通过域前缀别名导出。
export {
  OCR_DOCUMENT_WORKSPACE_STATUSES,
  OCR_DOCUMENT_WORKSPACE_ACTIONS,
  OCR_DOCUMENT_WORKSPACE_WARNING_REASONS,
  OCR_DOCUMENT_WORKSPACE_BLOCK_REASONS,
  isOcrDocumentWorkspaceStatus,
  isOcrDocumentWorkspaceAction,
  isOcrDocumentWorkspaceBlockReason,
  isOcrSupportedMime,
  selectLatestOcrJobForSource,
  deriveOcrDocumentWorkspaceStatus,
  resolveOcrDocumentWorkspaceActions,
  redactSourceTitle,
  redactOcrTextCount,
  redactWarningMetadata,
  redactDenialReason,
  filterOcrWorkspaceRows,
  sortOcrWorkspaceRows,
  getStatusSortWeight,
  type OcrDocumentWorkspaceStatus,
  type OcrDocumentWorkspaceAction,
  type OcrDocumentWorkspaceWarningReason,
  type OcrDocumentWorkspaceBlockReason,
  type OcrDocumentWorkspaceRowSummary,
  type OcrDocumentWorkspaceFilters,
  type OcrDocumentWorkspaceSortField,
  type OcrDocumentWorkspaceSortConfig,
} from './ocr-ui-in-documents.js'
export {
  buildOcrJobFixture,
  buildWorkspaceRowSummary,
  unsupportedRow,
  noJobRow,
  queuedRow,
  processingRow,
  failedRow,
  reviewableRow,
  confirmedRow,
  staleRow,
  retentionHoldRow,
  privacyBlockRow,
  readOnlyDegradedRow,
  multiJobFixtures,
  largeWorkspaceRows,
  defaultOcrWorkspaceFilters,
  defaultOcrWorkspaceSort,
} from './ocr-ui-in-documents-fixtures.js'

// v3-local-plugin-developer-kit —— 本机插件开发套件共享契约与纯函数（前后端共享）。
export * from './local-plugin-developer-kit.js'
export * from './local-plugin-developer-kit-fixtures.js'

// v3-plugin-security-gate —— 插件运行时统一安全门共享契约（前后端共享，tasks 2.1）。
export * from './plugin-security-gate.js'

// v3-ocr-permission-and-audit —— OCR 权限与审计治理共享契约（前后端共享）。
export * from './ocr-permission-and-audit.js'
export * from './ocr-permission-and-audit-fixtures.js'

// v3-ocr-batch-and-queue-processing —— OCR 批量入队与本机 queue 共享契约（前后端共享）。
// 注意：isRetryableFailure 与 TRIZ Technical Contradiction 版可能同名，
// 但签名不同（接受 OcrQueueFailureCategory vs contradiction input），故不加域前缀。
export {
  // ── 枚举 ──
  OCR_BATCH_STATUSES,
  OCR_BATCH_AGGREGATE_STATUSES,
  OCR_QUEUE_ITEM_STATUSES,
  OCR_QUEUE_WORK_KINDS,
  OCR_BATCH_CONTROL_ACTIONS,
  OCR_BATCH_WARNING_CODES,
  OCR_QUEUE_FAILURE_CATEGORIES,
  OCR_BATCH_PERMISSION_ACTIONS,
  OCR_BATCH_AUDIT_ACTIONS,
  OCR_BATCH_ALLOWED_ACTIONS,
  OCR_BATCH_TERMINAL_STATUSES,
  OCR_QUEUE_TERMINAL_STATUSES,
  OCR_BATCH_RETRYABLE_STATUSES,
  OCR_QUEUE_ITEM_RETRYABLE_STATUSES,
  // ── 常量 ──
  OCR_BATCH_DEFAULT_MAX_SOURCES,
  OCR_BATCH_DEFAULT_MAX_PAGES_PER_BATCH,
  OCR_QUEUE_DEFAULT_CLAIM_LIMIT,
  OCR_QUEUE_DEFAULT_MAX_ATTEMPTS,
  OCR_QUEUE_DEFAULT_STALE_LOCK_MS,
  OCR_QUEUE_DEFAULT_RETRY_BASE_DELAY_MS,
  OCR_QUEUE_DEFAULT_RETRY_MAX_DELAY_MS,
  // ── 类型守卫 ──
  isOcrBatchStatus,
  isOcrQueueItemStatus,
  isOcrQueueWorkKind,
  isOcrBatchControlAction,
  isOcrBatchWarningCode,
  isOcrQueueFailureCategory,
  isOcrBatchPermissionAction,
  isOcrBatchAuditAction,
  isOcrBatchTerminal,
  isOcrQueueItemTerminal,
  isOcrQueueItemRetryable,
  // ── 纯函数 ──
  computeBatchInputSignature,
  normalizeBatchIdempotencyKey,
  computeQueueIdempotencyKey,
  sortBatchSources,
  deduplicateBatchSources,
  aggregateBatchProgress,
  deriveBatchAggregateStatus,
  redactBatchAuditMetadata,
  redactSourceName,
  redactBatchProviderSummary,
  computeRetryDelay,
  isRetryableFailure,
  isTerminalFailure,
  computeNextAttemptAt,
  isLockStale,
  resolveBatchAllowedActions,
  isValidQueueItemStatusTransition,
  // ── DTO 类型 ──
  type OcrBatchStatus,
  type OcrBatchAggregateStatus,
  type OcrQueueItemStatus,
  type OcrQueueWorkKind,
  type OcrBatchControlAction,
  type OcrBatchWarningCode,
  type OcrQueueFailureCategory,
  type OcrBatchPermissionAction,
  type OcrBatchAuditAction,
  type OcrBatchAllowedAction,
  type OcrBatchSourceInput,
  type OcrBatchCreateRequest,
  type OcrBatchSourceSummary,
  type OcrBatchSummary,
  type OcrBatchDetail,
  type OcrQueueItemSummary,
  type OcrQueueProjectSummary,
  type OcrBatchControlRequest,
  type OcrBatchRetryRequest,
  type OcrBatchCancelRequest,
  type OcrBatchResumeRequest,
  type OcrBatchListFilters,
  type OcrQueueListFilters,
  type OcrBatchWarning,
  type OcrBatchCostSummary,
} from './ocr-batch-and-queue-processing.js'

export {
  // ── Fixtures ──
  buildBatchSourceInput,
  buildBatchCreateRequest,
  buildBatchSourceSummary,
  buildBatchSummary,
  buildBatchDetail,
  buildQueueItemSummary,
  buildQueueProjectSummary,
  buildBatchWarning,
  buildBatchCostSummary,
  buildLargeQueueItemSet,
  fixtureSingleDocumentBatch,
  fixtureMultiDocumentBatch,
  fixtureMixedImagePdfBatch,
  fixtureCompletedBatchDetail,
  fixturePartialFailureBatchDetail,
  fixtureCancelledBatchDetail,
  fixtureBudgetBlockedBatchDetail,
  fixtureRateLimitedBatchDetail,
  fixtureStaleBlockedBatchDetail,
  fixtureReadOnlyBatchDetail,
  fixtureDuplicateDispatchQueueItem,
  fixtureStaleLockedQueueItem,
  fixtureMixedQueueItems,
} from './ocr-batch-and-queue-processing-fixtures.js'

// v3-document-code-block-support —— 项目文档 Markdown 阅读器与围栏代码块共享契约（前后端共享）。
export {
  SUPPORTED_CODE_LANGUAGES,
  COPY_CODE_RESULTS,
  isSupportedCodeLanguage,
  isCopyCodeResult,
  type SupportedCodeLanguage,
  type FencedCodeBlockMeta,
  type DocumentContentResponse,
  type CopyCodeResult,
} from './document-code-block-support.js'

export {
  mdFixtureMixedContent,
  mdFixtureUnclosedFence,
  mdFixtureIndentedFence,
  mdFixtureTildeFence,
  mdFixtureEmpty,
  mdFixtureProseOnly,
  mdFixtureInlineCodeOnly,
  mdFixtureLongLine,
  expectedMixedFencedBlocks,
  expectedUnclosedFencedBlocks,
  expectedIndentedFencedBlocks,
  expectedTildeFencedBlocks,
} from './document-code-block-support-fixtures.js'

// v3-document-full-text-search —— 文档全文搜索共享契约、纯函数与夹具（前后端共享）。
// 注意：computeDocumentContentHash 在 document-inline-comments 中已存在同名导出，
// 此处用别名避免 ESM conflicting star exports。
export {
  computeDocumentContentHash as computeDocumentSearchContentHash,
  buildDocumentSearchableProjection,
  boundSearchableText,
  computeKeywordHash,
  extractSnippet,
  normalizeSearchKeyword,
  stripMarkdownToPlainText,
  DOCUMENT_SEARCH_CONTENT_BOUND,
  DOCUMENT_SEARCH_ENTITY_TYPE,
  DOCUMENT_SEARCH_LIFECYCLES,
  DOCUMENT_SEARCH_SNIPPET_RADIUS,
  DOCUMENT_SEARCH_SNIPPET_MAX_LENGTH,
  DOCUMENT_SEARCH_NO_KEYWORD_SNIPPET_LENGTH,
  DOCUMENT_SEARCH_WARNING_CODES,
  AUDIT_KEYWORD_PREFIX_MAX_LENGTH,
  type DocumentSearchEntry,
  type DocumentSearchLifecycle,
  type DocumentSearchWarningCode,
  type DocumentSearchStatus,
  type DocumentSearchRebuildResult,
  type DocumentSearchStatusResponse,
  type DocumentSearchRebuildResponse,
  type DocumentSearchResultMetadata,
} from './document-full-text-search.js'
export * from './document-full-text-search-fixtures.js'

// v3-enterprise-audit-enhancement —— 企业级审计增强共享契约、纯函数与夹具（前后端共享）。
export {
  // ── 枚举 ──
  ENTERPRISE_AUDIT_ACTIONS,
  ENTERPRISE_AUDIT_PERMISSIONS,
  EVIDENCE_PACKAGE_STATUSES,
  VERIFICATION_STATUSES,
  ANOMALY_CATEGORIES,
  REDACTION_WARNING_CODES,
  STALE_SOURCE_CODES,
  EVIDENCE_WARNING_CODES,
  VERIFICATION_WARNING_CODES,
  RETENTION_WARNING_CODES,
  ENTERPRISE_EVENT_TO_ACTION,
  ENTERPRISE_AUDIT_EVENTS,
  // ── 常量 ──
  EVIDENCE_PACKAGE_MAX_ROWS,
  EVIDENCE_PACKAGE_MAX_DAYS,
  PREVIEW_SIGNATURE_TTL_SECONDS,
  FORBIDDEN_KEYS,
  // ── 类型守卫 ──
  isEnterpriseAuditAction,
  isEnterpriseAuditPermission,
  isEvidencePackageStatus,
  isVerificationStatus,
  isAnomalyCategory,
  isRedactionWarningCode,
  isStaleSourceCode,
  isEvidenceWarningCode,
  isVerificationWarningCode,
  isRetentionWarningCode,
  // ── 纯函数 ──
  // fnv1aHash / computeStableSignature 已由 enterprise-dlp-engine 导出，此处不重复。
  computeRecordDigest,
  computeDigestOfDigests,
  normalizeTimestamp,
  detectForbiddenKeys,
  sortWarningsBySeverity as sortEnterpriseAuditWarningsBySeverity,
  normalizeRetentionPolicy,
  aggregateWarnings as aggregateEnterpriseAuditWarnings,
  formatEvidencePackageAsCSV,
  formatEvidencePackageAsJSONL,
  formatManifestAsCSV,
  formatManifestAsJSONL,
  // ── DTO 类型 ──
  type EnterpriseAuditAction,
  type EnterpriseAuditPermission,
  type EvidencePackageStatus,
  type VerificationStatus,
  type AnomalyCategory,
  type RedactionWarningCode,
  type StaleSourceCode,
  type EvidenceWarningCode,
  type VerificationWarningCode,
  type RetentionWarningCode,
  type EnterpriseAuditScopeFilter,
  type EnterpriseAuditScope,
  type EvidencePackagePreview,
  type EvidencePackageLedgerEntry,
  type EvidencePackageManifest,
  type VerificationResult,
  type RetentionSummary,
  type AnomalySummaryItem,
  type AnomalySummary,
  type EnterpriseAuditOverview,
  type ConfirmEvidencePackageRequest,
  type VerifyAuditRequest,
} from './enterprise-audit-enhancement.js'

export {
  // ── Fixtures ──
  buildScopeFilter,
  buildScope,
  buildWarning as buildEnterpriseAuditWarning,
  buildRedactedDigest,
  buildEvidencePackagePreview,
  buildEvidencePackageLedgerEntry,
  buildEvidencePackageLedgerEntryWithStatus,
  buildEvidencePackageManifest,
  buildVerificationWarning,
  buildVerificationResult,
  buildVerificationResultWithStatus,
  buildRetentionWarning,
  buildRetentionSummary,
  buildAnomalyItem,
  buildAnomalySummary,
  buildLargeRecordDigestSet,
  buildLargeAnomalySet,
  buildBoundedDigestSet,
} from './enterprise-audit-enhancement-fixtures.js'

// v3-enterprise-encryption-and-key-management —— 企业级加密与密钥管理底座共享契约、纯函数与夹具。
export * from './enterprise-encryption-and-key-management.js'
export * from './enterprise-encryption-helpers.js'
export * from './enterprise-encryption-envelope.js'
export * from './enterprise-encryption-redaction.js'
export * from './enterprise-encryption-fixtures.js'

// v3-enterprise-dlp-engine —— 企业级数据防泄漏共享契约。
export {
  // ── 类型 ──
  type DlpRuleId,
  type DlpRuleCategory,
  type DlpSeverity,
  type DlpAction,
  type DlpPolicyScope,
  type DlpPolicyVersionStatus,
  type DlpContentCategory,
  type DlpDeclaredAction,
  type DlpDecisionResult,
  type DlpRedactionMode,
  type DlpWarningCode,
  type DlpEventType,
  type DlpConfirmationStatus,
  type DlpRuleDefinition,
  type DlpPolicyVersion,
  type DlpProjectOverride,
  type DlpScanInput,
  type DlpMatchSummary,
  type DlpDecisionSnapshot,
  type DlpPreviewSignature,
  type DlpConfirmationRequest,
  type DlpConfirmationResult,
  type DlpEventEntry,
  type DlpPolicySummary,
  type DlpRuleCatalogEntry,
  type DlpAdapterStatus,
  type DlpAdapterHealth,
  // ── 常量 ──
  DLP_RULE_IDS,
  DLP_RULE_CATEGORIES,
  DLP_SEVERITIES,
  DLP_ACTIONS,
  DLP_POLICY_SCOPES,
  DLP_POLICY_VERSION_STATUSES,
  DLP_CONTENT_CATEGORIES,
  DLP_DECLARED_ACTIONS,
  DLP_DECISION_RESULTS,
  DLP_REDACTION_MODES,
  DLP_WARNING_CODES,
  DLP_EVENT_TYPES,
  DLP_CONFIRMATION_STATUSES,
  DLP_MANDATORY_RULES,
  DLP_PASSWORD_FIELD_NAMES,
  DLP_FORBIDDEN_KEYS,
  DLP_PREVIEW_SIGNATURE_TTL_SECONDS,
  DLP_MAX_SCAN_TEXT_LENGTH,
  DLP_MAX_SCAN_FILE_SIZE,
  DLP_MAX_SCAN_ITEM_COUNT,
  DLP_MAX_BATCH_SIZE,
  DLP_SCAN_TIME_WINDOW_SECONDS,
  DLP_MAX_MATCHES_PER_RULE,
  DLP_EVENT_MAX_PER_PAGE,
  DLP_EVENT_DEFAULT_PER_PAGE,
  // ── 类型守卫 ──
  isDlpRuleId,
  isDlpRuleCategory,
  isDlpSeverity,
  isDlpAction,
  isDlpPolicyScope,
  isDlpContentCategory,
  isDlpDeclaredAction,
  isDlpDecisionResult,
  isDlpRedactionMode,
  isDlpWarningCode,
  isDlpEventType,
  isDlpConfirmationStatus,
  // ── 纯函数 ──
  fnv1aHash,
  computeStableSignature,
  computePolicyHash,
  // computeDecisionHash 已由 ocr-permission-and-audit 通过 export * 导出（第 946 行）。
  // 此处不重复导出，避免 ESM export * 冲突。
  computePreviewSignature,
  computeSourceHash,
  isValidDlpAction,
  isKnownAction,
  findViolatedMandatoryRules,
  findWeakenedMandatoryRules,
  isPasswordFieldName,
  isForbiddenKey,
  maskIdCard,
  maskPhone,
  maskBankCard,
  maskEmail,
  maskCredential,
  maskPasswordField,
  redactByMode,
  buildScanInput,
  validateScanBounds,
  validateBatchBounds,
  resolvePolicy,
  buildRuleCatalogEntry,
  buildDlpEventEntry,
  getDefaultRuleDefinition,
  getRuleCatalog,
  requiresConfirmation,
  isHighRiskAction,
} from './enterprise-dlp-engine.js'

export {
  // ── Fixtures ──
  buildSystemDefaultPolicy,
  buildOrganizationPolicy,
  buildProjectOverridePolicy,
  buildStrictPolicy,
  buildScanInput as buildDlpScanInput,
  buildMatchSummary,
  buildDecisionsnapshot,
  dlpBuildBlockDecision,
  dlpBuildMaskDecision,
  dlpBuildConfirmRequiredDecision,
  buildPreviewSignature,
  buildConfirmationRequest,
  buildConfirmedResult,
  buildStaleConfirmationResult,
  buildDlpEvent,
  buildCrossOrganizationPolicyRequest,
  buildProjectOverride,
  buildUnsafeOverride,
  buildEmptyEventList,
  buildEventList,
} from './enterprise-dlp-engine-fixtures.js'

// v3-enterprise-dlp-watermarking —— 企业级 DLP 水印共享契约（前后端共享）。
export {
  // ── 类型 ──
  type WatermarkPolicyId,
  type WatermarkRuleId,
  type WatermarkMode,
  type WatermarkFormat,
  type WatermarkFormatSupportLevel,
  type WatermarkPolicyScope,
  type WatermarkStatus,
  type WatermarkRenderResult,
  type WatermarkEventType,
  type WatermarkWarningCode,
  type WatermarkVerificationStatus,
  type WatermarkConfirmationStatus,
  type WatermarkPolicy,
  type WatermarkStyle,
  type WatermarkPosition,
  type WatermarkFormatSupport,
  type WatermarkFollowUp,
  type WatermarkPlan,
  type WatermarkPayload,
  type WatermarkRenderRecord,
  type WatermarkLedgerEvent,
  type WatermarkVerificationRequest,
  type WatermarkVerificationResult,
  type WatermarkPolicySummary,
  type WatermarkPreviewRequest,
  type WatermarkPreviewResult,
  type WatermarkFormatMatrixEntry,
  // ── 常量 ──
  WATERMARK_POLICY_IDS,
  WATERMARK_RULE_IDS,
  WATERMARK_MODES,
  WATERMARK_FORMATS,
  WATERMARK_FORMAT_SUPPORT_LEVELS,
  WATERMARK_POLICY_SCOPES,
  WATERMARK_STATUSES,
  WATERMARK_RENDER_RESULTS,
  WATERMARK_EVENT_TYPES,
  WATERMARK_WARNING_CODES,
  WATERMARK_VERIFICATION_STATUSES,
  WATERMARK_CONFIRMATION_STATUSES,
  WATERMARK_PLAN_TTL_SECONDS,
  WATERMARK_PREVIEW_TTL_SECONDS,
  WATERMARK_MAX_TEXT_LENGTH,
  WATERMARK_MAX_REPEAT_COUNT,
  WATERMARK_OPACITY_MIN,
  WATERMARK_OPACITY_MAX,
  WATERMARK_FONT_SIZE_MIN,
  WATERMARK_FONT_SIZE_MAX,
  WATERMARK_ROTATION_MIN,
  WATERMARK_ROTATION_MAX,
  WATERMARK_EVENT_MAX_PER_PAGE,
  WATERMARK_EVENT_DEFAULT_PER_PAGE,
  WATERMARK_APPROVED_TEMPLATE_VARIABLES,
  WATERMARK_FORBIDDEN_KEYS,
  WATERMARK_NATIVE_FORMATS,
  WATERMARK_DEGRADABLE_FORMATS,
  // ── 类型守卫 ──
  isWatermarkPolicyId,
  isWatermarkRuleId,
  isWatermarkMode,
  isWatermarkFormat,
  isWatermarkFormatSupportLevel,
  isWatermarkPolicyScope,
  isWatermarkStatus,
  isWatermarkRenderResult,
  isWatermarkEventType,
  isWatermarkWarningCode,
  isWatermarkVerificationStatus,
  isWatermarkConfirmationStatus,
  // ── 纯函数 ──
  // fnv1aHash 已由 enterprise-dlp-engine 导出（第 1287 行），此处不重复导出。
  computeWatermarkPolicyHash,
  computeWatermarkTemplateHash,
  computeWatermarkPayloadHash,
  computeWatermarkPlanHash,
  computeWatermarkHash,
  computeWatermarkPreviewHash,
  computeRenderedTextHash,
  validateWatermarkTemplateVariables,
  isOpacityInRange,
  isFontSizeInRange,
  isRotationInRange,
  isRepeatCountInRange,
  isRenderedTextLengthInRange,
  validateWatermarkStyleBounds,
  isFormatRenderable,
  resolveWatermarkFollowUp,
  buildFormatMatrix,
  buildFormatMatrixEntry,
  buildWatermarkPayload,
  buildWatermarkLedgerEvent,
  redactWatermarkMetadata,
  isWatermarkPlanExpired,
  sortWatermarkWarnings,
  buildDefaultWatermarkStyle,
  buildDefaultWatermarkPolicySummary,
  getFormatSupportLevel,
} from './enterprise-dlp-watermarking.js'

export {
  // ── Fixtures ──
  buildWatermarkPolicySummary,
  buildStrictWatermarkPolicy,
  wmBuildBlockDecision as buildWatermarkBlockDecision,
  wmBuildAllowDecision,
  wmBuildMaskDecision as buildWatermarkMaskDecision,
  wmBuildConfirmRequiredDecision as buildWatermarkConfirmRequiredDecision,
  buildWatermarkPlan,
  buildStaleWatermarkPlan,
  buildWatermarkPayloadFixture,
  buildRenderSuccessResult,
  buildRenderDegradedResult,
  buildRenderBlockedResult,
  buildWatermarkLedgerEvent as buildWatermarkFixtureLedgerEvent,
  buildCrossOrganizationDenialEvent,
  buildWatermarkPreviewRequest,
  buildWatermarkPreviewResult,
  buildFormatMatrixEntry as buildWatermarkFixtureFormatMatrixEntry,
  buildUnsupportedFormatEntry,
  buildWatermarkVerificationResult,
  buildTamperedVerificationResult,
  buildEmptyEventList as buildWatermarkEmptyEventList,
  buildEventList as buildWatermarkEventList,
} from './enterprise-dlp-watermarking-fixtures.js'

// v3-enterprise-compliance-readiness —— 企业合规准备度共享契约、纯函数与夹具（前后端共享）。
// 注意：所有通用 hash 使用 cr* / COMPLIANCE_* / isCompliance* 前缀，不在本 barrel 导出
// 与 enterprise-dlp-engine / enterprise-encryption-helpers / enterprise-audit-enhancement
// 已导出的 fnv1aHash / computeStableSignature 冲突（任务 2.6）。
export * from './enterprise-compliance-readiness.js'
export * from './enterprise-compliance-readiness-fixtures.js'

// v3-multitenant-tenant-identification —— V3 多租户有效租户识别与选择共享契约、纯函数与夹具
// （前后端共享）。所有通用 hash 使用 ti* 前缀，结合显式具名导出，避免与 isolation 层 /
// enterprise-* 已导出的通用名在 barrel export 时冲突（任务 2.1-2.4）。
export {
  TENANT_SCOPE_MODES,
  TENANT_SELECTION_SOURCES,
  TENANT_RESOLUTION_REASONS,
  TENANT_WARNING_CODES,
  TENANT_ID_HASH_NS,
  TENANT_SELECTION_SCHEMA_VERSION,
  TENANT_ID_FORBIDDEN_KEYS,
  isTenantScopeMode,
  isTenantSelectionSource,
  isTenantResolutionReason,
  isTenantWarningCode,
  tiComputeEffectiveScopeHash,
  tiComputeOrganizationScopeHash,
  tiComputePermissionHash,
  tiComputeProjectScopeHash,
  tiEquivalentContextHashes,
  buildEffectiveTenantContext,
  buildTenantSelectionSnapshot,
  buildScopeSwitchAuditContext,
  hasTenantIdForbiddenKeys,
  mapLegacyTenantContext,
  type EffectiveTenantContext,
  type TenantSelectionSnapshot,
  type TenantScopeMode,
  type TenantSelectionSource,
  type TenantResolutionReason,
  type TenantWarningCode,
  type OrganizationSelectionRequest,
  type OrganizationSelectionResponse,
  type TenantIdentificationAuditMetadata,
  type LegacyTenantContextLike,
} from './multitenant-tenant-identification.js'
export {
  tenantContextFixture,
  superAdminGlobalContextFixture,
  tenantContextReorderedKeyFixture,
  tenantSelectionSnapshotFixture,
  organizationSelectionRequestFixture,
  organizationSelectionResponseFixture,
  tenantIdentificationAuditFixture,
  scopeSwitchAuditFixture,
} from './multitenant-tenant-identification-fixtures.js'

// v3-multitenant-isolation-architecture —— V3 跨层租户隔离架构共享契约、确定性 hash、
// 低敏脱敏与夹具（前后端共享）。所有通用 hash 使用 mt* 前缀，结合显式具名导出，
// 避免与 tenant-identification（ti*）/ enterprise-* 已导出的通用名在 barrel export
// 时冲突（任务 2.1-2.4）。registry 声明用于后端 Tenant Scope Registry 的事实源。
export {
  MULTITENANT_SCOPE_MODES,
  MULTITENANT_RESOURCE_TYPES,
  MULTITENANT_OPERATION_TYPES,
  MULTITENANT_REASON_CODES,
  MULTITENANT_WARNING_CODES,
  MULTITENANT_DECISIONS,
  MULTITENANT_REGISTRY_STATUSES,
  MULTITENANT_FORBIDDEN_KEYS,
  MULTITENANT_HASH_NS,
  MULTITENANT_SCOPE_HASH_LENGTH,
  isMultitenantScopeMode,
  isMultitenantResourceType,
  isMultitenantOperationType,
  isMultitenantReasonCode,
  isMultitenantWarningCode,
  isMultitenantDecision,
  isMultitenantRegistryStatus,
  mtFnv1aHash,
  mtStableSerialize,
  mtComputeOrganizationScopeHash,
  mtComputeProjectScopeHash,
  mtComputeScopeHash,
  mtComputeResourceScopeHash,
  mtComputePermissionSnapshotHash,
  mtBuildScopeSigningEnvelope,
  mtComputeSnapshotSignature,
  detectMultitenantForbiddenKeysDeep,
  redactMultitenantForbiddenKeys,
  hasMultitenantForbiddenKeys,
  buildLowSensitiveScopeLabels,
  buildMultitenantWarning,
  buildTenantScopeSnapshot,
  buildMultitenantAuditMetadata,
  isBatchSameTenant,
  type TenantContext,
  type TenantScopeSnapshot,
  type TenantResourceDeclaration,
  type MultitenantDecisionEnvelope,
  type MultitenantAuditMetadata,
  type MultitenantScopeMode,
  type MultitenantResourceType,
  type MultitenantOperationType,
  type MultitenantReasonCode,
  type MultitenantWarningCode,
  type MultitenantDecision,
  type MultitenantRegistryStatus,
} from './multitenant-isolation-architecture.js'
export {
  MT_ORG_A_ID,
  MT_ORG_B_ID,
  MT_ORG_A_PROJECT_ID,
  MT_ORG_B_PROJECT_ID,
  buildOrgAContext,
  buildOrgBContext,
  buildOrgAMirrorRefs,
  buildOrgBMirrorRefs,
  buildOrgAScopeSnapshot,
  buildOrgBScopeSnapshot,
  buildTenantResourceDeclarations,
  buildAuditMetadataFixture,
} from './multitenant-isolation-architecture-fixtures.js'
// v3-multitenant-database-isolation —— V3 数据库层租户隔离契约：
// 表分类、组织归属列/父级解析、全局例外策略与目录完整性校验。
export {
  DATABASE_ISOLATION_CLASSIFICATIONS,
  DATABASE_ISOLATION_OPERATIONS,
  DATABASE_ISOLATION_FK_STATUSES,
  computeTenantScopedDigest,
  dbFnv1aHash,
  isDatabaseIsolationClassification,
  isDatabaseIsolationFkStatus,
  isDatabaseIsolationOperation,
  validateDatabaseTableDeclaration,
  validateCatalogIntegrity,
  type DatabaseIsolationClassification,
  type DatabaseIsolationFkStatus,
  type DatabaseIsolationOperation,
  type DatabaseGlobalExceptionPolicy,
  type DatabaseParentResolver,
  type DatabaseTableDeclaration,
} from './multitenant-database-isolation.js'

// v3-multitenant-connection-pool-management —— V3 多租户连接池与连接资源治理契约：
// 连接资源 catalog、租户 budget、lease lifecycle、retry/circuit/fallback 策略、低敏 metrics label。
export {
  TCPM_POOL_KINDS,
  TCPM_POOL_DECISIONS,
  TCPM_TERMINAL_DECISIONS,
  TCPM_DEGRADED_REASONS,
  TCPM_CIRCUIT_STATES,
  TCPM_FALLBACK_MODES,
  TCPM_METRICS_LABEL_POLICIES,
  TCPM_POOL_ERROR_CODES,
  TCPM_FORBIDDEN_POOL_LABELS,
  isTcpmPoolKind,
  isTcpmPoolDecision,
  isTcpmDegradedReason,
  isTcpmCircuitState,
  isTcpmFallbackMode,
  isTcpmMetricsLabelPolicy,
  isTcpmPoolErrorCode,
  tcpmDetectForbiddenPoolLabels,
  tcpmHasForbiddenPoolLabels,
  tcpmRedactForbiddenPoolLabels,
  tcpmValidateMetricsLabel,
  tcpmResolveBudget,
  tcpmBuildLease,
  tcpmBuildMetricsLabel,
  tcpmBuildJobPoolMetadata,
  type TcpmPoolKind,
  type TcpmPoolDecision,
  type TcpmDegradedReason,
  type TcpmCircuitState,
  type TcpmFallbackMode,
  type TcpmMetricsLabelPolicy,
  type TcpmPoolErrorCode,
  type TcpmRetryPolicy,
  type TcpmCircuitPolicy,
  type TcpmConnectionPoolCatalogEntry,
  type TcpmTenantConnectionBudget,
  type TcpmTenantConnectionLease,
  type TcpmAcquireRequest,
  type TcpmAcquireResult,
  type TcpmPoolMetricsLabel,
  type TcpmJobPoolMetadata,
} from './multitenant-connection-pool-management.js'

// v3-multitenant-api —— V3 多租户 HTTP/API 边界共享契约、决定性 hash、低敏 metadata 与 handle 绑定
// （前后端共享）。所有通用 hash 使用 map* 前缀，结合显式具名导出，避免与隔离层（mt*）/识别层（ti*）/
// 管理控制台（mac*）/连接池（tcpm*）/enterprise-* 已导出的通用名在 barrel export 时冲突。
export {
  API_RESPONSE_SENSITIVITIES,
  API_SCOPE_SOURCES,
  API_OPERATIONS,
  API_HANDLE_KINDS,
  API_HINT_LOCATIONS,
  API_HINT_ROLES,
  MAP_REASON_CODES,
  MAP_WARNING_CODES,
  MAP_DECISIONS,
  MAP_HANDLE_DEFAULT_EXPIRY_SECONDS,
  MAP_HASH_NS,
  MAP_CACHE_NAMESPACE_HASH_LENGTH,
  MAP_FORBIDDEN_KEYS,
  isApiResponseSensitivity,
  isApiScopeSource,
  isApiOperationType,
  isApiHandleKind,
  isApiHintLocation,
  isApiHintRole,
  isMapReasonCode,
  isMapWarningCode,
  isApiDecision,
  apiScopeModeKey,
  mapComputeScope,
  mapComputeCacheNamespace,
  mapComputeIdempotencyScope,
  mapComputeSourceHash,
  mapDetectForbiddenKeys,
  mapHasForbiddenKeys,
  mapRedactLowSensitive,
  mapAssertOrgConsistency,
  mapBuildDecisionEnvelope,
  mapBuildLowSensitiveAudit,
  mapCreateHandle,
  mapConsumeHandle,
  mapIsAllowedScopeMode,
  mapExtractOrganizationHash,
  mapValidateUnsafeOverride,
  mapBuildWarning,
  type ApiResponseSensitivity,
  type ApiScopeSource,
  type ApiOperationType,
  type ApiHandleKind,
  type ApiHintLocation,
  type ApiHintRole,
  type MapReasonCode,
  type MapWarningCode,
  type ApiDecision,
  type ApiResourceType,
  type ApiHintField,
  type ApiHandleBinding,
  type ApiSurfaceDeclaration,
  type ApiRequestScopingHints,
  type ApiScopeMode,
  type ApiDecisionMetadata,
  type ApiHandleBindingMetadata,
  type ApiLowSensitiveAudit,
  type ApiBoundaryResolution,
} from './multitenant-api-boundary.js'
export {
  API_ORG_A_ID,
  API_ORG_B_ID,
  API_ORG_A_PROJECT_ID,
  API_ORG_B_PROJECT_ID,
  apiOrgScopeHash,
  apiOrgAScopeHash,
  apiOrgBScopeHash,
  buildApiOrgAMirrorRefs,
  buildApiOrgBMirrorRefs,
  buildApiProjectSurfaces,
  buildAiCompilerSurfaces,
  buildApiDecisionFixture,
  buildApiHandleFixtureA,
  buildOrgAUnsafeBodyHint,
  buildOrgAUnsafeQueryHint,
  buildOrgAUnsafeDecisionClaim,
  buildApiBoundaryResolutionA,
} from './multitenant-api-boundary-fixtures.js'

// v3-scim-provisioning —— V3 企业级 SCIM 2.0 Provisioning 共享契约：低敏 provider/token
// 摘要、SCIM User/Group 资源形状、属性与组角色映射、JIT 策略夹紧、确定性 ref/指纹、
// 有界过滤/分页解析、RFC 兼容错误构建、低敏审计与脱敏。
export {
  SCIM_HASH_NS,
  SCIM_REF_LENGTH,
  SCIM_FINGERPRINT_LENGTH,
  SCIM_PROVIDER_STATUSES,
  SCIM_TOKEN_STATUSES,
  SCIM_ALLOWED_ROLES,
  SCIM_JIT_ALLOWED_ROLES,
  SCIM_CONFLICT_POLICIES,
  SCIM_LINK_MODES,
  SCIM_WARNING_CODES,
  SCIM_REASON_CODES,
  SCIM_PROJECT_ERROR_CODES,
  SCIM_AUDIT_EVENTS,
  SCIM_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_ERROR_SCHEMA,
  SCIM_PATCHOP_SCHEMA,
  SCIM_DEFAULT_MAX_RESULTS,
  SCIM_EXTRA_FORBIDDEN_KEYS,
  SCIM_FORBIDDEN_KEYS,
  SCIM_USER_FILTER_ATTRIBUTES,
  SCIM_GROUP_FILTER_ATTRIBUTES,
  SCIM_ENDPOINT_KEY_MIN_LENGTH,
  SCIM_ENDPOINT_KEY_MAX_LENGTH,
  SCIM_TOKEN_MIN_LENGTH,
  SCIM_TOKEN_MAX_LENGTH,
  SCIM_DEFAULT_ATTRIBUTE_MAPPING,
  scimComputeProviderRef,
  scimComputeTokenRef,
  scimComputeEndpointKeyRef,
  scimComputeTokenFingerprint,
  scimComputeExternalIdRef,
  scimComputeEventRef,
  scimComputeMappingFingerprint,
  scimNormalizeUserName,
  scimNormalizeEmail,
  scimNormalizeDisplayName,
  scimClampRole,
  scimClampJitDefaultRole,
  scimRoleRank,
  scimNormalizeAttributeMapping,
  scimNormalizeGroupRoleMapping,
  scimNormalizeJitPolicy,
  scimResolveRole,
  scimIsValidEndpointKeyFormat,
  scimIsValidTokenFormat,
  scimClampPagination,
  scimParseFilter,
  scimLooksLikeRawScimPayload,
  scimDetectForbiddenContent,
  scimSanitizeLowSensitive,
  scimErrorResponse,
  scimProjectErrorCode,
  scimListResponse,
  scimBuildAuditPayload,
  scimIsDegradedWarning,
  type ScimProviderStatus,
  type ScimTokenStatus,
  type ScimOrganizationRole,
  type ScimJitDefaultRole,
  type ScimConflictPolicy,
  type ScimLinkMode,
  type ScimWarningCode,
  type ScimReasonCode,
  type ScimProjectErrorCode,
  type ScimAuditEvent,
  type ScimFeatureFlags,
  type ScimAttributeMapping,
  type ScimGroupRoleMapping,
  type ScimJitPolicy,
  type ScimProviderSummary,
  type ScimTokenSummary,
  type ScimTokenCreatedResult,
  type ScimUserResource,
  type ScimGroupResource,
  type ScimListResponse,
  type ScimErrorResponse,
  type ScimPatchOperation,
  type ScimSyncEventSummary,
  type ScimMappingPreviewEntry,
  type ScimMappingPreview,
  type ScimParsedFilter,
  type ScimFilterRejected,
  type ScimFilterResult,
  type ScimPagination,
} from './scim-provisioning.js'
export {
  SCIM_FIXTURE_ORG_A,
  SCIM_FIXTURE_ORG_B,
  SCIM_FIXTURE_PROVIDER_ID_A,
  SCIM_FIXTURE_PROVIDER_ID_B,
  SCIM_FIXTURE_ENDPOINT_KEY_A,
  SCIM_FIXTURE_ENDPOINT_KEY_B,
  SCIM_FIXTURE_TOKEN_A,
  SCIM_FIXTURE_TOKEN_B,
  SCIM_FIXTURE_JIT_DISABLED,
  SCIM_FIXTURE_JIT_ENABLED,
  SCIM_FIXTURE_GROUP_MAPPING_A,
  SCIM_FIXTURE_GROUP_MAPPING_B,
  SCIM_FIXTURE_PROVIDER_A,
  SCIM_FIXTURE_PROVIDER_B,
  SCIM_FIXTURE_PROVIDER_DISABLED,
  SCIM_FIXTURE_PROVIDER_DEGRADED,
  SCIM_FIXTURE_TOKEN_ACTIVE,
  SCIM_FIXTURE_TOKEN_REVOKED,
  SCIM_FIXTURE_USER_ALICE,
  SCIM_FIXTURE_USER_ALICE_ORG_B,
  SCIM_FIXTURE_USER_BOB_INACTIVE,
  SCIM_FIXTURE_GROUP_RESEARCH,
  SCIM_FIXTURE_PATCH_ACTIVE_FALSE,
  SCIM_FIXTURE_PATCH_ADD_GROUP,
  SCIM_FIXTURE_PATCH_OWNER_PATH,
  SCIM_FIXTURE_FILTER_VALID,
  SCIM_FIXTURE_FILTER_UNSUPPORTED,
  SCIM_FIXTURE_FILTER_MALFORMED,
  SCIM_FIXTURE_FILTER_UNKNOWN_ATTR,
  SCIM_FIXTURE_SYNC_EVENT,
  SCIM_FIXTURE_LEAKY_PAYLOAD,
  SCIM_FIXTURE_RAW_PAYLOAD_VALUES,
  SCIM_FIXTURE_ESCALATED_ROLES,
  SCIM_FIXTURE_JIT_ESCALATED_DEFAULT,
  SCIM_FIXTURE_GROUP_MAPPING_A_NORMALIZED,
  SCIM_FIXTURE_JIT_POLICY_A_NORMALIZED,
} from './scim-provisioning-fixtures.js'
// v3-scim-attribute-mapping —— V3 SCIM 属性映射共享契约：结构化映射描述符、
// 有界解析器（RFC 7643 子集 + enterprise alias）、低敏诊断、preview DTO、
// profile snapshot 白名单与 stale 检测、映射面禁止内容检测/脱敏、厂商风格 fixture。
export {
  SCIM_ATTR_MAPPING_HASH_NS,
  SCIM_MAPPING_IDENTITY_TARGETS,
  SCIM_MAPPING_PROFILE_TARGETS,
  SCIM_MAPPING_TARGETS,
  SCIM_MAPPING_PROFILE_WHITELIST,
  SCIM_MAPPING_SELECTOR_TYPES,
  SCIM_MAPPING_NORMALIZATIONS,
  SCIM_MAPPING_DIAGNOSTIC_CODES,
  SCIM_MAPPING_WARNING_CODES,
  SCIM_ENTERPRISE_EXTENSION_URN,
  SCIM_ENTERPRISE_EXTENSION_ATTRIBUTES,
  SCIM_MAPPING_SUPPORTED_CORE_PATHS,
  SCIM_MAPPING_PROFILE_VALUE_MAX_LENGTH,
  SCIM_MAPPING_PATH_MAX_LENGTH,
  SCIM_DEFAULT_MAPPING_DESCRIPTORS,
  scimComputeAttributeMappingFingerprint,
  scimMappingVersionFromFingerprint,
  scimMappingIsStaleSnapshot,
  scimMappingNormalizeEnterprisePath,
  scimMappingNormalizeSupportedPath,
  scimMappingNormalizeEmail,
  scimMappingNormalizeUserName,
  scimMappingNormalizeDisplayName,
  scimMappingNormalizeActive,
  scimMappingNormalizeProfileValue,
  scimMappingNormalizeByMode,
  scimMappingWhitelistProfileValues,
  scimMappingMaskValue,
  scimMappingResolveOne,
  scimResolveMappedAttributes,
  scimMappingBuildPreviewResult,
  scimMappingIsEmailArrayShape,
  scimMappingDetectForbiddenContent,
  scimMappingSanitizeLowSensitive,
  scimMappingSnapshotForbiddenHits,
  scimMappingWarningCopy,
  type ScimMappingIdentityTarget,
  type ScimMappingProfileTarget,
  type ScimMappingTarget,
  type ScimMappingSelectorType,
  type ScimMappingNormalization,
  type ScimMappingDiagnosticCode,
  type ScimMappingWarningCode,
  type ScimEnterpriseExtensionAttribute,
  type ScimMappingDescriptor,
  type ScimMappingDescriptorList,
  type ScimMappingDiagnostic,
  type ScimMappingResolution,
  type ScimMappingPreviewTargetSummary,
  type ScimMappingPreviewResult,
  type ScimProfileSnapshot,
  type ScimMappingNormalizedValue,
} from './scim-attribute-mapping.js'
export {
  SCIM_ATTR_MAPPING_FIXTURE_GENERIC_USER,
  SCIM_ATTR_MAPPING_FIXTURE_OKTA_USER,
  SCIM_ATTR_MAPPING_FIXTURE_ENTRA_USER,
  SCIM_ATTR_MAPPING_FIXTURE_GOOGLE_USER,
  SCIM_ATTR_MAPPING_FIXTURE_INVALID_USER,
  SCIM_ATTR_MAPPING_FIXTURE_AMBIGUOUS_EMAILS_USER,
  SCIM_ATTR_MAPPING_FIXTURE_VENDOR_DESCRIPTORS,
  SCIM_ATTR_MAPPING_FIXTURE_GENERIC_EXPECTED,
  SCIM_ATTR_MAPPING_FIXTURE_DEFAULT_FINGERPRINT,
  SCIM_ATTR_MAPPING_FIXTURE_VENDOR_FINGERPRINT,
} from './scim-attribute-mapping-fixtures.js'

// v3-service-architecture-expansion —— V3 服务架构扩展治理共享契约、纯函数与夹具（前后端共享）。
// 服务模块 catalog、角色分类、五层边界检查、编排顺序、adapter/provider 权限边界、
// 低敏 audit/ledger 约束和 Observation inventory。不引入 AdonisJS/React/database/AI SDK 运行时依赖。
export {
  // ── 枚举 ──
  SERVICE_ROLES,
  SERVICE_ROLE_VALUES,
  TENANT_MODES,
  TENANT_MODE_VALUES,
  SIDE_EFFECT_CLASSES,
  SIDE_EFFECT_CLASS_VALUES,
  SIDE_EFFECT_CLASSES_REQUIRING_LEDGER,
  EXTERNAL_ACTION_CLASSES,
  EXTERNAL_ACTION_CLASS_VALUES,
  EXTERNAL_ACTION_CLASSES_REQUIRING_AUTHORIZATION,
  AUDIT_LEDGER_EXPECTATIONS,
  AUDIT_LEDGER_EXPECTATION_VALUES,
  EVIDENCE_FRESHNESS_STATUSES,
  EVIDENCE_FRESHNESS_STATUS_VALUES,
  INFRASTRUCTURE_PREREQUISITES,
  INFRASTRUCTURE_PREREQUISITE_VALUES,
  REJECTED_INFRASTRUCTURE_PREREQUISITES,
  BOUNDARY_CHECK_CATEGORIES,
  BOUNDARY_CHECK_CATEGORY_VALUES,
  ORCHESTRATION_STEPS,
  ORCHESTRATION_STEP_VALUES,
  EXPECTED_ORCHESTRATION_ORDER,
  PREFLIGHT_STEPS_BEFORE_ADAPTER,
  FINDING_SEVERITIES,
  FINDING_SEVERITY_VALUES,
  ARCHITECTURE_REASON_CODES,
  ARCHITECTURE_REASON_CODE_VALUES,
  SENSITIVE_PAYLOAD_KEYWORDS,
  // ── 类型守卫 ──
  isServiceRole,
  isTenantMode,
  isSideEffectClass,
  isExternalActionClass,
  isAuditLedgerExpectation,
  isEvidenceFreshnessStatus,
  isInfrastructurePrerequisite,
  isBoundaryCheckCategory,
  isOrchestrationStep,
  isFindingSeverity,
  isArchitectureReasonCode,
  // ── 纯函数 ──
  normalizeCatalogEntry,
  validateCatalogEntry,
  validateCatalog,
  detectMissingDependencyPolicies,
  validateAllowlistEntry,
  detectUnregisteredServiceFolders,
  extractFolderNameFromPathScope,
  classifyLowSensitiveFinding,
  makeLowSensitiveFindingSummary,
  stripSensitivePayload,
  containsSensitivePayload,
  validateOrchestrationFlow,
  detectOrchestratorDuplicateOwnership,
  // ── DTO 类型 ──
  type ServiceModuleKey,
  type ServiceRole,
  type TenantMode,
  type SideEffectClass,
  type ExternalActionClass,
  type AuditLedgerExpectation,
  type EvidenceFreshnessStatus,
  type InfrastructurePrerequisite,
  type BoundaryCheckCategory,
  type OrchestrationStep,
  type FindingSeverity,
  type ArchitectureReasonCode,
  type DependencyPolicy,
  type ServiceCatalogEntry,
  type AllowlistEntry,
  type ServiceArchitectureFinding,
  type ServiceArchitectureValidationError,
  type ServiceArchitectureValidationWarning,
  type ServiceArchitectureValidationResult,
  type OrchestrationStepRecord,
  type OrchestrationFlowFixture,
  type AuthorizedRealSmokeRecord,
} from './service-architecture-expansion.js'
export {
  FIXTURE_DOMAIN_SERVICE_ENTRY,
  FIXTURE_ORCHESTRATOR_SERVICE_ENTRY,
  FIXTURE_ADAPTER_SERVICE_ENTRY,
  FIXTURE_PROVIDER_SERVICE_ENTRY,
  FIXTURE_AUDIT_SERVICE_ENTRY,
  FIXTURE_LEDGER_SERVICE_ENTRY,
  FIXTURE_LEGACY_SERVICE_ENTRY,
  FIXTURE_INVALID_CATALOG_ENTRY,
  FIXTURE_REJECTED_INFRA_ENTRY,
  FIXTURE_MISSING_LEDGER_ENTRY,
  FIXTURE_INVALID_ALLOWLIST_ENTRY,
  FIXTURE_VALID_ALLOWLIST_ENTRY,
  FIXTURE_VALID_ORCHESTRATION_FLOW,
  FIXTURE_ADAPTER_WITHOUT_PREFLIGHT_FLOW,
  FIXTURE_FORMAL_WRITE_WITHOUT_CONFIRMATION_FLOW,
  FIXTURE_DUPLICATE_OWNERSHIP_FLOW,
  FIXTURE_SENSITIVE_AUDIT_PAYLOADS,
  FIXTURE_SAFE_AUDIT_PAYLOAD,
  FIXTURE_VALID_CATALOG,
} from './service-architecture-expansion-fixtures.js'

// v3-performance-and-scale-gates —— V3 性能与规模门禁共享契约（前后端共享，纯类型 + 低敏 helpers）。
// 注意：containsSensitiveContent / fnv1aHash / computeSourceHash 已由其他模块在 barrel 导出，
// 此处显式排除冲突名（模块内仍可直接 import）。
export {
  GATE_SURFACES,
  REQUIRED_V3_HIGH_RISK_SURFACES,
  GATE_PHASES,
  GATE_PROFILES,
  METRIC_KINDS,
  BUDGET_KINDS,
  GATE_STATUSES,
  REPORT_STATUSES,
  WAIVER_TYPES,
  EVIDENCE_KINDS,
  SCOPE_KINDS,
  AUTHORIZATION_BOUNDARIES,
  REASON_CODES,
  FINDING_CODES,
  REDACTION_REASON_CODES,
  SENSITIVE_PATTERNS,
  KNOWN_METRIC_NAMES,
  ALLOWED_STATUS_TRANSITIONS,
  GATE_SENSITIVE_KEYWORDS,
  isGateSurface,
  isGateProfile,
  isGateStatus,
  isReportStatus,
  isMetricKind,
  isBudgetKind,
  isReasonCode,
  isAuthorizationBoundary,
  isEvidenceKind,
  isFindingCode,
  isGatePhase,
  isWaiverType,
  containsSensitiveContent as gateContainsSensitiveContent,
  countSensitiveHits,
  redactSensitiveText,
  summarizeRedactions,
  validateGateCatalogEntry,
  validateGateCatalog,
  findSurfaceCoverage,
  makeCatalogGapFinding,
  isWaiverExpired,
  canTransitionStatus,
  aggregateReportStatus,
  makeReportId,
  validateReportSchema,
  type GateSurface,
  type GatePhase,
  type GateProfile,
  type MetricKind,
  type BudgetKind,
  type GateStatus,
  type ReportStatus,
  type WaiverType,
  type EvidenceKind,
  type ScopeKind,
  type AuthorizationBoundary,
  type ReasonCode,
  type FindingCode,
  type RedactionReasonCode,
  type MetricBudget,
  type GateCatalogEntry,
  type EnvironmentSummary,
  type CommandSummary,
  type RedactionWarning,
  type MetricSummary,
  type GateFinding,
  type EvidenceRef,
  type Waiver,
  type ObservationContext,
  type RedactionSummary,
  type GateResult,
  type PerformanceScaleGateReport,
  type RedactResult,
  type KnownMetricName,
  type CatalogIssue,
} from './performance-and-scale-gates.js'
export {
  FIXTURE_PROFILE_NAMES,
  FIXTURE_PROFILE_SPECS,
  GATE_TO_FIXTURE_PROFILE,
  mulberry32,
  seedFromString,
  stableSerialize,
  generateProjectScaleFixture,
  generateTenantMirrorFixture,
  generateMockSummaries,
  fixtureCountMetrics,
  assertBoundedVolumes,
  type FixtureProfileName,
  type FixtureBounds,
  type FixtureTask,
  type FixtureProject,
  type FixtureOrganization,
  type GanttFixtureEdge,
  type GanttFixture,
  type ProjectScaleFixture,
  type TenantMirrorEntry,
  type TenantMirrorFixture,
  type AiDraftStreamingMock,
  type CompilerValidationMock,
  type ReportExportJobMock,
  type EnterpriseSecurityMock,
  type MockSummaries,
} from './performance-scale-fixtures.js'
export {
  PERFORMANCE_GATE_CATALOG,
  PERFORMANCE_GATE_CATALOG_BY_ID,
  GATE_PROBES,
  filterCatalog,
  checkCatalogCoverage,
  validateCatalogProbeConsistency,
  type GateProbeResult,
  type GateProbe,
} from './performance-gate-catalog.js'
export {
  passthroughCommandExecutor,
  buildEnvironmentSummary,
  makeObservationContext,
  evaluateBudgets,
  makeCommandSummary,
  runGate,
  runGates,
  summarizeReport,
  listGates,
  type RunOptions,
  type CommandExecution,
  type CommandExecutor,
  type BudgetEvaluation,
  type GateRunContext,
  type RunResult,
} from './performance-gate-runner.js'
export {
  countGateStatuses,
  evaluatePreflightAdvisory,
  type PreflightAdvisoryInput,
  type PreflightAdvisoryResult,
} from './performance-gate-preflight.js'

// v3-uat-and-release-stabilization —— V3 UAT 与发布稳定化收口治理共享契约（纯类型 + 确定性校验 helpers）。
// 注意：redactSensitiveText / containsSensitiveContent / countSensitiveHits 已由其他模块在 barrel 导出，
// 本 change 模块内直接 import，不重复导出冲突名。
export {
  UAT_TRIAGE_CATEGORIES,
  TRIAGE_CATEGORY_ALIASES,
  UAT_TRIAGE_LABELS,
  SCOPE_ENTRY_STATUSES,
  SCOPE_LEDGER_REQUIRED_ENTRY_FIELDS,
  UAT_SCENARIO_SEVERITIES,
  UAT_SCENARIO_STATUSES,
  RELEASE_CRITICAL_WORKFLOWS,
  UAT_SCENARIO_REQUIRED_FIELDS,
  UAT_GATE_STATUSES,
  REQUIRED_MANIFEST_GATE_SLOTS,
  SPECIALIZED_GATE_IDS,
  SPECIALIZED_GATE_STATUSES,
  RELEASE_CLAIM_LEVELS,
  SCOPE_LEDGER_ISSUE_KINDS,
  UAT_MATRIX_ISSUE_KINDS,
  MANIFEST_ISSUE_KINDS,
  AUTHORIZATION_GATE_IDS,
  AUTHORIZATION_GATES,
  REQUIRED_STABILIZATION_ARTIFACTS,
  V25_RELEASE_MAP_PATH,
  SCOPE_CAPTURE_MAX_AGE_DAYS,
  normalizeTriageCategory,
  validateScopeLedger,
  validateUatMatrix,
  validateEvidenceManifest,
  deriveEvidenceManifestFreshness,
  classifyAuthorizationGate,
  assertNoRealProviderInvocation,
  assertUnauthorizedActionEvidence,
  makeAuthorizedRealVerificationTemplate,
  validateEvidenceLowSensitive,
  sanitizeUatEvidenceSummary,
  detectMissingRequiredArtifacts,
  evaluateStabilization,
  makeStabilizationIssue,
  isUatReleaseReady,
  summarizeUatFindings,
  countUatGateStatuses,
  type UatTriageCategory,
  type ScopeEntryStatus,
  type ScopeLedgerCapture,
  type ScopeLedgerEntry,
  type ScopeLedger,
  type ScopeLedgerIssueKind,
  type ScopeLedgerIssue,
  type UatScenarioSeverity,
  type UatScenarioStatus,
  type ReleaseCriticalWorkflow,
  type UatScenario,
  type WorkflowDeferral,
  type UatMatrix,
  type UatMatrixIssueKind,
  type UatMatrixIssue,
  type UatGateStatus,
  type RequiredManifestGateSlot,
  type SpecializedGateId,
  type SpecializedGateStatus,
  type EvidenceGate,
  type SpecializedGateSummary,
  type TriageFinding,
  type AuthorizedRealVerification,
  type ReleaseClaimLevel,
  type EvidenceManifest,
  type EvidenceManifestValidationContext,
  type EvidenceManifestFreshness,
  type ManifestIssueKind,
  type ManifestIssue,
  type AuthorizationGateId,
  type AuthorizationGate,
  type ExternalActionEvidenceKind,
  type StabilizationInput,
  type UatStabilizationIssue,
  type StabilizationCheckResult,
} from './v3-uat-release-stabilization.js'
export {
  UAT_FIXTURE_CAPTURED_AT,
  UAT_FIXTURE_WORKFLOWS,
  fixtureArtifactsAllPresent,
  makeScopeLedgerFixture,
  makeUatMatrixFixture,
  makeEvidenceManifestFixture,
  makePassingStabilizationInput,
  makeBlockedStabilizationInput,
  makeDeferredStabilizationInput,
  makeAuthorizationGatedStabilizationInput,
  makeMissingSpecializedGateStabilizationInput,
  makeStaleScopeStabilizationInput,
  makeMissingArtifactStabilizationInput,
  makeTasksIncompleteStabilizationInput,
  makeMissingWorkflowScenarioInput,
  makeUnauthorizedActionInput,
} from './v3-uat-release-stabilization-fixtures.js'

// v3-security-and-penetration-gate —— V3 安全与渗透门禁共享契约（纯类型 + 低敏 helpers + fixtures）。
export {
  SECURITY_DOMAINS,
  REQUIRED_SECURITY_HIGH_RISK_SURFACES,
  SECURITY_GATE_STATUSES,
  SECURITY_REPORT_STATUSES,
  SECURITY_SEVERITIES,
  SECURITY_AUTHORIZATION_BOUNDARIES,
  SECURITY_REASON_CODES,
  SECURITY_FINDING_CODES,
  SECURITY_REDLINE_RULE_FAMILIES,
  SECURITY_EVIDENCE_KINDS,
  ATTACK_SCENARIO_KINDS,
  ATTACK_EXPECTED_OUTCOMES,
  SECURITY_REDACTION_REASON_CODES,
  SECURITY_FORBIDDEN_KEYS,
  SECURITY_SENSITIVE_PATTERNS,
  SECURITY_SENSITIVE_KEYWORDS,
  isSecurityDomain,
  isSecurityGateStatus,
  isSecurityReportStatus,
  isSecuritySeverity,
  isSecurityAuthorizationBoundary,
  isSecurityReasonCode,
  isSecurityFindingCode,
  isSecurityRedlineRuleFamily,
  isSecurityEvidenceKind,
  isAttackScenarioKind,
  isAttackExpectedOutcome,
  isSecurityRedactionReasonCode,
  isKnownSecurityValue,
  securityFnv1aHash,
  securityStableSerialize,
  computeSecuritySourceHash,
  normalizeSecurityGateStatus,
  normalizeSecuritySeverity,
  aggregateSecurityReportStatus,
  makeSecurityReportId,
  redactSecurityText,
  containsSecuritySensitiveContent,
  sanitizeSecurityEvidence,
  validateSecurityCatalogEntry,
  validateSecurityCatalog,
  findSecuritySurfaceCoverage,
  makeSecurityCatalogGapFinding,
  isSecurityWaiverExpired,
  evaluateSecurityWaiver,
  validateSecurityReportSchema,
  type SecurityDomain,
  type SecurityGateStatus,
  type SecurityReportStatus,
  type SecuritySeverity,
  type SecurityAuthorizationBoundary,
  type SecurityReasonCode,
  type SecurityFindingCode,
  type SecurityRedlineRuleFamily,
  type SecurityEvidenceKind,
  type AttackScenarioKind,
  type AttackExpectedOutcome,
  type SecurityRedactionReasonCode,
  type SecurityEvidenceRef,
  type SecurityGateCatalogEntry,
  type AttackScenarioFixture,
  type SecurityFinding,
  type SecurityWaiver,
  type SecurityGateResult,
  type SecurityObservationContext,
  type SecurityGateReport,
  type SecurityRedactResult,
  type SecurityCatalogIssue,
} from './security-and-penetration-gate.js'
export {
  SECURITY_GATE_CATALOG,
  SECURITY_GATE_CATALOG_BY_ID,
  SECURITY_ATTACK_SCENARIOS,
  SECURITY_FIXTURE_PACKS_BY_ID,
  securityScenariosByKind,
  TENANT_NEGATIVE_ATTACK_SCENARIOS,
  SECURITY_FIXTURE_SENSITIVE_KEYWORDS,
  SECURITY_FIXTURE_DEFAULT_EVIDENCE,
} from './security-and-penetration-gate-fixtures.js'

// v3-unified-ai-invocation-ledger —— 统一 AI 调用账本共享契约（纯类型 + 低敏 helpers + fixtures）。
export {
  LEDGER_OPERATION_NAMES,
  LEDGER_PROVIDER_NAMES,
  LEDGER_ATTEMPT_STATUSES,
  LEDGER_ERROR_KINDS,
  LEDGER_ERROR_KINDS_M0,
  LEDGER_ERROR_KINDS_EXTENDED,
  LEDGER_FORBIDDEN_KEY_CATEGORIES,
  LEDGER_FORBIDDEN_KEY_PATTERNS,
  LEDGER_METADATA_ALLOWLIST,
  LEDGER_LOCAL_ATTRIBUTE_PREFIX,
  LEDGER_STANDARD_ATTRIBUTE_KEYS,
  LEDGER_UNKNOWN_MARKER,
  ledgerForbiddenCategory,
  sanitizeLedgerMetadata,
  ledgerDetectForbiddenKeys,
  ledgerHasForbiddenKeys,
  ledgerFindDisallowedKeys,
  LEDGER_DTO_ALLOWED_KEYS,
  ledgerFnv1aHash,
  ledgerStableSerialize,
  computeLedgerContentHash,
  computeLedgerInputHash,
  computeLedgerOutputHash,
  serializeLedgerAttributes,
  ledgerFindNamespacingViolations,
  isLedgerAttemptStatus,
  assertLedgerAttemptStatus,
  isLedgerOperationName,
  assertLedgerOperationName,
  isLedgerErrorKind,
  normalizeLedgerErrorKind,
  groupLedgerAttemptsByRetry,
  parseSourceLedgerRef,
  dedupeLedgerAndSourceRows,
  defaultLedgerWindowBounds,
  aggregateLedgerAttempts,
  ledgerGroupKeyForDimension,
  computeLedgerWindowCounts,
  type LedgerOperationName,
  type LedgerProviderName,
  type LedgerProviderNameOrExtension,
  type LedgerAttemptStatus,
  type LedgerErrorKind,
  type LedgerForbiddenKeyCategory,
  type LedgerMetadataAllowKey,
  type LedgerAggregationDimension,
  type LedgerAggregationBucket,
  type LedgerAggregationResult,
  type LedgerSourceKind,
  type UnifiedAiInvocationAttempt,
} from './unified-ai-invocation-ledger.js'
export {
  unifiedAiInvocationAttemptFixture,
  ledgerSuccessAttemptFixture,
  ledgerFailedAttemptFixture,
  ledgerDegradedAttemptFixture,
  ledgerRetryAttemptFixture,
  ledgerAbortedAttemptFixture,
  ledgerBridgedAttemptFixture,
  unifiedAiInvocationLedgerFixtures,
  sourceLedgerRowFixture,
  LEDGER_FIXTURE_ORG_A,
  LEDGER_FIXTURE_ORG_B,
  LEDGER_FIXTURE_PROJECT,
} from './unified-ai-invocation-ledger-fixtures.js'

// v3-prompt-version-registry —— prompt 版本注册表共享契约（纯类型 + hash + fixtures）。
export {
  computePromptContentHash,
  verifyPromptHash,
  isPromptVersionEntry,
  isValidPromptVersion,
  findPromptVersionNamespacingViolations,
  PROMPT_VERSION_UNREGISTERED,
  PROMPT_VERSION_LOCAL_PREFIX,
  PROMPT_VERSION_FIELD,
  PROMPT_NAME_FIELD,
  type PromptVersionEntry,
  type PromptVersionScope,
  type PromptVersionQueryResult,
} from './prompt-version-registry.js'
export {
  KNOWN_PROMPT_CONTENT,
  KNOWN_PROMPT_HASH,
  TRIZ_PROMPT_CONTENT,
  TRIZ_PROMPT_HASH,
  MISMATCH_HASH,
  SCOPE_RISK,
  SCOPE_TRIZ,
  SCOPE_GLOBAL,
  SCOPE_MULTI_CAPABILITY,
  REGISTERED_RISK_ENTRY,
  REGISTERED_TRIZ_ENTRY,
  REGISTERED_MULTI_SCOPE_ENTRY,
  REGISTERED_GLOBAL_ENTRY,
  PROMPT_VERSION_REGISTRY_FIXTURES,
} from './prompt-version-registry-fixtures.js'

// v3-copilot-action-and-preview-boundary —— Copilot 动作与预览边界共享契约（纯类型 + 确定性 helpers + fixtures）。
export {
  COPILOT_ACTION_KINDS,
  COPILOT_ACTION_CARD_MAX_PRIMARY,
  COPILOT_ACTION_BUTTON_STATES,
  COPILOT_ACTION_BUTTON_TRANSITIONS,
  COPILOT_ACTION_EMPTY_ASSUMPTION_SLOT,
  COPILOT_ACTION_DECISION_KINDS,
  COPILOT_ACTION_CONFIRMATION_STATUSES,
  COPILOT_BULK_ITEM_RESULTS,
  COPILOT_ACTION_FORBIDDEN_WORDING,
  isCopilotActionKind,
  copilotActionKindLabel,
  isCopilotActionButtonState,
  canCopilotActionButtonTransition,
  isCopilotActionCardConfirmable,
  copilotActionCardConfirmBlockReason,
  isCopilotActionSourceSignature,
  validateCopilotActionSourceSignatures,
  isCopilotActionSourceSignatureFresh,
  copilotActionSourceSignaturePrefix,
  deriveCopilotActionIdempotencyKey,
  isCopilotActionDecisionKind,
  isCopilotBulkResultFullyApplied,
  findCopilotActionForbiddenWording,
  isCopilotActionWordingClean,
  assertCopilotDryRunGate,
  type CopilotActionKind,
  type CopilotActionButtonState,
  type CopilotActionAssumptionSlot,
  type CopilotActionCardControl,
  type CopilotActionCard,
  type CopilotActionSourceSignature,
  type CopilotSourceSignatureValidation,
  type CopilotActionIdempotencyInput,
  type CopilotActionDecisionKind,
  type CopilotActionConfirmationRequest,
  type CopilotActionConfirmationStatus,
  type CopilotActionConfirmationResult,
  type CopilotBulkItemResultKind,
  type CopilotBulkDecisionItemResult,
  type CopilotBulkDecisionResult,
} from './copilot-action-boundary.js'
export {
  COPILOT_ACTION_FIXTURE_SOURCE_SIGNATURES,
  COPILOT_ACTION_FIXTURE_STALE_SIGNATURES,
  COPILOT_ACTION_FIXTURE_ASSUMPTIONS,
  COPILOT_ACTION_FIXTURE_SUPPLIED_SLOT,
  COPILOT_ACTION_FIXTURE_UNSUPPLIED_SLOT,
  COPILOT_ACTION_FIXTURE_RECOMMENDED_ACTION,
  COPILOT_ACTION_FIXTURE_CARD_CONFIRMABLE,
  COPILOT_ACTION_FIXTURE_CARD_UNSEEN_DEFAULT,
  COPILOT_ACTION_FIXTURE_CARD_STALE,
  COPILOT_ACTION_FIXTURE_RESULT_ACCEPTED,
  COPILOT_ACTION_FIXTURE_RESULT_MODIFIED,
  COPILOT_ACTION_FIXTURE_RESULT_REJECTED,
  COPILOT_ACTION_FIXTURE_RESULT_STALE_BLOCKED,
  COPILOT_ACTION_FIXTURE_RESULT_PERMISSION_DENIED,
  COPILOT_ACTION_FIXTURE_RESULT_DRY_RUN_FAILED,
  COPILOT_ACTION_FIXTURE_RESULT_PARTIAL_FAILURE,
  COPILOT_ACTION_FIXTURE_RESULT_IDEMPOTENT_REPLAY,
  COPILOT_ACTION_FIXTURE_RESULTS,
  COPILOT_ACTION_FIXTURE_BULK_OK,
  COPILOT_ACTION_FIXTURE_BULK_MIXED,
  COPILOT_ACTION_FIXTURE_BULK_RESULT_OK,
  COPILOT_ACTION_FIXTURE_BULK_RESULT_MIXED,
  COPILOT_ACTION_FIXTURE_CARDS,
  copilotActionFixtureConfirmationRequest,
} from './copilot-action-boundary-fixtures.js'

// v3-copilot-agent-workflow-orchestration —— 多步骤编排的确认点约束、状态机复用、
// 回放确定性与逐步预算共享契约（纯类型 + 确定性 helpers + 五态 fixtures）。
export * from './copilot-agent-workflow.js'
export * from './copilot-agent-workflow-fixtures.js'

// v3-copilot-shared-contracts —— Copilot 编排层共享类型地基（纯类型 + 确定性 helpers + 八态 fixtures）。
// 命名纪律：全部导出使用 Copilot / COPILOT / copilot 前缀（唯一名 copilotStableSerialize，
// 通用名 stableSerialize 已由 performance-scale-fixtures 占有），不与既有导出冲突。
export * from './copilot-shared-contracts.js'
export * from './copilot-shared-contracts-fixtures.js'

// v3-copilot-citations —— 外部出处强制性、内外区分、快照标注与外部调用观测（纯类型 +
// 确定性 helpers + 五态 fixtures）。命名纪律：全部导出使用 Copilot / COPILOT / copilot 前缀。
export * from './copilot-citations.js'
export * from './copilot-citations-fixtures.js'

// v3-copilot-intent-catalog-and-router —— Copilot 意图目录与路由共享契约（纯类型 + 确定性
// 常量/校验 + 命令注册表可用性适配 + 低敏路由决策记录形状 + fixtures）。命名纪律：全部导出
// 使用 Copilot / COPILOT / copilot 前缀，不与既有导出冲突。
export * from './copilot-intent-catalog.js'
export * from './copilot-intent-catalog-fixtures.js'
export * from './copilot-intent-classifier.js'
export * from './copilot-intent-router.js'

// v3-frontend-ai-usage-telemetry —— 前端 AI 使用事件的共享契约（纯类型 + 确定性常量 +
// 校验 helpers + fixtures）。命名纪律：全部导出使用 FrontendTelemetry / frontendTelemetry /
// frontend-telemetry 前缀，不与既有导出冲突。
export * from './frontend-ai-usage-telemetry.js'
export * from './frontend-ai-usage-telemetry-fixtures.js'

// v3-copilot-context-packet-and-project-panorama —— Copilot 上下文采集与组装契约
// （纯类型 + 确定性 helpers + 七态 fixtures；scope→来源映射、L3 合格层排除、
// 方法论切面、项目全景聚合、截断标记、不确定三分与组装结果校验）。
export * from './copilot-context-assembly.js'
export * from './copilot-context-assembly-fixtures.js'

// v3-copilot-authoritative-page-context —— Copilot 权威页面语境契约
// （版本化 PageContextDescriptor / ContextFact / 响应侧披露 / 每路由 filter
//  allowlist / 事实预算，纯类型 + 确定性 helpers，零运行时依赖）。
export * from './copilot-page-context.js'

// v3-ai-context-and-retrieval-observability —— 上下文与检索观测共享契约（纯类型 + 确定性 helpers + 六态 fixtures；
// 逐来源记录、截断记录、不确定三分、检索质量聚合、证据点击形状、禁存约束验证、命名对齐验证）。
export * from './copilot-context-observation.js'
export * from './copilot-context-observation-fixtures.js'

// v3-copilot-external-content-safety —— 外部内容安全契约（纯类型 + 确定性 helpers + 七态 fixtures；
// 注入类别枚举、检测记录（禁存约束）、结构隔离包装、内外优先级、冲突标注、Provenance、拦截统计）。
export * from './copilot-external-content-safety.js'
export * from './copilot-external-content-safety-fixtures.js'

// v3-copilot-mcp-external-tools —— MCP 外部工具契约（纯类型 + 确定性 helpers + 五态 fixtures；
// 工具声明复用插件清单范式、权限不升级、授权门、清单固定、调用记录禁存约束、
// 注入检测复用、截断标记、组织隔离）。
export * from './copilot-mcp-tools.js'
export * from './copilot-mcp-tools-fixtures.js'

// v3-copilot-plugin-tool-contract —— 插件工具贡献契约（contribution 封闭 schema、
// 资格快照、核心路由候选接入、结果边界三类 adapter 与低敏 receipt；纯类型 + 确定性 helpers）。
export * from './copilot-plugin-tool-contract.js'
export * from './copilot-plugin-tool-contract-fixtures.js'

// v3-copilot-first-party-tool-pack —— 官方第一方四工具插件包共享契约
// （固定 identity、四工具声明、确定性 digest/损坏检测、低敏 provenance 与零网络 fixtures）。
export * from './copilot-first-party-tool-pack.js'

// v3-copilot-clarification-and-assumptions —— Copilot 澄清与假设表达层共享契约
// （纯类型 + 确定性 helpers + 六态 fixtures；三档语义、来源强度→置信度派生、
// 槽位状态机、假设条目构造、非泄露文案、确定性输入元组、低敏 sanitizer）。
export * from './copilot-clarification.js'
export * from './copilot-clarification-fixtures.js'

// v3-copilot-memory-user-and-project —— Copilot 跨对话记忆层共享契约
// （纯类型 + 确定性 helpers + 七态 fixtures；三层 scope、恒为 inference 约束、
// 抽取候选、注入选取、冲突裁决、禁止类别 sanitizer、时效衰减、低敏审计）。
export * from './copilot-memory.js'
export * from './copilot-memory-fixtures.js'

// v3-plugin-capability-seam-catalog —— V3 插件能力接缝目录共享契约（纯类型 + 常量 + 确定性
// hash/序列化 + SemVer 兼容 + 归一化/查找/摘要 + catalog validator + 低敏 sanitization + curated
// 首批目录 + fixtures）。命名纪律：全部导出使用 Seam / SEAM / seam 前缀（唯一名
// seamStableSerialize/seamFnv1aHash，通用名 validateCatalog 已由 service-architecture-expansion
// 占有），不与既有导出冲突。
export * from './plugin-capability-seam-catalog.js'
export * from './plugin-capability-seam-catalog-curated.js'
export * from './plugin-capability-seam-catalog-fixtures.js'

// v3-plugin-manifest-and-permission-contract —— V3 插件 manifest、权限声明与权限不升级验证
// 共享契约（纯类型 + 常量 + 类型守卫 + 确定性归一化/校验/digest + 低敏 sanitization + fixtures）。
// 命名纪律：全部导出使用 Manifest / MANIFEST / manifest 前缀（fnv1aHash/stableSerialize 使用
// manifestFnv1aHash/manifestStableSerialize 避免 barrel 冲突），不与既有导出冲突。
export * from './plugin-manifest.js'
export {
  VALID_MANIFEST_MINIMAL,
  VALID_MANIFEST_FULL,
  VALID_MANIFEST_ORG_PRIVATE,
  INVALID_MANIFEST_UNKNOWN_SCHEMA,
  INVALID_MANIFEST_BAD_PLUGIN_ID,
  INVALID_MANIFEST_BAD_SEMVER,
  INVALID_MANIFEST_PUBLIC_DISTRIBUTION,
  INVALID_MANIFEST_UNKNOWN_SEAM,
  INVALID_MANIFEST_DUPLICATE_CONTRIBUTION,
  INVALID_MANIFEST_GLOBAL_SCOPE,
  INVALID_MANIFEST_ORG_ID_LEAK,
  INVALID_MANIFEST_TRAVERSAL,
  INVALID_MANIFEST_SELF_DEPENDENCY,
  INVALID_MANIFEST_DUPLICATE_DEP,
  INVALID_MANIFEST_URL_DEP,
  INVALID_MANIFEST_RAW_SECRET,
  INVALID_MANIFEST_MULTI_ERROR,
  makeValidGrant,
  makeEscalationGrant,
  makeCatalogEntry,
  makePermissionVocabularyEntry,
  makeValidationContext,
  SENSITIVE_VALUES,
  SENSITIVE_KEYS,
  NON_SENSITIVE_VALUES,
  NON_SENSITIVE_KEYS,
} from './plugin-manifest-fixtures.js'
export * from './plugin-private-registry-lifecycle.js'
export * from './plugin-private-registry-lifecycle-fixtures.js'

// v3-plugin-permission-audit-and-observation —— 插件权限决策与观察契约
// （该模块与其 fixtures 曾未进 barrel，致 barrel smoke 测试拿到 undefined）
export * from './plugin-permission-decision.js'
export * from './plugin-permission-decision-fixtures.js'
export * from './copilot-context-chips.js'
export * from './copilot-context-chips-fixtures.js'

// v3-copilot-mentions-and-slash-commands —— Copilot 输入补全共享契约
// （纯类型 + 常量 + 确定性 helpers + 八态 fixtures）。命名纪律：
// InputCompletion / COMPLETION_ 前缀，不与既有导出冲突。
export * from './copilot-input-completion.js'
export * from './copilot-input-completion-fixtures.js'

// v3-copilot-session-persistence-and-history —— Copilot 会话持久化共享契约
// （纯类型 + 常量 + 确定性 helpers + 六态 fixtures）。命名纪律：全部导出使用
// CopilotSessionPersistence / COPILLOT_SESSION_ 前缀，不与既有导出冲突。
export * from './copilot-session-persistence.js'
export * from './copilot-session-persistence-fixtures.js'

// v3-copilot-general-purpose-mode —— Copilot 通用问答模式契约
// （纯类型 + 常量 + 确定性 helpers + 六态 fixtures）。命名纪律：
// GeneralPurposeMode / GENERAL_PURPOSE_ 前缀，不与既有导出冲突。
export * from './copilot-general-purpose.js'
export * from './copilot-general-purpose-fixtures.js'

// v3-unified-ai-budget-and-quota —— 统一 AI 预算与配额决策层共享契约
// （纯类型 + 常量 + 确定性纯函数 + 八态 fixtures）。命名纪律：
// Budget / BUDGET_ 前缀，不与既有导出冲突。
export * from './unified-ai-budget.js'
export * from './unified-ai-budget-fixtures.js'

// v3-ai-request-tracing —— AI 请求追踪共享契约（span 类型/树装配/聚合/sanitizer/fixtures）
export * from './ai-request-tracing.js'
export * from './ai-request-tracing-fixtures.js'

// v3-unified-ai-feedback-ledger —— 统一 AI 反馈账本共享契约
// （纯类型 + 常量 + 确定性纯函数 + 七态 fixtures）。命名纪律：
// FEEDBACK_ / Feedback / feedback 前缀，不与既有导出冲突。
export * from './unified-ai-feedback.js'
export * from './unified-ai-feedback-fixtures.js'

// v3-copilot-suggestion-inbox —— 五来源 AI 建议收件箱共享契约
// （纯类型 + 常量 + 确定性纯函数 + 八态 fixtures）。命名纪律：
// Inbox / INBOX_ 前缀，不与既有导出冲突。
export * from './copilot-suggestion-inbox.js'
export * from './copilot-suggestion-inbox-fixtures.js'

// v3-ai-automated-evaluation —— AI 产出自动化评测共享契约
// （纯类型 + 常量 + 确定性纯函数 + 八态 fixtures）。命名纪律：
// EVALUATION_ / Evaluation / evaluation 前缀，不与既有导出冲突。
export * from './ai-automated-evaluation.js'
export * from './ai-automated-evaluation-fixtures.js'

// v3-ai-model-drift-observability —— 模型漂移观测共享契约（前后端共享）。
// 纯类型 + 确定性纯函数 + 五态 fixtures，命名纪律：Drift_/DRIFT_/drift 前缀。
export * from './ai-model-drift-observability.js'
export * from './ai-model-drift-observability-fixtures.js'

// v3-copilot-command-palette-bridge —— 命令面板与 Copilot 的双向转交共享契约（前后端共享）。
// 纯类型 + 确定性纯函数 + 七态 fixtures，零 Adonis/React/数据库/网络依赖。
export * from './copilot-palette-bridge.js'
export * from './copilot-palette-bridge-fixtures.js'

// v3-copilot-routing-decision-ledger —— Copilot 路由决策账本共享契约
// （纯类型 + 常量 + 确定性纯函数 + 八态 fixtures）。命名纪律：
// Routing/ROUTING_ 前缀，不与既有导出冲突。
export * from './copilot-routing-ledger.js'
export * from './copilot-routing-ledger-fixtures.js'

// v3-copilot-live-submission-channel —— Copilot 回合契约与 fixtures
export * from './copilot-turn.js'
export * from './copilot-turn-fixtures.js'

// v3-copilot-live-streaming-output —— Copilot 流式输出共享契约
export * from './copilot-streaming.js'

// v3-global-ai-rate-limiting —— 全局限流共享契约与 fixtures
// （此前该 change 的类型文件未进 barrel，致后端 rate_limiting 服务无法解析
//  RATE_LIMIT_WINDOW_MS 等导出，整个后端套件无法启动；由
//  v3-copilot-live-submission-channel 补齐。）
export * from './global-ai-rate-limit.js'
export * from './global-ai-rate-limit-fixtures.js'

// v3-copilot-feedback-driven-ranking —— 反馈加权排序共享契约
// （纯类型 + 常量 + 确定性纯函数 + 五态 fixtures）。命名纪律：
// RANKING_ / Ranking / ranking 前缀，不与既有导出冲突。
export * from './copilot-feedback-ranking.js'
export * from './copilot-feedback-ranking-fixtures.js'

// v3-copilot-notification-routing —— 投递路由共享契约
// （纯类型 + 常量 + 确定性纯函数 + 六态 fixtures）。命名纪律：
// Delivery/DELIVERY_/SUPPRESSION_ 前缀，不与既有导出冲突。
export * from './copilot-notification-routing.js'
export * from './copilot-notification-routing-fixtures.js'

// v3-copilot-structured-and-diagram-output —— 结构化产出块共享契约（表格/清单/图/缺席）
export * from './copilot-structured-output.js'
export * from './copilot-structured-output-fixtures.js'

// v3-copilot-web-search-tool —— 外部检索共享契约（授权门/域名策略/配额/抓取降级/低敏落账）
// 命名纪律：全部导出使用 CopilotWebSearch / copilotWebSearch / RETRIEVAL_ / DomainPolicy 前缀，
// 不与既有导出冲突。
export * from './copilot-web-search.js'
export * from './copilot-web-search-fixtures.js'

// v3-copilot-usage-and-quota-surface —— 用量与额度只读视图共享契约
// （纯类型 + 确定性纯函数 + 五态 fixtures）。命名纪律：
// USAGE_/Usage/usage 前缀，不与既有导出冲突。
export * from './copilot-usage-surface.js'
export * from './copilot-usage-surface-fixtures.js'

// v3-copilot-session-retention —— 会话保留策略治理共享契约
// （纯类型 + 确定性纯函数 + fixtures）。命名纪律：
// CopilotSessionRetention/COPILOT_SESSION_RETENTION 前缀，不与既有导出冲突。
export * from './copilot-session-retention.js'
export * from './copilot-session-retention-fixtures.js'

// v3-copilot-custom-agent-authoring —— 自建 Copilot 助手共享契约
// （纯类型 + 确定性纯函数 + fixtures）。命名纪律：
// CopilotAgent/AGENT_ 前缀，不与既有导出冲突。
export * from './copilot-custom-agent.js'
export * from './copilot-custom-agent-fixtures.js'

// v3-copilot-custom-agent-eval-gate —— 自建助手上线门禁共享契约
// （纯类型 + 确定性纯函数 + 五态 fixtures）。命名纪律：
// EvalGate/EVAL_GATE_/EvalGateVerdict/EvalGateItemScore 前缀，不与既有导出冲突。
export * from './copilot-custom-agent-eval-gate.js'
export * from './copilot-custom-agent-eval-gate-fixtures.js'

// v3-copilot-agent-as-assignee —— AI Agent 作为任务执行人的共享契约
// （纯类型 + 确定性纯函数 + 五态 fixtures）。命名纪律：
// AssigneeType/AgentAssignment/AGENT_ASSIGNMENT_ 前缀，不与既有导出冲突。
export * from './copilot-agent-assignee.js'

// v3-copilot-voice-input —— 音频输入的授权门、去处约束、保留期继承与隐私告知共享契约
// （纯类型 + 确定性纯函数 + 五态 fixtures）。命名纪律：
// CopilotVoice/COPILOT_VOICE_ 前缀，不与既有导出冲突。
export * from './copilot-voice-input-contracts.js'
export * from './copilot-voice-input-contracts-fixtures.js'

// v3-ai-offline-eval-datasets —— 离线回归评测数据集共享契约与测试夹具（前后端共享）。
// 离线回归复用在线 scorer，数据集版本化确定性可复现，报告给 per-sample 差异不自动判定。
export * from './ai-offline-eval-datasets.js'
export * from './ai-offline-eval-datasets-fixtures.js'

// v3-copilot-multi-model-selection —— 会话级模型偏好、能力推导与降级链共享契约。
// 模块本已落地并带测试，但漏了这一行 barrel 导出：后端 copilot_turn_service 从
// '@aiproj/types' 具名导入 deriveTurnRequiredCapabilities，模块图在链接期就断，
// 回合端点每一次认证请求都 500——而该端点当时没有任何 functional 测试，没人看见。
export * from './copilot-model-selection.js'

// v3-ai-online-shadow-and-ab —— 影子与 A/B 实验共享契约（V3）。
export * from './ai-online-shadow-and-ab.js'

// v3-ai-slo-and-alerting —— AI 层 SLO 指标、双档阈值、runbook 关联、去重抑制与
// 「不自动处置」的共享契约（纯类型 + 常量 + 确定性纯函数 + 五态 fixtures）。命名纪律：
// AI_SLO / AiSlo / SLO_ / AiAlert / AI_ALERT_ 前缀，不与既有导出冲突。
export * from './ai-slo-and-alerting.js'
export * from './ai-slo-and-alerting-fixtures.js'

// v3-otel-genai-export-adapter —— OTel GenAI 导出适配器共享契约（纯类型 + 确定性纯函数 + 四态 fixtures）。
// 命名纪律：OTel / OTel_ / OTelExport / OTelGenAi 前缀，不与既有导出冲突。
export * from './otel-genai-export-adapter.js'
export * from './otel-genai-export-adapter-fixtures.js'

// v3-ai-security-observability —— AI 安全事件统一记录、脱敏、聚合与门禁消费共享契约
// （纯类型 + 常量 + 类型守卫 + 确定性纯函数 + 五态 fixtures）。命名纪律：
// AI_SECURITY / AiSecurity / security_event 前缀，不与既有导出冲突。
export * from './ai-security-observability.js'
export * from './ai-security-observability-fixtures.js'

// v3-release-gate-ai-quality-slots —— AI 质量与成本门槽的共享契约（纯类型 + 常量 + 类型守卫
// + 确定性纯函数 + 五态 fixtures）。命名纪律：AI_QUALITY_SLOT / AiQualitySlot / AI_SLOT_ 前缀，
// 不与既有导出冲突。五个门槽：输出质量、离线回归、成本、漂移、安全事件。
export * from './release-gate-ai-quality-slots.js'
export * from './release-gate-ai-quality-slots-fixtures.js'

// v3-observability-data-retention —— 观测数据保留期、清理作业与聚合降采样共享契约。
export * from './observability-retention.js'

// v3-skill-as-plugin-adapter —— W2b 插件安装生命周期与 W4a Skill Adapter 共享契约。
export * from './plugin-install-lifecycle.js'
export * from './plugin-install-lifecycle-fixtures.js'
export * from './plugin-skill-adapter.js'
export * from './plugin-skill-adapter-fixtures.js'

// v3-plugin-approval-change-flow —— 插件统一变更请求与审批确认状态机共享契约
// （纯类型 + 常量 + 确定性状态机 + canonical diff + handle/receipt + 低敏 sanitization）。
// 命名纪律：PLUGIN_CHANGE_ / PluginChange / plugin-change- 前缀，不与既有导出冲突。
export * from './plugin-approval-change-flow.js'
export * from './plugin-approval-change-flow-fixtures.js'

// v3-compiler-hook-plugin-pilot —— W4b 服务端 hook 运行时共享契约。
export * from './plugin-server-hook-runtime.js'
export * from './plugin-server-hook-runtime-fixtures.js'
export * from './plugin-server-hook-pilot-fixtures.js'

// v3-plugin-event-subscription-contract —— W4 平台内部事件订阅契约（只读/建议型，零网络）。
// 命名纪律：PLUGIN_EVENT_ / PluginEvent / plugin-event- 前缀，不与既有导出冲突。
export * from './plugin-event-subscription-contract.js'
export * from './plugin-event-subscription-contract-fixtures.js'

// v3-copilot-project-health-answer —— 三类答案的共享契约类型。
export * from './copilot-answer.js'

// v3-copilot-attachment-support —— 附件上传与 OCR 联动共享契约。
export * from './copilot-attachment-contracts.js'
export * from './copilot-attachment-contracts-fixtures.js'

// v3-copilot-proactive-triggers —— 疲劳控制与主动触发共享契约。
export * from './copilot-proactive-triggers.js'
export * from './copilot-proactive-triggers-fixtures.js'

// v3-compiler-dynamic-routing —— 编译器动态路由共享契约。
export * from './compiler-dynamic-routing.js'

// v3-plugin-ui-command —— 插件 UI 命令共享契约。
export * from './plugin-ui-command.js'
export * from './plugin-ui-command-fixtures.js'

// v3-command-palette-plugin-action-pack —— 官方 Command Palette 插件命令包契约。
export * from './command-palette-plugin-action-pack.js'
export * from './command-palette-plugin-action-pack-fixtures.js'

// v3-template-as-plugin-package —— 模板包插件共享契约与纯函数。
export * from './plugin-template-pack.js'
export * from './plugin-template-pack-fixtures.js'

// security-and-penetration-gate-rules —— 安全与渗透门禁规则。
export * from './security-and-penetration-gate-rules.js'

// streaming-evidence —— 流式证据与观测性。
export * from './streaming-evidence-catalog.js'
export * from './streaming-evidence.js'
export * from './streaming-observability.js'

// additional domain fixtures
export * from './ai-triz-assistant-fixtures.js'
export * from './multi-project-dependency-detection-fixtures.js'
export * from './multitenant-connection-pool-management-fixtures.js'
export * from './pmo-portfolio-traffic-light-fixtures.js'
export * from './triz-clarification-fixtures.js'
export * from './triz-decision-center.fixtures.js'
export * from './v3-v2-5-compatibility-gate-fixtures.js'

// v3-first-party-plugin-canary-pack —— 官方 canary 插件包共享契约（W5a）
export * from './first-party-plugin-canary-pack.js'

// v3-plugin-compatibility-matrix —— 宿主/manifest/seam/迁移统一兼容判定。
export * from './plugin-compatibility-matrix.js'
export * from './ocr-profile-plugin-pack.js'

// v3-plugin-runtime-health-diagnostics —— V3 插件运行健康与诊断共享契约与测试夹具（前后端共享）。
export * from './plugin-runtime-health-diagnostics.js'
export * from './plugin-runtime-health-diagnostics-fixtures.js'

// v3-plugin-e2e-lifecycle-certification —— V3 插件 E2E 生命周期认证共享契约（前后端共享）。
export * from './plugin-e2e-lifecycle-certification.js'
export * from './plugin-e2e-lifecycle-certification-fixtures.js'

// v3-triz-plugin-pack —— TRIZ 官方插件包共享契约与纯函数（前后端共享）。
export * from './triz-plugin-pack.js'
export * from './triz-plugin-pack-fixtures.js'

// v3-official-bi-report-pack —— BI 报表官方插件包（临时 stub，满足编译）
export * from './official-bi-report-pack.js'

// v3-plugin-scoped-storage —— 插件组织/项目级 scoped 存储共享契约（前后端共享）。
export * from './plugin-scoped-storage.js'

// v3-plugin-action-preview-boundary —— V3 插件写入动作统一边界共享契约
// （纯类型 + 常量 + 确定性纯函数 + 封闭字段集校验 + 确认句柄 + 批量逐项 + 低敏 sanitization）。
// 命名纪律：PLUGIN_ACTION_ / PluginAction / action- 前缀，不与既有导出冲突。
export * from './plugin-action-preview-boundary.js'
export * from './plugin-action-preview-boundary-fixtures.js'

// v3-plugin-policy-bundles —— 插件权限策略包共享契约（封闭词表 + 确定性 digest + 内置模板）。
export * from './plugin-policy-bundles.js'
export * from './plugin-policy-bundles-fixtures.js'

// v3-plugin-first-platform-closure —— V3 插件优先线总验收账本共享契约
// （封闭状态词表 + 完成三要件判定 + 内核可用声明准入 + 归档同步报告 + 取证方式两档 + 低敏扫描）。
// 命名纪律：PFC_ / PLUGIN_FIRST_ / KERNEL_CLAIM_ / Closure 前缀，显式命名导出避免 barrel 重名。
export {
  PLUGIN_FIRST_CARD_STATUSES,
  PLUGIN_FIRST_CARD_IDS,
  KERNEL_CLAIM_CARD_IDS,
  KERNEL_CLAIM_ALLOWED_WORDING,
  KERNEL_CLAIM_REJECTED_WORDING_PREFIX,
  CLOSURE_REFERENCE_KINDS,
  EVIDENCE_ACQUISITION_MODES,
  DETERMINISTIC_RERUN_GATES,
  PFC_RULE_IDS,
  isPluginFirstCardStatus,
  isKernelClaimCard,
  sortClosureIssues,
  evaluateCardCompletion,
  validatePartialCoverage,
  validateGateEvidence,
  evaluateKernelClaim,
  detectClaimScopeEscalation,
  compareRecordedClaim,
  validateOffMapRegistry,
  detectUnregisteredCapabilities,
  evaluateArchiveSync,
  sanitizeClosureSummary,
  closureTextIsLowSensitive,
  collectClosureFreeText,
  scanLedgerLowSensitive,
  evaluateClosureLedger,
  type PluginFirstCardStatus,
  type PluginFirstCardId,
  type KernelClaimCardId,
  type ClosureReferenceKind,
  type EvidenceAcquisitionMode,
  type DeterministicRerunGateId,
  type ClosureGateEvidence,
  type ClosureReference,
  type ClosurePathResolver,
  type ClosureEvidenceRecordResolver,
  type PluginFirstCardEntry,
  type OffMapCapabilityEntry,
  type SupersessionDeclaration,
  type ArchiveSyncEntry,
  type ArchiveSyncReport,
  type PluginFirstClosureLedger,
  type PfcRuleId,
  type ClosureIssue,
  type CompletionRequisites,
  type CardCompletionEvaluation,
  type KernelClaimDecision,
  type ArchiveSyncEvaluation,
  type ClosureLedgerEvaluation,
} from './v3-plugin-first-platform-closure.js'
export {
  CLOSURE_FIXTURE_CAPTURED_AT,
  CLOSURE_FIXTURE_HEAD,
  makeFixtureResolver,
  makeRerunEvidence,
  makeReferencedEvidence,
  makeDoneCard,
  makePartialCard,
  makeAllDoneCards,
  makeSyncedArchiveReport,
  makeValidSupersession,
  makeOffMapEntries,
  makePassingLedger,
  makeMissingMainSpecLedger,
  makeDanglingReferenceLedger,
  makeStatusOutOfVocabularyLedger,
  makePartialWithoutCoverageLedger,
  makeReferencedWithoutProvenanceEvidence,
  makeRerunCarryingProvenanceEvidence,
  makeDeterministicGateReferencedEvidence,
  makeInvalidSupersessionReport,
  makeUnmergedArchiveReport,
  makeOffMapMergedIntoCardLedger,
  makeClaimMismatchLedger,
  makeSensitiveLedger,
} from './v3-plugin-first-platform-closure-fixtures.js'

// ── v3-copilot-productized-operating-entry —— Copilot 产品化操作入口/就绪契约 ──
export {
  COPILOT_ENTRY_CONTRACT_VERSION,
  COPILOT_ENTRY_READINESS_STATES,
  COPILOT_ENTRY_REASON_CODES,
  COPILOT_ENTRY_OPTIONAL_REASON_CODES,
  COPILOT_ENTRY_MANDATORY_REASON_CODES,
  COPILOT_ENTRY_ALLOWED_ACTIONS,
  COPILOT_ENTRY_SCOPE_KINDS,
  COPILOT_ENTRY_SESSION_SCOPES,
  COPILOT_ENTRY_QUICK_START_SOURCES,
  COPILOT_ENTRY_SIDE_EFFECT_CLASSES,
  COPILOT_ENTRY_FORBIDDEN_FIELDS,
  COPILOT_ENTRY_PARSE_ISSUE_CODES,
  COPILOT_ENTRY_FAILURE_KINDS,
  COPILOT_ENTRY_MAX_SCOPE_LABEL_LENGTH,
  COPILOT_ENTRY_MAX_SESSION_TITLE_LENGTH,
  COPILOT_ENTRY_MAX_QUICK_START_LABEL_LENGTH,
  COPILOT_ENTRY_MAX_QUICK_START_DRAFT_LENGTH,
  COPILOT_ENTRY_MAX_QUICK_STARTS,
  detectCopilotEntryForbiddenFields,
  sortCopilotEntryQuickStarts,
  boundCopilotEntryQuickStarts,
  boundCopilotEntryText,
  parseCopilotEntryReadinessSnapshot,
  classifyCopilotEntryFailure,
  copilotEntryFailureOutcome,
  canEnterCopilotDemonstration,
  isCopilotEntryReadinessState,
  isCopilotEntryReasonCode,
  isCopilotEntryAllowedAction,
  isCopilotEntryScopeKind,
  isCopilotEntrySessionScope,
  isCopilotEntryQuickStartSource,
  isCopilotEntrySideEffectClass,
  isCopilotEntryFailureKind,
  type CopilotEntryReadinessState,
  type CopilotEntryReasonCode,
  type CopilotEntryReason,
  type CopilotEntryAllowedAction,
  type CopilotEntryScopeKind,
  type CopilotEntryScope,
  type CopilotEntrySessionScope,
  type CopilotEntryRecentSession,
  type CopilotEntryQuickStartSource,
  type CopilotEntrySideEffectClass,
  type CopilotEntryPluginBinding,
  type CopilotEntryQuickStart,
  type CopilotEntryDemonstrationCapability,
  type CopilotEntryReadinessSnapshot,
  type CopilotEntryForbiddenField,
  type CopilotEntryParseIssueCode,
  type CopilotEntryParseIssue,
  type CopilotEntryParseResult,
  type CopilotEntryFailureKind,
  type CopilotEntryFailureOutcome,
} from './copilot-productized-operating-entry.js'
export {
  ENTRY_FIXTURE_EVALUATED_AT,
  ENTRY_FIXTURE_SESSION_UPDATED_AT,
  ENTRY_FIXTURE_SNAPSHOT_REVISION,
  ENTRY_FIXTURE_STALE_SNAPSHOT_REVISION,
  ENTRY_FIXTURE_PLUGIN_BINDING,
  ENTRY_FIXTURE_WRITE_PLUGIN_BINDING,
  ENTRY_FIXTURE_CORE_QUICK_START,
  ENTRY_FIXTURE_CORE_QUICK_START_B,
  ENTRY_FIXTURE_PLUGIN_QUICK_START,
  ENTRY_FIXTURE_WRITE_QUICK_START,
  ENTRY_FIXTURE_RECENT_SESSION,
  ENTRY_FIXTURE_API_ERRORS,
  readyEntrySnapshotFixture,
  readyEmptyEntrySnapshotFixture,
  degradedEntrySnapshotFixture,
  unavailableEntrySnapshotFixture,
  unavailableNoOrganizationFixture,
  entrySnapshotWithUnknownFieldFixture,
  entrySnapshotWithUnknownEnumFixture,
  entrySnapshotWithForbiddenFieldFixture,
  entrySnapshotWithExclusionsFixture,
  entrySnapshotWithOverlongTitleFixture,
  entrySnapshotWithTooManyQuickStartsFixture,
  entrySnapshotWithUnboundPluginQuickStartFixture,
  entrySnapshotWithInconsistentReasonFixture,
} from './copilot-productized-operating-entry-fixtures.js'

// ─── v3-pmo-decision-intelligence-workbench —— PMO 决策工作台共享契约与夹具 ────
// 所有导出均使用 PmoDecision / PMO_DECISION 前缀，避免与既有 PMO/资源/插件契约同名冲突。
export * from './pmo-decision-workbench.js'
export * from './pmo-decision-workbench-fixtures.js'

// v3-resource-capacity-forecasting-closed-loop —— 资源容量预测闭环契约与纯函数。
export * from './resource-capacity-closed-loop.js'
export * from './resource-capacity-closed-loop-pure.js'

// v3-project-health-risk-command-center —— 项目健康风险指挥中心共享契约、纯函数与夹具（前后端共享）。
// 注：权限指纹函数命名为 computeCommandCenterPermissionFingerprint，
// 避免与 multi-project-impact-analysis 的 computePermissionFingerprint 同名冲突。
export * from './project-health-risk-command-center.js'
export * from './project-health-risk-command-center-fixtures.js'

export * from './resource-capacity-closed-loop-fixtures.js'

// v3-triz-to-delivery-closed-loop —— TRIZ 决策到交付闭环共享契约。
export * from './triz-to-delivery-closed-loop.js'

// V3 release trust uses explicit exports to avoid adding another ambiguous star surface.
export {
  RELEASE_TRUST_EVIDENCE_MODES,
  RELEASE_TRUST_GATE_KINDS,
  RELEASE_TRUST_SUMMARY_SOURCES,
  TRUST_DECISIONS,
  TRUST_DECISION_WORDING,
  RELEASE_TRUST_GATE_REGISTRY,
  isTrustDecision,
  validateEvidenceRecord,
  detectHeadDrift,
  evaluateReleaseTrust,
  compareRecordedDecision,
  scanEvidenceBundleLowSensitive,
} from './release-trust-and-evidence-center.js'
export type {
  ReleaseTrustEvidenceMode,
  ReleaseTrustGateKind,
  ReleaseTrustSummarySource,
  TrustDecision,
  ReleaseTrustSummarySelector,
  ReleaseTrustGateRegistryEntry,
  ReleaseTrustRerunEvidenceRecord,
  ReleaseTrustReferencedEvidenceRecord,
  ReleaseTrustEvidenceRecord,
  ReleaseTrustEvidenceBundle,
  ReleaseTrustFindingSeverity,
  ReleaseTrustFinding,
  ReleaseTrustDriftEntry,
  ReleaseTrustEvaluation,
  ReleaseTrustSensitiveFindingKind,
  ReleaseTrustSensitiveFinding,
} from './release-trust-and-evidence-center.js'
export * from './llm-wiki-memory.js'
export * from './llm-wiki-ingest.js'
export * from './llm-wiki-query.js'
export * from './llm-wiki-dossier.js'
export * from './llm-wiki-process.js'
export * from './llm-wiki-person.js'
export * from './llm-wiki-lint.js'
export * from './llm-wiki-retrospective.js'
export * from './llm-wiki-eval.js'
export * from './llm-wiki-retirement.js'

export * from './ai-connection-requirement.js'
