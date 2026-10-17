/**
 * v3-codegen-34-stage-candidate-runtime-execution —— Fixture provider 纯逻辑测试。
 *
 * 覆盖 tasks 4.5 / 4.6：三种 provider 原生形状经归一化后等价、工具永远来自
 * 当前 frame 的可见工具、结果零副作用且不含敏感字段。
 *
 * 由 Vitest 运行（见 tests/bootstrap.ts 的 exclude glob）。
 */
import { describe, expect, it } from 'vitest'
import {
  CODE_GENERATION_FORBIDDEN_METADATA_KEYS,
  CODE_GENERATION_STAGE_CATALOG,
  type CodeGenerationToolProvider,
} from '@aiproj/types/compiler-code-generation'
import {
  CodeGenerationStageRuntime,
  CodegenFixtureProvider,
} from '../../app/services/compiler/code-generation/index.js'

const PROVIDERS: CodeGenerationToolProvider[] = [
  'openai_responses',
  'openai_chat_compat',
  'anthropic_messages',
]

const runtime = new CodeGenerationStageRuntime()
const provider = new CodegenFixtureProvider()

function frameFor(stageId: string, toolProvider: CodeGenerationToolProvider) {
  return runtime.buildFrame({
    stageId: stageId as never,
    provider: toolProvider,
    runtimeSessionId: 'fixture-session',
  })
}

describe('CodegenFixtureProvider', () => {
  it('produces a normalizable tool call for every stage under every provider', () => {
    for (const toolProvider of PROVIDERS) {
      for (const stageDef of CODE_GENERATION_STAGE_CATALOG) {
        const frame = frameFor(stageDef.id, toolProvider)
        const raw = provider.produceRawToolCall(frame)
        const normalized = runtime.normalizeInvocation(frame, raw)

        expect(normalized.validation.ok, `${stageDef.id}/${toolProvider}`).toBe(true)
        expect(normalized.invocation?.stageId).toBe(stageDef.id)
        // 工具必须来自该 stage 的可见工具，绝不来自 catalog 全集
        expect(stageDef.allowedTools).toContain(normalized.invocation?.toolId)
      }
    }
  })

  it('normalizes all three provider shapes to an equivalent invocation', () => {
    const stageId = 'codegen_01_intake_normalization'
    const invocations = PROVIDERS.map((toolProvider) => {
      const frame = frameFor(stageId, toolProvider)
      const normalized = runtime.normalizeInvocation(frame, provider.produceRawToolCall(frame))
      expect(normalized.validation.ok).toBe(true)
      return normalized.invocation!
    })

    const [first, ...rest] = invocations
    for (const invocation of rest) {
      expect(invocation.toolId).toBe(first.toolId)
      expect(invocation.stageId).toBe(first.stageId)
      expect(invocation.callId).toBe(first.callId)
      expect(invocation.arguments).toEqual(first.arguments)
    }
    // provider 字段本身必须保留各自身份
    expect(invocations.map((i) => i.provider)).toEqual(PROVIDERS)
  })

  it('never selects a tool outside the frame visible tools', () => {
    for (const stageDef of CODE_GENERATION_STAGE_CATALOG) {
      const frame = frameFor(stageDef.id, 'anthropic_messages')
      const selected = provider.selectToolId(frame)
      expect(frame.visibleTools.map((tool) => tool.toolId)).toContain(selected)
    }
  })

  it('produces candidate-only results with no side effect and no sensitive fields', () => {
    for (const stageDef of CODE_GENERATION_STAGE_CATALOG) {
      const frame = frameFor(stageDef.id, 'openai_responses')
      const normalized = runtime.normalizeInvocation(frame, provider.produceRawToolCall(frame))
      const result = provider.produceToolResult(frame, normalized.invocation!)

      expect(result.sideEffectKind).toBe('none')
      expect(result.artifactRefs.every((ref) => ref.startsWith('codegen-candidate://'))).toBe(true)

      const serialized = JSON.stringify(result).toLowerCase()
      for (const forbidden of CODE_GENERATION_FORBIDDEN_METADATA_KEYS) {
        expect(serialized.includes(`"${forbidden.toLowerCase()}"`)).toBe(false)
      }
      // 结果必须能通过契约校验
      expect(runtime.validateResult(frame, normalized.invocation!, result).ok).toBe(true)
    }
  })

  it('rejects a provider shape that does not match the active frame', () => {
    const frame = frameFor('codegen_01_intake_normalization', 'openai_responses')
    const anthropicFrame = frameFor('codegen_01_intake_normalization', 'anthropic_messages')
    const mismatched = provider.produceRawToolCall(anthropicFrame)

    const normalized = runtime.normalizeInvocation(frame, mismatched)
    expect(normalized.validation.ok).toBe(false)
    expect(normalized.validation.reasonCodes).toContain('CODEGEN_TOOL_CALL_INVALID')
  })
})
