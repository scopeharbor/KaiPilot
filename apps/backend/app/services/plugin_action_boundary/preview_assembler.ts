/**
 * v3-plugin-action-preview-boundary —— preview 组装（design.md D2）。
 *
 * 把 adapter 提供的 PreviewDraft 组装为契约标准 PluginActionPreview：
 * - 复用 Copilot draft-layer 的幂等派生 / 来源新鲜度 primitive（不复制 UI/会话层）；
 * - digest 覆盖全部审查字段（隐藏对象过滤必须发生在 digest 之前）；
 * - 有界化：diff/findings/assumptions/受影响项超限截断并计入 omitted。
 */
import type {
  PluginActionFinding,
  PluginActionPreview,
  PluginActionProposal,
  PluginActionSourceRef,
} from '@aiproj/types'
import {
  computePreviewDigest,
  deriveActionIdempotencyKey,
  PLUGIN_ACTION_MAX_AFFECTED_ITEMS,
  PLUGIN_ACTION_MAX_ASSUMPTIONS,
  PLUGIN_ACTION_MAX_DIFF_ENTRIES,
  PLUGIN_ACTION_MAX_FINDINGS,
} from '@aiproj/types'
import type { PluginActionAdapterRegistry } from './adapter_registry.js'

export interface AssemblePreviewInput {
  readonly proposal: PluginActionProposal
  readonly proposalDigest: string
  readonly draft: import('./adapter_registry.js').PluginActionPreviewDraft
  readonly actorPermissions: readonly string[]
  readonly nowIso: string
  readonly ttlSeconds?: number
}

/**
 * 由 draft 组装标准 preview。
 * permissionSummary.granted 由调用方传入的 actor 权限集与 adapter 声明的必需权限比对得出；
 * dry-run canApply 由 blocking finding 推导（存在 blocking 即不可确认）。
 */
export function assemblePluginActionPreview(
  registry: PluginActionAdapterRegistry,
  input: AssemblePreviewInput,
): {
  preview: Omit<PluginActionPreview, 'previewDigest'>
  previewDigest: string
  idempotencyKey: string
} {
  const adapter = registry.require(input.proposal.actionKind)
  const granted =
    input.actorPermissions.length > 0 &&
    adapter.descriptor.requiredPermissions.every((p) => input.actorPermissions.includes(p))

  const blockingFindings: readonly PluginActionFinding[] = input.draft.dryRunFindings
  const canApply = !blockingFindings.some((f) => f.severity === 'blocking')

  const ttl = input.ttlSeconds ?? 600
  const expiresAt = new Date(new Date(input.nowIso).getTime() + ttl * 1000).toISOString()

  const base: Omit<PluginActionPreview, 'previewDigest'> = {
    proposalDigest: input.proposalDigest,
    actionKind: input.proposal.actionKind,
    scope: input.proposal.scope,
    pluginRef: {
      pluginId: input.proposal.sourceRefs[0]?.pluginId ?? 'unknown',
      pluginVersion: input.proposal.sourceRefs[0]?.pluginVersion ?? '0.0.0',
      installationId: input.proposal.sourceRefs[0]?.installationId ?? null,
    },
    diffEntries: input.draft.diffEntries.slice(0, PLUGIN_ACTION_MAX_DIFF_ENTRIES),
    assumptions: [...input.draft.assumptions].slice(0, PLUGIN_ACTION_MAX_ASSUMPTIONS),
    permissionSummary: {
      requiredPermissions: adapter.descriptor.requiredPermissions,
      granted,
    },
    compatibilitySummary: input.draft.compatibilitySummary,
    dryRun: { canApply, findings: blockingFindings.slice(0, PLUGIN_ACTION_MAX_FINDINGS) },
    reversibility: input.draft.reversibility,
    affectedItemRefs: input.draft.affectedItemRefs.slice(0, PLUGIN_ACTION_MAX_AFFECTED_ITEMS),
    batchPolicy: adapter.descriptor.batchPolicy,
    issuedAt: input.nowIso,
    expiresAt,
  }
  const previewDigest = computePreviewDigest(base)
  const idempotencyKey = deriveActionIdempotencyKey({
    actionKind: input.proposal.actionKind,
    proposalDigest: input.proposalDigest,
    targetEntityRefs: base.affectedItemRefs,
    sourceRefs: input.proposal.sourceRefs as readonly PluginActionSourceRef[],
  })
  return { preview: base, previewDigest, idempotencyKey }
}
