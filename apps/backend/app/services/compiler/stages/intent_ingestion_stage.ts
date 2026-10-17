/**
 * v2-project-compiler-foundation —— IntentIngestionStage（tasks 7.1）。
 *
 * 类型：deterministic
 * 输入：用户原始项目描述
 * 输出：RawIntent（结构化意图元数据）
 * 行为：trim、基础长度/空值校验、记录语言/时间戳等最小元数据
 * 模型调用：0
 */
import { z } from 'zod'
import { rawIntentSchema, type RawIntent } from '@aiproj/compiler-spec'
import type { StageDefinition } from '@aiproj/compiler-spec'
import type { ResolvedContext } from '../context_scope_resolver.js'
import type { ToolDescriptor } from '../tool_gate.js'

/** 输入 Schema：用户原始输入。 */
export const intentIngestionInputSchema = z.object({
  userInput: z.object({
    text: z.string().min(1).max(10000),
  }),
})

export type IntentIngestionInput = z.infer<typeof intentIngestionInputSchema>

/** 输出 Schema：RawIntent。 */
export const intentIngestionOutputSchema = rawIntentSchema

/** IntentIngestion Stage 定义。 */
export const intentIngestionDefinition: StageDefinition = {
  stageId: 'intent_ingestion',
  type: 'deterministic',
  phase: 'intake',
  name: '意图摄入',
  description: '接收用户原始项目描述，执行基本清洗与元数据提取',
  inputSchema: intentIngestionInputSchema,
  outputSchema: intentIngestionOutputSchema,
  contextScope: ['user_input_only'],
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

/**
 * IntentIngestion handler。
 * 执行 trim、基础校验、记录语言/时间戳。
 */
export async function handleIntentIngestion(
  input: IntentIngestionInput,
  _context: ResolvedContext,
  _tools: ToolDescriptor[],
): Promise<RawIntent> {
  const text = input.userInput.text.trim()

  return {
    text,
    detectedLanguage: detectLanguage(text),
    receivedAt: new Date().toISOString(),
  }
}

/**
 * 基础语言检测（仅按字符范围判断，不做 NLP）。
 * Foundation 阶段以中文为默认，检测非 ASCII 字符决定。
 */
function detectLanguage(text: string): string {
  // 简单启发式：如果包含 CJK 字符则标记为 zh-CN
  const cjkPattern = /[一-鿿㐀-䶿]/
  return cjkPattern.test(text) ? 'zh-CN' : 'en'
}
