/**
 * V3 plugin compatibility matrix.
 *
 * This is the single deterministic evaluator consumed by release/install/enable/
 * upgrade/rollback paths. It deliberately has no clock, network, database or
 * framework dependency.
 */
import {
  checkSeamCompatibility,
  type PluginCapabilitySeamEntry,
} from './plugin-capability-seam-catalog.js'

export const PLUGIN_COMPATIBILITY_REASON_CODES = [
  'compatible',
  'compatible-legacy-approved-release',
  'migration-required',
  'host-version-out-of-range',
  'manifest-schema-unsupported',
  'permission-model-unsupported',
  'distribution-channel-unsupported',
  'prerelease-not-allowed',
  'seam-unknown',
  'seam-version-incompatible',
  'seam-not-host-ready',
  'dependency-incompatible',
  'migration-missing',
  'rollback-missing',
  'breaking-change-unhandled',
  'input-unknown',
] as const
export type PluginCompatibilityReasonCode = (typeof PLUGIN_COMPATIBILITY_REASON_CODES)[number]

export interface HostPluginContractSnapshot {
  hostVersion: string
  manifestSchemaVersions: readonly string[]
  permissionModelVersion: string
  distributionChannels: readonly ('stable' | 'prerelease')[]
  seams: readonly PluginCapabilitySeamEntry[]
}

export interface PluginMigrationRequirement {
  id: string
  fromVersion: string
  toVersion: string
  migrationRef?: string
  rollbackRef?: string
  reversible: boolean
}

export interface PluginCompatibilityDeclaration {
  pluginVersion: string
  hostRange: string
  manifestSchemaVersion: string
  permissionModelVersion: string
  channel: 'stable' | 'prerelease'
  requiredSeams: readonly { seamKey: string; seamVersion: string }[]
  dependencies?: readonly { pluginId: string; versionRange: string; resolvedVersion?: string }[]
  migrations?: readonly PluginMigrationRequirement[]
}

export interface PluginCompatibilityFinding {
  code: PluginCompatibilityReasonCode
  fieldPath: string
  severity: 'info' | 'migration' | 'blocking'
}

export interface PluginCompatibilityEvaluation {
  verdict: 'compatible' | 'migration-required' | 'incompatible' | 'unknown'
  compatible: boolean
  reasons: readonly PluginCompatibilityFinding[]
  digest: string
}

export interface PluginBreakingSnapshot {
  pluginId: string
  version: string
  requiredFields: readonly string[]
  capabilities: readonly string[]
  permissions: readonly string[]
  enums?: Readonly<Record<string, readonly string[]>>
  migrationRef?: string
  rollbackRef?: string
  reversible?: boolean
}

export interface PluginBreakingFinding {
  kind:
    | 'required-field-removed'
    | 'capability-narrowed'
    | 'permission-elevated'
    | 'enum-value-removed'
    | 'irreversible-migration'
    | 'rollback-missing'
  fieldPath: string
  severity: 'blocking'
  migrationRef?: string
  rollbackRef?: string
}

export interface PluginBreakingChangeResult {
  breaking: boolean
  findings: readonly PluginBreakingFinding[]
  digest: string
}

export interface PluginReleaseApprovalCompatibilityInput {
  host: HostPluginContractSnapshot
  declaration?: PluginCompatibilityDeclaration
  breakingChange?: {
    before: PluginBreakingSnapshot
    after: PluginBreakingSnapshot
    /** Reviewer-supplied acknowledgement bound to the deterministic finding digest. */
    handledDigest?: string
  }
}

export interface PluginReleaseApprovalCompatibilityResult {
  allowed: boolean
  reasonCodes: readonly PluginCompatibilityReasonCode[]
  digest: string
  compatibility?: PluginCompatibilityEvaluation
  breakingChanges?: PluginBreakingChangeResult
}

interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease?: string
}

export function parsePluginSemver(value: string): ParsedSemver | null {
  // 声明可能来自损坏的 release metadata：非字符串一律判为不可解析（fail-closed），
  // 绝不抛出——审批/目录/安装链路要的是 allowed:false，不是 500。
  if (typeof value !== 'string') return null
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(
    value.trim(),
  )
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] ? { prerelease: match[4] } : {}),
  }
}

export function comparePluginSemver(a: string, b: string): number {
  const pa = parsePluginSemver(a)
  const pb = parsePluginSemver(b)
  if (!pa || !pb) return 0
  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch
  if (pa.prerelease === pb.prerelease) return 0
  if (!pa.prerelease) return 1
  if (!pb.prerelease) return -1
  return pa.prerelease.localeCompare(pb.prerelease)
}

/** Conservative range support: exact, ^x.y.z, >=x.y.z, and bounded space-separated comparisons. */
export function satisfiesPluginVersionRange(version: string, range: string): boolean {
  const parsed = parsePluginSemver(version)
  if (!parsed || typeof range !== 'string' || !range.trim()) return false
  const trimmed = range.trim()
  if (trimmed.startsWith('^')) {
    const base = parsePluginSemver(trimmed.slice(1))
    return (
      !!base && parsed.major === base.major && comparePluginSemver(version, trimmed.slice(1)) >= 0
    )
  }
  if (parsePluginSemver(trimmed)) return comparePluginSemver(version, trimmed) === 0
  const clauses = trimmed.split(/\s+/)
  return clauses.every((clause) => {
    const match = /^(>=|<=|>|<)(.+)$/.exec(clause)
    if (!match || !parsePluginSemver(match[2]!)) return false
    const cmp = comparePluginSemver(version, match[2]!)
    return match[1] === '>='
      ? cmp >= 0
      : match[1] === '<='
        ? cmp <= 0
        : match[1] === '>'
          ? cmp > 0
          : cmp < 0
  })
}

export function compatibilityStableSerialize(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(compatibilityStableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${compatibilityStableSerialize(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function compatibilityFnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function computePluginCompatibilityDigest(value: unknown): string {
  return `sha256:${compatibilityFnv1aHash(compatibilityStableSerialize(value))}`
}

function finding(
  code: PluginCompatibilityReasonCode,
  fieldPath: string,
  severity: PluginCompatibilityFinding['severity'] = 'blocking',
): PluginCompatibilityFinding {
  return { code, fieldPath, severity }
}

export function evaluatePluginCompatibility(
  host: HostPluginContractSnapshot,
  declaration: PluginCompatibilityDeclaration,
): PluginCompatibilityEvaluation {
  const reasons: PluginCompatibilityFinding[] = []
  const pluginVersion = parsePluginSemver(declaration.pluginVersion)
  if (!pluginVersion || !parsePluginSemver(host.hostVersion)) {
    reasons.push(finding('input-unknown', 'pluginVersion'))
  } else if (pluginVersion.prerelease && declaration.channel !== 'prerelease') {
    reasons.push(finding('prerelease-not-allowed', 'pluginVersion'))
  }
  if (!satisfiesPluginVersionRange(host.hostVersion, declaration.hostRange)) {
    reasons.push(finding('host-version-out-of-range', 'hostRange'))
  }
  if (!host.manifestSchemaVersions.includes(declaration.manifestSchemaVersion)) {
    reasons.push(finding('manifest-schema-unsupported', 'manifestSchemaVersion'))
  }
  if (host.permissionModelVersion !== declaration.permissionModelVersion) {
    reasons.push(finding('permission-model-unsupported', 'permissionModelVersion'))
  }
  if (!host.distributionChannels.includes(declaration.channel)) {
    reasons.push(finding('distribution-channel-unsupported', 'channel'))
  }

  // 损坏声明里 requiredSeams 可能缺失或不是数组：记 input-unknown 后按空集继续，
  // 保证整条评估以 allowed:false 收束而不是抛出。
  const requiredSeams = Array.isArray(declaration.requiredSeams) ? declaration.requiredSeams : []
  if (!Array.isArray(declaration.requiredSeams)) {
    reasons.push(finding('input-unknown', 'requiredSeams'))
  }

  for (const [index, required] of [...requiredSeams]
    .sort((a, b) => `${a.seamKey}@${a.seamVersion}`.localeCompare(`${b.seamKey}@${b.seamVersion}`))
    .entries()) {
    const candidates = host.seams.filter((entry) => entry.seamKey === required.seamKey)
    if (candidates.length === 0) {
      reasons.push(finding('seam-unknown', `requiredSeams.${index}`))
      continue
    }
    const compatible = candidates.some(
      (entry) =>
        checkSeamCompatibility({
          catalogVersion: entry.seamVersion,
          requestedVersion: required.seamVersion,
          policy: entry.compatibilityPolicy,
          deprecated: entry.deprecated,
        }).compatible,
    )
    if (!compatible) reasons.push(finding('seam-version-incompatible', `requiredSeams.${index}`))
    else if (!candidates.some((entry) => entry.availability === 'host-ready')) {
      reasons.push(finding('seam-not-host-ready', `requiredSeams.${index}`))
    }
  }

  // 同理：dependencies/migrations 若存在但不是数组，记 input-unknown 而不是静默忽略——
  // 忽略等于放行，与 fail-closed 相反。
  if (declaration.dependencies !== undefined && !Array.isArray(declaration.dependencies)) {
    reasons.push(finding('input-unknown', 'dependencies'))
  }
  if (declaration.migrations !== undefined && !Array.isArray(declaration.migrations)) {
    reasons.push(finding('input-unknown', 'migrations'))
  }

  for (const [index, dependency] of (Array.isArray(declaration.dependencies)
    ? declaration.dependencies
    : []
  ).entries()) {
    if (
      !dependency.resolvedVersion ||
      !satisfiesPluginVersionRange(dependency.resolvedVersion, dependency.versionRange)
    ) {
      reasons.push(finding('dependency-incompatible', `dependencies.${index}`))
    }
  }

  for (const [index, migration] of (Array.isArray(declaration.migrations)
    ? declaration.migrations
    : []
  ).entries()) {
    if (!migration.migrationRef)
      reasons.push(finding('migration-missing', `migrations.${index}.migrationRef`))
    if (!migration.rollbackRef)
      reasons.push(finding('rollback-missing', `migrations.${index}.rollbackRef`))
    if (migration.migrationRef && migration.rollbackRef)
      reasons.push(finding('migration-required', `migrations.${index}`, 'migration'))
  }

  reasons.sort((a, b) => `${a.fieldPath}:${a.code}`.localeCompare(`${b.fieldPath}:${b.code}`))
  const blocking = reasons.some((item) => item.severity === 'blocking')
  const migrationRequired = !blocking && reasons.some((item) => item.severity === 'migration')
  const verdict = blocking
    ? reasons.some((item) => item.code === 'input-unknown')
      ? 'unknown'
      : 'incompatible'
    : migrationRequired
      ? 'migration-required'
      : 'compatible'
  const normalized = { host, declaration, verdict, reasons }
  return {
    verdict,
    compatible: !blocking,
    reasons,
    digest: computePluginCompatibilityDigest(normalized),
  }
}

export function detectPluginBreakingChanges(
  before: PluginBreakingSnapshot,
  after: PluginBreakingSnapshot,
): PluginBreakingChangeResult {
  const findings: PluginBreakingFinding[] = []
  const add = (kind: PluginBreakingFinding['kind'], fieldPath: string) =>
    findings.push({
      kind,
      fieldPath,
      severity: 'blocking',
      ...(after.migrationRef ? { migrationRef: after.migrationRef } : {}),
      ...(after.rollbackRef ? { rollbackRef: after.rollbackRef } : {}),
    })
  for (const field of before.requiredFields)
    if (!after.requiredFields.includes(field))
      add('required-field-removed', `requiredFields.${field}`)
  for (const capability of before.capabilities)
    if (!after.capabilities.includes(capability))
      add('capability-narrowed', `capabilities.${capability}`)
  for (const permission of after.permissions)
    if (!before.permissions.includes(permission))
      add('permission-elevated', `permissions.${permission}`)
  for (const [key, values] of Object.entries(before.enums ?? {})) {
    const next = after.enums?.[key] ?? []
    for (const value of values)
      if (!next.includes(value)) add('enum-value-removed', `enums.${key}.${value}`)
  }
  if (findings.length > 0 && after.reversible === false) add('irreversible-migration', 'reversible')
  if (findings.length > 0 && !after.rollbackRef) add('rollback-missing', 'rollbackRef')
  findings.sort((a, b) => `${a.fieldPath}:${a.kind}`.localeCompare(`${b.fieldPath}:${b.kind}`))
  return {
    breaking: findings.length > 0,
    findings,
    digest: computePluginCompatibilityDigest({ before, after, findings }),
  }
}

/**
 * Release-approval gate. Missing compatibility input and unacknowledged
 * breaking changes fail closed; the acknowledgement is bound to the exact
 * canonical breaking-change digest so a changed release must be reviewed again.
 */
export function evaluatePluginReleaseApprovalCompatibility(
  input: PluginReleaseApprovalCompatibilityInput,
): PluginReleaseApprovalCompatibilityResult {
  // 声明缺失或不是对象（损坏 metadata）：统一 fail-closed，绝不抛出。
  if (!input.declaration || typeof input.declaration !== 'object') {
    const reasonCodes: PluginCompatibilityReasonCode[] = ['input-unknown']
    return {
      allowed: false,
      reasonCodes,
      digest: computePluginCompatibilityDigest({ host: input.host, reasonCodes }),
    }
  }

  const compatibility = evaluatePluginCompatibility(input.host, input.declaration)
  const breakingChanges = input.breakingChange
    ? detectPluginBreakingChanges(input.breakingChange.before, input.breakingChange.after)
    : undefined
  const breakingUnhandled =
    breakingChanges?.breaking === true &&
    input.breakingChange?.handledDigest !== breakingChanges.digest
  const reasonCodes = [
    ...compatibility.reasons.map((item) => item.code),
    ...(breakingUnhandled ? (['breaking-change-unhandled'] as const) : []),
  ].sort()
  return {
    allowed: compatibility.compatible && !breakingUnhandled,
    reasonCodes,
    digest: computePluginCompatibilityDigest({
      compatibilityDigest: compatibility.digest,
      breakingDigest: breakingChanges?.digest ?? null,
      handledDigest: input.breakingChange?.handledDigest ?? null,
      reasonCodes,
    }),
    compatibility,
    ...(breakingChanges ? { breakingChanges } : {}),
  }
}

/** Low-sensitivity audit projection: only stable codes/paths/digest are retained. */
export function projectPluginCompatibilityAudit(evaluation: PluginCompatibilityEvaluation) {
  return {
    verdict: evaluation.verdict,
    compatibilityDigest: evaluation.digest,
    reasonCodes: evaluation.reasons.map((item) => item.code),
    fieldPaths: evaluation.reasons.map((item) => item.fieldPath),
  }
}

/** Unknown external reason strings are never copied into audit output. */
export function normalizePluginCompatibilityReason(value: string): PluginCompatibilityReasonCode {
  return (PLUGIN_COMPATIBILITY_REASON_CODES as readonly string[]).includes(value)
    ? (value as PluginCompatibilityReasonCode)
    : 'input-unknown'
}
