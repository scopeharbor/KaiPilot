// @aiproj/types — V3 Copilot 插件工具契约（copilot-plugin-tool-contract）
//
// v3-copilot-plugin-tool-contract —— 已安装插件向 Copilot 贡献声明式工具的
// 共享类型与确定性纯函数：contribution 契约、资格快照、核心路由候选接入、
// 结果边界（query sanitizer / advisory draft / write proposal）与低敏 receipt。
//
// 依赖轻量约束：仅依赖本包 plugin-manifest / plugin-capability-seam-catalog /
// copilot-intent-router（纯类型 + 确定性 helpers），无 AdonisJS / React / 数据库 / 网络。
//
// 核心裁决（D1-D5，见 design.md）：
// - D1: `copilot-tool` 为新的 capability seam contribution，字段封闭、schema/digest 确定；
//   实现只引用宿主 adapter key 或已登记 Skill ref，不含代码路径/URL/任意函数。
// - D2: 资格快照从 enabled 安装 ∩ grant ∩ policy ∩ compatibility 投影，digest 绑定四类 revision。
// - D3: 现有 intent router 保留最终选择权；插件工具只是次级候选来源，
//   confidence 受宿主上限约束，冲突走既有 clarification/reason ledger。
// - D4: invocation 统一三类结果边界：query→有界 sanitizer，advisory→draft，write→PluginActionProposal。
// - D5: receipt 低敏：仅 identity/version/status/timing/budget/reference/truncation；
//   参数、完整结果、prompt、token、secret 一律不落账。

import type { ManifestScopeKind } from './plugin-manifest.js'
import { seamFnv1aHash, seamStableSerialize } from './plugin-capability-seam-catalog.js'

// ===========================================================================
// 0. 官方接缝 key 与宿主上限常量
// ===========================================================================

/** copilot-tool 官方接缝 key。 */
export const PLUGIN_SEAM_COPILOT_TOOL = 'copilot-tool.declarative-tool' as const
export type PluginSeamCopilotTool = typeof PLUGIN_SEAM_COPILOT_TOOL

/** 工具 ID 前缀（小写命名空间格式，强制 `ctool_`）。 */
export const COPILOT_TOOL_ID_PREFIX = 'ctool_' as const

/** 单插件贡献内工具数上限。 */
export const MAX_TOOLS_PER_CONTRIBUTION = 10

/** 名称/描述长度上界（简体中文一等公民；描述 ≤512 字符）。 */
export const MAX_TOOL_NAME_LENGTH = 64
export const MAX_TOOL_DESCRIPTION_LENGTH = 512
export const MAX_INTENT_TAG_LENGTH = 48

/** schema 子集规模上界（封闭子集：单层 object + 原始类型属性）。 */
export const MAX_SCHEMA_PROPERTIES = 16
export const MAX_SCHEMA_PROPERTY_NAME_LENGTH = 64
export const SCHEMA_PROPERTY_TYPES = ['string', 'number', 'boolean'] as const
export type CopilotToolSchemaPropertyType = (typeof SCHEMA_PROPERTY_TYPES)[number]

/** 权限引用与 Skill ref 上限。 */
export const MAX_PERMISSIONS_PER_TOOL = 8
export const MAX_SKILL_REFS_PER_TOOL = 4
export const MAX_INTENT_TAGS_PER_TOOL = 8

/** 预算默认与上限。 */
export const DEFAULT_TOOL_RESULT_BUDGET_BYTES = 16 * 1024
export const MAX_TOOL_RESULT_BUDGET_BYTES = 64 * 1024
export const DEFAULT_TOOL_TIMEOUT_MS = 10_000
export const MAX_TOOL_TIMEOUT_MS = 30_000

/**
 * 插件候选置信度宿主上限（D3）：低于 medium band 下界（50），
 * 保证任何核心 destination 在同分排序中恒优先于插件候选。
 */
export const COPILOT_PLUGIN_TOOL_CANDIDATE_CONFIDENCE_CEILING = 45

/** 单次路由注入的插件候选 top-k 上限（上下文成本风险缓解）。 */
export const COPILOT_PLUGIN_TOOL_MAX_CANDIDATES = 3

/** 当前宿主契约版本（compatibility same-major 校验基准）。 */
export const COPILOT_TOOL_HOST_CONTRACT_VERSION = '1.0' as const

// ===========================================================================
// 1. 枚举 — side-effect class / 调用状态 / 拒绝原因 / 排除原因
// ===========================================================================

/** 工具副作用类别（spec Requirement「结果按 side-effect class 受控」）。 */
export const COPILOT_TOOL_SIDE_EFFECT_CLASSES = ['query', 'advisory', 'write'] as const
export type CopilotToolSideEffectClass = (typeof COPILOT_TOOL_SIDE_EFFECT_CLASSES)[number]

export function isCopilotToolSideEffectClass(v: string): v is CopilotToolSideEffectClass {
  return (COPILOT_TOOL_SIDE_EFFECT_CLASSES as readonly string[]).includes(v)
}

/** 插件工具调用状态（含 stale：revision 复核失败的 fail-closed 结果）。 */
export const COPILOT_TOOL_INVOCATION_STATUSES = [
  'success',
  'error',
  'timeout',
  'blocked_unauthorized',
  'blocked_permission',
  'blocked_undeclared',
  'blocked_injection',
  'truncated',
  'stale',
  'budget_exceeded',
] as const
export type CopilotToolInvocationStatus = (typeof COPILOT_TOOL_INVOCATION_STATUSES)[number]

export function isCopilotToolInvocationStatus(v: string): v is CopilotToolInvocationStatus {
  return (COPILOT_TOOL_INVOCATION_STATUSES as readonly string[]).includes(v)
}

/** 快照排除原因码（低敏；仅内部诊断使用，不进入对用户暴露的发现面）。 */
export const COPILOT_TOOL_EXCLUSION_REASONS = [
  'not_installed',
  'disabled',
  'uninstalled',
  'incompatible',
  'invalid_payload',
  'no_permission',
] as const
export type CopilotToolExclusionReason = (typeof COPILOT_TOOL_EXCLUSION_REASONS)[number]

/** 路由拒绝原因码（低敏）。 */
export const COPILOT_PLUGIN_TOOL_DENIAL_REASONS = [
  'tool_not_visible',
  'invoker_permission_denied',
  'cross_organization',
  'cross_project',
  'schema_invalid',
  'budget_exceeded',
  'snapshot_stale',
] as const
export type CopilotPluginToolDenialReason = (typeof COPILOT_PLUGIN_TOOL_DENIAL_REASONS)[number]

// ===========================================================================
// 2. contribution payload 类型（封闭字段集）
// ===========================================================================

/** 封闭 schema 子集：单层 object，属性为原始类型。 */
export interface CopilotToolSchemaSubset {
  /** 固定 "object"。 */
  readonly type: 'object'
  /** 属性定义（键为参数名）。 */
  readonly properties: Readonly<Record<string, CopilotToolSchemaProperty>>
  /** 必填参数名（必须是 properties 的子集）。 */
  readonly required?: readonly string[]
}

export interface CopilotToolSchemaProperty {
  /** 属性类型（封闭三值）。 */
  readonly type: CopilotToolSchemaPropertyType
  /** 中文描述（≤128）。 */
  readonly description?: string
}

/** 权限引用（宿主词表内的 permission key + scope kind）。 */
export interface CopilotToolPermissionRef {
  /** permission key（必须属于宿主封闭词表）。 */
  readonly permissionKey: string
  /** scope kind。 */
  readonly scopeKind: ManifestScopeKind
}

/** 预算声明。 */
export interface CopilotToolBudget {
  /** 单次返回最大字节（≤64KB）。 */
  readonly maxResultBytes: number
  /** 执行超时毫秒（≤30s）。 */
  readonly timeoutMs: number
}

/**
 * copilot-tool contribution 负载（v1）。
 * 纯声明式：不包含代码路径、URL、网络目标、prompt/system instruction 或 secret。
 */
export interface CopilotToolContributionPayloadV1 {
  /** schema 版本（固定 "1.0"）。 */
  readonly schemaVersion: '1.0'
  /** 工具数组。 */
  readonly tools: readonly CopilotToolDeclaration[]
}

/** 单个工具声明。 */
export interface CopilotToolDeclaration {
  /** 工具稳定 ID（`ctool_` 前缀小写命名空间格式）。 */
  readonly toolId: string
  /** 工具版本（完整 SemVer）。 */
  readonly version: string
  /** 中文名称（≤64）。 */
  readonly name: string
  /** 中文描述（≤512）。 */
  readonly description: string
  /** side-effect class。 */
  readonly sideEffectClass: CopilotToolSideEffectClass
  /** 输入 schema 子集。 */
  readonly inputSchema: CopilotToolSchemaSubset
  /** 输出 schema 子集。 */
  readonly outputSchema: CopilotToolSchemaSubset
  /** 所需权限（≤8）。 */
  readonly requiredPermissions: readonly CopilotToolPermissionRef[]
  /** 意图标签（≤8；路由候选映射的次级信号）。 */
  readonly intentTags: readonly string[]
  /** 可选 Skill ref（已登记 Skill 身份，非代码路径）。 */
  readonly skillRefs?: readonly string[]
  /** 预算。 */
  readonly budget: CopilotToolBudget
  /** 宿主兼容性契约版本。 */
  readonly hostContractVersion: string
}

/** 负载校验 finding（封闭错误码）。 */
export const COPILOT_TOOL_FINDING_CODES = [
  'copilot-tool-schema-invalid',
  'copilot-tool-unallowed-field',
  'copilot-tool-injection-detected',
  'copilot-tool-unknown-permission',
  'copilot-tool-unknown-skill-ref',
  'copilot-tool-incompatible-host-contract',
  'copilot-tool-count-limit-exceeded',
  'copilot-tool-size-limit-exceeded',
  'copilot-tool-invalid-id-prefix',
  'copilot-tool-duplicate-tool-id',
  'copilot-tool-write-class-misuse',
] as const
export type CopilotToolFindingCode = (typeof COPILOT_TOOL_FINDING_CODES)[number]

export interface CopilotToolValidationFinding {
  readonly code: CopilotToolFindingCode
  readonly severity: 'info' | 'warning' | 'blocking'
  readonly path: string
  readonly message: string
}

export interface CopilotToolValidationResult {
  readonly valid: boolean
  readonly findings: readonly CopilotToolValidationFinding[]
  readonly normalizedPayload?: CopilotToolContributionPayloadV1
}

/** 校验上下文：宿主注入的已知词表（可选；提供即启用白名单校验）。 */
export interface CopilotToolValidationContext {
  /** 已知 permission keys（宿主封闭词表）。 */
  readonly knownPermissionKeys?: readonly string[]
  /** 已登记 Skill refs。 */
  readonly knownSkillRefs?: readonly string[]
  /** 当前宿主契约版本（same-major 校验）。 */
  readonly hostContractVersion?: string
}

/** 封闭顶层字段集。 */
export const COPILOT_TOOL_PAYLOAD_ALLOWED_FIELDS = ['schemaVersion', 'tools'] as const
export const COPILOT_TOOL_DECLARATION_ALLOWED_FIELDS = [
  'toolId',
  'version',
  'name',
  'description',
  'sideEffectClass',
  'inputSchema',
  'outputSchema',
  'requiredPermissions',
  'intentTags',
  'skillRefs',
  'budget',
  'hostContractVersion',
] as const

/** 注入/越界模式：prompt/system instruction、任意函数、URL、secret（D1 fail-closed）。 */
export const COPILOT_TOOL_INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(system\s*prompt|system\s*instruction|ignore\s+(all\s+)?previous\s+instructions|忽略(之前|以上|所有)的?(指令|提示)|系统提示(词|语)?)\b/i,
  /\b(you\s+must\s+obey|override\s+host\s+instructions|覆盖宿主指令)\b/i,
  /\bfunction\s*\(|=>|\beval\s*\(|new\s+Function\b/,
  /https?:\/\//i,
  /ftp:\/\//i,
  /\b(sk|pk|tk)_[A-Za-z0-9]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]+\b/i,
]

// ===========================================================================
// 3. contribution 校验纯函数（任务 1.2/1.3）
// ===========================================================================

function finding(
  code: CopilotToolFindingCode,
  severity: 'info' | 'warning' | 'blocking',
  path: string,
  message: string,
): CopilotToolValidationFinding {
  return { code, severity, path, message }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function checkInjectionText(
  text: string,
  path: string,
  findings: CopilotToolValidationFinding[],
): void {
  for (const pattern of COPILOT_TOOL_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      findings.push(
        finding(
          'copilot-tool-injection-detected',
          'blocking',
          path,
          `声明文本命中注入/越界模式（prompt/system instruction、函数体、URL 或 secret 形态）`,
        ),
      )
      return
    }
  }
}

function validateSchemaSubset(
  raw: unknown,
  path: string,
  findings: CopilotToolValidationFinding[],
): CopilotToolSchemaSubset | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    findings.push(finding('copilot-tool-schema-invalid', 'blocking', path, 'schema 必须是对象'))
    return null
  }
  const obj = raw as Record<string, unknown>
  for (const k of Object.keys(obj)) {
    if (k !== 'type' && k !== 'properties' && k !== 'required') {
      findings.push(
        finding(
          'copilot-tool-unallowed-field',
          'blocking',
          `${path}.${k}`,
          `schema 子集不允许字段 "${k}"`,
        ),
      )
    }
  }
  if (obj.type !== 'object') {
    findings.push(
      finding(
        'copilot-tool-schema-invalid',
        'blocking',
        `${path}.type`,
        'schema type 必须是 "object"',
      ),
    )
    return null
  }
  if (!obj.properties || typeof obj.properties !== 'object' || Array.isArray(obj.properties)) {
    findings.push(
      finding(
        'copilot-tool-schema-invalid',
        'blocking',
        `${path}.properties`,
        '缺少 properties 对象',
      ),
    )
    return null
  }
  const propEntries = Object.entries(obj.properties as Record<string, unknown>)
  if (propEntries.length > MAX_SCHEMA_PROPERTIES) {
    findings.push(
      finding(
        'copilot-tool-size-limit-exceeded',
        'blocking',
        `${path}.properties`,
        `属性数超过 ${MAX_SCHEMA_PROPERTIES}`,
      ),
    )
  }
  const properties: Record<string, CopilotToolSchemaProperty> = {}
  for (const [name, def] of propEntries) {
    if (name.length > MAX_SCHEMA_PROPERTY_NAME_LENGTH) {
      findings.push(
        finding(
          'copilot-tool-size-limit-exceeded',
          'blocking',
          `${path}.properties.${name}`,
          '属性名超长',
        ),
      )
      continue
    }
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
      findings.push(
        finding(
          'copilot-tool-schema-invalid',
          'blocking',
          `${path}.properties.${name}`,
          '属性定义必须是对象',
        ),
      )
      continue
    }
    const d = def as Record<string, unknown>
    for (const k of Object.keys(d)) {
      if (k !== 'type' && k !== 'description') {
        findings.push(
          finding(
            'copilot-tool-unallowed-field',
            'blocking',
            `${path}.properties.${name}.${k}`,
            `属性不允许字段 "${k}"`,
          ),
        )
      }
    }
    if (!(SCHEMA_PROPERTY_TYPES as readonly string[]).includes(str(d.type))) {
      findings.push(
        finding(
          'copilot-tool-schema-invalid',
          'blocking',
          `${path}.properties.${name}.type`,
          '属性类型必须是 string/number/boolean',
        ),
      )
      continue
    }
    const description = str(d.description)
    if (description.length > 128) {
      findings.push(
        finding(
          'copilot-tool-size-limit-exceeded',
          'warning',
          `${path}.properties.${name}.description`,
          '属性描述超过 128 字符',
        ),
      )
    }
    if (description)
      checkInjectionText(description, `${path}.properties.${name}.description`, findings)
    properties[name] = {
      type: d.type as CopilotToolSchemaPropertyType,
      ...(description ? { description } : {}),
    }
  }
  let required: readonly string[] | undefined
  if (obj.required !== undefined) {
    if (!Array.isArray(obj.required) || obj.required.some((r) => typeof r !== 'string')) {
      findings.push(
        finding(
          'copilot-tool-schema-invalid',
          'blocking',
          `${path}.required`,
          'required 必须是字符串数组',
        ),
      )
    } else {
      const reqList = obj.required as string[]
      for (const r of reqList) {
        if (!(r in properties)) {
          findings.push(
            finding(
              'copilot-tool-schema-invalid',
              'blocking',
              `${path}.required`,
              `required 引用了未定义属性 "${r}"`,
            ),
          )
        }
      }
      required = reqList
    }
  }
  return { type: 'object', properties, ...(required ? { required } : {}) }
}

const WRITE_VERB_RE = /:(update|create|delete|execute|write)$/i

/**
 * 校验 copilot-tool contribution 负载（D1：字段封闭、fail-closed）。
 *
 * @returns 发现列表 + 归一化负载（存在 blocking 时省略）。
 */
export function validateCopilotToolContributionPayload(
  payload: unknown,
  context: CopilotToolValidationContext = {},
): CopilotToolValidationResult {
  const findings: CopilotToolValidationFinding[] = []
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      findings: [finding('copilot-tool-schema-invalid', 'blocking', '$', '负载必须是对象')],
    }
  }
  const obj = payload as Record<string, unknown>
  for (const k of Object.keys(obj)) {
    if (!(COPILOT_TOOL_PAYLOAD_ALLOWED_FIELDS as readonly string[]).includes(k)) {
      findings.push(
        finding('copilot-tool-unallowed-field', 'blocking', `$.${k}`, `负载不允许顶层字段 "${k}"`),
      )
    }
  }
  if (obj.schemaVersion !== '1.0') {
    findings.push(
      finding(
        'copilot-tool-schema-invalid',
        'blocking',
        '$.schemaVersion',
        'schemaVersion 必须是 "1.0"',
      ),
    )
  }
  if (!Array.isArray(obj.tools) || obj.tools.length === 0) {
    findings.push(
      finding('copilot-tool-schema-invalid', 'blocking', '$.tools', 'tools 必须是非空数组'),
    )
    return { valid: false, findings }
  }
  if (obj.tools.length > MAX_TOOLS_PER_CONTRIBUTION) {
    findings.push(
      finding(
        'copilot-tool-count-limit-exceeded',
        'blocking',
        '$.tools',
        `工具数超过 ${MAX_TOOLS_PER_CONTRIBUTION}`,
      ),
    )
  }

  const knownPerms = context.knownPermissionKeys ? new Set(context.knownPermissionKeys) : null
  const knownSkills = context.knownSkillRefs ? new Set(context.knownSkillRefs) : null
  const seenIds = new Set<string>()
  const tools: CopilotToolDeclaration[] = []

  for (let i = 0; i < obj.tools.length; i++) {
    const tPath = `$.tools[${i}]`
    const t = obj.tools[i]
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
      findings.push(finding('copilot-tool-schema-invalid', 'blocking', tPath, '工具声明必须是对象'))
      continue
    }
    const tObj = t as Record<string, unknown>
    for (const k of Object.keys(tObj)) {
      if (!(COPILOT_TOOL_DECLARATION_ALLOWED_FIELDS as readonly string[]).includes(k)) {
        findings.push(
          finding(
            'copilot-tool-unallowed-field',
            'blocking',
            `${tPath}.${k}`,
            `工具声明不允许字段 "${k}"`,
          ),
        )
      }
    }

    // identity
    const toolId = str(tObj.toolId)
    if (
      !toolId.startsWith(COPILOT_TOOL_ID_PREFIX) ||
      !/^[a-z0-9_]+([._-][a-z0-9_]+)*$/.test(toolId)
    ) {
      findings.push(
        finding(
          'copilot-tool-invalid-id-prefix',
          'blocking',
          `${tPath}.toolId`,
          `工具 ID 必须以 "${COPILOT_TOOL_ID_PREFIX}" 开头且为小写命名空间格式`,
        ),
      )
    } else if (seenIds.has(toolId)) {
      findings.push(
        finding(
          'copilot-tool-duplicate-tool-id',
          'blocking',
          `${tPath}.toolId`,
          `工具 ID "${toolId}" 重复`,
        ),
      )
    } else {
      seenIds.add(toolId)
    }
    const version = str(tObj.version)
    if (!/^(\d+)\.(\d+)\.(\d+)$/.test(version)) {
      findings.push(
        finding(
          'copilot-tool-schema-invalid',
          'blocking',
          `${tPath}.version`,
          'version 必须是完整 SemVer',
        ),
      )
    }

    // 文本字段 + 注入扫描（1.3）
    const name = str(tObj.name).trim()
    if (!name || name.length > MAX_TOOL_NAME_LENGTH) {
      findings.push(
        finding(
          'copilot-tool-size-limit-exceeded',
          'blocking',
          `${tPath}.name`,
          `名称必须非空且 ≤${MAX_TOOL_NAME_LENGTH} 字符`,
        ),
      )
    }
    const description = str(tObj.description).trim()
    if (!description || description.length > MAX_TOOL_DESCRIPTION_LENGTH) {
      findings.push(
        finding(
          'copilot-tool-size-limit-exceeded',
          'blocking',
          `${tPath}.description`,
          `描述必须非空且 ≤${MAX_TOOL_DESCRIPTION_LENGTH} 字符`,
        ),
      )
    }
    checkInjectionText(name, `${tPath}.name`, findings)
    checkInjectionText(description, `${tPath}.description`, findings)

    // side-effect class
    const sideEffectClass = str(tObj.sideEffectClass)
    if (!isCopilotToolSideEffectClass(sideEffectClass)) {
      findings.push(
        finding(
          'copilot-tool-schema-invalid',
          'blocking',
          `${tPath}.sideEffectClass`,
          'sideEffectClass 必须是 query/advisory/write',
        ),
      )
    }

    // schema 子集
    const inputSchema = validateSchemaSubset(tObj.inputSchema, `${tPath}.inputSchema`, findings)
    const outputSchema = validateSchemaSubset(tObj.outputSchema, `${tPath}.outputSchema`, findings)

    // permissions
    const permRaw = tObj.requiredPermissions
    let requiredPermissions: CopilotToolPermissionRef[] = []
    if (!Array.isArray(permRaw)) {
      findings.push(
        finding(
          'copilot-tool-schema-invalid',
          'blocking',
          `${tPath}.requiredPermissions`,
          '必须是数组',
        ),
      )
    } else {
      if (permRaw.length > MAX_PERMISSIONS_PER_TOOL) {
        findings.push(
          finding(
            'copilot-tool-size-limit-exceeded',
            'blocking',
            `${tPath}.requiredPermissions`,
            `权限数超过 ${MAX_PERMISSIONS_PER_TOOL}`,
          ),
        )
      }
      for (let pIdx = 0; pIdx < permRaw.length; pIdx++) {
        const p = permRaw[pIdx]
        const pPath = `${tPath}.requiredPermissions[${pIdx}]`
        if (!p || typeof p !== 'object' || Array.isArray(p)) {
          findings.push(
            finding('copilot-tool-schema-invalid', 'blocking', pPath, '权限引用必须是对象'),
          )
          continue
        }
        const pObj = p as Record<string, unknown>
        for (const k of Object.keys(pObj)) {
          if (k !== 'permissionKey' && k !== 'scopeKind') {
            findings.push(
              finding(
                'copilot-tool-unallowed-field',
                'blocking',
                `${pPath}.${k}`,
                `权限引用不允许字段 "${k}"`,
              ),
            )
          }
        }
        const permissionKey = str(pObj.permissionKey)
        if (!permissionKey || !/^[a-z0-9]+([._:-][a-z0-9]+)*$/.test(permissionKey)) {
          findings.push(
            finding(
              'copilot-tool-schema-invalid',
              'blocking',
              `${pPath}.permissionKey`,
              'permissionKey 格式非法',
            ),
          )
          continue
        }
        if (knownPerms && !knownPerms.has(permissionKey)) {
          findings.push(
            finding(
              'copilot-tool-unknown-permission',
              'blocking',
              pPath,
              `权限 "${permissionKey}" 不在宿主词表`,
            ),
          )
        }
        const scopeKind = str(pObj.scopeKind)
        if (scopeKind !== 'organization' && scopeKind !== 'project') {
          findings.push(
            finding(
              'copilot-tool-schema-invalid',
              'blocking',
              `${pPath}.scopeKind`,
              'scopeKind 必须是 organization/project',
            ),
          )
          continue
        }
        requiredPermissions.push({ permissionKey, scopeKind })
      }
    }

    // write 类必须有变更类权限；query/advisory 类不得声明变更类权限（1.3 一致性）
    if (isCopilotToolSideEffectClass(sideEffectClass)) {
      const hasWritePerm = requiredPermissions.some((p) => WRITE_VERB_RE.test(p.permissionKey))
      if (sideEffectClass === 'write' && !hasWritePerm) {
        findings.push(
          finding(
            'copilot-tool-write-class-misuse',
            'blocking',
            `${tPath}.sideEffectClass`,
            'write 类工具必须声明至少一个变更类权限',
          ),
        )
      }
      if (sideEffectClass !== 'write' && hasWritePerm) {
        findings.push(
          finding(
            'copilot-tool-write-class-misuse',
            'blocking',
            `${tPath}.sideEffectClass`,
            'query/advisory 类工具不得声明变更类权限',
          ),
        )
      }
    }

    // intentTags
    const tagsRaw = tObj.intentTags
    let intentTags: string[] = []
    if (!Array.isArray(tagsRaw)) {
      findings.push(
        finding(
          'copilot-tool-schema-invalid',
          'blocking',
          `${tPath}.intentTags`,
          'intentTags 必须是字符串数组',
        ),
      )
    } else {
      if (tagsRaw.length > MAX_INTENT_TAGS_PER_TOOL) {
        findings.push(
          finding(
            'copilot-tool-size-limit-exceeded',
            'blocking',
            `${tPath}.intentTags`,
            `标签数超过 ${MAX_INTENT_TAGS_PER_TOOL}`,
          ),
        )
      }
      for (let g = 0; g < tagsRaw.length; g++) {
        const tag = str(tagsRaw[g]).trim().toLowerCase()
        if (!tag || tag.length > MAX_INTENT_TAG_LENGTH) {
          findings.push(
            finding(
              'copilot-tool-size-limit-exceeded',
              'blocking',
              `${tPath}.intentTags[${g}]`,
              `标签必须非空且 ≤${MAX_INTENT_TAG_LENGTH} 字符`,
            ),
          )
          continue
        }
        checkInjectionText(tag, `${tPath}.intentTags[${g}]`, findings)
        intentTags.push(tag)
      }
    }

    // skillRefs
    const skillsRaw = tObj.skillRefs
    let skillRefs: string[] | undefined
    if (skillsRaw !== undefined) {
      if (!Array.isArray(skillsRaw)) {
        findings.push(
          finding(
            'copilot-tool-schema-invalid',
            'blocking',
            `${tPath}.skillRefs`,
            'skillRefs 必须是字符串数组',
          ),
        )
      } else {
        if (skillsRaw.length > MAX_SKILL_REFS_PER_TOOL) {
          findings.push(
            finding(
              'copilot-tool-size-limit-exceeded',
              'blocking',
              `${tPath}.skillRefs`,
              `Skill ref 数超过 ${MAX_SKILL_REFS_PER_TOOL}`,
            ),
          )
        }
        const refs: string[] = []
        for (let s = 0; s < skillsRaw.length; s++) {
          const ref = str(skillsRaw[s]).trim()
          if (!ref || ref.length > 128) {
            findings.push(
              finding(
                'copilot-tool-schema-invalid',
                'blocking',
                `${tPath}.skillRefs[${s}]`,
                'Skill ref 必须非空且 ≤128 字符',
              ),
            )
            continue
          }
          if (/https?:\/\//i.test(ref) || ref.includes('..')) {
            findings.push(
              finding(
                'copilot-tool-injection-detected',
                'blocking',
                `${tPath}.skillRefs[${s}]`,
                'Skill ref 不得是 URL 或相对路径',
              ),
            )
            continue
          }
          if (knownSkills && !knownSkills.has(ref)) {
            findings.push(
              finding(
                'copilot-tool-unknown-skill-ref',
                'blocking',
                `${tPath}.skillRefs[${s}]`,
                `Skill ref "${ref}" 未在宿主登记`,
              ),
            )
          }
          refs.push(ref)
        }
        if (refs.length > 0) skillRefs = refs
      }
    }

    // budget
    const budgetRaw = tObj.budget
    let budget: CopilotToolBudget = {
      maxResultBytes: DEFAULT_TOOL_RESULT_BUDGET_BYTES,
      timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
    }
    if (budgetRaw !== undefined) {
      if (!budgetRaw || typeof budgetRaw !== 'object' || Array.isArray(budgetRaw)) {
        findings.push(
          finding(
            'copilot-tool-schema-invalid',
            'blocking',
            `${tPath}.budget`,
            'budget 必须是对象',
          ),
        )
      } else {
        const b = budgetRaw as Record<string, unknown>
        for (const k of Object.keys(b)) {
          if (k !== 'maxResultBytes' && k !== 'timeoutMs') {
            findings.push(
              finding(
                'copilot-tool-unallowed-field',
                'blocking',
                `${tPath}.budget.${k}`,
                `budget 不允许字段 "${k}"`,
              ),
            )
          }
        }
        const maxResultBytes =
          typeof b.maxResultBytes === 'number' ? b.maxResultBytes : DEFAULT_TOOL_RESULT_BUDGET_BYTES
        const timeoutMs = typeof b.timeoutMs === 'number' ? b.timeoutMs : DEFAULT_TOOL_TIMEOUT_MS
        if (
          !Number.isInteger(maxResultBytes) ||
          maxResultBytes <= 0 ||
          maxResultBytes > MAX_TOOL_RESULT_BUDGET_BYTES
        ) {
          findings.push(
            finding(
              'copilot-tool-size-limit-exceeded',
              'blocking',
              `${tPath}.budget.maxResultBytes`,
              `maxResultBytes 必须 ∈ (0, ${MAX_TOOL_RESULT_BUDGET_BYTES}]`,
            ),
          )
        }
        if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TOOL_TIMEOUT_MS) {
          findings.push(
            finding(
              'copilot-tool-size-limit-exceeded',
              'blocking',
              `${tPath}.budget.timeoutMs`,
              `timeoutMs 必须 ∈ (0, ${MAX_TOOL_TIMEOUT_MS}]`,
            ),
          )
        }
        budget = { maxResultBytes, timeoutMs }
      }
    }

    // host compatibility（same-major）
    const hostContractVersion = str(tObj.hostContractVersion)
    const expected = context.hostContractVersion ?? COPILOT_TOOL_HOST_CONTRACT_VERSION
    const majorOf = (v: string): string => v.split('.')[0] ?? ''
    if (!hostContractVersion) {
      findings.push(
        finding(
          'copilot-tool-schema-invalid',
          'blocking',
          `${tPath}.hostContractVersion`,
          '缺少宿主契约版本',
        ),
      )
    } else if (majorOf(hostContractVersion) !== majorOf(expected)) {
      findings.push(
        finding(
          'copilot-tool-incompatible-host-contract',
          'blocking',
          `${tPath}.hostContractVersion`,
          `宿主契约版本 ${hostContractVersion} 与当前 ${expected} 主版本不一致`,
        ),
      )
    }

    // 组装归一化声明（blocking 时跳过）
    const hasBlockingHere = findings.some(
      (f) => f.severity === 'blocking' && f.path.startsWith(tPath),
    )
    if (
      !hasBlockingHere &&
      toolId &&
      version &&
      name &&
      description &&
      isCopilotToolSideEffectClass(sideEffectClass) &&
      inputSchema &&
      outputSchema
    ) {
      tools.push({
        toolId,
        version,
        name,
        description,
        sideEffectClass,
        inputSchema,
        outputSchema,
        requiredPermissions,
        intentTags,
        ...(skillRefs ? { skillRefs } : {}),
        budget,
        hostContractVersion,
      })
    }
  }

  const hasBlocking = findings.some((f) => f.severity === 'blocking')
  if (hasBlocking) {
    return { valid: false, findings }
  }
  return {
    valid: true,
    findings,
    normalizedPayload: { schemaVersion: '1.0', tools },
  }
}

// ===========================================================================
// 4. 稳定 digest
// ===========================================================================

/** 单工具声明的确定性 digest（key 序无关）。 */
export function computeCopilotToolDigest(declaration: CopilotToolDeclaration): string {
  return seamFnv1aHash(seamStableSerialize(declaration))
}

/** 整个 contribution 负载的确定性 digest。 */
export function computeCopilotToolPayloadDigest(payload: CopilotToolContributionPayloadV1): string {
  return seamFnv1aHash(seamStableSerialize(payload))
}

// ===========================================================================
// 5. 资格快照（任务 2.1 契约侧）
// ===========================================================================

/** 快照 revision 绑定（install/grant/policy/compatibility 四类，D2）。 */
export interface CopilotPluginToolSnapshotRevisions {
  /** 安装态 revision（enabled 安装集的投影摘要）。 */
  readonly installRevision: string
  /** grant revision（权限授予摘要）。 */
  readonly grantRevision: string
  /** policy revision（RBAC/policy 结果摘要）。 */
  readonly policyRevision: string
  /** compatibility revision（宿主/seam 兼容性摘要）。 */
  readonly compatibilityRevision: string
}

/** 快照条目：仅含可路由 metadata（无代码路径、无 URL、无 secret）。 */
export interface CopilotPluginToolSnapshotEntry {
  readonly toolId: string
  readonly version: string
  readonly name: string
  readonly description: string
  readonly sideEffectClass: CopilotToolSideEffectClass
  readonly inputSchema: CopilotToolSchemaSubset
  readonly outputSchema: CopilotToolSchemaSubset
  readonly requiredPermissions: readonly CopilotToolPermissionRef[]
  readonly intentTags: readonly string[]
  readonly skillRefs?: readonly string[]
  readonly budget: CopilotToolBudget
  /** 工具声明 digest（TOCTOU 复核锚点）。 */
  readonly toolDigest: string
  /** 来源插件身份。 */
  readonly pluginId: string
  readonly pluginVersion: string
  /** 安装记录低敏 ref。 */
  readonly installationRef: string
}

/** 组织 × actor × project 感知的资格快照（可信、只读、可整体替换）。 */
export interface CopilotPluginToolSnapshot {
  readonly organizationId: number
  readonly actorId: string
  readonly projectId?: number
  readonly revisions: CopilotPluginToolSnapshotRevisions
  /** 可见条目（确定性排序：toolId 升序）；隐藏工具零泄露——不出现在本列表或任何计数中。 */
  readonly entries: readonly CopilotPluginToolSnapshotEntry[]
  /** 快照 digest（绑定 revisions + entries）。 */
  readonly digest: string
  readonly generatedAt: string
}

/** 构建快照 digest：绑定 revisions 与全部 entry digest。 */
export function buildCopilotPluginToolSnapshotDigest(
  revisions: CopilotPluginToolSnapshotRevisions,
  entries: readonly CopilotPluginToolSnapshotEntry[],
): string {
  return seamFnv1aHash(
    seamStableSerialize({
      revisions,
      entries: entries.map((e) => e.toolDigest),
    }),
  )
}

/** 归一化快照：确定性排序 + digest 计算。 */
export function normalizeCopilotPluginToolSnapshot(input: {
  organizationId: number
  actorId: string
  projectId?: number
  revisions: CopilotPluginToolSnapshotRevisions
  entries: readonly CopilotPluginToolSnapshotEntry[]
  generatedAt: string
}): CopilotPluginToolSnapshot {
  const entries = [...input.entries].sort((a, b) => a.toolId.localeCompare(b.toolId))
  return {
    organizationId: input.organizationId,
    actorId: input.actorId,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    revisions: input.revisions,
    entries,
    digest: buildCopilotPluginToolSnapshotDigest(input.revisions, entries),
    generatedAt: input.generatedAt,
  }
}

/**
 * TOCTOU 复核：调用前快照是否仍然新鲜（D4）。
 * revision 任一变化或目标工具已不在快照 → stale。
 */
export function isSnapshotFreshForInvocation(
  snapshot: CopilotPluginToolSnapshot,
  currentRevisions: CopilotPluginToolSnapshotRevisions,
  toolId: string,
): boolean {
  if (
    snapshot.revisions.installRevision !== currentRevisions.installRevision ||
    snapshot.revisions.grantRevision !== currentRevisions.grantRevision ||
    snapshot.revisions.policyRevision !== currentRevisions.policyRevision ||
    snapshot.revisions.compatibilityRevision !== currentRevisions.compatibilityRevision
  ) {
    return false
  }
  return snapshot.entries.some((e) => e.toolId === toolId)
}

// ===========================================================================
// 6. 核心路由候选接入（任务 2.3/2.4/2.5 契约侧）
// ===========================================================================

/** 插件工具路由候选（次级信号；confidence 受宿主上限约束，D3）。 */
export interface CopilotPluginToolCandidate {
  readonly source: 'plugin-tool'
  readonly toolId: string
  readonly version: string
  readonly confidence: number
  readonly reason: string
  readonly requiresUserConfirmation: boolean
}

/** 多工具命中同一意图标签的冲突信号（交由宿主澄清，不由插件裁决）。 */
export interface CopilotPluginToolCandidateConflict {
  readonly tag: string
  readonly toolIds: readonly string[]
}

export interface DeriveCandidatesResult {
  readonly candidates: readonly CopilotPluginToolCandidate[]
  readonly conflicts: readonly CopilotPluginToolCandidateConflict[]
  /** 命中的可见工具计数（top-k 截断前）。 */
  readonly matchedCount: number
}

/**
 * 从快照推导路由候选：意图标签与归一化输入做确定性子串匹配。
 * - 只处理快照内可见工具（隐藏工具零泄露）。
 * - 同一标签被多个工具命中 → conflict（宿主澄清/安全降级）。
 * - confidence = ceiling − rank×step，恒低于核心 medium 带。
 */
export function derivePluginToolCandidates(params: {
  readonly snapshot: CopilotPluginToolSnapshot
  readonly normalizedInput: string
}): DeriveCandidatesResult {
  const { snapshot, normalizedInput } = params
  const input = normalizedInput.toLowerCase()
  const tagHits = new Map<string, string[]>() // tag -> toolIds

  for (const entry of snapshot.entries) {
    for (const tag of entry.intentTags) {
      if (input.includes(tag.toLowerCase())) {
        const list = tagHits.get(tag) ?? []
        list.push(entry.toolId)
        tagHits.set(tag, list)
      }
    }
  }

  const conflicts: CopilotPluginToolCandidateConflict[] = []
  const matchedTools = new Set<string>()
  for (const [tag, toolIds] of [...tagHits.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (toolIds.length > 1) {
      conflicts.push({ tag, toolIds: [...new Set(toolIds)].sort() })
    }
    for (const id of toolIds) matchedTools.add(id)
  }
  // 有冲突的标签下的所有工具都不作为独立候选（宿主先澄清）
  for (const c of conflicts) {
    for (const id of c.toolIds) matchedTools.delete(id)
  }

  const ordered = [...matchedTools].sort()
  const candidates: CopilotPluginToolCandidate[] = []
  let rank = 0
  for (const toolId of ordered) {
    if (candidates.length >= COPILOT_PLUGIN_TOOL_MAX_CANDIDATES) break
    const entry = snapshot.entries.find((e) => e.toolId === toolId)
    if (!entry) continue
    const confidence = Math.max(1, COPILOT_PLUGIN_TOOL_CANDIDATE_CONFIDENCE_CEILING - rank * 5)
    candidates.push({
      source: 'plugin-tool',
      toolId: entry.toolId,
      version: entry.version,
      confidence,
      reason: `插件工具意图标签命中（${entry.name}）`,
      requiresUserConfirmation: entry.sideEffectClass === 'write',
    })
    rank++
  }

  return {
    candidates,
    conflicts,
    matchedCount: matchedTools.size + conflicts.reduce((n, c) => n + c.toolIds.length, 0),
  }
}

/**
 * 把插件候选合并进既有路由结果（D3：核心保留最终选择权）。
 * 核心 destinations 顺序与 confidence 一律不变；插件候选只能追加在尾部。
 */
export function mergePluginCandidatesIntoRouting<TCore>(
  coreDestinations: readonly TCore[],
  candidates: readonly CopilotPluginToolCandidate[],
  conflicts: readonly CopilotPluginToolCandidateConflict[],
): {
  readonly destinations: readonly TCore[]
  readonly pluginTail: readonly CopilotPluginToolCandidate[]
  readonly clarificationRequired: boolean
} {
  return {
    destinations: coreDestinations,
    pluginTail: candidates,
    clarificationRequired: conflicts.length > 0,
  }
}

// ---- shadow comparison（任务 2.5）-------------------------------------

export interface PluginShadowComparisonResult {
  /** 启用插件候选后新增的尾部候选 toolIds。 */
  readonly addedPluginToolIds: readonly string[]
  /** 核心destination顺序是否被改变（回归信号；必须恒为 false）。 */
  readonly coreOrderChanged: boolean
  /** 核心最高置信度是否被压低（回归信号；必须恒为 false）。 */
  readonly coreTopConfidenceReduced: boolean
  /** 是否出现澄清需求变化。 */
  readonly clarificationIntroduced: boolean
  /** 是否存在回归（任一回归信号为真）。 */
  readonly regression: boolean
}

/**
 * shadow comparison：比较启用插件候选前后的路由结果而不执行任何工具。
 * base 与 augmented 分别为核心 destination 序列（id, confidence 元组）。
 */
export function comparePluginShadowRouting(params: {
  readonly baseDestinations: readonly { readonly id: string; readonly confidence: number }[]
  readonly augmentedDestinations: readonly { readonly id: string; readonly confidence: number }[]
  readonly augmentedPluginToolIds: readonly string[]
  readonly baseClarificationRequired: boolean
  readonly augmentedClarificationRequired: boolean
}): PluginShadowComparisonResult {
  const { baseDestinations, augmentedDestinations, augmentedPluginToolIds } = params
  const baseOrder = baseDestinations.map((d) => d.id).join('\u0000')
  const augCoreOrder = augmentedDestinations
    .filter((d) => !augmentedPluginToolIds.includes(d.id))
    .map((d) => d.id)
    .join('\u0000')
  const coreOrderChanged = baseOrder !== augCoreOrder
  const baseTop = baseDestinations[0]?.confidence ?? 0
  const augTop =
    augmentedDestinations.filter((d) => !augmentedPluginToolIds.includes(d.id))[0]?.confidence ?? 0
  const coreTopConfidenceReduced = augTop < baseTop
  const clarificationIntroduced =
    !params.baseClarificationRequired && params.augmentedClarificationRequired
  return {
    addedPluginToolIds: [...augmentedPluginToolIds],
    coreOrderChanged,
    coreTopConfidenceReduced,
    clarificationIntroduced,
    regression: coreOrderChanged || coreTopConfidenceReduced,
  }
}

// ===========================================================================
// 7. 结果边界（任务 3.3 契约侧）
// ===========================================================================

/** query 结果 sanitizer 输出。 */
export interface CopilotToolQueryResultSanitized {
  readonly ok: boolean
  /** 有界文本（截断后附标记）。 */
  readonly text: string
  readonly truncated: boolean
  readonly truncationMarker?: string
  /** 注入检测判定（复用外部内容安全范式：数据不当指令）。 */
  readonly injectionDetected: boolean
  readonly hitCategories: readonly string[]
  readonly resultSizeBytes: number
}

const QUERY_INJECTION_PATTERNS: readonly { category: string; pattern: RegExp }[] = [
  {
    category: 'instruction-override',
    pattern: /\b(ignore|disregard)\s+(all\s+)?(previous|prior|above)\s+instructions\b/i,
  },
  { category: 'instruction-override-cn', pattern: /忽略(之前|以上|所有)的?(指令|提示)/ },
  { category: 'fake-system', pattern: /\b(system|developer)\s*[:：]\s*/i },
  { category: 'tool-invocation', pattern: /\b(function\s*\(|eval\s*\(|new\s+Function\b)/i },
]

/** 截断标记（与 MCP 工具范式一致的模板）。 */
export function buildCopilotToolTruncationMarker(
  originalSizeBytes: number,
  maxBudgetBytes: number,
): string {
  return `[TRUNCATED: ${originalSizeBytes} bytes exceeds budget ${maxBudgetBytes} bytes]`
}

/**
 * query 工具有界结果 sanitizer：注入检测 → 预算截断。
 * 结果当数据不当指令；检测命中时 fail-closed（ok=false）。
 */
export function sanitizeQueryToolResult(params: {
  readonly resultText: string
  readonly budgetBytes: number
}): CopilotToolQueryResultSanitized {
  const { resultText, budgetBytes } = params
  const hitCategories: string[] = []
  for (const { category, pattern } of QUERY_INJECTION_PATTERNS) {
    if (pattern.test(resultText)) hitCategories.push(category)
  }
  const resultSizeBytes = new TextEncoder().encode(resultText).length
  if (hitCategories.length > 0) {
    return {
      ok: false,
      text: '',
      truncated: false,
      injectionDetected: true,
      hitCategories,
      resultSizeBytes,
    }
  }
  if (resultSizeBytes > budgetBytes) {
    const marker = buildCopilotToolTruncationMarker(resultSizeBytes, budgetBytes)
    // 按 code point 安全截断到预算字节附近
    let cut = resultText
    while (cut.length > 0 && new TextEncoder().encode(cut).length > budgetBytes) {
      cut = cut.slice(0, Math.floor(cut.length * 0.9))
    }
    return {
      ok: true,
      text: cut + '\n' + marker,
      truncated: true,
      truncationMarker: marker,
      injectionDetected: false,
      hitCategories: [],
      resultSizeBytes,
    }
  }
  return {
    ok: true,
    text: resultText,
    truncated: false,
    injectionDetected: false,
    hitCategories: [],
    resultSizeBytes,
  }
}

/** advisory draft（建议通道；不落库、不需确认）。 */
export interface CopilotToolAdvisoryDraft {
  readonly channel: 'draft'
  readonly advisoryOnly: true
  readonly toolId: string
  readonly toolVersion: string
  /** 有界中文草案摘要（≤1024）。 */
  readonly summary: string
  readonly generatedAt: string
}

/** 构建 advisory draft（超长摘要截断）。 */
export function buildAdvisoryToolDraft(params: {
  readonly toolId: string
  readonly toolVersion: string
  readonly summary: string
  readonly now: string
}): CopilotToolAdvisoryDraft {
  const summary =
    params.summary.length <= 1024 ? params.summary : params.summary.slice(0, 1021) + '…'
  return {
    channel: 'draft',
    advisoryOnly: true,
    toolId: params.toolId,
    toolVersion: params.toolVersion,
    summary,
    generatedAt: params.now,
  }
}

/**
 * write 工具产出对齐 v3-plugin-action-preview-boundary 的统一 envelope（D4）：
 * 直接生成 `PluginActionProposal`（schemaVersion=plugin-action-proposal-v1，
 * surface='copilot-tool'），只入待审 preview；显式确认前零正式写入。
 */
export interface CopilotToolProposalBuildResult {
  readonly proposal: {
    readonly schemaVersion: 'plugin-action-proposal-v1'
    readonly actionKind: string
    readonly scope: { readonly organizationId: number; readonly projectId: number | null }
    readonly inputPayload: Record<string, unknown>
    readonly sourceRefs: readonly {
      readonly surface: 'copilot-tool'
      readonly pluginId: string
      readonly pluginVersion: string
      readonly installationId: number | null
      readonly contributionKey: string | null
      readonly contentDigest: string
      readonly capturedAt: string
    }[]
    readonly createdAt?: string
  } | null
  /** blocking 原因码（proposal 为 null 时存在）。 */
  readonly reason?: 'input_exceeds_budget' | 'action_kind_unknown'
}

/** 构建 write 工具的动作提案（输入超预算或 actionKind 未登记 → fail-closed）。 */
export function buildCopilotToolActionProposal(params: {
  readonly actionKind: string
  readonly knownActionKinds: readonly string[]
  readonly organizationId: number
  readonly projectId?: number
  readonly inputPayload: Record<string, unknown>
  readonly pluginId: string
  readonly pluginVersion: string
  readonly installationId: number | null
  readonly contributionKey: string | null
  readonly budgetBytes: number
  readonly now: string
}): CopilotToolProposalBuildResult {
  if (!(params.knownActionKinds as readonly string[]).includes(params.actionKind)) {
    return { proposal: null, reason: 'action_kind_unknown' }
  }
  const serialized = seamStableSerialize(params.inputPayload ?? {})
  const bytes = new TextEncoder().encode(serialized).length
  if (bytes > params.budgetBytes) {
    return { proposal: null, reason: 'input_exceeds_budget' }
  }
  return {
    proposal: {
      schemaVersion: 'plugin-action-proposal-v1',
      actionKind: params.actionKind,
      scope: {
        organizationId: params.organizationId,
        projectId: params.projectId ?? null,
      },
      inputPayload: params.inputPayload,
      sourceRefs: [
        {
          surface: 'copilot-tool',
          pluginId: params.pluginId,
          pluginVersion: params.pluginVersion,
          installationId: params.installationId,
          contributionKey: params.contributionKey,
          contentDigest: seamFnv1aHash(serialized),
          capturedAt: params.now,
        },
      ],
      createdAt: params.now,
    },
  }
}

// ===========================================================================
// 8. 低敏 receipt（任务 3.5/3.6 契约侧）
// ===========================================================================

/** 路由 receipt：仅 identity/status/reason codes/digest/timing。 */
export interface CopilotToolRouteReceipt {
  readonly receiptId: string
  readonly organizationId: number
  readonly actorId: string
  /** 路由原因码（低敏枚举字符串，不含自由文本 prompt）。 */
  readonly reasonCodes: readonly string[]
  /** 选中的插件工具（未选择时为 null）。 */
  readonly selectedToolId: string | null
  readonly selectedToolVersion: string | null
  readonly snapshotDigest: string
  readonly routedAt: string
}

/** 调用 receipt：identity/status/timing/budget/reference/truncation（spec Requirement 6）。 */
export interface CopilotToolInvocationReceipt {
  readonly recordId: string
  readonly toolId: string
  readonly toolVersion: string
  readonly sideEffectClass: CopilotToolSideEffectClass
  readonly status: CopilotToolInvocationStatus
  readonly durationMs: number
  readonly invokedAt: string
  readonly actorId: string
  readonly organizationId: number
  readonly denialReason?: CopilotPluginToolDenialReason
  readonly resultSizeBytes?: number
  readonly truncated?: boolean
  readonly truncationMarker?: string
  readonly snapshotDigest: string
  /** 调用后 revision 复核是否通过（false = stale，结果丢弃）。 */
  readonly revisionMatched: boolean
}

/** 禁存键表：参数/完整结果/prompt/token/secret 一律不得出现在 receipt。 */
const RECEIPT_FORBIDDEN_KEYS = [
  'arguments',
  'params',
  'parameters',
  'result',
  'resultFull',
  'fullResult',
  'response',
  'responseBody',
  'output',
  'prompt',
  'modelOutput',
  'messages',
  'token',
  'tokens',
  'usage',
  'secret',
  'apiKey',
  'authorization',
  'password',
] as const

/**
 * 校验 receipt 是否满足禁存约束（任务 3.6）。
 * @returns 违规键列表，空数组表示通过。
 */
export function validateToolReceiptNoSensitiveData(record: Record<string, unknown>): string[] {
  const violations: string[] = []
  for (const key of RECEIPT_FORBIDDEN_KEYS) {
    if (key in record && record[key] !== undefined && record[key] !== null) {
      violations.push(key)
    }
  }
  return violations
}
