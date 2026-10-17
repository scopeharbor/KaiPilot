import { describe, expect, it } from 'vitest'
import {
  CANARY_ADVISORY_FIXTURE_RESULT,
  CANARY_ADVISORY_MANIFEST,
  CANARY_ADVISORY_MANIFEST_DIGEST,
  CANARY_ADVISORY_PACKAGE_DIGEST,
  CANARY_QUERY_FIXTURE_RESULT,
  CANARY_QUERY_MANIFEST,
  CANARY_QUERY_MANIFEST_DIGEST,
  CANARY_QUERY_PACKAGE_DIGEST,
  assertCanaryNoFormalWrite,
  assertCanaryZeroProviderCalls,
  canaryContainsSensitiveKey,
  computeCanaryManifestDigest,
  computeCanaryPackageDigest,
  isCanaryZeroNetworkManifest,
  validateManifestShape,
} from './index.js'

describe('first-party plugin canary pack', () => {
  it.each([
    [CANARY_QUERY_MANIFEST, CANARY_QUERY_MANIFEST_DIGEST, CANARY_QUERY_PACKAGE_DIGEST],
    [CANARY_ADVISORY_MANIFEST, CANARY_ADVISORY_MANIFEST_DIGEST, CANARY_ADVISORY_PACKAGE_DIGEST],
  ])(
    'has valid deterministic identity/package digest and zero-network manifest',
    (manifest, manifestDigest, packageDigest) => {
      expect(validateManifestShape(manifest).valid).toBe(true)
      expect(computeCanaryManifestDigest(manifest)).toBe(manifestDigest)
      expect(computeCanaryPackageDigest(manifest)).toBe(packageDigest)
      expect(isCanaryZeroNetworkManifest(manifest)).toBe(true)
      expect(canaryContainsSensitiveKey(manifest)).toBe(false)
    },
  )

  it('advisory references the existing Skill instead of embedding an implementation', () => {
    const payload = (CANARY_ADVISORY_MANIFEST.contributions[0] as { entrypoint: { path: string } })
      .entrypoint
    expect(payload.path).toBe('canary/skill-bundle.json')
    expect(JSON.stringify(CANARY_ADVISORY_MANIFEST)).not.toMatch(
      /prompt|handler|implementation|provider/i,
    )
  })

  it.each([CANARY_QUERY_FIXTURE_RESULT, CANARY_ADVISORY_FIXTURE_RESULT])(
    'is advisory-only with providerCalls=0 and no formal write',
    (result) => {
      expect(assertCanaryZeroProviderCalls(result)).toBe(true)
      expect(assertCanaryNoFormalWrite(result)).toBe(true)
      expect(result.advisory).toBe(true)
    },
  )

  it('detects sensitive fields in corrupted packages', () => {
    expect(canaryContainsSensitiveKey({ nested: { apiKey: 'fixture' } })).toBe(true)
  })
})
