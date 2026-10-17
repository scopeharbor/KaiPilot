/**
 * triz-plugin-pack —— V3 TRIZ 官方插件包共享契约（纯类型 + 常量 + 封闭 operation + 校验 + 低敏 + digest）。
 */
export const PLUGIN_TRIZ_PACK_ID = 'com.aiproj.official.triz-pack' as const
export type PluginTrizPackId = typeof PLUGIN_TRIZ_PACK_ID
export const PLUGIN_TRIZ_PACK_VERSION = '1.0.0' as const
export const TRIZ_PACK_CONTRIBUTION_KEYS = [
  'triz-advisor-skill',
  'triz-technical-contradiction',
  'triz-physical-contradiction',
  'triz-evolution-trend',
  'triz-skill-layer-context',
] as const
export type TrizPackContributionKey = (typeof TRIZ_PACK_CONTRIBUTION_KEYS)[number]
export const TRIZ_PLUGIN_OPERATIONS = [
  'triz.assistant.submit',
  'triz.technical_contradiction.analyze',
  'triz.physical_contradiction.analyze',
  'triz.evolution_trend.analyze',
] as const
export type TrizPluginOperation = (typeof TRIZ_PLUGIN_OPERATIONS)[number]
export const TRIZ_PLUGIN_OPERATION_SEAM_MAP: Record<
  TrizPluginOperation,
  {
    seamKey: string
    seamVersion: string
    requiredPermissions: readonly string[]
    sideEffect: string
    network: string
  }
> = {
  'triz.assistant.submit': {
    seamKey: 'server-command-proposal.proposal-only',
    seamVersion: '1.0.0',
    requiredPermissions: ['com.aiproj.triz.assistant.submit'],
    sideEffect: 'proposal',
    network: 'none',
  },
  'triz.technical_contradiction.analyze': {
    seamKey: 'server-command-proposal.proposal-only',
    seamVersion: '1.0.0',
    requiredPermissions: ['com.aiproj.triz.technical.analyze'],
    sideEffect: 'proposal',
    network: 'none',
  },
  'triz.physical_contradiction.analyze': {
    seamKey: 'server-command-proposal.proposal-only',
    seamVersion: '1.0.0',
    requiredPermissions: ['com.aiproj.triz.physical.analyze'],
    sideEffect: 'proposal',
    network: 'none',
  },
  'triz.evolution_trend.analyze': {
    seamKey: 'server-query.readonly-provider',
    seamVersion: '1.0.0',
    requiredPermissions: ['com.aiproj.triz.evolution.analyze'],
    sideEffect: 'read-only',
    network: 'none',
  },
}
export const TRIZ_PACK_SKILL_CONTRIBUTIONS: ReadonlyArray<{
  contributionKey: string
  seamKey: string
  seamVersion: string
}> = [
  {
    contributionKey: 'triz-advisor-skill',
    seamKey: 'skill-adapter.skill-bundle',
    seamVersion: '1.0.0',
  },
  {
    contributionKey: 'triz-skill-layer-context',
    seamKey: 'compiler-contribution.context-contribution',
    seamVersion: '1.0.0',
  },
]
export const TRIZ_PACK_ALL_SEAMS: ReadonlyArray<{ seamKey: string; seamVersion: string }> = [
  ...TRIZ_PACK_SKILL_CONTRIBUTIONS,
  { seamKey: 'server-command-proposal.proposal-only', seamVersion: '1.0.0' },
  { seamKey: 'server-query.readonly-provider', seamVersion: '1.0.0' },
]
export const TRIZ_PLUGIN_PACK_FINDING_CODES = [
  'triz-pack-schema-invalid',
  'triz-pack-unknown-operation',
  'triz-pack-operation-not-allowed',
  'triz-pack-invalid-param',
  'triz-pack-param-out-of-bounds',
  'triz-pack-cross-tenant-denied',
  'triz-pack-not-installed',
  'triz-pack-not-enabled',
  'triz-pack-uninstalled',
  'triz-pack-preview-required',
  'triz-pack-confirmation-required',
  'triz-pack-provider-calls-not-zero',
  'triz-pack-direct-write-attempt',
  'triz-pack-secret-detected',
  'triz-pack-sensitive-content-detected',
  'triz-pack-parallel-algorithm-recreation',
  'triz-pack-manifest-invalid',
] as const
export type TrizPluginPackFindingCode = (typeof TRIZ_PLUGIN_PACK_FINDING_CODES)[number]
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\b(SELECT\s+[\s\S]+\s+FROM|INSERT\s+INTO|DROP\s+TABLE|UNION\s+SELECT)\b/i,
  /<script\b/i,
  /javascript:/i,
  /\beval\s*\(/i,
  /https?:\/\//i,
  /\b(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|bearer\s+[a-zA-Z0-9._-]{20,})\b/i,
  /\b(password|secret|private_key|api_key)\s*[:=]/i,
]
export function trizPackContainsSensitiveContent(value: string): boolean {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  return SENSITIVE_PATTERNS.some((p) => p.test(value))
}
export function isTrizPluginOperation(v: unknown): v is TrizPluginOperation {
  return typeof v === 'string' && (TRIZ_PLUGIN_OPERATIONS as readonly string[]).includes(v)
}
export interface TrizPluginPackFinding {
  code: TrizPluginPackFindingCode
  severity: 'info' | 'warning' | 'blocking'
  message: string
  path?: string
}
export interface TrizPluginPackValidationResult {
  valid: boolean
  findings: readonly TrizPluginPackFinding[]
  normalizedPayload?: TrizPluginPackOperationPayload
}
export interface TrizPluginPackOperationPayload {
  operation: TrizPluginOperation
  organizationId: number
  projectId: number
  actorId: number
  input?: Record<string, unknown>
  idempotencyKey?: string
  enableAi?: boolean
  selectedSourceRefs?: string[]
}
export interface TrizPluginPackValidationContext {
  callerOrganizationId: number
  callerProjectId?: number
  isPluginEnabled: boolean
  installationStatus?: string
  providerCalls?: number
}
export interface TrizPluginPackExecutionResult {
  operation: TrizPluginOperation
  preview: true
  draft: true
  providerCalls: number
  data: Record<string, unknown>
  sourceHashes?: string[]
  warnings?: string[]
  requiresConfirmation: true
  auditRef?: string
}
export interface TrizPluginPackHealthItem {
  contributionKey: string
  seamKey: string
  status: 'effective' | 'inactive' | 'invalid_payload' | 'not_installed'
  reasonCode?: string
  reasonMessage?: string
  isEffective: boolean
}
export interface TrizPluginPackHealthReport {
  pluginId: string
  pluginVersion: string
  organizationId: number
  installationStatus: string
  contributions: TrizPluginPackHealthItem[]
  effectiveOperations: TrizPluginOperation[]
}
export function trizPackStableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => trizPackStableSerialize(v)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, v]) => JSON.stringify(k) + ':' + trizPackStableSerialize(v)).join(',')}}`
}
export function trizPackFnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
export function computeTrizPackOperationDigest(payload: TrizPluginPackOperationPayload): string {
  return trizPackFnv1aHash(trizPackStableSerialize(payload))
}
const ALLOWED_PAYLOAD_FIELDS = [
  'operation',
  'organizationId',
  'projectId',
  'actorId',
  'input',
  'idempotencyKey',
  'enableAi',
  'selectedSourceRefs',
] as const
const MAX_MESSAGE_LEN = 4000
const MAX_USER_CONTEXT_LEN = 2000
function checkSecretAndSensitive(
  raw: Record<string, unknown>,
  findings: TrizPluginPackFinding[],
  pathPrefix = '',
): void {
  for (const [key, value] of Object.entries(raw)) {
    const curPath = pathPrefix ? `${pathPrefix}.${key}` : key
    if (/secret|token|password|apiKey|authorization|private[_-]?key/i.test(key)) {
      findings.push({
        code: 'triz-pack-secret-detected',
        severity: 'blocking',
        message: `Secret key detected at ${curPath}`,
        path: curPath,
      })
    }
    if (typeof value === 'string') {
      if (trizPackContainsSensitiveContent(value)) {
        findings.push({
          code: 'triz-pack-sensitive-content-detected',
          severity: 'blocking',
          message: `Sensitive content detected at ${curPath}`,
          path: curPath,
        })
      }
      if (
        /overridestageorder|bypassinvariants|parallelStateMachine|activationengine/i.test(value)
      ) {
        findings.push({
          code: 'triz-pack-parallel-algorithm-recreation',
          severity: 'blocking',
          message: `Parallel algorithm recreation at ${curPath}`,
          path: curPath,
        })
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      checkSecretAndSensitive(value as Record<string, unknown>, findings, curPath)
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const v = value[i]
        const arrPath = `${curPath}[${i}]`
        if (typeof v === 'string' && trizPackContainsSensitiveContent(v)) {
          findings.push({
            code: 'triz-pack-sensitive-content-detected',
            severity: 'blocking',
            message: `Sensitive content at ${arrPath}`,
            path: arrPath,
          })
        } else if (v && typeof v === 'object') {
          checkSecretAndSensitive(v as Record<string, unknown>, findings, arrPath)
        }
      }
    }
  }
}
export function validateTrizPluginPackOperation(
  payload: unknown,
  context?: TrizPluginPackValidationContext,
): TrizPluginPackValidationResult {
  const findings: TrizPluginPackFinding[] = []
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      findings: [
        {
          code: 'triz-pack-schema-invalid',
          severity: 'blocking',
          message: 'Payload must be a non-null object.',
        },
      ],
    }
  }
  const raw = payload as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (!(ALLOWED_PAYLOAD_FIELDS as readonly string[]).includes(key)) {
      findings.push({
        code: 'triz-pack-schema-invalid',
        severity: 'blocking',
        message: `Unallowed field '${key}'. Allowed: [${ALLOWED_PAYLOAD_FIELDS.join(', ')}]`,
        path: key,
      })
    }
  }
  if (typeof raw.operation !== 'string' || !isTrizPluginOperation(raw.operation)) {
    findings.push({
      code: 'triz-pack-unknown-operation',
      severity: 'blocking',
      message: `Unknown operation '${raw.operation}'. Allowed: [${TRIZ_PLUGIN_OPERATIONS.join(', ')}]`,
      path: 'operation',
    })
    return { valid: false, findings }
  }
  const op = raw.operation as TrizPluginOperation
  if (
    typeof raw.organizationId !== 'number' ||
    !Number.isInteger(raw.organizationId) ||
    raw.organizationId <= 0
  ) {
    findings.push({
      code: 'triz-pack-invalid-param',
      severity: 'blocking',
      message: 'organizationId must be positive integer',
      path: 'organizationId',
    })
  }
  if (typeof raw.projectId !== 'number' || !Number.isInteger(raw.projectId) || raw.projectId <= 0) {
    findings.push({
      code: 'triz-pack-invalid-param',
      severity: 'blocking',
      message: 'projectId must be positive integer',
      path: 'projectId',
    })
  }
  if (typeof raw.actorId !== 'number' || !Number.isInteger(raw.actorId) || raw.actorId <= 0) {
    findings.push({
      code: 'triz-pack-invalid-param',
      severity: 'blocking',
      message: 'actorId must be positive integer',
      path: 'actorId',
    })
  }
  if (
    context &&
    typeof raw.organizationId === 'number' &&
    raw.organizationId !== context.callerOrganizationId
  ) {
    findings.push({
      code: 'triz-pack-cross-tenant-denied',
      severity: 'blocking',
      message: `Cross-tenant denied: payload org ${raw.organizationId} != caller ${context.callerOrganizationId}`,
      path: 'organizationId',
    })
  }
  if (context) {
    if (!context.isPluginEnabled) {
      const code =
        context.installationStatus === 'uninstalled'
          ? 'triz-pack-uninstalled'
          : context.installationStatus === 'installed'
            ? 'triz-pack-not-enabled'
            : 'triz-pack-not-installed'
      findings.push({
        code,
        severity: 'blocking',
        message: `Plugin not enabled (status=${context.installationStatus ?? 'not_installed'})`,
        path: 'operation',
      })
    }
  }
  if (context && typeof context.providerCalls === 'number' && context.providerCalls !== 0) {
    findings.push({
      code: 'triz-pack-provider-calls-not-zero',
      severity: 'warning',
      message: `providerCalls=${context.providerCalls}, expected 0 for default fixture`,
      path: 'providerCalls',
    })
  }
  const input = raw.input as Record<string, unknown> | undefined
  if (input !== undefined) {
    if (typeof input !== 'object' || Array.isArray(input) || input === null) {
      findings.push({
        code: 'triz-pack-invalid-param',
        severity: 'blocking',
        message: 'input must be an object if provided',
        path: 'input',
      })
    } else {
      if (typeof input.message === 'string' && input.message.length > MAX_MESSAGE_LEN) {
        findings.push({
          code: 'triz-pack-param-out-of-bounds',
          severity: 'blocking',
          message: `message exceeds max length ${MAX_MESSAGE_LEN}`,
          path: 'input.message',
        })
      }
      if (
        typeof input.userContext === 'string' &&
        input.userContext.length > MAX_USER_CONTEXT_LEN
      ) {
        findings.push({
          code: 'triz-pack-param-out-of-bounds',
          severity: 'blocking',
          message: `userContext exceeds max length ${MAX_USER_CONTEXT_LEN}`,
          path: 'input.userContext',
        })
      }
      if (
        input.directWrite === true ||
        input.autoExecute === true ||
        input.skipConfirmation === true
      ) {
        findings.push({
          code: 'triz-pack-direct-write-attempt',
          severity: 'blocking',
          message: 'Direct formal write attempt without confirmation is forbidden',
          path: 'input',
        })
      }
      checkSecretAndSensitive(input, findings, 'input')
    }
  }
  checkSecretAndSensitive(raw, findings, '')
  const hasBlocking = findings.some((f) => f.severity === 'blocking')
  if (hasBlocking) {
    return { valid: false, findings }
  }
  const normalized: TrizPluginPackOperationPayload = {
    operation: op,
    organizationId: raw.organizationId as number,
    projectId: raw.projectId as number,
    actorId: raw.actorId as number,
    ...(input ? { input } : {}),
    ...(typeof raw.idempotencyKey === 'string'
      ? { idempotencyKey: String(raw.idempotencyKey).slice(0, 256) }
      : {}),
    ...(typeof raw.enableAi === 'boolean' ? { enableAi: raw.enableAi } : {}),
    ...(Array.isArray(raw.selectedSourceRefs)
      ? {
          selectedSourceRefs: raw.selectedSourceRefs.filter(
            (v) => typeof v === 'string',
          ) as string[],
        }
      : {}),
  }
  return { valid: true, findings, normalizedPayload: normalized }
}
export function isValidTrizCallbackHandle(handle: string): boolean {
  if (typeof handle !== 'string' || handle.length === 0) return false
  if (
    handle.includes('..') ||
    handle.includes('/') ||
    handle.includes('\\') ||
    handle.includes(':')
  )
    return false
  if (/https?:\/\//i.test(handle)) return false
  return isTrizPluginOperation(handle)
}
export function buildTrizPackHealthReport(
  organizationId: number,
  pluginId: string,
  pluginVersion: string,
  installationStatus: string,
  contributions: ReadonlyArray<{
    contributionKey: string
    seamKey: string
    isEffective?: boolean
    reasonCode?: string
  }>,
): TrizPluginPackHealthReport {
  const items: TrizPluginPackHealthItem[] = contributions.map((c) => ({
    contributionKey: c.contributionKey,
    seamKey: c.seamKey,
    status: c.isEffective
      ? 'effective'
      : installationStatus === 'enabled'
        ? 'inactive'
        : 'not_installed',
    reasonCode: c.reasonCode,
    reasonMessage: c.reasonCode
      ? `Contribution ${c.contributionKey} reason=${c.reasonCode}`
      : undefined,
    isEffective: Boolean(c.isEffective && installationStatus === 'enabled'),
  }))
  const effectiveOperations: TrizPluginOperation[] =
    installationStatus === 'enabled' ? [...TRIZ_PLUGIN_OPERATIONS] : []
  return {
    pluginId,
    pluginVersion,
    organizationId,
    installationStatus,
    contributions: items,
    effectiveOperations,
  }
}
export function sanitizeTrizPackPayloadForAudit(
  payload: TrizPluginPackOperationPayload,
): Record<string, unknown> {
  return {
    operation: payload.operation,
    organizationId: payload.organizationId,
    projectId: payload.projectId,
    actorId: payload.actorId,
    inputSummary: payload.input
      ? {
          keys: Object.keys(payload.input),
          inputHash: trizPackFnv1aHash(trizPackStableSerialize(payload.input)).slice(0, 8),
        }
      : undefined,
    idempotencyKey: payload.idempotencyKey ? `${payload.idempotencyKey.slice(0, 8)}...` : undefined,
  }
}
export function isTrizPackFindingCode(v: unknown): v is TrizPluginPackFindingCode {
  return typeof v === 'string' && (TRIZ_PLUGIN_PACK_FINDING_CODES as readonly string[]).includes(v)
}
