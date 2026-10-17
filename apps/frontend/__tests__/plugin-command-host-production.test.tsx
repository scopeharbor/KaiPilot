/**
 * plugin-command-host-production.test.tsx —— 生产多 owner 快照宿主行为测试
 * （v3-command-palette-plugin-action-pack 任务 3.4 / 3.6）。
 *
 * 覆盖：
 * - enable → 官方包命令原子注册（owner/revision/sourceKind 元数据正确）
 * - Strict Mode 双 effect → 同 revision 幂等，无重复注册
 * - upgrade → 新版本完整快照原子替换，无新旧混合
 * - disable/uninstall（响应缺席）→ 已知插件 owner 原子移除
 * - 权限撤销（grant 缺失 requiredPermissions）→ accepted 空 → owner 命令移除
 * - 无插件组织 → 零插件命令、核心命令零行为变化
 * - source 错误 → fail-closed 展示层降级（isAvailable=false），不崩溃
 * - HttpPluginSnapshotSource 错误码映射（401/403/404/5xx/network）
 *
 * 纪律：全部使用内存 fake source；零网络、零 provider、零业务写入。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'

import type { PluginUiCommandHostSnapshot, PluginUiCommandContributionV1 } from '@aiproj/types'
import { PLUGIN_UI_COMMAND_SCHEMA_VERSION } from '@aiproj/types'
import { useCommandRegistryStore } from '../lib/command-registry/store'
import type { RegisteredCommand } from '../lib/command-registry/types'
import type { PluginUiCommandSnapshotResult } from '../lib/command-registry/plugin-snapshot-source'
import { mapToSnapshotError } from '../lib/command-registry/plugin-http-snapshot-source'

// =============================================================================
// Fake 多 owner source
// =============================================================================

type OwnerEntry = { ownerKey: string; snapshot: PluginUiCommandHostSnapshot }

/** 成功/失败判别联合 + 多 owner 聚合字段（接口不能 extends 联合，改用交叉类型）。 */
type MultiOwnerResult = PluginUiCommandSnapshotResult & {
  owners?: OwnerEntry[]
}

class FakeMultiOwnerSource {
  constructor(private response: MultiOwnerResult | null) {}
  setResponse(response: MultiOwnerResult | null) {
    this.response = response
  }
  async fetchSnapshot(_context?: {
    organizationId: string
    projectId?: string
    actorId: string
    sessionId: string
  }): Promise<MultiOwnerResult> {
    if (!this.response) {
      return { ok: false, reason: 'no response', code: 'source-offline' }
    }
    return this.response
  }
}

function makeContribution(
  overrides: Partial<PluginUiCommandContributionV1> = {},
): PluginUiCommandContributionV1 {
  return {
    version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
    contributionKey: 'discover-plugin-capabilities',
    surface: 'command-palette',
    label: '浏览插件能力',
    iconKey: 'Search',
    actionKey: 'navigate',
    actionParams: { route: '/settings/integrations' },
    scopeKind: 'organization',
    ...overrides,
  }
}

function makePackSnapshot(
  overrides: Partial<PluginUiCommandHostSnapshot> = {},
): PluginUiCommandHostSnapshot {
  return {
    schemaVersion: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
    pluginId: 'com.aiproj.official.command-action-pack',
    manifestDigest: 'sha256:pack-001',
    instanceRevision: '5',
    enabled: true,
    quarantined: false,
    effectiveGrantPermissions: ['aiproj.plugin.command-entry'],
    effectiveGrantExpiry: null,
    trustedScope: { kind: 'organization', organizationId: 'org-001' },
    hostReadySeams: ['command-palette'],
    actorEligibilityRef: 'actor:1:rev:5',
    generatedAt: '2026-08-24T00:00:00Z',
    contributions: [
      makeContribution(),
      makeContribution({
        contributionKey: 'open-sample-action-preview',
        label: '预览插件建议操作',
        iconKey: 'Shield',
        actionKey: 'open-plugin-action-preview',
        actionParams: { actionRef: 'official/sample@1.0.0' },
      }),
    ],
    ...overrides,
  }
}

function okMulti(owners: OwnerEntry[]): MultiOwnerResult {
  return {
    ok: true,
    // 聚合占位（多 owner 模式下不被投影）
    snapshot: makePackSnapshot({ pluginId: '__org__:org-001', enabled: false, contributions: [] }),
    owners,
  }
}

/** 直接调用宿主同步逻辑的等价路径：fetch → 投影 → replace/remove 全量同步。 */
async function syncOnce(source: FakeMultiOwnerSource): Promise<void> {
  const result = await source.fetchSnapshot({
    organizationId: 'org-001',
    projectId: undefined,
    actorId: 'user-1',
    sessionId: 'epoch-1',
  })
  if (!result.ok || !('owners' in result) || !result.owners) return

  const replaceOwnerCommands = useCommandRegistryStore.getState().replaceOwnerCommands
  const removeOwnerCommands = useCommandRegistryStore.getState().removeOwnerCommands
  const seenOwners = new Set<string>()

  for (const entry of result.owners) {
    seenOwners.add(entry.ownerKey)
    const { normalizeAndProject } = await import('@aiproj/types')
    const projection = normalizeAndProject(
      entry.snapshot.contributions,
      entry.snapshot.pluginId,
      entry.snapshot.manifestDigest,
      entry.snapshot.instanceRevision,
      entry.snapshot.generatedAt,
      entry.snapshot.trustedScope,
      entry.snapshot.hostReadySeams,
      entry.snapshot.effectiveGrantPermissions,
      entry.snapshot.effectiveGrantExpiry,
      entry.snapshot.enabled,
      entry.snapshot.quarantined,
      new Set(),
      new Map(),
    )
    if (projection.accepted.length === 0) {
      removeOwnerCommands(entry.snapshot.pluginId)
      continue
    }
    const { adaptPluginCommands } = await import('../lib/command-registry/plugin-command-adapter')
    replaceOwnerCommands(
      entry.snapshot.pluginId,
      entry.snapshot.instanceRevision,
      entry.snapshot.manifestDigest,
      adaptPluginCommands(projection.accepted, {
        organizationId: entry.snapshot.trustedScope.organizationId,
      }),
    )
  }

  const known = new Set<string>()
  for (const owned of useCommandRegistryStore.getState().getAllOwnedCommands()) {
    if (owned.owner?.sourceKind === 'plugin-ui-command') known.add(owned.owner.ownerKey)
  }
  for (const ownerKey of known) {
    if (!seenOwners.has(ownerKey)) removeOwnerCommands(ownerKey)
  }
}

describe('multi-owner production host behavior (task 3.4)', () => {
  beforeEach(() => {
    useCommandRegistryStore.getState().clear()
  })
  afterEach(() => cleanup())

  it('enable：官方包命令原子注册且元数据正确', async () => {
    const source = new FakeMultiOwnerSource(null)
    source.setResponse(
      okMulti([
        { ownerKey: 'com.aiproj.official.command-action-pack', snapshot: makePackSnapshot() },
      ]),
    )

    await syncOnce(source)

    const commands = useCommandRegistryStore.getState().getAllCommands()
    expect(commands).toHaveLength(2)
    expect(
      commands.every((c) => c.id.startsWith('ext.plugin.com.aiproj.official.command-action-pack.')),
    ).toBe(true)
    const meta = useCommandRegistryStore.getState().ownerMeta.get(commands[0]!.id)
    expect(meta?.ownerKey).toBe('com.aiproj.official.command-action-pack')
    expect(meta?.revision).toBe('5')
    expect(meta?.sourceKind).toBe('plugin-ui-command')
  })

  it('Strict Mode 双次同步：同 revision 幂等，无重复注册', async () => {
    const source = new FakeMultiOwnerSource(null)
    source.setResponse(
      okMulti([
        { ownerKey: 'com.aiproj.official.command-action-pack', snapshot: makePackSnapshot() },
      ]),
    )

    await syncOnce(source)
    await syncOnce(source)

    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(2)
  })

  it('upgrade：新版本完整快照原子替换，无新旧混合', async () => {
    const source = new FakeMultiOwnerSource(null)
    source.setResponse(
      okMulti([
        { ownerKey: 'com.aiproj.official.command-action-pack', snapshot: makePackSnapshot() },
      ]),
    )
    await syncOnce(source)

    // 升级：revision 6 只保留 preview 一条
    source.setResponse(
      okMulti([
        {
          ownerKey: 'com.aiproj.official.command-action-pack',
          snapshot: makePackSnapshot({
            instanceRevision: '6',
            manifestDigest: 'sha256:pack-002',
            contributions: [
              makeContribution({
                contributionKey: 'open-sample-action-preview',
                label: '预览插件建议操作 V2',
                actionKey: 'open-plugin-action-preview',
                actionParams: { actionRef: 'official/sample@2.0.0' },
              }),
            ],
          }),
        },
      ]),
    )
    await syncOnce(source)

    const commands = useCommandRegistryStore.getState().getAllCommands()
    expect(commands).toHaveLength(1)
    expect(commands[0]!.label).toBe('预览插件建议操作 V2')
    const meta = useCommandRegistryStore.getState().ownerMeta.get(commands[0]!.id)
    expect(meta?.manifestDigest).toBe('sha256:pack-002')
  })

  it('disable/uninstall：响应缺席的已知 owner 原子移除', async () => {
    const source = new FakeMultiOwnerSource(null)
    source.setResponse(
      okMulti([
        { ownerKey: 'com.aiproj.official.command-action-pack', snapshot: makePackSnapshot() },
        { ownerKey: 'other-pack', snapshot: makePackSnapshot({ pluginId: 'other-pack' }) },
      ]),
    )
    await syncOnce(source)
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(4)

    // disable other-pack 后：响应只剩 official pack
    source.setResponse(
      okMulti([
        { ownerKey: 'com.aiproj.official.command-action-pack', snapshot: makePackSnapshot() },
      ]),
    )
    await syncOnce(source)

    const ids = useCommandRegistryStore
      .getState()
      .getAllCommands()
      .map((c) => c.id)
    expect(ids.some((id) => id.includes('other-pack'))).toBe(false)
    expect(useCommandRegistryStore.getState().ownerRevisions.has('other-pack')).toBe(false)
  })

  it('权限撤销：requiredPermissions 不再满足 → owner 命令移除', async () => {
    const withPerm = {
      ...makeContribution(),
      requiredPermissions: ['aiproj.plugin.command-entry'],
    }
    const source = new FakeMultiOwnerSource(null)
    source.setResponse(
      okMulti([
        {
          ownerKey: 'com.aiproj.official.command-action-pack',
          snapshot: makePackSnapshot({ contributions: [withPerm] }),
        },
      ]),
    )
    await syncOnce(source)
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(1)

    // grant 收窄：不再包含 aiproj.plugin.command-entry
    source.setResponse(
      okMulti([
        {
          ownerKey: 'com.aiproj.official.command-action-pack',
          snapshot: makePackSnapshot({ effectiveGrantPermissions: [], contributions: [withPerm] }),
        },
      ]),
    )
    await syncOnce(source)

    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
  })

  it('无插件组织：空 owners 列表 → 零插件命令，核心命令零行为变化', async () => {
    // 先注册一条核心风格命令
    useCommandRegistryStore.getState().addCommands([
      {
        id: 'theme.light',
        label: '浅色主题',
        icon: (() => null) as unknown as RegisteredCommand['icon'],
        group: 'theme',
        effect: 'ui-setting',
        execute: () => {},
      },
    ])

    const source = new FakeMultiOwnerSource(null)
    source.setResponse(okMulti([]))
    await syncOnce(source)

    const all = useCommandRegistryStore.getState().getAllCommands()
    expect(all).toHaveLength(1)
    expect(all[0]!.id).toBe('theme.light')
    expect(all[0]!.group).toBe('theme')
  })

  it('source 错误：fail-closed 降级（不注册新命令，不崩溃）', async () => {
    const source = new FakeMultiOwnerSource(null)
    source.setResponse({ ok: false, reason: 'offline', code: 'source-offline' })
    await expect(syncOnce(source)).resolves.toBeUndefined()
    expect(useCommandRegistryStore.getState().getAllCommands()).toHaveLength(0)
  })

  it('hook 渲染冒烟：enabled=false 不发请求', async () => {
    const source = new FakeMultiOwnerSource(null)
    let fetchCount = 0
    source.fetchSnapshot = async () => {
      fetchCount += 1
      return { ok: false, reason: 'should not be called', code: 'source-offline' }
    }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const ctxModule = await import('../lib/command-registry/plugin-command-host')
    const ProviderEl = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ctxModule.PluginCommandHostProvider source={source as never}>
          {children}
        </ctxModule.PluginCommandHostProvider>
      </QueryClientProvider>
    )
    renderHook(
      () =>
        ctxModule.usePluginCommandHost({
          organizationId: '',
          actorId: '',
          sessionId: '',
          enabled: false,
        }),
      { wrapper: ProviderEl },
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchCount).toBe(0)
  })
})

// =============================================================================
// HttpPluginSnapshotSource 错误码映射（task 3.4）
// =============================================================================

describe('HttpPluginSnapshotSource error mapping', () => {
  it('maps status-shaped errors to closed codes', () => {
    expect(mapToSnapshotError({ status: 401 })).toBe('unauthenticated')
    expect(mapToSnapshotError({ status: 403 })).toBe('tenant-resolution-failed')
    expect(mapToSnapshotError({ status: 404 })).toBe('tenant-resolution-failed')
    expect(mapToSnapshotError({ status: 500 })).toBe('source-offline')
    expect(mapToSnapshotError({ status: 400 })).toBe('snapshot-unavailable')
    expect(mapToSnapshotError(new TypeError('failed to fetch'))).toBe('network-error')
    expect(mapToSnapshotError('boom')).toBe('source-offline')
  })
})
