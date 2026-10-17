import { describe, expect, it } from 'vitest'
import {
  computeInstallPreviewDigest,
  computePermissionDigest,
  fnv1a32Install,
  installStableSerialize,
  isValidInstallTransition,
  sanitizeInstallForAudit,
  transitionPluginInstallStatus,
  validateInstallConfirmBinding,
  type PluginInstallAction,
  type PluginInstallationStatus,
} from './plugin-install-lifecycle.js'
import {
  createFixtureConfirmRequest,
  createFixtureEnablePreview,
  createFixturePreview,
  FIXTURE_PERMISSION_DIGEST,
  FIXTURE_PERMISSIONS,
  fixtureDisabledRecord,
  fixtureEnabledRecord,
  fixtureInstalledRecord,
  fixtureUninstalledRecord,
} from './plugin-install-lifecycle-fixtures.js'

describe('plugin-install-lifecycle state machine', () => {
  it('correctly validates legal state transitions', () => {
    // not_installed -> install -> installed
    expect(isValidInstallTransition('not_installed', 'install')).toBe(true)
    expect(transitionPluginInstallStatus('not_installed', 'install')).toEqual({
      nextStatus: 'installed',
    })

    // installed -> enable -> enabled
    expect(isValidInstallTransition('installed', 'enable')).toBe(true)
    expect(transitionPluginInstallStatus('installed', 'enable')).toEqual({
      nextStatus: 'enabled',
    })

    // enabled -> disable -> installed
    expect(isValidInstallTransition('enabled', 'disable')).toBe(true)
    expect(transitionPluginInstallStatus('enabled', 'disable')).toEqual({
      nextStatus: 'installed',
    })

    // installed -> uninstall -> uninstalled
    expect(isValidInstallTransition('installed', 'uninstall')).toBe(true)
    expect(transitionPluginInstallStatus('installed', 'uninstall')).toEqual({
      nextStatus: 'uninstalled',
    })

    // enabled -> uninstall -> uninstalled
    expect(isValidInstallTransition('enabled', 'uninstall')).toBe(true)
    expect(transitionPluginInstallStatus('enabled', 'uninstall')).toEqual({
      nextStatus: 'uninstalled',
    })

    // installed -> upgrade -> installed
    expect(isValidInstallTransition('installed', 'upgrade')).toBe(true)
    expect(transitionPluginInstallStatus('installed', 'upgrade')).toEqual({
      nextStatus: 'installed',
    })

    // enabled -> upgrade -> enabled
    expect(isValidInstallTransition('enabled', 'upgrade')).toBe(true)
    expect(transitionPluginInstallStatus('enabled', 'upgrade')).toEqual({
      nextStatus: 'enabled',
    })
  })

  it('rejects illegal state transitions with stable error codes', () => {
    // not_installed cannot enable/disable/uninstall/upgrade
    const illegalActionsFromNotInstalled: PluginInstallAction[] = [
      'enable',
      'disable',
      'uninstall',
      'upgrade',
    ]
    for (const act of illegalActionsFromNotInstalled) {
      expect(isValidInstallTransition('not_installed', act)).toBe(false)
      expect(transitionPluginInstallStatus('not_installed', act)).toEqual({
        error: 'plugin-install-illegal-transition',
      })
    }

    // installed cannot disable or repeat install
    expect(isValidInstallTransition('installed', 'disable')).toBe(false)
    expect(transitionPluginInstallStatus('installed', 'disable')).toEqual({
      error: 'plugin-install-illegal-transition',
    })
    expect(isValidInstallTransition('installed', 'install')).toBe(false)
    expect(transitionPluginInstallStatus('installed', 'install')).toEqual({
      error: 'plugin-install-illegal-transition',
    })

    // enabled cannot enable again or repeat install
    expect(isValidInstallTransition('enabled', 'enable')).toBe(false)
    expect(transitionPluginInstallStatus('enabled', 'enable')).toEqual({
      error: 'plugin-install-illegal-transition',
    })
    expect(isValidInstallTransition('enabled', 'install')).toBe(false)
    expect(transitionPluginInstallStatus('enabled', 'install')).toEqual({
      error: 'plugin-install-illegal-transition',
    })

    // uninstalled is terminal: no action allowed
    const allActions: PluginInstallAction[] = [
      'install',
      'enable',
      'disable',
      'uninstall',
      'upgrade',
    ]
    for (const act of allActions) {
      expect(isValidInstallTransition('uninstalled', act)).toBe(false)
      expect(transitionPluginInstallStatus('uninstalled', act)).toEqual({
        error: 'plugin-install-already-uninstalled',
      })
    }
  })

  it('provides deterministic pure function hashing and digest serialization', () => {
    const s1 = installStableSerialize({ b: 2, a: 1 })
    const s2 = installStableSerialize({ a: 1, b: 2 })
    expect(s1).toBe(s2)
    expect(fnv1a32Install(s1)).toBe(fnv1a32Install(s2))

    // Permission digest is order independent
    const pDigest1 = computePermissionDigest(['b_perm', 'a_perm'])
    const pDigest2 = computePermissionDigest(['a_perm', 'b_perm'])
    expect(pDigest1).toBe(pDigest2)
    expect(pDigest1).toHaveLength(8)
  })

  it('validates preview and confirmation binding', () => {
    const preview = createFixtureEnablePreview()
    const validRequest = createFixtureConfirmRequest(preview)

    // Valid binding
    const res = validateInstallConfirmBinding(
      preview,
      validRequest,
      new Date('2026-08-19T09:02:00.000Z'),
    )
    expect(res.valid).toBe(true)

    // Expired handle
    const expiredRes = validateInstallConfirmBinding(
      preview,
      validRequest,
      new Date('2026-08-19T09:10:00.000Z'),
    )
    expect(expiredRes.valid).toBe(false)
    if (!expiredRes.valid) {
      expect(expiredRes.error).toBe('plugin-install-preview-expired')
    }

    // Digest mismatch
    const badDigestReq = createFixtureConfirmRequest(preview, {
      previewDigest: 'corrupted-digest',
    })
    const badDigestRes = validateInstallConfirmBinding(
      preview,
      badDigestReq,
      new Date('2026-08-19T09:02:00.000Z'),
    )
    expect(badDigestRes.valid).toBe(false)
    if (!badDigestRes.valid) {
      expect(badDigestRes.error).toBe('plugin-install-preview-digest-mismatch')
    }

    // Enable requires permission confirmation
    const unconfirmedReq = createFixtureConfirmRequest(preview, {
      permissionConfirmed: false,
    })
    const unconfirmedRes = validateInstallConfirmBinding(
      preview,
      unconfirmedReq,
      new Date('2026-08-19T09:02:00.000Z'),
    )
    expect(unconfirmedRes.valid).toBe(false)
    if (!unconfirmedRes.valid) {
      expect(unconfirmedRes.error).toBe('plugin-install-permission-unconfirmed')
    }

    // Permission digest mismatch
    const permMismatchReq = createFixtureConfirmRequest(preview, {
      permissionConfirmed: true,
      permissionDigest: 'wrong-perm-digest',
    })
    const permMismatchRes = validateInstallConfirmBinding(
      preview,
      permMismatchReq,
      new Date('2026-08-19T09:02:00.000Z'),
    )
    expect(permMismatchRes.valid).toBe(false)
    if (!permMismatchRes.valid) {
      expect(permMismatchRes.error).toBe('plugin-install-permission-digest-mismatch')
    }
  })

  it('sanitizes audit objects to eliminate secrets and tokens', () => {
    const raw = {
      pluginId: 'test-plugin',
      apiKey: 'sk_123456789012345678901234567890',
      authHeader: 'Bearer secret-jwt-token',
      metadata: {
        normalField: 'ok-value',
        nestedSecret: 'ghp_abcdefghijklmnopqrstuvwxyz123456',
      },
    }

    const sanitized = sanitizeInstallForAudit(raw)
    expect(sanitized).not.toHaveProperty('apiKey')
    expect(sanitized.authHeader).toBe('[REDACTED]')
    expect((sanitized.metadata as any)?.normalField).toBe('ok-value')
    expect((sanitized.metadata as any)?.nestedSecret).toBeUndefined()
  })

  it('validates records in 5 lifecycle fixtures', () => {
    expect(fixtureInstalledRecord.status).toBe('installed')
    expect(fixtureInstalledRecord.permissionConfirmation).toBeNull()

    expect(fixtureEnabledRecord.status).toBe('enabled')
    expect(fixtureEnabledRecord.permissionConfirmation?.permissionDigest).toBe(
      FIXTURE_PERMISSION_DIGEST,
    )

    expect(fixtureDisabledRecord.status).toBe('installed')
    expect(fixtureDisabledRecord.permissionConfirmation).toBeNull()

    expect(fixtureUninstalledRecord.status).toBe('uninstalled')
    expect(fixtureUninstalledRecord.uninstalledAt).not.toBeNull()
  })
})
