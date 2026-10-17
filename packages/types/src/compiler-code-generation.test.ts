import { describe, expect, it } from 'vitest'
import {
  CODE_GENERATION_STAGE_CATALOG,
  CODE_GENERATION_STAGE_IDS,
  CODE_GENERATION_TOOL_IDS,
  buildCodeGenerationContextPacket,
  buildCodeGenerationRuntimeFrame,
  buildCodeGenerationStagePlan,
  buildCodeGenerationModuleFlowSnapshot,
  createCodeCandidateBundleSummary,
  createCodeGenerationHumanReviewPacket,
  createCodeGenerationModuleMemoryRecord,
  createDisabledCodeGenerationPlan,
  metadataContainsSensitiveField,
  normalizeCodeCandidatePath,
  normalizeAnthropicToolInvocation,
  normalizeOpenAIChatToolInvocation,
  normalizeOpenAIResponsesToolInvocation,
  validateCodeCandidateBundle,
  validateCodeGenerationContextPacket,
  validateCodeGenerationRuntimeFrame,
  validateCodeGenerationHumanReviewReadiness,
  validateCodeGenerationStageToolScopes,
  validateCodeGenerationToolInvocation,
  validateCodeGenerationToolResult,
} from './compiler-code-generation.js'

describe('compiler 34-stage code generation contract', () => {
  it('defines exactly 34 unique ordered stages', () => {
    expect(CODE_GENERATION_STAGE_CATALOG).toHaveLength(34)
    expect(CODE_GENERATION_STAGE_IDS).toHaveLength(34)
    expect(new Set(CODE_GENERATION_STAGE_IDS).size).toBe(34)
    expect(CODE_GENERATION_STAGE_CATALOG.map((stage) => stage.order)).toEqual(
      Array.from({ length: 34 }, (_, index) => index + 1),
    )
  })

  it('keeps stage metadata stable, local, and review-gated', () => {
    const plan = buildCodeGenerationStagePlan()

    expect(plan).toHaveLength(34)
    expect(plan[0]).toMatchObject({
      stageId: 'codegen_01_intake_normalization',
      phase: 'intake',
      requiresHumanReview: true,
    })
    expect(plan[33]).toMatchObject({
      stageId: 'codegen_34_human_handoff_gate',
      phase: 'review',
      requiresHumanReview: true,
    })
    expect(plan.every((stage) => stage.requiresHumanReview)).toBe(true)
    expect(plan.every((stage) => stage.allowedTools.length > 0)).toBe(true)
    expect(plan.every((stage) => stage.allowedTools.length < 12)).toBe(true)
    expect(plan.every((stage) => stage.localObjective.length > 12)).toBe(true)
  })

  it('rejects catalog entries that expose every tool to a stage', () => {
    expect(validateCodeGenerationStageToolScopes().ok).toBe(true)

    const unsafeCatalog = [
      {
        ...CODE_GENERATION_STAGE_CATALOG[0],
        allowedTools: [...CODE_GENERATION_TOOL_IDS],
      },
    ]

    const validation = validateCodeGenerationStageToolScopes(unsafeCatalog)

    expect(validation.ok).toBe(false)
    expect(validation.reasonCodes).toEqual(['CODEGEN_TOOL_SCOPE_TOO_BROAD'])
  })

  it('normalizes safe candidate paths and rejects unsafe paths', () => {
    expect(normalizeCodeCandidatePath('apps/frontend/app/demo/page.tsx')).toEqual({
      ok: true,
      path: 'apps/frontend/app/demo/page.tsx',
    })
    expect(normalizeCodeCandidatePath('C:/repo/package.json')).toEqual({
      ok: false,
      reason: 'absolute_path',
    })
    expect(normalizeCodeCandidatePath('../package.json')).toEqual({
      ok: false,
      reason: 'parent_directory_traversal',
    })
  })

  it('creates candidate bundle summaries with hashes and human review state', () => {
    const bundle = createCodeCandidateBundleSummary({
      bundleId: 'bundle_fixture_001',
      files: [
        {
          path: 'apps/frontend/app/demo/page.tsx',
          operation: 'create',
          artifactKind: 'frontend_route_candidate',
          contentHash: 'sha256:abc',
          sideEffectKind: 'none',
        },
      ],
      requiresHumanReview: true,
      reviewStatus: 'pending_human_review',
      evidenceRefs: ['ev-codegen-fixture'],
      metadata: { source: 'fixture' },
    })

    expect(bundle.contractVersion).toBe('1.0')
    expect(bundle.stageCount).toBe(34)
    expect(bundle.fileCount).toBe(1)
    expect(bundle.validation.ok).toBe(true)
    expect(bundle.reviewStatus).toBe('pending_human_review')
  })

  it('rejects side effects and sensitive exposed metadata', () => {
    const validation = validateCodeCandidateBundle({
      bundleId: 'bundle_bad',
      contractVersion: '1.0',
      stageCount: 34,
      fileCount: 1,
      files: [
        {
          path: 'package.json',
          operation: 'modify',
          artifactKind: 'config_candidate',
          sideEffectKind: 'package_install',
        },
      ],
      requiresHumanReview: true,
      reviewStatus: 'pending_human_review',
      evidenceRefs: [],
      metadata: { rawOutput: 'nope', nested: { apiKey: 'secret' } },
    })

    expect(validation.ok).toBe(false)
    expect(validation.reasonCodes).toContain('CODEGEN_UNSAFE_SIDE_EFFECT')
    expect(validation.reasonCodes).toContain('CODEGEN_SENSITIVE_METADATA')
    expect(metadataContainsSensitiveField({ nested: { authorizationHeader: 'secret' } })).toEqual({
      found: true,
      fieldPath: '$.nested.authorizationHeader',
    })
  })

  it('provides a disabled fallback without stage or bundle side effects', () => {
    const result = createDisabledCodeGenerationPlan()

    expect(result.enabled).toBe(false)
    expect(result.reasonCode).toBe('CODEGEN_DISABLED')
    expect(result.stages).toEqual([])
    expect(result.candidateBundle).toBeUndefined()
  })

  it('builds one isolated runtime frame for every stage', () => {
    const frames = CODE_GENERATION_STAGE_IDS.map((stageId) =>
      buildCodeGenerationRuntimeFrame({
        stageId,
        provider: 'openai_responses',
        runtimeSessionId: `runtime-${stageId}`,
      }),
    )

    expect(frames).toHaveLength(34)
    expect(frames.every((frame) => validateCodeGenerationRuntimeFrame(frame).ok)).toBe(true)
    expect(
      frames.every((frame) => frame.visibleTools.length < CODE_GENERATION_TOOL_IDS.length),
    ).toBe(true)
    expect(JSON.stringify(frames[0])).not.toContain('codegen_34_human_handoff_gate')
  })

  it('derives provider-native tool schemas from the local frame', () => {
    const responses = buildCodeGenerationRuntimeFrame({
      stageId: 'codegen_34_human_handoff_gate',
      provider: 'openai_responses',
      runtimeSessionId: 'runtime-provider-responses',
    })
    const chat = buildCodeGenerationRuntimeFrame({
      stageId: 'codegen_34_human_handoff_gate',
      provider: 'openai_chat_compat',
      runtimeSessionId: 'runtime-provider-chat',
    })
    const anthropic = buildCodeGenerationRuntimeFrame({
      stageId: 'codegen_34_human_handoff_gate',
      provider: 'anthropic_messages',
      runtimeSessionId: 'runtime-provider-anthropic',
    })

    expect(responses.providerTools.parallelToolCalls).toBe(false)
    expect(responses.providerTools.tools).toMatchObject([
      { type: 'function', name: 'compose_review_packet', strict: true },
      { type: 'function', name: 'request_human_review', strict: true },
    ])
    expect(chat.providerTools.tools[0]).toMatchObject({
      type: 'function',
      function: { name: 'compose_review_packet' },
    })
    expect(anthropic.providerTools.toolChoice).toMatchObject({
      disable_parallel_tool_use: true,
    })
    expect(anthropic.providerTools.tools[0]).toMatchObject({
      name: 'compose_review_packet',
      input_schema: { type: 'object' },
    })
  })

  it('rejects mixed context packets and broad context fields', () => {
    const packet = buildCodeGenerationContextPacket({
      stageId: 'codegen_04_architecture_mapping',
      data: {
        allTools: ['read_blueprint', 'request_human_review'],
        nested: { rawOutput: 'do not expose' },
      },
    })
    const validation = validateCodeGenerationContextPacket(
      packet,
      'codegen_05_dependency_inventory',
    )

    expect(validation.ok).toBe(false)
    expect(validation.reasonCodes).toContain('CODEGEN_CONTEXT_SCOPE_MISMATCH')
    expect(validation.reasonCodes).toContain('CODEGEN_CONTEXT_TOO_BROAD')
    expect(validation.reasonCodes).toContain('CODEGEN_SENSITIVE_METADATA')
  })

  it('normalizes provider tool calls to one invocation shape', () => {
    const stageId = 'codegen_33_review_packet_candidate'
    const runtimeSessionId = 'runtime-normalize'
    const openaiResponses = normalizeOpenAIResponsesToolInvocation({
      stageId,
      runtimeSessionId,
      item: {
        type: 'function_call',
        call_id: 'call-responses',
        name: 'compose_review_packet',
        arguments: '{"artifactRef":"artifact:review"}',
      },
    })
    const openaiChat = normalizeOpenAIChatToolInvocation({
      stageId,
      runtimeSessionId,
      toolCall: {
        id: 'call-chat',
        type: 'function',
        function: {
          name: 'compose_review_packet',
          arguments: '{"artifactRef":"artifact:review"}',
        },
      },
    })
    const anthropic = normalizeAnthropicToolInvocation({
      stageId,
      runtimeSessionId,
      block: {
        type: 'tool_use',
        id: 'call-anthropic',
        name: 'compose_review_packet',
        input: { artifactRef: 'artifact:review' },
      },
    })

    expect(openaiResponses).toMatchObject({
      provider: 'openai_responses',
      stageId,
      toolId: 'compose_review_packet',
      arguments: { artifactRef: 'artifact:review' },
    })
    expect(openaiChat.arguments).toEqual(openaiResponses.arguments)
    expect(anthropic.arguments).toEqual(openaiResponses.arguments)
  })

  it('rejects unauthorized invocations and cross-stage tool results', () => {
    const frame = buildCodeGenerationRuntimeFrame({
      stageId: 'codegen_34_human_handoff_gate',
      provider: 'anthropic_messages',
      runtimeSessionId: 'runtime-reject',
    })
    const unauthorized = normalizeAnthropicToolInvocation({
      stageId: 'codegen_34_human_handoff_gate',
      runtimeSessionId: 'runtime-reject',
      block: {
        type: 'tool_use',
        id: 'call-bad-tool',
        name: 'read_blueprint',
        input: {},
      },
    })
    const invocationValidation = validateCodeGenerationToolInvocation(frame, unauthorized)

    expect(invocationValidation.ok).toBe(false)
    expect(invocationValidation.reasonCodes).toContain('CODEGEN_TOOL_CALL_UNAUTHORIZED')

    const allowed = normalizeAnthropicToolInvocation({
      stageId: 'codegen_34_human_handoff_gate',
      runtimeSessionId: 'runtime-reject',
      block: {
        type: 'tool_use',
        id: 'call-good-tool',
        name: 'request_human_review',
        input: { bundleId: 'bundle_1' },
      },
    })
    const resultValidation = validateCodeGenerationToolResult(frame, allowed, {
      runtimeSessionId: 'runtime-other',
      stageId: 'codegen_33_review_packet_candidate',
      callId: 'call-good-tool',
      toolId: 'request_human_review',
      ok: true,
      artifactRefs: [],
      summary: 'wrong stage',
    })

    expect(validateCodeGenerationToolInvocation(frame, allowed).ok).toBe(true)
    expect(resultValidation.ok).toBe(false)
    expect(resultValidation.reasonCodes).toContain('CODEGEN_TOOL_RESULT_CROSS_STAGE')
  })

  it('keeps module-flow snapshots blocked until all 34 stages complete', () => {
    const runtimeSessionId = 'runtime-module-flow'
    const firstRecord = createCodeGenerationModuleMemoryRecord({
      runtimeSessionId,
      stageId: 'codegen_01_intake_normalization',
      artifactRefs: ['artifact:stage-01'],
      observationRefs: ['obs:stage-01'],
      toolCallIds: ['call-stage-01'],
      summary: 'stage 1 candidate metadata recorded',
      completedAt: '2026-07-20T00:00:00.000Z',
    })
    const partialSnapshot = buildCodeGenerationModuleFlowSnapshot({
      runtimeSessionId,
      provider: 'openai_responses',
      records: [firstRecord],
    })

    expect(partialSnapshot.completedStageIds).toEqual(['codegen_01_intake_normalization'])
    expect(partialSnapshot.currentStageId).toBe('codegen_02_requirement_digest')
    expect(partialSnapshot.readyForHumanReview).toBe(false)
    expect(validateCodeGenerationHumanReviewReadiness(partialSnapshot)).toMatchObject({
      ok: false,
      reasonCodes: ['CODEGEN_REVIEW_BLOCKED_PENDING_STAGES'],
    })
    expect(createCodeGenerationHumanReviewPacket(partialSnapshot)).toBeUndefined()

    const completeSnapshot = buildCodeGenerationModuleFlowSnapshot({
      runtimeSessionId,
      provider: 'openai_responses',
      records: CODE_GENERATION_STAGE_IDS.map((stageId, index) =>
        createCodeGenerationModuleMemoryRecord({
          runtimeSessionId,
          stageId,
          artifactRefs: [`artifact:stage-${String(index + 1).padStart(2, '0')}`],
          observationRefs: [`obs:stage-${String(index + 1).padStart(2, '0')}`],
          summary: `stage ${index + 1} candidate metadata recorded`,
          completedAt: '2026-07-20T00:00:00.000Z',
        }),
      ),
    })

    expect(completeSnapshot.completedStageIds).toHaveLength(34)
    expect(completeSnapshot.pendingStageIds).toEqual([])
    expect(completeSnapshot.readyForHumanReview).toBe(true)
    expect(validateCodeGenerationHumanReviewReadiness(completeSnapshot)).toMatchObject({
      ok: true,
      reasonCodes: ['CODEGEN_REVIEW_READY'],
    })
    expect(createCodeGenerationHumanReviewPacket(completeSnapshot)).toMatchObject({
      readyForHumanReview: true,
      stageCount: 34,
    })
  })

  it('serializes module-flow snapshots without raw context or all-tool leakage', () => {
    const snapshot = buildCodeGenerationModuleFlowSnapshot({
      runtimeSessionId: 'runtime-low-sensitive',
      provider: 'anthropic_messages',
      records: [
        createCodeGenerationModuleMemoryRecord({
          runtimeSessionId: 'runtime-low-sensitive',
          stageId: 'codegen_01_intake_normalization',
          artifactRefs: ['artifact:stage-01'],
          observationRefs: ['obs:stage-01'],
          summary: 'safe candidate summary',
        }),
      ],
    })
    const serialized = JSON.stringify(snapshot)

    expect(serialized).toContain('artifact:stage-01')
    expect(serialized).not.toContain('prompt')
    expect(serialized).not.toContain('rawOutput')
    expect(serialized).not.toContain('modelOutput')
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('token')
    expect(serialized).not.toContain('authorization')
    expect(serialized).not.toContain('allTools')
    expect(serialized).not.toContain('fullWorkflow')
  })
})
