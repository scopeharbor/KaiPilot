/**
 * v2-5-compiler-34-stage-code-generation-pipeline —— shared contract.
 *
 * This module intentionally contains only deterministic catalog/validation data.
 * It does not generate source code, call models, write files, or depend on backend runtime APIs.
 */

export const CODE_GENERATION_CONTRACT_VERSION = '1.0' as const

export const CODE_GENERATION_PHASES = [
  'intake',
  'architecture',
  'backend',
  'frontend',
  'integration',
  'quality',
  'documentation',
  'review',
] as const

export type CodeGenerationPhase = (typeof CODE_GENERATION_PHASES)[number]

export const CODE_GENERATION_STAGE_KINDS = [
  'deterministic',
  'hybrid',
  'ai_eligible',
  'gate',
] as const

export type CodeGenerationStageKind = (typeof CODE_GENERATION_STAGE_KINDS)[number]

export const CODE_GENERATION_ARTIFACT_KINDS = [
  'requirement_digest',
  'architecture_plan',
  'data_model',
  'api_contract',
  'route_candidate',
  'service_candidate',
  'validator_candidate',
  'policy_candidate',
  'migration_candidate',
  'frontend_route_candidate',
  'component_candidate',
  'state_candidate',
  'integration_contract_candidate',
  'test_candidate',
  'config_candidate',
  'documentation_candidate',
  'review_report',
] as const

export type CodeGenerationArtifactKind = (typeof CODE_GENERATION_ARTIFACT_KINDS)[number]

export const CODE_GENERATION_TOOL_IDS = [
  'read_blueprint',
  'inspect_existing_code',
  'read_stage_artifact',
  'write_candidate_artifact',
  'validate_schema',
  'validate_policy',
  'validate_path',
  'summarize_diff',
  'run_fixture_test',
  'run_static_check',
  'compose_review_packet',
  'request_human_review',
] as const

export type CodeGenerationToolId = (typeof CODE_GENERATION_TOOL_IDS)[number]

export const CODE_GENERATION_CONTEXT_SCOPES = [
  'current_stage_only',
  'blueprint_summary',
  'selected_artifact_refs',
  'local_code_slice',
  'validation_feedback',
  'review_summary',
] as const

export type CodeGenerationContextScope = (typeof CODE_GENERATION_CONTEXT_SCOPES)[number]

export const CODE_CANDIDATE_REVIEW_STATUSES = [
  'pending_human_review',
  'approved_for_future_apply',
  'rejected',
] as const

export type CodeCandidateReviewStatus = (typeof CODE_CANDIDATE_REVIEW_STATUSES)[number]

export const CODE_CANDIDATE_OPERATIONS = ['create', 'modify', 'delete'] as const

export type CodeCandidateOperation = (typeof CODE_CANDIDATE_OPERATIONS)[number]

export const CODE_CANDIDATE_SIDE_EFFECT_KINDS = [
  'none',
  'package_install',
  'script_execution',
  'repository_writeback',
  'commit',
  'deploy',
  'publish',
] as const

export type CodeCandidateSideEffectKind = (typeof CODE_CANDIDATE_SIDE_EFFECT_KINDS)[number]

export const CODE_GENERATION_REASON_CODES = [
  'CODEGEN_PLAN_READY',
  'CODEGEN_DISABLED',
  'CODEGEN_VALIDATION_FAILED',
  'CODEGEN_UNSAFE_PATH',
  'CODEGEN_UNSAFE_SIDE_EFFECT',
  'CODEGEN_SENSITIVE_METADATA',
  'CODEGEN_TOOL_SCOPE_TOO_BROAD',
  'CODEGEN_CONTEXT_SCOPE_MISMATCH',
  'CODEGEN_CONTEXT_TOO_BROAD',
  'CODEGEN_PROVIDER_SCHEMA_INVALID',
  'CODEGEN_TOOL_CALL_INVALID',
  'CODEGEN_TOOL_CALL_UNAUTHORIZED',
  'CODEGEN_TOOL_RESULT_CROSS_STAGE',
  'CODEGEN_STAGE_DEPENDENCY_INCOMPLETE',
  'CODEGEN_REVIEW_BLOCKED_PENDING_STAGES',
  'CODEGEN_REVIEW_READY',
] as const

export type CodeGenerationReasonCode = (typeof CODE_GENERATION_REASON_CODES)[number]

export const CODE_GENERATION_TOOL_PROVIDERS = [
  'openai_responses',
  'openai_chat_compat',
  'anthropic_messages',
] as const

export type CodeGenerationToolProvider = (typeof CODE_GENERATION_TOOL_PROVIDERS)[number]

export type CodeGenerationJsonSchema = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface CodeGenerationToolDescriptor {
  toolId: CodeGenerationToolId
  name: CodeGenerationToolId
  description: string
  inputSchema: CodeGenerationJsonSchema
  sideEffectKind: 'none'
}

const emptyInputSchema: CodeGenerationJsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}

const artifactInputSchema: CodeGenerationJsonSchema = {
  type: 'object',
  properties: {
    artifactRef: { type: 'string' },
    stageId: { type: 'string' },
  },
  additionalProperties: false,
}

const writeCandidateInputSchema: CodeGenerationJsonSchema = {
  type: 'object',
  properties: {
    artifactKind: { type: 'string' },
    summary: { type: 'string' },
    refs: { type: 'array', items: { type: 'string' } },
  },
  required: ['artifactKind', 'summary'],
  additionalProperties: false,
}

export const CODE_GENERATION_TOOL_CATALOG: Readonly<
  Record<CodeGenerationToolId, CodeGenerationToolDescriptor>
> = {
  read_blueprint: {
    toolId: 'read_blueprint',
    name: 'read_blueprint',
    description: '读取已裁剪的需求或蓝图摘要。',
    inputSchema: emptyInputSchema,
    sideEffectKind: 'none',
  },
  inspect_existing_code: {
    toolId: 'inspect_existing_code',
    name: 'inspect_existing_code',
    description: '只检查当前阶段需要的局部代码切片。',
    inputSchema: {
      type: 'object',
      properties: {
        pathHints: { type: 'array', items: { type: 'string' } },
        symbolHints: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    sideEffectKind: 'none',
  },
  read_stage_artifact: {
    toolId: 'read_stage_artifact',
    name: 'read_stage_artifact',
    description: '读取上游 Stage 的候选产物引用。',
    inputSchema: artifactInputSchema,
    sideEffectKind: 'none',
  },
  write_candidate_artifact: {
    toolId: 'write_candidate_artifact',
    name: 'write_candidate_artifact',
    description: '写入候选产物元数据，不写仓库源码。',
    inputSchema: writeCandidateInputSchema,
    sideEffectKind: 'none',
  },
  validate_schema: {
    toolId: 'validate_schema',
    name: 'validate_schema',
    description: '校验候选结构是否符合 schema。',
    inputSchema: artifactInputSchema,
    sideEffectKind: 'none',
  },
  validate_policy: {
    toolId: 'validate_policy',
    name: 'validate_policy',
    description: '校验 RBAC、组织隔离、人工确认和副作用边界。',
    inputSchema: artifactInputSchema,
    sideEffectKind: 'none',
  },
  validate_path: {
    toolId: 'validate_path',
    name: 'validate_path',
    description: '校验候选路径是否安全。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    sideEffectKind: 'none',
  },
  summarize_diff: {
    toolId: 'summarize_diff',
    name: 'summarize_diff',
    description: '汇总候选变更差异。',
    inputSchema: artifactInputSchema,
    sideEffectKind: 'none',
  },
  run_fixture_test: {
    toolId: 'run_fixture_test',
    name: 'run_fixture_test',
    description: '用 fixture 或 mock 做确定性验证。',
    inputSchema: artifactInputSchema,
    sideEffectKind: 'none',
  },
  run_static_check: {
    toolId: 'run_static_check',
    name: 'run_static_check',
    description: '执行候选静态检查或生成检查摘要。',
    inputSchema: artifactInputSchema,
    sideEffectKind: 'none',
  },
  compose_review_packet: {
    toolId: 'compose_review_packet',
    name: 'compose_review_packet',
    description: '组装给人工审查的紧凑审查包。',
    inputSchema: artifactInputSchema,
    sideEffectKind: 'none',
  },
  request_human_review: {
    toolId: 'request_human_review',
    name: 'request_human_review',
    description: '把候选包交给人工确认。',
    inputSchema: {
      type: 'object',
      properties: { bundleId: { type: 'string' } },
      required: ['bundleId'],
      additionalProperties: false,
    },
    sideEffectKind: 'none',
  },
} as const

export const CODE_GENERATION_STAGE_IDS = [
  'codegen_01_intake_normalization',
  'codegen_02_requirement_digest',
  'codegen_03_scope_boundary',
  'codegen_04_architecture_mapping',
  'codegen_05_dependency_inventory',
  'codegen_06_data_model_plan',
  'codegen_07_api_contract_plan',
  'codegen_08_route_surface_plan',
  'codegen_09_security_policy_plan',
  'codegen_10_backend_service_plan',
  'codegen_11_backend_model_candidate',
  'codegen_12_backend_migration_candidate',
  'codegen_13_backend_validator_candidate',
  'codegen_14_backend_policy_candidate',
  'codegen_15_backend_controller_candidate',
  'codegen_16_backend_route_candidate',
  'codegen_17_frontend_route_plan',
  'codegen_18_frontend_query_plan',
  'codegen_19_frontend_state_plan',
  'codegen_20_frontend_component_candidate',
  'codegen_21_frontend_form_candidate',
  'codegen_22_frontend_view_candidate',
  'codegen_23_shared_type_candidate',
  'codegen_24_integration_contract_candidate',
  'codegen_25_fixture_candidate',
  'codegen_26_unit_test_candidate',
  'codegen_27_integration_test_candidate',
  'codegen_28_e2e_test_candidate',
  'codegen_29_accessibility_check_candidate',
  'codegen_30_security_check_candidate',
  'codegen_31_format_lint_plan',
  'codegen_32_documentation_candidate',
  'codegen_33_review_packet_candidate',
  'codegen_34_human_handoff_gate',
] as const

export type CodeGenerationStageId = (typeof CODE_GENERATION_STAGE_IDS)[number]

export interface CodeGenerationStageDefinition {
  id: CodeGenerationStageId
  order: number
  phase: CodeGenerationPhase
  kind: CodeGenerationStageKind
  artifactKind: CodeGenerationArtifactKind
  localObjective: string
  allowedTools: CodeGenerationToolId[]
  contextScope: CodeGenerationContextScope
  defaultReviewRequired: boolean
  aiEligible: boolean
  dependsOn: CodeGenerationStageId[]
}

const stage = (
  order: number,
  id: CodeGenerationStageId,
  phase: CodeGenerationPhase,
  kind: CodeGenerationStageKind,
  artifactKind: CodeGenerationArtifactKind,
  localObjective: string,
  allowedTools: CodeGenerationToolId[],
  contextScope: CodeGenerationContextScope,
  dependsOn: CodeGenerationStageId[] = [],
): CodeGenerationStageDefinition => ({
  id,
  order,
  phase,
  kind,
  artifactKind,
  localObjective,
  allowedTools,
  contextScope,
  defaultReviewRequired: true,
  aiEligible: kind === 'ai_eligible' || kind === 'hybrid',
  dependsOn,
})

export const CODE_GENERATION_STAGE_CATALOG: readonly CodeGenerationStageDefinition[] = [
  stage(
    1,
    'codegen_01_intake_normalization',
    'intake',
    'deterministic',
    'requirement_digest',
    'Normalize the user request into a bounded code generation brief.',
    ['read_blueprint', 'validate_schema'],
    'blueprint_summary',
  ),
  stage(
    2,
    'codegen_02_requirement_digest',
    'intake',
    'hybrid',
    'requirement_digest',
    'Summarize only the requirements needed by the next planning stages.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_schema'],
    'selected_artifact_refs',
    ['codegen_01_intake_normalization'],
  ),
  stage(
    3,
    'codegen_03_scope_boundary',
    'intake',
    'gate',
    'review_report',
    'Reject out-of-scope side effects before code planning begins.',
    ['read_stage_artifact', 'validate_policy', 'compose_review_packet'],
    'selected_artifact_refs',
    ['codegen_02_requirement_digest'],
  ),
  stage(
    4,
    'codegen_04_architecture_mapping',
    'architecture',
    'hybrid',
    'architecture_plan',
    'Map the requested feature to existing architecture touchpoints.',
    ['inspect_existing_code', 'read_stage_artifact', 'write_candidate_artifact'],
    'local_code_slice',
    ['codegen_03_scope_boundary'],
  ),
  stage(
    5,
    'codegen_05_dependency_inventory',
    'architecture',
    'deterministic',
    'architecture_plan',
    'Identify existing dependencies without adding package installs.',
    ['inspect_existing_code', 'validate_policy'],
    'local_code_slice',
    ['codegen_04_architecture_mapping'],
  ),
  stage(
    6,
    'codegen_06_data_model_plan',
    'architecture',
    'hybrid',
    'data_model',
    'Plan data model changes as candidate metadata only.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_schema'],
    'selected_artifact_refs',
    ['codegen_05_dependency_inventory'],
  ),
  stage(
    7,
    'codegen_07_api_contract_plan',
    'architecture',
    'hybrid',
    'api_contract',
    'Plan API contract candidates while preserving /api/v1 boundaries.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_policy'],
    'selected_artifact_refs',
    ['codegen_06_data_model_plan'],
  ),
  stage(
    8,
    'codegen_08_route_surface_plan',
    'architecture',
    'deterministic',
    'route_candidate',
    'Plan route surface candidates and reject major-version expansion.',
    ['read_stage_artifact', 'validate_policy'],
    'selected_artifact_refs',
    ['codegen_07_api_contract_plan'],
  ),
  stage(
    9,
    'codegen_09_security_policy_plan',
    'architecture',
    'deterministic',
    'policy_candidate',
    'Plan RBAC, tenant, audit, and human-review policy gates.',
    ['read_stage_artifact', 'validate_policy', 'write_candidate_artifact'],
    'selected_artifact_refs',
    ['codegen_08_route_surface_plan'],
  ),
  stage(
    10,
    'codegen_10_backend_service_plan',
    'backend',
    'hybrid',
    'service_candidate',
    'Plan backend service candidate responsibilities for one local slice.',
    ['inspect_existing_code', 'read_stage_artifact', 'write_candidate_artifact'],
    'local_code_slice',
    ['codegen_09_security_policy_plan'],
  ),
  stage(
    11,
    'codegen_11_backend_model_candidate',
    'backend',
    'ai_eligible',
    'data_model',
    'Draft backend model candidate metadata for review.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_schema'],
    'selected_artifact_refs',
    ['codegen_10_backend_service_plan'],
  ),
  stage(
    12,
    'codegen_12_backend_migration_candidate',
    'backend',
    'ai_eligible',
    'migration_candidate',
    'Draft migration candidate metadata without applying migrations.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_policy'],
    'selected_artifact_refs',
    ['codegen_11_backend_model_candidate'],
  ),
  stage(
    13,
    'codegen_13_backend_validator_candidate',
    'backend',
    'ai_eligible',
    'validator_candidate',
    'Draft validator candidate metadata for the planned input shape.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_schema'],
    'selected_artifact_refs',
    ['codegen_12_backend_migration_candidate'],
  ),
  stage(
    14,
    'codegen_14_backend_policy_candidate',
    'backend',
    'ai_eligible',
    'policy_candidate',
    'Draft policy candidate metadata for RBAC and tenant isolation.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_policy'],
    'selected_artifact_refs',
    ['codegen_13_backend_validator_candidate'],
  ),
  stage(
    15,
    'codegen_15_backend_controller_candidate',
    'backend',
    'ai_eligible',
    'service_candidate',
    'Draft controller candidate metadata without adding routes yet.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_policy'],
    'selected_artifact_refs',
    ['codegen_14_backend_policy_candidate'],
  ),
  stage(
    16,
    'codegen_16_backend_route_candidate',
    'backend',
    'ai_eligible',
    'route_candidate',
    'Draft route candidate metadata for review-only application.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_policy'],
    'selected_artifact_refs',
    ['codegen_15_backend_controller_candidate'],
  ),
  stage(
    17,
    'codegen_17_frontend_route_plan',
    'frontend',
    'hybrid',
    'frontend_route_candidate',
    'Plan frontend route candidate boundaries for one screen or workflow.',
    ['inspect_existing_code', 'read_stage_artifact', 'write_candidate_artifact'],
    'local_code_slice',
    ['codegen_16_backend_route_candidate'],
  ),
  stage(
    18,
    'codegen_18_frontend_query_plan',
    'frontend',
    'hybrid',
    'component_candidate',
    'Plan TanStack Query and API client candidate usage.',
    ['inspect_existing_code', 'read_stage_artifact', 'write_candidate_artifact'],
    'local_code_slice',
    ['codegen_17_frontend_route_plan'],
  ),
  stage(
    19,
    'codegen_19_frontend_state_plan',
    'frontend',
    'hybrid',
    'state_candidate',
    'Plan local Zustand/client state candidate usage.',
    ['inspect_existing_code', 'read_stage_artifact', 'write_candidate_artifact'],
    'local_code_slice',
    ['codegen_18_frontend_query_plan'],
  ),
  stage(
    20,
    'codegen_20_frontend_component_candidate',
    'frontend',
    'ai_eligible',
    'component_candidate',
    'Draft component candidate metadata for the local UI slice.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_schema'],
    'selected_artifact_refs',
    ['codegen_19_frontend_state_plan'],
  ),
  stage(
    21,
    'codegen_21_frontend_form_candidate',
    'frontend',
    'ai_eligible',
    'component_candidate',
    'Draft form candidate metadata with validation and confirmation boundaries.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_schema'],
    'selected_artifact_refs',
    ['codegen_20_frontend_component_candidate'],
  ),
  stage(
    22,
    'codegen_22_frontend_view_candidate',
    'frontend',
    'ai_eligible',
    'component_candidate',
    'Draft view candidate metadata for review-only rendering.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_schema'],
    'selected_artifact_refs',
    ['codegen_21_frontend_form_candidate'],
  ),
  stage(
    23,
    'codegen_23_shared_type_candidate',
    'integration',
    'ai_eligible',
    'api_contract',
    'Draft shared type candidate metadata for cross-package compatibility.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_schema'],
    'selected_artifact_refs',
    ['codegen_22_frontend_view_candidate'],
  ),
  stage(
    24,
    'codegen_24_integration_contract_candidate',
    'integration',
    'hybrid',
    'integration_contract_candidate',
    'Draft integration contract candidate metadata without external calls.',
    ['read_stage_artifact', 'write_candidate_artifact', 'validate_policy'],
    'selected_artifact_refs',
    ['codegen_23_shared_type_candidate'],
  ),
  stage(
    25,
    'codegen_25_fixture_candidate',
    'quality',
    'ai_eligible',
    'test_candidate',
    'Draft fixture candidate metadata for deterministic verification.',
    ['read_stage_artifact', 'write_candidate_artifact', 'run_fixture_test'],
    'validation_feedback',
    ['codegen_24_integration_contract_candidate'],
  ),
  stage(
    26,
    'codegen_26_unit_test_candidate',
    'quality',
    'ai_eligible',
    'test_candidate',
    'Draft unit test candidate metadata for local behavior.',
    ['read_stage_artifact', 'write_candidate_artifact', 'run_fixture_test'],
    'validation_feedback',
    ['codegen_25_fixture_candidate'],
  ),
  stage(
    27,
    'codegen_27_integration_test_candidate',
    'quality',
    'ai_eligible',
    'test_candidate',
    'Draft integration test candidate metadata for service boundaries.',
    ['read_stage_artifact', 'write_candidate_artifact', 'run_fixture_test'],
    'validation_feedback',
    ['codegen_26_unit_test_candidate'],
  ),
  stage(
    28,
    'codegen_28_e2e_test_candidate',
    'quality',
    'ai_eligible',
    'test_candidate',
    'Draft E2E test candidate metadata for user-observable flow.',
    ['read_stage_artifact', 'write_candidate_artifact', 'run_fixture_test'],
    'validation_feedback',
    ['codegen_27_integration_test_candidate'],
  ),
  stage(
    29,
    'codegen_29_accessibility_check_candidate',
    'quality',
    'deterministic',
    'review_report',
    'Summarize accessibility checks for candidate UI metadata.',
    ['read_stage_artifact', 'run_static_check', 'write_candidate_artifact'],
    'validation_feedback',
    ['codegen_28_e2e_test_candidate'],
  ),
  stage(
    30,
    'codegen_30_security_check_candidate',
    'quality',
    'deterministic',
    'review_report',
    'Summarize security checks and forbidden side effects.',
    ['read_stage_artifact', 'run_static_check', 'validate_policy'],
    'validation_feedback',
    ['codegen_29_accessibility_check_candidate'],
  ),
  stage(
    31,
    'codegen_31_format_lint_plan',
    'quality',
    'deterministic',
    'config_candidate',
    'Plan formatting and lint validation commands without running package installs.',
    ['read_stage_artifact', 'run_static_check', 'write_candidate_artifact'],
    'validation_feedback',
    ['codegen_30_security_check_candidate'],
  ),
  stage(
    32,
    'codegen_32_documentation_candidate',
    'documentation',
    'ai_eligible',
    'documentation_candidate',
    'Draft documentation candidate metadata for the reviewed code bundle.',
    ['read_stage_artifact', 'write_candidate_artifact', 'summarize_diff'],
    'review_summary',
    ['codegen_31_format_lint_plan'],
  ),
  stage(
    33,
    'codegen_33_review_packet_candidate',
    'review',
    'deterministic',
    'review_report',
    'Compose a compact review packet from candidate refs and validation results.',
    ['read_stage_artifact', 'summarize_diff', 'compose_review_packet'],
    'review_summary',
    ['codegen_32_documentation_candidate'],
  ),
  stage(
    34,
    'codegen_34_human_handoff_gate',
    'review',
    'gate',
    'review_report',
    'Hand off the candidate bundle for explicit human review.',
    ['compose_review_packet', 'request_human_review'],
    'review_summary',
    ['codegen_33_review_packet_candidate'],
  ),
] as const

export interface CodeGenerationPlanStage {
  stageId: CodeGenerationStageId
  order: number
  phase: CodeGenerationPhase
  artifactKind: CodeGenerationArtifactKind
  localObjective: string
  allowedTools: CodeGenerationToolId[]
  contextScope: CodeGenerationContextScope
  dependsOn: CodeGenerationStageId[]
  requiresHumanReview: boolean
}

export interface CodeGenerationStageContextPacket {
  stageId: CodeGenerationStageId
  scope: CodeGenerationContextScope
  summary: string
  artifactRefs: string[]
  evidenceRefs: string[]
  tokenBudget: number
  data?: Record<string, unknown>
}

export interface CodeGenerationOpenAIResponsesTool {
  type: 'function'
  name: CodeGenerationToolId
  description: string
  parameters: CodeGenerationJsonSchema
  strict: true
}

export interface CodeGenerationOpenAIChatTool {
  type: 'function'
  function: {
    name: CodeGenerationToolId
    description: string
    parameters: CodeGenerationJsonSchema
  }
}

export interface CodeGenerationAnthropicTool {
  name: CodeGenerationToolId
  description: string
  input_schema: CodeGenerationJsonSchema
}

export type CodeGenerationProviderToolSchema =
  CodeGenerationOpenAIResponsesTool | CodeGenerationOpenAIChatTool | CodeGenerationAnthropicTool

export interface CodeGenerationProviderToolMetadata {
  provider: CodeGenerationToolProvider
  tools: CodeGenerationProviderToolSchema[]
  toolChoice: unknown
  parallelToolCalls: false
}

export interface CodeGenerationStageRuntimeFrame {
  contractVersion: typeof CODE_GENERATION_CONTRACT_VERSION
  runtimeSessionId: string
  provider: CodeGenerationToolProvider
  stageId: CodeGenerationStageId
  order: number
  phase: CodeGenerationPhase
  localObjective: string
  contextPacket: CodeGenerationStageContextPacket
  visibleTools: CodeGenerationToolDescriptor[]
  providerTools: CodeGenerationProviderToolMetadata
  requiresHumanReview: boolean
}

export interface CodeGenerationToolInvocation {
  provider: CodeGenerationToolProvider
  runtimeSessionId: string
  stageId: CodeGenerationStageId
  callId: string
  toolId: CodeGenerationToolId
  arguments: Record<string, unknown>
  argumentSummary: {
    byteLength: number
    fieldCount: number
  }
}

export interface CodeGenerationToolResult {
  runtimeSessionId: string
  stageId: CodeGenerationStageId
  callId: string
  toolId: CodeGenerationToolId
  ok: boolean
  artifactRefs: string[]
  summary: string
  sideEffectKind?: CodeCandidateSideEffectKind
  metadata?: Record<string, unknown>
}

export const CODE_GENERATION_MODULE_RECORD_STATUSES = ['completed'] as const

export type CodeGenerationModuleRecordStatus =
  (typeof CODE_GENERATION_MODULE_RECORD_STATUSES)[number]

export interface CodeGenerationModuleMemoryRecord {
  contractVersion: typeof CODE_GENERATION_CONTRACT_VERSION
  runtimeSessionId: string
  stageId: CodeGenerationStageId
  status: CodeGenerationModuleRecordStatus
  artifactRefs: string[]
  observationRefs: string[]
  toolCallIds: string[]
  summary: string
  completedAt: string
}

export interface CodeGenerationModuleFlowSnapshot {
  contractVersion: typeof CODE_GENERATION_CONTRACT_VERSION
  runtimeSessionId: string
  provider: CodeGenerationToolProvider
  stageCount: number
  completedStageIds: CodeGenerationStageId[]
  pendingStageIds: CodeGenerationStageId[]
  currentStageId: CodeGenerationStageId | null
  stageArtifactRefs: Partial<Record<CodeGenerationStageId, string[]>>
  observationRefs: string[]
  readyForHumanReview: boolean
  reviewGateReason: CodeGenerationReasonCode
  violations: string[]
}

export interface CodeGenerationHumanReviewPacket {
  contractVersion: typeof CODE_GENERATION_CONTRACT_VERSION
  runtimeSessionId: string
  provider: CodeGenerationToolProvider
  readyForHumanReview: true
  stageCount: number
  completedStageIds: CodeGenerationStageId[]
  stageArtifactRefs: Partial<Record<CodeGenerationStageId, string[]>>
  observationRefs: string[]
  validation: CodeCandidateBundleValidation
}

export interface CodeCandidateFileIntent {
  path: string
  operation: CodeCandidateOperation
  artifactKind: CodeGenerationArtifactKind
  contentHash?: string
  artifactRef?: string
  sideEffectKind?: CodeCandidateSideEffectKind
}

export interface CodeCandidateBundleValidation {
  ok: boolean
  reasonCodes: CodeGenerationReasonCode[]
  violations: string[]
}

export interface CodeCandidateBundleSummary {
  bundleId: string
  contractVersion: typeof CODE_GENERATION_CONTRACT_VERSION
  stageCount: number
  fileCount: number
  files: CodeCandidateFileIntent[]
  requiresHumanReview: boolean
  reviewStatus: CodeCandidateReviewStatus
  validation: CodeCandidateBundleValidation
  evidenceRefs: string[]
  metadata?: Record<string, unknown>
}

export interface CodeGenerationPlanResult {
  enabled: boolean
  reasonCode: CodeGenerationReasonCode
  stages: CodeGenerationPlanStage[]
  candidateBundle?: CodeCandidateBundleSummary
  violations: string[]
}

export const CODE_GENERATION_FORBIDDEN_METADATA_KEYS = [
  'prompt',
  'rawOutput',
  'modelOutput',
  'contextPacket',
  'secret',
  'token',
  'authorization',
  'apiKey',
] as const

const unsafeSideEffects = new Set<CodeCandidateSideEffectKind>(
  CODE_CANDIDATE_SIDE_EFFECT_KINDS.filter((kind) => kind !== 'none'),
)

export function normalizeCodeCandidatePath(
  path: string,
): { ok: true; path: string } | { ok: false; reason: string } {
  const normalized = path.replace(/\\/g, '/').trim()
  if (!normalized) return { ok: false, reason: 'empty_path' }
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    return { ok: false, reason: 'absolute_path' }
  }
  if (normalized.split('/').some((segment) => segment === '..')) {
    return { ok: false, reason: 'parent_directory_traversal' }
  }
  return { ok: true, path: normalized }
}

export function metadataContainsSensitiveField(value: unknown): {
  found: boolean
  fieldPath?: string
} {
  const stack: Array<{ value: unknown; path: string }> = [{ value, path: '$' }]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (!current.value || typeof current.value !== 'object') continue
    for (const [key, nested] of Object.entries(current.value as Record<string, unknown>)) {
      const lower = key.toLowerCase()
      const matched = CODE_GENERATION_FORBIDDEN_METADATA_KEYS.find((forbidden) =>
        lower.includes(forbidden.toLowerCase()),
      )
      if (matched) return { found: true, fieldPath: `${current.path}.${key}` }
      stack.push({ value: nested, path: `${current.path}.${key}` })
    }
  }
  return { found: false }
}

export function metadataContainsBroadContext(value: unknown): {
  found: boolean
  fieldPath?: string
} {
  const forbidden = ['allStages', 'allTools', 'fullWorkflow', 'fullHistory', 'rawPrompt']
  const stack: Array<{ value: unknown; path: string }> = [{ value, path: '$' }]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (!current.value || typeof current.value !== 'object') continue
    for (const [key, nested] of Object.entries(current.value as Record<string, unknown>)) {
      if (forbidden.some((name) => key.toLowerCase() === name.toLowerCase())) {
        return { found: true, fieldPath: `${current.path}.${key}` }
      }
      stack.push({ value: nested, path: `${current.path}.${key}` })
    }
  }
  return { found: false }
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)))
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string') {
    const parsed = JSON.parse(value || '{}') as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  }
  throw new Error('tool arguments must be a JSON object')
}

function summarizeArguments(
  args: Record<string, unknown>,
): CodeGenerationToolInvocation['argumentSummary'] {
  return {
    byteLength: JSON.stringify(args).length,
    fieldCount: Object.keys(args).length,
  }
}

export function normalizeOpenAIResponsesToolInvocation(params: {
  runtimeSessionId: string
  stageId: CodeGenerationStageId
  item: { type?: string; call_id?: string; id?: string; name?: string; arguments?: unknown }
}): CodeGenerationToolInvocation {
  if (params.item.type && params.item.type !== 'function_call') {
    throw new Error(`unsupported OpenAI Responses tool call type: ${params.item.type}`)
  }
  const toolId = String(params.item.name ?? '')
  if (!isCodeGenerationToolId(toolId)) throw new Error(`unknown tool id: ${toolId}`)
  const args = parseToolArguments(params.item.arguments ?? '{}')
  return {
    provider: 'openai_responses',
    runtimeSessionId: params.runtimeSessionId,
    stageId: params.stageId,
    callId: String(params.item.call_id ?? params.item.id ?? ''),
    toolId,
    arguments: args,
    argumentSummary: summarizeArguments(args),
  }
}

export function normalizeOpenAIChatToolInvocation(params: {
  runtimeSessionId: string
  stageId: CodeGenerationStageId
  toolCall: {
    id?: string
    type?: string
    function?: { name?: string; arguments?: unknown }
  }
}): CodeGenerationToolInvocation {
  if (params.toolCall.type && params.toolCall.type !== 'function') {
    throw new Error(`unsupported OpenAI Chat tool call type: ${params.toolCall.type}`)
  }
  const toolId = String(params.toolCall.function?.name ?? '')
  if (!isCodeGenerationToolId(toolId)) throw new Error(`unknown tool id: ${toolId}`)
  const args = parseToolArguments(params.toolCall.function?.arguments ?? '{}')
  return {
    provider: 'openai_chat_compat',
    runtimeSessionId: params.runtimeSessionId,
    stageId: params.stageId,
    callId: String(params.toolCall.id ?? ''),
    toolId,
    arguments: args,
    argumentSummary: summarizeArguments(args),
  }
}

export function normalizeAnthropicToolInvocation(params: {
  runtimeSessionId: string
  stageId: CodeGenerationStageId
  block: { type?: string; id?: string; name?: string; input?: unknown }
}): CodeGenerationToolInvocation {
  if (params.block.type && params.block.type !== 'tool_use') {
    throw new Error(`unsupported Anthropic block type: ${params.block.type}`)
  }
  const toolId = String(params.block.name ?? '')
  if (!isCodeGenerationToolId(toolId)) throw new Error(`unknown tool id: ${toolId}`)
  const args = parseToolArguments(params.block.input ?? {})
  return {
    provider: 'anthropic_messages',
    runtimeSessionId: params.runtimeSessionId,
    stageId: params.stageId,
    callId: String(params.block.id ?? ''),
    toolId,
    arguments: args,
    argumentSummary: summarizeArguments(args),
  }
}

export function validateCodeGenerationToolInvocation(
  frame: CodeGenerationStageRuntimeFrame,
  invocation: CodeGenerationToolInvocation,
  seenCallIds: readonly string[] = [],
): CodeCandidateBundleValidation {
  const violations: string[] = []
  const reasonCodes = new Set<CodeGenerationReasonCode>()

  if (!invocation.callId) {
    reasonCodes.add('CODEGEN_TOOL_CALL_INVALID')
    violations.push(`${invocation.toolId}: missing call id`)
  }
  if (seenCallIds.includes(invocation.callId)) {
    reasonCodes.add('CODEGEN_TOOL_CALL_INVALID')
    violations.push(`${invocation.toolId}: duplicate call id ${invocation.callId}`)
  }
  if (
    invocation.stageId !== frame.stageId ||
    invocation.runtimeSessionId !== frame.runtimeSessionId
  ) {
    reasonCodes.add('CODEGEN_TOOL_RESULT_CROSS_STAGE')
    violations.push(`${invocation.toolId}: invocation does not belong to active frame`)
  }
  if (!frame.visibleTools.some((tool) => tool.toolId === invocation.toolId)) {
    reasonCodes.add('CODEGEN_TOOL_CALL_UNAUTHORIZED')
    violations.push(`${invocation.toolId}: tool is not visible in ${frame.stageId}`)
  }
  const sensitive = metadataContainsSensitiveField(invocation.arguments)
  if (sensitive.found) {
    reasonCodes.add('CODEGEN_SENSITIVE_METADATA')
    violations.push(`sensitive tool argument field: ${sensitive.fieldPath}`)
  }

  return {
    ok: violations.length === 0,
    reasonCodes: violations.length === 0 ? ['CODEGEN_PLAN_READY'] : Array.from(reasonCodes),
    violations,
  }
}

export function validateCodeGenerationToolResult(
  frame: CodeGenerationStageRuntimeFrame,
  invocation: CodeGenerationToolInvocation,
  result: CodeGenerationToolResult,
): CodeCandidateBundleValidation {
  const violations: string[] = []
  const reasonCodes = new Set<CodeGenerationReasonCode>()

  if (
    result.runtimeSessionId !== frame.runtimeSessionId ||
    result.runtimeSessionId !== invocation.runtimeSessionId ||
    result.stageId !== frame.stageId ||
    result.stageId !== invocation.stageId ||
    result.callId !== invocation.callId ||
    result.toolId !== invocation.toolId
  ) {
    reasonCodes.add('CODEGEN_TOOL_RESULT_CROSS_STAGE')
    violations.push(`${result.toolId}: result identity does not match active invocation`)
  }
  const sideEffect = result.sideEffectKind ?? 'none'
  if (unsafeSideEffects.has(sideEffect)) {
    reasonCodes.add('CODEGEN_UNSAFE_SIDE_EFFECT')
    violations.push(`${result.toolId}: side effect ${sideEffect} is not allowed`)
  }
  const sensitive = metadataContainsSensitiveField(result.metadata)
  if (sensitive.found) {
    reasonCodes.add('CODEGEN_SENSITIVE_METADATA')
    violations.push(`sensitive result metadata field: ${sensitive.fieldPath}`)
  }

  return {
    ok: violations.length === 0,
    reasonCodes: violations.length === 0 ? ['CODEGEN_PLAN_READY'] : Array.from(reasonCodes),
    violations,
  }
}

export function createCodeGenerationModuleMemoryRecord(params: {
  runtimeSessionId: string
  stageId: CodeGenerationStageId
  artifactRefs?: string[]
  observationRefs?: string[]
  toolCallIds?: string[]
  summary: string
  completedAt?: string
}): CodeGenerationModuleMemoryRecord {
  return {
    contractVersion: CODE_GENERATION_CONTRACT_VERSION,
    runtimeSessionId: params.runtimeSessionId,
    stageId: params.stageId,
    status: 'completed',
    artifactRefs: uniqueStrings(params.artifactRefs ?? []),
    observationRefs: uniqueStrings(params.observationRefs ?? []),
    toolCallIds: uniqueStrings(params.toolCallIds ?? []),
    summary: params.summary,
    completedAt: params.completedAt ?? new Date().toISOString(),
  }
}

export function validateCodeGenerationModuleMemoryRecord(
  record: CodeGenerationModuleMemoryRecord,
): CodeCandidateBundleValidation {
  const violations: string[] = []
  const reasonCodes = new Set<CodeGenerationReasonCode>()

  if (record.contractVersion !== CODE_GENERATION_CONTRACT_VERSION) {
    reasonCodes.add('CODEGEN_VALIDATION_FAILED')
    violations.push(`${record.stageId}: contract version mismatch`)
  }
  if (!record.runtimeSessionId.trim()) {
    reasonCodes.add('CODEGEN_VALIDATION_FAILED')
    violations.push(`${record.stageId}: runtime session id is required`)
  }
  if (!isCodeGenerationStageId(record.stageId)) {
    reasonCodes.add('CODEGEN_VALIDATION_FAILED')
    violations.push(`${record.stageId}: unknown stage id`)
  }
  if (record.status !== 'completed') {
    reasonCodes.add('CODEGEN_VALIDATION_FAILED')
    violations.push(`${record.stageId}: unsupported module record status`)
  }
  if (!record.summary.trim()) {
    reasonCodes.add('CODEGEN_VALIDATION_FAILED')
    violations.push(`${record.stageId}: summary is required`)
  }
  const sensitive = metadataContainsSensitiveField({
    artifactRefs: record.artifactRefs,
    observationRefs: record.observationRefs,
    toolCallIds: record.toolCallIds,
  })
  if (sensitive.found) {
    reasonCodes.add('CODEGEN_SENSITIVE_METADATA')
    violations.push(`sensitive module memory field: ${sensitive.fieldPath}`)
  }

  return {
    ok: violations.length === 0,
    reasonCodes: violations.length === 0 ? ['CODEGEN_PLAN_READY'] : Array.from(reasonCodes),
    violations,
  }
}

export function buildCodeGenerationModuleFlowSnapshot(params: {
  runtimeSessionId: string
  provider: CodeGenerationToolProvider
  records?: readonly CodeGenerationModuleMemoryRecord[]
}): CodeGenerationModuleFlowSnapshot {
  const recordsByStage = new Map<CodeGenerationStageId, CodeGenerationModuleMemoryRecord>()

  for (const record of params.records ?? []) {
    if (
      record.runtimeSessionId === params.runtimeSessionId &&
      record.status === 'completed' &&
      isCodeGenerationStageId(record.stageId) &&
      !recordsByStage.has(record.stageId)
    ) {
      recordsByStage.set(record.stageId, record)
    }
  }

  const completedStageIds = CODE_GENERATION_STAGE_CATALOG.filter((stageDef) =>
    recordsByStage.has(stageDef.id),
  ).map((stageDef) => stageDef.id)
  const pendingStageIds = CODE_GENERATION_STAGE_CATALOG.filter(
    (stageDef) => !recordsByStage.has(stageDef.id),
  ).map((stageDef) => stageDef.id)
  const stageArtifactRefs: Partial<Record<CodeGenerationStageId, string[]>> = {}
  const observationRefs: string[] = []

  for (const stageId of completedStageIds) {
    const record = recordsByStage.get(stageId)
    if (!record) continue
    stageArtifactRefs[stageId] = uniqueStrings(record.artifactRefs)
    observationRefs.push(...record.observationRefs)
  }

  const readyForHumanReview = pendingStageIds.length === 0
  return {
    contractVersion: CODE_GENERATION_CONTRACT_VERSION,
    runtimeSessionId: params.runtimeSessionId,
    provider: params.provider,
    stageCount: CODE_GENERATION_STAGE_CATALOG.length,
    completedStageIds,
    pendingStageIds,
    currentStageId: pendingStageIds[0] ?? null,
    stageArtifactRefs,
    observationRefs: uniqueStrings(observationRefs),
    readyForHumanReview,
    reviewGateReason: readyForHumanReview
      ? 'CODEGEN_REVIEW_READY'
      : 'CODEGEN_REVIEW_BLOCKED_PENDING_STAGES',
    violations: readyForHumanReview
      ? []
      : [`pending code generation stages: ${pendingStageIds.join(', ')}`],
  }
}

export function validateCodeGenerationHumanReviewReadiness(
  snapshot: CodeGenerationModuleFlowSnapshot,
): CodeCandidateBundleValidation {
  if (snapshot.readyForHumanReview) {
    return {
      ok: true,
      reasonCodes: ['CODEGEN_REVIEW_READY'],
      violations: [],
    }
  }

  return {
    ok: false,
    reasonCodes: ['CODEGEN_REVIEW_BLOCKED_PENDING_STAGES'],
    violations:
      snapshot.violations.length > 0
        ? [...snapshot.violations]
        : [`pending code generation stages: ${snapshot.pendingStageIds.join(', ')}`],
  }
}

export function createCodeGenerationHumanReviewPacket(
  snapshot: CodeGenerationModuleFlowSnapshot,
): CodeGenerationHumanReviewPacket | undefined {
  const validation = validateCodeGenerationHumanReviewReadiness(snapshot)
  if (!validation.ok) return undefined

  return {
    contractVersion: CODE_GENERATION_CONTRACT_VERSION,
    runtimeSessionId: snapshot.runtimeSessionId,
    provider: snapshot.provider,
    readyForHumanReview: true,
    stageCount: snapshot.stageCount,
    completedStageIds: [...snapshot.completedStageIds],
    stageArtifactRefs: { ...snapshot.stageArtifactRefs },
    observationRefs: [...snapshot.observationRefs],
    validation,
  }
}

export function buildCodeGenerationStagePlan(): CodeGenerationPlanStage[] {
  return CODE_GENERATION_STAGE_CATALOG.map((stageDef) => ({
    stageId: stageDef.id,
    order: stageDef.order,
    phase: stageDef.phase,
    artifactKind: stageDef.artifactKind,
    localObjective: stageDef.localObjective,
    allowedTools: [...stageDef.allowedTools],
    contextScope: stageDef.contextScope,
    dependsOn: [...stageDef.dependsOn],
    requiresHumanReview: stageDef.defaultReviewRequired,
  }))
}

export function getCodeGenerationStageDefinition(
  stageId: string,
): CodeGenerationStageDefinition | undefined {
  return CODE_GENERATION_STAGE_CATALOG.find((stageDef) => stageDef.id === stageId)
}

export function isCodeGenerationToolId(value: string): value is CodeGenerationToolId {
  return (CODE_GENERATION_TOOL_IDS as readonly string[]).includes(value)
}

export function isCodeGenerationStageId(value: string): value is CodeGenerationStageId {
  return (CODE_GENERATION_STAGE_IDS as readonly string[]).includes(value)
}

export function buildCodeGenerationContextPacket(params: {
  stageId: CodeGenerationStageId
  scope?: CodeGenerationContextScope
  summary?: string
  artifactRefs?: string[]
  evidenceRefs?: string[]
  tokenBudget?: number
  data?: Record<string, unknown>
}): CodeGenerationStageContextPacket {
  const stageDef = getCodeGenerationStageDefinition(params.stageId)
  return {
    stageId: params.stageId,
    scope: params.scope ?? stageDef?.contextScope ?? 'current_stage_only',
    summary: params.summary ?? stageDef?.localObjective ?? 'stage-local context',
    artifactRefs: [...(params.artifactRefs ?? [])],
    evidenceRefs: [...(params.evidenceRefs ?? [])],
    tokenBudget: params.tokenBudget ?? 2048,
    data: params.data,
  }
}

export function buildCodeGenerationProviderToolMetadata(
  provider: CodeGenerationToolProvider,
  tools: readonly CodeGenerationToolDescriptor[],
): CodeGenerationProviderToolMetadata {
  if (provider === 'openai_responses') {
    return {
      provider,
      tools: tools.map((tool) => ({
        type: 'function',
        name: tool.toolId,
        description: tool.description,
        parameters: tool.inputSchema,
        strict: true,
      })),
      toolChoice: {
        type: 'allowed_tools',
        mode: 'auto',
        tools: tools.map((tool) => ({ type: 'function', name: tool.toolId })),
      },
      parallelToolCalls: false,
    }
  }

  if (provider === 'openai_chat_compat') {
    return {
      provider,
      tools: tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.toolId,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })),
      toolChoice: 'auto',
      parallelToolCalls: false,
    }
  }

  return {
    provider,
    tools: tools.map((tool) => ({
      name: tool.toolId,
      description: tool.description,
      input_schema: tool.inputSchema,
    })),
    toolChoice: {
      type: 'auto',
      disable_parallel_tool_use: true,
    },
    parallelToolCalls: false,
  }
}

export function buildCodeGenerationRuntimeFrame(params: {
  stageId: CodeGenerationStageId
  provider: CodeGenerationToolProvider
  runtimeSessionId: string
  contextPacket?: CodeGenerationStageContextPacket
}): CodeGenerationStageRuntimeFrame {
  const stageDef = getCodeGenerationStageDefinition(params.stageId)
  if (!stageDef) {
    throw new Error(`Unknown code generation stage: ${params.stageId}`)
  }
  const visibleTools = stageDef.allowedTools.map((toolId) => CODE_GENERATION_TOOL_CATALOG[toolId])
  return {
    contractVersion: CODE_GENERATION_CONTRACT_VERSION,
    runtimeSessionId: params.runtimeSessionId,
    provider: params.provider,
    stageId: stageDef.id,
    order: stageDef.order,
    phase: stageDef.phase,
    localObjective: stageDef.localObjective,
    contextPacket:
      params.contextPacket ??
      buildCodeGenerationContextPacket({
        stageId: stageDef.id,
        scope: stageDef.contextScope,
        summary: stageDef.localObjective,
      }),
    visibleTools,
    providerTools: buildCodeGenerationProviderToolMetadata(params.provider, visibleTools),
    requiresHumanReview: stageDef.defaultReviewRequired,
  }
}

export function validateCodeGenerationStageToolScopes(
  catalog: readonly CodeGenerationStageDefinition[] = CODE_GENERATION_STAGE_CATALOG,
): CodeCandidateBundleValidation {
  const violations: string[] = []
  for (const stageDef of catalog) {
    if (stageDef.allowedTools.length === 0) {
      violations.push(`${stageDef.id}: no allowed tools`)
    }
    if (stageDef.allowedTools.length >= CODE_GENERATION_TOOL_IDS.length) {
      violations.push(`${stageDef.id}: exposes all code generation tools`)
    }
  }
  return {
    ok: violations.length === 0,
    reasonCodes:
      violations.length === 0 ? ['CODEGEN_PLAN_READY'] : ['CODEGEN_TOOL_SCOPE_TOO_BROAD'],
    violations,
  }
}

export function validateCodeGenerationContextPacket(
  packet: CodeGenerationStageContextPacket,
  expectedStageId?: CodeGenerationStageId,
): CodeCandidateBundleValidation {
  const violations: string[] = []
  const reasonCodes = new Set<CodeGenerationReasonCode>()

  if (expectedStageId && packet.stageId !== expectedStageId) {
    reasonCodes.add('CODEGEN_CONTEXT_SCOPE_MISMATCH')
    violations.push(`${packet.stageId}: context packet does not match ${expectedStageId}`)
  }
  if (!isCodeGenerationStageId(packet.stageId)) {
    reasonCodes.add('CODEGEN_CONTEXT_SCOPE_MISMATCH')
    violations.push(`${packet.stageId}: unknown stage id`)
  }
  if (packet.tokenBudget <= 0) {
    reasonCodes.add('CODEGEN_CONTEXT_SCOPE_MISMATCH')
    violations.push(`${packet.stageId}: token budget must be positive`)
  }
  const sensitive = metadataContainsSensitiveField(packet.data)
  if (sensitive.found) {
    reasonCodes.add('CODEGEN_SENSITIVE_METADATA')
    violations.push(`sensitive context field: ${sensitive.fieldPath}`)
  }
  const broad = metadataContainsBroadContext(packet.data)
  if (broad.found) {
    reasonCodes.add('CODEGEN_CONTEXT_TOO_BROAD')
    violations.push(`broad context field: ${broad.fieldPath}`)
  }

  return {
    ok: violations.length === 0,
    reasonCodes: violations.length === 0 ? ['CODEGEN_PLAN_READY'] : Array.from(reasonCodes),
    violations,
  }
}

export function validateCodeGenerationRuntimeFrame(
  frame: CodeGenerationStageRuntimeFrame,
): CodeCandidateBundleValidation {
  const violations: string[] = []
  const reasonCodes = new Set<CodeGenerationReasonCode>()
  const stageDef = getCodeGenerationStageDefinition(frame.stageId)

  if (!stageDef) {
    reasonCodes.add('CODEGEN_CONTEXT_SCOPE_MISMATCH')
    violations.push(`${frame.stageId}: unknown stage id`)
  } else {
    const visibleIds = frame.visibleTools.map((tool) => tool.toolId)
    const expectedIds = stageDef.allowedTools
    const unexpected = visibleIds.filter((toolId) => !expectedIds.includes(toolId))
    const missing = expectedIds.filter((toolId) => !visibleIds.includes(toolId))
    if (unexpected.length > 0 || missing.length > 0) {
      reasonCodes.add('CODEGEN_TOOL_SCOPE_TOO_BROAD')
      violations.push(`${frame.stageId}: visible tools do not match catalog`)
    }
    if (visibleIds.length >= CODE_GENERATION_TOOL_IDS.length) {
      reasonCodes.add('CODEGEN_TOOL_SCOPE_TOO_BROAD')
      violations.push(`${frame.stageId}: exposes all code generation tools`)
    }
    if (frame.contextPacket.scope !== stageDef.contextScope) {
      reasonCodes.add('CODEGEN_CONTEXT_SCOPE_MISMATCH')
      violations.push(`${frame.stageId}: context scope does not match catalog`)
    }
  }

  const contextValidation = validateCodeGenerationContextPacket(frame.contextPacket, frame.stageId)
  for (const reason of contextValidation.reasonCodes) {
    if (reason !== 'CODEGEN_PLAN_READY') reasonCodes.add(reason)
  }
  violations.push(...contextValidation.violations)

  if (frame.providerTools.tools.length !== frame.visibleTools.length) {
    reasonCodes.add('CODEGEN_PROVIDER_SCHEMA_INVALID')
    violations.push(`${frame.stageId}: provider tool count does not match visible tools`)
  }
  if (frame.providerTools.parallelToolCalls !== false) {
    reasonCodes.add('CODEGEN_PROVIDER_SCHEMA_INVALID')
    violations.push(`${frame.stageId}: provider schema must disable parallel tool calls`)
  }

  return {
    ok: violations.length === 0,
    reasonCodes: violations.length === 0 ? ['CODEGEN_PLAN_READY'] : Array.from(reasonCodes),
    violations,
  }
}

export function validateCodeCandidateBundle(
  bundle: Omit<CodeCandidateBundleSummary, 'validation'>,
): CodeCandidateBundleValidation {
  const violations: string[] = []
  const reasonCodes = new Set<CodeGenerationReasonCode>()

  for (const file of bundle.files) {
    const pathResult = normalizeCodeCandidatePath(file.path)
    if (!pathResult.ok) {
      reasonCodes.add('CODEGEN_UNSAFE_PATH')
      violations.push(`${file.path}: ${pathResult.reason}`)
    }
    const sideEffect = file.sideEffectKind ?? 'none'
    if (unsafeSideEffects.has(sideEffect)) {
      reasonCodes.add('CODEGEN_UNSAFE_SIDE_EFFECT')
      violations.push(`${file.path}: side effect ${sideEffect} is not allowed`)
    }
  }

  const sensitive = metadataContainsSensitiveField(bundle.metadata)
  if (sensitive.found) {
    reasonCodes.add('CODEGEN_SENSITIVE_METADATA')
    violations.push(`sensitive metadata field: ${sensitive.fieldPath}`)
  }

  return {
    ok: violations.length === 0,
    reasonCodes: violations.length === 0 ? ['CODEGEN_PLAN_READY'] : Array.from(reasonCodes),
    violations,
  }
}

export function createDisabledCodeGenerationPlan(
  reason = 'code generation feature disabled',
): CodeGenerationPlanResult {
  return {
    enabled: false,
    reasonCode: 'CODEGEN_DISABLED',
    stages: [],
    violations: [reason],
  }
}

export function createCodeCandidateBundleSummary(
  params: Omit<
    CodeCandidateBundleSummary,
    'contractVersion' | 'stageCount' | 'fileCount' | 'validation'
  >,
): CodeCandidateBundleSummary {
  const base = {
    ...params,
    contractVersion: CODE_GENERATION_CONTRACT_VERSION,
    stageCount: CODE_GENERATION_STAGE_CATALOG.length,
    fileCount: params.files.length,
  }
  return {
    ...base,
    validation: validateCodeCandidateBundle(base),
  }
}
