/**
 * v2-project-compiler-foundation —— DagStubStage（tasks 7.3）。
 *
 * 类型：deterministic
 * 输入：ParsedIntent 与最小蓝图
 * 输出：DAG 引用检查结果（最小 DAG/引用检查挂点）
 * 只演示引用完整性与环检测挂点，不实现 CPM/关键路径/排程算法。
 */
import { z } from 'zod'
import { parsedIntentSchema } from '@aiproj/compiler-spec'
import type { StageDefinition } from '@aiproj/compiler-spec'
import type { ResolvedContext } from '../context_scope_resolver.js'
import type { ToolDescriptor } from '../tool_gate.js'
import { LevelValidator } from '../level_validator.js'

/** 输入 Schema。 */
export const dagStubInputSchema = z.object({
  parsedIntent: parsedIntentSchema,
})

export type DagStubInput = z.infer<typeof dagStubInputSchema>

/** DAG 检查结果。 */
export interface DagCheckResult {
  /** 是否通过引用完整性检查。 */
  passed: boolean
  /** 引用的实体 ID 列表（Foundation 阶段为空，由后续 change 填充）。 */
  entityIds: string[]
  /** 依赖关系。 */
  dependencies: Array<{ from: string; to: string }>
  /** 校验发现的错误。 */
  errors: Array<{ path: string; message: string; code: string }>
  /** 检查时间戳。 */
  checkedAt: string
}

export const dagCheckResultSchema = z.object({
  passed: z.boolean(),
  entityIds: z.array(z.string()),
  dependencies: z.array(z.object({ from: z.string(), to: z.string() })),
  errors: z.array(z.object({ path: z.string(), message: z.string(), code: z.string() })),
  checkedAt: z.string().datetime(),
})

/** DagStub Stage 定义。 */
export const dagStubDefinition: StageDefinition = {
  stageId: 'dag_stub',
  type: 'deterministic',
  phase: 'analysis',
  name: 'DAG 存根',
  description: '演示引用完整性与环检测挂点，不实现真实排程算法',
  inputSchema: dagStubInputSchema,
  outputSchema: dagCheckResultSchema,
  contextScope: ['stage_outputs', 'blueprint'],
  allowedTools: [],
  sideEffects: {
    writesArtifact: true,
    updatesManifest: true,
    updatesLedger: false,
    callsLlm: false,
  },
  dependsOn: ['intent_parsing'],
  timeoutMs: 30_000,
}

/**
 * DagStub handler。
 * 演示引用完整性与环检测挂点。
 * Foundation 阶段：无真实实体关联，只返回空检查结果。
 */
export async function handleDagStub(
  _input: DagStubInput,
  _context: ResolvedContext,
  _tools: ToolDescriptor[],
): Promise<DagCheckResult> {
  // Foundation 阶段无真实实体填充，仅演示框架集成
  const emptyEntityIds = new Set<string>()
  const emptyDeps = new Map<string, string[]>()

  const validator = new LevelValidator()
  const result = validator.level1({
    entityIds: emptyEntityIds,
    dependencies: emptyDeps,
  })

  return {
    passed: result.passed,
    entityIds: [],
    dependencies: [],
    errors: result.errors,
    checkedAt: new Date().toISOString(),
  }
}
