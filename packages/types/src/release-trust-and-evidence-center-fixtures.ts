import {
  RELEASE_TRUST_GATE_REGISTRY,
  evaluateReleaseTrust,
  type ReleaseTrustEvidenceBundle,
  type ReleaseTrustEvidenceRecord,
  type TrustDecision,
} from './release-trust-and-evidence-center.js'

export const RELEASE_TRUST_FIXTURE_HEAD = '8595bb8f31cba18da7d62fc26b40d64e5655b3a8'
const STARTED_AT = '2026-08-27T08:00:00.000Z'
const FINISHED_AT = '2026-08-27T08:00:01.000Z'
const DIGEST = `sha256:${'a'.repeat(64)}`

export function makeReleaseTrustEvidenceRecord(
  overrides: Partial<ReleaseTrustEvidenceRecord> & Pick<ReleaseTrustEvidenceRecord, 'gateId'>,
): ReleaseTrustEvidenceRecord {
  const { gateId, ...rest } = overrides
  return {
    recordId: `release-trust:${gateId}:fixture`,
    gateId,
    mode: 'rerun',
    command: `pnpm fixture ${gateId}`,
    exitCode: 0,
    startedAt: STARTED_AT,
    finishedAt: FINISHED_AT,
    collectedHead: RELEASE_TRUST_FIXTURE_HEAD,
    outputDigest: DIGEST,
    resultSummary: 'status=passed; exitCode=0',
    ...rest,
  } as ReleaseTrustEvidenceRecord
}

function makeBundle(
  name: string,
  records: readonly ReleaseTrustEvidenceRecord[],
): ReleaseTrustEvidenceBundle {
  return {
    bundleId: `release-trust-fixture:${name}`,
    collectedHead: RELEASE_TRUST_FIXTURE_HEAD,
    capturedAt: FINISHED_AT,
    records,
  }
}

export function makePassingReleaseTrustBundle(): ReleaseTrustEvidenceBundle {
  return makeBundle(
    'passing',
    RELEASE_TRUST_GATE_REGISTRY.map((entry) =>
      makeReleaseTrustEvidenceRecord({ gateId: entry.gateId }),
    ),
  )
}

export function makeBlockedReleaseTrustBundle(): ReleaseTrustEvidenceBundle {
  const passing = makePassingReleaseTrustBundle()
  return makeBundle(
    'blocked',
    passing.records.map((record, index) =>
      index === 0
        ? makeReleaseTrustEvidenceRecord({
            gateId: record.gateId,
            exitCode: 1,
            resultSummary: 'status=blocked; exitCode=1',
          })
        : record,
    ),
  )
}

export function makeStaleReleaseTrustBundle(): ReleaseTrustEvidenceBundle {
  const passing = makePassingReleaseTrustBundle()
  return makeBundle(
    'stale',
    passing.records.map((record, index) =>
      index === 0
        ? makeReleaseTrustEvidenceRecord({ gateId: record.gateId, collectedHead: 'old-head' })
        : record,
    ),
  )
}

export function makeMissingReleaseTrustBundle(): ReleaseTrustEvidenceBundle {
  const passing = makePassingReleaseTrustBundle()
  return makeBundle('missing', passing.records.slice(1))
}

export function makeUpgradedWordingReleaseTrustFixture(): {
  bundle: ReleaseTrustEvidenceBundle
  recordedDecision: TrustDecision
} {
  return { bundle: makeMissingReleaseTrustBundle(), recordedDecision: 'releasable' }
}

export function evaluatePassingReleaseTrustFixture() {
  return evaluateReleaseTrust(makePassingReleaseTrustBundle(), RELEASE_TRUST_FIXTURE_HEAD)
}
