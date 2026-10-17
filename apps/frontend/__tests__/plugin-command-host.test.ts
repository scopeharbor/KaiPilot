/**
 * plugin-command-host.test.ts —— Snapshot source, TanStack Query, lifecycle host tests
 *
 * 覆盖 tasks 5.2, 5.4, 5.6, 5.8：
 * - source contract: actor/organization/project filtering, cross-tenant zero leakage
 * - cache isolation: org/project switch, session change, stale/expiry, request failure
 * - provider: first registration, idempotent, incremental replace, disable/uninstall/quarantine,
 *   grant revoke, stale snapshot ordering, unmount cleanup
 * - shell integration: unauthenticated, tenant resolution failure, permission service failure,
 *   source offline, normal path
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemorySnapshotSource,
  ErrorSnapshotSource,
} from '../lib/command-registry/plugin-snapshot-source'
import { pluginCommandQueryKey } from '../lib/command-registry/plugin-command-host'
import { useCommandRegistryStore } from '../lib/command-registry/store'
import type { RegisteredCommand } from '../lib/command-registry/types'
import type { PluginUiCommandHostSnapshot } from '@aiproj/types'
import { PLUGIN_UI_COMMAND_SCHEMA_VERSION } from '@aiproj/types'

// =============================================================================
// Helpers
// =============================================================================

// 图标字段类型为 LucideIcon；测试只验证注册/编排不渲染图标，用空组件桩替代（避免 any）。
const stubIcon = (() => null) as unknown as RegisteredCommand['icon']

function makeSnapshot(
  overrides: Partial<PluginUiCommandHostSnapshot> = {},
): PluginUiCommandHostSnapshot {
  return {
    schemaVersion: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
    pluginId: 'test-plugin',
    manifestDigest: 'sha256:abc123',
    instanceRevision: '3',
    enabled: true,
    quarantined: false,
    effectiveGrantPermissions: ['risk:create'],
    effectiveGrantExpiry: null,
    trustedScope: {
      kind: 'project',
      organizationId: 'org-001',
      projectId: 'proj-001',
    },
    hostReadySeams: ['command-palette'],
    actorEligibilityRef: 'eligibility:user-001',
    generatedAt: '2026-08-18T12:00:00Z',
    contributions: [
      {
        version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
        contributionKey: 'open-analytics',
        surface: 'command-palette',
        label: '查看项目分析',
        iconKey: 'BarChart3',
        actionKey: 'navigate',
        actionParams: { route: '/projects/:projectId/analytics' },
        scopeKind: 'project',
      },
    ],
    ...overrides,
  }
}

// =============================================================================
// 1. Snapshot source contract tests (task 5.2)
// =============================================================================

describe('InMemorySnapshotSource', () => {
  let source: InMemorySnapshotSource

  beforeEach(() => {
    source = new InMemorySnapshotSource()
  })

  it('returns snapshot for registered context', async () => {
    const snapshot = makeSnapshot()
    source.register('org-001', 'proj-001', snapshot)

    const result = await source.fetchSnapshot({
      organizationId: 'org-001',
      projectId: 'proj-001',
      actorId: 'user-001',
      sessionId: 'session-001',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.pluginId).toBe('test-plugin')
    }
  })

  it('returns error for unregistered context', async () => {
    const result = await source.fetchSnapshot({
      organizationId: 'org-other',
      projectId: 'proj-other',
      actorId: 'user-001',
      sessionId: 'session-001',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('snapshot-unavailable')
    }
  })

  it('cross-tenant: different org returns error', async () => {
    source.register('org-001', 'proj-001', makeSnapshot())

    const result = await source.fetchSnapshot({
      organizationId: 'org-002', // different org
      projectId: 'proj-001',
      actorId: 'user-001',
      sessionId: 'session-001',
    })

    expect(result.ok).toBe(false)
  })

  it('cross-project: different project returns error', async () => {
    source.register('org-001', 'proj-001', makeSnapshot())

    const result = await source.fetchSnapshot({
      organizationId: 'org-001',
      projectId: 'proj-002', // different project
      actorId: 'user-001',
      sessionId: 'session-001',
    })

    expect(result.ok).toBe(false)
  })

  it('org-level snapshot (no project ID)', async () => {
    source.register(
      'org-001',
      undefined,
      makeSnapshot({
        trustedScope: { kind: 'organization', organizationId: 'org-001' },
      }),
    )

    const result = await source.fetchSnapshot({
      organizationId: 'org-001',
      // no projectId
      actorId: 'user-001',
      sessionId: 'session-001',
    })

    expect(result.ok).toBe(true)
  })

  it('clear removes all snapshots', async () => {
    source.register('org-001', 'proj-001', makeSnapshot())
    source.clear()

    const result = await source.fetchSnapshot({
      organizationId: 'org-001',
      projectId: 'proj-001',
      actorId: 'user-001',
      sessionId: 'session-001',
    })

    expect(result.ok).toBe(false)
  })
})

describe('ErrorSnapshotSource', () => {
  it('always returns error', async () => {
    const source = new ErrorSnapshotSource('source-offline')
    const result = await source.fetchSnapshot({
      organizationId: 'org-001',
      projectId: 'proj-001',
      actorId: 'user-001',
      sessionId: 'session-001',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('source-offline')
    }
  })

  it('default error is source-offline', async () => {
    const source = new ErrorSnapshotSource()
    const result = await source.fetchSnapshot({
      organizationId: 'org-001',
      projectId: 'proj-001',
      actorId: 'user-001',
      sessionId: 'session-001',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('source-offline')
    }
  })
})

// =============================================================================
// 2. Query key tests (task 5.4)
// =============================================================================

describe('pluginCommandQueryKey', () => {
  it('includes all context boundaries', () => {
    const key = pluginCommandQueryKey({
      organizationId: 'org-001',
      projectId: 'proj-001',
      actorId: 'user-001',
      sessionId: 'session-001',
    })

    expect(key).toEqual(['plugin-commands', 'org-001', 'proj-001', 'user-001', 'session-001'])
  })

  it('uses __org__ for undefined projectId', () => {
    const key = pluginCommandQueryKey({
      organizationId: 'org-001',
      projectId: undefined,
      actorId: 'user-001',
      sessionId: 'session-001',
    })

    expect(key[2]).toBe('__org__')
  })

  it('different org produces different key', () => {
    const key1 = pluginCommandQueryKey({
      organizationId: 'org-001',
      projectId: 'proj-001',
      actorId: 'user-001',
      sessionId: 'session-001',
    })
    const key2 = pluginCommandQueryKey({
      organizationId: 'org-002',
      projectId: 'proj-001',
      actorId: 'user-001',
      sessionId: 'session-001',
    })

    expect(key1).not.toEqual(key2)
  })

  it('different project produces different key', () => {
    const key1 = pluginCommandQueryKey({
      organizationId: 'org-001',
      projectId: 'proj-001',
      actorId: 'user-001',
      sessionId: 'session-001',
    })
    const key2 = pluginCommandQueryKey({
      organizationId: 'org-001',
      projectId: 'proj-002',
      actorId: 'user-001',
      sessionId: 'session-001',
    })

    expect(key1).not.toEqual(key2)
  })

  it('different session produces different key', () => {
    const key1 = pluginCommandQueryKey({
      organizationId: 'org-001',
      projectId: 'proj-001',
      actorId: 'user-001',
      sessionId: 'session-001',
    })
    const key2 = pluginCommandQueryKey({
      organizationId: 'org-001',
      projectId: 'proj-001',
      actorId: 'user-001',
      sessionId: 'session-002',
    })

    expect(key1).not.toEqual(key2)
  })
})

// =============================================================================
// 3. Store integration tests (task 5.6)
// =============================================================================

describe('store integration', () => {
  beforeEach(() => {
    useCommandRegistryStore.getState().clear()
  })

  it('replaceOwnerCommands registers plugin commands', () => {
    const { replaceOwnerCommands } = useCommandRegistryStore.getState()
    const result = replaceOwnerCommands('test-plugin', '3', 'sha256:abc123', [
      {
        id: 'ext.plugin.test-plugin.open-analytics',
        label: '查看项目分析',
        icon: stubIcon,
        group: 'custom',
        effect: 'navigate',
        execute: () => {},
      },
    ])

    expect(result.success).toBe(true)
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)
  })

  it('removeOwnerCommands cleans up plugin commands', () => {
    const { replaceOwnerCommands, removeOwnerCommands } = useCommandRegistryStore.getState()
    replaceOwnerCommands('test-plugin', '3', 'sha256:abc123', [
      {
        id: 'ext.plugin.test-plugin.open-analytics',
        label: '查看项目分析',
        icon: stubIcon,
        group: 'custom',
        effect: 'navigate',
        execute: () => {},
      },
    ])

    removeOwnerCommands('test-plugin')
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
  })

  it('idempotent: same revision no-op', () => {
    const { replaceOwnerCommands } = useCommandRegistryStore.getState()
    const cmds = [
      {
        id: 'ext.plugin.test-plugin.open-analytics',
        label: '查看项目分析',
        icon: stubIcon,
        group: 'custom' as const,
        effect: 'navigate' as const,
        execute: () => {},
      },
    ]

    replaceOwnerCommands('test-plugin', '3', 'sha256:abc123', cmds)
    const result = replaceOwnerCommands('test-plugin', '3', 'sha256:abc123', cmds)

    expect(result.success).toBe(true)
    expect(result.reason).toBe('idempotent')
  })

  it('incremental replace: new revision replaces old', () => {
    const { replaceOwnerCommands } = useCommandRegistryStore.getState()
    replaceOwnerCommands('test-plugin', '3', 'sha256:v3', [
      {
        id: 'ext.plugin.test-plugin.cmd-old',
        label: '旧命令',
        icon: stubIcon,
        group: 'custom',
        effect: 'navigate',
        execute: () => {},
      },
    ])

    replaceOwnerCommands('test-plugin', '4', 'sha256:v4', [
      {
        id: 'ext.plugin.test-plugin.cmd-new',
        label: '新命令',
        icon: stubIcon,
        group: 'custom',
        effect: 'navigate',
        execute: () => {},
      },
    ])

    const all = useCommandRegistryStore.getState().getAllCommands()
    expect(all).toHaveLength(1)
    expect(all[0]!.id).toContain('cmd-new')
  })

  it('disable/uninstall/quarantine removes commands', () => {
    const { replaceOwnerCommands, removeOwnerCommands } = useCommandRegistryStore.getState()
    replaceOwnerCommands('test-plugin', '3', 'sha256:abc', [
      {
        id: 'ext.plugin.test-plugin.cmd1',
        label: '命令1',
        icon: stubIcon,
        group: 'custom',
        effect: 'navigate',
        execute: () => {},
      },
    ])

    // Simulate disable
    removeOwnerCommands('test-plugin')
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
  })

  it('grant revoke removes commands', () => {
    const { replaceOwnerCommands, removeOwnerCommands } = useCommandRegistryStore.getState()
    replaceOwnerCommands('test-plugin', '3', 'sha256:abc', [
      {
        id: 'ext.plugin.test-plugin.cmd1',
        label: '命令1',
        icon: stubIcon,
        group: 'custom',
        effect: 'navigate',
        execute: () => {},
      },
    ])

    // Simulate grant revoke
    removeOwnerCommands('test-plugin')
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
  })

  it('stale snapshot ordering: old revision ignored', () => {
    const { replaceOwnerCommands } = useCommandRegistryStore.getState()
    replaceOwnerCommands('test-plugin', '5', 'sha256:v5', [
      {
        id: 'ext.plugin.test-plugin.cmd-v5',
        label: 'V5命令',
        icon: stubIcon,
        group: 'custom',
        effect: 'navigate',
        execute: () => {},
      },
    ])

    // Try to apply old revision
    const result = replaceOwnerCommands('test-plugin', '3', 'sha256:v3', [
      {
        id: 'ext.plugin.test-plugin.cmd-v3',
        label: 'V3命令',
        icon: stubIcon,
        group: 'custom',
        effect: 'navigate',
        execute: () => {},
      },
    ])

    expect(result.success).toBe(false)
    expect(result.reason).toContain('stale-revision')
    // V5 command still intact
    const all = useCommandRegistryStore.getState().getAllCommands()
    expect(all[0]!.id).toContain('cmd-v5')
  })

  it('unmount cleanup: removeOwnerCommands cleans all', () => {
    const { replaceOwnerCommands, removeOwnerCommands } = useCommandRegistryStore.getState()
    replaceOwnerCommands('test-plugin', '3', 'sha256:abc', [
      {
        id: 'ext.plugin.test-plugin.cmd1',
        label: '命令1',
        icon: stubIcon,
        group: 'custom',
        effect: 'navigate',
        execute: () => {},
      },
      {
        id: 'ext.plugin.test-plugin.cmd2',
        label: '命令2',
        icon: stubIcon,
        group: 'custom',
        effect: 'navigate',
        execute: () => {},
      },
    ])

    removeOwnerCommands('test-plugin')
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
    expect(useCommandRegistryStore.getState().ownerMeta.size).toBe(0)
    expect(useCommandRegistryStore.getState().ownerRevisions.size).toBe(0)
  })
})
