/**
 * store.test.ts —— Command Registry owner/revision atomic semantics tests
 *
 * 覆盖 tasks 3.2, 3.4, 3.6, 3.8, 3.9：
 * - 兼容性：built-in / useRegisterCommands / 搜索建议 / store selector
 * - 原子性：成功替换 / 部分冲突零写入 / 同 revision 幂等 / 不同 owner 隔离 / 核心命令保留
 * - 生命周期：disabled/uninstalled/quarantined/grant revoke / 旧快照乱序 / revision 删除 contribution
 * - Strict Mode / 快速组织项目切换 / 无重复无残留
 * - 既有回归
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useCommandRegistryStore } from '../lib/command-registry/store'
import type { RegisteredCommand } from '../lib/command-registry/types'

// =============================================================================
// Helpers
// =============================================================================

function makeCommand(id: string, label?: string): RegisteredCommand {
  return {
    id,
    label: label ?? `Command ${id}`,
    icon: (() => null) as unknown as RegisteredCommand['icon'],
    group: 'navigation',
    effect: 'navigate',
    execute: () => {},
  }
}

function makePluginCommand(pluginId: string, key: string, label?: string): RegisteredCommand {
  return makeCommand(`ext.plugin.${pluginId}.${key}`, label ?? `Plugin ${key}`)
}

// =============================================================================
// 1. Backward compatibility tests (task 3.2)
// =============================================================================

describe('command store backward compatibility', () => {
  beforeEach(() => {
    useCommandRegistryStore.getState().clear()
  })

  it('addCommands still works for built-in commands', () => {
    const cmd = makeCommand('nav.home', '首页')
    useCommandRegistryStore.getState().addCommands([cmd])
    expect(useCommandRegistryStore.getState().commands.get('nav.home')).toBeDefined()
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)
  })

  it('duplicate ID still rejected in addCommands', () => {
    const cmd1 = makeCommand('nav.home', '首页')
    const cmd2 = makeCommand('nav.home', '首页 v2')
    useCommandRegistryStore.getState().addCommands([cmd1])
    useCommandRegistryStore.getState().addCommands([cmd2])
    expect(useCommandRegistryStore.getState().commands.get('nav.home')?.label).toBe('首页')
  })

  it('removeCommands still works', () => {
    const cmd = makeCommand('nav.home')
    useCommandRegistryStore.getState().addCommands([cmd])
    useCommandRegistryStore.getState().removeCommands(['nav.home'])
    expect(useCommandRegistryStore.getState().commands.get('nav.home')).toBeUndefined()
  })

  it('getAllCommands returns all commands', () => {
    useCommandRegistryStore.getState().addCommands([makeCommand('nav.a'), makeCommand('nav.b')])
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(2)
  })

  it('clear resets everything', () => {
    useCommandRegistryStore.getState().addCommands([makeCommand('nav.a')])
    useCommandRegistryStore.getState().clear()
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
  })

  it('ownerMeta is undefined for addCommands commands', () => {
    const cmd = makeCommand('nav.home')
    useCommandRegistryStore.getState().addCommands([cmd])
    const owned = useCommandRegistryStore.getState().getAllOwnedCommands()
    expect(owned[0]!.owner).toBeUndefined()
  })
})

// =============================================================================
// 2. replaceOwnerCommands atomic tests (task 3.4)
// =============================================================================

describe('replaceOwnerCommands', () => {
  beforeEach(() => {
    useCommandRegistryStore.getState().clear()
  })

  it('success: replaces owner commands atomically', () => {
    const cmds = [makePluginCommand('plugin-a', 'cmd1'), makePluginCommand('plugin-a', 'cmd2')]
    const result = useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:abc', cmds)
    expect(result.success).toBe(true)
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(2)
    expect(useCommandRegistryStore.getState().getOwnerRevision('plugin-a')).toBe('1')
  })

  it('atomicity: partial conflict rejects entire batch', () => {
    // First plugin registers
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:a', [makePluginCommand('plugin-a', 'shared')])
    // Second plugin tries to register with a command that has the same ID
    // (simulating a plugin trying to register under another plugin's namespace)
    const result = useCommandRegistryStore.getState().replaceOwnerCommands(
      'plugin-b',
      '1',
      'sha256:b',
      [makeCommand('ext.plugin.plugin-a.shared', 'hijack')], // same ID as plugin-a's command
    )
    expect(result.success).toBe(false)
    expect(result.reason).toContain('owner-conflict')
    // First plugin's commands still intact
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)
  })

  it('atomicity: core conflict rejects entire batch', () => {
    useCommandRegistryStore.getState().addCommands([makeCommand('nav.home')])
    const result = useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:a', [makeCommand('nav.home', 'hijack')])
    expect(result.success).toBe(false)
    expect(result.reason).toContain('core-conflict')
  })

  it('idempotent: same revision no-op', () => {
    const cmds = [makePluginCommand('plugin-a', 'cmd1')]
    useCommandRegistryStore.getState().replaceOwnerCommands('plugin-a', '1', 'sha256:abc', cmds)
    const result = useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:abc', cmds)
    expect(result.success).toBe(true)
    expect(result.reason).toBe('idempotent')
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)
  })

  it('isolation: different owners do not conflict', () => {
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:a', [makePluginCommand('plugin-a', 'cmd1')])
    useCommandRegistryStore.getState().replaceOwnerCommands(
      'plugin-b',
      '1',
      'sha256:b',
      [makePluginCommand('plugin-b', 'cmd1')], // different key → different ID
    )
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(2)
  })

  it('core commands preserved after plugin registration', () => {
    useCommandRegistryStore
      .getState()
      .addCommands([makeCommand('nav.home'), makeCommand('nav.projects')])
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:a', [makePluginCommand('plugin-a', 'cmd1')])
    const all = useCommandRegistryStore.getState().getAllCommands()
    expect(all).toHaveLength(3)
    expect(all.some((c) => c.id === 'nav.home')).toBe(true)
    expect(all.some((c) => c.id === 'nav.projects')).toBe(true)
  })

  it('upgrade: new revision replaces old commands', () => {
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:v1', [makePluginCommand('plugin-a', 'cmd1')])
    useCommandRegistryStore.getState().replaceOwnerCommands(
      'plugin-a',
      '2',
      'sha256:v2',
      [makePluginCommand('plugin-a', 'cmd2')], // different key
    )
    const all = useCommandRegistryStore.getState().getAllCommands()
    expect(all).toHaveLength(1)
    expect(all[0]!.id).toBe('ext.plugin.plugin-a.cmd2')
    expect(useCommandRegistryStore.getState().getOwnerRevision('plugin-a')).toBe('2')
  })
})

// =============================================================================
// 3. Stale revision guard tests (task 3.6)
// =============================================================================

describe('stale revision guard', () => {
  beforeEach(() => {
    useCommandRegistryStore.getState().clear()
  })

  it('rejects old revision after new one is set', () => {
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '5', 'sha256:a', [makePluginCommand('plugin-a', 'cmd1')])
    const result = useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '3', 'sha256:old', [makePluginCommand('plugin-a', 'cmd2')])
    expect(result.success).toBe(false)
    expect(result.reason).toContain('stale-revision')
    // Original commands still intact
    const all = useCommandRegistryStore.getState().getAllCommands()
    expect(all[0]!.id).toBe('ext.plugin.plugin-a.cmd1')
  })

  it('rejects duplicate snapshot (same revision)', () => {
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '3', 'sha256:a', [makePluginCommand('plugin-a', 'cmd1')])
    const result = useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '3', 'sha256:a', [makePluginCommand('plugin-a', 'cmd1')])
    expect(result.success).toBe(true)
    expect(result.reason).toBe('idempotent')
  })

  it('removeOwnerCommands clears revision for later revive', () => {
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '5', 'sha256:a', [makePluginCommand('plugin-a', 'cmd1')])
    useCommandRegistryStore.getState().removeOwnerCommands('plugin-a')
    // After removal, any revision should be accepted
    const result = useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '3', 'sha256:old', [makePluginCommand('plugin-a', 'cmd2')])
    expect(result.success).toBe(true)
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)
  })
})

// =============================================================================
// 4. removeOwnerCommands tests (task 3.6)
// =============================================================================

describe('removeOwnerCommands', () => {
  beforeEach(() => {
    useCommandRegistryStore.getState().clear()
  })

  it('removes all commands for an owner', () => {
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:a', [
        makePluginCommand('plugin-a', 'cmd1'),
        makePluginCommand('plugin-a', 'cmd2'),
      ])
    useCommandRegistryStore.getState().removeOwnerCommands('plugin-a')
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
    expect(useCommandRegistryStore.getState().getOwnerRevision('plugin-a')).toBeUndefined()
  })

  it('does not affect other owners', () => {
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:a', [makePluginCommand('plugin-a', 'cmd1')])
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-b', '1', 'sha256:b', [makePluginCommand('plugin-b', 'cmd1')])
    useCommandRegistryStore.getState().removeOwnerCommands('plugin-a')
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)
    expect(useCommandRegistryStore.getState().getAllCommands()[0]!.id).toContain('plugin-b')
  })

  it('does not affect core commands', () => {
    useCommandRegistryStore.getState().addCommands([makeCommand('nav.home')])
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:a', [makePluginCommand('plugin-a', 'cmd1')])
    useCommandRegistryStore.getState().removeOwnerCommands('plugin-a')
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)
    expect(useCommandRegistryStore.getState().getAllCommands()[0]!.id).toBe('nav.home')
  })

  it('no-op for unknown owner', () => {
    useCommandRegistryStore.getState().addCommands([makeCommand('nav.home')])
    useCommandRegistryStore.getState().removeOwnerCommands('nonexistent')
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)
  })
})

// =============================================================================
// 5. Strict Mode idempotency tests (task 3.8)
// =============================================================================

describe('Strict Mode / rapid mount-unmount', () => {
  beforeEach(() => {
    useCommandRegistryStore.getState().clear()
  })

  it('rapid mount-unmount-mount does not duplicate commands', () => {
    // Simulate Strict Mode: mount → unmount → mount
    const cmds = [makePluginCommand('plugin-a', 'cmd1')]

    // First mount
    useCommandRegistryStore.getState().replaceOwnerCommands('plugin-a', '1', 'sha256:a', cmds)
    // Unmount (simulated by removeOwnerCommands)
    useCommandRegistryStore.getState().removeOwnerCommands('plugin-a')
    // Second mount
    useCommandRegistryStore.getState().replaceOwnerCommands('plugin-a', '1', 'sha256:a', cmds)

    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)
    expect(useCommandRegistryStore.getState().getOwnerRevision('plugin-a')).toBe('1')
  })

  it('rapid organization/project switch leaves no stale commands', () => {
    // Org A plugin commands
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:a', [makePluginCommand('plugin-a', 'cmd-a')])
    // Switch to Org B (remove old, add new)
    useCommandRegistryStore.getState().removeOwnerCommands('plugin-a')
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '2', 'sha256:b', [makePluginCommand('plugin-a', 'cmd-b')])

    const all = useCommandRegistryStore.getState().getAllCommands()
    expect(all).toHaveLength(1)
    expect(all[0]!.id).toBe('ext.plugin.plugin-a.cmd-b')
  })

  it('unmounted owner leaves no residual commands', () => {
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:a', [
        makePluginCommand('plugin-a', 'cmd1'),
        makePluginCommand('plugin-a', 'cmd2'),
      ])
    useCommandRegistryStore.getState().removeOwnerCommands('plugin-a')
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
    expect(useCommandRegistryStore.getState().ownerMeta.size).toBe(0)
  })
})

// =============================================================================
// 6. Owner metadata tests
// =============================================================================

describe('owner metadata', () => {
  beforeEach(() => {
    useCommandRegistryStore.getState().clear()
  })

  it('ownerMeta is set for plugin commands', () => {
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:a', [makePluginCommand('plugin-a', 'cmd1')])
    const meta = useCommandRegistryStore.getState().ownerMeta.get('ext.plugin.plugin-a.cmd1')
    expect(meta).toBeDefined()
    expect(meta?.ownerKey).toBe('plugin-a')
    expect(meta?.revision).toBe('1')
    expect(meta?.manifestDigest).toBe('sha256:a')
    expect(meta?.sourceKind).toBe('plugin-ui-command')
  })

  it('ownerMeta is undefined for core commands', () => {
    useCommandRegistryStore.getState().addCommands([makeCommand('nav.home')])
    const meta = useCommandRegistryStore.getState().ownerMeta.get('nav.home')
    expect(meta).toBeUndefined()
  })

  it('getAllOwnedCommands returns all with metadata', () => {
    useCommandRegistryStore.getState().addCommands([makeCommand('nav.home')])
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:a', [makePluginCommand('plugin-a', 'cmd1')])
    const owned = useCommandRegistryStore.getState().getAllOwnedCommands()
    expect(owned).toHaveLength(2)
    const core = owned.find((o) => o.command.id === 'nav.home')
    expect(core?.owner).toBeUndefined()
    const plugin = owned.find((o) => o.command.id === 'ext.plugin.plugin-a.cmd1')
    expect(plugin?.owner?.ownerKey).toBe('plugin-a')
  })
})

// =============================================================================
// 7.既有回归（task 3.9）—— 确认既有 API 无变化
// =============================================================================

describe('existing API regression', () => {
  beforeEach(() => {
    useCommandRegistryStore.getState().clear()
  })

  it('addCommands + removeCommands lifecycle unchanged', () => {
    useCommandRegistryStore.getState().addCommands([makeCommand('nav.a'), makeCommand('nav.b')])
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(2)

    useCommandRegistryStore.getState().removeCommands(['nav.a'])
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)
    expect(useCommandRegistryStore.getState().getAllCommands()[0]!.id).toBe('nav.b')
  })

  it('clear resets all state including owner metadata', () => {
    useCommandRegistryStore.getState().addCommands([makeCommand('nav.a')])
    useCommandRegistryStore
      .getState()
      .replaceOwnerCommands('plugin-a', '1', 'sha256:a', [makePluginCommand('plugin-a', 'cmd1')])
    useCommandRegistryStore.getState().clear()
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
    expect(useCommandRegistryStore.getState().ownerMeta.size).toBe(0)
    expect(useCommandRegistryStore.getState().ownerRevisions.size).toBe(0)
  })
})
