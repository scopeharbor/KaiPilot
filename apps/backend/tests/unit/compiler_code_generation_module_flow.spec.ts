import { describe, expect, it } from 'vitest'
import { CODE_GENERATION_STAGE_IDS } from '@aiproj/types/compiler-code-generation'
import {
  CodeGenerationModuleFlowService,
  InMemoryCodeGenerationModuleMemory,
} from '../../app/services/compiler/code-generation/index.js'

describe('CodeGenerationModuleFlowService', () => {
  it('starts with the first module pending and human review blocked', async () => {
    const service = new CodeGenerationModuleFlowService()
    const snapshot = await service.getSnapshot({
      runtimeSessionId: 'runtime-start',
      provider: 'openai_responses',
    })
    const review = await service.requestHumanReview({
      runtimeSessionId: 'runtime-start',
      provider: 'openai_responses',
    })

    expect(snapshot.stageCount).toBe(34)
    expect(snapshot.completedStageIds).toEqual([])
    expect(snapshot.currentStageId).toBe('codegen_01_intake_normalization')
    expect(snapshot.readyForHumanReview).toBe(false)
    expect(review.validation).toMatchObject({
      ok: false,
      reasonCodes: ['CODEGEN_REVIEW_BLOCKED_PENDING_STAGES'],
    })
    expect(review.reviewPacket).toBeUndefined()
  })

  it('builds downstream frames from upstream artifact and observation refs only', async () => {
    const service = new CodeGenerationModuleFlowService()
    const runtimeSessionId = 'runtime-frame-isolation'

    await service.completeStage({
      runtimeSessionId,
      provider: 'anthropic_messages',
      stageId: 'codegen_01_intake_normalization',
      artifactRefs: ['artifact:stage-01'],
      observationRefs: ['obs:stage-01'],
      toolCallIds: ['call-01'],
      summary: 'stage one done',
      completedAt: '2026-07-20T00:00:00.000Z',
    })
    const frame = await service.buildFrameForStage({
      runtimeSessionId,
      provider: 'anthropic_messages',
      stageId: 'codegen_02_requirement_digest',
    })
    const serialized = JSON.stringify(frame)

    expect(frame.stageId).toBe('codegen_02_requirement_digest')
    expect(frame.contextPacket.artifactRefs).toEqual(['artifact:stage-01'])
    expect(frame.contextPacket.evidenceRefs).toEqual(['obs:stage-01'])
    expect(frame.visibleTools.map((tool) => tool.toolId)).toEqual([
      'read_stage_artifact',
      'write_candidate_artifact',
      'validate_schema',
    ])
    expect(serialized).not.toContain('rawOutput')
    expect(serialized).not.toContain('fullWorkflow')
    expect(serialized).not.toContain('request_human_review')
  })

  it('rejects skipped dependencies and keeps the skipped stage pending', async () => {
    const service = new CodeGenerationModuleFlowService()
    const runtimeSessionId = 'runtime-dependency'

    await service.completeStage({
      runtimeSessionId,
      provider: 'openai_chat_compat',
      stageId: 'codegen_01_intake_normalization',
      artifactRefs: ['artifact:stage-01'],
      summary: 'stage one done',
    })
    const skipped = await service.completeStage({
      runtimeSessionId,
      provider: 'openai_chat_compat',
      stageId: 'codegen_03_scope_boundary',
      artifactRefs: ['artifact:stage-03'],
      summary: 'stage three should not be accepted',
    })

    expect(skipped.validation).toMatchObject({
      ok: false,
      reasonCodes: ['CODEGEN_STAGE_DEPENDENCY_INCOMPLETE'],
    })
    expect(skipped.snapshot.completedStageIds).toEqual(['codegen_01_intake_normalization'])
    expect(skipped.snapshot.currentStageId).toBe('codegen_02_requirement_digest')
    expect(skipped.snapshot.pendingStageIds).toContain('codegen_03_scope_boundary')
  })

  it('keeps duplicate stage completion idempotent', async () => {
    const memory = new InMemoryCodeGenerationModuleMemory()
    const service = new CodeGenerationModuleFlowService(undefined, memory)
    const runtimeSessionId = 'runtime-idempotent'

    const first = await service.completeStage({
      runtimeSessionId,
      provider: 'openai_responses',
      stageId: 'codegen_01_intake_normalization',
      artifactRefs: ['artifact:first'],
      summary: 'first summary wins',
    })
    const duplicate = await service.completeStage({
      runtimeSessionId,
      provider: 'openai_responses',
      stageId: 'codegen_01_intake_normalization',
      artifactRefs: ['artifact:second'],
      summary: 'second summary is ignored',
    })
    const records = await memory.list(runtimeSessionId)

    expect(first.validation.ok).toBe(true)
    expect(duplicate.validation.ok).toBe(true)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      artifactRefs: ['artifact:first'],
      summary: 'first summary wins',
    })
  })

  it('opens human review only after all 34 modules complete', async () => {
    const service = new CodeGenerationModuleFlowService()
    const runtimeSessionId = 'runtime-review-gate'

    for (const [index, stageId] of CODE_GENERATION_STAGE_IDS.entries()) {
      const result = await service.completeStage({
        runtimeSessionId,
        provider: 'openai_responses',
        stageId,
        artifactRefs: [`artifact:stage-${String(index + 1).padStart(2, '0')}`],
        observationRefs: [`obs:stage-${String(index + 1).padStart(2, '0')}`],
        summary: `stage ${index + 1} done`,
        completedAt: '2026-07-20T00:00:00.000Z',
      })
      expect(result.validation.ok).toBe(true)
    }

    const review = await service.requestHumanReview({
      runtimeSessionId,
      provider: 'openai_responses',
    })

    expect(review.validation).toMatchObject({
      ok: true,
      reasonCodes: ['CODEGEN_REVIEW_READY'],
    })
    expect(review.snapshot.completedStageIds).toHaveLength(34)
    expect(review.snapshot.pendingStageIds).toEqual([])
    expect(review.reviewPacket).toMatchObject({
      readyForHumanReview: true,
      stageCount: 34,
    })
    expect(review.reviewPacket?.stageArtifactRefs.codegen_34_human_handoff_gate).toEqual([
      'artifact:stage-34',
    ])
  })
})
