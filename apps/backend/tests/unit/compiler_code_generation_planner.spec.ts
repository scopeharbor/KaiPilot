import { describe, expect, it } from 'vitest'
import {
  CodeGenerationPlanner,
  getCodeGenerationCatalogSize,
} from '../../app/services/compiler/code-generation/index.js'

describe('CodeGenerationPlanner', () => {
  it('plans 34 stage-local entries when enabled', () => {
    const planner = new CodeGenerationPlanner()
    const result = planner.plan({
      enabled: true,
      bundleId: 'bundle_fixture_enabled',
      files: [
        {
          path: 'apps/frontend/app/demo/page.tsx',
          operation: 'create',
          artifactKind: 'frontend_route_candidate',
          contentHash: 'sha256:abc',
          sideEffectKind: 'none',
        },
      ],
      evidenceRefs: ['ev-codegen-planner'],
      metadata: { source: 'fixture' },
    })

    expect(result.enabled).toBe(true)
    expect(result.reasonCode).toBe('CODEGEN_PLAN_READY')
    expect(result.stages).toHaveLength(34)
    expect(result.candidateBundle?.requiresHumanReview).toBe(true)
    expect(result.candidateBundle?.reviewStatus).toBe('pending_human_review')
    expect(getCodeGenerationCatalogSize()).toBe(34)
  })

  it('keeps each stage focused on local tools and bounded context', () => {
    const planner = new CodeGenerationPlanner()
    const result = planner.plan({ enabled: true, bundleId: 'bundle_fixture_visibility' })
    const architectureStage = planner.getStageVisibility('codegen_04_architecture_mapping')
    const handoffStage = planner.getStageVisibility('codegen_34_human_handoff_gate')

    expect(result.stages.every((stage) => stage.allowedTools.length > 0)).toBe(true)
    expect(result.stages.every((stage) => stage.allowedTools.length < 12)).toBe(true)
    expect(architectureStage).toMatchObject({
      contextScope: 'local_code_slice',
      allowedTools: ['inspect_existing_code', 'read_stage_artifact', 'write_candidate_artifact'],
    })
    expect(handoffStage).toMatchObject({
      contextScope: 'review_summary',
      allowedTools: ['compose_review_packet', 'request_human_review'],
    })
  })

  it('returns disabled fallback with no stages or candidate bundle', () => {
    const planner = new CodeGenerationPlanner()
    const result = planner.plan({ enabled: false, bundleId: 'bundle_disabled' })

    expect(result.enabled).toBe(false)
    expect(result.reasonCode).toBe('CODEGEN_DISABLED')
    expect(result.stages).toEqual([])
    expect(result.candidateBundle).toBeUndefined()
  })

  it('rejects unsafe paths and repository side effects', () => {
    const planner = new CodeGenerationPlanner()
    const result = planner.plan({
      enabled: true,
      bundleId: 'bundle_unsafe',
      files: [
        {
          path: '../package.json',
          operation: 'modify',
          artifactKind: 'config_candidate',
          sideEffectKind: 'repository_writeback',
        },
      ],
    })

    expect(result.reasonCode).toBe('CODEGEN_VALIDATION_FAILED')
    expect(result.violations.some((violation) => violation.includes('parent_directory'))).toBe(true)
    expect(result.violations.some((violation) => violation.includes('repository_writeback'))).toBe(
      true,
    )
  })

  it('summarizes low-sensitive evidence without prompt or raw output', () => {
    const planner = new CodeGenerationPlanner()
    const result = planner.plan({
      enabled: true,
      bundleId: 'bundle_summary',
      metadata: { safeRef: 'artifact:1' },
    })

    const summary = planner.summarize(result)
    const serialized = JSON.stringify(summary)

    expect(summary.stageCount).toBe(34)
    expect(summary.maxToolsPerStage).toBeLessThan(12)
    expect(summary.requiresHumanReview).toBe(true)
    expect(serialized).not.toContain('prompt')
    expect(serialized).not.toContain('rawOutput')
    expect(serialized).not.toContain('token')
    expect(serialized).not.toContain('secret')
  })
})
