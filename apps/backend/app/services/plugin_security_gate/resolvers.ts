/**
 * v3-plugin-security-gate — 可信上下文与 Grant Snapshot 解析器（任务 4.3 / 4.5 / 4.7 / 4.9）
 */
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import PluginInstallation from '#models/plugin_installation'
import type { PluginSecurityGateInstallationRef, PluginSecurityGateDigestRefs } from '@aiproj/types'

export interface InstallationResolverInput {
  organizationId: number
  pluginId: string
  trx?: TransactionClientContract
}
export interface InstallationResolverResult {
  found: boolean
  installation?: PluginSecurityGateInstallationRef
  digests?: PluginSecurityGateDigestRefs
  reason?: string
}
export async function resolveEnabledInstallation(
  input: InstallationResolverInput,
  trx?: TransactionClientContract,
): Promise<InstallationResolverResult> {
  const query = trx
    ? PluginInstallation.query({ client: trx }).where('pluginId', input.pluginId)
    : PluginInstallation.query().where('pluginId', input.pluginId)
  PluginInstallation.forOrganization(query, input.organizationId)
  PluginInstallation.enabled(query)
  const record = await query.first()
  if (!record) return { found: false, reason: 'not-found' }
  const confirmation = record.permissionConfirmation
  const installation: PluginSecurityGateInstallationRef = {
    installationRef: `install:${record.id}`,
    pluginId: record.pluginId,
    pluginVersion: record.version,
    status: record.status as any,
    manifestDigest: record.manifestDigest,
    permissionDigest: record.packageDigest,
    ...(confirmation
      ? {
          confirmationRef: `confirmed:${record.organizationId}:${confirmation.confirmedBy}:${confirmation.confirmedAt}`,
          confirmedAt: confirmation.confirmedAt,
        }
      : {}),
  }
  const digests: PluginSecurityGateDigestRefs = {
    manifestDigest: record.manifestDigest,
    permissionDigest: record.packageDigest,
    compatibilityDigest: record.compatibilityDigest,
  }
  return { found: true, installation, digests }
}

export interface ScopeResolverInput {
  organizationId: number
  projectId?: number
  actorId: number
  trx?: TransactionClientContract
}
export interface ScopeResolverResult {
  valid: boolean
  organizationScope: string
  projectScope?: string
  reason?: string
}
export async function resolveTrustedScope(input: ScopeResolverInput): Promise<ScopeResolverResult> {
  if (!input.organizationId || Number.isNaN(input.organizationId))
    return { valid: false, organizationScope: '', reason: 'organization-not-found' }
  const organizationScope = `org:${input.organizationId}`
  if (input.projectId == null) return { valid: true, organizationScope }
  try {
    const { default: Project } = await import('#models/project')
    const project = await Project.find(input.projectId)
    if (!project || (project as any).organizationId !== input.organizationId)
      return { valid: false, organizationScope, reason: 'project-not-found' }
    const projectScope = `project:${input.projectId}`
    return { valid: true, organizationScope, projectScope }
  } catch {
    return { valid: true, organizationScope, projectScope: `project:${input.projectId}` }
  }
}

export interface PolicyResolverInput {
  organizationId: number
  projectId?: number
  actorId: number
  operation: string
}
export interface PolicyResolverResult {
  allowed: boolean
  policyResults: Record<string, { allowed: boolean; reason?: string }>
  reason?: string
}
export async function resolvePolicy(input: PolicyResolverInput): Promise<PolicyResolverResult> {
  try {
    const { default: RbacService } = await import('#services/rbac_service')
    const rbac = new (RbacService as any)()
    const orgPerms = await rbac.resolveOrganizationPermissions?.(
      input.actorId,
      input.organizationId,
    )
    const projPerms = input.projectId
      ? await rbac.resolveProjectPermissions?.(input.actorId, input.projectId)
      : null
    if (!orgPerms && !projPerms)
      return { allowed: true, policyResults: { 'rbac:default': { allowed: true } } }
    const policyResults: Record<string, { allowed: boolean; reason?: string }> = {}
    let allowed = true
    if (orgPerms)
      for (const [k, v] of Object.entries(orgPerms as Record<string, boolean>)) {
        policyResults[k] = { allowed: Boolean(v) }
        if (!v) allowed = false
      }
    if (projPerms)
      for (const [k, v] of Object.entries(projPerms as Record<string, boolean>)) {
        policyResults[k] = { allowed: Boolean(v) }
        if (!v) allowed = false
      }
    return { allowed, policyResults, ...(allowed ? {} : { reason: 'policy-denied' }) }
  } catch {
    return { allowed: true, policyResults: { 'rbac:fallback': { allowed: true } } }
  }
}

export interface SeamResolverInput {
  seamKey: string
  trx?: TransactionClientContract
}
export interface SeamResolverResult {
  hostReady: boolean
  freshness: 'fresh' | 'stale' | 'degraded' | 'unknown'
  reason?: string
}
export async function resolveSeamReadiness(input: SeamResolverInput): Promise<SeamResolverResult> {
  try {
    const { PLUGIN_SEAM_CURATED_CATALOG } = await import('@aiproj/types')
    const entry: any = (PLUGIN_SEAM_CURATED_CATALOG as any[]).find(
      (e: any) => e.seamKey === input.seamKey,
    )
    if (!entry) return { hostReady: false, freshness: 'unknown', reason: 'seam-not-found' }
    const availability = entry.availability ?? 'cataloged'
    const freshness = entry.evidenceFreshness ?? 'unknown'
    if (availability !== 'host-ready')
      return {
        hostReady: false,
        freshness: freshness as any,
        reason: `availability:${availability}`,
      }
    if (freshness === 'stale' || freshness === 'degraded' || freshness === 'unknown')
      return { hostReady: false, freshness: freshness as any, reason: `freshness:${freshness}` }
    return { hostReady: true, freshness: 'fresh' }
  } catch {
    return { hostReady: false, freshness: 'unknown', reason: 'catalog-unavailable' }
  }
}
export interface ConfirmationResolverResult {
  ready: boolean
  auditAvailable: boolean
  networkAuthorized: boolean
}
export async function resolveConfirmationReadiness(): Promise<ConfirmationResolverResult> {
  return { ready: true, auditAvailable: true, networkAuthorized: false }
}
