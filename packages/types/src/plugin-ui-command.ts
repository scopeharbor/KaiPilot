/**
 * plugin-ui-command —— V3 插件 UI command contribution 共享契约
 * （纯类型 + 常量 + 类型守卫 + 确定性 normalize/validate/project/sanitize，
 * 零运行时依赖，零网络/IO/时间/随机数依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块（同 @aiproj/types 其他模块）。
 * 测试见 `plugin-ui-command.test.ts`，fixtures 见 `plugin-ui-command-fixtures.ts`。
 *
 * # 语义要点（对应 design.md D2~D8 与 specs/plugin-ui-command-extension-pilot/spec.md）
 * - 三段式契约：contribution → host snapshot → projection result（D2）。
 * - contribution 只声明受限展示元数据与宿主 action reference（D3）。
 * - host snapshot 由宿主生成，禁止客户端 authority 字段（D6）。
 * - 所有函数确定性，不读时钟/随机数/网络/数据库/浏览器（D2）。
 * - reference time 与 trusted scope 只允许显式注入（D2）。
 * - findings 顺序稳定，低敏（D7/D8）。
 */

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** 契约 schema 版本（首版固定 "1"）。 */
export const PLUGIN_UI_COMMAND_SCHEMA_VERSION = '1' as const
export type PluginUiCommandSchemaVersion = typeof PLUGIN_UI_COMMAND_SCHEMA_VERSION

/** contribution surface（首期只允许 Command Palette）。 */
export const PLUGIN_UI_COMMAND_SURFACES = ['command-palette'] as const
export type PluginUiCommandSurface = (typeof PLUGIN_UI_COMMAND_SURFACES)[number]

/**
 * contribution action kind（封闭集）。
 * v3-command-palette-plugin-action-pack 起新增 `open-plugin-action-preview`：
 * 写入型入口唯一允许的 action ref，宿主只打开宿主生成的 action preview，
 * 不等同于提交；直接业务写入仍被类型层禁止。
 */
export const PLUGIN_UI_COMMAND_ACTION_KINDS = [
  'navigate',
  'open-form',
  'open-confirm',
  'open-plugin-action-preview',
] as const
export type PluginUiCommandActionKind = (typeof PLUGIN_UI_COMMAND_ACTION_KINDS)[number]

/** contribution scope kind。 */
export const PLUGIN_UI_COMMAND_SCOPE_KINDS = ['organization', 'project'] as const
export type PluginUiCommandScopeKind = (typeof PLUGIN_UI_COMMAND_SCOPE_KINDS)[number]

/** finding severity。 */
export const PLUGIN_UI_COMMAND_FINDING_SEVERITIES = ['blocking', 'warning', 'info'] as const
export type PluginUiCommandFindingSeverity = (typeof PLUGIN_UI_COMMAND_FINDING_SEVERITIES)[number]

/** finding reason code（稳定低敏码，按字母序）。 */
export const PLUGIN_UI_COMMAND_FINDING_REASONS = [
  'action-not-found',
  'action-scope-denied',
  'contribution-duplicate',
  'contribution-schema-invalid',
  'core-conflict',
  'cross-tenant-denied',
  'dependency-unavailable',
  'digest-mismatch',
  'effect-not-allowed',
  'enabled-instance-missing',
  'grant-escalation',
  'grant-expired',
  'grant-revoked',
  'host-not-ready',
  'host-snapshot-unavailable',
  'icon-not-found',
  'install-not-found',
  'manifest-mismatch',
  'owner-conflict',
  'permission-denied',
  'revision-stale',
  'scope-mismatch',
  'seam-not-compatible',
  'seam-not-ready',
  'unknown-action-kind',
  'unknown-surface',
] as const
export type PluginUiCommandFindingReason = (typeof PLUGIN_UI_COMMAND_FINDING_REASONS)[number]

/** finding reason code priority（升序越低越优先）。 */
const FINDING_REASON_PRIORITY: Record<PluginUiCommandFindingReason, number> = {
  'core-conflict': 10,
  'owner-conflict': 11,
  'contribution-duplicate': 12,
  'contribution-schema-invalid': 20,
  'unknown-surface': 30,
  'unknown-action-kind': 31,
  'action-not-found': 32,
  'effect-not-allowed': 33,
  'icon-not-found': 34,
  'manifest-mismatch': 40,
  'digest-mismatch': 41,
  'install-not-found': 42,
  'enabled-instance-missing': 43,
  'seam-not-compatible': 50,
  'seam-not-ready': 51,
  'host-not-ready': 52,
  'host-snapshot-unavailable': 53,
  'dependency-unavailable': 54,
  'grant-revoked': 60,
  'grant-expired': 61,
  'grant-escalation': 62,
  'scope-mismatch': 70,
  'cross-tenant-denied': 71,
  'permission-denied': 72,
  'action-scope-denied': 73,
  'revision-stale': 80,
}

/** 字段长度上限（防布局退化）。 */
export const PLUGIN_UI_COMMAND_MAX_LABEL_LENGTH = 120
export const PLUGIN_UI_COMMAND_MAX_KEYWORDS = 10
export const PLUGIN_UI_COMMAND_MAX_KEYWORD_LENGTH = 60
export const PLUGIN_UI_COMMAND_MAX_ACTION_PARAMS_KEYS = 8
export const PLUGIN_UI_COMMAND_MAX_ACTION_PARAM_KEY_LENGTH = 40
export const PLUGIN_UI_COMMAND_MAX_ACTION_PARAM_VALUE_LENGTH = 200
export const PLUGIN_UI_COMMAND_MAX_PER_OWNER = 50

// =============================================================================
// 2. 基础类型
// =============================================================================

/**
 * 插件贡献的纯数据声明（首版 V1）。
 * 只包含稳定 identity、受限展示元数据、宿主 action reference、permission keys 与 scope kind。
 * 不引入 React/router 类型。
 */
export interface PluginUiCommandContributionV1 {
  /** schema 版本（固定 "1"）。 */
  version: typeof PLUGIN_UI_COMMAND_SCHEMA_VERSION
  /** 贡献 key（在插件内唯一，字母数字/短横线/下划线，max 80）。 */
  contributionKey: string
  /** 宿主 surface（首期只允许 "command-palette"）。 */
  surface: PluginUiCommandSurface
  /** 中文展示标签。 */
  label: string
  /** 搜索关键词补充（除 label 外的命中词）。 */
  keywords?: string[]
  /** 宿主图标 key（来自 presentation catalog）。 */
  iconKey: string
  /** 宿主 action key（来自 action catalog）。 */
  actionKey: string
  /** action 参数（受限 key/value 字符串 map）。 */
  actionParams?: Record<string, string>
  /** 所需 permission keys（取子集而非扩大）。 */
  requiredPermissions?: string[]
  /** 组织/项目 scope kind。 */
  scopeKind: PluginUiCommandScopeKind
  /** 可选：路由上下文 predicate key（来自宿主 catalog）。 */
  routeContextKey?: string
}

/**
 * 宿主生成的可信资格快照。
 * 由服务端/宿主在注册时组装，客户端只消费不生成。
 */
export interface PluginUiCommandHostSnapshot {
  /** schema 版本。 */
  schemaVersion: typeof PLUGIN_UI_COMMAND_SCHEMA_VERSION
  /** 插件 ID。 */
  pluginId: string
  /** manifest digest（确定性摘要）。 */
  manifestDigest: string
  /** 安装实例 revision（单调递增）。 */
  instanceRevision: string
  /** 安装实例是否 enabled。 */
  enabled: boolean
  /** 安装实例是否 quarantined。 */
  quarantined: boolean
  /** effective grant 的 permission keys（子集）。 */
  effectiveGrantPermissions: string[]
  /** effective grant 过期时间（ISO 8601；null = 不过期）。 */
  effectiveGrantExpiry: string | null
  /** trusted scope。 */
  trustedScope: {
    kind: PluginUiCommandScopeKind
    organizationId: string
    projectId?: string
  }
  /** host-ready seam 名称列表（已验证可用）。 */
  hostReadySeams: string[]
  /** 当前 actor 的 eligibility 证据引用（只读、不包含授权值）。 */
  actorEligibilityRef: string
  /** 宿主生成时间（ISO 8601）。 */
  generatedAt: string
  /** contributions 列表（宿主过滤后的有效贡献）。 */
  contributions: PluginUiCommandContributionV1[]
}

/**
 * projection 结果（accepted / rejected commands + findings）。
 */
export interface PluginUiCommandProjectionResult {
  /** 接受的命令（可注册）。 */
  accepted: PluginUiCommandAcceptedCommand[]
  /** 拒绝/警告 findings。 */
  findings: PluginUiCommandFinding[]
  /** 来源 revision。 */
  sourceRevision: string
  /** 来源 manifest digest。 */
  sourceManifestDigest: string
  /** 投影时间（ISO 8601）。 */
  projectedAt: string
}

/** 已接受的命令（宿主 catalog 映射后的受限数据）。 */
export interface PluginUiCommandAcceptedCommand {
  /** 稳定 ID：ext.plugin.<pluginId>.<contributionKey>。 */
  id: string
  /** 插件 ID。 */
  pluginId: string
  /** 贡献 key。 */
  contributionKey: string
  /** manifest digest。 */
  manifestDigest: string
  /** instance revision。 */
  instanceRevision: string
  /** 展示标签（受限）。 */
  label: string
  /** 展示关键词。 */
  keywords: string[]
  /** 宿主图标 key。 */
  iconKey: string
  /** 宿主 action key。 */
  actionKey: string
  /** action 参数。 */
  actionParams: Record<string, string>
  /** 所需 permission keys（子集）。 */
  requiredPermissions: string[]
  /** scope kind。 */
  scopeKind: PluginUiCommandScopeKind
  /** 路由上下文 predicate key。 */
  routeContextKey?: string
}

/** 投影 finding。 */
export interface PluginUiCommandFinding {
  /** finding reason code。 */
  reason: PluginUiCommandFindingReason
  /** 严重级别。 */
  severity: PluginUiCommandFindingSeverity
  /** 相关插件 ID（可选）。 */
  pluginId?: string
  /** 相关贡献 key（可选）。 */
  contributionKey?: string
  /** 相关 action key（可选）。 */
  actionKey?: string
  /** 相关图标 key（可选；`icon-not-found` 需要它承载证据）。 */
  iconKey?: string
  /** instance revision（可选）。 */
  instanceRevision?: string
  /** 低敏 evidence ref（可选）。 */
  evidenceRef?: string
  /** 计数（可选）。 */
  count?: number
}

// =============================================================================
// 3. 类型守卫
// =============================================================================

/** 类型守卫：合法 contribution key（字母数字/短横线/下划线，max 80）。 */
export function isValidUiCommandContributionKey(key: string): boolean {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(key)
}

/** 类型守卫：合法 plugin ID（字母数字/短横线/下划线，max 80）。 */
export function isValidPluginId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(id)
}

/** 类型守卫：合法 icon key（字母数字/短横线/下划线，max 80）。 */
export function isValidIconKey(key: string): boolean {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(key)
}

/** 类型守卫：合法 action key（字母数字/短横线/下划线，max 80）。 */
export function isValidActionKey(key: string): boolean {
  return /^[a-zA-Z0-9_-]{1,80}$/.test(key)
}

/** 类型守卫：是否为已知 action kind。 */
export function isPluginUiCommandActionKind(kind: string): kind is PluginUiCommandActionKind {
  return (PLUGIN_UI_COMMAND_ACTION_KINDS as readonly string[]).includes(kind)
}

/** 类型守卫：是否为已知 surface。 */
export function isPluginUiCommandSurface(surface: string): surface is PluginUiCommandSurface {
  return (PLUGIN_UI_COMMAND_SURFACES as readonly string[]).includes(surface)
}

/** 类型守卫：是否为已知 finding reason。 */
export function isPluginUiCommandFindingReason(
  reason: string,
): reason is PluginUiCommandFindingReason {
  return (PLUGIN_UI_COMMAND_FINDING_REASONS as readonly string[]).includes(reason)
}

// =============================================================================
// 4. 确定性纯函数
// =============================================================================

/**
 * 稳定排序键（用于 contribution 排序与去重）。
 * key = pluginId + contributionKey（lexicographic）。
 */
export function contributionSortKey(pluginId: string, contributionKey: string): string {
  return `${pluginId}\0${contributionKey}`
}

/**
 * 派生稳定命令 ID：ext.plugin.<pluginId>.<contributionKey>。
 */
export function deriveCommandId(pluginId: string, contributionKey: string): string {
  return `ext.plugin.${pluginId}.${contributionKey}`
}

/**
 * 生成 contribution 的 canonical 稳定序列化（用于 digest / 去重键）。
 * 字段按固定顺序排列，忽略 undefined。
 */
export function contributionCanonical(c: PluginUiCommandContributionV1): string {
  const parts: string[] = [
    `version:${c.version}`,
    `contributionKey:${c.contributionKey}`,
    `surface:${c.surface}`,
    `label:${c.label}`,
    `iconKey:${c.iconKey}`,
    `actionKey:${c.actionKey}`,
    `scopeKind:${c.scopeKind}`,
  ]
  if (c.keywords?.length) {
    parts.push(`keywords:${[...c.keywords].sort().join(',')}`)
  }
  if (c.actionParams) {
    const keys = Object.keys(c.actionParams).sort()
    parts.push(`actionParams:${keys.map((k) => `${k}=${c.actionParams![k]}`).join('&')}`)
  }
  if (c.requiredPermissions?.length) {
    parts.push(`requiredPermissions:${[...c.requiredPermissions].sort().join(',')}`)
  }
  if (c.routeContextKey) {
    parts.push(`routeContextKey:${c.routeContextKey}`)
  }
  return parts.join('|')
}

/** 危险属性名黑名单（禁止可执行内容进入 contribution）。 */
const FORBIDDEN_PROPERTIES = new Set([
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
  'body',
  'payload',
  'token',
  'secret',
  'password',
  'apiKey',
  'authorization',
  'onError',
  'onClick',
  'onLoad',
])

/**
 * 校验单个 contribution 的 schema 合法性。
 * 返回 blocking findings（空数组 = 合法）。
 */
export function validateContribution(c: PluginUiCommandContributionV1): PluginUiCommandFinding[] {
  const findings: PluginUiCommandFinding[] = []

  // 检查危险属性（可执行内容检测）
  const raw = c as unknown as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_PROPERTIES.has(key)) {
      findings.push({
        reason: 'contribution-schema-invalid',
        severity: 'blocking',
        contributionKey: (raw.contributionKey as string) ?? 'unknown',
        evidenceRef: `forbidden-property:${key}`,
      })
    }
    // 检查函数值
    if (typeof raw[key] === 'function') {
      findings.push({
        reason: 'contribution-schema-invalid',
        severity: 'blocking',
        contributionKey: (raw.contributionKey as string) ?? 'unknown',
        evidenceRef: `forbidden-type:function:${key}`,
      })
    }
  }

  // version 校验
  if (c.version !== PLUGIN_UI_COMMAND_SCHEMA_VERSION) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      contributionKey: c.contributionKey,
      evidenceRef: `version:${c.version}`,
    })
  }

  // contributionKey 校验
  if (!isValidUiCommandContributionKey(c.contributionKey)) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      evidenceRef: `contributionKey:${c.contributionKey}`,
    })
  }

  // surface 校验
  if (!isPluginUiCommandSurface(c.surface)) {
    findings.push({
      reason: 'unknown-surface',
      severity: 'blocking',
      contributionKey: c.contributionKey,
      evidenceRef: `surface:${c.surface}`,
    })
  }

  // label 校验
  if (!c.label || c.label.length > PLUGIN_UI_COMMAND_MAX_LABEL_LENGTH) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      contributionKey: c.contributionKey,
      evidenceRef: `label:length=${c.label?.length ?? 0}`,
    })
  }

  // label 不含 HTML 标签
  if (c.label && /<[^>]+>/.test(c.label)) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      contributionKey: c.contributionKey,
      evidenceRef: 'label:contains-html',
    })
  }

  // iconKey 校验
  if (!isValidIconKey(c.iconKey)) {
    findings.push({
      reason: 'icon-not-found',
      severity: 'blocking',
      contributionKey: c.contributionKey,
      evidenceRef: `iconKey:${c.iconKey}`,
    })
  }

  // actionKey 校验
  if (!isValidActionKey(c.actionKey)) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      contributionKey: c.contributionKey,
      evidenceRef: `actionKey:${c.actionKey}`,
    })
  }

  // actionKey 必须是已知 kind
  if (!isPluginUiCommandActionKind(c.actionKey)) {
    findings.push({
      reason: 'unknown-action-kind',
      severity: 'blocking',
      contributionKey: c.contributionKey,
      actionKey: c.actionKey,
    })
  }

  // scopeKind 校验
  if (!PLUGIN_UI_COMMAND_SCOPE_KINDS.includes(c.scopeKind)) {
    findings.push({
      reason: 'contribution-schema-invalid',
      severity: 'blocking',
      contributionKey: c.contributionKey,
      evidenceRef: `scopeKind:${c.scopeKind}`,
    })
  }

  // keywords 校验
  if (c.keywords) {
    if (c.keywords.length > PLUGIN_UI_COMMAND_MAX_KEYWORDS) {
      findings.push({
        reason: 'contribution-schema-invalid',
        severity: 'blocking',
        contributionKey: c.contributionKey,
        evidenceRef: `keywords:count=${c.keywords.length}`,
      })
    }
    for (const kw of c.keywords) {
      if (kw.length > PLUGIN_UI_COMMAND_MAX_KEYWORD_LENGTH) {
        findings.push({
          reason: 'contribution-schema-invalid',
          severity: 'blocking',
          contributionKey: c.contributionKey,
          evidenceRef: `keyword:length=${kw.length}`,
        })
        break
      }
      // keywords 不含 HTML
      if (/<[^>]+>/.test(kw)) {
        findings.push({
          reason: 'contribution-schema-invalid',
          severity: 'blocking',
          contributionKey: c.contributionKey,
          evidenceRef: 'keyword:contains-html',
        })
        break
      }
    }
  }

  // actionParams 校验
  if (c.actionParams) {
    const paramKeys = Object.keys(c.actionParams)
    if (paramKeys.length > PLUGIN_UI_COMMAND_MAX_ACTION_PARAMS_KEYS) {
      findings.push({
        reason: 'contribution-schema-invalid',
        severity: 'blocking',
        contributionKey: c.contributionKey,
        evidenceRef: `actionParams:count=${paramKeys.length}`,
      })
    }
    for (const k of paramKeys) {
      if (k.length > PLUGIN_UI_COMMAND_MAX_ACTION_PARAM_KEY_LENGTH) {
        findings.push({
          reason: 'contribution-schema-invalid',
          severity: 'blocking',
          contributionKey: c.contributionKey,
          evidenceRef: `actionParamKey:length=${k.length}`,
        })
        break
      }
      const v = c.actionParams[k]
      if (v === undefined) continue
      if (v.length > PLUGIN_UI_COMMAND_MAX_ACTION_PARAM_VALUE_LENGTH) {
        findings.push({
          reason: 'contribution-schema-invalid',
          severity: 'blocking',
          contributionKey: c.contributionKey,
          evidenceRef: `actionParamValue:length=${v.length}`,
        })
        break
      }
      // 检查危险 URL 模式
      if (/^javascript:/i.test(v) || /^data:/i.test(v)) {
        findings.push({
          reason: 'contribution-schema-invalid',
          severity: 'blocking',
          contributionKey: c.contributionKey,
          evidenceRef: `actionParamValue:dangerous-url:${k}`,
        })
      }
    }
  }

  return findings
}

/**
 * 确定性 finding 排序（稳定：按 reason priority → pluginId → contributionKey）。
 */
export function sortFindings(findings: PluginUiCommandFinding[]): PluginUiCommandFinding[] {
  return [...findings].sort((a, b) => {
    const pa = FINDING_REASON_PRIORITY[a.reason] ?? 999
    const pb = FINDING_REASON_PRIORITY[b.reason] ?? 999
    if (pa !== pb) return pa - pb
    if (a.pluginId !== b.pluginId) return (a.pluginId ?? '').localeCompare(b.pluginId ?? '')
    if (a.contributionKey !== b.contributionKey)
      return (a.contributionKey ?? '').localeCompare(b.contributionKey ?? '')
    if (a.severity !== b.severity) return a.severity.localeCompare(b.severity)
    return 0
  })
}

/**
 * contribution normalize/validate + 去重 + 冲突检测 + findings 聚合。
 * 输入：contributions 列表（乱序）+ 所有者信息。
 * 输出：projection result（accepted + findings），确定性。
 */
export function normalizeAndProject(
  contributions: PluginUiCommandContributionV1[],
  pluginId: string,
  manifestDigest: string,
  instanceRevision: string,
  referenceTime: string,
  trustedScope: PluginUiCommandHostSnapshot['trustedScope'],
  hostReadySeams: string[],
  effectiveGrantPermissions: string[],
  effectiveGrantExpiry: string | null,
  enabled: boolean,
  quarantined: boolean,
  /** 已注册的核心命令 ID 集合（防冲突）。 */
  coreCommandIds: Set<string>,
  /** 已注册的其他 owner 命令 ID 集合（防冲突）。 */
  existingOwnerCommandIds: Map<string, Set<string>>,
): PluginUiCommandProjectionResult {
  const findings: PluginUiCommandFinding[] = []
  const accepted: PluginUiCommandAcceptedCommand[] = []

  // 1. 检查 enabled / quarantined
  if (!enabled) {
    findings.push({
      reason: 'enabled-instance-missing',
      severity: 'blocking',
      pluginId,
      evidenceRef: 'enabled:false',
    })
    return {
      accepted: [],
      findings: sortFindings(findings),
      sourceRevision: instanceRevision,
      sourceManifestDigest: manifestDigest,
      projectedAt: referenceTime,
    }
  }
  if (quarantined) {
    findings.push({
      reason: 'enabled-instance-missing',
      severity: 'blocking',
      pluginId,
      evidenceRef: 'quarantined:true',
    })
    return {
      accepted: [],
      findings: sortFindings(findings),
      sourceRevision: instanceRevision,
      sourceManifestDigest: manifestDigest,
      projectedAt: referenceTime,
    }
  }

  // 2. 检查 grant expiry
  if (effectiveGrantExpiry && effectiveGrantExpiry < referenceTime) {
    findings.push({
      reason: 'grant-expired',
      severity: 'blocking',
      pluginId,
      evidenceRef: `grantExpiry:${effectiveGrantExpiry}`,
    })
    return {
      accepted: [],
      findings: sortFindings(findings),
      sourceRevision: instanceRevision,
      sourceManifestDigest: manifestDigest,
      projectedAt: referenceTime,
    }
  }

  // 3. 检查 host-ready seams
  if (hostReadySeams.length === 0) {
    findings.push({
      reason: 'host-not-ready',
      severity: 'blocking',
      pluginId,
      evidenceRef: 'hostReadySeams:empty',
    })
    return {
      accepted: [],
      findings: sortFindings(findings),
      sourceRevision: instanceRevision,
      sourceManifestDigest: manifestDigest,
      projectedAt: referenceTime,
    }
  }

  // 4. 检查 trust scope
  if (trustedScope.kind === 'project' && !trustedScope.projectId) {
    findings.push({
      reason: 'scope-mismatch',
      severity: 'blocking',
      pluginId,
      evidenceRef: 'trustedScope:project-kind-no-project-id',
    })
    return {
      accepted: [],
      findings: sortFindings(findings),
      sourceRevision: instanceRevision,
      sourceManifestDigest: manifestDigest,
      projectedAt: referenceTime,
    }
  }

  // 5. 逐条 validate + project
  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()

  for (const c of contributions) {
    // schema validate
    const schemaFindings = validateContribution(c)
    if (schemaFindings.length > 0) {
      findings.push(...schemaFindings.map((f) => ({ ...f, pluginId })))
      continue
    }

    // contributionKey 重复检测（同 plugin 内）
    if (seenKeys.has(c.contributionKey)) {
      findings.push({
        reason: 'contribution-duplicate',
        severity: 'blocking',
        pluginId,
        contributionKey: c.contributionKey,
        count: 2,
      })
      continue
    }
    seenKeys.add(c.contributionKey)

    // 派生 command ID
    const commandId = deriveCommandId(pluginId, c.contributionKey)

    // 核心命令冲突
    if (coreCommandIds.has(commandId)) {
      findings.push({
        reason: 'core-conflict',
        severity: 'blocking',
        pluginId,
        contributionKey: c.contributionKey,
        evidenceRef: `coreConflict:${commandId}`,
      })
      continue
    }

    // 其他 owner 冲突
    let ownerConflict = false
    for (const [owner, ids] of existingOwnerCommandIds) {
      if (owner !== pluginId && ids.has(commandId)) {
        findings.push({
          reason: 'owner-conflict',
          severity: 'blocking',
          pluginId,
          contributionKey: c.contributionKey,
          evidenceRef: `ownerConflict:${owner}:${commandId}`,
        })
        ownerConflict = true
        break
      }
    }
    if (ownerConflict) continue

    // 重复 ID（同 plugin 内，不应发生因为已去重）
    if (seenIds.has(commandId)) {
      findings.push({
        reason: 'contribution-duplicate',
        severity: 'blocking',
        pluginId,
        contributionKey: c.contributionKey,
      })
      continue
    }
    seenIds.add(commandId)

    // permission 检查
    if (c.requiredPermissions?.length) {
      const missing = c.requiredPermissions.filter((p) => !effectiveGrantPermissions.includes(p))
      if (missing.length > 0) {
        findings.push({
          reason: 'grant-escalation',
          severity: 'blocking',
          pluginId,
          contributionKey: c.contributionKey,
          evidenceRef: `missingPermissions:${missing.join(',')}`,
        })
        continue
      }
    }

    // scope kind 检查（contribution 的 scopeKind 必须 <= trustedScope）
    if (c.scopeKind === 'project' && trustedScope.kind === 'organization') {
      // organization scope 可以包含 project scope commands
    } else if (c.scopeKind !== trustedScope.kind) {
      findings.push({
        reason: 'scope-mismatch',
        severity: 'blocking',
        pluginId,
        contributionKey: c.contributionKey,
        evidenceRef: `scope:${c.scopeKind}:expected:${trustedScope.kind}`,
      })
      continue
    }

    // accepted
    accepted.push({
      id: commandId,
      pluginId,
      contributionKey: c.contributionKey,
      manifestDigest,
      instanceRevision,
      label: c.label,
      keywords: c.keywords ?? [],
      iconKey: c.iconKey,
      actionKey: c.actionKey,
      actionParams: c.actionParams ?? {},
      requiredPermissions: c.requiredPermissions ?? [],
      scopeKind: c.scopeKind,
      routeContextKey: c.routeContextKey,
    })
  }

  return {
    accepted,
    findings: sortFindings(findings),
    sourceRevision: instanceRevision,
    sourceManifestDigest: manifestDigest,
    projectedAt: referenceTime,
  }
}

// =============================================================================
// 5. 低敏 sanitizer
// =============================================================================

/** 敏感键模式（嵌套 key 黑名单）。 */
const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /authorization/i,
  /secret/i,
  /password/i,
  /api[_-]?key/i,
  /credential/i,
  /bearer/i,
]

/** 敏感值模式（值级黑名单）。 */
const SENSITIVE_VALUE_PATTERNS = [
  /^Bearer\s/i,
  /^sk[-_]/i,
  /eyJ[A-Za-z0-9_-]+\.eyJ/, // JWT pattern
]

/**
 * 低敏 finding sanitizer：只保留 reason code、plugin/contribution/action key、
 * revision、计数和低敏 evidence refs，拒绝原始 metadata/异常对象。
 */
export function sanitizeFinding(finding: PluginUiCommandFinding): PluginUiCommandFinding {
  const sanitized: PluginUiCommandFinding = {
    reason: finding.reason,
    severity: finding.severity,
  }
  if (finding.pluginId) sanitized.pluginId = finding.pluginId
  if (finding.contributionKey) sanitized.contributionKey = finding.contributionKey
  if (finding.actionKey) sanitized.actionKey = finding.actionKey
  if (finding.instanceRevision) sanitized.instanceRevision = finding.instanceRevision
  if (finding.count !== undefined) sanitized.count = finding.count
  if (finding.evidenceRef) {
    // 对 evidenceRef 做敏感模式过滤
    const ref = finding.evidenceRef
    const isSensitive =
      SENSITIVE_KEY_PATTERNS.some((p) => p.test(ref)) ||
      SENSITIVE_VALUE_PATTERNS.some((p) => p.test(ref))
    sanitized.evidenceRef = isSensitive ? '[REDACTED]' : ref
  }
  return sanitized
}

/**
 * 批量 sanitize findings。
 */
export function sanitizeFindings(findings: PluginUiCommandFinding[]): PluginUiCommandFinding[] {
  return findings.map(sanitizeFinding)
}

/**
 * 检查任意对象是否包含敏感键。
 */
export function containsSensitiveKeys(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEY_PATTERNS.some((p) => p.test(key))) {
      return true
    }
    const val = obj[key]
    if (typeof val === 'string' && SENSITIVE_VALUE_PATTERNS.some((p) => p.test(val))) {
      return true
    }
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      if (containsSensitiveKeys(val as Record<string, unknown>)) {
        return true
      }
    }
  }
  return false
}
