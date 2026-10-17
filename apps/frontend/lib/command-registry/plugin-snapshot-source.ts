/**
 * plugin-snapshot-source.ts —— Read-only port for plugin UI command snapshots.
 *
 * - Defines PluginUiCommandSnapshotSource port (task 5.1)
 * - Binds to production owner confirmed in task 1.4
 * - Responses filtered by server-side actor/organization/project
 * - Other tenants completely absent
 * - Errors return low-sensitivity reason codes only
 */

import type { PluginUiCommandHostSnapshot } from '@aiproj/types'

/**
 * Read-only snapshot source port.
 * Binds to the installation/grant/runtime authorization owner.
 * Frontend only consumes, never generates snapshots.
 */
export interface PluginUiCommandSnapshotSource {
  /**
   * Fetch current snapshot for the given context.
   * Response is server-filtered by actor/organization/project.
   */
  fetchSnapshot(context: {
    organizationId: string
    projectId?: string
    actorId: string
    sessionId: string
  }): Promise<PluginUiCommandSnapshotResult>
}

/**
 * Snapshot fetch result (success or error).
 */
export type PluginUiCommandSnapshotResult =
  | {
      ok: true
      snapshot: PluginUiCommandHostSnapshot
    }
  | {
      ok: false
      reason: string
      /** Low-sensitivity error code. */
      code: PluginUiCommandSnapshotError
    }

/** Error codes for snapshot fetch. */
export type PluginUiCommandSnapshotError =
  | 'unauthenticated'
  | 'tenant-resolution-failed'
  | 'permission-service-unavailable'
  | 'source-offline'
  | 'snapshot-unavailable'
  | 'network-error'

/**
 * In-memory snapshot source for testing / fixture-only mode.
 * Used when production source is not yet available.
 */
export class InMemorySnapshotSource implements PluginUiCommandSnapshotSource {
  private snapshots = new Map<string, PluginUiCommandHostSnapshot>()

  /**
   * Register a snapshot for a given context key.
   */
  register(
    organizationId: string,
    projectId: string | undefined,
    snapshot: PluginUiCommandHostSnapshot,
  ): void {
    const key = this.contextKey(organizationId, projectId)
    this.snapshots.set(key, snapshot)
  }

  /**
   * Clear all registered snapshots.
   */
  clear(): void {
    this.snapshots.clear()
  }

  async fetchSnapshot(context: {
    organizationId: string
    projectId?: string
    actorId: string
    sessionId: string
  }): Promise<PluginUiCommandSnapshotResult> {
    const key = this.contextKey(context.organizationId, context.projectId)
    const snapshot = this.snapshots.get(key)
    if (!snapshot) {
      return {
        ok: false,
        reason: 'No snapshot registered for this context',
        code: 'snapshot-unavailable',
      }
    }
    return { ok: true, snapshot }
  }

  private contextKey(organizationId: string, projectId?: string): string {
    return `${organizationId}:${projectId ?? '__org__'}`
  }
}

/**
 * Error-only snapshot source (always fails).
 * Used to test degraded behavior.
 */
export class ErrorSnapshotSource implements PluginUiCommandSnapshotSource {
  constructor(private error: PluginUiCommandSnapshotError = 'source-offline') {}

  async fetchSnapshot(_context?: {
    organizationId: string
    projectId?: string
    actorId: string
    sessionId: string
  }): Promise<PluginUiCommandSnapshotResult> {
    return {
      ok: false,
      reason: `Snapshot source error: ${this.error}`,
      code: this.error,
    }
  }
}
