// @aiproj/types — V2 TRIZ Compiler Analysis Layer 共享契约测试
// §1.3: 类型枚举、warning 排序、hash 序列化、canHandoff 逻辑、DTO 形状

import { describe, expect, it } from 'vitest'
import {
  TRIZ_ANALYSIS_MODES,
  TRIZ_ANALYSIS_STATUSES,
  TRIZ_HANDOFF_STATUSES,
  TRIZ_ANALYSIS_WARNING_CODES,
  TRIZ_WARNING_SEVERITIES,
  PRINCIPLE_RELEVANCE_LEVELS,
  sortWarningsBySeverity,
  computeTrizArtifactContentHash,
  getWarningCodeLabel,
  canHandoffResolutionPath,
} from './triz-compiler-analysis.js'
import type {
  TrizAnalysisArtifact,
  TrizAnalysisWarning,
  TrizResolutionPath,
  TrizAnalysisSourceRef,
  ParameterTensionSummary,
  PrincipleCandidate,
  TrizCompilerAnalysisSummary,
} from './triz-compiler-analysis.js'

describe('TRIZ Compiler Analysis — enum values', () => {
  it('exports expected analysis modes', () => {
    expect(TRIZ_ANALYSIS_MODES).toEqual(['deterministic', 'hybrid'])
  })

  it('exports expected statuses', () => {
    expect(TRIZ_ANALYSIS_STATUSES).toEqual(['pending', 'completed', 'failed', 'needs_human_review'])
  })

  it('exports expected handoff statuses', () => {
    expect(TRIZ_HANDOFF_STATUSES).toEqual(['none', 'candidate_created', 'stale', 'handed_off'])
  })

  it('exports expected warning codes', () => {
    expect(TRIZ_ANALYSIS_WARNING_CODES).toContain('NEEDS_HUMAN_REVIEW')
    expect(TRIZ_ANALYSIS_WARNING_CODES).toContain('STALE_SOURCE_CONTRADICTION')
    expect(TRIZ_ANALYSIS_WARNING_CODES).toContain('DRAFT_INPUT_INCLUDED')
    expect(TRIZ_ANALYSIS_WARNING_CODES).toContain('AI_SUMMARY_FALLBACK')
    expect(TRIZ_ANALYSIS_WARNING_CODES).toContain('BUDGET_BLOCKED')
    expect(TRIZ_ANALYSIS_WARNING_CODES).toContain('MODEL_FAILURE')
    expect(TRIZ_ANALYSIS_WARNING_CODES).toContain('INVALID_AI_OUTPUT')
    expect(TRIZ_ANALYSIS_WARNING_CODES).toContain('HALLUCINATION_WARNING')
    expect(TRIZ_ANALYSIS_WARNING_CODES).toContain('CONTEXT_UNAVAILABLE')
    expect(TRIZ_ANALYSIS_WARNING_CODES).toContain('NO_CONTRADICTIONS_FOUND')
    expect(TRIZ_ANALYSIS_WARNING_CODES).toContain('EMPTY_RESOLUTION_PATHS')
    expect(TRIZ_ANALYSIS_WARNING_CODES).toContain('SOURCE_HASH_MISMATCH')
    expect(TRIZ_ANALYSIS_WARNING_CODES.length).toBe(12)
  })

  it('exports expected warning severities', () => {
    expect(TRIZ_WARNING_SEVERITIES).toEqual(['blocking', 'warning', 'info'])
  })

  it('exports expected principle relevance levels', () => {
    expect(PRINCIPLE_RELEVANCE_LEVELS).toEqual(['high', 'medium', 'low'])
  })

  it('covers all warning codes with Chinese labels', () => {
    for (const code of TRIZ_ANALYSIS_WARNING_CODES) {
      const label = getWarningCodeLabel(code)
      expect(label.length).toBeGreaterThan(0)
      // label should not be the raw code (have Chinese translation)
      expect(label).not.toBe(code)
    }
  })
})

describe('TRIZ Compiler Analysis — warning sorting', () => {
  it('sorts warnings by severity (blocking first)', () => {
    const warnings: TrizAnalysisWarning[] = [
      { code: 'AI_SUMMARY_FALLBACK', severity: 'info', message: 'Info' },
      { code: 'NEEDS_HUMAN_REVIEW', severity: 'blocking', message: 'Blocking' },
      { code: 'STALE_SOURCE_CONTRADICTION', severity: 'warning', message: 'Warning' },
    ]
    const sorted = sortWarningsBySeverity(warnings)
    expect(sorted[0].severity).toBe('blocking')
    expect(sorted[1].severity).toBe('warning')
    expect(sorted[2].severity).toBe('info')
  })

  it('returns empty array for no warnings', () => {
    expect(sortWarningsBySeverity([])).toEqual([])
  })

  it('preserves original array immutably', () => {
    const warnings: TrizAnalysisWarning[] = [
      { code: 'MODEL_FAILURE', severity: 'warning', message: 'M' },
      { code: 'BUDGET_BLOCKED', severity: 'info', message: 'B' },
    ]
    const original = [...warnings.map((w) => ({ ...w }))]
    sortWarningsBySeverity(warnings)
    expect(warnings[0].severity).toBe('warning') // original unchanged
  })
})

describe('TRIZ Compiler Analysis — stable content hash', () => {
  const sourceRefs: TrizAnalysisSourceRef[] = [
    {
      key: 'cd-001-key',
      title: '工期压缩矛盾',
      type: 'technical',
      status: 'confirmed',
      severity: 'high',
      confidence: 0.85,
      stale: false,
      staleReason: null,
      ruleVersion: '1.0.0',
      inputSignature: 'sig-v1',
      outputHash: 'hash-v1',
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      parameterKey: null,
      requirementA: null,
      requirementB: null,
      suggestedPrinciples: [{ principleId: 'P1', name: '分割' }],
      evidenceRefs: ['ev-001'],
      contradictionId: 1,
    },
  ]

  const tensions: ParameterTensionSummary[] = [
    {
      improvingKey: 'duration',
      worseningKey: 'cost',
      technicalSummary: '工期与成本的矛盾',
      physicalSummary: null,
      sourceKeys: ['cd-001-key'],
    },
  ]

  const principles: PrincipleCandidate[] = [
    {
      principleId: 'P1',
      name: '分割',
      chineseName: '分割',
      relevance: 'high',
      sourceKeys: ['cd-001-key'],
    },
  ]

  const resolutionPaths: TrizResolutionPath[] = [
    {
      pathId: 'path-001',
      name: '拆分关键路径段',
      description: '将关键路径拆分为并行段以减少工期',
      suggestionType: 'split',
      applicability: ['关键路径可拆分'],
      nonApplicability: ['任务不可并行'],
      sourceKeys: ['cd-001-key'],
      principleIds: ['P1'],
      requiresHumanReview: false,
      warnings: [],
    },
  ]

  const warnings: TrizAnalysisWarning[] = [
    { code: 'NEEDS_HUMAN_REVIEW', severity: 'info', message: '请人工复核' },
  ]

  it('produces deterministic JSON serialization', () => {
    const hash1 = computeTrizArtifactContentHash({
      sourceContradictions: sourceRefs,
      parameterTensions: tensions,
      principleCandidates: principles,
      resolutionPaths,
      warnings,
    })
    const hash2 = computeTrizArtifactContentHash({
      sourceContradictions: sourceRefs,
      parameterTensions: tensions,
      principleCandidates: principles,
      resolutionPaths,
      warnings,
    })
    expect(hash1).toBe(hash2)
  })

  it('changes when source content changes', () => {
    const hash1 = computeTrizArtifactContentHash({
      sourceContradictions: sourceRefs,
      parameterTensions: tensions,
      principleCandidates: principles,
      resolutionPaths,
      warnings,
    })
    const changedRefs = sourceRefs.map((r) => ({ ...r, outputHash: 'hash-v2' }))
    const hash2 = computeTrizArtifactContentHash({
      sourceContradictions: changedRefs,
      parameterTensions: tensions,
      principleCandidates: principles,
      resolutionPaths,
      warnings,
    })
    expect(hash1).not.toBe(hash2)
  })

  it('excludes timestamps and transient fields', () => {
    const hash = computeTrizArtifactContentHash({
      sourceContradictions: sourceRefs,
      parameterTensions: tensions,
      principleCandidates: principles,
      resolutionPaths,
      warnings,
    })
    // Should not contain ISO timestamps or date strings
    expect(hash).not.toContain('createdAt')
    expect(hash).not.toContain('calculatedAt')
  })
})

describe('TRIZ Compiler Analysis — canHandoffResolutionPath', () => {
  const cleanPath: TrizResolutionPath = {
    pathId: 'path-001',
    name: '测试路径',
    description: '测试',
    suggestionType: 'split',
    applicability: [],
    nonApplicability: [],
    sourceKeys: [],
    principleIds: [],
    requiresHumanReview: false,
    warnings: [],
  }

  it('allows handoff for clean path with no warnings', () => {
    const result = canHandoffResolutionPath(cleanPath, [])
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('blocks handoff when path requires human review', () => {
    const reviewPath = { ...cleanPath, requiresHumanReview: true }
    const result = canHandoffResolutionPath(reviewPath, [])
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('人工复核')
  })

  it('blocks handoff when path has blocking warnings', () => {
    const warnings: TrizAnalysisWarning[] = [
      {
        code: 'STALE_SOURCE_CONTRADICTION',
        severity: 'blocking',
        message: '过期',
        pathId: 'path-001',
      },
    ]
    const result = canHandoffResolutionPath(cleanPath, warnings)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('blocks handoff when stale source warning exists for the path', () => {
    const warnings: TrizAnalysisWarning[] = [
      {
        code: 'STALE_SOURCE_CONTRADICTION',
        severity: 'warning',
        message: '过期',
        pathId: 'path-001',
      },
    ]
    const result = canHandoffResolutionPath(cleanPath, warnings)
    expect(result.allowed).toBe(false)
  })

  it('ignores warnings not related to the path', () => {
    const warnings: TrizAnalysisWarning[] = [
      { code: 'BUDGET_BLOCKED', severity: 'warning', message: '预算', pathId: 'path-002' },
    ]
    const result = canHandoffResolutionPath(cleanPath, warnings)
    expect(result.allowed).toBe(true)
  })
})

describe('TRIZ Compiler Analysis — DTO shape', () => {
  it('produces valid TrizAnalysisArtifact shape', () => {
    const artifact: TrizAnalysisArtifact = {
      schemaVersion: '1.0',
      mode: 'deterministic',
      status: 'completed',
      sourceContradictions: [],
      parameterTensions: [],
      principleCandidates: [],
      resolutionPaths: [],
      warnings: [],
      requiresHumanReview: false,
      sourceHashes: {
        inputSignatures: [],
        outputHash: 'abc',
        contentHash: 'def',
      },
      handoff: {
        status: 'none',
        draftSessionRef: null,
        selectedPathId: null,
        handedOffAt: null,
        blockedReason: null,
      },
      aiNarrative: null,
      createdAt: '2026-07-16T00:00:00Z',
    }
    expect(artifact.mode).toBe('deterministic')
    expect(artifact.sourceContradictions).toEqual([])
    expect(artifact.status).toBe('completed')
    expect(artifact.handoff.status).toBe('none')
    expect(artifact.aiNarrative).toBeNull()
  })

  it('produces valid TrizCompilerAnalysisSummary shape', () => {
    const summary: TrizCompilerAnalysisSummary = {
      artifactId: 'triz_analysis_run_1_v1',
      version: 1,
      status: 'completed',
      warningCount: 2,
      blockingWarningCount: 0,
      topTensions: ['工期与成本的矛盾'],
      sourceContradictionCount: 3,
      resolutionPathCount: 2,
      handoffStatus: 'none',
      hasAiNarrative: false,
      calculatedAt: '2026-07-16T00:00:00Z',
      stale: false,
    }
    expect(summary.artifactId).toBe('triz_analysis_run_1_v1')
    expect(summary.blockingWarningCount).toBe(0)
    expect(summary.stale).toBe(false)
  })

  it('hybrid artifact can have aiNarrative', () => {
    const narrative = {
      summary: '综合分析说明',
      provider: 'fake',
      model: 'test-model',
      hallucinationChecked: true,
      hallucinationPassed: true,
      tokenUsage: { input: 100, output: 50, total: 150 },
    }
    const artifact: TrizAnalysisArtifact = {
      schemaVersion: '1.0',
      mode: 'hybrid',
      status: 'completed',
      sourceContradictions: [],
      parameterTensions: [],
      principleCandidates: [],
      resolutionPaths: [],
      warnings: [],
      requiresHumanReview: false,
      sourceHashes: {
        inputSignatures: ['sig1'],
        outputHash: 'abc',
        contentHash: 'def',
      },
      handoff: {
        status: 'none',
        draftSessionRef: null,
        selectedPathId: null,
        handedOffAt: null,
        blockedReason: null,
      },
      aiNarrative: narrative,
      createdAt: '2026-07-16T00:00:00Z',
    }
    expect(artifact.aiNarrative?.hallucinationPassed).toBe(true)
    expect(artifact.aiNarrative?.tokenUsage?.total).toBe(150)
  })

  it('advisory-only resolution paths never contain executable patches', () => {
    const path: TrizResolutionPath = {
      pathId: 'path-001',
      name: '测试',
      description: '建议性描述（不包含 SQL/ORM 写入）',
      suggestionType: 'split',
      applicability: ['条件1'],
      nonApplicability: ['条件2'],
      sourceKeys: ['cd-001'],
      principleIds: ['P1'],
      requiresHumanReview: false,
      warnings: [],
    }
    // Verify no executable-like fields exist
    const keys = Object.keys(path)
    expect(keys).not.toContain('patch')
    expect(keys).not.toContain('sql')
    expect(keys).not.toContain('mutation')
    expect(path.description).not.toMatch(/UPDATE|INSERT|DELETE|exec|patch/i)
  })
})
