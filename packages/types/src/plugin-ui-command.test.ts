/**
 * plugin-ui-command.test.ts —— V3 插件 UI command contribution 共享契约测试
 *
 * 覆盖 tasks 2.2, 2.4, 2.6, 2.8, 2.10, 2.12：
 * - shape 合法性、未知版本/字段、可执行内容
 * - snapshot 契约、跨组织零泄露
 * - 确定性排序、重复检测、核心冲突
 * - 资格矩阵（enabled/disabled/quarantined/grant revoke/scope mismatch/host-not-ready）
 * - 低敏 sanitizer
 * - fixtures 一致性
 */

import { describe, it, expect } from 'vitest'
import {
  PLUGIN_UI_COMMAND_SCHEMA_VERSION,
  PLUGIN_UI_COMMAND_SURFACES,
  PLUGIN_UI_COMMAND_ACTION_KINDS,
  PLUGIN_UI_COMMAND_SCOPE_KINDS,
  PLUGIN_UI_COMMAND_FINDING_SEVERITIES,
  PLUGIN_UI_COMMAND_FINDING_REASONS,
  PLUGIN_UI_COMMAND_MAX_LABEL_LENGTH,
  PLUGIN_UI_COMMAND_MAX_KEYWORDS,
  PLUGIN_UI_COMMAND_MAX_KEYWORD_LENGTH,
  PLUGIN_UI_COMMAND_MAX_PER_OWNER,
  isValidUiCommandContributionKey,
  isValidPluginId,
  isValidIconKey,
  isValidActionKey,
  isPluginUiCommandActionKind,
  isPluginUiCommandSurface,
  isPluginUiCommandFindingReason,
  contributionSortKey,
  deriveCommandId,
  contributionCanonical,
  validateContribution,
  sortFindings,
  normalizeAndProject,
  sanitizeFinding,
  sanitizeFindings,
  containsSensitiveKeys,
} from './plugin-ui-command.js'
import type {
  PluginUiCommandContributionV1,
  PluginUiCommandHostSnapshot,
  PluginUiCommandFinding,
} from './plugin-ui-command.js'
import {
  VALID_NAVIGATION_CONTRIBUTION,
  VALID_FORM_CONTRIBUTION,
  VALID_CONFIRM_CONTRIBUTION,
  MALICIOUS_FUNCTION_CONTRIBUTION,
  MALICIOUS_IFRAME_CONTRIBUTION,
  UNKNOWN_ACTION_CONTRIBUTION,
  UNKNOWN_SURFACE_CONTRIBUTION,
  VALID_HOST_SNAPSHOT,
  DISABLED_HOST_SNAPSHOT,
  QUARANTINED_HOST_SNAPSHOT,
  EXPIRED_GRANT_HOST_SNAPSHOT,
  HOST_NOT_READY_SNAPSHOT,
  CROSS_TENANT_SNAPSHOT,
  EMPTY_CONTRIBUTIONS_SNAPSHOT,
  ALL_ACCEPTED_RESULT,
  BLOCKING_FINDINGS_RESULT,
  WARNING_FINDINGS_RESULT,
  FINDING_SAMPLES,
  generateContributions,
} from './plugin-ui-command-fixtures.js'

// =============================================================================
// 1. 枚举与常量测试
// =============================================================================

describe('plugin-ui-command enums and constants', () => {
  it('schema version is "1"', () => {
    expect(PLUGIN_UI_COMMAND_SCHEMA_VERSION).toBe('1')
  })

  it('surfaces contains only command-palette', () => {
    expect(PLUGIN_UI_COMMAND_SURFACES).toEqual(['command-palette'])
  })

  it('action kinds are closed set of 4 (preview-open added by v3-command-palette-plugin-action-pack)', () => {
    expect(PLUGIN_UI_COMMAND_ACTION_KINDS).toEqual([
      'navigate',
      'open-form',
      'open-confirm',
      'open-plugin-action-preview',
    ])
  })

  it('scope kinds are organization and project', () => {
    expect(PLUGIN_UI_COMMAND_SCOPE_KINDS).toEqual(['organization', 'project'])
  })

  it('finding severities has 3 levels', () => {
    expect(PLUGIN_UI_COMMAND_FINDING_SEVERITIES).toEqual(['blocking', 'warning', 'info'])
  })

  it('finding reasons are stable and known', () => {
    expect(PLUGIN_UI_COMMAND_FINDING_REASONS.length).toBeGreaterThan(20)
  })

  it('max lengths are defined', () => {
    expect(PLUGIN_UI_COMMAND_MAX_LABEL_LENGTH).toBe(120)
    expect(PLUGIN_UI_COMMAND_MAX_KEYWORDS).toBe(10)
    expect(PLUGIN_UI_COMMAND_MAX_KEYWORD_LENGTH).toBe(60)
    expect(PLUGIN_UI_COMMAND_MAX_PER_OWNER).toBe(50)
  })
})

// =============================================================================
// 2. Type guard tests
// =============================================================================

describe('plugin-ui-command type guards', () => {
  it('isValidUiCommandContributionKey accepts valid keys', () => {
    expect(isValidUiCommandContributionKey('open-analytics')).toBe(true)
    expect(isValidUiCommandContributionKey('cmd_001')).toBe(true)
    expect(isValidUiCommandContributionKey('a')).toBe(true)
    expect(isValidUiCommandContributionKey('A123-test_456')).toBe(true)
  })

  it('isValidUiCommandContributionKey rejects invalid keys', () => {
    expect(isValidUiCommandContributionKey('')).toBe(false)
    expect(isValidUiCommandContributionKey('has space')).toBe(false)
    expect(isValidUiCommandContributionKey('has@special')).toBe(false)
    expect(isValidUiCommandContributionKey('a'.repeat(81))).toBe(false)
  })

  it('isValidPluginId accepts valid IDs', () => {
    expect(isValidPluginId('my-plugin')).toBe(true)
    expect(isValidPluginId('plugin_1')).toBe(true)
  })

  it('isValidPluginId rejects invalid IDs', () => {
    expect(isValidPluginId('')).toBe(false)
    expect(isValidPluginId('has space')).toBe(false)
  })

  it('isValidIconKey accepts valid keys', () => {
    expect(isValidIconKey('BarChart3')).toBe(true)
    expect(isValidIconKey('alert-triangle')).toBe(true)
  })

  it('isValidIconKey rejects invalid keys', () => {
    expect(isValidIconKey('')).toBe(false)
    expect(isValidIconKey('has space')).toBe(false)
  })

  it('isValidActionKey accepts valid keys', () => {
    expect(isValidActionKey('navigate')).toBe(true)
    expect(isValidActionKey('open-form')).toBe(true)
  })

  it('isValidActionKey rejects invalid keys', () => {
    expect(isValidActionKey('')).toBe(false)
    expect(isValidActionKey('has space')).toBe(false)
  })

  it('isPluginUiCommandActionKind identifies known kinds', () => {
    expect(isPluginUiCommandActionKind('navigate')).toBe(true)
    expect(isPluginUiCommandActionKind('open-form')).toBe(true)
    expect(isPluginUiCommandActionKind('open-confirm')).toBe(true)
    expect(isPluginUiCommandActionKind('open-plugin-action-preview')).toBe(true)
    expect(isPluginUiCommandActionKind('write')).toBe(false)
    expect(isPluginUiCommandActionKind('delete')).toBe(false)
  })

  it('isPluginUiCommandSurface identifies known surfaces', () => {
    expect(isPluginUiCommandSurface('command-palette')).toBe(true)
    expect(isPluginUiCommandSurface('sidebar')).toBe(false)
    expect(isPluginUiCommandSurface('widget')).toBe(false)
  })

  it('isPluginUiCommandFindingReason identifies known reasons', () => {
    expect(isPluginUiCommandFindingReason('core-conflict')).toBe(true)
    expect(isPluginUiCommandFindingReason('unknown-reason')).toBe(false)
  })
})

// =============================================================================
// 3. Stable ID and canonical tests
// =============================================================================

describe('plugin-ui-command stable functions', () => {
  it('deriveCommandId produces stable ID', () => {
    expect(deriveCommandId('my-plugin', 'open-analytics')).toBe(
      'ext.plugin.my-plugin.open-analytics',
    )
  })

  it('contributionSortKey produces stable key', () => {
    expect(contributionSortKey('plugin-a', 'cmd-1')).toBe('plugin-a\0cmd-1')
    expect(contributionSortKey('plugin-b', 'cmd-2')).toBe('plugin-b\0cmd-2')
  })

  it('contributionCanonical is deterministic regardless of input order', () => {
    const c1: PluginUiCommandContributionV1 = {
      ...VALID_NAVIGATION_CONTRIBUTION,
      keywords: ['b', 'a', 'c'],
      requiredPermissions: ['perm:b', 'perm:a'],
    }
    const c2: PluginUiCommandContributionV1 = {
      ...VALID_NAVIGATION_CONTRIBUTION,
      keywords: ['c', 'a', 'b'],
      requiredPermissions: ['perm:a', 'perm:b'],
    }
    expect(contributionCanonical(c1)).toBe(contributionCanonical(c2))
  })

  it('contributionCanonical distinguishes different contributions', () => {
    expect(contributionCanonical(VALID_NAVIGATION_CONTRIBUTION)).not.toBe(
      contributionCanonical(VALID_FORM_CONTRIBUTION),
    )
  })

  it('contributionCanonical handles optional fields', () => {
    const minimal: PluginUiCommandContributionV1 = {
      version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
      contributionKey: 'minimal',
      surface: 'command-palette',
      label: '最小命令',
      iconKey: 'Circle',
      actionKey: 'navigate',
      scopeKind: 'project',
    }
    expect(typeof contributionCanonical(minimal)).toBe('string')
    expect(contributionCanonical(minimal)).toContain('version:1')
    expect(contributionCanonical(minimal)).toContain('contributionKey:minimal')
  })
})

// =============================================================================
// 4. Contribution validate tests (task 2.2)
// =============================================================================

describe('validateContribution', () => {
  it('accepts valid navigation contribution', () => {
    const findings = validateContribution(VALID_NAVIGATION_CONTRIBUTION)
    expect(findings).toHaveLength(0)
  })

  it('accepts valid form contribution', () => {
    const findings = validateContribution(VALID_FORM_CONTRIBUTION)
    expect(findings).toHaveLength(0)
  })

  it('accepts valid confirm contribution', () => {
    const findings = validateContribution(VALID_CONFIRM_CONTRIBUTION)
    expect(findings).toHaveLength(0)
  })

  it('rejects unknown version', () => {
    const c = { ...VALID_NAVIGATION_CONTRIBUTION, version: '2' }
    const findings = validateContribution(c as PluginUiCommandContributionV1)
    expect(findings).toHaveLength(1)
    expect(findings[0].reason).toBe('contribution-schema-invalid')
  })

  it('rejects unknown surface', () => {
    const findings = validateContribution(UNKNOWN_SURFACE_CONTRIBUTION)
    expect(findings.some((f) => f.reason === 'unknown-surface')).toBe(true)
  })

  it('rejects unknown action kind', () => {
    const findings = validateContribution(UNKNOWN_ACTION_CONTRIBUTION)
    expect(findings.some((f) => f.reason === 'unknown-action-kind')).toBe(true)
  })

  it('rejects function in contribution', () => {
    const findings = validateContribution(MALICIOUS_FUNCTION_CONTRIBUTION)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((f) => f.severity === 'blocking')).toBe(true)
  })

  it('rejects iframe in contribution', () => {
    const findings = validateContribution(MALICIOUS_IFRAME_CONTRIBUTION)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((f) => f.severity === 'blocking')).toBe(true)
  })

  it('rejects HTML in label', () => {
    const c: PluginUiCommandContributionV1 = {
      ...VALID_NAVIGATION_CONTRIBUTION,
      label: '<script>alert(1)</script>',
    }
    const findings = validateContribution(c)
    expect(findings.some((f) => f.evidenceRef === 'label:contains-html')).toBe(true)
  })

  it('rejects label exceeding max length', () => {
    const c: PluginUiCommandContributionV1 = {
      ...VALID_NAVIGATION_CONTRIBUTION,
      label: 'a'.repeat(PLUGIN_UI_COMMAND_MAX_LABEL_LENGTH + 1),
    }
    const findings = validateContribution(c)
    expect(findings.some((f) => f.evidenceRef?.startsWith('label:length='))).toBe(true)
  })

  it('rejects keywords exceeding max count', () => {
    const c: PluginUiCommandContributionV1 = {
      ...VALID_NAVIGATION_CONTRIBUTION,
      keywords: Array.from({ length: PLUGIN_UI_COMMAND_MAX_KEYWORDS + 1 }, (_, i) => `kw${i}`),
    }
    const findings = validateContribution(c)
    expect(findings.some((f) => f.evidenceRef?.startsWith('keywords:count='))).toBe(true)
  })

  it('rejects keyword exceeding max length', () => {
    const c: PluginUiCommandContributionV1 = {
      ...VALID_NAVIGATION_CONTRIBUTION,
      keywords: ['a'.repeat(PLUGIN_UI_COMMAND_MAX_KEYWORD_LENGTH + 1)],
    }
    const findings = validateContribution(c)
    expect(findings.some((f) => f.evidenceRef?.startsWith('keyword:length='))).toBe(true)
  })

  it('rejects HTML in keywords', () => {
    const c: PluginUiCommandContributionV1 = {
      ...VALID_NAVIGATION_CONTRIBUTION,
      keywords: ['<img src=x onerror=alert(1)>'],
    }
    const findings = validateContribution(c)
    expect(findings.some((f) => f.evidenceRef === 'keyword:contains-html')).toBe(true)
  })

  it('static valid does not guarantee runtime eligible', () => {
    // A valid contribution does not mean it will be accepted
    const findings = validateContribution(VALID_NAVIGATION_CONTRIBUTION)
    expect(findings).toHaveLength(0) // schema valid
    // But normalizeAndProject with disabled instance will reject it
    const result = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION],
      VALID_HOST_SNAPSHOT.pluginId,
      VALID_HOST_SNAPSHOT.manifestDigest,
      VALID_HOST_SNAPSHOT.instanceRevision,
      VALID_HOST_SNAPSHOT.generatedAt,
      VALID_HOST_SNAPSHOT.trustedScope,
      VALID_HOST_SNAPSHOT.hostReadySeams,
      VALID_HOST_SNAPSHOT.effectiveGrantPermissions,
      VALID_HOST_SNAPSHOT.effectiveGrantExpiry,
      false, // disabled
      false,
      new Set(),
      new Map(),
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.findings.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// 5. Finding sort tests (task 2.6)
// =============================================================================

describe('sortFindings', () => {
  it('sorts by reason priority', () => {
    const unsorted: PluginUiCommandFinding[] = [
      { reason: 'revision-stale', severity: 'blocking' },
      { reason: 'core-conflict', severity: 'blocking' },
      { reason: 'grant-expired', severity: 'blocking' },
    ]
    const sorted = sortFindings(unsorted)
    expect(sorted[0].reason).toBe('core-conflict')
    expect(sorted[1].reason).toBe('grant-expired')
    expect(sorted[2].reason).toBe('revision-stale')
  })

  it('stable sort: same input different order produces same output', () => {
    const a = sortFindings([...FINDING_SAMPLES])
    const b = sortFindings([...FINDING_SAMPLES].reverse())
    expect(a.map((f) => f.reason)).toEqual(b.map((f) => f.reason))
  })

  it('sorts by pluginId when reason priority equal', () => {
    const findings: PluginUiCommandFinding[] = [
      { reason: 'revision-stale', severity: 'blocking', pluginId: 'z-plugin' },
      { reason: 'revision-stale', severity: 'blocking', pluginId: 'a-plugin' },
    ]
    const sorted = sortFindings(findings)
    expect(sorted[0].pluginId).toBe('a-plugin')
    expect(sorted[1].pluginId).toBe('z-plugin')
  })
})

// =============================================================================
// 6. normalizeAndProject tests (tasks 2.6, 2.8)
// =============================================================================

describe('normalizeAndProject', () => {
  const baseArgs = {
    pluginId: 'test-plugin',
    manifestDigest: 'sha256:abc123',
    instanceRevision: '5',
    referenceTime: '2026-08-18T12:00:00Z',
    trustedScope: {
      kind: 'project' as const,
      organizationId: 'org-001',
      projectId: 'proj-001',
    },
    hostReadySeams: ['command-palette'],
    effectiveGrantPermissions: ['risk:create', 'project:archive'],
    effectiveGrantExpiry: null as string | null,
    enabled: true,
    quarantined: false,
    coreCommandIds: new Set<string>(),
    existingOwnerCommandIds: new Map<string, Set<string>>(),
  }

  it('accepts all valid contributions', () => {
    // Use project-scope trusted context to accept project-scope contributions
    const result = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION, VALID_FORM_CONTRIBUTION],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    expect(result.accepted).toHaveLength(2)
    expect(result.findings).toHaveLength(0)
    expect(result.sourceRevision).toBe('5')
    expect(result.sourceManifestDigest).toBe('sha256:abc123')
  })

  it('rejects disabled instance (fail closed)', () => {
    const result = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      false, // disabled
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.findings[0].reason).toBe('enabled-instance-missing')
  })

  it('rejects quarantined instance (fail closed)', () => {
    const result = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      true, // quarantined
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.findings[0].reason).toBe('enabled-instance-missing')
  })

  it('rejects expired grant (fail closed)', () => {
    const result = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      '2026-01-01T00:00:00Z', // expired
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.findings[0].reason).toBe('grant-expired')
  })

  it('rejects when host not ready (fail closed)', () => {
    const result = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      [], // no host-ready seams
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.findings[0].reason).toBe('host-not-ready')
  })

  it('rejects scope mismatch (org-only contribution in project context)', () => {
    const orgOnlyContribution: PluginUiCommandContributionV1 = {
      version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
      contributionKey: 'org-only-cmd',
      surface: 'command-palette',
      label: '仅组织级命令',
      iconKey: 'Building',
      actionKey: 'navigate',
      scopeKind: 'organization',
    }
    const result = normalizeAndProject(
      [orgOnlyContribution],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      { kind: 'project', organizationId: 'org-001', projectId: 'proj-001' },
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    // org-scope contribution in project-only context is rejected
    expect(result.accepted).toHaveLength(0)
    expect(result.findings[0].reason).toBe('scope-mismatch')
  })

  it('accepts project-scope contribution in org context', () => {
    const result = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION], // project-scope
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      { kind: 'organization', organizationId: 'org-001' }, // org-scope
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    // project-scope contribution in org context is accepted (org is broader)
    expect(result.accepted).toHaveLength(1)
    expect(result.findings).toHaveLength(0)
  })

  it('rejects core command conflict', () => {
    const coreIds = new Set(['ext.plugin.test-plugin.open-project-analytics'])
    const result = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      coreIds,
      baseArgs.existingOwnerCommandIds,
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.findings[0].reason).toBe('core-conflict')
  })

  it('rejects owner conflict (different owner)', () => {
    const otherOwnerIds = new Map([
      ['other-plugin', new Set(['ext.plugin.test-plugin.open-project-analytics'])],
    ])
    const result = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      otherOwnerIds,
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.findings[0].reason).toBe('owner-conflict')
  })

  it('allows same owner re-registration (idempotent)', () => {
    const sameOwnerIds = new Map([
      ['test-plugin', new Set(['ext.plugin.test-plugin.open-project-analytics'])],
    ])
    const result = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      sameOwnerIds,
    )
    // Same owner re-registration is idempotent
    expect(result.accepted).toHaveLength(1)
    expect(result.findings).toHaveLength(0)
  })

  it('rejects grant escalation (missing permissions)', () => {
    const result = normalizeAndProject(
      [VALID_FORM_CONTRIBUTION], // requires risk:create
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      [], // no permissions
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.findings[0].reason).toBe('grant-escalation')
  })

  it('input order does not affect output (deterministic)', () => {
    const a = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION, VALID_FORM_CONTRIBUTION],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    const b = normalizeAndProject(
      [VALID_FORM_CONTRIBUTION, VALID_NAVIGATION_CONTRIBUTION],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    expect(a.accepted.map((c) => c.id).sort()).toEqual(b.accepted.map((c) => c.id).sort())
    expect(a.findings).toEqual(b.findings)
  })

  it('duplicate contribution key in same plugin is rejected', () => {
    const result = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION, { ...VALID_NAVIGATION_CONTRIBUTION, label: '重复' }],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    expect(result.accepted).toHaveLength(1)
    expect(result.findings[0].reason).toBe('contribution-duplicate')
  })

  it('returns empty for empty contributions', () => {
    const result = normalizeAndProject(
      [],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.findings).toHaveLength(0)
  })

  it('same owner re-registration with same revision is idempotent', () => {
    const existingIds = new Map([
      ['test-plugin', new Set(['ext.plugin.test-plugin.open-project-analytics'])],
    ])
    const result = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      baseArgs.referenceTime,
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      existingIds,
    )
    // Same owner conflict is allowed (re-registration)
    expect(result.accepted).toHaveLength(1)
  })
})

// =============================================================================
// 7. Sanitizer tests (task 2.10)
// =============================================================================

describe('sanitizeFinding', () => {
  it('preserves safe fields', () => {
    const finding: PluginUiCommandFinding = {
      reason: 'core-conflict',
      severity: 'blocking',
      pluginId: 'test-plugin',
      contributionKey: 'open-analytics',
      count: 3,
      evidenceRef: 'coreConflict:ext.plugin.test.open-analytics',
    }
    const sanitized = sanitizeFinding(finding)
    expect(sanitized.reason).toBe('core-conflict')
    expect(sanitized.pluginId).toBe('test-plugin')
    expect(sanitized.contributionKey).toBe('open-analytics')
    expect(sanitized.count).toBe(3)
    expect(sanitized.evidenceRef).toBe('coreConflict:ext.plugin.test.open-analytics')
  })

  it('redacts token-like evidence refs', () => {
    const finding: PluginUiCommandFinding = {
      reason: 'unknown-error',
      severity: 'blocking',
      evidenceRef: 'token:sk-abc123secret',
    }
    const sanitized = sanitizeFinding(finding)
    expect(sanitized.evidenceRef).toBe('[REDACTED]')
  })

  it('redacts Authorization-like evidence refs', () => {
    const finding: PluginUiCommandFinding = {
      reason: 'unknown-error',
      severity: 'blocking',
      evidenceRef: 'Authorization:Bearer eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0IjoxfQ.xxx',
    }
    const sanitized = sanitizeFinding(finding)
    expect(sanitized.evidenceRef).toBe('[REDACTED]')
  })

  it('redacts API key evidence refs', () => {
    const finding: PluginUiCommandFinding = {
      reason: 'unknown-error',
      severity: 'blocking',
      evidenceRef: 'api_key:sk-proj-abc123',
    }
    const sanitized = sanitizeFinding(finding)
    expect(sanitized.evidenceRef).toBe('[REDACTED]')
  })

  it('preserves safe evidence refs', () => {
    const finding: PluginUiCommandFinding = {
      reason: 'scope-mismatch',
      severity: 'blocking',
      evidenceRef: 'scope:project:expected:organization',
    }
    const sanitized = sanitizeFinding(finding)
    expect(sanitized.evidenceRef).toBe('scope:project:expected:organization')
  })

  it('handles undefined evidenceRef', () => {
    const finding: PluginUiCommandFinding = {
      reason: 'core-conflict',
      severity: 'blocking',
    }
    const sanitized = sanitizeFinding(finding)
    expect(sanitized.evidenceRef).toBeUndefined()
  })
})

describe('sanitizeFindings', () => {
  it('sanitizes batch of findings', () => {
    const findings: PluginUiCommandFinding[] = [
      { reason: 'core-conflict', severity: 'blocking', evidenceRef: 'safe-ref' },
      { reason: 'token-error', severity: 'blocking', evidenceRef: 'token:secret123' },
    ]
    const sanitized = sanitizeFindings(findings)
    expect(sanitized[0].evidenceRef).toBe('safe-ref')
    expect(sanitized[1].evidenceRef).toBe('[REDACTED]')
  })
})

describe('containsSensitiveKeys', () => {
  it('detects token keys', () => {
    expect(containsSensitiveKeys({ token: 'abc' })).toBe(true)
    expect(containsSensitiveKeys({ Authorization: 'Bearer xyz' })).toBe(true)
    expect(containsSensitiveKeys({ api_key: 'sk-123' })).toBe(true)
    expect(containsSensitiveKeys({ secret: 'value' })).toBe(true)
    expect(containsSensitiveKeys({ password: 'value' })).toBe(true)
    expect(containsSensitiveKeys({ credential: 'value' })).toBe(true)
  })

  it('detects JWT values', () => {
    expect(containsSensitiveKeys({ data: 'eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0IjoxfQ.xxx' })).toBe(true)
  })

  it('detects Bearer values', () => {
    expect(containsSensitiveKeys({ auth: 'Bearer abc123' })).toBe(true)
  })

  it('detects nested sensitive keys', () => {
    expect(containsSensitiveKeys({ nested: { token: 'abc' } })).toBe(true)
  })

  it('allows safe keys', () => {
    expect(containsSensitiveKeys({ name: 'test', id: '123', label: 'label' })).toBe(false)
  })

  it('allows empty object', () => {
    expect(containsSensitiveKeys({})).toBe(false)
  })
})

// =============================================================================
// 8. Fixture consistency tests (task 2.12)
// =============================================================================

describe('fixtures consistency', () => {
  it('VALID_NAVIGATION_CONTRIBUTION passes validateContribution', () => {
    expect(validateContribution(VALID_NAVIGATION_CONTRIBUTION)).toHaveLength(0)
  })

  it('VALID_FORM_CONTRIBUTION passes validateContribution', () => {
    expect(validateContribution(VALID_FORM_CONTRIBUTION)).toHaveLength(0)
  })

  it('VALID_CONFIRM_CONTRIBUTION passes validateContribution', () => {
    expect(validateContribution(VALID_CONFIRM_CONTRIBUTION)).toHaveLength(0)
  })

  it('ALL_ACCEPTED_RESULT has matching source info', () => {
    expect(ALL_ACCEPTED_RESULT.sourceRevision).toBe(VALID_HOST_SNAPSHOT.instanceRevision)
    expect(ALL_ACCEPTED_RESULT.sourceManifestDigest).toBe(VALID_HOST_SNAPSHOT.manifestDigest)
  })

  it('BLOCKING_FINDINGS_RESULT has no accepted', () => {
    expect(BLOCKING_FINDINGS_RESULT.accepted).toHaveLength(0)
    expect(BLOCKING_FINDINGS_RESULT.findings.length).toBeGreaterThan(0)
  })

  it('WARNING_FINDINGS_RESULT has both accepted and findings', () => {
    expect(WARNING_FINDINGS_RESULT.accepted.length).toBeGreaterThan(0)
    expect(WARNING_FINDINGS_RESULT.findings.length).toBeGreaterThan(0)
  })

  it('FINDING_SAMPLES covers multiple reason codes', () => {
    const reasons = new Set(FINDING_SAMPLES.map((f) => f.reason))
    expect(reasons.size).toBeGreaterThan(5)
  })

  it('generateContributions produces correct count', () => {
    const contribs = generateContributions(100)
    expect(contribs).toHaveLength(100)
    expect(contribs[0].contributionKey).toBe('cmd-0000')
    expect(contribs[99].contributionKey).toBe('cmd-0099')
  })

  it('host snapshot fixtures have consistent schema version', () => {
    expect(VALID_HOST_SNAPSHOT.schemaVersion).toBe(PLUGIN_UI_COMMAND_SCHEMA_VERSION)
    expect(DISABLED_HOST_SNAPSHOT.schemaVersion).toBe(PLUGIN_UI_COMMAND_SCHEMA_VERSION)
    expect(QUARANTINED_HOST_SNAPSHOT.schemaVersion).toBe(PLUGIN_UI_COMMAND_SCHEMA_VERSION)
    expect(EXPIRED_GRANT_HOST_SNAPSHOT.schemaVersion).toBe(PLUGIN_UI_COMMAND_SCHEMA_VERSION)
    expect(HOST_NOT_READY_SNAPSHOT.schemaVersion).toBe(PLUGIN_UI_COMMAND_SCHEMA_VERSION)
    expect(CROSS_TENANT_SNAPSHOT.schemaVersion).toBe(PLUGIN_UI_COMMAND_SCHEMA_VERSION)
    expect(EMPTY_CONTRIBUTIONS_SNAPSHOT.schemaVersion).toBe(PLUGIN_UI_COMMAND_SCHEMA_VERSION)
  })

  it('normalizeAndProject with VALID_HOST_SNAPSHOT produces accepted', () => {
    // Use project-scope trusted context to accept project-scope contributions
    const result = normalizeAndProject(
      VALID_HOST_SNAPSHOT.contributions.filter((c) => c.scopeKind === 'project'),
      VALID_HOST_SNAPSHOT.pluginId,
      VALID_HOST_SNAPSHOT.manifestDigest,
      VALID_HOST_SNAPSHOT.instanceRevision,
      VALID_HOST_SNAPSHOT.generatedAt,
      VALID_HOST_SNAPSHOT.trustedScope,
      VALID_HOST_SNAPSHOT.hostReadySeams,
      VALID_HOST_SNAPSHOT.effectiveGrantPermissions,
      VALID_HOST_SNAPSHOT.effectiveGrantExpiry,
      VALID_HOST_SNAPSHOT.enabled,
      VALID_HOST_SNAPSHOT.quarantined,
      new Set(),
      new Map(),
    )
    expect(result.accepted).toHaveLength(2)
    expect(result.findings).toHaveLength(0)
  })

  it('normalizeAndProject with DISABLED_HOST_SNAPSHOT produces no accepted', () => {
    const result = normalizeAndProject(
      DISABLED_HOST_SNAPSHOT.contributions,
      DISABLED_HOST_SNAPSHOT.pluginId,
      DISABLED_HOST_SNAPSHOT.manifestDigest,
      DISABLED_HOST_SNAPSHOT.instanceRevision,
      DISABLED_HOST_SNAPSHOT.generatedAt,
      DISABLED_HOST_SNAPSHOT.trustedScope,
      DISABLED_HOST_SNAPSHOT.hostReadySeams,
      DISABLED_HOST_SNAPSHOT.effectiveGrantPermissions,
      DISABLED_HOST_SNAPSHOT.effectiveGrantExpiry,
      DISABLED_HOST_SNAPSHOT.enabled,
      DISABLED_HOST_SNAPSHOT.quarantined,
      new Set(),
      new Map(),
    )
    expect(result.accepted).toHaveLength(0)
  })

  it('normalizeAndProject with EXPIRED_GRANT_HOST_SNAPSHOT produces no accepted', () => {
    const result = normalizeAndProject(
      EXPIRED_GRANT_HOST_SNAPSHOT.contributions,
      EXPIRED_GRANT_HOST_SNAPSHOT.pluginId,
      EXPIRED_GRANT_HOST_SNAPSHOT.manifestDigest,
      EXPIRED_GRANT_HOST_SNAPSHOT.instanceRevision,
      EXPIRED_GRANT_HOST_SNAPSHOT.generatedAt,
      EXPIRED_GRANT_HOST_SNAPSHOT.trustedScope,
      EXPIRED_GRANT_HOST_SNAPSHOT.hostReadySeams,
      EXPIRED_GRANT_HOST_SNAPSHOT.effectiveGrantPermissions,
      EXPIRED_GRANT_HOST_SNAPSHOT.effectiveGrantExpiry,
      EXPIRED_GRANT_HOST_SNAPSHOT.enabled,
      EXPIRED_GRANT_HOST_SNAPSHOT.quarantined,
      new Set(),
      new Map(),
    )
    expect(result.accepted).toHaveLength(0)
  })

  it('normalizeAndProject with HOST_NOT_READY_SNAPSHOT produces no accepted', () => {
    const result = normalizeAndProject(
      HOST_NOT_READY_SNAPSHOT.contributions,
      HOST_NOT_READY_SNAPSHOT.pluginId,
      HOST_NOT_READY_SNAPSHOT.manifestDigest,
      HOST_NOT_READY_SNAPSHOT.instanceRevision,
      HOST_NOT_READY_SNAPSHOT.generatedAt,
      HOST_NOT_READY_SNAPSHOT.trustedScope,
      HOST_NOT_READY_SNAPSHOT.hostReadySeams,
      HOST_NOT_READY_SNAPSHOT.effectiveGrantPermissions,
      HOST_NOT_READY_SNAPSHOT.effectiveGrantExpiry,
      HOST_NOT_READY_SNAPSHOT.enabled,
      HOST_NOT_READY_SNAPSHOT.quarantined,
      new Set(),
      new Map(),
    )
    expect(result.accepted).toHaveLength(0)
  })

  it('normalizeAndProject with EMPTY_CONTRIBUTIONS_SNAPSHOT produces no accepted', () => {
    const result = normalizeAndProject(
      EMPTY_CONTRIBUTIONS_SNAPSHOT.contributions,
      EMPTY_CONTRIBUTIONS_SNAPSHOT.pluginId,
      EMPTY_CONTRIBUTIONS_SNAPSHOT.manifestDigest,
      EMPTY_CONTRIBUTIONS_SNAPSHOT.instanceRevision,
      EMPTY_CONTRIBUTIONS_SNAPSHOT.generatedAt,
      EMPTY_CONTRIBUTIONS_SNAPSHOT.trustedScope,
      EMPTY_CONTRIBUTIONS_SNAPSHOT.hostReadySeams,
      EMPTY_CONTRIBUTIONS_SNAPSHOT.effectiveGrantPermissions,
      EMPTY_CONTRIBUTIONS_SNAPSHOT.effectiveGrantExpiry,
      EMPTY_CONTRIBUTIONS_SNAPSHOT.enabled,
      EMPTY_CONTRIBUTIONS_SNAPSHOT.quarantined,
      new Set(),
      new Map(),
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.findings).toHaveLength(0)
  })

  it('projectedAt is deterministic (from referenceTime)', () => {
    const result = normalizeAndProject(
      [VALID_NAVIGATION_CONTRIBUTION],
      baseArgs.pluginId,
      baseArgs.manifestDigest,
      baseArgs.instanceRevision,
      '2026-01-01T00:00:00Z',
      baseArgs.trustedScope,
      baseArgs.hostReadySeams,
      baseArgs.effectiveGrantPermissions,
      baseArgs.effectiveGrantExpiry,
      baseArgs.enabled,
      baseArgs.quarantined,
      baseArgs.coreCommandIds,
      baseArgs.existingOwnerCommandIds,
    )
    expect(result.projectedAt).toBe('2026-01-01T00:00:00Z')
  })
})

// Base args for reuse in test describe blocks
const baseArgs = {
  pluginId: 'test-plugin',
  manifestDigest: 'sha256:abc123',
  instanceRevision: '5',
  referenceTime: '2026-08-18T12:00:00Z',
  trustedScope: {
    kind: 'project' as const,
    organizationId: 'org-001',
    projectId: 'proj-001',
  },
  hostReadySeams: ['command-palette'],
  effectiveGrantPermissions: ['risk:create', 'project:archive'],
  effectiveGrantExpiry: null as string | null,
  enabled: true,
  quarantined: false,
  coreCommandIds: new Set<string>(),
  existingOwnerCommandIds: new Map<string, Set<string>>(),
}
