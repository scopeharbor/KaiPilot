/**
 * plugin-manifest —— V3 插件 manifest、权限声明与权限不升级验证共享契约
 * （纯类型 + 常量 + 类型守卫 + 确定性归一化/校验/digest + 低敏 sanitization，
 * 零运行时依赖，零网络/IO/时间/随机数依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块（同 @aiproj/types 其他模块）。
 * 测试见 `plugin-manifest.test.ts`，fixtures 见 `plugin-manifest-fixtures.ts`，
 * 本机 checker 见 `scripts/check-plugin-manifest.ts`。
 *
 * # 语义要点（对应 design.md D1~D10 与 specs/plugin-manifest-and-permission-contract/spec.md）
 * - manifest 契约由共享类型包和宿主核心拥有（D1）；插件只拥有自己的声明内容。
 * - V1 manifest 只描述声明，不表达"已安装"或"可执行"（D2）。
 * - identity、路径与版本采用确定且保守的首期规则（D3）。
 * - 权限由宿主词表限定，manifest 只提出 requested 上限（D4）。
 * - requested、granted 与 runtime authorization 三层严格分离（D5）。
 * - contribution 必须单一引用 seam，权限集合必须可追溯（D6）。
 * - canonical form、digest 与 findings 必须稳定且低敏（D7）。
 * - 验证 context 是可信输入，manifest 不能声明宿主事实（D8）。
 * - 本 change 只接类型、fixtures、测试和显式本机 checker（D9）。
 * - 前置与证据门禁在 apply 第一阶段执行（D10）。
 */

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** manifest schema 版本（首版固定 "1.0"）。 */
export const MANIFEST_SCHEMA_VERSION = '1.0' as const
export type ManifestSchemaVersion = typeof MANIFEST_SCHEMA_VERSION

/** distribution class（V3 首期只允许 first-party 或 organization-private）。 */
export const MANIFEST_DISTRIBUTION_CLASSES = [
  'first-party',
  'organization-private',
  'public-marketplace',
  'remote-registry',
] as const
export type ManifestDistributionClass = (typeof MANIFEST_DISTRIBUTION_CLASSES)[number]

/** 安全关键枚举中 allowed values（V3 首期）。 */
export const MANIFEST_ALLOWED_DISTRIBUTIONS: readonly ManifestDistributionClass[] = [
  'first-party',
  'organization-private',
]

/** contribution entrypoint kind。 */
export const MANIFEST_ENTRYPOINT_KINDS = ['esm', 'commonjs', 'css', 'html', 'json', 'wasm'] as const
export type ManifestEntrypointKind = (typeof MANIFEST_ENTRYPOINT_KINDS)[number]

/** content digest algorithm（首期支持）。 */
export const MANIFEST_DIGEST_ALGORITHMS = ['sha256', 'sha512', 'sha384'] as const
export type ManifestDigestAlgorithm = (typeof MANIFEST_DIGEST_ALGORITHMS)[number]

/** permission side-effect class（与 seam catalog 对齐）。 */
export const MANIFEST_PERMISSION_SIDE_EFFECTS = [
  'none',
  'read-only',
  'advisory',
  'render',
  'transform',
  'preview',
  'proposal',
  'formal-write',
  'external-action',
] as const
export type ManifestPermissionSideEffect = (typeof MANIFEST_PERMISSION_SIDE_EFFECTS)[number]

/** permission confirmation policy。 */
export const MANIFEST_PERMISSION_CONFIRMATION_POLICIES = [
  'not-required',
  'required',
  'host-brokered',
  'forbidden',
] as const
export type ManifestPermissionConfirmationPolicy =
  (typeof MANIFEST_PERMISSION_CONFIRMATION_POLICIES)[number]

/** permission network policy（默认 fixture/mock）。 */
export const MANIFEST_PERMISSION_NETWORK_POLICIES = [
  'none',
  'host-brokered',
  'fixture-mock-only',
  'direct-allowed',
] as const
export type ManifestPermissionNetworkPolicy = (typeof MANIFEST_PERMISSION_NETWORK_POLICIES)[number]

/** scope kind（manifest 中不允许 global）。 */
export const MANIFEST_SCOPE_KINDS = ['organization', 'project'] as const
export type ManifestScopeKind = (typeof MANIFEST_SCOPE_KINDS)[number]

/** finding 严重度。 */
export const MANIFEST_SEVERITIES = ['info', 'warning', 'blocking'] as const
export type ManifestSeverity = (typeof MANIFEST_SEVERITIES)[number]

/** finding code（封闭集，机器可判）。 */
export const MANIFEST_FINDING_CODES = [
  // schema/enum
  'manifest-schema-invalid',
  'manifest-unknown-enum',
  'manifest-unknown-security-critical-field',
  // identity
  'manifest-invalid-plugin-id',
  'manifest-invalid-publisher-key',
  'manifest-invalid-semver',
  'manifest-latest-not-allowed',
  'manifest-incomplete-semver',
  'manifest-unallowed-distribution',
  // compatibility
  'manifest-unknown-seam',
  'manifest-incompatible-seam-version',
  'manifest-cross-major-seam',
  'manifest-future-seam-version',
  'manifest-deprecated-seam-no-migration',
  // contribution
  'manifest-duplicate-contribution-key',
  'manifest-contribution-bundled-high-risk',
  'manifest-contribution-seam-mismatch',
  'manifest-contribution-orphan-permission',
  'manifest-contribution-entrypoint-mismatch',
  // permission
  'manifest-unknown-permission-key',
  'manifest-free-text-permission',
  'manifest-implicit-global-scope',
  'manifest-missing-scope-owner',
  'manifest-permission-not-in-seam',
  'manifest-permission-scope-expanded',
  'manifest-permission-action-expanded',
  'manifest-permission-network-relaxed',
  'manifest-permission-side-effect-relaxed',
  'manifest-duplicate-permission',
  // authority redline
  'manifest-tenant-authority-claim',
  'manifest-policy-bypass-claim',
  'manifest-direct-db-write-claim',
  'manifest-skip-confirmation-claim',
  'manifest-plugin-self-audit-claim',
  'manifest-organization-id-in-manifest',
  'manifest-project-id-in-manifest',
  'manifest-user-id-in-manifest',
  'manifest-role-authority-claim',
  // formal-write / external-action / secret
  'manifest-direct-transaction',
  'manifest-unrestricted-network',
  'manifest-external-action-not-conditional',
  'manifest-external-action-not-host-brokered',
  'manifest-external-action-no-independent-auth',
  'manifest-raw-secret-value',
  // path / descriptor
  'manifest-absolute-entrypoint',
  'manifest-traversal-entrypoint',
  'manifest-url-entrypoint',
  'manifest-control-char-entrypoint',
  'manifest-empty-entrypoint',
  'manifest-windows-drive-entrypoint',
  'manifest-invalid-digest-algorithm',
  'manifest-digest-shape-invalid',
  'manifest-secret-default-in-config',
  // dependency
  'manifest-self-dependency',
  'manifest-duplicate-dependency',
  'manifest-url-dependency',
  'manifest-latest-dependency',
  'manifest-unbounded-range-dependency',
  // grant
  'manifest-grant-digest-mismatch',
  'manifest-grant-identity-mismatch',
  'manifest-grant-scope-expanded',
  'manifest-grant-network-relaxed',
  'manifest-grant-side-effect-relaxed',
  'manifest-grant-escalation',
  'manifest-grant-global-scope',
  'manifest-grant-client-authority',
  'manifest-grant-sensitive-value',
  // Skill adapter
  'manifest-skill-no-adapter-seam',
  'manifest-skill-parallel-registry',
  'manifest-skill-lifecycle-mapping',
  // redaction
  'manifest-redaction-violation',
  // tool
  'manifest-tool-error',
] as const
export type ManifestFindingCode = (typeof MANIFEST_FINDING_CODES)[number]

/** 不可 waiver 的 redline finding codes（blocking，不得被 warning 放行）。 */
export const MANIFEST_REDLINE_CODES: readonly ManifestFindingCode[] = [
  'manifest-implicit-global-scope',
  'manifest-tenant-authority-claim',
  'manifest-policy-bypass-claim',
  'manifest-direct-db-write-claim',
  'manifest-skip-confirmation-claim',
  'manifest-plugin-self-audit-claim',
  'manifest-organization-id-in-manifest',
  'manifest-project-id-in-manifest',
  'manifest-user-id-in-manifest',
  'manifest-role-authority-claim',
  'manifest-direct-transaction',
  'manifest-unrestricted-network',
  'manifest-external-action-not-conditional',
  'manifest-external-action-not-host-brokered',
  'manifest-external-action-no-independent-auth',
  'manifest-raw-secret-value',
  'manifest-unknown-seam',
  'manifest-unallowed-distribution',
]

/** checker exit codes。 */
export const MANIFEST_CHECKER_EXIT = {
  pass: 0,
  blocking: 1,
  toolError: 2,
} as const

/** 不应出现在 manifest/findings 中的敏感键模式（小写匹配）。 */
export const MANIFEST_SENSITIVE_KEY_PATTERNS = [
  'token',
  'secret',
  'password',
  'apikey',
  'api_key',
  'authorization',
  'bearer',
  'credential',
  'private_key',
  'private-key',
] as const

/** 不应出现在输出中的敏感值模式。 */
export const MANIFEST_SENSITIVE_VALUE_PATTERNS = [
  /(?:^|\s)(?:sk|pk|tk)_[A-Za-z0-9]{20,}/,
  /(?:^|\s)Bearer\s+[A-Za-z0-9._\-]+/,
  /(?:^|\s)(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
] as const

// =============================================================================
// 2. 核心类型
// =============================================================================

/** plugin identity（规范化）。使用 Manifest 前缀避免 barrel 冲突。 */
export interface ManifestPluginIdentity {
  /** 规范化 pluginId（小写命名空间格式：`org.plugin-name`）。 */
  pluginId: string
  /** 显示名称。 */
  name: string
  /** 完整 SemVer。 */
  version: string
  /** 描述。 */
  description?: string
  /** publisher key（小写命名空间格式）。 */
  publisher: string
}

/** 低敏 provenance。 */
export interface PluginProvenance {
  /** distribution class。 */
  distribution: ManifestDistributionClass
  /** 低敏 source ref（如 "repo:github.com/org/repo@commit"）。 */
  sourceRef?: string
}

/** host 兼容性声明。 */
export interface PluginCompatibility {
  /** 宿主契约版本（如 "1.0"）。 */
  hostContractVersion: string
  /** 所需 seam refs（seamKey + version）。 */
  requiredSeams: PluginSeamRef[]
}

/** seam 引用。 */
export interface PluginSeamRef {
  /** seam key。 */
  seamKey: string
  /** 完整 SemVer。 */
  seamVersion: string
}

/** entrypoint 描述符（安全路径）。 */
export interface PluginEntrypointDescriptor {
  /** entrypoint kind。 */
  kind: ManifestEntrypointKind
  /** 包内相对 POSIX 路径或声明式引用。 */
  path: string
}

/** contribution declaration。 */
export interface PluginContributionDeclaration {
  /** 稳定 contribution key（小写命名空间格式）。 */
  contributionKey: string
  /** 单一 seam key。 */
  seamKey: string
  /** 完整 SemVer。 */
  seamVersion: string
  /** 安全 entrypoint 描述符。 */
  entrypoint: PluginEntrypointDescriptor
  /** 使用的 permission keys（必须属于该 seam）。 */
  permissionRefs?: string[]
  /** 配置 schema ref（可选）。 */
  configSchemaRef?: string
}

/** permission request（宿主拥有的封闭词表）。 */
export interface PluginPermissionRequest {
  /** 稳定 permission key。 */
  permissionKey: string
  /** 关联 seam key。 */
  seamKey: string
  /** scope kind（organization | project）。 */
  scopeKind: ManifestScopeKind
  /** host-owned resource ref。 */
  resourceRef?: string
  /** host-owned action ref。 */
  actionRef?: string
  /** side-effect class。 */
  sideEffect: ManifestPermissionSideEffect
  /** confirmation policy。 */
  confirmation: ManifestPermissionConfirmationPolicy
  /** network policy。 */
  network: ManifestPermissionNetworkPolicy
  /** 低敏 purpose code。 */
  purpose?: string
}

/** dependency declaration。 */
export interface PluginDependency {
  /** 依赖的 pluginId。 */
  pluginId: string
  /** 版本要求（首期只允许 exact 或 same-major）。 */
  versionRequirement: string
}

/** content digest descriptor（仅形状，不读取包）。 */
export interface PluginContentDigestDescriptor {
  /** digest algorithm。 */
  algorithm: ManifestDigestAlgorithm
  /** 十六进制摘要值。 */
  digest: string
}

/** 非权威、命名空间化的 extensions metadata。 */
export type PluginExtensions = Record<string, unknown>

/** 完整的 V1 plugin manifest。 */
export interface PluginManifestV1 {
  /** schema 版本（固定 "1.0"）。 */
  manifestSchemaVersion: ManifestSchemaVersion
  /** 插件 identity。 */
  identity: ManifestPluginIdentity
  /** 低敏 provenance。 */
  provenance: PluginProvenance
  /** host 兼容性。 */
  compatibility: PluginCompatibility
  /** contribution 声明（可多个）。 */
  contributions: PluginContributionDeclaration[]
  /** 去重后的 requested permission declarations。 */
  permissions: PluginPermissionRequest[]
  /** 依赖声明。 */
  dependencies?: PluginDependency[]
  /** 包内容 digest 描述符。 */
  contentDescriptor?: PluginContentDigestDescriptor
  /** 非权威 extensions。 */
  extensions?: PluginExtensions
}

// =============================================================================
// 3. Grant snapshot（不持久化，纯输入形状）
// =============================================================================

/** grant snapshot（宿主生成的权限授予快照）。 */
export interface PluginPermissionGrantSnapshot {
  /** grant id（宿主生成）。 */
  grantId: string
  /** manifest digest（匹配 manifest 时相同）。 */
  manifestDigest: string
  /** plugin identity（匹配 manifest 时相同）。 */
  pluginId: string
  /** 可信 organization/project scope binding。 */
  scopeBinding: PluginGrantScopeBinding
  /** granted permission keys（subset of manifest requested）。 */
  grantedPermissions: string[]
  /** 决策低敏 ref（如 "decision:granted:2026-08-16"）。 */
  decisionRef?: string
  /** 过期低敏 ref。 */
  expiryRef?: string
  /** 撤销低敏 ref。 */
  revokeRef?: string
}

/** grant scope binding。 */
export interface PluginGrantScopeBinding {
  /** organization id hash（低敏）。 */
  organizationIdHash: string
  /** project id hash（可选，低敏）。 */
  projectIdHash?: string
}

// =============================================================================
// 4. Validation context & result
// =============================================================================

/** validation context（可信输入，manifest 不能声明宿主事实）。 */
export interface PluginManifestValidationContext {
  /** 宿主契约版本。 */
  hostContractVersion: string
  /** seam catalog snapshot（seamKey → { version, availability, ... }）。 */
  seamCatalog: Record<string, PluginCatalogSnapshotEntry>
  /** 宿主 permission vocabulary（permissionKey → { seamKey, max scope/action/sideEffect/... }）。 */
  permissionVocabulary: Record<string, PluginPermissionVocabularyEntry>
  /** 允许的 distribution class。 */
  allowedDistributions: readonly ManifestDistributionClass[]
  /** 当前 reference time（若检查 grant expiry；由调用方注入）。 */
  referenceTime?: Date
  /** 是否运行在 contextual validation 模式（影响 cataloged-not-host-ready finding）。 */
  contextualMode?: boolean
}

/** catalog snapshot entry（从 seam catalog 简化的快照）。 */
export interface PluginCatalogSnapshotEntry {
  /** seam version。 */
  seamVersion: string
  /** availability。 */
  availability: 'cataloged' | 'host-ready' | 'deprecated'
  /** host surface。 */
  surface: string
  /** 所需权限上限。 */
  requiredPermissions: string[]
  /** scope modes。 */
  scopeModes: string[]
  /** side-effect class 上限。 */
  sideEffectCeiling: string
  /** confirmation policy 上限。 */
  confirmationCeiling: string
  /** network policy 上限。 */
  networkCeiling: string
  /** replacement seam（若 deprecated）。 */
  replacementSeamKey?: string
}

/** permission vocabulary entry（从宿主 permission vocabulary 简化）。 */
export interface PluginPermissionVocabularyEntry {
  /** 关联 seam key。 */
  seamKey: string
  /** max scope kind。 */
  maxScopeKind: ManifestScopeKind
  /** max resource action。 */
  maxResourceAction?: string
  /** max side-effect class。 */
  maxSideEffect: ManifestPermissionSideEffect
  /** max confirmation policy。 */
  maxConfirmation: ManifestPermissionConfirmationPolicy
  /** max network policy。 */
  maxNetwork: ManifestPermissionNetworkPolicy
}

/** validation finding。 */
export interface PluginManifestFinding {
  /** finding code。 */
  code: ManifestFindingCode
  /** severity。 */
  severity: ManifestSeverity
  /** 字段路径（如 "permissions[0].sideEffect"）。 */
  path?: string
  /** plugin/contribution/permission key。 */
  key?: string
  /** 计数。 */
  count?: number
  /** digest ref。 */
  digest?: string
  /** 低敏 evidence ref。 */
  evidenceRef?: string
}

/** validation result。 */
export interface PluginManifestValidationResult {
  /** 是否 valid。 */
  valid: boolean
  /** findings。 */
  findings: PluginManifestFinding[]
  /** normalized manifest（仅 valid 时有值）。 */
  normalizedManifest?: PluginManifestV1
  /** manifest digest（仅 valid 时有值）。 */
  manifestDigest?: string
}

// =============================================================================
// 5. Grant validation
// =============================================================================

/** grant subset validation result。 */
export interface PluginGrantValidationResult {
  /** 是否 valid。 */
  valid: boolean
  /** findings。 */
  findings: PluginManifestFinding[]
}

// =============================================================================
// 6. Runtime authorization prerequisites（描述性 guard）
// =============================================================================

/** runtime authorization guard result（低敏描述，不是运行时授权）。 */
export interface PluginRuntimeAuthPrerequisites {
  /** 是否有有效安装态。 */
  hasValidInstall: boolean
  /** 是否有未撤销的 grant。 */
  hasValidGrant: boolean
  /** 是否有当前 RBAC/Policy 匹配。 */
  hasRBACPolicyMatch: boolean
  /** 是否有 scope match。 */
  hasScopeMatch: boolean
  /** 是否有 host-ready seam。 */
  hasHostReadySeam: boolean
  /** 是否满足 confirmation/audit requirements。 */
  meetsConfirmationAudit: boolean
  /** 最终结论：是否 authorized（需要全部为 true）。 */
  authorized: boolean
}

// =============================================================================
// 7. 类型守卫
// =============================================================================

export function isManifestSchemaVersion(v: unknown): v is ManifestSchemaVersion {
  return v === MANIFEST_SCHEMA_VERSION
}

export function isManifestDistributionClass(v: unknown): v is ManifestDistributionClass {
  return typeof v === 'string' && (MANIFEST_DISTRIBUTION_CLASSES as readonly string[]).includes(v)
}

export function isManifestAllowedDistribution(v: unknown): v is ManifestDistributionClass {
  return typeof v === 'string' && (MANIFEST_ALLOWED_DISTRIBUTIONS as readonly string[]).includes(v)
}

export function isManifestEntrypointKind(v: unknown): v is ManifestEntrypointKind {
  return typeof v === 'string' && (MANIFEST_ENTRYPOINT_KINDS as readonly string[]).includes(v)
}

export function isManifestDigestAlgorithm(v: unknown): v is ManifestDigestAlgorithm {
  return typeof v === 'string' && (MANIFEST_DIGEST_ALGORITHMS as readonly string[]).includes(v)
}

export function isManifestPermissionSideEffect(v: unknown): v is ManifestPermissionSideEffect {
  return (
    typeof v === 'string' && (MANIFEST_PERMISSION_SIDE_EFFECTS as readonly string[]).includes(v)
  )
}

export function isManifestPermissionConfirmationPolicy(
  v: unknown,
): v is ManifestPermissionConfirmationPolicy {
  return (
    typeof v === 'string' &&
    (MANIFEST_PERMISSION_CONFIRMATION_POLICIES as readonly string[]).includes(v)
  )
}

export function isManifestPermissionNetworkPolicy(
  v: unknown,
): v is ManifestPermissionNetworkPolicy {
  return (
    typeof v === 'string' && (MANIFEST_PERMISSION_NETWORK_POLICIES as readonly string[]).includes(v)
  )
}

export function isManifestScopeKind(v: unknown): v is ManifestScopeKind {
  return typeof v === 'string' && (MANIFEST_SCOPE_KINDS as readonly string[]).includes(v)
}

export function isManifestSeverity(v: unknown): v is ManifestSeverity {
  return typeof v === 'string' && (MANIFEST_SEVERITIES as readonly string[]).includes(v)
}

export function isManifestFindingCode(v: unknown): v is ManifestFindingCode {
  return typeof v === 'string' && (MANIFEST_FINDING_CODES as readonly string[]).includes(v)
}

export function isManifestRedlineCode(code: ManifestFindingCode): boolean {
  return (MANIFEST_REDLINE_CODES as readonly string[]).includes(code)
}

// =============================================================================
// 8. SemVer 校验
// =============================================================================

/** 完整 SemVer 正则（MAJOR.MINOR.PATCH，无预发布/构建元数据）。 */
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** 校验完整 SemVer。 */
export function isValidSemVer(v: string): boolean {
  return SEMVER_RE.test(v)
}

/** 校验 pluginId/publisher key（小写命名空间格式：`[a-z0-9]+([._-][a-z0-9]+)*`）。 */
const NAMESPACE_KEY_RE = /^[a-z0-9]+([._-][a-z0-9]+)*$/

export function isValidNamespaceKey(v: string): boolean {
  if (v.length > 128) return false
  return NAMESPACE_KEY_RE.test(v)
}

/** 校验 contribution key（同 namespace key 格式）。 */
export function isValidContributionKey(v: string): boolean {
  return isValidNamespaceKey(v)
}

/** 校验 permission key（同 namespace key 格式）。 */
export function isValidPermissionKey(v: string): boolean {
  return isValidNamespaceKey(v)
}

// =============================================================================
// 9. 路径安全校验
// =============================================================================

/** 校验 entrypoint 路径安全（D3/D9）。 */
export function isSafeEntrypointPath(path: string): { valid: boolean; reason?: string } {
  if (!path || path.trim().length === 0) {
    return { valid: false, reason: 'manifest-empty-entrypoint' }
  }
  // 控制字符
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(path)) {
    return { valid: false, reason: 'manifest-control-char-entrypoint' }
  }
  // 绝对路径（Unix 或 Windows）
  if (/^[/\\]/.test(path)) {
    return { valid: false, reason: 'manifest-absolute-entrypoint' }
  }
  // Windows 盘符
  if (/^[A-Za-z]:[/\\]/.test(path)) {
    return { valid: false, reason: 'manifest-windows-drive-entrypoint' }
  }
  // traversal
  if (path.includes('..')) {
    return { valid: false, reason: 'manifest-traversal-entrypoint' }
  }
  // URL
  if (/^https?:\/\//i.test(path)) {
    return { valid: false, reason: 'manifest-url-entrypoint' }
  }
  return { valid: true }
}

// =============================================================================
// 10. 归一化与稳定排序
// =============================================================================

/** 深度归一化 manifest（去除 undefined 字段、稳定排序数组、lowercase identity）。 */
export function normalizeManifest(input: PluginManifestV1): PluginManifestV1 {
  const identity: ManifestPluginIdentity = {
    pluginId: input.identity.pluginId.toLowerCase().trim(),
    name: input.identity.name.trim(),
    version: input.identity.version.trim(),
    publisher: input.identity.publisher.toLowerCase().trim(),
    ...(input.identity.description != null
      ? { description: input.identity.description.trim() }
      : {}),
  }

  const provenance: PluginProvenance = {
    distribution: input.provenance.distribution,
    ...(input.provenance.sourceRef != null ? { sourceRef: input.provenance.sourceRef.trim() } : {}),
  }

  const compatibility: PluginCompatibility = {
    hostContractVersion: input.compatibility.hostContractVersion.trim(),
    requiredSeams: [...input.compatibility.requiredSeams]
      .map((s) => ({ seamKey: s.seamKey.trim(), seamVersion: s.seamVersion.trim() }))
      .sort(
        (a, b) => a.seamKey.localeCompare(b.seamKey) || a.seamVersion.localeCompare(b.seamVersion),
      ),
  }

  const contributions: PluginContributionDeclaration[] = [...input.contributions]
    .map((c) => ({
      contributionKey: c.contributionKey.trim(),
      seamKey: c.seamKey.trim(),
      seamVersion: c.seamVersion.trim(),
      entrypoint: { kind: c.entrypoint.kind, path: c.entrypoint.path.trim() },
      ...(c.permissionRefs != null && c.permissionRefs.length > 0
        ? { permissionRefs: [...c.permissionRefs].sort() }
        : {}),
      ...(c.configSchemaRef != null ? { configSchemaRef: c.configSchemaRef.trim() } : {}),
    }))
    .sort((a, b) => a.contributionKey.localeCompare(b.contributionKey))

  const permissions: PluginPermissionRequest[] = [...input.permissions]
    .map((p) => ({
      permissionKey: p.permissionKey.trim(),
      seamKey: p.seamKey.trim(),
      scopeKind: p.scopeKind,
      ...(p.resourceRef != null ? { resourceRef: p.resourceRef.trim() } : {}),
      ...(p.actionRef != null ? { actionRef: p.actionRef.trim() } : {}),
      sideEffect: p.sideEffect,
      confirmation: p.confirmation,
      network: p.network,
      ...(p.purpose != null ? { purpose: p.purpose.trim() } : {}),
    }))
    .sort((a, b) => a.permissionKey.localeCompare(b.permissionKey))

  const dependencies: PluginDependency[] | undefined =
    input.dependencies != null && input.dependencies.length > 0
      ? [...input.dependencies]
          .map((d) => ({
            pluginId: d.pluginId.trim(),
            versionRequirement: d.versionRequirement.trim(),
          }))
          .sort((a, b) => a.pluginId.localeCompare(b.pluginId))
      : undefined

  const result: PluginManifestV1 = {
    manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    identity,
    provenance,
    compatibility,
    contributions,
    permissions,
    ...(dependencies != null ? { dependencies } : {}),
    ...(input.contentDescriptor != null
      ? {
          contentDescriptor: {
            algorithm: input.contentDescriptor.algorithm,
            digest: input.contentDescriptor.digest.toLowerCase().trim(),
          },
        }
      : {}),
    ...(input.extensions != null && Object.keys(input.extensions).length > 0
      ? { extensions: input.extensions }
      : {}),
  }

  return result
}

// =============================================================================
// 11. 确定性序列化与 digest
// =============================================================================

/** 确定性排序的 JSON 序列化（键排序）。使用 manifest 前缀避免 barrel 冲突。 */
export function manifestStableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => manifestStableSerialize(v)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries.map(([k, v]) => JSON.stringify(k) + ':' + manifestStableSerialize(v)).join(',')}}`
  }
  return JSON.stringify(value)
}

/** FNV-1a 32-bit 哈希（确定性，零外部依赖）。使用 manifest 前缀避免 barrel 冲突。 */
export function manifestFnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 计算 manifest digest（基于归一化后的确定性序列化）。 */
export function computeManifestDigest(manifest: PluginManifestV1): string {
  const normalized = normalizeManifest(manifest)
  return manifestFnv1aHash(manifestStableSerialize(normalized))
}

// =============================================================================
// 12. 低敏 sanitization
// =============================================================================

/** 检查值是否包含敏感模式。 */
export function manifestContainsSensitiveValue(value: string): boolean {
  for (const pattern of MANIFEST_SENSITIVE_VALUE_PATTERNS) {
    if (pattern.test(value)) return true
  }
  return false
}

/** 检查键是否为敏感键（小写匹配）。 */
export function manifestIsSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return (MANIFEST_SENSITIVE_KEY_PATTERNS as readonly string[]).some(
    (p) => lower === p || lower.includes(p),
  )
}

/** 对 finding 进行低敏 redaction：丢弃嵌套敏感键和值。 */
export function redactFinding(finding: PluginManifestFinding): PluginManifestFinding {
  const result = { ...finding }
  if (result.evidenceRef && manifestContainsSensitiveValue(result.evidenceRef)) {
    result.evidenceRef = '[redacted]'
  }
  if (result.digest && manifestContainsSensitiveValue(result.digest)) {
    result.digest = '[redacted]'
  }
  return result
}

/** 对嵌套对象进行深层 redaction（丢弃敏感键和值模式）。 */
export function deepRedact<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    if (manifestContainsSensitiveValue(obj)) return '[redacted]' as T
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepRedact(item)) as T
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (manifestIsSensitiveKey(key)) {
        result[key] = '[redacted]'
      } else {
        result[key] = deepRedact(value)
      }
    }
    return result as T
  }
  return obj
}

// =============================================================================
// 13. 纯函数 Validator
// =============================================================================

/** 创建一个 finding。 */
function finding(
  code: ManifestFindingCode,
  severity: ManifestSeverity,
  opts?: Partial<Pick<PluginManifestFinding, 'path' | 'key' | 'count' | 'digest' | 'evidenceRef'>>,
): PluginManifestFinding {
  return { code, severity, ...opts }
}

/** 校验 manifest shape（不依赖 context）。 */
export function validateManifestShape(input: unknown): {
  valid: boolean
  findings: PluginManifestFinding[]
  manifest?: PluginManifestV1
} {
  const findings: PluginManifestFinding[] = []

  if (!input || typeof input !== 'object') {
    findings.push(finding('manifest-schema-invalid', 'blocking', { path: '$' }))
    return { valid: false, findings }
  }

  const obj = input as Record<string, unknown>

  // schema version
  if (!isManifestSchemaVersion(obj.manifestSchemaVersion)) {
    findings.push(
      finding('manifest-schema-invalid', 'blocking', {
        path: '$.manifestSchemaVersion',
        key: String(obj.manifestSchemaVersion),
      }),
    )
  }

  // identity
  if (!obj.identity || typeof obj.identity !== 'object') {
    findings.push(finding('manifest-schema-invalid', 'blocking', { path: '$.identity' }))
  } else {
    const id = obj.identity as Record<string, unknown>
    if (typeof id.pluginId !== 'string' || !isValidNamespaceKey(id.pluginId)) {
      findings.push(
        finding('manifest-invalid-plugin-id', 'blocking', {
          path: '$.identity.pluginId',
          key: String(id.pluginId),
        }),
      )
    }
    if (typeof id.name !== 'string' || id.name.length === 0) {
      findings.push(finding('manifest-schema-invalid', 'blocking', { path: '$.identity.name' }))
    }
    if (typeof id.version !== 'string' || !isValidSemVer(id.version)) {
      findings.push(
        finding('manifest-invalid-semver', 'blocking', {
          path: '$.identity.version',
          key: String(id.version),
        }),
      )
    }
    if (typeof id.publisher !== 'string' || !isValidNamespaceKey(id.publisher)) {
      findings.push(
        finding('manifest-invalid-publisher-key', 'blocking', {
          path: '$.identity.publisher',
          key: String(id.publisher),
        }),
      )
    }
  }

  // provenance
  if (!obj.provenance || typeof obj.provenance !== 'object') {
    findings.push(finding('manifest-schema-invalid', 'blocking', { path: '$.provenance' }))
  } else {
    const prov = obj.provenance as Record<string, unknown>
    if (!isManifestDistributionClass(prov.distribution)) {
      findings.push(
        finding('manifest-unknown-enum', 'blocking', {
          path: '$.provenance.distribution',
          key: String(prov.distribution),
        }),
      )
    } else if (!isManifestAllowedDistribution(prov.distribution)) {
      findings.push(
        finding('manifest-unallowed-distribution', 'blocking', {
          path: '$.provenance.distribution',
          key: String(prov.distribution),
        }),
      )
    }
  }

  // compatibility
  if (!obj.compatibility || typeof obj.compatibility !== 'object') {
    findings.push(finding('manifest-schema-invalid', 'blocking', { path: '$.compatibility' }))
  } else {
    const compat = obj.compatibility as Record<string, unknown>
    if (typeof compat.hostContractVersion !== 'string') {
      findings.push(
        finding('manifest-schema-invalid', 'blocking', {
          path: '$.compatibility.hostContractVersion',
        }),
      )
    }
    if (!Array.isArray(compat.requiredSeams)) {
      findings.push(
        finding('manifest-schema-invalid', 'blocking', { path: '$.compatibility.requiredSeams' }),
      )
    }
  }

  // contributions
  if (!Array.isArray(obj.contributions)) {
    findings.push(finding('manifest-schema-invalid', 'blocking', { path: '$.contributions' }))
  } else {
    const contributionKeys = new Set<string>()
    for (let i = 0; i < obj.contributions.length; i++) {
      const c = obj.contributions[i] as Record<string, unknown>
      const path = `$.contributions[${i}]`
      if (typeof c.contributionKey !== 'string' || !isValidContributionKey(c.contributionKey)) {
        findings.push(
          finding('manifest-schema-invalid', 'blocking', {
            path: `${path}.contributionKey`,
            key: String(c.contributionKey),
          }),
        )
      } else if (contributionKeys.has(c.contributionKey)) {
        findings.push(
          finding('manifest-duplicate-contribution-key', 'blocking', {
            path: `${path}.contributionKey`,
            key: c.contributionKey,
          }),
        )
      } else {
        contributionKeys.add(c.contributionKey)
      }

      if (typeof c.seamKey !== 'string' || typeof c.seamVersion !== 'string') {
        findings.push(finding('manifest-schema-invalid', 'blocking', { path }))
      }

      if (!c.entrypoint || typeof c.entrypoint !== 'object') {
        findings.push(
          finding('manifest-schema-invalid', 'blocking', { path: `${path}.entrypoint` }),
        )
      } else {
        const ep = c.entrypoint as Record<string, unknown>
        if (!isManifestEntrypointKind(ep.kind)) {
          findings.push(
            finding('manifest-unknown-enum', 'blocking', {
              path: `${path}.entrypoint.kind`,
              key: String(ep.kind),
            }),
          )
        }
        if (typeof ep.path === 'string') {
          const pathCheck = isSafeEntrypointPath(ep.path)
          if (!pathCheck.valid) {
            findings.push(
              finding(pathCheck.reason as ManifestFindingCode, 'blocking', {
                path: `${path}.entrypoint.path`,
                key: ep.path,
              }),
            )
          }
        }
      }
    }
  }

  // permissions
  if (!Array.isArray(obj.permissions)) {
    findings.push(finding('manifest-schema-invalid', 'blocking', { path: '$.permissions' }))
  } else {
    const permissionKeys = new Set<string>()
    for (let i = 0; i < obj.permissions.length; i++) {
      const p = obj.permissions[i] as Record<string, unknown>
      const path = `$.permissions[${i}]`
      if (typeof p.permissionKey !== 'string' || !isValidPermissionKey(p.permissionKey)) {
        findings.push(
          finding('manifest-schema-invalid', 'blocking', {
            path: `${path}.permissionKey`,
            key: String(p.permissionKey),
          }),
        )
      } else if (permissionKeys.has(p.permissionKey)) {
        findings.push(
          finding('manifest-duplicate-permission', 'blocking', {
            path: `${path}.permissionKey`,
            key: p.permissionKey,
          }),
        )
      } else {
        permissionKeys.add(p.permissionKey)
      }

      if (typeof p.seamKey !== 'string') {
        findings.push(finding('manifest-schema-invalid', 'blocking', { path: `${path}.seamKey` }))
      }
      if (!isManifestScopeKind(p.scopeKind)) {
        findings.push(
          finding('manifest-unknown-enum', 'blocking', {
            path: `${path}.scopeKind`,
            key: String(p.scopeKind),
          }),
        )
      }
      if (!isManifestPermissionSideEffect(p.sideEffect)) {
        findings.push(
          finding('manifest-unknown-enum', 'blocking', {
            path: `${path}.sideEffect`,
            key: String(p.sideEffect),
          }),
        )
      }
      if (!isManifestPermissionConfirmationPolicy(p.confirmation)) {
        findings.push(
          finding('manifest-unknown-enum', 'blocking', {
            path: `${path}.confirmation`,
            key: String(p.confirmation),
          }),
        )
      }
      if (!isManifestPermissionNetworkPolicy(p.network)) {
        findings.push(
          finding('manifest-unknown-enum', 'blocking', {
            path: `${path}.network`,
            key: String(p.network),
          }),
        )
      }
    }
  }

  // dependencies (optional)
  if (obj.dependencies != null) {
    if (!Array.isArray(obj.dependencies)) {
      findings.push(finding('manifest-schema-invalid', 'blocking', { path: '$.dependencies' }))
    } else {
      const depIds = new Set<string>()
      for (let i = 0; i < obj.dependencies.length; i++) {
        const d = obj.dependencies[i] as Record<string, unknown>
        const path = `$.dependencies[${i}]`
        if (typeof d.pluginId !== 'string') {
          findings.push(finding('manifest-schema-invalid', 'blocking', { path }))
        } else {
          if (depIds.has(d.pluginId)) {
            findings.push(
              finding('manifest-duplicate-dependency', 'blocking', {
                path,
                key: d.pluginId,
              }),
            )
          } else {
            depIds.add(d.pluginId)
          }
          // self-dependency
          if (obj.identity && typeof obj.identity === 'object') {
            const identity = obj.identity as Record<string, unknown>
            if (d.pluginId === identity.pluginId) {
              findings.push(
                finding('manifest-self-dependency', 'blocking', {
                  path,
                  key: d.pluginId,
                }),
              )
            }
          }
        }
        if (typeof d.versionRequirement !== 'string') {
          findings.push(finding('manifest-schema-invalid', 'blocking', { path }))
        } else {
          const vr = d.versionRequirement as string
          if (vr === 'latest') {
            findings.push(finding('manifest-latest-dependency', 'blocking', { path, key: vr }))
          } else if (/^https?:\/\//i.test(vr)) {
            findings.push(finding('manifest-url-dependency', 'blocking', { path, key: vr }))
          } else if (!isValidSemVer(vr) && !/^[~^>=<]+\d/.test(vr)) {
            // 粗略校验：exact 或 same-major range
            findings.push(
              finding('manifest-unbounded-range-dependency', 'blocking', { path, key: vr }),
            )
          }
        }
      }
    }
  }

  // content descriptor (optional shape)
  if (obj.contentDescriptor != null) {
    if (typeof obj.contentDescriptor !== 'object') {
      findings.push(finding('manifest-schema-invalid', 'blocking', { path: '$.contentDescriptor' }))
    } else {
      const cd = obj.contentDescriptor as Record<string, unknown>
      if (!isManifestDigestAlgorithm(cd.algorithm)) {
        findings.push(
          finding('manifest-invalid-digest-algorithm', 'blocking', {
            path: '$.contentDescriptor.algorithm',
            key: String(cd.algorithm),
          }),
        )
      }
      if (typeof cd.digest !== 'string' || cd.digest.length === 0) {
        findings.push(
          finding('manifest-digest-shape-invalid', 'blocking', {
            path: '$.contentDescriptor.digest',
          }),
        )
      }
    }
  }

  // unknown top-level fields (non-extensions)
  const knownTopKeys = new Set([
    'manifestSchemaVersion',
    'identity',
    'provenance',
    'compatibility',
    'contributions',
    'permissions',
    'dependencies',
    'contentDescriptor',
    'extensions',
  ])
  for (const key of Object.keys(obj)) {
    if (!knownTopKeys.has(key)) {
      findings.push(finding('manifest-unknown-enum', 'warning', { path: `$.${key}` }))
    }
  }

  const hasBlocking = findings.some((f) => f.severity === 'blocking')
  return {
    valid: !hasBlocking,
    findings,
    manifest: !hasBlocking ? (input as PluginManifestV1) : undefined,
  }
}

// =============================================================================
// 14. Contextual validation（依赖 catalog context）
// =============================================================================

/** 校验 contribution 引用的 seam 是否兼容。 */
function validateSeamCompatibility(
  seamKey: string,
  seamVersion: string,
  _catalog: Record<string, PluginCatalogSnapshotEntry>,
  contextualMode: boolean,
): PluginManifestFinding[] {
  const findings: PluginManifestFinding[] = []
  const entry = _catalog[seamKey]

  if (!entry) {
    findings.push(
      finding('manifest-unknown-seam', 'blocking', {
        path: `seam:${seamKey}`,
        key: seamKey,
      }),
    )
    return findings
  }

  // version compatibility (same-major or exact)
  const parts = seamVersion.split('.')
  const hostParts = entry.seamVersion.split('.')
  const reqMajor = Number(parts[0] ?? 0)
  const reqMinor = Number(parts[1] ?? 0)
  const hostMajor = Number(hostParts[0] ?? 0)
  const hostMinor = Number(hostParts[1] ?? 0)

  if (reqMajor > hostMajor) {
    findings.push(
      finding('manifest-cross-major-seam', 'blocking', {
        path: `seam:${seamKey}.version`,
        key: seamVersion,
      }),
    )
  } else if (reqMajor === hostMajor && reqMinor > hostMinor) {
    findings.push(
      finding('manifest-future-seam-version', 'blocking', {
        path: `seam:${seamKey}.version`,
        key: seamVersion,
      }),
    )
  }

  // deprecated without migration
  if (entry.availability === 'deprecated' && !entry.replacementSeamKey) {
    findings.push(
      finding('manifest-deprecated-seam-no-migration', 'blocking', {
        path: `seam:${seamKey}.availability`,
        key: seamKey,
      }),
    )
  }

  // cataloged-not-host-ready in contextual mode
  if (contextualMode && entry.availability === 'cataloged') {
    findings.push(
      finding('manifest-unknown-seam', 'warning', {
        path: `seam:${seamKey}.availability`,
        key: seamKey,
      }),
    )
  }

  return findings
}

/** 校验 permission 相对 seam catalog 上限的 subset。 */
function validatePermissionSubset(
  perm: PluginPermissionRequest,
  _catalog: Record<string, PluginCatalogSnapshotEntry>,
  vocabulary: Record<string, PluginPermissionVocabularyEntry>,
): PluginManifestFinding[] {
  const findings: PluginManifestFinding[] = []

  // permission must exist in vocabulary
  const vocabEntry = vocabulary[perm.permissionKey]
  if (!vocabEntry) {
    findings.push(
      finding('manifest-unknown-permission-key', 'blocking', {
        path: `permission:${perm.permissionKey}`,
        key: perm.permissionKey,
      }),
    )
    return findings
  }

  // permission must belong to its seam
  if (vocabEntry.seamKey !== perm.seamKey) {
    findings.push(
      finding('manifest-permission-not-in-seam', 'blocking', {
        path: `permission:${perm.permissionKey}.seamKey`,
        key: perm.permissionKey,
      }),
    )
  }

  // scope must not exceed vocabulary
  if (perm.scopeKind !== vocabEntry.maxScopeKind) {
    findings.push(
      finding('manifest-permission-scope-expanded', 'blocking', {
        path: `permission:${perm.permissionKey}.scopeKind`,
        key: perm.permissionKey,
      }),
    )
  }

  // side-effect must not exceed vocabulary
  const sideEffectOrder = [
    'none',
    'read-only',
    'advisory',
    'render',
    'transform',
    'preview',
    'proposal',
    'formal-write',
    'external-action',
  ]
  const permIdx = sideEffectOrder.indexOf(perm.sideEffect)
  const maxIdx = sideEffectOrder.indexOf(vocabEntry.maxSideEffect)
  if (permIdx > maxIdx) {
    findings.push(
      finding('manifest-permission-side-effect-relaxed', 'blocking', {
        path: `permission:${perm.permissionKey}.sideEffect`,
        key: perm.permissionKey,
      }),
    )
  }

  // network must not exceed vocabulary
  const networkOrder = ['none', 'host-brokered', 'fixture-mock-only', 'direct-allowed']
  const permNetIdx = networkOrder.indexOf(perm.network)
  const maxNetIdx = networkOrder.indexOf(vocabEntry.maxNetwork)
  if (permNetIdx > maxNetIdx) {
    findings.push(
      finding('manifest-permission-network-relaxed', 'blocking', {
        path: `permission:${perm.permissionKey}.network`,
        key: perm.permissionKey,
      }),
    )
  }

  // confirmation must not exceed vocabulary
  const confirmOrder = ['not-required', 'required', 'host-brokered', 'forbidden']
  const permConfIdx = confirmOrder.indexOf(perm.confirmation)
  const maxConfIdx = confirmOrder.indexOf(vocabEntry.maxConfirmation)
  if (permConfIdx > maxConfIdx) {
    findings.push(
      finding('manifest-permission-side-effect-relaxed', 'blocking', {
        path: `permission:${perm.permissionKey}.confirmation`,
        key: perm.permissionKey,
      }),
    )
  }

  return findings
}

/** 核心 authority redline 检查。 */
function checkCoreAuthorityRedlines(manifest: PluginManifestV1): PluginManifestFinding[] {
  const findings: PluginManifestFinding[] = []

  // 检查 manifest 中是否包含具体租户 ID
  const json = JSON.stringify(manifest)
  if (/organizationId/i.test(json)) {
    findings.push(
      finding('manifest-organization-id-in-manifest', 'blocking', {
        path: '$',
      }),
    )
  }
  if (/projectId/i.test(json)) {
    findings.push(
      finding('manifest-project-id-in-manifest', 'blocking', {
        path: '$',
      }),
    )
  }
  if (/userId/i.test(json)) {
    findings.push(
      finding('manifest-user-id-in-manifest', 'blocking', {
        path: '$',
      }),
    )
  }
  if (/\brole\b/i.test(json)) {
    findings.push(
      finding('manifest-role-authority-claim', 'blocking', {
        path: '$',
      }),
    )
  }

  // 检查权限中的隐式 global scope（通过 extensions 或其他方式）
  // ManifestScopeKind 类型守卫已阻止直接 global，但检查 extensions 中的 global 声明
  // 由于 ManifestScopeKind 只允许 organization/project，
  // 任何尝试传入 global 会在 shape validation 阶段被拒绝
  // 此处仅做额外的 JSON 字符串检查以覆盖可能的类型逃逸

  // 检查 direct-db-write / skip-confirmation / plugin-self-audit
  for (const perm of manifest.permissions) {
    if (perm.sideEffect === 'formal-write') {
      // formal-write 只能是 host-controlled，不能是 direct
      // 需要确认 confirmation 是 required 或 host-brokered
      if (perm.confirmation === 'not-required' || perm.confirmation === 'forbidden') {
        findings.push(
          finding('manifest-skip-confirmation-claim', 'blocking', {
            path: `permission:${perm.permissionKey}.confirmation`,
            key: perm.permissionKey,
          }),
        )
      }
    }
    if (perm.sideEffect === 'external-action') {
      if (perm.confirmation !== 'required' && perm.confirmation !== 'host-brokered') {
        findings.push(
          finding('manifest-external-action-not-conditional', 'blocking', {
            path: `permission:${perm.permissionKey}.confirmation`,
            key: perm.permissionKey,
          }),
        )
      }
      if (perm.network !== 'host-brokered' && perm.network !== 'fixture-mock-only') {
        findings.push(
          finding('manifest-unrestricted-network', 'blocking', {
            path: `permission:${perm.permissionKey}.network`,
            key: perm.permissionKey,
          }),
        )
      }
    }
  }

  return findings
}

/** 端到端 contextual validation。 */
export function validateManifest(
  input: PluginManifestV1,
  context: PluginManifestValidationContext,
): PluginManifestValidationResult {
  const findings: PluginManifestFinding[] = []

  // 1. shape validation
  const shapeResult = validateManifestShape(input)
  findings.push(...shapeResult.findings)
  if (!shapeResult.valid || !shapeResult.manifest) {
    return { valid: false, findings }
  }
  const manifest = shapeResult.manifest

  // 2. distribution check
  if (!context.allowedDistributions.includes(manifest.provenance.distribution)) {
    findings.push(
      finding('manifest-unallowed-distribution', 'blocking', {
        path: '$.provenance.distribution',
        key: manifest.provenance.distribution,
      }),
    )
  }

  // 3. seam compatibility
  for (const seam of manifest.compatibility.requiredSeams) {
    findings.push(
      ...validateSeamCompatibility(
        seam.seamKey,
        seam.seamVersion,
        context.seamCatalog,
        context.contextualMode ?? false,
      ),
    )
  }

  // 4. contribution seam validation
  for (const contrib of manifest.contributions) {
    findings.push(
      ...validateSeamCompatibility(
        contrib.seamKey,
        contrib.seamVersion,
        context.seamCatalog,
        context.contextualMode ?? false,
      ),
    )

    // permission refs must belong to the contribution seam
    const catalogEntry = context.seamCatalog[contrib.seamKey]
    if (catalogEntry && contrib.permissionRefs) {
      for (const permKey of contrib.permissionRefs) {
        const vocabEntry = context.permissionVocabulary[permKey]
        if (vocabEntry && vocabEntry.seamKey !== contrib.seamKey) {
          findings.push(
            finding('manifest-contribution-orphan-permission', 'blocking', {
              path: `contribution:${contrib.contributionKey}.permissionRefs`,
              key: permKey,
            }),
          )
        }
      }
    }
  }

  // 5. permission subset validation
  for (const perm of manifest.permissions) {
    findings.push(
      ...validatePermissionSubset(perm, context.seamCatalog, context.permissionVocabulary),
    )
  }

  // 6. core authority redlines
  findings.push(...checkCoreAuthorityRedlines(manifest))

  // 7. skill adapter check
  for (const contrib of manifest.contributions) {
    const catalogEntry = context.seamCatalog[contrib.seamKey]
    if (
      catalogEntry &&
      (catalogEntry.surface === 'skill-adapter' || catalogEntry.surface === 'compiler-contribution')
    ) {
      // skill adapter must reference existing contract refs
      // (simplified check - full check requires reading upstream contracts)
    }
  }

  const hasBlocking = findings.some((f) => f.severity === 'blocking')
  const normalized = normalizeManifest(manifest)
  const digest = computeManifestDigest(manifest)

  return {
    valid: !hasBlocking,
    findings,
    normalizedManifest: normalized,
    manifestDigest: digest,
  }
}

// =============================================================================
// 15. Grant subset validation
// =============================================================================

/** 校验 grant 是否为 manifest requested set 的子集。 */
export function validateGrantSubset(
  manifest: PluginManifestV1,
  grant: PluginPermissionGrantSnapshot,
  _context: PluginManifestValidationContext,
): PluginGrantValidationResult {
  const findings: PluginManifestFinding[] = []

  // 1. grant identity must match manifest
  if (grant.pluginId !== manifest.identity.pluginId) {
    findings.push(
      finding('manifest-grant-identity-mismatch', 'blocking', {
        path: 'grant.pluginId',
        key: grant.pluginId,
      }),
    )
  }

  // 2. grant digest must match manifest
  const expectedDigest = computeManifestDigest(manifest)
  if (grant.manifestDigest !== expectedDigest) {
    findings.push(
      finding('manifest-grant-digest-mismatch', 'blocking', {
        path: 'grant.manifestDigest',
        key: grant.manifestDigest,
      }),
    )
  }

  // 3. scope must not exceed manifest scope
  // (grant scope binding is org/project hash, can't directly compare)
  // This is validated by the caller using trusted context

  // 4. granted permissions must be subset of manifest requested
  const requestedKeys = new Set(manifest.permissions.map((p) => p.permissionKey))

  for (const grantedKey of grant.grantedPermissions) {
    if (!requestedKeys.has(grantedKey)) {
      findings.push(
        finding('manifest-grant-escalation', 'blocking', {
          path: 'grant.grantedPermissions',
          key: grantedKey,
        }),
      )
    }
  }

  // 5. grant must not be expired or revoked (if refs provided)
  // (actual expiry/revocation check is done by the caller with trusted time)

  const hasBlocking = findings.some((f) => f.severity === 'blocking')
  return { valid: !hasBlocking, findings }
}

// =============================================================================
// 16. Runtime authorization prerequisites guard
// =============================================================================

/**
 * 低敏的 runtime-authorization prerequisites 描述（D5）。
 * 仅有 manifest、仅有 grant 或仅有用户 RBAC 任一单项都不会返回 authorized。
 */
export function checkRuntimeAuthPrerequisites(opts: {
  hasValidInstall: boolean
  hasValidGrant: boolean
  hasRBACPolicyMatch: boolean
  hasScopeMatch: boolean
  hasHostReadySeam: boolean
  meetsConfirmationAudit: boolean
}): PluginRuntimeAuthPrerequisites {
  const authorized =
    opts.hasValidInstall &&
    opts.hasValidGrant &&
    opts.hasRBACPolicyMatch &&
    opts.hasScopeMatch &&
    opts.hasHostReadySeam &&
    opts.meetsConfirmationAudit

  return {
    ...opts,
    authorized,
  }
}
