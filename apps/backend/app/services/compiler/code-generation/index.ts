export {
  CodeGenerationPlanner,
  createCodeGenerationPlanner,
  getCodeGenerationCatalogSize,
  type CodeGenerationEvidenceSummary,
  type CodeGenerationPlannerInput,
} from './code_generation_planner.js'
export {
  CodeGenerationStageRuntime,
  createCodeGenerationStageRuntime,
  type CodeGenerationInvocationNormalizationResult,
  type CodeGenerationRuntimeContextInput,
  type CodeGenerationRuntimeFrameInput,
  type CodeGenerationRuntimeFrameSummary,
  type ProviderToolCallInput,
} from './code_generation_stage_runtime.js'
export {
  CodeGenerationModuleFlowService,
  InMemoryCodeGenerationModuleMemory,
  createCodeGenerationModuleFlowService,
  type CodeGenerationModuleFlowInput,
  type CodeGenerationModuleMemoryPort,
  type CodeGenerationReviewGateResult,
  type CodeGenerationStageCompletionInput,
  type CodeGenerationStageCompletionResult,
} from './code_generation_module_flow.js'
// 仅导出**不依赖 AdonisJS 运行时**的构件：本 barrel 被 Vitest 纯逻辑套件直接导入，
// 一旦混入 Lucid 模型或 app 服务，纯逻辑测试会在 import 阶段崩溃。
// DB 适配器与 Runner 请分别从 codegen_module_memory_repository.js /
// codegen_candidate_run_service.js 直接导入。
export {
  CodegenFixtureProvider,
  createCodegenFixtureProvider,
  type CodegenCandidateProvider,
} from './codegen_fixture_provider.js'
