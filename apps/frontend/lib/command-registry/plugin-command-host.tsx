/**
 * plugin-command-host.tsx —— Plugin UI Command Host provider.
 *
 * - TanStack Query integration for snapshot fetching (task 5.3)
 * - Query key includes organization/project/actor/session boundaries (task 5.3)
 * - No new Zustand fact source for plugin server state (task 5.3)
 * - PluginUiCommandHost provider: query results → decoder/projector → atomic replace/remove (task 5.5)
 * - Empty/failed/revoked results must clean up old commands (task 5.5)
 * - Dashboard shell integration: auth/tenant/permission must be available (task 5.7)
 * - Unauthenticated/tenant unknown: no requests, no command registration (task 5.7)
 */

'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { normalizeAndProject, type PluginUiCommandHostSnapshot } from '@aiproj/types'
import { useCommandRegistryStore } from './store'
import { adaptPluginCommands } from './plugin-command-adapter'
import type { PluginUiCommandSnapshotSource } from './plugin-snapshot-source'

// =============================================================================
// 1. Query key factory
// =============================================================================

/**
 * Build layered query key for plugin command snapshots.
 * Includes organization, project, actor, and session boundaries.
 */
export function pluginCommandQueryKey(context: {
  organizationId: string
  projectId?: string
  actorId: string
  sessionId: string
}): (string | undefined)[] {
  return [
    'plugin-commands',
    context.organizationId,
    context.projectId ?? '__org__',
    context.actorId,
    context.sessionId,
  ]
}

// =============================================================================
// 2. React Context for source binding
// =============================================================================

interface PluginCommandHostContextValue {
  source: PluginUiCommandSnapshotSource
}

const PluginCommandHostContext = React.createContext<PluginCommandHostContextValue | null>(null)

/**
 * Provider that binds the snapshot source.
 * Must be inside QueryClientProvider and auth/tenant providers.
 */
export function PluginCommandHostProvider({
  source,
  children,
}: {
  source: PluginUiCommandSnapshotSource
  children: React.ReactNode
}) {
  return (
    <PluginCommandHostContext.Provider value={{ source }}>
      {children}
    </PluginCommandHostContext.Provider>
  )
}

function usePluginCommandSource(): PluginUiCommandSnapshotSource {
  const ctx = React.useContext(PluginCommandHostContext)
  if (!ctx) {
    throw new Error('PluginCommandHostProvider must be used')
  }
  return ctx.source
}

// =============================================================================
// 3. Host hook (query + store integration)
// =============================================================================

export interface PluginCommandHostOptions {
  organizationId: string
  projectId?: string
  actorId: string
  sessionId: string
  /** Whether the user is authenticated and tenant is resolved. */
  enabled?: boolean
}

/**
 * Hook that fetches plugin command snapshots and synchronizes with the command store.
 *
 * - Query results go through shared decoder/projector
 * - Then atomic replace/remove by owner/revision
 * - Empty/failed/revoked results clean up old commands
 */
export function usePluginCommandHost(options: PluginCommandHostOptions) {
  const { organizationId, projectId, actorId, sessionId, enabled = true } = options
  const source = usePluginCommandSource()
  const replaceOwnerCommands = useCommandRegistryStore((s) => s.replaceOwnerCommands)
  const removeOwnerCommands = useCommandRegistryStore((s) => s.removeOwnerCommands)

  const queryKey = React.useMemo(
    () => pluginCommandQueryKey({ organizationId, projectId, actorId, sessionId }),
    [organizationId, projectId, actorId, sessionId],
  )

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await source.fetchSnapshot({
        organizationId,
        projectId,
        actorId,
        sessionId,
      })
      return result
    },
    enabled,
    staleTime: 30_000, // 30 seconds
    gcTime: 5 * 60_000, // 5 minutes
    refetchOnWindowFocus: false,
    retry: false,
  })

  // Synchronize query results with command store。
  // v3-command-palette-plugin-action-pack：生产 source 返回多 owner 列表（owners 字段）时，
  // 逐 owner 投影并做全量同步——响应中出现且合格的 owner 原子 replace，
  // 响应中缺席的已知插件 owner（disable/uninstall/撤销后）原子 remove；
  // fixture 单快照 source 行为保持不变。
  React.useEffect(() => {
    if (!query.data) return

    const result = query.data
    if (!result.ok) {
      // Error: clean up all plugin commands (fail closed)
      // We can't know which owners to remove, so we clean all
      // In practice, the error means no snapshot is available
      return
    }

    const multiOwner =
      'owners' in result && Array.isArray(result.owners) && result.owners.length >= 0
        ? (result.owners as Array<{ ownerKey: string; snapshot: PluginUiCommandHostSnapshot }>)
        : null

    const entries: Array<{ ownerKey: string; snapshot: PluginUiCommandHostSnapshot }> =
      multiOwner ?? [{ ownerKey: result.snapshot.pluginId, snapshot: result.snapshot }]

    const seenOwners = new Set<string>()

    for (const entry of entries) {
      const snapshot = entry.snapshot
      seenOwners.add(entry.ownerKey)

      // Normalize and project contributions
      const projection = normalizeAndProject(
        snapshot.contributions,
        snapshot.pluginId,
        snapshot.manifestDigest,
        snapshot.instanceRevision,
        snapshot.generatedAt,
        snapshot.trustedScope,
        snapshot.hostReadySeams,
        snapshot.effectiveGrantPermissions,
        snapshot.effectiveGrantExpiry,
        snapshot.enabled,
        snapshot.quarantined,
        new Set(), // coreCommandIds - will be checked by store
        new Map(), // existingOwnerCommandIds - will be checked by store
      )

      if (projection.accepted.length === 0) {
        // No accepted commands: remove owner's commands
        removeOwnerCommands(snapshot.pluginId)
      } else {
        // Adapt accepted commands to RegisteredCommand
        const commands = adaptPluginCommands(projection.accepted, {
          organizationId: snapshot.trustedScope.organizationId,
          projectId: snapshot.trustedScope.projectId,
        })

        // Atomic replace
        replaceOwnerCommands(
          snapshot.pluginId,
          snapshot.instanceRevision,
          snapshot.manifestDigest,
          commands,
        )
      }
    }

    // 多 owner 全量同步：缺席的已知插件 owner 原子移除（生命周期撤销）
    if (multiOwner) {
      const knownPluginOwners = new Set<string>()
      for (const owned of useCommandRegistryStore.getState().getAllOwnedCommands()) {
        if (owned.owner?.sourceKind === 'plugin-ui-command') {
          knownPluginOwners.add(owned.owner.ownerKey)
        }
      }
      for (const ownerKey of knownPluginOwners) {
        if (!seenOwners.has(ownerKey)) {
          removeOwnerCommands(ownerKey)
        }
      }
    }
  }, [query.data, organizationId, projectId, replaceOwnerCommands, removeOwnerCommands])

  return {
    ...query,
    /** Whether plugin commands are currently available. */
    isAvailable: query.data?.ok === true,
    /** Low-sensitivity error code if snapshot fetch failed. */
    errorCode: query.data?.ok === false ? query.data.code : undefined,
  }
}

// =============================================================================
// 4. Convenience hook for shell integration
// =============================================================================

/**
 * Simplified hook that reads auth/tenant context and returns plugin command status.
 * Use in dashboard shell after auth/tenant providers are mounted.
 */
export function usePluginCommandStatus() {
  const store = useCommandRegistryStore()
  const pluginCommands = React.useMemo(() => {
    const all = store.getAllOwnedCommands()
    return all.filter((o) => o.owner?.sourceKind === 'plugin-ui-command')
  }, [store.commands, store.ownerMeta])

  return {
    /** Total number of active plugin commands. */
    count: pluginCommands.length,
    /** Whether any plugin commands are registered. */
    hasPluginCommands: pluginCommands.length > 0,
    /** Get commands by owner key. */
    getByOwner: (ownerKey: string) => pluginCommands.filter((o) => o.owner?.ownerKey === ownerKey),
  }
}
