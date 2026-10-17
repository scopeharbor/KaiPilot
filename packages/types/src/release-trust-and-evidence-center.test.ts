import { describe, expect, it } from 'vitest'
import {
  RELEASE_TRUST_GATE_REGISTRY,
  TRUST_DECISIONS,
  compareRecordedDecision,
  detectHeadDrift,
  evaluateReleaseTrust,
  isTrustDecision,
  scanEvidenceBundleLowSensitive,
  validateEvidenceRecord,
  type ReleaseTrustEvidenceRecord,
  type ReleaseTrustGateRegistryEntry,
} from './release-trust-and-evidence-center.js'
import {
  RELEASE_TRUST_FIXTURE_HEAD,
  makeBlockedReleaseTrustBundle,
  makeMissingReleaseTrustBundle,
  makePassingReleaseTrustBundle,
  makeReleaseTrustEvidenceRecord,
  makeStaleReleaseTrustBundle,
  makeUpgradedWordingReleaseTrustFixture,
} from './release-trust-and-evidence-center-fixtures.js'

describe('release trust shared contract', () => {
  it('keeps the four decision vocabulary closed', () => {
    expect(TRUST_DECISIONS).toEqual(['releasable', 'blocked', 'stale', 'insufficient-evidence'])
    expect(isTrustDecision('stale')).toBe(true)
    expect(isTrustDecision('passing')).toBe(false)
  })

  it('registers the 16 deterministic seeds plus two missing runners', () => {
    expect(RELEASE_TRUST_GATE_REGISTRY).toHaveLength(18)
    expect(new Set(RELEASE_TRUST_GATE_REGISTRY.map((entry) => entry.gateId)).size).toBe(18)
    expect(RELEASE_TRUST_GATE_REGISTRY.map((entry) => entry.gateId)).toContain('ai-quality-slots')
    expect(RELEASE_TRUST_GATE_REGISTRY.map((entry) => entry.gateId)).toContain(
      'plugin-first-closure',
    )
  })

  it.each([
    ['command', ''],
    ['exitCode', Number.NaN],
    ['startedAt', ''],
    ['finishedAt', ''],
    ['collectedHead', ''],
  ] as const)('rejects missing provenance field %s', (field, value) => {
    const record = makeReleaseTrustEvidenceRecord({ gateId: 'typecheck' }) as unknown as Record<
      string,
      unknown
    >
    record[field] = value
    expect(
      validateEvidenceRecord(record as unknown as ReleaseTrustEvidenceRecord).some(
        (finding) => finding.field === field && finding.severity === 'blocking',
      ),
    ).toBe(true)
  })

  it('rejects a passing summary paired with a non-zero exit code', () => {
    const record = makeReleaseTrustEvidenceRecord({
      gateId: 'typecheck',
      exitCode: 1,
      resultSummary: 'status=passed; exitCode=0',
    })
    expect(validateEvidenceRecord(record).map((finding) => finding.code)).toContain(
      'RTR-OUTCOME-001',
    )
  })

  it('treats an old deterministic rerun as blocking', () => {
    const record = makeReleaseTrustEvidenceRecord({
      gateId: 'typecheck',
      collectedHead: 'old-head',
    })
    expect(detectHeadDrift([record], RELEASE_TRUST_FIXTURE_HEAD)[0]?.severity).toBe('blocking')
  })

  it('accepts complete referenced provenance while reporting the old HEAD distinctly', () => {
    const longRegistry: readonly ReleaseTrustGateRegistryEntry[] = [
      {
        gateId: 'backend-full-suite',
        command: ['pnpm', '--filter', '@aiproj/backend', 'test'],
        kind: 'long-running',
        summarySelector: { source: 'process', fields: ['exitCode'] },
      },
    ]
    const record: ReleaseTrustEvidenceRecord = {
      ...makeReleaseTrustEvidenceRecord({ gateId: 'backend-full-suite' }),
      mode: 'referenced',
      collectedHead: 'old-head',
      originalDate: '2026-08-25',
      originalHead: 'old-head',
      intervalChangeSummary: '仅信任中心代码变化；后端套件相关路径未变',
    }
    expect(validateEvidenceRecord(record)).toEqual([])
    expect(detectHeadDrift([record], RELEASE_TRUST_FIXTURE_HEAD, longRegistry)[0]?.severity).toBe(
      'warning',
    )
  })

  it('derives the same decision twice from the same passing bundle', () => {
    const bundle = makePassingReleaseTrustBundle()
    const first = evaluateReleaseTrust(bundle, RELEASE_TRUST_FIXTURE_HEAD)
    const second = evaluateReleaseTrust(bundle, RELEASE_TRUST_FIXTURE_HEAD)
    expect(first).toEqual(second)
    expect(first.decision).toBe('releasable')
  })

  it('gives blocking evidence the highest priority', () => {
    expect(
      evaluateReleaseTrust(makeBlockedReleaseTrustBundle(), RELEASE_TRUST_FIXTURE_HEAD).decision,
    ).toBe('blocked')
  })

  it('reports missing registered gates as insufficient evidence', () => {
    expect(
      evaluateReleaseTrust(makeMissingReleaseTrustBundle(), RELEASE_TRUST_FIXTURE_HEAD).decision,
    ).toBe('insufficient-evidence')
  })

  it('keeps missing evidence above stale evidence when no blocking result exists', () => {
    const registry: readonly ReleaseTrustGateRegistryEntry[] = [
      {
        gateId: 'long-suite',
        command: ['pnpm', 'test'],
        kind: 'long-running',
        summarySelector: { source: 'process', fields: ['exitCode'] },
      },
      {
        gateId: 'missing-suite',
        command: ['pnpm', 'test'],
        kind: 'long-running',
        summarySelector: { source: 'process', fields: ['exitCode'] },
      },
    ]
    const staleRecord: ReleaseTrustEvidenceRecord = {
      ...makeReleaseTrustEvidenceRecord({ gateId: 'long-suite' }),
      mode: 'referenced',
      collectedHead: 'old-head',
      originalDate: '2026-08-25',
      originalHead: 'old-head',
      intervalChangeSummary: '相关路径未变化',
    }
    const bundle = {
      bundleId: 'missing-and-stale',
      collectedHead: 'old-head',
      capturedAt: '2026-08-27T08:00:01.000Z',
      records: [staleRecord],
    }
    const evaluation = evaluateReleaseTrust(bundle, RELEASE_TRUST_FIXTURE_HEAD, registry)
    expect(evaluation.decision).toBe('insufficient-evidence')
    expect(evaluation.missingGateIds).toHaveLength(1)
  })

  it('reports an upgraded public decision', () => {
    const fixture = makeUpgradedWordingReleaseTrustFixture()
    const evaluation = evaluateReleaseTrust(fixture.bundle, RELEASE_TRUST_FIXTURE_HEAD)
    expect(compareRecordedDecision(fixture.recordedDecision, evaluation)[0]?.code).toBe(
      'RTR-DECISION-001',
    )
  })

  it('rejects unredacted credential, token, secret, prompt and model-output shapes', () => {
    const findings = scanEvidenceBundleLowSensitive({
      authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
      apiKey: 'sk-abcdefghijklmnop',
      secret: 'secret=value',
      promptText: 'full prompt',
      modelOutput: 'full completion',
    })
    expect(new Set(findings.map((finding) => finding.kind))).toEqual(
      new Set(['token', 'credential', 'secret', 'prompt-content', 'model-output']),
    )
  })
})
