/**
 * v2-project-compiler-foundation —— IntentParsingStage（tasks 7.2）。
 *
 * 类型：llm
 * 输入：RawIntent
 * 输出：ParsedIntent
 * 必须经 V1 AIGateway resolver/gateway 公共能力调用
 * 测试中 mock AIGateway 返回结构化 ParsedIntent
 * 不允许 HTTP 直连模型端点
 */
import { z } from 'zod'
import { parsedIntentSchema, rawIntentSchema, type ParsedIntent } from '@aiproj/compiler-spec'
import type { StageDefinition } from '@aiproj/compiler-spec'
import type { ResolvedContext } from '../context_scope_resolver.js'
import type { ToolDescriptor } from '../tool_gate.js'

/** 输入 Schema。 */
export const intentParsingInputSchema = z.object({
  rawIntent: rawIntentSchema,
})

export type IntentParsingInput = z.infer<typeof intentParsingInputSchema>

/** 输出 Schema。 */
export const intentParsingOutputSchema = parsedIntentSchema

/** IntentParsing Stage 定义。 */
export const intentParsingDefinition: StageDefinition = {
  stageId: 'intent_parsing',
  type: 'llm',
  phase: 'understanding',
  name: '意图解析',
  description: '经 AIGateway 调用 LLM 解析用户意图为结构化 ParsedIntent',
  inputSchema: intentParsingInputSchema,
  outputSchema: intentParsingOutputSchema,
  contextScope: ['user_input_only', 'run_metadata'],
  allowedTools: [],
  sideEffects: {
    writesArtifact: true,
    updatesManifest: true,
    updatesLedger: true,
    callsLlm: true,
  },
  dependsOn: ['intent_ingestion'],
  timeoutMs: 120_000,
}

/**
 * IntentParsing handler（mock 版本，用于测试）。
 * 真实运行时通过 AIGateway 调用 LLM，本 mock 返回结构化占位结果。
 *
 * ⚠️ 真实集成时替换为 AIGateway.generate() 调用。
 */
export async function handleIntentParsingMock(
  input: IntentParsingInput,
  _context: ResolvedContext,
  _tools: ToolDescriptor[],
): Promise<ParsedIntent> {
  const raw = input.rawIntent

  return {
    projectName: extractProjectName(raw.text),
    projectType: 'software',
    summary: raw.text.slice(0, 200),
    objectives: [],
    scope: '',
    constraints: [],
    stakeholders: [],
    priority: 'medium',
  }
}

/**
 * 从文本中提取项目名（简单启发式，mock 用）。
 * 取第一行或第一个句号前的内容。
 */
function extractProjectName(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? ''
  const firstSentence = firstLine.split(/[。！？.!?]/)[0]?.trim() ?? ''
  if (firstSentence.length > 100) return firstSentence.slice(0, 100)
  if (firstSentence.length === 0) return '未命名项目'
  return firstSentence
}
