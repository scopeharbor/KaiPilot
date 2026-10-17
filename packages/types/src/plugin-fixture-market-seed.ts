/**
 * v3-plugin-fixture-market-seed —— 本机示例插件库（fixture-only seed）共享契约层。
 *
 * 设计要点（对齐 design.md D1–D5 与 spec 六条 Requirement）：
 * - 零运行时依赖、纯函数、同构（不得 import node:crypto / fs；文件读取与哈希经注入）。
 * - catalog 是仓库内版本化数据（D1），checker 验证路径逃逸、digest 完整性、重复
 *   identity/version、未知依赖、低敏与市场禁词、稳定排序。
 * - profile guard 纯函数供 CLI 与 service 双层复用（D2）：production/unknown 恒拒绝，
 *   且所有环境都必须显式启用（默认关闭）。
 * - 本模块只描述契约与纯检查，绝不包含数据库写入或 HTTP 逻辑；
 *   seed 的真实落库走 backend 正式 registry/install 流程（loader 在 backend service 层）。
 * - 复用 local-plugin-developer-kit 原语：devStableSerialize/computeDevDigest/
 *   devContainsSensitiveData/devSecondaryScan/isRepoRelativePathSafe。
 */

import {
  computeDevDigest,
  devContainsSensitiveData,
  devSecondaryScan,
  isRepoRelativePathSafe,
} from './local-plugin-developer-kit.js'
import { isValidSemVer } from './plugin-manifest.js'

// =============================================================================
// 1. 版本与封闭枚举
// =============================================================================

export const PLUGIN_FIXTURE_SEED_CATALOG_SCHEMA_VERSION = '1.0' as const
export const PLUGIN_FIXTURE_SEED_STATE_SCHEMA_VERSION = '1.0' as const
export const PLUGIN_FIXTURE_SEED_REPORT_SCHEMA_VERSION = '1.0' as const

/** 运行环境封闭枚举；未知值一律按 unknown 处理并 fail closed。 */
export const FIXTURE_SEED_ENVIRONMENTS = ['development', 'test', 'demo', 'production'] as const
export type FixtureSeedEnvironment = (typeof FIXTURE_SEED_ENVIRONMENTS)[number]

/** catalog 两档规模：smoke 默认有界，full 供认证。 */
export const FIXTURE_SEED_CATALOG_PROFILES = ['smoke', 'full'] as const
export type FixtureSeedCatalogProfile = (typeof FIXTURE_SEED_CATALOG_PROFILES)[number]

export const FIXTURE_SEED_PROVENANCES = ['first-party', 'fixture'] as const
export type FixtureSeedProvenance = (typeof FIXTURE_SEED_PROVENANCES)[number]

export const FIXTURE_SEED_COMMANDS = ['status', 'dry-run', 'seed', 'reset'] as const
export type FixtureSeedCommand = (typeof FIXTURE_SEED_COMMANDS)[number]

export const FIXTURE_SEED_FORMATS = ['text', 'json'] as const
export type FixtureSeedFormat = (typeof FIXTURE_SEED_FORMATS)[number]

/** 上游 receipt 命名空间：seed 创建的 release 必须带此前缀，用于 provenance 白名单。 */
export const FIXTURE_SEED_RECEIPT_PREFIX = 'fixture-seed:'

/** 单目录规模预算。 */
export const FIXTURE_SEED_MAX_ITEMS_PER_CATALOG = 32
export const FIXTURE_SEED_MAX_FILES_PER_ITEM = 64

// =============================================================================
// 2. Catalog 契约（D1）
// =============================================================================

export interface FixtureSeedRequiredSeam {
  readonly seamKey: string
  readonly seamVersion: string
}

export interface FixtureSeedCompatibilityDeclaration {
  readonly hostContractVersion: string
  readonly requiredSeams: readonly FixtureSeedRequiredSeam[]
}

/** catalog 条目：声明稳定 identity/version、provenance、digest、兼容性与中文演示元数据。 */
export interface FixtureSeedCatalogItemV1 {
  /** 稳定条目 id（kebab-case），catalog 内唯一，排序键。 */
  readonly itemId: string
  /** 插件身份（如 com.aiproj.canary-query），与 manifest identity.pluginId 一致。 */
  readonly pluginIdentity: string
  /** 中文演示名（禁市场措辞）。 */
  readonly displayName: string
  /** semver。 */
  readonly version: string
  readonly provenance: FixtureSeedProvenance
  /** 仓库相对目录（POSIX '/'）。 */
  readonly fixtureRoot: string
  /** 参与包完整性计算的仓库相对文件清单（POSIX '/'，必须位于 fixtureRoot 下，升序）。 */
  readonly entryFiles: readonly string[]
  /** manifest 字节 sha256。 */
  readonly expectedManifestDigest: string
  /** 规范化包摘要：对「entryFile(仓库相对全路径)\nfileSha256\n」按路径升序拼接后取 sha256。 */
  readonly expectedPackageDigest: string
  readonly compatibility: FixtureSeedCompatibilityDeclaration
  /** 必须 fixture-seed: 前缀；写入 release.upstreamReceiptRef 作为 provenance 白名单。 */
  readonly upstreamReceiptRef: string
  /** 该条目参与哪些档位（非空子集）。 */
  readonly profiles: readonly FixtureSeedCatalogProfile[]
  /** 依赖的其他条目 itemId（可选）。 */
  readonly dependsOn?: readonly string[]
  /** 中文演示标签（禁市场措辞）。 */
  readonly demoTags?: readonly string[]
  /** 收录依据：上游 change id 或归档记录（task 1.4 溯源）。 */
  readonly sourceChangeRef?: string
}

export interface FixtureSeedCatalogV1 {
  readonly schemaVersion: typeof PLUGIN_FIXTURE_SEED_CATALOG_SCHEMA_VERSION
  readonly kind: 'plugin-fixture-seed-catalog-v1'
  readonly catalogId: string
  readonly catalogVersion: string
  readonly defaultProfile: FixtureSeedCatalogProfile
  /** 中文说明；必须含「本机示例」，禁止市场措辞。 */
  readonly description: string
  readonly items: readonly FixtureSeedCatalogItemV1[]
}

// =============================================================================
// 3. Finding（封闭 code 集）
// =============================================================================

export const PLUGIN_FIXTURE_SEED_FINDING_CODES = [
  'seed-input-missing',
  'seed-catalog-schema-invalid',
  'seed-catalog-path-escape',
  'seed-catalog-digest-format-invalid',
  'seed-catalog-digest-mismatch',
  'seed-catalog-manifest-identity-mismatch',
  'seed-catalog-duplicate-item-id',
  'seed-catalog-duplicate-identity-version',
  'seed-catalog-unknown-dependency',
  'seed-catalog-dependency-cycle',
  'seed-catalog-sensitive-content',
  'seed-catalog-production-marker',
  'seed-catalog-market-wording-forbidden',
  'seed-catalog-description-marker-missing',
  'seed-catalog-unsorted-items',
  'seed-catalog-budget-exceeded',
  'seed-catalog-fixture-file-missing',
  'seed-item-approval-rejected',
  'seed-item-release-conflict',
  'seed-profile-not-allowed',
  'seed-explicit-enable-missing',
  'seed-state-schema-invalid',
  'seed-state-stale-ref',
  'seed-reset-conflict-user-modified',
  'seed-reset-cross-org-ref',
  'seed-tool-error',
] as const
export type PluginFixtureSeedFindingCode = (typeof PLUGIN_FIXTURE_SEED_FINDING_CODES)[number]

export const FIXTURE_SEED_SEVERITIES = ['info', 'warning', 'blocking'] as const
export type FixtureSeedSeverity = (typeof FIXTURE_SEED_SEVERITIES)[number]

export const FIXTURE_SEED_PHASES = ['catalog', 'profile', 'item', 'state', 'reset'] as const
export type FixtureSeedPhase = (typeof FIXTURE_SEED_PHASES)[number]

export interface PluginFixtureSeedFinding {
  readonly code: PluginFixtureSeedFindingCode
  readonly severity: FixtureSeedSeverity
  readonly phase: FixtureSeedPhase
  readonly fieldPath?: string
  readonly message?: string
}

/** 稳定排序：phase → severity(blocking>warning>info) → code → fieldPath。 */
export function sortFixtureSeedFindings(
  findings: readonly PluginFixtureSeedFinding[],
): PluginFixtureSeedFinding[] {
  const severityRank: Record<FixtureSeedSeverity, number> = { blocking: 0, warning: 1, info: 2 }
  return [...findings].sort((a, b) => {
    if (a.phase !== b.phase) return a.phase < b.phase ? -1 : 1
    const sr = severityRank[a.severity] - severityRank[b.severity]
    if (sr !== 0) return sr
    if (a.code !== b.code) return a.code < b.code ? -1 : 1
    const fa = a.fieldPath ?? ''
    const fb = b.fieldPath ?? ''
    if (fa !== fb) return fa < fb ? -1 : 1
    return (a.message ?? '') < (b.message ?? '')
      ? -1
      : (a.message ?? '') > (b.message ?? '')
        ? 1
        : 0
  })
}

// =============================================================================
// 4. Profile guard（D2：纯函数，CLI/service 双层复用）
// =============================================================================

export type FixtureSeedGuardResult =
  | { readonly allowed: true; readonly environment: FixtureSeedEnvironment }
  | {
      readonly allowed: false
      readonly environment: FixtureSeedEnvironment | 'unknown'
      readonly code: 'seed-profile-not-allowed' | 'seed-explicit-enable-missing'
      readonly message: string
    }

/** 归一运行环境；无法识别一律 unknown（fail closed）。 */
export function resolveFixtureSeedEnvironment(input: unknown): FixtureSeedEnvironment | 'unknown' {
  if (typeof input !== 'string') return 'unknown'
  const normalized = input.trim().toLowerCase()
  return (FIXTURE_SEED_ENVIRONMENTS as readonly string[]).includes(normalized)
    ? (normalized as FixtureSeedEnvironment)
    : 'unknown'
}

/**
 * seed 默认关闭：任何环境都必须 explicitEnable 才可用；
 * production / unknown 无论 flag 与否恒拒绝。
 */
export function resolveFixtureSeedProfileGuard(input: {
  environment: unknown
  explicitEnable: boolean
}): FixtureSeedGuardResult {
  const environment = resolveFixtureSeedEnvironment(input.environment)
  if (environment === 'unknown') {
    return {
      allowed: false,
      environment,
      code: 'seed-profile-not-allowed',
      message: '本机示例插件库仅在 development/test/demo 环境可用（当前环境无法识别）',
    }
  }
  if (environment === 'production') {
    return {
      allowed: false,
      environment,
      code: 'seed-profile-not-allowed',
      message: '生产环境禁止使用本机示例插件库 seed',
    }
  }
  if (!input.explicitEnable) {
    return {
      allowed: false,
      environment,
      code: 'seed-explicit-enable-missing',
      message:
        '本机示例插件库默认关闭，需要显式启用标记（--enable / PLUGIN_FIXTURE_SEED_ENABLED=1）',
    }
  }
  return { allowed: true, environment }
}

// =============================================================================
// 5. Checker（task 1.3 全部负例 + 稳定排序 + 内容完整性）
// =============================================================================

/** 注入式文件源：types 层零 IO，由 CLI/backend 注入实现，单测注入假实现。 */
export interface FixtureSeedFileSource {
  /**
   * relPath 即 catalog 条目的 entryFile（仓库相对全路径，已含 fixtureRoot 前缀）；
   * fixtureRoot 仅用于实现侧二次边界校验。缺失返回 null/undefined。
   */
  readFile(fixtureRoot: string, relPath: string): string | null | undefined
  /** 返回 'sha256:<hex>'；未提供时跳过内容一致性校验。 */
  hashContent?(content: string): string
}

export interface ValidateFixtureSeedCatalogOptions {
  readonly fileSource?: FixtureSeedFileSource
}

export interface ValidateFixtureSeedCatalogResult {
  readonly status: 'passed' | 'blocking' | 'tool-error'
  readonly findings: PluginFixtureSeedFinding[]
  /** 归一化 + 排序后的 catalog（仅当输入可解释为对象时尽力产出）。 */
  readonly catalog?: FixtureSeedCatalogV1
  /** 对归一化 catalog 的确定性摘要（与输入顺序无关）。 */
  readonly catalogDigest: string
}

const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/

/** 市场禁词（spec：产品文案不得宣称开放市场）。 */
export const FIXTURE_SEED_FORBIDDEN_MARKET_TERMS = [
  '插件市场',
  '应用市场',
  'marketplace',
  '第三方入驻',
  '公开上架',
  '上架审核',
  '评分排行',
  '计费',
  '分成',
  '开发者门户',
] as const

/** 用户可见说明必须包含的本机示例标识。 */
export const FIXTURE_SEED_REQUIRED_DESCRIPTION_MARKER = '本机示例'

/** fixture 内容敏感/生产数据模式（低敏扫描）。 */
const FIXTURE_SEED_CONTENT_SENSITIVE_PATTERNS: ReadonlyArray<RegExp> = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /authorization\s*:/i,
  /\b(api[_-]?key|apikey|secret|token|password)\b\s*[:=]\s*["'][^"']{6,}/i,
]

function finding(
  code: PluginFixtureSeedFindingCode,
  severity: FixtureSeedSeverity,
  phase: FixtureSeedPhase,
  fieldPath?: string,
  message?: string,
): PluginFixtureSeedFinding {
  return { code, severity, phase, fieldPath, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scanStringForSensitive(
  value: string,
  fieldPath: string,
  out: PluginFixtureSeedFinding[],
): void {
  if (devContainsSensitiveData(value)) {
    out.push(finding('seed-catalog-sensitive-content', 'blocking', 'catalog', fieldPath))
    return
  }
  for (const pattern of FIXTURE_SEED_CONTENT_SENSITIVE_PATTERNS) {
    if (pattern.test(value)) {
      out.push(finding('seed-catalog-sensitive-content', 'blocking', 'catalog', fieldPath))
      return
    }
  }
}

function scanFileContent(
  content: string,
  fieldPath: string,
  out: PluginFixtureSeedFinding[],
): void {
  for (const violation of devSecondaryScan(content)) {
    out.push(
      finding(
        'seed-catalog-sensitive-content',
        'blocking',
        'item',
        fieldPath,
        `secondary-scan:${violation}`,
      ),
    )
  }
  for (const pattern of FIXTURE_SEED_CONTENT_SENSITIVE_PATTERNS) {
    if (pattern.test(content)) {
      out.push(finding('seed-catalog-sensitive-content', 'blocking', 'item', fieldPath))
      break
    }
  }
  // 生产数据样本标记（demo 数据里不允许出现生产库标识）
  if (/prod-(org|db|data)|生产数据|生产库/i.test(content)) {
    out.push(finding('seed-catalog-production-marker', 'blocking', 'item', fieldPath))
  }
}

/** 规范化包摘要计算（与离线生成规则一致）：path（仓库相对全路径）升序，行格式 `path\nsha256\n`。 */
export function computeCanonicalPackageDigest(
  files: ReadonlyArray<{ readonly path: string; readonly content: string }>,
  hashContent: (content: string) => string,
): string {
  const canon = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}\n${hashContent(f.content)}\n`)
    .join('')
  return hashContent(canon)
}

/** 对归一化 catalog 计算确定性摘要（fnv，顺序无关）。 */
export function computeFixtureSeedCatalogDigest(catalog: FixtureSeedCatalogV1): string {
  return computeDevDigest({
    schemaVersion: catalog.schemaVersion,
    kind: catalog.kind,
    catalogId: catalog.catalogId,
    catalogVersion: catalog.catalogVersion,
    defaultProfile: catalog.defaultProfile,
    description: catalog.description,
    items: [...catalog.items].map((item) => computeFixtureSeedItemDigest(item)).sort(),
  })
}

/** 单条目确定性摘要（不含易变字段；entryFiles 已在契约内要求有序）。 */
export function computeFixtureSeedItemDigest(item: FixtureSeedCatalogItemV1): string {
  return computeDevDigest({
    itemId: item.itemId,
    pluginIdentity: item.pluginIdentity,
    version: item.version,
    provenance: item.provenance,
    fixtureRoot: item.fixtureRoot,
    entryFiles: [...item.entryFiles],
    expectedManifestDigest: item.expectedManifestDigest,
    expectedPackageDigest: item.expectedPackageDigest,
    compatibility: item.compatibility,
    upstreamReceiptRef: item.upstreamReceiptRef,
    profiles: [...item.profiles],
    dependsOn: item.dependsOn ? [...item.dependsOn] : undefined,
    demoTags: item.demoTags ? [...item.demoTags] : undefined,
    sourceChangeRef: item.sourceChangeRef ?? undefined,
  })
}

/** 按 profile 取条目（itemId 升序，稳定输出）。 */
export function listFixtureSeedCatalogItemsForProfile(
  catalog: FixtureSeedCatalogV1,
  profile: FixtureSeedCatalogProfile,
): FixtureSeedCatalogItemV1[] {
  return catalog.items
    .filter((item) => item.profiles.includes(profile))
    .slice()
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))
}

function validateWording(
  value: string,
  fieldPath: string,
  findings: PluginFixtureSeedFinding[],
): void {
  const lowered = value.toLowerCase()
  for (const term of FIXTURE_SEED_FORBIDDEN_MARKET_TERMS) {
    if (lowered.includes(term.toLowerCase())) {
      findings.push(
        finding('seed-catalog-market-wording-forbidden', 'blocking', 'catalog', fieldPath, term),
      )
    }
  }
}

function detectDependencyCycle(
  items: FixtureSeedCatalogItemV1[],
  findings: PluginFixtureSeedFinding[],
): void {
  const byId = new Map(items.map((i) => [i.itemId, i]))
  const visiting = new Set<string>()
  const done = new Set<string>()
  const walk = (id: string, stack: string[]): void => {
    if (done.has(id)) return
    if (visiting.has(id)) {
      findings.push(
        finding(
          'seed-catalog-dependency-cycle',
          'blocking',
          'catalog',
          `items.${id}`,
          stack.join('->'),
        ),
      )
      return
    }
    visiting.add(id)
    const item = byId.get(id)
    for (const dep of item?.dependsOn ?? []) {
      if (byId.has(dep)) walk(dep, [...stack, dep])
    }
    visiting.delete(id)
    done.add(id)
  }
  for (const item of items) walk(item.itemId, [item.itemId])
}

/**
 * Catalog checker：
 * - 输入缺失/形状非法 → tool-error；
 * - 路径逃逸、digest 格式、重复 identity/version、未知依赖、环、敏感内容、
 *   生产数据标记、市场禁词、说明缺「本机示例」→ blocking；
 * - 未按 itemId/entryFiles 升序 → warning 并在 normalized 中修正（稳定性契约）；
 * - 提供 fileSource 时校验文件存在性 + manifest/package 内容 digest 一致性。
 */
export function validateFixtureSeedCatalog(
  input: unknown,
  options?: ValidateFixtureSeedCatalogOptions,
): ValidateFixtureSeedCatalogResult {
  const findings: PluginFixtureSeedFinding[] = []

  if (!isRecord(input)) {
    return {
      status: 'tool-error',
      findings: [finding('seed-input-missing', 'blocking', 'catalog', 'catalog')],
      catalogDigest: '',
    }
  }

  const raw = input as Record<string, unknown>
  let structural = true
  const expect = (
    cond: boolean,
    code: PluginFixtureSeedFindingCode,
    fieldPath: string,
    message?: string,
  ) => {
    if (!cond) {
      findings.push(finding(code, 'blocking', 'catalog', fieldPath, message))
      structural = false
    }
  }

  expect(
    raw.schemaVersion === PLUGIN_FIXTURE_SEED_CATALOG_SCHEMA_VERSION,
    'seed-catalog-schema-invalid',
    'schemaVersion',
  )
  expect(raw.kind === 'plugin-fixture-seed-catalog-v1', 'seed-catalog-schema-invalid', 'kind')
  expect(
    typeof raw.catalogId === 'string' && raw.catalogId.length > 0,
    'seed-catalog-schema-invalid',
    'catalogId',
  )
  expect(
    typeof raw.catalogVersion === 'string' && isValidSemVer(raw.catalogVersion as string),
    'seed-catalog-schema-invalid',
    'catalogVersion',
  )
  expect(
    raw.defaultProfile === 'smoke' || raw.defaultProfile === 'full',
    'seed-catalog-schema-invalid',
    'defaultProfile',
  )
  expect(typeof raw.description === 'string', 'seed-catalog-schema-invalid', 'description')
  expect(Array.isArray(raw.items), 'seed-catalog-schema-invalid', 'items')

  if (!structural) {
    return { status: 'tool-error', findings: sortFixtureSeedFindings(findings), catalogDigest: '' }
  }

  const description = raw.description as string
  validateWording(description, 'description', findings)
  if (!description.includes(FIXTURE_SEED_REQUIRED_DESCRIPTION_MARKER)) {
    findings.push(
      finding('seed-catalog-description-marker-missing', 'blocking', 'catalog', 'description'),
    )
  }
  scanStringForSensitive(description, 'description', findings)

  const rawItems = raw.items as ReadonlyArray<unknown>
  if (rawItems.length > FIXTURE_SEED_MAX_ITEMS_PER_CATALOG) {
    findings.push(
      finding(
        'seed-catalog-budget-exceeded',
        'blocking',
        'catalog',
        'items',
        `>${FIXTURE_SEED_MAX_ITEMS_PER_CATALOG}`,
      ),
    )
  }

  const seenItemId = new Map<string, number>()
  const seenIdentityVersion = new Map<string, number>()
  const normalizedItems: FixtureSeedCatalogItemV1[] = []
  let itemLevelBlocking = false

  rawItems.forEach((rawItem, index) => {
    const path = `items[${index}]`
    if (!isRecord(rawItem)) {
      findings.push(finding('seed-catalog-schema-invalid', 'blocking', 'catalog', path))
      itemLevelBlocking = true
      return
    }
    const it = rawItem as Record<string, unknown>
    let itemStructural = true
    const expectItem = (
      cond: boolean,
      code: PluginFixtureSeedFindingCode,
      fieldPath: string,
      message?: string,
    ) => {
      if (!cond) {
        findings.push(finding(code, 'blocking', 'catalog', fieldPath, message))
        itemStructural = false
        itemLevelBlocking = true
      }
    }

    expectItem(
      typeof it.itemId === 'string' && /^[a-z0-9-]+$/.test(it.itemId),
      'seed-catalog-schema-invalid',
      `${path}.itemId`,
    )
    expectItem(
      typeof it.pluginIdentity === 'string' && it.pluginIdentity.length > 0,
      'seed-catalog-schema-invalid',
      `${path}.pluginIdentity`,
    )
    expectItem(
      typeof it.displayName === 'string' && it.displayName.length > 0,
      'seed-catalog-schema-invalid',
      `${path}.displayName`,
    )
    expectItem(
      typeof it.version === 'string' && isValidSemVer(it.version as string),
      'seed-catalog-schema-invalid',
      `${path}.version`,
    )
    expectItem(
      it.provenance === 'first-party' || it.provenance === 'fixture',
      'seed-catalog-schema-invalid',
      `${path}.provenance`,
    )
    expectItem(
      typeof it.fixtureRoot === 'string',
      'seed-catalog-schema-invalid',
      `${path}.fixtureRoot`,
    )
    expectItem(
      Array.isArray(it.entryFiles) && it.entryFiles.length > 0,
      'seed-catalog-schema-invalid',
      `${path}.entryFiles`,
    )
    expectItem(
      typeof it.expectedManifestDigest === 'string',
      'seed-catalog-schema-invalid',
      `${path}.expectedManifestDigest`,
    )
    expectItem(
      typeof it.expectedPackageDigest === 'string',
      'seed-catalog-schema-invalid',
      `${path}.expectedPackageDigest`,
    )
    expectItem(
      typeof it.upstreamReceiptRef === 'string',
      'seed-catalog-schema-invalid',
      `${path}.upstreamReceiptRef`,
    )
    expectItem(
      Array.isArray(it.profiles) && (it.profiles as unknown[]).length > 0,
      'seed-catalog-schema-invalid',
      `${path}.profiles`,
    )

    // 兼容性声明
    const compat = it.compatibility
    if (!isRecord(compat)) {
      expectItem(false, 'seed-catalog-schema-invalid', `${path}.compatibility`)
    } else {
      expectItem(
        typeof compat.hostContractVersion === 'string',
        'seed-catalog-schema-invalid',
        `${path}.compatibility.hostContractVersion`,
      )
      expectItem(
        Array.isArray(compat.requiredSeams),
        'seed-catalog-schema-invalid',
        `${path}.compatibility.requiredSeams`,
      )
      if (Array.isArray(compat.requiredSeams)) {
        for (const seam of compat.requiredSeams as unknown[]) {
          const s = seam as Record<string, unknown>
          expectItem(
            isRecord(s) && typeof s['seamKey'] === 'string' && typeof s['seamVersion'] === 'string',
            'seed-catalog-schema-invalid',
            `${path}.compatibility.requiredSeams`,
          )
        }
      }
    }

    if (!itemStructural) return

    const itemId = it.itemId as string
    const pluginIdentity = it.pluginIdentity as string
    const version = it.version as string
    const fixtureRoot = (it.fixtureRoot as string).replace(/\\/g, '/')
    const entryFiles = (it.entryFiles as readonly unknown[]).map((f) =>
      String(f).replace(/\\/g, '/'),
    )
    const profiles = (it.profiles as readonly unknown[]).filter(
      (p): p is FixtureSeedCatalogProfile => p === 'smoke' || p === 'full',
    )
    if (profiles.length !== (it.profiles as readonly unknown[]).length) {
      expectItem(false, 'seed-catalog-schema-invalid', `${path}.profiles`)
      return
    }
    const dependsOn = Array.isArray(it.dependsOn)
      ? (it.dependsOn as readonly unknown[]).map(String)
      : undefined
    const demoTags = Array.isArray(it.demoTags)
      ? (it.demoTags as readonly unknown[]).map(String)
      : undefined

    // 路径边界（lexical）：根与每个文件都必须是安全仓库相对路径，且文件位于根下。
    const rootCheck = isRepoRelativePathSafe(fixtureRoot)
    if (!rootCheck.valid) {
      findings.push(
        finding(
          'seed-catalog-path-escape',
          'blocking',
          'item',
          `${path}.fixtureRoot`,
          rootCheck.reason,
        ),
      )
      itemLevelBlocking = true
    }
    if (entryFiles.length > FIXTURE_SEED_MAX_FILES_PER_ITEM) {
      findings.push(
        finding(
          'seed-catalog-budget-exceeded',
          'blocking',
          'item',
          `${path}.entryFiles`,
          `>${FIXTURE_SEED_MAX_FILES_PER_ITEM}`,
        ),
      )
      itemLevelBlocking = true
    }
    for (const rel of entryFiles) {
      const fileCheck = isRepoRelativePathSafe(rel)
      if (!fileCheck.valid || !rel.startsWith(`${fixtureRoot}/`)) {
        findings.push(
          finding(
            'seed-catalog-path-escape',
            'blocking',
            'item',
            `${path}.entryFiles.${rel}`,
            fileCheck.reason,
          ),
        )
        itemLevelBlocking = true
      }
    }

    // digest 格式
    if (!SHA256_DIGEST_RE.test(it.expectedManifestDigest as string)) {
      findings.push(
        finding(
          'seed-catalog-digest-format-invalid',
          'blocking',
          'item',
          `${path}.expectedManifestDigest`,
        ),
      )
      itemLevelBlocking = true
    }
    if (!SHA256_DIGEST_RE.test(it.expectedPackageDigest as string)) {
      findings.push(
        finding(
          'seed-catalog-digest-format-invalid',
          'blocking',
          'item',
          `${path}.expectedPackageDigest`,
        ),
      )
      itemLevelBlocking = true
    }

    // receipt 命名空间
    if (!(it.upstreamReceiptRef as string).startsWith(FIXTURE_SEED_RECEIPT_PREFIX)) {
      findings.push(
        finding(
          'seed-catalog-schema-invalid',
          'blocking',
          'item',
          `${path}.upstreamReceiptRef`,
          `must start with ${FIXTURE_SEED_RECEIPT_PREFIX}`,
        ),
      )
      itemLevelBlocking = true
    }

    // 文案与低敏
    const displayName = it.displayName as string
    validateWording(displayName, `${path}.displayName`, findings)
    if (demoTags) {
      demoTags.forEach((tag, ti) => {
        validateWording(tag, `${path}.demoTags[${ti}]`, findings)
        scanStringForSensitive(tag, `${path}.demoTags[${ti}]`, findings)
      })
    }
    scanStringForSensitive(displayName, `${path}.displayName`, findings)
    scanStringForSensitive(it.upstreamReceiptRef as string, `${path}.upstreamReceiptRef`, findings)

    // 重复检测
    seenItemId.set(itemId, (seenItemId.get(itemId) ?? 0) + 1)
    const ivKey = `${pluginIdentity}@${version}`
    seenIdentityVersion.set(ivKey, (seenIdentityVersion.get(ivKey) ?? 0) + 1)

    normalizedItems.push({
      itemId,
      pluginIdentity,
      displayName,
      version,
      provenance: it.provenance as FixtureSeedProvenance,
      fixtureRoot,
      entryFiles,
      expectedManifestDigest: it.expectedManifestDigest as string,
      expectedPackageDigest: it.expectedPackageDigest as string,
      compatibility: compat as unknown as FixtureSeedCompatibilityDeclaration,
      upstreamReceiptRef: it.upstreamReceiptRef as string,
      profiles,
      dependsOn,
      demoTags,
      sourceChangeRef: typeof it.sourceChangeRef === 'string' ? it.sourceChangeRef : undefined,
    })
  })

  for (const [id, count] of seenItemId) {
    if (count > 1) {
      findings.push(
        finding(
          'seed-catalog-duplicate-item-id',
          'blocking',
          'catalog',
          `items.${id}`,
          `x${count}`,
        ),
      )
      itemLevelBlocking = true
    }
  }
  for (const [key, count] of seenIdentityVersion) {
    if (count > 1) {
      findings.push(
        finding('seed-catalog-duplicate-identity-version', 'blocking', 'catalog', key, `x${count}`),
      )
      itemLevelBlocking = true
    }
  }

  // 依赖解析（在全部条目收集后）
  const ids = new Set(normalizedItems.map((i) => i.itemId))
  for (const item of normalizedItems) {
    for (const dep of item.dependsOn ?? []) {
      if (!ids.has(dep)) {
        findings.push(
          finding(
            'seed-catalog-unknown-dependency',
            'blocking',
            'catalog',
            `items.${item.itemId}.dependsOn`,
            dep,
          ),
        )
        itemLevelBlocking = true
      }
    }
  }
  detectDependencyCycle(normalizedItems, findings)

  // 排序契约：items 按 itemId 升序；entryFiles 升序（违反 → warning，归一化时修正）
  const sortedById = [...normalizedItems].sort((a, b) =>
    a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0,
  )
  for (let i = 0; i < normalizedItems.length; i += 1) {
    if (normalizedItems[i] !== sortedById[i]) {
      findings.push(
        finding(
          'seed-catalog-unsorted-items',
          'warning',
          'catalog',
          'items',
          'items must be sorted by itemId',
        ),
      )
      break
    }
  }
  for (const item of normalizedItems) {
    const sortedFiles = [...item.entryFiles].sort()
    for (let i = 0; i < item.entryFiles.length; i += 1) {
      if (item.entryFiles[i] !== sortedFiles[i]) {
        findings.push(
          finding(
            'seed-catalog-unsorted-items',
            'warning',
            'catalog',
            `items.${item.itemId}.entryFiles`,
          ),
        )
        break
      }
    }
  }

  // 内容完整性与存在性（注入 fileSource 时）
  const fileSource = options?.fileSource
  if (fileSource?.readFile) {
    for (const item of normalizedItems) {
      const contents: Array<{ path: string; content: string }> = []
      let missing = false
      for (const rel of item.entryFiles) {
        const content = fileSource.readFile(item.fixtureRoot, rel)
        if (content === null || content === undefined) {
          findings.push(
            finding(
              'seed-catalog-fixture-file-missing',
              'blocking',
              'item',
              `items.${item.itemId}.entryFiles.${rel}`,
            ),
          )
          itemLevelBlocking = true
          missing = true
          continue
        }
        contents.push({ path: rel, content })
        scanFileContent(content, `items.${item.itemId}.${rel}`, findings)
      }
      if (missing || !fileSource.hashContent) continue

      const hash = fileSource.hashContent.bind(fileSource)
      const manifest = contents.find((c) => c.path === `${item.fixtureRoot}/plugin.manifest.json`)
      if (manifest) {
        const actualManifest = hash(manifest.content)
        if (actualManifest !== item.expectedManifestDigest) {
          findings.push(
            finding(
              'seed-catalog-digest-mismatch',
              'blocking',
              'item',
              `items.${item.itemId}.expectedManifestDigest`,
            ),
          )
          itemLevelBlocking = true
        }
        try {
          const parsed = JSON.parse(manifest.content) as Record<string, unknown>
          const identity = parsed['identity'] as Record<string, unknown> | undefined
          const pluginId =
            identity && typeof identity['pluginId'] === 'string' ? identity['pluginId'] : undefined
          if (pluginId && pluginId !== item.pluginIdentity) {
            findings.push(
              finding(
                'seed-catalog-manifest-identity-mismatch',
                'blocking',
                'item',
                `items.${item.itemId}.pluginIdentity`,
              ),
            )
            itemLevelBlocking = true
          }
        } catch {
          findings.push(
            finding(
              'seed-catalog-schema-invalid',
              'blocking',
              'item',
              `items.${item.itemId}.manifest-json`,
            ),
          )
          itemLevelBlocking = true
        }
      }
      const actualPackage = computeCanonicalPackageDigest(contents, hash)
      if (actualPackage !== item.expectedPackageDigest) {
        findings.push(
          finding(
            'seed-catalog-digest-mismatch',
            'blocking',
            'item',
            `items.${item.itemId}.expectedPackageDigest`,
          ),
        )
        itemLevelBlocking = true
      }
    }
  }

  const catalog: FixtureSeedCatalogV1 = {
    schemaVersion: PLUGIN_FIXTURE_SEED_CATALOG_SCHEMA_VERSION,
    kind: 'plugin-fixture-seed-catalog-v1',
    catalogId: raw.catalogId as string,
    catalogVersion: raw.catalogVersion as string,
    defaultProfile: raw.defaultProfile as FixtureSeedCatalogProfile,
    description,
    items: sortedById.map((item) => ({
      ...item,
      entryFiles: [...item.entryFiles].sort(),
      dependsOn: item.dependsOn ? [...item.dependsOn].sort() : undefined,
      demoTags: item.demoTags ? [...item.demoTags] : undefined,
    })),
  }

  const hasBlocking = findings.some((f) => f.severity === 'blocking')
  return {
    status: structural && !hasBlocking && !itemLevelBlocking ? 'passed' : 'blocking',
    findings: sortFixtureSeedFindings(findings),
    catalog,
    catalogDigest: computeFixtureSeedCatalogDigest(catalog),
  }
}

// =============================================================================
// 6. Seed state（最小状态：catalog version + created refs；非 lifecycle authority）
// =============================================================================

export interface FixtureSeedStateRecordV1 {
  readonly itemId: string
  readonly pluginIdentity: string
  readonly version: string
  /** seed 创建的 release 主键引用（stale 检测交给 loader）。 */
  readonly releaseId: number | null
  /** 可选安装记录引用（两步 confirm 之后才产生）。 */
  readonly installationId: number | null
  readonly itemDigest: string
}

export interface FixtureSeedStateV1 {
  readonly schemaVersion: typeof PLUGIN_FIXTURE_SEED_STATE_SCHEMA_VERSION
  readonly kind: 'plugin-fixture-seed-state-v1'
  readonly catalogId: string
  readonly catalogVersion: string
  readonly catalogDigest: string
  /** 组织隔离：state 只属于单个组织。 */
  readonly organizationId: number
  readonly records: readonly FixtureSeedStateRecordV1[]
}

/** 解析已持久化 state（JSON 字符串或对象）；非法输入返回 findings 而不抛错。 */
export function parseFixtureSeedState(
  input: unknown,
): { ok: true; state: FixtureSeedStateV1 } | { ok: false; findings: PluginFixtureSeedFinding[] } {
  let value = input
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return {
        ok: false,
        findings: [finding('seed-state-schema-invalid', 'blocking', 'state', 'json')],
      }
    }
  }
  if (!isRecord(value)) {
    return { ok: false, findings: [finding('seed-state-schema-invalid', 'blocking', 'state')] }
  }
  const v = value as Record<string, unknown>
  const okShape =
    v.schemaVersion === PLUGIN_FIXTURE_SEED_STATE_SCHEMA_VERSION &&
    v.kind === 'plugin-fixture-seed-state-v1' &&
    typeof v.catalogId === 'string' &&
    typeof v.catalogVersion === 'string' &&
    typeof v.catalogDigest === 'string' &&
    typeof v.organizationId === 'number' &&
    Array.isArray(v.records) &&
    (v.records as unknown[]).every((r) => {
      if (!isRecord(r)) return false
      const rec = r as Record<string, unknown>
      return (
        typeof rec['itemId'] === 'string' &&
        typeof rec['pluginIdentity'] === 'string' &&
        typeof rec['version'] === 'string' &&
        (rec['releaseId'] === null || typeof rec['releaseId'] === 'number') &&
        (rec['installationId'] === null || typeof rec['installationId'] === 'number') &&
        typeof rec['itemDigest'] === 'string'
      )
    })
  if (!okShape) {
    return { ok: false, findings: [finding('seed-state-schema-invalid', 'blocking', 'state')] }
  }
  return {
    ok: true,
    state: {
      schemaVersion: PLUGIN_FIXTURE_SEED_STATE_SCHEMA_VERSION,
      kind: 'plugin-fixture-seed-state-v1',
      catalogId: v.catalogId as string,
      catalogVersion: v.catalogVersion as string,
      catalogDigest: v.catalogDigest as string,
      organizationId: v.organizationId as number,
      records: v.records as FixtureSeedStateRecordV1[],
    },
  }
}

// =============================================================================
// 7. 运行报告（低敏 envelope，networkCalls 恒 0）
// =============================================================================

export interface FixtureSeedItemResultV1 {
  readonly itemId: string
  readonly pluginIdentity: string
  readonly action:
    'none' | 'validate' | 'create-release' | 'install' | 'disable' | 'uninstall' | 'withdraw'
  readonly outcome: 'ok' | 'already-present' | 'failed' | 'skipped'
  readonly detailCode?: PluginFixtureSeedFindingCode
  readonly releaseId?: number
  readonly installationId?: number
}

export interface FixtureSeedRunReportV1 {
  readonly schemaVersion: typeof PLUGIN_FIXTURE_SEED_REPORT_SCHEMA_VERSION
  readonly kind: 'plugin-fixture-seed-run-report-v1'
  readonly command: FixtureSeedCommand
  readonly profile: FixtureSeedCatalogProfile
  readonly environment: FixtureSeedEnvironment | 'unknown'
  readonly status: 'passed' | 'blocking' | 'tool-error'
  readonly catalogVersion?: string
  readonly catalogDigest?: string
  readonly guardAllowed: boolean
  readonly guardCode?: 'seed-profile-not-allowed' | 'seed-explicit-enable-missing'
  readonly items: readonly FixtureSeedItemResultV1[]
  readonly counts: {
    readonly total: number
    readonly ok: number
    readonly alreadyPresent: number
    readonly failed: number
    readonly skipped: number
  }
  /** 结构性常量：seed 全链路零网络。 */
  readonly networkCalls: 0
  readonly trustedAudit: false
  /** 确定性结果摘要（排除易变计数以外的顺序因素后稳定）。 */
  readonly resultDigest: string
}

/** 由明细组装报告并计算确定性 resultDigest。 */
export function normalizeFixtureSeedRunReport(
  report: Omit<
    FixtureSeedRunReportV1,
    'counts' | 'resultDigest' | 'networkCalls' | 'trustedAudit' | 'schemaVersion' | 'kind'
  > & {
    readonly counts?: Partial<FixtureSeedRunReportV1['counts']>
  },
): FixtureSeedRunReportV1 {
  const items = [...report.items].sort((a, b) =>
    a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0,
  )
  const counts = {
    total: items.length,
    ok: items.filter((i) => i.outcome === 'ok').length,
    alreadyPresent: items.filter((i) => i.outcome === 'already-present').length,
    failed: items.filter((i) => i.outcome === 'failed').length,
    skipped: items.filter((i) => i.outcome === 'skipped').length,
    ...(report.counts ?? {}),
  }
  const base = {
    schemaVersion: PLUGIN_FIXTURE_SEED_REPORT_SCHEMA_VERSION,
    kind: 'plugin-fixture-seed-run-report-v1' as const,
    command: report.command,
    profile: report.profile,
    environment: report.environment,
    status: report.status,
    catalogVersion: report.catalogVersion,
    catalogDigest: report.catalogDigest,
    guardAllowed: report.guardAllowed,
    guardCode: report.guardCode,
    items,
    counts,
  }
  return {
    ...base,
    networkCalls: 0,
    trustedAudit: false,
    resultDigest: computeDevDigest(base),
  }
}

/** 低敏文本渲染（CLI text 输出；不打印绝对路径/摘要全文/digest 明文）。 */
export function renderFixtureSeedReportText(report: FixtureSeedRunReportV1): string {
  const lines: string[] = []
  lines.push(`本机示例插件库（fixture-only · offline · 非 production）`)
  lines.push(`命令: ${report.command}  档位: ${report.profile}  环境: ${report.environment}`)
  lines.push(`守卫: ${report.guardAllowed ? '允许' : `拒绝(${report.guardCode ?? 'n/a'})`}`)
  if (report.catalogVersion) lines.push(`catalog 版本: ${report.catalogVersion}`)
  lines.push(
    `结果: ${report.status}  条目: ${report.counts.total} (成功 ${report.counts.ok} / 已存在 ${report.counts.alreadyPresent} / 失败 ${report.counts.failed} / 跳过 ${report.counts.skipped})`,
  )
  for (const item of report.items) {
    const suffix = item.releaseId !== undefined ? ` release#${item.releaseId}` : ''
    lines.push(
      `- ${item.itemId}: ${item.action}/${item.outcome}${suffix}${item.detailCode ? ` (${item.detailCode})` : ''}`,
    )
  }
  lines.push(`网络调用: 0（离线保证）`)
  return lines.join('\n')
}

/** 退出码语义与 developer kit 一致：passed=0 / blocking=1 / tool-error=2。 */
export function fixtureSeedStatusToExitCode(status: FixtureSeedRunReportV1['status']): 0 | 1 | 2 {
  if (status === 'passed') return 0
  if (status === 'blocking') return 1
  return 2
}

// =============================================================================
// 8. CLI 参数解析（纯函数；scripts/plugin-seed.ts 只是薄封装）
// =============================================================================

export interface FixtureSeedCliInvocation {
  readonly command: Extract<FixtureSeedCommand, 'status' | 'dry-run'>
  readonly profile: FixtureSeedCatalogProfile
  readonly format: FixtureSeedFormat
  readonly environment?: string
  readonly enable: boolean
}

export type ParseFixtureSeedCliArgsResult =
  | { readonly ok: true; readonly invocation: FixtureSeedCliInvocation }
  | { readonly ok: false; readonly exitCode: 2; readonly message: string }

/** 封闭解析：未知参数/未知命令/冲突值 → tool-error(2)，绝不猜测。 */
export function parseFixtureSeedCliArgs(argv: readonly string[]): ParseFixtureSeedCliArgsResult {
  if (argv.length === 0) {
    return { ok: false, exitCode: 2, message: '缺少子命令：status | dry-run' }
  }
  const positional: string[] = []
  let profile: FixtureSeedCatalogProfile | undefined
  let format: FixtureSeedFormat | undefined
  let environment: string | undefined
  let enable = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (arg === '--profile') {
      const value = argv[i + 1]
      if (value !== 'smoke' && value !== 'full') {
        return { ok: false, exitCode: 2, message: '--profile 仅支持 smoke|full' }
      }
      profile = value
      i += 1
    } else if (arg === '--format') {
      const value = argv[i + 1]
      if (value !== 'text' && value !== 'json') {
        return { ok: false, exitCode: 2, message: '--format 仅支持 text|json' }
      }
      format = value
      i += 1
    } else if (arg === '--environment') {
      const value = argv[i + 1]
      if (!value) {
        return { ok: false, exitCode: 2, message: '--environment 缺少值' }
      }
      environment = value
      i += 1
    } else if (arg === '--enable') {
      enable = true
    } else if (arg.startsWith('--')) {
      return { ok: false, exitCode: 2, message: `未知参数：${arg}` }
    } else {
      positional.push(arg)
    }
  }

  const command = positional[0]
  if (command !== 'status' && command !== 'dry-run') {
    return { ok: false, exitCode: 2, message: '未知子命令：仅支持 status | dry-run' }
  }
  if (positional.length > 1) {
    return { ok: false, exitCode: 2, message: `多余的位置参数：${positional.slice(1).join(' ')}` }
  }
  return {
    ok: true,
    invocation: {
      command,
      profile: profile ?? 'smoke',
      format: format ?? 'text',
      environment,
      enable,
    },
  }
}

// =============================================================================
// 9. CLI 纯运行器（status / dry-run；零 DB、零网络——脚本层只做 IO 注入）
// =============================================================================

export interface RunFixtureSeedCliInput {
  readonly invocation: FixtureSeedCliInvocation
  readonly catalog: FixtureSeedCatalogV1
  readonly fileSource?: FixtureSeedFileSource
}

/**
 * status：守卫评估 + 档位条目清点，不读 fixture 内容。
 * dry-run：完整 checker（可注入文件源做完整性/drift 校验），零写入。
 * 守卫拒绝时整体 blocking 且 items 为空（不泄露条目细节之外的信息）。
 */
export function runFixtureSeedStatusOrDryRun(
  input: RunFixtureSeedCliInput,
): FixtureSeedRunReportV1 {
  const { invocation, catalog } = input
  const guard = resolveFixtureSeedProfileGuard({
    environment: invocation.environment,
    explicitEnable: invocation.enable,
  })

  if (!guard.allowed) {
    return normalizeFixtureSeedRunReport({
      command: invocation.command,
      profile: invocation.profile,
      environment: guard.environment,
      status: 'blocking',
      catalogVersion: catalog.catalogVersion,
      catalogDigest: computeFixtureSeedCatalogDigest(catalog),
      guardAllowed: false,
      guardCode: guard.code,
      items: [],
    })
  }

  const items = listFixtureSeedCatalogItemsForProfile(catalog, invocation.profile)

  if (invocation.command === 'status') {
    return normalizeFixtureSeedRunReport({
      command: 'status',
      profile: invocation.profile,
      environment: guard.environment,
      status: 'passed',
      catalogVersion: catalog.catalogVersion,
      catalogDigest: computeFixtureSeedCatalogDigest(catalog),
      guardAllowed: true,
      items: items.map((item) => ({
        itemId: item.itemId,
        pluginIdentity: item.pluginIdentity,
        action: 'none' as const,
        outcome: 'already-present' as const,
      })),
    })
  }

  // dry-run：完整校验
  const validation = validateFixtureSeedCatalog(catalog, { fileSource: input.fileSource })
  const blockingByItem = new Map<string, PluginFixtureSeedFinding>()
  for (const finding of validation.findings) {
    if (finding.severity !== 'blocking') continue
    const match = /^items(?:\[\d+\])?\.([^.[\]]+)/.exec(finding.fieldPath ?? '')
    const itemId = match?.[1] ?? '(catalog)'
    if (!blockingByItem.has(itemId)) blockingByItem.set(itemId, finding)
  }

  return normalizeFixtureSeedRunReport({
    command: 'dry-run',
    profile: invocation.profile,
    environment: guard.environment,
    status: validation.status,
    catalogVersion: validation.catalog?.catalogVersion ?? catalog.catalogVersion,
    catalogDigest: validation.catalogDigest,
    guardAllowed: true,
    items: items.map((item) => {
      const blocker = blockingByItem.get(item.itemId)
      if (validation.status !== 'passed') {
        return {
          itemId: item.itemId,
          pluginIdentity: item.pluginIdentity,
          action: 'validate' as const,
          outcome: blocker ? ('failed' as const) : ('skipped' as const),
          detailCode: blocker?.code,
        }
      }
      return {
        itemId: item.itemId,
        pluginIdentity: item.pluginIdentity,
        action: 'validate' as const,
        outcome: 'ok' as const,
      }
    }),
  })
}
