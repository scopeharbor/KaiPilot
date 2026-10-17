// @aiproj/types — V3 SCIM 属性映射共享契约（v3-scim-attribute-mapping §2）。
//
// 纯函数 + 纯类型，零运行时外部依赖（不加载 AdonisJS/React/DB/密码学/网络）。
// 本模块是「配置即运行时事实」的契约层：
//  - 结构化映射描述符（path + selector + valueField + target + required + normalization）
//    替换 provisioning 契约里的六个简单路径字符串（`ScimAttributeMapping` 保持向后兼容，
//    后端在保存/摘要时在两种形态间转换）；
//  - 有界解析器：RFC 7643 核心 User 子集 + enterprise extension alias，不支持任意表达式；
//  - 低敏诊断：只回 code/target/path/计数，绝不回原始载荷、token、外部 ID、邮箱明文；
//  - profile snapshot 只允许白名单目标键，携带 mappingVersion/fingerprint 供 stale 检测。
//
// 命名约定：常量 `SCIM_MAPPING_` 前缀、类型 `ScimMapping` 前缀、函数 `scimMapping` 前缀
// （避免与 provisioning 契约的 `SCIM_`/`Scim`/`scim` 冲突）。

import { mtFnv1aHash, mtStableSerialize } from './multitenant-isolation-architecture.js'
import {
  SCIM_FORBIDDEN_KEYS,
  scimDetectForbiddenContent,
  scimNormalizeDisplayName,
  scimNormalizeEmail,
  scimNormalizeUserName,
  scimSanitizeLowSensitive,
} from './scim-provisioning.js'

// ──────────────────────────────────────────────
// 1. 枚举与常量
// ──────────────────────────────────────────────

/** hash 命名空间：与 provisioning 契约的 hash 空间隔离。 */
export const SCIM_ATTR_MAPPING_HASH_NS = 'aiproj:v3:scim-attribute-mapping'

/** 本地身份/链接目标（design Decision 2：身份面影响 link 与安全本地建号）。 */
export const SCIM_MAPPING_IDENTITY_TARGETS = [
  'userName',
  'email',
  'displayName',
  'givenName',
  'familyName',
  'active',
] as const
export type ScimMappingIdentityTarget = (typeof SCIM_MAPPING_IDENTITY_TARGETS)[number]

/** 本地 profile snapshot 目标（design Decision 2：只存白名单映射快照，不写全局 users 列）。 */
export const SCIM_MAPPING_PROFILE_TARGETS = [
  'employeeNumber',
  'department',
  'title',
  'userType',
] as const
export type ScimMappingProfileTarget = (typeof SCIM_MAPPING_PROFILE_TARGETS)[number]

/** 全部本地目标键。 */
export const SCIM_MAPPING_TARGETS = [
  ...SCIM_MAPPING_IDENTITY_TARGETS,
  ...SCIM_MAPPING_PROFILE_TARGETS,
] as const
export type ScimMappingTarget = (typeof SCIM_MAPPING_TARGETS)[number]

/** profile snapshot 白名单（写库前二次夹紧，防漂移）。 */
export const SCIM_MAPPING_PROFILE_WHITELIST = [...SCIM_MAPPING_PROFILE_TARGETS] as const

/** 多值选择器类型。 */
export const SCIM_MAPPING_SELECTOR_TYPES = ['none', 'primary', 'first', 'type'] as const
export type ScimMappingSelectorType = (typeof SCIM_MAPPING_SELECTOR_TYPES)[number]

/** 归一化模式。 */
export const SCIM_MAPPING_NORMALIZATIONS = [
  'none',
  'email',
  'userName',
  'displayName',
  'active',
  'profile',
] as const
export type ScimMappingNormalization = (typeof SCIM_MAPPING_NORMALIZATIONS)[number]

/** 低敏诊断 code（审计/UI 只存 code，不存原始值）。 */
export const SCIM_MAPPING_DIAGNOSTIC_CODES = [
  'OK',
  'UNSUPPORTED_PATH',
  'MISSING_REQUIRED_ATTRIBUTE',
  'AMBIGUOUS_MULTI_VALUE',
  'TYPE_MISMATCH',
  'PROFILE_WRITE_POLICY_CONFLICT',
  'STALE_SNAPSHOT',
] as const
export type ScimMappingDiagnosticCode = (typeof SCIM_MAPPING_DIAGNOSTIC_CODES)[number]

/** 管理面 warning code（稳定枚举，前端可派生中文文案，不回原始值）。 */
export const SCIM_MAPPING_WARNING_CODES = [
  'MAPPING_MISSING_REQUIRED',
  'MAPPING_AMBIGUOUS_VALUE',
  'MAPPING_UNSUPPORTED_PATH',
  'MAPPING_TYPE_MISMATCH',
  'MAPPING_PROFILE_POLICY',
  'MAPPING_STALE_SNAPSHOT',
] as const
export type ScimMappingWarningCode = (typeof SCIM_MAPPING_WARNING_CODES)[number]

/** enterprise extension URN（RFC 7643 §8.7）。 */
export const SCIM_ENTERPRISE_EXTENSION_URN =
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'

/** enterprise extension 属性白名单（有界子集）。 */
export const SCIM_ENTERPRISE_EXTENSION_ATTRIBUTES = [
  'employeeNumber',
  'costCenter',
  'organization',
  'division',
  'department',
  'manager',
] as const
export type ScimEnterpriseExtensionAttribute = (typeof SCIM_ENTERPRISE_EXTENSION_ATTRIBUTES)[number]

/** RFC 7643 核心 User 支持路径白名单（有界子集）。 */
export const SCIM_MAPPING_SUPPORTED_CORE_PATHS = [
  'userName',
  'displayName',
  'active',
  'userType',
  'title',
  'name.givenName',
  'name.familyName',
  'name.formatted',
  'emails',
] as const

/** profile 值最大长度（归一化夹紧，防超长字符串入快照）。 */
export const SCIM_MAPPING_PROFILE_VALUE_MAX_LENGTH = 200

/** 描述符路径最大长度（校验夹紧）。 */
export const SCIM_MAPPING_PATH_MAX_LENGTH = 200

// ──────────────────────────────────────────────
// 2. 契约类型
// ──────────────────────────────────────────────

/**
 * 映射源描述符。
 *
 * - `path`：有界点路径（如 `name.givenName`）或 enterprise alias
 *   （`urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber`，
 *   短别名 `enterprise:employeeNumber`）。
 * - `selectorType`：多值选择器。`primary` = 取 primary=true 项（无则第一项）；
 *   `first` = 第一项；`type` = 匹配 `selectorTypeValue` 的项（无则未解析）；
 *   多个命中 → AMBIGUOUS_MULTI_VALUE（确定性取第一命中 + 警告）。标量路径忽略。
 * - `valueField`：多值项/对象的取值字段（如 emails 项取 `value`）。
 * - `target`：本地目标键（identity 或 profile）。
 * - `required`：必填；未解析/空 → MISSING_REQUIRED_ATTRIBUTE。
 * - `normalization`：归一化模式。
 */
export interface ScimMappingDescriptor {
  path: string
  selectorType?: ScimMappingSelectorType
  /** selectorType = 'type' 时匹配的 `type` 字段值（如 'work'）。 */
  selectorTypeValue?: string
  valueField?: string
  target: ScimMappingTarget
  required?: boolean
  normalization?: ScimMappingNormalization
}

export type ScimMappingDescriptorList = ScimMappingDescriptor[]

/**
 * 默认映射描述符（**等价于** provisioning 契约当前硬编码提取语义：
 * emails primary/first、userName、displayName、name.givenName、name.familyName、active）。
 * 行为不变性由「默认映射 = 既有硬编码路径」保证；运行时换 resolver 后既有测试
 * 改为对默认映射断言。
 */
export const SCIM_DEFAULT_MAPPING_DESCRIPTORS: ScimMappingDescriptorList = [
  {
    path: 'emails',
    selectorType: 'primary',
    valueField: 'value',
    target: 'email',
    required: false,
    normalization: 'email',
  },
  { path: 'userName', target: 'userName', required: false, normalization: 'userName' },
  { path: 'displayName', target: 'displayName', required: false, normalization: 'displayName' },
  { path: 'name.givenName', target: 'givenName', required: false, normalization: 'displayName' },
  { path: 'name.familyName', target: 'familyName', required: false, normalization: 'displayName' },
  { path: 'active', target: 'active', required: false, normalization: 'active' },
]

/** 低敏诊断（只含 code/target/path/计数，绝不含原始值）。 */
export interface ScimMappingDiagnostic {
  code: ScimMappingDiagnosticCode
  /** 关联的本地目标键（UNSUPPORTED_PATH 等路径级诊断可为 null）。 */
  target: ScimMappingTarget | null
  /** 低敏补充（源路径、计数等；不含载荷值）。 */
  detail: string
}

/** 解析结果（运行时与 preview 共用同一 resolver）。 */
export interface ScimMappingResolution {
  ok: boolean
  /** target → 归一化值（identity 字符串/布尔 + profile 字符串；未解析 = null）。 */
  values: Record<string, string | boolean | null>
  diagnostics: ScimMappingDiagnostic[]
  warningCodes: ScimMappingWarningCode[]
}

/** preview 目标摘要（低敏：掩码/枚举/计数，绝不回原始值）。 */
export interface ScimMappingPreviewTargetSummary {
  target: ScimMappingTarget
  ok: boolean
  warningCode: ScimMappingWarningCode | null
  /** 掩码摘要（如 a***@example.com / 长 12）；active 回 'true'/'false'。 */
  summary: string
  normalization: ScimMappingNormalization
}

/** preview 结果（无副作用；不含任何原始载荷字段）。 */
export interface ScimMappingPreviewResult {
  targets: ScimMappingPreviewTargetSummary[]
  warningCount: number
  hasWarnings: boolean
}

/** profile snapshot（白名单键 + 映射版本元数据；不含 raw 载荷）。 */
export interface ScimProfileSnapshot {
  userLinkId: number
  organizationId: number
  /** 只允许 SCIM_MAPPING_PROFILE_WHITELIST 键。 */
  values: Record<string, string | null>
  mappingVersion: number
  mappingFingerprint: string
  lastAppliedAt: string
}

// ──────────────────────────────────────────────
// 3. 确定性 fingerprint / version
// ──────────────────────────────────────────────

/**
 * 属性映射指纹：描述符列表稳定序列化后 hash。
 * 键序无关（描述符按 path+target 排序），跨进程/跨端稳定。
 */
export function scimComputeAttributeMappingFingerprint(
  descriptors: ScimMappingDescriptorList,
): string {
  const sorted = [...descriptors]
    .map((d) => ({
      path: d.path,
      selectorType: d.selectorType ?? 'none',
      selectorTypeValue: d.selectorTypeValue ?? null,
      valueField: d.valueField ?? null,
      target: d.target,
      required: Boolean(d.required),
      normalization: d.normalization ?? 'none',
    }))
    .sort((a, b) =>
      a.target === b.target ? a.path.localeCompare(b.path) : a.target.localeCompare(b.target),
    )
  const serialized = mtStableSerialize({ descriptors: sorted })
  const first = mtFnv1aHash(`${SCIM_ATTR_MAPPING_HASH_NS}:attr-mapping:${serialized}`)
  const second = mtFnv1aHash(`${first}:${serialized.length}:attr-mapping`)
  return `${first}${second}`.slice(0, 16).padEnd(16, '0')
}

/** 映射版本：由指纹确定性派生（低敏整数，管理员/审计可见）。 */
export function scimMappingVersionFromFingerprint(fingerprint: string): number {
  if (!fingerprint) return 0
  const hex = fingerprint.slice(0, 8)
  return Number.parseInt(hex, 16) || 0
}

/** stale 判定：快照携带的 version/fingerprint 与当前配置不一致 → stale。 */
export function scimMappingIsStaleSnapshot(input: {
  snapshotVersion: number
  snapshotFingerprint: string
  currentVersion: number
  currentFingerprint: string
}): boolean {
  if (!input.snapshotFingerprint || !input.currentFingerprint) return false
  return (
    input.snapshotVersion !== input.currentVersion ||
    input.snapshotFingerprint !== input.currentFingerprint
  )
}

// ──────────────────────────────────────────────
// 4. 路径校验（有界语法）
// ──────────────────────────────────────────────

/** enterprise alias → 完整 URN 路径；未知/非法 → null。 */
export function scimMappingNormalizeEnterprisePath(path: string): string | null {
  const trimmed = path.trim()
  if (trimmed.length === 0 || trimmed.length > SCIM_MAPPING_PATH_MAX_LENGTH) return null
  const shortAlias = /^enterprise:([A-Za-z][A-Za-z0-9]*)$/.exec(trimmed)
  if (shortAlias) {
    const attr = shortAlias[1] as ScimEnterpriseExtensionAttribute
    if ((SCIM_ENTERPRISE_EXTENSION_ATTRIBUTES as readonly string[]).includes(attr)) {
      return `${SCIM_ENTERPRISE_EXTENSION_URN}:${attr}`
    }
    return null
  }
  const urnPrefix = `${SCIM_ENTERPRISE_EXTENSION_URN}:`
  if (trimmed.startsWith(urnPrefix)) {
    const attr = trimmed.slice(urnPrefix.length)
    if ((SCIM_ENTERPRISE_EXTENSION_ATTRIBUTES as readonly string[]).includes(attr)) {
      return trimmed
    }
    return null
  }
  return null
}

/** 路径是否受支持（core 白名单或 enterprise alias）；同时归一化 alias。 */
export function scimMappingNormalizeSupportedPath(path: string): string | null {
  const trimmed = path.trim()
  if (trimmed.length === 0 || trimmed.length > SCIM_MAPPING_PATH_MAX_LENGTH) return null
  if ((SCIM_MAPPING_SUPPORTED_CORE_PATHS as readonly string[]).includes(trimmed)) return trimmed
  return scimMappingNormalizeEnterprisePath(trimmed)
}

// ──────────────────────────────────────────────
// 5. 归一化 helpers（纯函数）
// ──────────────────────────────────────────────

export type ScimMappingNormalizedValue = string | boolean | null

/** email：trim + lowercase（复用 provisioning 语义）。 */
export function scimMappingNormalizeEmail(value: unknown): ScimMappingNormalizedValue {
  if (typeof value !== 'string') return null
  return scimNormalizeEmail(value)
}

/** userName：trim + lowercase。 */
export function scimMappingNormalizeUserName(value: unknown): ScimMappingNormalizedValue {
  if (typeof value !== 'string') return null
  return scimNormalizeUserName(value)
}

/** displayName/fullName 类：trim（保留大小写）。 */
export function scimMappingNormalizeDisplayName(value: unknown): ScimMappingNormalizedValue {
  if (typeof value !== 'string') return null
  return scimNormalizeDisplayName(value)
}

/**
 * active 布尔归一：接受 boolean 与字符串 'true'/'false'（大小写不敏感）。
 * 其余类型 → null（TYPE_MISMATCH 由调用方/诊断层判定）。
 */
export function scimMappingNormalizeActive(value: unknown): ScimMappingNormalizedValue {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === 'true') return true
    if (lowered === 'false') return false
  }
  return null
}

/**
 * profile 值归一：trim + 长度夹紧（> SCIM_MAPPING_PROFILE_VALUE_MAX_LENGTH 截断）。
 * 非字符串 → null。白名单键的强制在 `scimMappingWhitelistProfileValues`。
 */
export function scimMappingNormalizeProfileValue(value: unknown): ScimMappingNormalizedValue {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return ''
  if (trimmed.length > SCIM_MAPPING_PROFILE_VALUE_MAX_LENGTH) {
    return trimmed.slice(0, SCIM_MAPPING_PROFILE_VALUE_MAX_LENGTH)
  }
  return trimmed
}

/** 按归一化模式归一（未知模式 → none 语义：仅字符串保留，其余 null）。 */
export function scimMappingNormalizeByMode(
  mode: ScimMappingNormalization | undefined,
  value: unknown,
): ScimMappingNormalizedValue {
  switch (mode) {
    case 'email':
      return scimMappingNormalizeEmail(value)
    case 'userName':
      return scimMappingNormalizeUserName(value)
    case 'displayName':
      return scimMappingNormalizeDisplayName(value)
    case 'active':
      return scimMappingNormalizeActive(value)
    case 'profile':
      return scimMappingNormalizeProfileValue(value)
    case 'none':
    default:
      return typeof value === 'string' ? value : null
  }
}

/** 白名单强制：从任意 Record 只取 profile 白名单键（防快照漂移）。 */
export function scimMappingWhitelistProfileValues(
  values: Record<string, unknown>,
): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  for (const key of SCIM_MAPPING_PROFILE_WHITELIST) {
    const raw = values[key]
    result[key] = typeof raw === 'string' ? raw : null
  }
  return result
}

/** 掩码摘要（preview 用）：邮箱 mask 域名保留；其余字符串首尾字符；布尔原样。 */
export function scimMappingMaskValue(
  target: ScimMappingTarget,
  value: string | boolean | null,
): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return String(value)
  if (target === 'email') {
    const at = value.indexOf('@')
    if (at > 0) {
      return `${value[0]}***@${value.slice(at + 1)}`
    }
    return value.length > 0 ? `${value[0]}***` : '***'
  }
  if (value.length === 0) return '（空）'
  if (value.length === 1) return `${value[0]}***`
  return `${value[0]}***${value[value.length - 1]}`
}

// ──────────────────────────────────────────────
// 6. 有界解析器（design Decision 1：结构化描述符，非表达式）
// ──────────────────────────────────────────────

/**
 * 从载荷按描述符解析并归一化一个目标值。
 *
 * 返回 `{ ok, value, warningCode }`；ok=false 时 value=null。
 * 纯函数：不碰 DB/网络/租户上下文。
 */
export function scimMappingResolveOne(
  descriptor: ScimMappingDescriptor,
  payload: Record<string, unknown>,
): { ok: boolean; value: string | boolean | null; warningCode: ScimMappingWarningCode | null } {
  const path = scimMappingNormalizeSupportedPath(descriptor.path)
  if (!path) {
    return { ok: false, value: null, warningCode: 'MAPPING_UNSUPPORTED_PATH' }
  }

  // ── 定位源值 ────────────────────────────────────────────
  let node: unknown = payload
  if (path.startsWith(SCIM_ENTERPRISE_EXTENSION_URN)) {
    const attr = path.slice(SCIM_ENTERPRISE_EXTENSION_URN.length + 1)
    const ext = (payload as Record<string, unknown>)[SCIM_ENTERPRISE_EXTENSION_URN]
    if (typeof ext !== 'object' || ext === null) {
      node = undefined
    } else {
      node = (ext as Record<string, unknown>)[attr]
    }
  } else {
    const segments = path.split('.')
    for (const segment of segments) {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) {
        node = undefined
        break
      }
      node = (node as Record<string, unknown>)[segment]
    }
  }

  // ── 多值选择 ────────────────────────────────────────────
  let warningCode: ScimMappingWarningCode | null = null
  if (Array.isArray(node)) {
    const items = node
    const selectorType = descriptor.selectorType ?? 'none'
    if (selectorType === 'primary') {
      const primaries = items.filter(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          (item as Record<string, unknown>).primary === true,
      )
      if (primaries.length > 1) warningCode = 'MAPPING_AMBIGUOUS_VALUE'
      node = primaries.length > 0 ? (primaries[0] ?? null) : (items[0] ?? null)
    } else if (selectorType === 'type') {
      const wanted = descriptor.selectorTypeValue ?? ''
      const matches = items.filter(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          (item as Record<string, unknown>).type === wanted,
      )
      if (matches.length > 1) warningCode = 'MAPPING_AMBIGUOUS_VALUE'
      node = matches.length > 0 ? (matches[0] ?? null) : undefined
    } else {
      // 'first' 或 'none'：确定性取第一项
      node = items[0] ?? undefined
    }
  }

  // ── valueField 取值 ─────────────────────────────────────
  if (descriptor.valueField && typeof node === 'object' && node !== null) {
    node = (node as Record<string, unknown>)[descriptor.valueField]
  }

  // ── 归一化 ──────────────────────────────────────────────
  const normalized = scimMappingNormalizeByMode(descriptor.normalization ?? 'none', node)
  if (normalized === null && node !== null && node !== undefined) {
    // 值存在但类型不兼容（如 active: "yes"、displayName: 123）
    return { ok: false, value: null, warningCode: 'MAPPING_TYPE_MISMATCH' }
  }

  // ── required 判定 ───────────────────────────────────────
  if (descriptor.required && (normalized === null || normalized === '')) {
    return { ok: false, value: null, warningCode: 'MAPPING_MISSING_REQUIRED' }
  }
  return { ok: true, value: normalized, warningCode }
}

/**
 * 解析完整映射：所有描述符 → 目标值 + 诊断。
 *
 * - UNSUPPORTED_PATH：路径不在有界语法内 → 该描述符失败（fail closed）。
 * - PROFILE_WRITE_POLICY_CONFLICT：profile 目标被重复配置（一个目标多个描述符）——
 *   确定性取**第一个**描述符并告警（管理员可据此收敛配置）。
 * - ok = 无任何诊断。
 */
export function scimResolveMappedAttributes(input: {
  descriptors: ScimMappingDescriptorList
  payload: Record<string, unknown>
}): ScimMappingResolution {
  const values: Record<string, string | boolean | null> = {}
  const diagnostics: ScimMappingDiagnostic[] = []
  const warningCodes: ScimMappingWarningCode[] = []
  const seenTargets = new Set<string>()

  for (const descriptor of input.descriptors) {
    const path = scimMappingNormalizeSupportedPath(descriptor.path)
    if (!path) {
      const diagnostic: ScimMappingDiagnostic = {
        code: 'UNSUPPORTED_PATH',
        target: descriptor.target,
        detail: descriptor.path.slice(0, 80),
      }
      diagnostics.push(diagnostic)
      warningCodes.push('MAPPING_UNSUPPORTED_PATH')
      values[descriptor.target] = null
      continue
    }
    if (seenTargets.has(descriptor.target)) {
      // 重复目标：确定性保留第一个，报告 profile-write 冲突（低敏）
      const diagnostic: ScimMappingDiagnostic = {
        code: 'PROFILE_WRITE_POLICY_CONFLICT',
        target: descriptor.target,
        detail: `duplicate-target:${descriptor.target}`,
      }
      diagnostics.push(diagnostic)
      warningCodes.push('MAPPING_PROFILE_POLICY')
      continue
    }
    seenTargets.add(descriptor.target)

    const resolved = scimMappingResolveOne(descriptor, input.payload)
    values[descriptor.target] = resolved.value
    if (!resolved.ok) {
      const code =
        resolved.warningCode === 'MAPPING_UNSUPPORTED_PATH'
          ? 'UNSUPPORTED_PATH'
          : resolved.warningCode === 'MAPPING_MISSING_REQUIRED'
            ? 'MISSING_REQUIRED_ATTRIBUTE'
            : resolved.warningCode === 'MAPPING_AMBIGUOUS_VALUE'
              ? 'AMBIGUOUS_MULTI_VALUE'
              : 'TYPE_MISMATCH'
      diagnostics.push({ code, target: descriptor.target, detail: path })
      if (resolved.warningCode) warningCodes.push(resolved.warningCode)
    } else if (resolved.warningCode) {
      const code =
        resolved.warningCode === 'MAPPING_AMBIGUOUS_VALUE'
          ? 'AMBIGUOUS_MULTI_VALUE'
          : 'TYPE_MISMATCH'
      diagnostics.push({ code, target: descriptor.target, detail: path })
      warningCodes.push(resolved.warningCode)
    }
  }

  return {
    ok: diagnostics.length === 0,
    values,
    diagnostics,
    warningCodes: Array.from(new Set(warningCodes)),
  }
}

/** 从解析结果构建 preview DTO（低敏：只含掩码摘要/枚举/计数）。 */
export function scimMappingBuildPreviewResult(
  resolution: ScimMappingResolution,
): ScimMappingPreviewResult {
  const targets: ScimMappingPreviewTargetSummary[] = []
  for (const [target, value] of Object.entries(resolution.values)) {
    const diagnostic = resolution.diagnostics.find((d) => d.target === target)
    const warningCode: ScimMappingWarningCode | null =
      diagnostic?.code === 'UNSUPPORTED_PATH'
        ? 'MAPPING_UNSUPPORTED_PATH'
        : diagnostic?.code === 'MISSING_REQUIRED_ATTRIBUTE'
          ? 'MAPPING_MISSING_REQUIRED'
          : diagnostic?.code === 'AMBIGUOUS_MULTI_VALUE'
            ? 'MAPPING_AMBIGUOUS_VALUE'
            : diagnostic?.code === 'TYPE_MISMATCH'
              ? 'MAPPING_TYPE_MISMATCH'
              : diagnostic?.code === 'PROFILE_WRITE_POLICY_CONFLICT'
                ? 'MAPPING_PROFILE_POLICY'
                : null
    targets.push({
      target: target as ScimMappingTarget,
      ok: warningCode === null,
      warningCode,
      summary: scimMappingMaskValue(target as ScimMappingTarget, value),
      normalization:
        SCIM_DEFAULT_MAPPING_DESCRIPTORS.find((d) => d.target === target)?.normalization ?? 'none',
    })
  }
  const warningCount = targets.filter((t) => t.warningCode !== null).length
  return {
    targets,
    warningCount,
    hasWarnings: warningCount > 0,
  }
}

// ──────────────────────────────────────────────
// 6.5/6.6 管理面 warning 文案（稳定枚举 → 中文，UI 可直接派生）
// ──────────────────────────────────────────────

/**
 * warning code → 中文提示（task 6.5/6.6）。
 *
 * 只含枚举 code 的映射，**绝不含**原始值/载荷片段；未知 code 原样返回
 * （排障用，不携带租户事实）。
 */
export function scimMappingWarningCopy(code: string): string {
  switch (code) {
    case 'MAPPING_MISSING_REQUIRED':
      return '必填属性未在目录中解析到，请检查来源路径或补齐目录属性。'
    case 'MAPPING_AMBIGUOUS_VALUE':
      return '多值属性命中多个候选值（如多个主邮箱），已按确定性规则取第一个。'
    case 'MAPPING_UNSUPPORTED_PATH':
      return '该属性路径不在受支持范围内，请从可选属性中选择。'
    case 'MAPPING_TYPE_MISMATCH':
      return '属性值类型与目标不匹配（如启用状态不是布尔值）。'
    case 'MAPPING_PROFILE_POLICY':
      return '该目标已被重复配置或不在档案快照白名单内。'
    case 'MAPPING_STALE_SNAPSHOT':
      return '档案快照由旧版映射生成，重新同步后将刷新。'
    default:
      return code
  }
}

// ──────────────────────────────────────────────
// 7. 禁止内容检测扩展（task 2.7）
// ──────────────────────────────────────────────

/**
 * 值看起来像 SCIM emails 数组形态（`[{value, primary?|type?}]`）吗？
 * preview/结果/快照 DTO 里出现该形态 = raw email 数组泄漏。
 */
export function scimMappingIsEmailArrayShape(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  let sawMeta = false
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return false
    const record = item as Record<string, unknown>
    if (typeof record.value !== 'string') return false
    if ('primary' in record || 'type' in record) sawMeta = true
  }
  return sawMeta
}

/**
 * 映射面禁止内容检测：provisioning 通用检测（token/Authorization/raw 载荷/禁止键）
 * + 映射专有形态（`schemas` 数组的 raw 文档、emails 数组）。
 * 返回命中路径列表（空 = 干净）。
 */
export function scimMappingDetectForbiddenContent(value: unknown, path = '$'): string[] {
  const hits = scimDetectForbiddenContent(value, path)
  if (value === null || value === undefined) return hits
  if (Array.isArray(value)) {
    if (scimMappingIsEmailArrayShape(value)) hits.push(`${path}<raw-email-array>`)
    value.forEach((item, index) =>
      hits.push(...scimMappingDetectForbiddenContent(item, `${path}[${index}]`)),
    )
    return hits
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.schemas) && record.schemas.length > 0) {
      hits.push(`${path}.schemas<raw-scim-document>`)
    }
    for (const [key, child] of Object.entries(record)) {
      if (key.toLowerCase() === 'schemas' && Array.isArray(child)) continue
      hits.push(...scimMappingDetectForbiddenContent(child, `${path}.${key}`))
    }
    return hits
  }
  return hits
}

/**
 * 映射面低敏脱敏：通用脱敏 + 移除 `schemas` 文档键 + emails 数组值打码。
 * 与检测函数是一对：检测用于测试断言，脱敏用于运行期兜底。
 */
export function scimMappingSanitizeLowSensitive<T>(value: T): T {
  return scimMappingSanitizeInner(value) as T
}

function scimMappingSanitizeInner(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) {
    if (scimMappingIsEmailArrayShape(value)) {
      return value.map((item) => {
        const record = item as Record<string, unknown>
        return { ...record, value: '[redacted]' }
      })
    }
    return value.map(scimMappingSanitizeInner)
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.toLowerCase() === 'schemas' && Array.isArray(child)) continue
      if (
        (SCIM_FORBIDDEN_KEYS as readonly string[]).some(
          (f) => f.toLowerCase() === key.toLowerCase(),
        )
      ) {
        continue
      }
      result[key] = scimMappingSanitizeInner(child)
    }
    return result
  }
  return scimSanitizeLowSensitive(value)
}

/** snapshot 候选检查：values 中是否含禁止内容/raw 载荷（写库前断言用）。 */
export function scimMappingSnapshotForbiddenHits(values: Record<string, unknown>): string[] {
  return scimMappingDetectForbiddenContent(values, '$snapshot')
}
