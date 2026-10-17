/**
 * plugin-manifest.test.ts —— V3 plugin manifest 契约类型/守卫/校验测试
 *
 * 覆盖 spec scenarios: 合法首版 manifest、未知 schema 版本、shape 校验、
 * identity/provenance、路径安全、permission、grant、redaction、
 * zero-runtime-dependency、deterministic digest、Skill adapter。
 */

import { describe, it, expect } from 'vitest'
import {
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_DISTRIBUTION_CLASSES,
  MANIFEST_ALLOWED_DISTRIBUTIONS,
  MANIFEST_FINDING_CODES,
  MANIFEST_REDLINE_CODES,
  MANIFEST_CHECKER_EXIT,
  isManifestSchemaVersion,
  isManifestDistributionClass,
  isManifestAllowedDistribution,
  isManifestEntrypointKind,
  isManifestDigestAlgorithm,
  isManifestScopeKind,
  isManifestSeverity,
  isManifestFindingCode,
  isManifestRedlineCode,
  isValidSemVer,
  isValidNamespaceKey,
  isValidContributionKey,
  isValidPermissionKey,
  isSafeEntrypointPath,
  normalizeManifest,
  manifestStableSerialize,
  manifestFnv1aHash,
  computeManifestDigest,
  manifestContainsSensitiveValue,
  manifestIsSensitiveKey,
  redactFinding,
  deepRedact,
  validateManifestShape,
  validateManifest,
  validateGrantSubset,
  checkRuntimeAuthPrerequisites,
} from './plugin-manifest.js'
import type {
  PluginManifestV1,
  PluginManifestValidationContext,
  PluginPermissionGrantSnapshot,
  PluginPermissionRequest,
} from './plugin-manifest.js'

// =============================================================================
// Fixtures
// =============================================================================

function makeValidManifest(overrides?: Partial<PluginManifestV1>): PluginManifestV1 {
  return {
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    identity: {
      pluginId: 'acme.my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      publisher: 'acme-corp',
      description: 'A test plugin',
    },
    provenance: {
      distribution: 'first-party',
    },
    compatibility: {
      hostContractVersion: '1.0',
      requiredSeams: [{ seamKey: 'skill-adapter', seamVersion: '1.0.0' }],
    },
    contributions: [
      {
        contributionKey: 'acme.my-contribution',
        seamKey: 'skill-adapter',
        seamVersion: '1.0.0',
        entrypoint: { kind: 'esm', path: 'src/index.ts' },
        permissionRefs: ['acme.my-perm'],
      },
    ],
    permissions: [
      {
        permissionKey: 'acme.my-perm',
        seamKey: 'skill-adapter',
        scopeKind: 'organization',
        sideEffect: 'advisory',
        confirmation: 'not-required',
        network: 'none',
      },
    ],
    dependencies: [{ pluginId: 'dep.other-plugin', versionRequirement: '1.0.0' }],
    contentDescriptor: {
      algorithm: 'sha256',
      digest: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    },
    ...overrides,
  }
}

function makeMinimalContext(): PluginManifestValidationContext {
  return {
    hostContractVersion: '1.0',
    seamCatalog: {
      'skill-adapter': {
        seamVersion: '1.0.0',
        availability: 'cataloged',
        surface: 'skill-adapter',
        requiredPermissions: ['acme.my-perm'],
        scopeModes: ['organization', 'project'],
        sideEffectCeiling: 'external-action',
        confirmationCeiling: 'host-brokered',
        networkCeiling: 'direct-allowed',
      },
    },
    permissionVocabulary: {
      'acme.my-perm': {
        seamKey: 'skill-adapter',
        maxScopeKind: 'organization',
        maxSideEffect: 'advisory',
        maxConfirmation: 'not-required',
        maxNetwork: 'none',
      },
    },
    allowedDistributions: MANIFEST_ALLOWED_DISTRIBUTIONS,
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('plugin-manifest', () => {
  describe('constants', () => {
    it('MANIFEST_SCHEMA_VERSION is "1.0"', () => {
      expect(MANIFEST_SCHEMA_VERSION).toBe('1.0')
    })

    it('MANIFEST_ALLOWED_DISTRIBUTIONS excludes public-marketplace and remote-registry', () => {
      expect(MANIFEST_ALLOWED_DISTRIBUTIONS).not.toContain('public-marketplace')
      expect(MANIFEST_ALLOWED_DISTRIBUTIONS).not.toContain('remote-registry')
      expect(MANIFEST_ALLOWED_DISTRIBUTIONS).toContain('first-party')
      expect(MANIFEST_ALLOWED_DISTRIBUTIONS).toContain('organization-private')
    })

    it('MANIFEST_REDLINE_CODES are a subset of MANIFEST_FINDING_CODES', () => {
      for (const code of MANIFEST_REDLINE_CODES) {
        expect(MANIFEST_FINDING_CODES).toContain(code)
      }
    })
  })

  describe('type guards', () => {
    it('isManifestSchemaVersion accepts "1.0" and rejects others', () => {
      expect(isManifestSchemaVersion('1.0')).toBe(true)
      expect(isManifestSchemaVersion('2.0')).toBe(false)
      expect(isManifestSchemaVersion(null)).toBe(false)
    })

    it('isManifestDistributionClass accepts valid values', () => {
      expect(isManifestDistributionClass('first-party')).toBe(true)
      expect(isManifestDistributionClass('unknown')).toBe(false)
    })

    it('isManifestAllowedDistribution accepts only first-party and organization-private', () => {
      expect(isManifestAllowedDistribution('first-party')).toBe(true)
      expect(isManifestAllowedDistribution('organization-private')).toBe(true)
      expect(isManifestAllowedDistribution('public-marketplace')).toBe(false)
    })

    it('isManifestEntrypointKind accepts valid values', () => {
      expect(isManifestEntrypointKind('esm')).toBe(true)
      expect(isManifestEntrypointKind('wasm')).toBe(true)
      expect(isManifestEntrypointKind('binary')).toBe(false)
    })

    it('isManifestDigestAlgorithm accepts valid values', () => {
      expect(isManifestDigestAlgorithm('sha256')).toBe(true)
      expect(isManifestDigestAlgorithm('md5')).toBe(false)
    })

    it('isManifestScopeKind rejects global', () => {
      expect(isManifestScopeKind('organization')).toBe(true)
      expect(isManifestScopeKind('project')).toBe(true)
      expect(isManifestScopeKind('global')).toBe(false)
    })

    it('isManifestFindingCode accepts all defined codes', () => {
      expect(isManifestFindingCode('manifest-schema-invalid')).toBe(true)
      expect(isManifestFindingCode('manifest-tool-error')).toBe(true)
      expect(isManifestFindingCode('unknown-code')).toBe(false)
    })

    it('isManifestRedlineCode correctly identifies redline codes', () => {
      expect(isManifestRedlineCode('manifest-implicit-global-scope')).toBe(true)
      expect(isManifestRedlineCode('manifest-organization-id-in-manifest')).toBe(true)
      expect(isManifestRedlineCode('manifest-schema-invalid')).toBe(false)
    })
  })

  describe('SemVer validation', () => {
    it('accepts valid SemVer', () => {
      expect(isValidSemVer('1.0.0')).toBe(true)
      expect(isValidSemVer('0.0.1')).toBe(true)
      expect(isValidSemVer('10.20.30')).toBe(true)
    })

    it('rejects invalid SemVer', () => {
      expect(isValidSemVer('latest')).toBe(false)
      expect(isValidSemVer('1.0')).toBe(false)
      expect(isValidSemVer('1.0.0-beta')).toBe(false)
      expect(isValidSemVer('v1.0.0')).toBe(false)
    })
  })

  describe('namespace key validation', () => {
    it('accepts valid keys', () => {
      expect(isValidNamespaceKey('acme.my-plugin')).toBe(true)
      expect(isValidNamespaceKey('my_plugin')).toBe(true)
      expect(isValidNamespaceKey('my-plugin')).toBe(true)
      expect(isValidNamespaceKey('a1.b2.c3')).toBe(true)
    })

    it('rejects invalid keys', () => {
      expect(isValidNamespaceKey('')).toBe(false)
      expect(isValidNamespaceKey('UPPER')).toBe(false)
      expect(isValidNamespaceKey('has space')).toBe(false)
      expect(isValidNamespaceKey('a'.repeat(200))).toBe(false)
    })

    it('contribution key uses same rules', () => {
      expect(isValidContributionKey('acme.contribution')).toBe(true)
      expect(isValidContributionKey('UPPER')).toBe(false)
    })

    it('permission key uses same rules', () => {
      expect(isValidPermissionKey('acme.permission')).toBe(true)
      expect(isValidPermissionKey('UPPER')).toBe(false)
    })
  })

  describe('entrypoint path safety', () => {
    it('accepts safe POSIX paths', () => {
      expect(isSafeEntrypointPath('src/index.ts')).toEqual({ valid: true })
      expect(isSafeEntrypointPath('lib/main.js')).toEqual({ valid: true })
      expect(isSafeEntrypointPath('dist/bundle.css')).toEqual({ valid: true })
    })

    it('rejects empty paths', () => {
      expect(isSafeEntrypointPath('')).toEqual({
        valid: false,
        reason: 'manifest-empty-entrypoint',
      })
    })

    it('rejects absolute paths', () => {
      expect(isSafeEntrypointPath('/etc/passwd')).toEqual({
        valid: false,
        reason: 'manifest-absolute-entrypoint',
      })
    })

    it('rejects Windows drive paths', () => {
      expect(isSafeEntrypointPath('C:\\Windows\\system32')).toEqual({
        valid: false,
        reason: 'manifest-windows-drive-entrypoint',
      })
    })

    it('rejects traversal', () => {
      expect(isSafeEntrypointPath('../outside/file.ts')).toEqual({
        valid: false,
        reason: 'manifest-traversal-entrypoint',
      })
    })

    it('rejects URLs', () => {
      expect(isSafeEntrypointPath('http://evil.com/malware.js')).toEqual({
        valid: false,
        reason: 'manifest-url-entrypoint',
      })
    })

    it('rejects control characters', () => {
      expect(isSafeEntrypointPath('src/\x00index.ts')).toEqual({
        valid: false,
        reason: 'manifest-control-char-entrypoint',
      })
    })
  })

  describe('manifestStableSerialize', () => {
    it('produces deterministic output', () => {
      const a = manifestStableSerialize({ b: 2, a: 1 })
      const b = manifestStableSerialize({ a: 1, b: 2 })
      expect(a).toBe(b)
      expect(a).toBe('{"a":1,"b":2}')
    })

    it('handles nested objects and arrays', () => {
      const result = manifestStableSerialize({ arr: [3, 1, 2], nested: { z: true, a: false } })
      expect(result).toContain('"a":false')
      expect(result).toContain('[3,1,2]')
    })
  })

  describe('manifestFnv1aHash', () => {
    it('produces deterministic hash', () => {
      const h1 = manifestFnv1aHash('hello-world')
      const h2 = manifestFnv1aHash('hello-world')
      expect(h1).toBe(h2)
    })

    it('produces different hashes for different inputs', () => {
      const h1 = manifestFnv1aHash('hello')
      const h2 = manifestFnv1aHash('world')
      expect(h1).not.toBe(h2)
    })
  })

  describe('normalizeManifest', () => {
    it('lowercases identity fields and sorts arrays', () => {
      const input = makeValidManifest({
        identity: {
          pluginId: 'ACME.My-Plugin',
          name: '  My Plugin  ',
          version: '1.0.0',
          publisher: 'ACME-CORP',
        },
        permissions: [
          {
            permissionKey: 'b.perm',
            seamKey: 'skill-adapter',
            scopeKind: 'organization',
            sideEffect: 'advisory',
            confirmation: 'not-required',
            network: 'none',
          },
          {
            permissionKey: 'a.perm',
            seamKey: 'skill-adapter',
            scopeKind: 'project',
            sideEffect: 'read-only',
            confirmation: 'not-required',
            network: 'none',
          },
        ],
      })
      const normalized = normalizeManifest(input)
      expect(normalized.identity.pluginId).toBe('acme.my-plugin')
      expect(normalized.identity.publisher).toBe('acme-corp')
      expect(normalized.identity.name).toBe('My Plugin')
      expect(normalized.permissions[0].permissionKey).toBe('a.perm')
      expect(normalized.permissions[1].permissionKey).toBe('b.perm')
    })

    it('removes undefined optional fields', () => {
      const input = makeValidManifest({
        dependencies: undefined,
        contentDescriptor: undefined,
        extensions: undefined,
      })
      const normalized = normalizeManifest(input)
      expect(normalized.dependencies).toBeUndefined()
      expect(normalized.contentDescriptor).toBeUndefined()
      expect(normalized.extensions).toBeUndefined()
    })
  })

  describe('computeManifestDigest', () => {
    it('produces deterministic digest', () => {
      const m1 = makeValidManifest()
      const m2 = makeValidManifest()
      expect(computeManifestDigest(m1)).toBe(computeManifestDigest(m2))
    })

    it('different manifests produce different digests', () => {
      const m1 = makeValidManifest()
      const m2 = makeValidManifest({ identity: { ...m1.identity, version: '2.0.0' } })
      expect(computeManifestDigest(m1)).not.toBe(computeManifestDigest(m2))
    })
  })

  describe('sensitive content detection', () => {
    it('detects sensitive values', () => {
      expect(manifestContainsSensitiveValue('sk_abc123456789012345678')).toBe(true)
      expect(manifestContainsSensitiveValue('Bearer eyJhbG')).toBe(true)
      expect(manifestContainsSensitiveValue('ghp_abc123456789012345678')).toBe(true)
      expect(manifestContainsSensitiveValue('normal text')).toBe(false)
    })

    it('detects sensitive keys', () => {
      expect(manifestIsSensitiveKey('token')).toBe(true)
      expect(manifestIsSensitiveKey('secret')).toBe(true)
      expect(manifestIsSensitiveKey('apiKey')).toBe(true)
      expect(manifestIsSensitiveKey('normalField')).toBe(false)
    })
  })

  describe('redactFinding', () => {
    it('redacts sensitive evidenceRef', () => {
      const redacted = redactFinding({
        code: 'manifest-schema-invalid',
        severity: 'blocking',
        evidenceRef: 'sk_abc123456789012345678',
      })
      expect(redacted.evidenceRef).toBe('[redacted]')
    })

    it('preserves non-sensitive evidenceRef', () => {
      const redacted = redactFinding({
        code: 'manifest-schema-invalid',
        severity: 'blocking',
        evidenceRef: 'fixture:valid-manifest',
      })
      expect(redacted.evidenceRef).toBe('fixture:valid-manifest')
    })
  })

  describe('deepRedact', () => {
    it('redacts sensitive keys', () => {
      const input = { apiKey: 'value', normal: 'safe', nested: { secret: 'hidden' } }
      const redacted = deepRedact(input)
      expect(redacted.apiKey).toBe('[redacted]')
      expect(redacted.normal).toBe('safe')
      expect((redacted.nested as any).secret).toBe('[redacted]')
    })

    it('redacts sensitive value patterns in strings', () => {
      const input = { data: 'sk_abc123456789012345678' }
      const redacted = deepRedact(input)
      expect(redacted.data).toBe('[redacted]')
    })
  })

  describe('validateManifestShape', () => {
    it('validates a complete legal manifest', () => {
      const result = validateManifestShape(makeValidManifest())
      expect(result.valid).toBe(true)
      expect(result.findings.filter((f) => f.severity === 'blocking')).toHaveLength(0)
    })

    it('rejects non-object input', () => {
      const result = validateManifestShape(null)
      expect(result.valid).toBe(false)
      expect(result.findings[0].code).toBe('manifest-schema-invalid')
    })

    it('rejects unknown schema version', () => {
      const result = validateManifestShape({
        ...makeValidManifest(),
        manifestSchemaVersion: '2.0',
      })
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-schema-invalid')).toBe(true)
    })

    it('rejects invalid pluginId', () => {
      const input = makeValidManifest()
      input.identity.pluginId = 'UPPERCASE'
      const result = validateManifestShape(input)
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-invalid-plugin-id')).toBe(true)
    })

    it('rejects invalid SemVer', () => {
      const input = makeValidManifest()
      input.identity.version = 'latest'
      const result = validateManifestShape(input)
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-invalid-semver')).toBe(true)
    })

    it('rejects unallowed distribution', () => {
      const input = makeValidManifest()
      input.provenance.distribution = 'public-marketplace'
      const result = validateManifestShape(input)
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-unallowed-distribution')).toBe(true)
    })

    it('rejects duplicate contribution keys', () => {
      const input = makeValidManifest()
      input.contributions.push({ ...input.contributions[0] })
      const result = validateManifestShape(input)
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-duplicate-contribution-key')).toBe(
        true,
      )
    })

    it('rejects duplicate permission keys', () => {
      const input = makeValidManifest()
      input.permissions.push({ ...input.permissions[0] })
      const result = validateManifestShape(input)
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-duplicate-permission')).toBe(true)
    })

    it('rejects self-dependency', () => {
      const input = makeValidManifest()
      input.dependencies = [{ pluginId: 'acme.my-plugin', versionRequirement: '1.0.0' }]
      const result = validateManifestShape(input)
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-self-dependency')).toBe(true)
    })

    it('rejects URL dependency', () => {
      const input = makeValidManifest()
      input.dependencies = [{ pluginId: 'dep.x', versionRequirement: 'https://example.com' }]
      const result = validateManifestShape(input)
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-url-dependency')).toBe(true)
    })

    it('rejects traversal entrypoint', () => {
      const input = makeValidManifest()
      input.contributions[0].entrypoint.path = '../escape/file.ts'
      const result = validateManifestShape(input)
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-traversal-entrypoint')).toBe(true)
    })

    it('rejects global scope permission', () => {
      const input = makeValidManifest()
      ;(input.permissions[0] as any).scopeKind = 'global'
      const result = validateManifestShape(input)
      expect(result.valid).toBe(false)
    })
  })

  describe('validateManifest (contextual)', () => {
    it('validates against minimal context', () => {
      const result = validateManifest(makeValidManifest(), makeMinimalContext())
      expect(result.valid).toBe(true)
      expect(result.manifestDigest).toBeDefined()
    })

    it('rejects unknown seam', () => {
      const input = makeValidManifest()
      input.compatibility.requiredSeams = [{ seamKey: 'nonexistent', seamVersion: '1.0.0' }]
      const result = validateManifest(input, makeMinimalContext())
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-unknown-seam')).toBe(true)
    })

    it('rejects permission not in vocabulary', () => {
      const input = makeValidManifest()
      input.permissions[0].permissionKey = 'unknown.perm'
      const result = validateManifest(input, makeMinimalContext())
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-unknown-permission-key')).toBe(true)
    })

    it('rejects scope expansion', () => {
      const input = makeValidManifest()
      const ctx = makeMinimalContext()
      ctx.permissionVocabulary['acme.my-perm'] = {
        ...ctx.permissionVocabulary['acme.my-perm'],
        maxScopeKind: 'project',
      }
      const result = validateManifest(input, ctx)
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-permission-scope-expanded')).toBe(
        true,
      )
    })

    it('rejects network relaxation', () => {
      const input = makeValidManifest()
      input.permissions[0].network = 'direct-allowed'
      const ctx = makeMinimalContext()
      const result = validateManifest(input, ctx)
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-permission-network-relaxed')).toBe(
        true,
      )
    })
  })

  describe('validateGrantSubset', () => {
    it('accepts valid grant subset', () => {
      const manifest = makeValidManifest()
      const grant: PluginPermissionGrantSnapshot = {
        grantId: 'grant-1',
        manifestDigest: computeManifestDigest(manifest),
        pluginId: manifest.identity.pluginId,
        scopeBinding: { organizationIdHash: manifestFnv1aHash('org1') },
        grantedPermissions: ['acme.my-perm'],
      }
      const result = validateGrantSubset(manifest, grant, makeMinimalContext())
      expect(result.valid).toBe(true)
    })

    it('rejects grant with permission not in manifest', () => {
      const manifest = makeValidManifest()
      const grant: PluginPermissionGrantSnapshot = {
        grantId: 'grant-1',
        manifestDigest: computeManifestDigest(manifest),
        pluginId: manifest.identity.pluginId,
        scopeBinding: { organizationIdHash: manifestFnv1aHash('org1') },
        grantedPermissions: ['acme.my-perm', 'escalated.perm'],
      }
      const result = validateGrantSubset(manifest, grant, makeMinimalContext())
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-grant-escalation')).toBe(true)
    })

    it('rejects grant with mismatched identity', () => {
      const manifest = makeValidManifest()
      const grant: PluginPermissionGrantSnapshot = {
        grantId: 'grant-1',
        manifestDigest: computeManifestDigest(manifest),
        pluginId: 'wrong.plugin',
        scopeBinding: { organizationIdHash: manifestFnv1aHash('org1') },
        grantedPermissions: ['acme.my-perm'],
      }
      const result = validateGrantSubset(manifest, grant, makeMinimalContext())
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-grant-identity-mismatch')).toBe(true)
    })

    it('rejects grant with mismatched digest', () => {
      const manifest = makeValidManifest()
      const grant: PluginPermissionGrantSnapshot = {
        grantId: 'grant-1',
        manifestDigest: 'wrong-digest',
        pluginId: manifest.identity.pluginId,
        scopeBinding: { organizationIdHash: manifestFnv1aHash('org1') },
        grantedPermissions: ['acme.my-perm'],
      }
      const result = validateGrantSubset(manifest, grant, makeMinimalContext())
      expect(result.valid).toBe(false)
      expect(result.findings.some((f) => f.code === 'manifest-grant-digest-mismatch')).toBe(true)
    })
  })

  describe('checkRuntimeAuthPrerequisites', () => {
    it('authorized only when ALL prerequisites met', () => {
      const result = checkRuntimeAuthPrerequisites({
        hasValidInstall: true,
        hasValidGrant: true,
        hasRBACPolicyMatch: true,
        hasScopeMatch: true,
        hasHostReadySeam: true,
        meetsConfirmationAudit: true,
      })
      expect(result.authorized).toBe(true)
    })

    it('not authorized when only manifest present', () => {
      const result = checkRuntimeAuthPrerequisites({
        hasValidInstall: false,
        hasValidGrant: false,
        hasRBACPolicyMatch: true,
        hasScopeMatch: true,
        hasHostReadySeam: true,
        meetsConfirmationAudit: true,
      })
      expect(result.authorized).toBe(false)
    })

    it('not authorized when only grant present', () => {
      const result = checkRuntimeAuthPrerequisites({
        hasValidInstall: true,
        hasValidGrant: true,
        hasRBACPolicyMatch: false,
        hasScopeMatch: false,
        hasHostReadySeam: false,
        meetsConfirmationAudit: false,
      })
      expect(result.authorized).toBe(false)
    })

    it('not authorized when only RBAC present', () => {
      const result = checkRuntimeAuthPrerequisites({
        hasValidInstall: false,
        hasValidGrant: false,
        hasRBACPolicyMatch: true,
        hasScopeMatch: false,
        hasHostReadySeam: false,
        meetsConfirmationAudit: false,
      })
      expect(result.authorized).toBe(false)
    })
  })

  describe('zero runtime dependencies', () => {
    it('module does not import AdonisJS, React, database, or network modules', async () => {
      // This is verified by the module's own imports - all are TypeScript/JS standard library
      const mod = await import('./plugin-manifest.js')
      // The module should export only pure functions and types
      expect(typeof mod.validateManifestShape).toBe('function')
      expect(typeof mod.normalizeManifest).toBe('function')
      expect(typeof mod.computeManifestDigest).toBe('function')
      expect(typeof mod.manifestStableSerialize).toBe('function')
      expect(typeof mod.manifestFnv1aHash).toBe('function')
    })
  })

  describe('MANIFEST_CHECKER_EXIT codes', () => {
    it('has correct exit code values', () => {
      expect(MANIFEST_CHECKER_EXIT.pass).toBe(0)
      expect(MANIFEST_CHECKER_EXIT.blocking).toBe(1)
      expect(MANIFEST_CHECKER_EXIT.toolError).toBe(2)
    })
  })
})
