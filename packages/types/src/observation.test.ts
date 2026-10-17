import { describe, expect, it } from 'vitest'
import {
  AGENT_OBSERVATION_MANIFEST_CONTRACT_ID,
  AGENT_OBSERVATION_MANIFEST_VERSION,
  OBSERVATION_PRINCIPLE,
  applyObservationBudget,
  containsSensitiveObservationContent,
  createObservationManifest,
  deriveObservationCursor,
  filterObservationByCursor,
  findSensitiveObservationPaths,
  validateObservationManifest,
  type ObservationFinding,
  type ObservationRelation,
} from './observation.js'
import {
  OBSERVATION_CURRENT_FIXTURE,
  OBSERVATION_SENSITIVE_FIXTURE,
  OBSERVATION_UNSUPPORTED_MAJOR_FIXTURE,
} from './observation-fixtures.js'

describe('Observation Manifest v1 contract', () => {
  it('creates a valid Observation Packet with first principle', () => {
    expect(OBSERVATION_CURRENT_FIXTURE.contractId).toBe(AGENT_OBSERVATION_MANIFEST_CONTRACT_ID)
    expect(OBSERVATION_CURRENT_FIXTURE.contractVersion).toBe(AGENT_OBSERVATION_MANIFEST_VERSION)
    expect(OBSERVATION_CURRENT_FIXTURE.principle).toBe(OBSERVATION_PRINCIPLE)
    expect(OBSERVATION_CURRENT_FIXTURE.tool).toBe('observe_scope')
    expect(OBSERVATION_CURRENT_FIXTURE.summary.headline).toContain('AI 草案')
    expect(validateObservationManifest(OBSERVATION_CURRENT_FIXTURE).valid).toBe(true)
  })

  it('keeps evidence as refs and resources instead of raw source content', () => {
    expect(OBSERVATION_CURRENT_FIXTURE.resources.length).toBeGreaterThan(0)
    expect(OBSERVATION_CURRENT_FIXTURE.resources[0]!.uri).toMatch(/^obs:\/\//)
    expect(JSON.stringify(OBSERVATION_CURRENT_FIXTURE)).not.toContain('function stream(')
  })

  it('records MCP graph provenance on code graph evidence', () => {
    const evidence = OBSERVATION_CURRENT_FIXTURE.evidenceRefs.find(
      (item) => item.sourceKind === 'mcp_graph',
    )
    expect(evidence?.graphProject).toBe('aiproj')
    expect(evidence?.tool).toBe('search_graph')
    expect(evidence?.qualifiedName).toContain('AiProjectDraftsController')
  })

  it('rejects unsupported contract version', () => {
    const result = validateObservationManifest(OBSERVATION_UNSUPPORTED_MAJOR_FIXTURE)
    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.includes('contractVersion'))).toBe(true)
  })
})

describe('Observation trust model', () => {
  it('rejects verified facts without evidence refs', () => {
    const manifest = createObservationManifest({
      observationId: 'obs-bad-fact',
      objective: 'bad fact',
      intent: 'debug',
      scope: { type: 'repository', id: 'aiproj' },
      generatedAt: '2026-07-19T10:00:00.000Z',
      facts: [
        {
          id: 'fact-without-evidence',
          kind: 'fact',
          statement: 'This cannot be verified.',
          verification: 'verified',
          evidenceRefs: [],
        },
      ],
    })
    const result = validateObservationManifest(manifest)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('verified fact fact-without-evidence must include evidenceRefs')
  })

  it('rejects blocking findings without verified fact or evidence', () => {
    const blockingFinding: ObservationFinding = {
      id: 'finding-blocking-no-evidence',
      kind: 'verification',
      severity: 'blocking',
      title: 'No evidence',
      summary: 'Blocking finding needs deterministic support.',
      confidence: 'unknown',
      factRefs: [],
      evidenceRefs: [],
    }
    const manifest = createObservationManifest({
      observationId: 'obs-bad-blocking',
      objective: 'bad blocking',
      intent: 'debug',
      scope: { type: 'repository', id: 'aiproj' },
      generatedAt: '2026-07-19T10:00:00.000Z',
      findings: [blockingFinding],
    })
    const result = validateObservationManifest(manifest)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'blocking finding finding-blocking-no-evidence must reference verified fact or evidence',
    )
  })

  it('allows inference only as inference, not as verified fact', () => {
    const manifest = createObservationManifest({
      observationId: 'obs-inference',
      objective: 'inference test',
      intent: 'debug',
      scope: { type: 'repository', id: 'aiproj' },
      generatedAt: '2026-07-19T10:00:00.000Z',
      inferences: [
        {
          id: 'inf-root-cause',
          kind: 'inference',
          statement: 'This may be the root cause.',
          confidence: 'medium',
          basis: 'MCP impact path suggests adjacency.',
          evidenceRefs: [],
        },
      ],
    })
    expect(validateObservationManifest(manifest).valid).toBe(true)
    expect(manifest.inferences[0]!.kind).toBe('inference')
  })
})

describe('Observation cursor and budget behavior', () => {
  it('derives cursor from findings, evidence, entities, and touchpoints', () => {
    const cursor = deriveObservationCursor(OBSERVATION_CURRENT_FIXTURE)
    expect(cursor.seenFindingIds).toContain('finding-ai-draft-touchpoint')
    expect(cursor.seenEvidenceIds).toContain('ev-mcp-ai-draft-controller')
    expect(cursor.seenCodeTouchpointIds).toContain('touch-ai-draft-controller')
  })

  it('deduplicates seen findings unless changedSinceCursor is true', () => {
    const cursor = deriveObservationCursor(OBSERVATION_CURRENT_FIXTURE)
    const filtered = filterObservationByCursor(OBSERVATION_CURRENT_FIXTURE, cursor)
    expect(filtered.findings).toHaveLength(0)

    const changed = {
      ...OBSERVATION_CURRENT_FIXTURE,
      findings: [{ ...OBSERVATION_CURRENT_FIXTURE.findings[0]!, changedSinceCursor: true }],
    }
    expect(filterObservationByCursor(changed, cursor).findings).toHaveLength(1)
  })

  it('applies finding, evidence, and resource budgets', () => {
    const manifest = createObservationManifest({
      ...OBSERVATION_CURRENT_FIXTURE,
      observationId: 'obs-budget',
      budget: {
        maxTokens: 1000,
        maxFindings: 1,
        maxEvidenceRefs: 1,
        maxResourceHandles: 0,
      },
      evidenceRefs: OBSERVATION_CURRENT_FIXTURE.evidenceRefs,
      resources: OBSERVATION_CURRENT_FIXTURE.resources,
    })
    const budgeted = applyObservationBudget({
      ...manifest,
      resources: OBSERVATION_CURRENT_FIXTURE.resources,
      evidenceRefs: OBSERVATION_CURRENT_FIXTURE.evidenceRefs,
    })
    expect(budgeted.findings.length).toBeLessThanOrEqual(1)
    expect(budgeted.evidenceRefs.length).toBeLessThanOrEqual(1)
    expect(budgeted.resources).toHaveLength(0)
    expect(budgeted.budgetUsage.omittedResourceHandles).toBeGreaterThan(0)
  })
})

describe('Observation runtime and relation model', () => {
  it('accepts runtime signals and relations when they are evidence-backed', () => {
    const manifest = createObservationManifest({
      observationId: 'obs-runtime',
      objective: 'runtime bridge',
      intent: 'verify',
      scope: { type: 'repository', id: 'aiproj' },
      generatedAt: '2026-07-19T10:00:00.000Z',
      evidenceRefs: [
        {
          id: 'ev-runtime-test',
          sourceKind: 'test_result',
          title: 'Types test result',
          summary: 'Command exited 0; output summarized by hash.',
          verified: true,
          generatedAt: '2026-07-19T10:00:00.000Z',
          command: 'pnpm --filter @aiproj/types test',
          exitCode: 0,
          contentHash: 'abc123',
          truncated: true,
        },
      ],
      runtimeSignals: [
        {
          id: 'signal-types-test',
          signalType: 'test_result',
          status: 'passed',
          summary: 'Types tests passed.',
          observedAt: '2026-07-19T10:00:00.000Z',
          command: 'pnpm --filter @aiproj/types test',
          exitCode: 0,
          sourceKinds: ['test_result'],
          evidenceRefs: ['ev-runtime-test'],
        },
      ],
      relations: [
        {
          id: 'rel-signal-verifies-types',
          kind: 'verifies',
          fromRef: 'signal-types-test',
          toRef: 'package:@aiproj/types',
          label: 'test result verifies package observation contract',
          confidence: 'deterministic',
          sourceKinds: ['test_result'],
          evidenceRefs: ['ev-runtime-test'],
        },
      ],
      causalPaths: [
        {
          id: 'path-runtime-test',
          summary: 'Probe command verifies observation contract behavior.',
          nodes: ['pnpm --filter @aiproj/types test', 'signal-types-test', 'package:@aiproj/types'],
          confidence: 'high',
          evidenceRefs: ['ev-runtime-test'],
        },
      ],
    })

    const result = validateObservationManifest(manifest)
    expect(result.valid).toBe(true)
    expect(manifest.runtimeSignals[0]!.status).toBe('passed')
    expect(manifest.relations[0]!.kind).toBe('verifies')
    expect(manifest.causalPaths[0]!.nodes).toContain('signal-types-test')
  })

  it('rejects relation edges without evidence', () => {
    const relation: ObservationRelation = {
      id: 'rel-no-evidence',
      kind: 'causes',
      fromRef: 'a',
      toRef: 'b',
      label: 'missing evidence',
      confidence: 'unknown',
      sourceKinds: ['manual'],
      evidenceRefs: [],
    }
    const manifest = createObservationManifest({
      observationId: 'obs-bad-relation',
      objective: 'bad relation',
      intent: 'debug',
      scope: { type: 'repository', id: 'aiproj' },
      generatedAt: '2026-07-19T10:00:00.000Z',
      relations: [relation],
    })

    const result = validateObservationManifest(manifest)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('relation rel-no-evidence must include evidenceRefs')
  })
})

describe('Observation safety scanning', () => {
  it('detects sensitive keys and values', () => {
    expect(containsSensitiveObservationContent({ apiKey: 'secret' })).toBe(true)
    expect(containsSensitiveObservationContent({ headers: { Authorization: 'Bearer abc' } })).toBe(
      true,
    )
    expect(containsSensitiveObservationContent({ summary: 'safe low sensitivity text' })).toBe(
      false,
    )
  })

  it('reports sensitive paths', () => {
    const paths = findSensitiveObservationPaths(OBSERVATION_SENSITIVE_FIXTURE)
    expect(paths.some((path) => path.includes('apiKey'))).toBe(true)
  })

  it('rejects sensitive fixture during validation', () => {
    const result = validateObservationManifest(OBSERVATION_SENSITIVE_FIXTURE)
    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.includes('sensitive content'))).toBe(true)
  })
})
