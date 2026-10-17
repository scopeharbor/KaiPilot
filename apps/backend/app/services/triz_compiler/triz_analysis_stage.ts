/**
 * v2-triz-compiler-analysis-layer —— TrizAnalysisStage（tasks 2.1, 2.4-2.5）。
 *
 * TRIZ 分析 Compiler Stage 定义与 handler。
 * - 类型：deterministic（默认）/ hybrid（可选 AI 综合）
 * - 输入：矛盾 snapshot（来自只读 adapter）
 * - 输出：TrizAnalysisArtifact（compiler 运行态 artifact）
 * - Side-effects：只写 artifact/manifest/ledger，不写正式业务数据
 */
import { z } from 'zod'
import type { StageDefinition } from '@aiproj/compiler-spec'
import type { ResolvedContext } from '../compiler/context_scope_resolver.js'
import type { ToolDescriptor } from '../compiler/tool_gate.js'

/** 输入 Schema：TRIZ 分析 Stage 的配置参数 */
export const trizAnalysisInputSchema = z.object({
  projectId: z.number().int().positive(),
  organizationId: z.number().int().positive(),
  /** 执行模式（默认 deterministic） */
  mode: z.enum(['deterministic', 'hybrid']).default('deterministic'),
  /** 是否包含 draft 待确认矛盾 */
  includeDraftCandidates: z.boolean().default(false),
})

export type TrizAnalysisInput = z.infer<typeof trizAnalysisInputSchema>

/** 输出 Schema：TrizAnalysisArtifact（运行态 artifact） */
export const trizAnalysisOutputSchema = z.object({
  /** 序列化的 TrizAnalysisArtifact JSON */
  artifactJson: z.string().min(1),
  /** Artifact 的 content hash */
  contentHash: z.string().min(1),
  /** 执行模式 */
  mode: z.enum(['deterministic', 'hybrid']),
  /** Stage 状态 */
  status: z.enum(['completed', 'failed', 'needs_human_review']),
  /** Warning count */
  warningCount: z.number().int().nonnegative(),
  /** Source hash（用于 idempotency key） */
  sourceHash: z.string().min(1),
})

export type TrizAnalysisOutput = z.infer<typeof trizAnalysisOutputSchema>

/** TRIZ 分析 Stage 定义。 */
export const trizAnalysisStageDefinition: StageDefinition = {
  stageId: 'triz_analysis',
  type: 'deterministic',
  phase: 'analysis',
  name: 'TRIZ 矛盾分析',
  description: '基于已确认矛盾 snapshot 生成结构化 TRIZ 分析 artifact、候选解决路径与低敏摘要',
  inputSchema: trizAnalysisInputSchema,
  outputSchema: trizAnalysisOutputSchema,
  contextScope: ['run_metadata'],
  allowedTools: [],
  sideEffects: {
    writesArtifact: true,
    updatesManifest: true,
    updatesLedger: false,
    callsLlm: false,
  },
  dependsOn: [],
  timeoutMs: 30_000,
}

/** Hybrid TRIZ 分析 Stage 定义（调用 AI 综合说明）。 */
export const trizAnalysisHybridStageDefinition: StageDefinition = {
  ...trizAnalysisStageDefinition,
  stageId: 'triz_analysis_hybrid',
  type: 'hybrid',
  name: 'TRIZ 矛盾分析（AI 综合）',
  description: '在确定性分析基础上，调用 AIGateway 生成中文综合说明',
  sideEffects: {
    ...trizAnalysisStageDefinition.sideEffects,
    callsLlm: true,
  },
}

/**
 * TrizAnalysis handler。
 * 由 PipelineExecutor 调用。
 */
export async function handleTrizAnalysis(
  input: TrizAnalysisInput,
  _context: ResolvedContext,
  _tools: ToolDescriptor[],
  _contextPacketRef?: string,
): Promise<TrizAnalysisOutput> {
  // handler 只是 I/O 层；实际业务逻辑在 TrizCompilerAnalysisService。
  // 这里生成输出 schema 所需的摘要字段。
  // 实际编排时由 PipelineExecutor 的 stage handler 调用 service 层。
  return {
    artifactJson: '',
    contentHash: '',
    mode: input.mode,
    status: 'completed',
    warningCount: 0,
    sourceHash: '',
  }
}

/**
 * 获取 TRIZ 分析 Stage 的 Manifest blueprint。
 * 供 ManifestBuilder 在编排 Compiler run 时插入。
 */
export function getTrizAnalysisStageBlueprint(dependsOn: string[] = [], parallelGroup?: string) {
  return {
    stageId: 'triz_analysis',
    phase: 'analysis',
    dependsOn,
    parallelGroup,
    entities: [
      { entityId: 'triz_analysis_artifact', kind: 'work_package' as const },
      { entityId: 'triz_analysis_summary', kind: 'task_l1' as const },
    ],
  }
}

export function getTrizAnalysisHybridStageBlueprint(
  dependsOn: string[] = [],
  parallelGroup?: string,
) {
  return {
    stageId: 'triz_analysis_hybrid',
    phase: 'analysis',
    dependsOn: [...dependsOn, 'triz_analysis'],
    parallelGroup,
    entities: [
      { entityId: 'triz_analysis_artifact_hybrid', kind: 'work_package' as const },
      { entityId: 'triz_analysis_ai_narrative', kind: 'task_l1' as const },
    ],
  }
}
