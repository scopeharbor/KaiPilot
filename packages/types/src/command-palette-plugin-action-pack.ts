/**
 * command-palette-plugin-action-pack —— V3 官方 Command Palette 插件命令包共享契约
 * （v3-command-palette-plugin-action-pack）。
 *
 * 纯类型 + 常量 + 确定性纯函数，零运行时依赖、零网络/IO/时间/随机数依赖。
 * 复用 plugin-ui-command 的 contribution 契约与 finding 形状（不建第二套注册表），
 * 在其上收敛官方包的稳定 identity/version、允许 action refs、canonical digest
 * 与低敏 finding 契约。
 *
 * # 语义要点（对应 design.md D1~D5 与 specs/command-palette-plugin-action-pack/spec.md）
 * - 官方包只声明宿主持有动作：safe-open（navigate/open-form/open-confirm）+
 *   写入入口唯一映射 `open-plugin-action-preview`（payload 仅含宿主可重解析稳定引用）。
 * - 直接业务写入 action ref（create/update/delete/apply/sync/external-write/write/execute）
 *   一律 blocking 拒绝该违规 contribution。
 * - 脚本/URL/iframe 等可执行内容在包级与 contribution 级双重拒绝。
 * - digest 与 generatedAt/时间戳无关：同版本重复构建必须得到同一 digest。
 * - findings 低敏：复用 PluginUiCommandFinding + sanitizeFindings。
 */

import {
  PLUGIN_UI_COMMAND_MAX_PER_OWNER,
  validateContribution,
  sanitizeFindings,
  type PluginUiCommandContributionV1,
  type PluginUiCommandFinding,
} from './plugin-ui-command.js'
import { isValidNamespaceKey } from './plugin-manifest.js'

// =============================================================================
// 1. 常量与封闭词表
// =============================================================================

/** 官方包契约 schema 版本（首版固定 "1"）。 */
export const COMMAND_ACTION_PACK_SCHEMA_VERSION = '1' as const
export type CommandActionPackSchemaVersion = typeof COMMAND_ACTION_PACK_SCHEMA_VERSION

/** 官方命令包插件 ID（稳定 identity；随生命周期可撤销的是安装实例，不是此 ID）。 */
export const OFFICIAL_COMMAND_ACTION_PACK_PLUGIN_ID =
  'com.aiproj.official.command-action-pack' as const

/** ui-command 贡献接缝 key（release metadata contributions[].seamKey）。 */
export const PLUGIN_SEAM_UI_COMMAND = 'ui-command.palette-contribution' as const

/** 接缝版本。 */
export const PLUGIN_SEAM_UI_COMMAND_VERSION = '1.0.0' as const

/**
 * 官方包允许的宿主 action refs（封闭集）。
 * safe-open 三类沿用既有安全动作；写入型入口只允许 open-plugin-action-preview。
 */
export const COMMAND_ACTION_PACK_ALLOWED_ACTION_REFS = [
  'navigate',
  'open-form',
  'open-confirm',
  'open-plugin-action-preview',
] as const
export type CommandActionPackAllowedActionRef =
  (typeof COMMAND_ACTION_PACK_ALLOWED_ACTION_REFS)[number]

/** 直接业务写入 action ref 黑名单（精确匹配；出现即 blocking）。 */
export const COMMAND_ACTION_PACK_FORBIDDEN_ACTION_REFS = [
  'write',
  'create',
  'update',
  'delete',
  'apply',
  'sync',
  'external-write',
  'execute',
] as const

/** 包级危险属性黑名单（可执行内容/网络/敏感值载体）。 */
export const COMMAND_ACTION_PACK_FORBIDDEN_PROPERTIES = [
  'execute',
  'render',
  'component',
  'script',
  'iframe',
  'url',
  'href',
  'src',
  'fetch',
  'request',
  'handler',
  'callback',
  'token',
  'secret',
  'password',
  'apiKey',
  'authorization',
] as const

/** 单包最大命令数（防检索噪声；与 owner 上限一致）。 */
export const COMMAND_ACTION_PACK_MAX_COMMANDS = PLUGIN_UI_COMMAND_MAX_PER_OWNER

/** pack title/description 长度上限。 */
export const COMMAND_ACTION_PACK_MAX_TITLE_LENGTH = 120
export const COMMAND_ACTION_PACK_MAX_DESCRIPTION_LENGTH = 400

/** preview 稳定引用参数约束（宿主可重解析的最小载荷）。 */
export const COMMAND_ACTION_PACK_PREVIEW_REF_KEY = 'actionRef'
export const COMMAND_ACTION_PACK_PREVIEW_REF_MAX_LENGTH = 200

// =============================================================================
// 2. 类型
// =============================================================================

/** 官方命令包声明（fixture/release 载荷的顶层形状）。 */
export interface CommandActionPackManifestV1 {
  /** schema 版本（固定 "1"）。 */
  schemaVersion: typeof COMMAND_ACTION_PACK_SCHEMA_VERSION
  /** 包插件 ID（稳定 identity）。 */
  packId: string
  /** 包版本（semver 字符串）。 */
  version: string
  /** 中文标题。 */
  title: string
  /** 中文描述（可选）。 */
  description?: string
  /** 命令声明列表（每条都是合法 PluginUiCommandContributionV1）。 */
  commands: PluginUiCommandContributionV1[]
}

/** 包校验结果（valid = 无 blocking finding）。 */
export interface CommandActionPackValidationResult {
  valid: boolean
  /** 全部 findings（已按稳定排序；低敏形状）。 */
  findings: PluginUiCommandFinding[]
  /** 校验通过时返回归一化后的包（字段 trim、commands 按 contributionKey 稳定排序）。 */
  normalizedPack?: CommandActionPackManifestV1
}

// =============================================================================
// 3. 类型守卫
// =============================================================================

/** 是否为官方包允许的 action ref。 */
export function isCommandActionPackAllowedActionRef(
  actionKey: string,
): actionKey is CommandActionPackAllowedActionRef {
  return (COMMAND_ACTION_PACK_ALLOWED_ACTION_REFS as readonly string[]).includes(actionKey)
}

/** 是否为直接业务写入 action ref（精确匹配黑名单）。 */
export function isForbiddenDirectWriteActionRef(actionKey: string): boolean {
  return (COMMAND_ACTION_PACK_FORBIDDEN_ACTION_REFS as readonly string[]).includes(actionKey)
}

/** semver 形状守卫（宽松：major.minor.patch 数字段）。 */
export function isValidActionPackVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version)
}

// =============================================================================
// 4. 确定性序列化与 digest
// =============================================================================

/** 确定性 FNV-1a 32-bit 哈希（与其他插件契约模块同算法）。 */
export function commandActionPackFnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 确定性稳定 JSON 序列化（键排序递归；数组保序但 commands 先归一化排序）。 */
export function commandActionPackStableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => commandActionPackStableSerialize(v)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries
      .map(([k, v]) => JSON.stringify(k) + ':' + commandActionPackStableSerialize(v))
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * 归一化官方包：trim 字符串字段、剔除 undefined、commands 按 contributionKey 稳定排序。
 * 输入必须是已通过结构校验的包（否则行为未定义——先 validate 再 normalize）。
 */
export function normalizeCommandActionPack(
  pack: CommandActionPackManifestV1,
): CommandActionPackManifestV1 {
  const commands = [...pack.commands]
    .map((c) => ({
      ...c,
      label: c.label.trim(),
      contributionKey: c.contributionKey.trim(),
      ...(c.keywords ? { keywords: [...c.keywords].sort() } : {}),
      ...(c.requiredPermissions ? { requiredPermissions: [...c.requiredPermissions].sort() } : {}),
    }))
    .sort((a, b) => a.contributionKey.localeCompare(b.contributionKey))
  return {
    schemaVersion: pack.schemaVersion,
    packId: pack.packId.trim(),
    version: pack.version.trim(),
    title: pack.title.trim(),
    ...(pack.description ? { description: pack.description.trim() } : {}),
    commands,
  }
}

/**
 * 计算官方包 canonical digest。
 * 只依赖包内容本身（identity/version/title/commands），与构建时间/环境无关：
 * 同版本重复构建必须得到同一 digest。
 */
export function computeCommandActionPackDigest(pack: CommandActionPackManifestV1): string {
  const normalized = normalizeCommandActionPack(pack)
  return commandActionPackFnv1a(commandActionPackStableSerialize(normalized))
}

/** 校验包 digest 一致性（损坏 digest → false）。 */
export function verifyCommandActionPackDigest(
  pack: CommandActionPackManifestV1,
  expectedDigest: string,
): boolean {
  return computeCommandActionPackDigest(pack) === expectedDigest
}

// =============================================================================
// 5. 包级校验
// =============================================================================

/** 深层扫描原始 JSON 是否携带包级危险属性（脚本/URL/回调/敏感值载体）。 */
function findForbiddenPropertiesDeep(
  value: unknown,
  path: string,
  out: Array<{ path: string; key: string }>,
): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, i) => findForbiddenPropertiesDeep(item, `${path}[${i}]`, out))
    return
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if ((COMMAND_ACTION_PACK_FORBIDDEN_PROPERTIES as readonly string[]).includes(key)) {
      out.push({ path: `${path}.${key}`, key })
    }
    findForbiddenPropertiesDeep(val, `${path}.${key}`, out)
  }
}

/**
 * 校验官方命令包（纯函数；findings 已排序并低敏化）。
 *
 * - 结构/schema 错误 → blocking `contribution-schema-invalid`
 * - 未知 action ref → blocking `unknown-action-kind`
 * - 直接写入 action ref → blocking `effect-not-allowed`（拒绝整个违规 contribution）
 * - 危险属性（script/url/iframe/token…）→ blocking `contribution-schema-invalid`
 * - 同包内冲突 identity（重复 contributionKey）→ blocking `contribution-duplicate`
 * - navigate 缺 route / open-form 缺 formId / preview 缺或超长 actionRef → blocking
 * - 命令数超上限 → blocking
 */
export function validateCommandActionPack(raw: unknown): CommandActionPackValidationResult {
  const findings: PluginUiCommandFinding[] = []

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      evidenceRef: 'pack:not-an-object',
    })
    return { valid: false, findings: sanitizeFindings(findings) }
  }

  // 包级危险属性深扫（在任何字段访问之前）
  const forbiddenHits: Array<{ path: string; key: string }> = []
  findForbiddenPropertiesDeep(raw, 'pack', forbiddenHits)
  for (const hit of forbiddenHits.slice(0, 20)) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      evidenceRef: `forbidden-property:${hit.key}`,
    })
  }

  const pack = raw as Partial<CommandActionPackManifestV1> & Record<string, unknown>

  if (pack.schemaVersion !== COMMAND_ACTION_PACK_SCHEMA_VERSION) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      evidenceRef: `schemaVersion:${String(pack.schemaVersion)}`,
    })
  }
  if (typeof pack.packId !== 'string' || !isValidNamespaceKey(pack.packId)) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      evidenceRef: 'packId:invalid',
    })
  }
  if (typeof pack.version !== 'string' || !isValidActionPackVersion(pack.version)) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      evidenceRef: `version:${String(pack.version)}`,
    })
  }
  if (
    typeof pack.title !== 'string' ||
    pack.title.length === 0 ||
    pack.title.length > COMMAND_ACTION_PACK_MAX_TITLE_LENGTH
  ) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      evidenceRef: 'title:invalid',
    })
  }
  if (
    pack.description !== undefined &&
    (typeof pack.description !== 'string' ||
      pack.description.length > COMMAND_ACTION_PACK_MAX_DESCRIPTION_LENGTH)
  ) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      evidenceRef: 'description:invalid',
    })
  }
  if (!Array.isArray(pack.commands)) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      evidenceRef: 'commands:not-an-array',
    })
    return { valid: false, findings: sanitizeFindings(findings) }
  }
  if (pack.commands.length > COMMAND_ACTION_PACK_MAX_COMMANDS) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      evidenceRef: `commands:count=${pack.commands.length}`,
    })
  }

  const seenKeys = new Set<string>()
  for (const cmd of pack.commands) {
    // 1) 复用 pilot contribution 校验（schema/HTML/长度/危险 URL）
    const contributionFindings = validateContribution(cmd as PluginUiCommandContributionV1)
    findings.push(...contributionFindings)

    const contributionKey =
      cmd && typeof cmd === 'object'
        ? String((cmd as unknown as Record<string, unknown>).contributionKey ?? '')
        : ''

    // 2) action ref 封闭集校验（未知 ref）
    const actionKey =
      cmd && typeof cmd === 'object'
        ? String((cmd as unknown as Record<string, unknown>).actionKey ?? '')
        : ''
    if (actionKey && !isCommandActionPackAllowedActionRef(actionKey)) {
      findings.push({
        reason: 'unknown-action-kind',
        severity: 'blocking',
        contributionKey,
        actionKey,
      })
    }

    // 3) 直接写入 action ref（精确黑名单；拒绝整个违规 contribution）
    if (isForbiddenDirectWriteActionRef(actionKey)) {
      findings.push({
        reason: 'effect-not-allowed',
        severity: 'blocking',
        contributionKey,
        actionKey,
        evidenceRef: 'direct-write-action-ref',
      })
    }

    // 4) 冲突 identity（同包重复 contributionKey）
    if (seenKeys.has(contributionKey)) {
      findings.push({
        reason: 'contribution-duplicate',
        severity: 'blocking',
        contributionKey,
        count: 2,
      })
    }
    seenKeys.add(contributionKey)

    // 5) 动作参数完备性（宿主可执行的最小载荷）
    const params =
      cmd && typeof cmd === 'object'
        ? (((cmd as unknown as Record<string, unknown>).actionParams as
            Record<string, string> | undefined) ?? {})
        : {}
    if (actionKey === 'navigate' && !params.route) {
      findings.push({
        reason: 'contribution-schema-invalid',
        severity: 'blocking',
        contributionKey,
        evidenceRef: 'missing-param:route',
      })
    }
    if (actionKey === 'open-form' && !params.formId) {
      findings.push({
        reason: 'contribution-schema-invalid',
        severity: 'blocking',
        contributionKey,
        evidenceRef: 'missing-param:formId',
      })
    }
    if (actionKey === 'open-plugin-action-preview') {
      const ref = params[COMMAND_ACTION_PACK_PREVIEW_REF_KEY]
      if (!ref) {
        findings.push({
          reason: 'contribution-schema-invalid',
          severity: 'blocking',
          contributionKey,
          evidenceRef: `missing-param:${COMMAND_ACTION_PACK_PREVIEW_REF_KEY}`,
        })
      } else if (ref.length > COMMAND_ACTION_PACK_PREVIEW_REF_MAX_LENGTH) {
        findings.push({
          reason: 'contribution-schema-invalid',
          severity: 'blocking',
          contributionKey,
          evidenceRef: `param-value-too-long:${COMMAND_ACTION_PACK_PREVIEW_REF_KEY}`,
        })
      }
    }
  }

  const sorted = sanitizeFindings(findings)
  const hasBlocking = sorted.some((f) => f.severity === 'blocking')
  return {
    valid: !hasBlocking,
    findings: sorted,
    ...(hasBlocking
      ? {}
      : { normalizedPack: normalizeCommandActionPack(raw as CommandActionPackManifestV1) }),
  }
}

// =============================================================================
// 6. release metadata 贡献负载校验（供 install 分派器使用）
// =============================================================================

/**
 * 校验单个 ui-command 贡献负载（release metadata contributions[].payload）。
 * payload 即一条 PluginUiCommandContributionV1；复用包级规则做单条校验。
 */
export function validateUiCommandContributionPayload(
  payload: unknown,
  seamVersion: string = PLUGIN_SEAM_UI_COMMAND_VERSION,
): {
  valid: boolean
  findings: PluginUiCommandFinding[]
  normalizedPayload?: PluginUiCommandContributionV1 & Record<string, unknown>
} {
  if (seamVersion !== PLUGIN_SEAM_UI_COMMAND_VERSION) {
    return {
      valid: false,
      findings: [
        {
          reason: 'contribution-schema-invalid',
          severity: 'blocking',
          evidenceRef: `seamVersion:${seamVersion}`,
        },
      ],
    }
  }
  // 单条贡献按“单命令包”复用包级校验（identity/version 字段以 contribution 自身为准）
  const result = validateCommandActionPack({
    schemaVersion: COMMAND_ACTION_PACK_SCHEMA_VERSION,
    packId: 'single-contribution-check',
    version: '0.0.1',
    title: 'single-contribution-check',
    commands: [payload],
  })
  const relevant = result.findings.filter(
    (f) => f.evidenceRef === undefined || !f.evidenceRef.startsWith('commands:count='),
  )
  const hasBlocking = relevant.some((f) => f.severity === 'blocking')
  if (hasBlocking || !result.normalizedPack) {
    return { valid: false, findings: relevant }
  }
  return {
    valid: true,
    findings: relevant,
    normalizedPayload: result.normalizedPack.commands[0] as
      (PluginUiCommandContributionV1 & Record<string, unknown>) | undefined,
  }
}
