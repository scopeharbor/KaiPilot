/**
 * plugin-skill-adapter —— V3 插件携带 Skill 与 Compiler 上下文贡献接缝共享契约
 * （纯类型 + 常量 + 封闭字段集 + 平行重造阻断 + 校验纯函数 + 类型守卫，
 * 零运行时依赖，零网络/IO/时间/随机数依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块。
 * 测试见 `plugin-skill-adapter.test.ts`，fixtures 见 `plugin-skill-adapter-fixtures.ts`。
 *
 * # 语义要点（对应 design.md D4~D7 与 specs/plugin-skill-adapter/spec.md）
 * - 两个合法接缝：'skill-adapter.skill-bundle' 与 'compiler-contribution.context-contribution'。
 * - 负载契约采用封闭字段集（D5）：显式列出允许字段，差集出现非法/自建字段立即阻断。
 * - 平行重造阻断：严禁自建生命周期状态机、自建激活匹配算法、声明改变 Compiler Stage 顺序或绕过不变量。
 * - 禁存约束：严禁负载出现 secret、token、私钥等敏感材料。
 * - 所有贡献定位为 advisory / 只读引用，核心保留激活裁决与 Stage 不变量。
 */

import { isValidSemVer } from './plugin-manifest.js'
import {
  PLUGIN_SEAM_TEMPLATE_PACK,
  type PluginTemplatePackFindingCode,
  type TemplatePackPayload,
  validateTemplatePackPayload,
} from './plugin-template-pack.js'
import {
  PLUGIN_SEAM_OCR_PROFILE,
  validateOcrProfilePluginPack,
  type OcrProfilePluginFinding,
} from './ocr-profile-plugin-pack.js'
import {
  PLUGIN_SEAM_SERVER_QUERY,
  PLUGIN_SEAM_SERVER_COMMAND_PROPOSAL,
  validatePluginServerHookPayload,
  type PluginServerHookFindingCode,
} from './plugin-server-hook-runtime.js'
import {
  PLUGIN_SEAM_UI_COMMAND,
  validateUiCommandContributionPayload,
} from './command-palette-plugin-action-pack.js'
import {
  PLUGIN_SEAM_EVENT_SUBSCRIPTION,
  validatePluginEventSubscriptionPayload,
  type PluginEventFindingCode,
} from './plugin-event-subscription-contract.js'
import {
  PLUGIN_SEAM_COPILOT_TOOL,
  validateCopilotToolContributionPayload,
} from './copilot-plugin-tool-contract.js'

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** 两个官方接缝 key */
export const PLUGIN_SEAM_SKILL_BUNDLE = 'skill-adapter.skill-bundle' as const
export const PLUGIN_SEAM_COMPILER_CONTRIBUTION =
  'compiler-contribution.context-contribution' as const

export const PLUGIN_SKILL_ADAPTER_SUPPORTED_SEAMS = [
  PLUGIN_SEAM_SKILL_BUNDLE,
  PLUGIN_SEAM_COMPILER_CONTRIBUTION,
  PLUGIN_SEAM_OCR_PROFILE,
  PLUGIN_SEAM_SERVER_QUERY,
  PLUGIN_SEAM_SERVER_COMMAND_PROPOSAL,
  PLUGIN_SEAM_UI_COMMAND,
  PLUGIN_SEAM_EVENT_SUBSCRIPTION,
  PLUGIN_SEAM_COPILOT_TOOL,
] as const
export type PluginSkillAdapterSupportedSeam = (typeof PLUGIN_SKILL_ADAPTER_SUPPORTED_SEAMS)[number]

/** Finding 错误码（封闭集） */
export const PLUGIN_SKILL_ADAPTER_FINDING_CODES = [
  'plugin-skill-adapter-schema-invalid',
  'plugin-skill-adapter-unknown-seam',
  'plugin-skill-adapter-incompatible-seam-version',
  'plugin-skill-adapter-parallel-state-machine',
  'plugin-skill-adapter-parallel-activation-algorithm',
  'plugin-skill-adapter-stage-invariant-violation',
  'plugin-skill-adapter-secret-detected',
  'plugin-skill-adapter-invalid-skill-key',
  'plugin-skill-adapter-invalid-semver',
  'plugin-skill-adapter-missing-advisory-flag',
  'plugin-skill-adapter-unallowed-field',
] as const
export type PluginSkillAdapterFindingCode =
  | (typeof PLUGIN_SKILL_ADAPTER_FINDING_CODES)[number]
  | PluginTemplatePackFindingCode
  | OcrProfilePluginFinding['code']
  | PluginServerHookFindingCode
  | PluginEventFindingCode

/** skill-bundle 允许的字段集（封闭集） */
export const SKILL_BUNDLE_ALLOWED_FIELDS = [
  'skillKey',
  'skillVersion',
  'lifecycleRef',
  'description',
] as const

/** compiler-contribution 允许的字段集（封闭集） */
export const COMPILER_CONTRIBUTION_ALLOWED_FIELDS = [
  'descriptor',
  'scope',
  'targetStages',
  'advisory',
  'contextScope',
  'description',
] as const

/** 自有状态机违规黑名单字段模式 */
export const PARALLEL_STATE_MACHINE_PATTERNS = [
  'status',
  'state',
  'lifecyclestate',
  'transitions',
  'transitionrules',
  'statemachine',
] as const

/** 自有激活算法违规黑名单字段模式 */
export const PARALLEL_ACTIVATION_PATTERNS = [
  'activationrules',
  'activationengine',
  'customactivation',
  'activationalgorithm',
  'matchingengine',
  'resolvrules',
] as const

/** Stage 语义违规黑名单字段模式 */
export const STAGE_INVARIANT_VIOLATION_PATTERNS = [
  'overridestageorder',
  'bypassinvariants',
  'alterstagesequence',
  'skipvalidation',
  'directexecution',
  'stagetransitions',
  'executedirectly',
  'modifypipeline',
] as const

/** 敏感材料模式 */
const SENSITIVE_KEY_PATTERNS = [
  /secret/i,
  /token/i,
  /password/i,
  /apikey/i,
  /api_key/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
  /private[_-]?key/i,
]

const SENSITIVE_VALUE_PATTERNS = [
  /(?:^|\s)(?:sk|pk|tk)[_-][A-Za-z0-9]{20,}/,
  /(?:^|\s)Bearer\s+[A-Za-z0-9._\-]+/,
  /(?:^|\s)(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
]

// =============================================================================
// 2. 负载契约类型
// =============================================================================

/** skill-bundle 负载定义（封闭集契约）。 */
export interface PluginSkillBundleContributionPayload {
  /** 关联 Skill 的稳定标识。 */
  skillKey: string
  /** 关联 Skill 的 SemVer 版本。 */
  skillVersion: string
  /** 声明引用的 Skill 宿主生命周期状态（仅支持 active / candidate / draft）。 */
  lifecycleRef?: 'active' | 'candidate' | 'draft'
  /** 描述信息（可选）。 */
  description?: string
}

/** compiler-contribution 负载定义（封闭集契约）。 */
export interface PluginCompilerContributionPayload {
  /** 贡献描述标识。 */
  descriptor: string
  /** 适用作用域。 */
  scope: 'organization' | 'project'
  /** 建议生效的目标 Stages。 */
  targetStages: readonly string[]
  /** 必须显式声明为 advisory 建议性质（必须为 true）。 */
  advisory: true
  /** 上下文作用域（可选）。 */
  contextScope?: string
  /** 描述信息（可选）。 */
  description?: string
}

/** 校验 finding 结构 */
export interface PluginSkillAdapterFinding {
  code: PluginSkillAdapterFindingCode
  severity: 'blocking' | 'warning'
  path?: string
  message: string
}

/** 负载校验总结果 */
export interface PluginSkillAdapterValidationResult {
  valid: boolean
  findings: readonly PluginSkillAdapterFinding[]
  normalizedPayload?:
    | PluginSkillBundleContributionPayload
    | PluginCompilerContributionPayload
    | TemplatePackPayload
    | import('./ocr-profile-plugin-pack.js').OcrProfilePluginPackPayload
    | import('./plugin-ui-command.js').PluginUiCommandContributionV1
    | import('./plugin-event-subscription-contract.js').NormalizedPluginEventSubscriptionPayload
    | import('./copilot-plugin-tool-contract.js').CopilotToolContributionPayloadV1
    | Record<string, unknown>
}

/** Skill 适配器输出：包含解析出的 Skill 引用与激活适用性 */
export interface PluginSkillAdapterResolveResult {
  pluginId: string
  pluginVersion: string
  pluginInstalled: boolean
  pluginEnabled: boolean
  contributionKey: string
  seamKey: string
  effectiveStatus: 'effective' | 'ineffective_disabled' | 'ineffective_uninstalled'
  skillKey: string
  skillVersion: string
  skillFound: boolean
  skillStatus?: string
  isActivated?: boolean
  activationReason?: string
}

// =============================================================================
// 3. 校验纯函数
// =============================================================================

/** 检查是否包含敏感 key 或 value */
export function checkSecretMaterial(obj: unknown, path = ''): PluginSkillAdapterFinding[] {
  const findings: PluginSkillAdapterFinding[] = []
  if (!obj || typeof obj !== 'object') return findings

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const currentPath = path ? `${path}.${key}` : key
    if (SENSITIVE_KEY_PATTERNS.some((p) => p.test(key))) {
      findings.push({
        code: 'plugin-skill-adapter-secret-detected',
        severity: 'blocking',
        path: currentPath,
        message: `Secret material key detected in contribution payload: ${key}`,
      })
    }
    if (typeof value === 'string') {
      if (SENSITIVE_VALUE_PATTERNS.some((p) => p.test(value))) {
        findings.push({
          code: 'plugin-skill-adapter-secret-detected',
          severity: 'blocking',
          path: currentPath,
          message: `Secret token pattern detected in contribution payload value at ${currentPath}`,
        })
      }
    } else if (typeof value === 'object' && value !== null) {
      findings.push(...checkSecretMaterial(value, currentPath))
    }
  }

  return findings
}

/**
 * 平行重造阻断检测（D5）：
 * 检测是否存在自建状态机、自建激活算法、自建 Stage 流程控制等字段。
 */
export function detectParallelSkillRecreation(
  raw: Record<string, unknown>,
  allowedFields: readonly string[],
): PluginSkillAdapterFinding[] {
  const findings: PluginSkillAdapterFinding[] = []
  const keys = Object.keys(raw)

  for (const key of keys) {
    const lowerKey = key.toLowerCase()

    // 1. 检查自建状态机
    if (PARALLEL_STATE_MACHINE_PATTERNS.some((p) => lowerKey === p || lowerKey.includes(p))) {
      findings.push({
        code: 'plugin-skill-adapter-parallel-state-machine',
        severity: 'blocking',
        path: key,
        message: `Parallel state machine declaration forbidden in payload: "${key}". Must reference core Skill lifecycle.`,
      })
    }

    // 2. 检查自建激活算法
    if (PARALLEL_ACTIVATION_PATTERNS.some((p) => lowerKey === p || lowerKey.includes(p))) {
      findings.push({
        code: 'plugin-skill-adapter-parallel-activation-algorithm',
        severity: 'blocking',
        path: key,
        message: `Parallel activation algorithm declaration forbidden in payload: "${key}". Must use core SkillActivationResolver.`,
      })
    }

    // 3. 检查 Stage 语义违规
    if (STAGE_INVARIANT_VIOLATION_PATTERNS.some((p) => lowerKey === p || lowerKey.includes(p))) {
      findings.push({
        code: 'plugin-skill-adapter-stage-invariant-violation',
        severity: 'blocking',
        path: key,
        message: `Stage invariant violation in payload: "${key}". Stage ordering and invariants are reserved by core.`,
      })
    }

    // 4. 封闭字段集差集检查
    if (!allowedFields.includes(key as any)) {
      findings.push({
        code: 'plugin-skill-adapter-unallowed-field',
        severity: 'blocking',
        path: key,
        message: `Unallowed field in contribution payload: "${key}". Allowed fields: [${allowedFields.join(', ')}]`,
      })
    }
  }

  return findings
}

/**
 * 校验 skill-adapter.skill-bundle 负载
 */
export function validateSkillBundlePayload(
  payload: unknown,
  seamVersion = '1.0.0',
): PluginSkillAdapterValidationResult {
  const findings: PluginSkillAdapterFinding[] = []

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      findings: [
        {
          code: 'plugin-skill-adapter-schema-invalid',
          severity: 'blocking',
          message: 'Payload must be a valid JSON object',
        },
      ],
    }
  }

  // 1. 检查 seam 版本兼容（首期 1.x 同主版本兼容）
  const major = seamVersion.split('.')[0]
  if (major !== '1') {
    findings.push({
      code: 'plugin-skill-adapter-incompatible-seam-version',
      severity: 'blocking',
      message: `Incompatible seam version: ${seamVersion}. Expected 1.x`,
    })
  }

  const raw = payload as Record<string, unknown>

  // 2. 敏感材料检查
  findings.push(...checkSecretMaterial(raw))

  // 3. 平行重造阻断与封闭字段检查
  findings.push(...detectParallelSkillRecreation(raw, SKILL_BUNDLE_ALLOWED_FIELDS))

  // 4. 必需字段与格式校验
  if (typeof raw.skillKey !== 'string' || !raw.skillKey.trim()) {
    findings.push({
      code: 'plugin-skill-adapter-invalid-skill-key',
      severity: 'blocking',
      path: 'skillKey',
      message: 'skillKey is required and must be a non-empty string',
    })
  }

  if (typeof raw.skillVersion !== 'string' || !isValidSemVer(raw.skillVersion.trim())) {
    findings.push({
      code: 'plugin-skill-adapter-invalid-semver',
      severity: 'blocking',
      path: 'skillVersion',
      message: 'skillVersion must be a valid SemVer string (MAJOR.MINOR.PATCH)',
    })
  }

  if (typeof raw.lifecycleRef !== 'string' || !raw.lifecycleRef.trim()) {
    findings.push({
      code: 'plugin-skill-adapter-schema-invalid',
      severity: 'blocking',
      path: 'lifecycleRef',
      message: 'lifecycleRef is required and must reference core skill lifecycle',
    })
  }

  const hasBlocking = findings.some((f) => f.severity === 'blocking')
  if (hasBlocking) {
    return { valid: false, findings }
  }

  const normalized: PluginSkillBundleContributionPayload = {
    skillKey: (raw.skillKey as string).trim(),
    skillVersion: (raw.skillVersion as string).trim(),
    lifecycleRef: (raw.lifecycleRef as string).trim() as 'active' | 'candidate' | 'draft',
    ...(typeof raw.description === 'string' ? { description: raw.description.trim() } : {}),
  }

  return { valid: true, findings, normalizedPayload: normalized }
}

/**
 * 校验 compiler-contribution.context-contribution 负载
 */
export function validateCompilerContributionPayload(
  payload: unknown,
  seamVersion = '1.0.0',
): PluginSkillAdapterValidationResult {
  const findings: PluginSkillAdapterFinding[] = []

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      findings: [
        {
          code: 'plugin-skill-adapter-schema-invalid',
          severity: 'blocking',
          message: 'Payload must be a valid JSON object',
        },
      ],
    }
  }

  // 1. 检查 seam 版本兼容
  const major = seamVersion.split('.')[0]
  if (major !== '1') {
    findings.push({
      code: 'plugin-skill-adapter-incompatible-seam-version',
      severity: 'blocking',
      message: `Incompatible seam version: ${seamVersion}. Expected 1.x`,
    })
  }

  const raw = payload as Record<string, unknown>

  // 2. 敏感材料检查
  findings.push(...checkSecretMaterial(raw))

  // 3. 平行重造阻断与封闭字段检查
  findings.push(...detectParallelSkillRecreation(raw, COMPILER_CONTRIBUTION_ALLOWED_FIELDS))

  // 4. 必需字段与格式校验
  if (typeof raw.descriptor !== 'string' || !raw.descriptor.trim()) {
    findings.push({
      code: 'plugin-skill-adapter-schema-invalid',
      severity: 'blocking',
      path: 'descriptor',
      message: 'descriptor is required and must be a non-empty string',
    })
  }

  if (raw.scope !== 'organization' && raw.scope !== 'project') {
    findings.push({
      code: 'plugin-skill-adapter-schema-invalid',
      severity: 'blocking',
      path: 'scope',
      message: 'scope must be either "organization" or "project"',
    })
  }

  if (!Array.isArray(raw.targetStages) || raw.targetStages.length === 0) {
    findings.push({
      code: 'plugin-skill-adapter-schema-invalid',
      severity: 'blocking',
      path: 'targetStages',
      message: 'targetStages must be a non-empty array of stage identifiers',
    })
  }

  if (raw.advisory !== true) {
    findings.push({
      code: 'plugin-skill-adapter-missing-advisory-flag',
      severity: 'blocking',
      path: 'advisory',
      message: 'advisory must be strictly true (compiler contributions are advisory only)',
    })
  }

  const hasBlocking = findings.some((f) => f.severity === 'blocking')
  if (hasBlocking) {
    return { valid: false, findings }
  }

  const normalized: PluginCompilerContributionPayload = {
    descriptor: (raw.descriptor as string).trim(),
    scope: raw.scope as 'organization' | 'project',
    targetStages: (raw.targetStages as string[]).map((s) => s.trim()),
    advisory: true,
    ...(typeof raw.contextScope === 'string' ? { contextScope: raw.contextScope.trim() } : {}),
    ...(typeof raw.description === 'string' ? { description: raw.description.trim() } : {}),
  }

  return { valid: true, findings, normalizedPayload: normalized }
}

/**
 * 按 seamKey 分派的统一贡献负载校验入口（D4）。
 */
export function validatePluginContributionPayload(
  seamKey: string,
  payload: unknown,
  seamVersion = '1.0.0',
): PluginSkillAdapterValidationResult {
  switch (seamKey) {
    case PLUGIN_SEAM_SKILL_BUNDLE:
      return validateSkillBundlePayload(payload, seamVersion)
    case PLUGIN_SEAM_COMPILER_CONTRIBUTION:
      return validateCompilerContributionPayload(payload, seamVersion)
    case PLUGIN_SEAM_TEMPLATE_PACK: {
      const res = validateTemplatePackPayload(payload)
      return {
        valid: res.valid,
        findings: res.findings.map((f) => ({
          code: f.code as PluginSkillAdapterFindingCode,
          severity: f.severity === 'info' ? 'warning' : f.severity,
          path: f.path,
          message: f.message,
        })),
        normalizedPayload: res.normalizedPayload,
      }
    }
    case PLUGIN_SEAM_OCR_PROFILE: {
      const res = validateOcrProfilePluginPack(payload)
      return {
        valid: res.valid,
        findings: res.findings.map((item) => ({
          code: item.code,
          severity: item.severity,
          path: item.path,
          message: item.message,
        })),
        normalizedPayload: res.normalizedPayload,
      }
    }
    case PLUGIN_SEAM_SERVER_QUERY:
    case PLUGIN_SEAM_SERVER_COMMAND_PROPOSAL: {
      const res = validatePluginServerHookPayload(seamKey, payload, seamVersion)
      return {
        valid: res.valid,
        findings: res.findings,
        normalizedPayload: res.normalizedPayload,
      }
    }
    case PLUGIN_SEAM_UI_COMMAND: {
      const res = validateUiCommandContributionPayload(payload, seamVersion)
      return {
        valid: res.valid,
        findings: res.findings.map((f) => ({
          // 封闭词表：统一映射到既有 schema-invalid 码，reason/evidence 进 message
          code: 'plugin-skill-adapter-schema-invalid' as PluginSkillAdapterFindingCode,
          severity: f.severity === 'info' ? ('warning' as const) : f.severity,
          path: f.contributionKey ? `commands.${f.contributionKey}` : 'commands',
          message: f.evidenceRef ? `${f.reason}:${f.evidenceRef}` : f.reason,
        })),
        normalizedPayload: res.normalizedPayload,
      }
    }
    case PLUGIN_SEAM_EVENT_SUBSCRIPTION: {
      const res = validatePluginEventSubscriptionPayload(payload)
      return {
        valid: res.valid,
        findings: res.findings.map((f) => ({
          code: f.code as PluginSkillAdapterFindingCode,
          severity: f.severity === 'info' ? ('warning' as const) : f.severity,
          path: f.path,
          message: f.message,
        })),
        normalizedPayload: res.normalizedPayload,
      }
    }
    case PLUGIN_SEAM_COPILOT_TOOL: {
      const res = validateCopilotToolContributionPayload(payload, {
        knownPermissionKeys: [
          'project:view',
          'project:read',
          'project:update',
          'project:task:view',
          'risk:view',
          'risk:read',
          'risk:update',
          'report:view',
          'document:view',
          'knowledge:read',
          'ocr:read',
          'ai:trigger',
          // v3-copilot-first-party-tool-pack：TRIZ 技能层只读键（与 start/rbac/permissions.ts
          // 及 TrizSkillLayerService 权限语义对齐；仅追加，不改动既有词表）。
          'triz_skill_layer:view',
        ],
      })
      return {
        valid: res.valid,
        findings: res.findings.map((f) => ({
          // 封闭词表：统一映射到既有 schema-invalid 码，原码进 message 前缀
          code: 'plugin-skill-adapter-schema-invalid' as PluginSkillAdapterFindingCode,
          severity: f.severity === 'info' ? ('warning' as const) : f.severity,
          path: f.path,
          message: `[${f.code}] ${f.message}`,
        })),
        normalizedPayload: res.normalizedPayload,
      }
    }
    default:
      return {
        valid: false,
        findings: [
          {
            code: 'plugin-skill-adapter-unknown-seam',
            severity: 'blocking',
            message: `Unsupported or unknown seamKey for skill adapter: ${seamKey}`,
          },
        ],
      }
  }
}

// =============================================================================
// 4. 类型守卫
// =============================================================================

export function isPluginSkillAdapterSupportedSeam(
  v: unknown,
): v is PluginSkillAdapterSupportedSeam {
  return (
    typeof v === 'string' && (PLUGIN_SKILL_ADAPTER_SUPPORTED_SEAMS as readonly string[]).includes(v)
  )
}

export function isPluginSkillAdapterFindingCode(v: unknown): v is PluginSkillAdapterFindingCode {
  return (
    typeof v === 'string' && (PLUGIN_SKILL_ADAPTER_FINDING_CODES as readonly string[]).includes(v)
  )
}
