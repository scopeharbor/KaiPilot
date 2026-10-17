/**
 * plugin-event-subscription-contract —— V3 插件平台内部事件订阅共享契约
 * （纯类型 + 宿主持有事件目录 + 封闭 filter AST + 最小 envelope + 幂等 delivery identity +
 *  三类响应边界 validator + 稳定 digest + 低敏二次扫描；零运行时依赖、零网络/IO/时间/随机数依赖）。
 *
 * 对应 change：openspec/changes/v3-plugin-event-subscription-contract（design.md D1~D5）。
 *
 * # 语义要点
 * - D1 事件目录由宿主代码维护并版本化：插件 manifest 只能引用目录 identity（type+version），
 *   未知类型/版本/字段一律 fail closed；目录声明 scope kind、required permission、投影 allowlist。
 * - D3 订阅过滤器是封闭 AST：仅 `eq|in|changed` 三操作符 + definition allowlist 字段 +
 *   节点/值上限；正则、脚本、SQL、自由表达式、网络目标一律 blocking；normalize 后 digest 确定性。
 * - envelope 最小化：只含稳定 event identity、type/version、发生时间、organization/project 引用、
 *   allowlist 有界摘要与 provenance；不可访问实体的名称/数量/ID/hash 不进入 envelope。
 * - delivery identity：fnv1a(org|pluginId|pluginVersion|subscriptionDigest|eventId) 确定性派生；
 *   recorder 按 identity 唯一 → 重试幂等，最多一个有效建议记录。
 * - 响应仅允许 `observation | advisory-draft | action-proposal`；直接写入指令、递归工作流、
 *   外部动作、超大响应一律拒绝；action-proposal 只能交给宿主 preview/confirm 边界。
 */

// =============================================================================
// 1. 常量与封闭词表
// =============================================================================

/** 接缝 key（curated catalog 同步登记）。 */
export const PLUGIN_SEAM_EVENT_SUBSCRIPTION = 'event-subscription.internal-events' as const

/** 接缝版本。 */
export const PLUGIN_EVENT_SUBSCRIPTION_SEAM_VERSION = '1.0.0'

/** 订阅声明 schema 版本。 */
export const PLUGIN_EVENT_SUBSCRIPTION_DECLARATION_VERSION = 'plugin-event-subscription-v1'

/** envelope schema 版本。 */
export const PLUGIN_EVENT_ENVELOPE_SCHEMA_VERSION = 'plugin-event-envelope-v1'

/** 响应 schema 版本。 */
export const PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION = 'plugin-event-response-v1'

/** 允许的响应类别（封闭三值）。 */
export const PLUGIN_EVENT_RESPONSE_KINDS = [
  'observation',
  'advisory-draft',
  'action-proposal',
] as const
export type PluginEventResponseKind = (typeof PLUGIN_EVENT_RESPONSE_KINDS)[number]

export function isPluginEventResponseKind(v: unknown): v is PluginEventResponseKind {
  return typeof v === 'string' && (PLUGIN_EVENT_RESPONSE_KINDS as readonly string[]).includes(v)
}

/** 过滤器操作符（封闭三值）。 */
export const PLUGIN_EVENT_FILTER_OPS = ['eq', 'in', 'changed'] as const
export type PluginEventFilterOp = (typeof PLUGIN_EVENT_FILTER_OPS)[number]

/** 目录条目兼容策略（首期仅 same-major）。 */
export const PLUGIN_EVENT_COMPATIBILITY_POLICIES = ['same-major'] as const

/** finding code 封闭集。 */
export const PLUGIN_EVENT_FINDING_CODES = [
  'plugin-event-schema-invalid',
  'plugin-event-unknown-type',
  'plugin-event-unknown-version',
  'plugin-event-unknown-field',
  'plugin-event-filter-op-forbidden',
  'plugin-event-filter-limit-exceeded',
  'plugin-event-scope-mismatch',
  'plugin-event-response-kind-forbidden',
  'plugin-event-incompatible-version',
  'plugin-event-network-target-forbidden',
  'plugin-event-secret-detected',
  'plugin-event-direct-write-forbidden',
  'plugin-event-recursion-forbidden',
  'plugin-event-external-action-forbidden',
  'plugin-event-oversized',
] as const
export type PluginEventFindingCode = (typeof PLUGIN_EVENT_FINDING_CODES)[number]

export interface PluginEventFinding {
  code: PluginEventFindingCode
  severity: 'info' | 'warning' | 'blocking'
  path?: string
  message: string
}

// -----------------------------------------------------------------------------
// 有界常量（超限一律 blocking）
// -----------------------------------------------------------------------------

/** 单插件最大订阅数。 */
export const MAX_EVENT_SUBSCRIPTIONS_PER_PLUGIN = 8

/** 单订阅过滤器最大节点数。 */
export const MAX_EVENT_FILTER_NODES = 8

/** `in` 操作符最大值个数。 */
export const MAX_EVENT_FILTER_VALUES = 16

/** 过滤器单值最大字符数。 */
export const MAX_EVENT_FILTER_VALUE_CHARS = 64

/** 字段名最大字符数。 */
export const MAX_EVENT_FIELD_NAME_CHARS = 64

/** envelope 投影字段数上限。 */
export const MAX_EVENT_PROJECTION_FIELDS = 8

/** envelope 投影单值字符上限。 */
export const MAX_EVENT_PROJECTION_VALUE_CHARS = 200

/** 声明 payload 最大字节数。 */
export const MAX_EVENT_DECLARATION_BYTES = 8192

/** 响应 payload 最大字节数。 */
export const MAX_EVENT_RESPONSE_BYTES = 16384

/** observation note / advisory 文本字符上限。 */
export const MAX_EVENT_RESPONSE_TEXT_CHARS = 1000

/** 组织级 outbox/delivery 保留行数上限（宿主有界清理）。 */
export const MAX_EVENT_DELIVERY_ROWS_PER_ORG = 500

/** 过滤器/文本禁止内容 token（脚本、SQL、正则元序列、网络目标；大小写不敏感匹配）。 */
export const PLUGIN_EVENT_FORBIDDEN_TOKENS = [
  'function',
  '=>',
  'eval(',
  'new date(',
  'require(',
  'import ',
  'select ',
  'insert ',
  'update ',
  'delete from',
  'drop table',
  'union select',
  '--',
  '/*',
  '*/',
  ';',
  '${',
  '`',
  'http://',
  'https://',
  'ftp://',
  'ws://',
  'wss://',
  '.exec(',
  'new regexp',
  '\\',
] as const

// =============================================================================
// 2. 低敏工具：稳定序列化 + fnv1a hash
// =============================================================================

/** 键序稳定的 JSON 序列化（对象键排序；数组保序；undefined 剔除）。 */
export function eventStableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => eventStableSerialize(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${eventStableSerialize(v)}`).join(',')}}`
}

/** fnv1a 32-bit hash（hex 8 位）。 */
export function eventFnv1aHash(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

// =============================================================================
// 3. 事件目录（D1：宿主持有，版本化，封闭）
// =============================================================================

/** 一条宿主事件定义。 */
export interface PluginEventDefinition {
  /** 事件类型（稳定 kebab/dot 标识）。 */
  eventType: string
  /** 事件 SemVer。 */
  eventVersion: string
  /** 来源族（低敏 provenance 用）。 */
  sourceFamily: 'project-activity'
  /** scope kind：envelope 必带 organizationId；project 事件必带 projectId。 */
  scopeKind: 'organization' | 'project'
  /** 交付前宿主必须复核的最低权限（对安装 grant 复核）。 */
  requiredPermission: string
  /** 过滤器允许的字段（allowlist；eq/in 使用）。 */
  filterFields: readonly string[]
  /** `changed` 操作符允许监听的实体字段名（allowlist；与投影解耦）。 */
  changedFilterFields?: readonly string[]
  /** envelope 投影允许的字段（allowlist）。 */
  projectionFields: readonly string[]
  /** 该事件允许插件返回的响应类别。 */
  allowedResponseKinds: readonly PluginEventResponseKind[]
  compatibility: 'same-major'
  description: string
}

/**
 * 首批 pilot 目录（迁移计划第 2 步：一个只读项目事件 pilot；
 * 未通过全门禁前不开放其他事件类型）。
 */
export const PLUGIN_EVENT_CATALOG: readonly PluginEventDefinition[] = [
  {
    eventType: 'project.task.updated',
    eventVersion: '1.0.0',
    sourceFamily: 'project-activity',
    scopeKind: 'project',
    requiredPermission: 'project:view',
    filterFields: ['entityAction', 'changedFields'],
    changedFilterFields: [
      'status',
      'priority',
      'assigneeId',
      'startDate',
      'endDate',
      'progressPercent',
      'estimatedHours',
      'dueDate',
    ],
    projectionFields: ['entityAction', 'changedFields'],
    allowedResponseKinds: ['observation', 'advisory-draft', 'action-proposal'],
    compatibility: 'same-major',
    description:
      '项目任务发生变化（创建/更新/状态变化）后的只读通知；投影只含动作动词与变更字段名列表。',
  },
]

/** 按类型+版本查找目录条目；未知返回 undefined。 */
export function lookupPluginEventDefinition(
  eventType: string,
  eventVersion: string,
): PluginEventDefinition | undefined {
  return PLUGIN_EVENT_CATALOG.find(
    (e) => e.eventType === eventType && e.eventVersion === eventVersion,
  )
}

// =============================================================================
// 4. 订阅声明与过滤器 AST（D3）
// =============================================================================

/** 过滤器节点（封闭判别联合）。 */
export type PluginEventFilterNode =
  | { op: 'eq'; field: string; value: string | number | boolean }
  | { op: 'in'; field: string; values: ReadonlyArray<string | number> }
  | { op: 'changed'; field: string }

/** 插件在 manifest contribution 中声明的单个订阅。 */
export interface PluginEventSubscriptionDeclaration {
  eventType: string
  eventVersion: string
  /** 该订阅可能产生的响应类别（缺省 ['observation']；超出目录 allowedResponseKinds → blocking）。 */
  responseKinds?: readonly PluginEventResponseKind[]
  /** 可选过滤器（节点或节点数组；全部必须命中才交付）。 */
  filter?: PluginEventFilterNode | PluginEventFilterNode[]
}

/** manifest contribution 负载形状（seam=event-subscription.internal-events）。 */
export interface PluginEventSubscriptionPayload {
  subscriptions: readonly PluginEventSubscriptionDeclaration[]
}

/** 归一化后的订阅（宿主与 dispatcher 共用）。 */
export interface NormalizedPluginEventSubscription {
  eventType: string
  eventVersion: string
  responseKinds: PluginEventResponseKind[]
  filterNodes: PluginEventFilterNode[]
  /** 归一化声明的稳定 digest（delivery identity 输入之一）。 */
  subscriptionDigest: string
}

export interface NormalizedPluginEventSubscriptionPayload {
  subscriptions: NormalizedPluginEventSubscription[]
  /** 全部订阅归一化后的整体 digest。 */
  payloadDigest: string
}

/** 单个订阅 digest：normalize（排序去重）后 stable serialize + fnv1a。 */
export function computePluginEventSubscriptionDigest(
  subscription:
    | NormalizedPluginEventSubscription
    | Omit<NormalizedPluginEventSubscription, 'subscriptionDigest'>,
): string {
  const nodes = [...subscription.filterNodes].map((n) => eventStableSerialize(n)).sort()
  const kinds = [...subscription.responseKinds].sort()
  return eventFnv1aHash(
    eventStableSerialize({
      eventType: subscription.eventType,
      eventVersion: subscription.eventVersion,
      responseKinds: kinds,
      filterNodes: nodes,
    }),
  )
}

/** 整体 payload digest。 */
export function computePluginEventPayloadDigest(
  payload: NormalizedPluginEventSubscriptionPayload,
): string {
  const digests = payload.subscriptions.map((s) => s.subscriptionDigest).sort()
  return eventFnv1aHash(eventStableSerialize({ subscriptions: digests }))
}

/** 禁止内容扫描（脚本/SQL/正则/网络目标；大小写不敏感）。 */
export function pluginEventContainsForbiddenToken(text: string): boolean {
  const lowered = text.toLowerCase()
  return (PLUGIN_EVENT_FORBIDDEN_TOKENS as readonly string[]).some((token) =>
    lowered.includes(token),
  )
}

/** 校验过滤器字段名：非空字符串、长度上限、无禁止内容。 */
function validateFilterFieldName(
  field: unknown,
  path: string,
  findings: PluginEventFinding[],
): field is string {
  if (typeof field !== 'string' || !field.trim()) {
    findings.push({
      code: 'plugin-event-schema-invalid',
      severity: 'blocking',
      path,
      message: 'filter field must be a non-empty string',
    })
    return false
  }
  if (field.length > MAX_EVENT_FIELD_NAME_CHARS) {
    findings.push({
      code: 'plugin-event-filter-limit-exceeded',
      severity: 'blocking',
      path,
      message: `filter field exceeds ${MAX_EVENT_FIELD_NAME_CHARS} chars`,
    })
    return false
  }
  if (pluginEventContainsForbiddenToken(field)) {
    findings.push({
      code: 'plugin-event-filter-op-forbidden',
      severity: 'blocking',
      path,
      message: 'filter field contains forbidden script/sql/regex/network content',
    })
    return false
  }
  return true
}

/** 校验标量过滤值（字符串需过禁止内容与长度；数值需有限；布尔直通）。 */
function validateFilterValue(
  value: unknown,
  path: string,
  findings: PluginEventFinding[],
): value is string | number | boolean {
  if (typeof value === 'boolean') return true
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      findings.push({
        code: 'plugin-event-schema-invalid',
        severity: 'blocking',
        path,
        message: 'filter numeric value must be finite',
      })
      return false
    }
    return true
  }
  if (typeof value === 'string') {
    if (value.length > MAX_EVENT_FILTER_VALUE_CHARS) {
      findings.push({
        code: 'plugin-event-filter-limit-exceeded',
        severity: 'blocking',
        path,
        message: `filter value exceeds ${MAX_EVENT_FILTER_VALUE_CHARS} chars`,
      })
      return false
    }
    if (pluginEventContainsForbiddenToken(value)) {
      findings.push({
        code: 'plugin-event-filter-op-forbidden',
        severity: 'blocking',
        path,
        message: 'filter value contains forbidden script/sql/regex/network content',
      })
      return false
    }
    return true
  }
  findings.push({
    code: 'plugin-event-schema-invalid',
    severity: 'blocking',
    path,
    message: 'filter value must be string | number | boolean',
  })
  return false
}

/** 校验并归一化单个过滤器节点（未知 op → blocking）。 */
function normalizeFilterNode(
  raw: unknown,
  def: PluginEventDefinition,
  path: string,
  findings: PluginEventFinding[],
): PluginEventFilterNode | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    findings.push({
      code: 'plugin-event-schema-invalid',
      severity: 'blocking',
      path,
      message: 'filter node must be an object',
    })
    return null
  }
  const node = raw as Record<string, unknown>
  const keys = Object.keys(node).sort()
  const allowedKeys = ['field', 'op', 'value', 'values']
  if (!keys.every((k) => allowedKeys.includes(k))) {
    findings.push({
      code: 'plugin-event-filter-op-forbidden',
      severity: 'blocking',
      path,
      message: `filter node has unknown keys: ${keys.filter((k) => !allowedKeys.includes(k)).join(',')}`,
    })
    return null
  }
  switch (node.op) {
    case 'eq': {
      if (!validateFilterFieldName(node.field, `${path}.field`, findings)) return null
      if (!(node.field in buildFilterFieldAllowlist(def))) {
        findings.push({
          code: 'plugin-event-unknown-field',
          severity: 'blocking',
          path: `${path}.field`,
          message: `filter field not allowlisted for ${def.eventType}`,
        })
        return null
      }
      if (!('value' in node) || !validateFilterValue(node.value, `${path}.value`, findings))
        return null
      return { op: 'eq', field: node.field, value: node.value }
    }
    case 'in': {
      if (!validateFilterFieldName(node.field, `${path}.field`, findings)) return null
      if (!(node.field in buildFilterFieldAllowlist(def))) {
        findings.push({
          code: 'plugin-event-unknown-field',
          severity: 'blocking',
          path: `${path}.field`,
          message: `filter field not allowlisted for ${def.eventType}`,
        })
        return null
      }
      if (!Array.isArray(node.values) || node.values.length === 0) {
        findings.push({
          code: 'plugin-event-schema-invalid',
          severity: 'blocking',
          path: `${path}.values`,
          message: 'in filter requires a non-empty values array',
        })
        return null
      }
      if (node.values.length > MAX_EVENT_FILTER_VALUES) {
        findings.push({
          code: 'plugin-event-filter-limit-exceeded',
          severity: 'blocking',
          path: `${path}.values`,
          message: `in filter exceeds ${MAX_EVENT_FILTER_VALUES} values`,
        })
        return null
      }
      const values: Array<string | number> = []
      let ok = true
      for (let i = 0; i < node.values.length; i++) {
        if (!validateFilterValue(node.values[i], `${path}.values[${i}]`, findings)) {
          ok = false
          continue
        }
        if (typeof node.values[i] === 'boolean') {
          findings.push({
            code: 'plugin-event-schema-invalid',
            severity: 'blocking',
            path: `${path}.values[${i}]`,
            message: 'in filter values must be string | number',
          })
          ok = false
          continue
        }
        values.push(node.values[i] as string | number)
      }
      return ok ? { op: 'in', field: node.field, values } : null
    }
    case 'changed': {
      if (!validateFilterFieldName(node.field, `${path}.field`, findings)) return null
      const changedAllowlist = buildFilterFieldAllowlist({
        ...def,
        filterFields: def.changedFilterFields ?? def.filterFields,
      })
      if (!(node.field in changedAllowlist)) {
        findings.push({
          code: 'plugin-event-unknown-field',
          severity: 'blocking',
          path: `${path}.field`,
          message: `changed filter field not allowlisted for ${def.eventType}`,
        })
        return null
      }
      return { op: 'changed', field: node.field }
    }
    default:
      findings.push({
        code: 'plugin-event-filter-op-forbidden',
        severity: 'blocking',
        path: `${path}.op`,
        message:
          'filter op must be one of eq | in | changed (closed AST; regex/script/free expressions rejected)',
      })
      return null
  }
}

/** definition filterFields → allowlist 索引。 */
function buildFilterFieldAllowlist(def: PluginEventDefinition): Record<string, true> {
  const index: Record<string, true> = {}
  for (const f of def.filterFields) index[f] = true
  return index
}

/** SemVer same-major 兼容判定（请求版本不得高于目录版本）。 */
export function checkPluginEventVersionCompatibility(
  requestedVersion: string,
  catalogVersion: string,
): { compatible: boolean; reason: string } {
  const parse = (v: string): number[] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const req = parse(requestedVersion)
  const cat = parse(catalogVersion)
  if (!req || !cat) {
    return { compatible: false, reason: 'invalid-version' }
  }
  const [reqMajor = 0, reqMinor = 0, reqPatch = 0] = req
  const [catMajor = 0, catMinor = 0, catPatch = 0] = cat
  if (reqMajor !== catMajor) {
    return { compatible: false, reason: 'major-mismatch' }
  }
  if (reqMinor > catMinor || (reqMinor === catMinor && reqPatch > catPatch)) {
    return { compatible: false, reason: 'requested-future' }
  }
  return { compatible: true, reason: 'compatible-same-major' }
}

/** 归一化单个订阅声明（含目录校验、responseKinds 校验、digest 计算）。 */
export function normalizePluginEventSubscription(
  declaration: PluginEventSubscriptionDeclaration,
  findings: PluginEventFinding[],
  path = 'subscription',
): NormalizedPluginEventSubscription | null {
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
    findings.push({
      code: 'plugin-event-schema-invalid',
      severity: 'blocking',
      path,
      message: 'subscription declaration must be an object',
    })
    return null
  }
  const knownKeys = ['eventType', 'eventVersion', 'responseKinds', 'filter']
  for (const key of Object.keys(declaration)) {
    if (!knownKeys.includes(key)) {
      findings.push({
        code: 'plugin-event-schema-invalid',
        severity: 'blocking',
        path: `${path}.${key}`,
        message: `unknown subscription field: ${key}`,
      })
    }
  }
  if (typeof declaration.eventType !== 'string') {
    findings.push({
      code: 'plugin-event-schema-invalid',
      severity: 'blocking',
      path: `${path}.eventType`,
      message: 'eventType must be a string',
    })
    return null
  }
  const def = lookupPluginEventDefinition(declaration.eventType, String(declaration.eventVersion))
  if (!def) {
    const typeExists = PLUGIN_EVENT_CATALOG.some((e) => e.eventType === declaration.eventType)
    findings.push({
      code: typeExists ? 'plugin-event-unknown-version' : 'plugin-event-unknown-type',
      severity: 'blocking',
      path: typeExists ? `${path}.eventVersion` : `${path}.eventType`,
      message: typeExists
        ? `event version not registered: ${declaration.eventType}@${String(declaration.eventVersion)}`
        : `event type not registered: ${declaration.eventType}`,
    })
    return null
  }
  const compat = checkPluginEventVersionCompatibility(
    String(declaration.eventVersion),
    def.eventVersion,
  )
  if (!compat.compatible) {
    findings.push({
      code: 'plugin-event-incompatible-version',
      severity: 'blocking',
      path: `${path}.eventVersion`,
      message: `incompatible event version (${compat.reason})`,
    })
    return null
  }

  // responseKinds：缺省 ['observation']；必须是封闭子集且不越目录 allowedResponseKinds
  let responseKinds: PluginEventResponseKind[] = ['observation']
  if (declaration.responseKinds !== undefined) {
    if (
      !Array.isArray(declaration.responseKinds) ||
      declaration.responseKinds.length === 0 ||
      declaration.responseKinds.length > PLUGIN_EVENT_RESPONSE_KINDS.length
    ) {
      findings.push({
        code: 'plugin-event-schema-invalid',
        severity: 'blocking',
        path: `${path}.responseKinds`,
        message: 'responseKinds must be a non-empty array of known kinds',
      })
      return null
    }
    const normalized: PluginEventResponseKind[] = []
    for (let i = 0; i < declaration.responseKinds.length; i++) {
      const kind = declaration.responseKinds[i]
      if (!isPluginEventResponseKind(kind)) {
        findings.push({
          code: 'plugin-event-schema-invalid',
          severity: 'blocking',
          path: `${path}.responseKinds[${i}]`,
          message: `unknown response kind: ${String(kind)}`,
        })
        return null
      }
      if (!def.allowedResponseKinds.includes(kind)) {
        findings.push({
          code: 'plugin-event-response-kind-forbidden',
          severity: 'blocking',
          path: `${path}.responseKinds[${i}]`,
          message: `response kind not allowed for ${def.eventType}: ${kind}`,
        })
        return null
      }
      if (!normalized.includes(kind)) normalized.push(kind)
    }
    responseKinds = normalized.sort()
  }

  // filter：节点或数组；上限 MAX_EVENT_FILTER_NODES
  const filterNodes: PluginEventFilterNode[] = []
  if (declaration.filter !== undefined && declaration.filter !== null) {
    const rawNodes = Array.isArray(declaration.filter) ? declaration.filter : [declaration.filter]
    if (rawNodes.length > MAX_EVENT_FILTER_NODES) {
      findings.push({
        code: 'plugin-event-filter-limit-exceeded',
        severity: 'blocking',
        path: `${path}.filter`,
        message: `filter exceeds ${MAX_EVENT_FILTER_NODES} nodes`,
      })
      return null
    }
    for (let i = 0; i < rawNodes.length; i++) {
      const node = normalizeFilterNode(rawNodes[i], def, `${path}.filter[${i}]`, findings)
      if (!node) return null
      filterNodes.push(node)
    }
  }

  const partial: Omit<NormalizedPluginEventSubscription, 'subscriptionDigest'> = {
    eventType: def.eventType,
    eventVersion: def.eventVersion,
    responseKinds,
    filterNodes,
  }
  return { ...partial, subscriptionDigest: computePluginEventSubscriptionDigest(partial) }
}

/**
 * 校验并归一化整个 manifest contribution 负载（dispatcher 入口）。
 * fail closed：任何 blocking finding → valid=false 且不返回归一化结果。
 */
export function validatePluginEventSubscriptionPayload(payload: unknown): {
  valid: boolean
  findings: PluginEventFinding[]
  normalizedPayload?: NormalizedPluginEventSubscriptionPayload
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      findings: [
        {
          code: 'plugin-event-schema-invalid',
          severity: 'blocking',
          path: 'payload',
          message: 'payload must be a JSON object',
        },
      ],
    }
  }
  const serialized = eventStableSerialize(payload)
  if (serialized.length > MAX_EVENT_DECLARATION_BYTES) {
    return {
      valid: false,
      findings: [
        {
          code: 'plugin-event-oversized',
          severity: 'blocking',
          path: 'payload',
          message: `payload exceeds ${MAX_EVENT_DECLARATION_BYTES} bytes`,
        },
      ],
    }
  }
  const raw = payload as Record<string, unknown>
  const findings: PluginEventFinding[] = []
  for (const key of Object.keys(raw)) {
    if (key !== 'subscriptions') {
      findings.push({
        code: 'plugin-event-schema-invalid',
        severity: 'blocking',
        path: `payload.${key}`,
        message: `unknown payload field: ${key}`,
      })
    }
  }
  if (!Array.isArray(raw.subscriptions) || raw.subscriptions.length === 0) {
    findings.push({
      code: 'plugin-event-schema-invalid',
      severity: 'blocking',
      path: 'payload.subscriptions',
      message: 'subscriptions must be a non-empty array',
    })
    return { valid: false, findings }
  }
  if (raw.subscriptions.length > MAX_EVENT_SUBSCRIPTIONS_PER_PLUGIN) {
    findings.push({
      code: 'plugin-event-filter-limit-exceeded',
      severity: 'blocking',
      path: 'payload.subscriptions',
      message: `exceeds ${MAX_EVENT_SUBSCRIPTIONS_PER_PLUGIN} subscriptions per plugin`,
    })
    return { valid: false, findings }
  }

  // 低敏二次扫描：secret/token/网络描述
  scanForSensitiveMaterial(raw.subscriptions, 'payload.subscriptions', findings)

  const subscriptions: NormalizedPluginEventSubscription[] = []
  for (let i = 0; i < raw.subscriptions.length; i++) {
    const normalized = normalizePluginEventSubscription(
      raw.subscriptions[i] as PluginEventSubscriptionDeclaration,
      findings,
      `payload.subscriptions[${i}]`,
    )
    if (!normalized) {
      return { valid: false, findings }
    }
    subscriptions.push(normalized)
  }
  if (findings.some((f) => f.severity === 'blocking')) {
    return { valid: false, findings }
  }
  const normalizedPayload: NormalizedPluginEventSubscriptionPayload = {
    subscriptions,
    payloadDigest: computePluginEventPayloadDigest({ subscriptions, payloadDigest: '' }),
  }
  return { valid: true, findings, normalizedPayload }
}

// =============================================================================
// 5. 最小 envelope（宿主构建；allowlist 强制）
// =============================================================================

/**
 * 封闭过滤器匹配（纯函数；宿主 projector/delivery host 共用）。
 * - eq：projection[field] 与 value 宽松相等（字符串化比较，布尔直比）
 * - in：projection[field] 字符串化后 ∈ values
 * - changed：field 出现在 projection.changedFields（逗号连接的字段名列表）中
 * 未知字段一律不匹配（fail closed）。
 */
export function matchPluginEventFilter(
  nodes: readonly PluginEventFilterNode[],
  envelope: Pick<PluginEventEnvelope, 'projection'>,
): boolean {
  const projection = envelope.projection
  const changedList =
    typeof projection.changedFields === 'string' ? projection.changedFields.split(',') : []
  for (const node of nodes) {
    switch (node.op) {
      case 'eq': {
        const actual = projection[node.field]
        if (actual === undefined || actual === null) return false
        if (typeof node.value === 'boolean') {
          if (actual !== node.value) return false
        } else if (String(actual) !== String(node.value)) {
          return false
        }
        break
      }
      case 'in': {
        const actual = projection[node.field]
        if (actual === undefined || actual === null) return false
        const asString = String(actual)
        if (!node.values.some((v) => String(v) === asString)) return false
        break
      }
      case 'changed': {
        if (!changedList.includes(node.field)) return false
        break
      }
      default:
        return false
    }
  }
  return true
}

/** 事件 envelope（交付给插件的唯一数据面）。 */
export interface PluginEventEnvelope {
  schemaVersion: typeof PLUGIN_EVENT_ENVELOPE_SCHEMA_VERSION
  /** 稳定事件 identity（fnv1a 派生；不含原始实体 ID）。 */
  eventId: string
  eventType: string
  eventVersion: string
  occurredAt: string
  organizationId: number
  projectId: number | null
  /** allowlist 有界摘要（字段与取值均经白名单过滤/截断）。 */
  projection: Record<string, string | number | boolean | null>
  provenance: {
    sourceFamily: string
    producerRef: string
  }
}

/** 稳定 eventId：fnv1a(org|type|version|auditLogId)。 */
export function computePluginEventId(input: {
  organizationId: number
  eventType: string
  eventVersion: string
  auditLogId: number
}): string {
  return eventFnv1aHash(
    [input.organizationId, input.eventType, input.eventVersion, input.auditLogId].join('|'),
  )
}

/** 幂等 delivery identity（D4）：fnv1a(org|pluginId|pluginVersion|subscriptionDigest|eventId)。 */
export function computePluginEventDeliveryIdentity(input: {
  organizationId: number
  pluginId: string
  pluginVersion: string
  subscriptionDigest: string
  eventId: string
}): string {
  return eventFnv1aHash(
    [
      input.organizationId,
      input.pluginId,
      input.pluginVersion,
      input.subscriptionDigest,
      input.eventId,
    ].join('|'),
  )
}

/**
 * 构建最小 envelope（纯函数；宿主在核心事务成功后调用）。
 * - candidateProjection 的键不在 definition.projectionFields → 直接丢弃（不泄露）
 * - 值类型仅 string/number/boolean/null；字符串截断到 MAX_EVENT_PROJECTION_VALUE_CHARS
 * - 字段数超过 MAX_EVENT_PROJECTION_FIELDS → 按 allowlist 顺序截断
 */
export function buildPluginEventEnvelope(input: {
  eventType: string
  eventVersion: string
  organizationId: number
  projectId: number | null
  occurredAtIso: string
  auditLogId: number
  producerRef: string
  candidateProjection: Record<string, unknown>
}): PluginEventEnvelope | null {
  const def = lookupPluginEventDefinition(input.eventType, input.eventVersion)
  if (!def) return null
  const projection: Record<string, string | number | boolean | null> = {}
  for (const field of def.projectionFields) {
    if (Object.keys(projection).length >= MAX_EVENT_PROJECTION_FIELDS) break
    if (!(field in input.candidateProjection)) continue
    const value = input.candidateProjection[field]
    if (value === null) {
      projection[field] = null
      continue
    }
    if (typeof value === 'string') {
      projection[field] = value.slice(0, MAX_EVENT_PROJECTION_VALUE_CHARS)
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      projection[field] = value
      continue
    }
    if (typeof value === 'boolean') {
      projection[field] = value
    }
    // 其他类型（object/array/undefined/symbol…）一律丢弃：最小化数据面
  }
  return {
    schemaVersion: PLUGIN_EVENT_ENVELOPE_SCHEMA_VERSION,
    eventId: computePluginEventId({
      organizationId: input.organizationId,
      eventType: input.eventType,
      eventVersion: input.eventVersion,
      auditLogId: input.auditLogId,
    }),
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    occurredAt: input.occurredAtIso,
    organizationId: input.organizationId,
    projectId: input.projectId,
    projection,
    provenance: {
      sourceFamily: def.sourceFamily,
      producerRef: input.producerRef.slice(0, MAX_EVENT_FIELD_NAME_CHARS),
    },
  }
}

// =============================================================================
// 6. 响应边界（observation / advisory-draft / action-proposal）
// =============================================================================

/** handler 响应（封闭判别结构；未知字段/直接写入/递归/外发一律 blocking）。 */
export interface PluginEventResponse {
  schemaVersion: typeof PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION
  kind: PluginEventResponseKind
  /** 必须回传宿主下发的 delivery identity（幂等锚点）。 */
  deliveryIdentity: string
  observation?: { note: string }
  advisoryDraft?: { title: string; body: string }
  actionProposal?: {
    proposalKey: string
    title: string
    summary: string
  }
}

/** 直接写入/执行类禁止键（响应中出现即 blocking）。 */
export const PLUGIN_EVENT_DIRECT_WRITE_KEYS = [
  'execute',
  'executeNow',
  'applyChanges',
  'writeTask',
  'writeProject',
  'mutation',
  'command',
  'sql',
  'query',
] as const

/** 递归工作流类禁止键（继续产生事件/工作流 → blocking）。 */
export const PLUGIN_EVENT_RECURSION_KEYS = [
  'triggerEvent',
  'emitEvent',
  'nextEvent',
  'chainTo',
  'workflow',
  'scheduleEvent',
] as const

/** 外部动作类禁止键（网络目标/provider 调用 → blocking）。 */
export const PLUGIN_EVENT_EXTERNAL_ACTION_KEYS = [
  'webhookUrl',
  'url',
  'endpoint',
  'callbackUrl',
  'providerCall',
  'fetchUrl',
  'httpRequest',
] as const

/** 校验 handler 响应（fail closed）。 */
export function validatePluginEventResponse(
  response: unknown,
  context: {
    /** 该 delivery 的订阅允许的响应类别。 */
    allowedKinds: readonly PluginEventResponseKind[]
    /** 宿主下发的 delivery identity（回传必须一致）。 */
    expectedDeliveryIdentity: string
    /** 事件定义（决定 allowedResponseKinds 上界）。 */
    eventType: string
    eventVersion: string
  },
): { valid: boolean; findings: PluginEventFinding[]; normalized?: PluginEventResponse } {
  const findings: PluginEventFinding[] = []
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return {
      valid: false,
      findings: [
        {
          code: 'plugin-event-schema-invalid',
          severity: 'blocking',
          path: 'response',
          message: 'response must be a JSON object',
        },
      ],
    }
  }
  const serialized = eventStableSerialize(response)
  if (serialized.length > MAX_EVENT_RESPONSE_BYTES) {
    findings.push({
      code: 'plugin-event-oversized',
      severity: 'blocking',
      path: 'response',
      message: `response exceeds ${MAX_EVENT_RESPONSE_BYTES} bytes`,
    })
    return { valid: false, findings }
  }
  const raw = response as Record<string, unknown>

  if (raw.schemaVersion !== PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION) {
    findings.push({
      code: 'plugin-event-schema-invalid',
      severity: 'blocking',
      path: 'response.schemaVersion',
      message: `schemaVersion must be ${PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION}`,
    })
  }
  if (typeof raw.deliveryIdentity !== 'string' || raw.deliveryIdentity.length === 0) {
    findings.push({
      code: 'plugin-event-schema-invalid',
      severity: 'blocking',
      path: 'response.deliveryIdentity',
      message: 'deliveryIdentity is required',
    })
  } else if (raw.deliveryIdentity !== context.expectedDeliveryIdentity) {
    findings.push({
      code: 'plugin-event-schema-invalid',
      severity: 'blocking',
      path: 'response.deliveryIdentity',
      message: 'deliveryIdentity mismatch',
    })
  }

  const def = lookupPluginEventDefinition(context.eventType, context.eventVersion)
  const upperBound = def ? def.allowedResponseKinds : []
  if (!isPluginEventResponseKind(raw.kind)) {
    findings.push({
      code: 'plugin-event-direct-write-forbidden',
      severity: 'blocking',
      path: 'response.kind',
      message:
        'response kind must be observation | advisory-draft | action-proposal; any other shape (direct execution/write instruction) is rejected',
    })
  } else {
    if (!upperBound.includes(raw.kind)) {
      findings.push({
        code: 'plugin-event-response-kind-forbidden',
        severity: 'blocking',
        path: 'response.kind',
        message: `response kind not allowed for ${context.eventType}: ${raw.kind}`,
      })
    }
    if (!context.allowedKinds.includes(raw.kind)) {
      findings.push({
        code: 'plugin-event-response-kind-forbidden',
        severity: 'blocking',
        path: 'response.kind',
        message: `response kind not declared by this subscription: ${raw.kind}`,
      })
    }
  }

  // 禁止键扫描：直接写入 / 递归 / 外部动作
  const allKeys = Object.keys(raw)
  for (const key of allKeys) {
    if (
      [
        'schemaVersion',
        'kind',
        'deliveryIdentity',
        'observation',
        'advisoryDraft',
        'actionProposal',
      ].includes(key)
    ) {
      continue
    }
    const lowered = key.toLowerCase()
    if (
      (PLUGIN_EVENT_DIRECT_WRITE_KEYS as readonly string[]).some((k) => k.toLowerCase() === lowered)
    ) {
      findings.push({
        code: 'plugin-event-direct-write-forbidden',
        severity: 'blocking',
        path: `response.${key}`,
        message: 'direct write/execution instructions are rejected',
      })
    } else if (
      (PLUGIN_EVENT_RECURSION_KEYS as readonly string[]).some((k) => k.toLowerCase() === lowered)
    ) {
      findings.push({
        code: 'plugin-event-recursion-forbidden',
        severity: 'blocking',
        path: `response.${key}`,
        message: 'recursive workflow/event chaining is rejected',
      })
    } else if (
      (PLUGIN_EVENT_EXTERNAL_ACTION_KEYS as readonly string[]).some(
        (k) => k.toLowerCase() === lowered,
      )
    ) {
      findings.push({
        code: 'plugin-event-external-action-forbidden',
        severity: 'blocking',
        path: `response.${key}`,
        message: 'network targets / external actions are rejected (zero-network contract)',
      })
    } else {
      findings.push({
        code: 'plugin-event-schema-invalid',
        severity: 'blocking',
        path: `response.${key}`,
        message: `unknown response field: ${key}`,
      })
    }
  }

  // 分支内容校验
  let normalized: PluginEventResponse | undefined
  const kind = isPluginEventResponseKind(raw.kind) ? raw.kind : null
  if (kind === 'observation') {
    const obs = raw.observation
    if (!obs || typeof obs !== 'object' || Array.isArray(obs)) {
      findings.push({
        code: 'plugin-event-schema-invalid',
        severity: 'blocking',
        path: 'response.observation',
        message: 'observation branch is required for kind=observation',
      })
    } else {
      const note = (obs as Record<string, unknown>).note
      if (typeof note !== 'string' || !note.trim()) {
        findings.push({
          code: 'plugin-event-schema-invalid',
          severity: 'blocking',
          path: 'response.observation.note',
          message: 'note must be a non-empty string',
        })
      } else if (note.length > MAX_EVENT_RESPONSE_TEXT_CHARS) {
        findings.push({
          code: 'plugin-event-oversized',
          severity: 'blocking',
          path: 'response.observation.note',
          message: `note exceeds ${MAX_EVENT_RESPONSE_TEXT_CHARS} chars`,
        })
      } else if (Object.keys(obs as Record<string, unknown>).some((k) => k !== 'note')) {
        findings.push({
          code: 'plugin-event-schema-invalid',
          severity: 'blocking',
          path: 'response.observation',
          message: 'observation allows only "note"',
        })
      } else {
        normalized = {
          schemaVersion: PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION,
          kind,
          deliveryIdentity: String(raw.deliveryIdentity),
          observation: { note },
        }
      }
    }
  } else if (kind === 'advisory-draft') {
    const draft = raw.advisoryDraft
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      findings.push({
        code: 'plugin-event-schema-invalid',
        severity: 'blocking',
        path: 'response.advisoryDraft',
        message: 'advisoryDraft branch is required for kind=advisory-draft',
      })
    } else {
      const d = draft as Record<string, unknown>
      const title = d.title
      const body = d.body
      if (typeof title !== 'string' || !title.trim() || title.length > 200) {
        findings.push({
          code: 'plugin-event-schema-invalid',
          severity: 'blocking',
          path: 'response.advisoryDraft.title',
          message: 'title must be a non-empty string ≤200 chars',
        })
      } else if (typeof body !== 'string' || !body.trim()) {
        findings.push({
          code: 'plugin-event-schema-invalid',
          severity: 'blocking',
          path: 'response.advisoryDraft.body',
          message: 'body must be a non-empty string',
        })
      } else if (body.length > MAX_EVENT_RESPONSE_TEXT_CHARS) {
        findings.push({
          code: 'plugin-event-oversized',
          severity: 'blocking',
          path: 'response.advisoryDraft.body',
          message: `body exceeds ${MAX_EVENT_RESPONSE_TEXT_CHARS} chars`,
        })
      } else if (Object.keys(d).some((k) => k !== 'title' && k !== 'body')) {
        findings.push({
          code: 'plugin-event-schema-invalid',
          severity: 'blocking',
          path: 'response.advisoryDraft',
          message: 'advisoryDraft allows only "title" and "body"',
        })
      } else {
        normalized = {
          schemaVersion: PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION,
          kind,
          deliveryIdentity: String(raw.deliveryIdentity),
          advisoryDraft: { title, body },
        }
      }
    }
  } else if (kind === 'action-proposal') {
    const proposal = raw.actionProposal
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
      findings.push({
        code: 'plugin-event-schema-invalid',
        severity: 'blocking',
        path: 'response.actionProposal',
        message: 'actionProposal branch is required for kind=action-proposal',
      })
    } else {
      const p = proposal as Record<string, unknown>
      const proposalKey = p.proposalKey
      const title = p.title
      const summary = p.summary
      if (typeof proposalKey !== 'string' || !/^[a-z0-9._-]{1,64}$/.test(proposalKey)) {
        findings.push({
          code: 'plugin-event-schema-invalid',
          severity: 'blocking',
          path: 'response.actionProposal.proposalKey',
          message: 'proposalKey must match ^[a-z0-9._-]{1,64}$',
        })
      } else if (typeof title !== 'string' || !title.trim() || title.length > 200) {
        findings.push({
          code: 'plugin-event-schema-invalid',
          severity: 'blocking',
          path: 'response.actionProposal.title',
          message: 'title must be a non-empty string ≤200 chars',
        })
      } else if (typeof summary !== 'string' || !summary.trim()) {
        findings.push({
          code: 'plugin-event-schema-invalid',
          severity: 'blocking',
          path: 'response.actionProposal.summary',
          message: 'summary must be a non-empty string',
        })
      } else if (summary.length > MAX_EVENT_RESPONSE_TEXT_CHARS) {
        findings.push({
          code: 'plugin-event-oversized',
          severity: 'blocking',
          path: 'response.actionProposal.summary',
          message: `summary exceeds ${MAX_EVENT_RESPONSE_TEXT_CHARS} chars`,
        })
      } else if (Object.keys(p).some((k) => !['proposalKey', 'title', 'summary'].includes(k))) {
        findings.push({
          code: 'plugin-event-schema-invalid',
          severity: 'blocking',
          path: 'response.actionProposal',
          message: 'actionProposal allows only proposalKey/title/summary',
        })
      } else {
        normalized = {
          schemaVersion: PLUGIN_EVENT_RESPONSE_SCHEMA_VERSION,
          kind,
          deliveryIdentity: String(raw.deliveryIdentity),
          actionProposal: { proposalKey, title, summary },
        }
      }
    }
  }

  if (findings.some((f) => f.severity === 'blocking')) {
    return { valid: false, findings }
  }
  return { valid: true, findings, normalized }
}

// =============================================================================
// 7. 低敏二次扫描（secret/token/网络目标）
// =============================================================================

const SENSITIVE_KEY_PATTERNS = [
  'token',
  'secret',
  'password',
  'apikey',
  'api_key',
  'authorization',
  'credential',
]

/**
 * 递归扫描声明负载中的敏感材料与网络目标（低敏 finding：只报 path 与 code）。
 */
export function scanForSensitiveMaterial(
  value: unknown,
  path: string,
  findings: PluginEventFinding[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => scanForSensitiveMaterial(item, `${path}[${i}]`, findings))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const lowered = key.toLowerCase()
      if (SENSITIVE_KEY_PATTERNS.some((p) => lowered.includes(p))) {
        findings.push({
          code: 'plugin-event-secret-detected',
          severity: 'blocking',
          path: `${path}.${key}`,
          message: 'sensitive material keys are forbidden in event declarations',
        })
        continue
      }
      if (typeof child === 'string') {
        if (child.includes('://')) {
          findings.push({
            code: 'plugin-event-network-target-forbidden',
            severity: 'blocking',
            path: `${path}.${key}`,
            message: 'network targets are forbidden in event declarations',
          })
        } else if (pluginEventContainsForbiddenToken(child)) {
          findings.push({
            code: 'plugin-event-filter-op-forbidden',
            severity: 'blocking',
            path: `${path}.${key}`,
            message: 'forbidden script/sql/regex content detected in declaration string',
          })
        }
        continue
      }
      scanForSensitiveMaterial(child, `${path}.${key}`, findings)
    }
  }
}
