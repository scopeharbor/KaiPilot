import { describe, expect, it } from 'vitest'
import {
  CODE_GENERATION_STAGE_CATALOG,
  type CodeGenerationToolResult,
} from '@aiproj/types/compiler-code-generation'
import { CodeGenerationStageRuntime } from '../../app/services/compiler/code-generation/index.js'

describe('CodeGenerationStageRuntime', () => {
  it('builds an isolated runtime frame for every catalog stage', () => {
    const runtime = new CodeGenerationStageRuntime()
    const frames = runtime.buildAllFrames({
      provider: 'openai_responses',
      runtimeSessionIdPrefix: 'run-fixture',
    })

    expect(frames).toHaveLength(34)
    expect(frames).toHaveLength(CODE_GENERATION_STAGE_CATALOG.length)
    expect(frames.every((frame) => runtime.validateFrame(frame).ok)).toBe(true)
    expect(new Set(frames.map((frame) => frame.runtimeSessionId)).size).toBe(34)
    expect(frames.every((frame) => frame.visibleTools.length < 12)).toBe(true)
  })

  it('derives provider-native schemas and disables parallel tool calls', () => {
    const runtime = new CodeGenerationStageRuntime()
    const stageId = 'codegen_04_architecture_mapping'
    const responses = runtime.buildFrame({
      stageId,
      provider: 'openai_responses',
      runtimeSessionId: 'responses-runtime',
    })
    const chat = runtime.buildFrame({
      stageId,
      provider: 'openai_chat_compat',
      runtimeSessionId: 'chat-runtime',
    })
    const anthropic = runtime.buildFrame({
      stageId,
      provider: 'anthropic_messages',
      runtimeSessionId: 'anthropic-runtime',
    })

    expect(responses.providerTools.parallelToolCalls).toBe(false)
    expect(responses.providerTools.toolChoice).toMatchObject({
      type: 'allowed_tools',
      mode: 'auto',
    })
    expect(chat.providerTools.parallelToolCalls).toBe(false)
    expect(chat.providerTools.tools[0]).toHaveProperty('function.parameters')
    expect(anthropic.providerTools.parallelToolCalls).toBe(false)
    expect(anthropic.providerTools.toolChoice).toMatchObject({
      disable_parallel_tool_use: true,
    })
    expect(anthropic.providerTools.tools[0]).toHaveProperty('input_schema')
  })

  it('rejects broad context packets before a stage can run', () => {
    const runtime = new CodeGenerationStageRuntime()
    const frame = runtime.buildFrame({
      stageId: 'codegen_10_backend_service_plan',
      provider: 'openai_responses',
      runtimeSessionId: 'broad-context-runtime',
      context: {
        data: {
          fullWorkflow: ['codegen_01_intake_normalization', 'codegen_34_human_handoff_gate'],
        },
      },
    })

    const validation = runtime.validateFrame(frame)
    expect(validation.ok).toBe(false)
    expect(validation.reasonCodes).toContain('CODEGEN_CONTEXT_TOO_BROAD')
  })

  it('normalizes provider tool calls and rejects tools outside the active stage', () => {
    const runtime = new CodeGenerationStageRuntime()
    const frame = runtime.buildFrame({
      stageId: 'codegen_04_architecture_mapping',
      provider: 'openai_responses',
      runtimeSessionId: 'tool-runtime',
    })

    const allowed = runtime.normalizeInvocation(frame, {
      provider: 'openai_responses',
      item: {
        type: 'function_call',
        call_id: 'call-1',
        name: 'inspect_existing_code',
        arguments: JSON.stringify({ pathHints: ['apps/backend/app/services/compiler'] }),
      },
    })
    const forbidden = runtime.normalizeInvocation(frame, {
      provider: 'openai_responses',
      item: {
        type: 'function_call',
        call_id: 'call-2',
        name: 'request_human_review',
        arguments: JSON.stringify({ bundleId: 'bundle-forbidden' }),
      },
    })

    expect(allowed.validation.ok).toBe(true)
    expect(allowed.invocation).toMatchObject({
      provider: 'openai_responses',
      runtimeSessionId: 'tool-runtime',
      stageId: 'codegen_04_architecture_mapping',
      toolId: 'inspect_existing_code',
    })
    expect(forbidden.validation.ok).toBe(false)
    expect(forbidden.validation.reasonCodes).toContain('CODEGEN_TOOL_CALL_UNAUTHORIZED')
  })

  it('rejects malformed calls, provider mixing, duplicates, and cross-stage results', () => {
    const runtime = new CodeGenerationStageRuntime()
    const frame = runtime.buildFrame({
      stageId: 'codegen_34_human_handoff_gate',
      provider: 'anthropic_messages',
      runtimeSessionId: 'handoff-runtime',
    })
    const providerMismatch = runtime.normalizeInvocation(frame, {
      provider: 'openai_responses',
      item: {
        type: 'function_call',
        call_id: 'call-provider',
        name: 'request_human_review',
        arguments: '{}',
      },
    })
    const malformed = runtime.normalizeInvocation(frame, {
      provider: 'anthropic_messages',
      block: {
        type: 'tool_use',
        id: 'call-bad-json',
        name: 'request_human_review',
        input: 'not-json',
      },
    })
    const invocation = runtime.normalizeInvocation(frame, {
      provider: 'anthropic_messages',
      block: {
        type: 'tool_use',
        id: 'call-review',
        name: 'request_human_review',
        input: { bundleId: 'bundle-review' },
      },
    })
    const duplicate = runtime.normalizeInvocation(
      frame,
      {
        provider: 'anthropic_messages',
        block: {
          type: 'tool_use',
          id: 'call-review',
          name: 'request_human_review',
          input: { bundleId: 'bundle-review' },
        },
      },
      ['call-review'],
    )
    const result: CodeGenerationToolResult = {
      runtimeSessionId: 'other-runtime',
      stageId: 'codegen_34_human_handoff_gate',
      callId: 'call-review',
      toolId: 'request_human_review',
      ok: true,
      artifactRefs: ['review:bundle-review'],
      summary: 'review requested',
      sideEffectKind: 'none',
    }

    expect(providerMismatch.validation.reasonCodes).toContain('CODEGEN_TOOL_CALL_INVALID')
    expect(malformed.validation.reasonCodes).toContain('CODEGEN_TOOL_CALL_INVALID')
    expect(invocation.validation.ok).toBe(true)
    expect(duplicate.validation.reasonCodes).toContain('CODEGEN_TOOL_CALL_INVALID')
    expect(runtime.validateResult(frame, invocation.invocation!, result).reasonCodes).toContain(
      'CODEGEN_TOOL_RESULT_CROSS_STAGE',
    )
  })

  it('returns low-sensitive runtime summaries', () => {
    const runtime = new CodeGenerationStageRuntime()
    const frame = runtime.buildFrame({
      stageId: 'codegen_18_frontend_query_plan',
      provider: 'openai_chat_compat',
      runtimeSessionId: 'summary-runtime',
      context: { data: { artifact: 'artifact:query-plan' } },
    })
    const summary = runtime.summarizeFrame(frame)
    const serialized = JSON.stringify(summary)

    expect(summary.visibleToolIds).toEqual([
      'inspect_existing_code',
      'read_stage_artifact',
      'write_candidate_artifact',
    ])
    expect(summary.parallelToolCalls).toBe(false)
    expect(serialized).not.toContain('artifact:query-plan')
    expect(serialized).not.toContain('providerTools')
  })
})
