// @aiproj/types — V3 Copilot 官方第一方四工具插件包契约（copilot-first-party-tool-pack）
//
// v3-copilot-first-party-tool-pack —— 官方维护的项目查询 / TRIZ 顾问 / 周报草稿 /
// 风险解释四个稳定工具的声明式定义：固定第一方 identity、完整 SemVer、确定性
// manifest/package/tool digest、零网络默认声明与低敏 provenance。
//
// 依赖轻量约束：仅依赖 copilot-plugin-tool-contract（纯类型 + 确定性 helpers）与
// plugin-capability-seam-catalog 的 hash/序列化；无 AdonisJS / React / 数据库 / 网络。
//
// 核心裁决（见 change design.md）：
// - D1: 单包四工具但各自独立 tool identity/version/schema——宿主可逐工具隔离 finding 与健康状态；
// - D2: 四个 adapter 只委托既有只读/建议 facade，不复制领域算法（本文件只管声明面）；
// - D3: 权限键一律使用宿主真实 RBAC 词表（project:view / risk:view / report:view /
//   triz_skill_layer:view），query/advisory 类不得声明变更类权限（契约校验器强制）;
// - D4: 风险解释为 advisory 类：草稿内结构化「建议动作预览块」，确认前风险表零变化，
//   正式改级只能走既有核心风控流程；本包不注册任何 write 类 action kind。

import type {
  CopilotToolContributionPayloadV1,
  CopilotToolDeclaration,
} from './copilot-plugin-tool-contract.js'
import {
  computeCopilotToolDigest,
  computeCopilotToolPayloadDigest,
  validateCopilotToolContributionPayload,
  type CopilotToolValidationContext,
  type CopilotToolValidationResult,
} from './copilot-plugin-tool-contract.js'
import { seamFnv1aHash } from './plugin-capability-seam-catalog.js'

// ===========================================================================
// 1. 官方包身份（稳定可复现）
// ===========================================================================

/** 官方插件 identity（固定，不可变）。 */
export const COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID = 'com.aiproj.official.copilot-tool-pack'
export type CopilotFirstPartyToolPackPluginId = typeof COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID

/** 官方包版本（完整 SemVer）。 */
export const COPILOT_FIRST_PARTY_TOOL_PACK_VERSION = '1.0.0'

/** 发布者（第一方）。 */
export const COPILOT_FIRST_PARTY_TOOL_PACK_PUBLISHER = 'aiproj-official'

/** copilot-tool 接缝版本（与 curated catalog 登记一致）。 */
export const COPILOT_TOOL_PACK_SEAM_KEY = 'copilot-tool.declarative-tool' as const
export const COPILOT_TOOL_PACK_SEAM_VERSION = '1.0.0'

// ===========================================================================
// 2. 四个稳定 tool identities
// ===========================================================================

/** 项目查询工具 ID（query 类）。 */
export const FIRST_PARTY_TOOL_PROJECT_QUERY_ID = 'ctool_aiproj_project_query'

/** TRIZ 顾问工具 ID（advisory 类）。 */
export const FIRST_PARTY_TOOL_TRIZ_ADVISOR_ID = 'ctool_aiproj_triz_advisor'

/** 周报草稿工具 ID（advisory 类）。 */
export const FIRST_PARTY_TOOL_WEEKLY_REPORT_DRAFT_ID = 'ctool_aiproj_weekly_report_draft'

/** 风险解释工具 ID（advisory 类）。 */
export const FIRST_PARTY_TOOL_RISK_EXPLAINER_ID = 'ctool_aiproj_risk_explainer'

/** 四工具 ID 封闭集合（确定性顺序）。 */
export const FIRST_PARTY_TOOL_IDS = [
  FIRST_PARTY_TOOL_PROJECT_QUERY_ID,
  FIRST_PARTY_TOOL_TRIZ_ADVISOR_ID,
  FIRST_PARTY_TOOL_WEEKLY_REPORT_DRAFT_ID,
  FIRST_PARTY_TOOL_RISK_EXPLAINER_ID,
] as const

// ===========================================================================
// 3. 四个工具声明（中文 metadata、真实 RBAC 词表、封闭 schema、预算）
// ===========================================================================

/**
 * 工具一：项目查询（query）。
 * 只返回当前 permission/scope 可见的有界结构化摘要；不可访问项目的存在性、
 * 名称、数量、ID/hash 一律不出现在结果中（由宿主 ProjectService 权限过滤保证）。
 */
export const OFFICIAL_TOOL_PROJECT_QUERY: CopilotToolDeclaration = {
  toolId: FIRST_PARTY_TOOL_PROJECT_QUERY_ID,
  version: '1.0.0',
  name: '项目查询',
  description:
    '按组织与项目范围查询当前用户可见的项目有界摘要（名称、编码、状态、优先级、关键计数），只读、不修改任何项目数据。',
  sideEffectClass: 'query',
  inputSchema: {
    type: 'object',
    properties: {
      search: { type: 'string', description: '按项目名称或编码过滤的关键词' },
      status: { type: 'string', description: '项目状态过滤（如 active）' },
      limit: { type: 'number', description: '返回条数上限（1-20，默认 10）' },
    },
    required: [],
  },
  outputSchema: {
    type: 'object',
    properties: {
      totalVisible: { type: 'number', description: '当前可见项目总数' },
      itemsJson: { type: 'string', description: '有界项目摘要条目 JSON 文本' },
      dataCutoffAt: { type: 'string', description: '数据截止时间（ISO 8601）' },
      scopeNote: { type: 'string', description: '来源范围与权限说明' },
    },
  },
  requiredPermissions: [{ permissionKey: 'project:view', scopeKind: 'organization' }],
  intentTags: ['项目查询', '项目列表', '项目状态'],
  budget: { maxResultBytes: 8192, timeoutMs: 8000 },
  hostContractVersion: '1.0',
}

/**
 * 工具二：TRIZ 顾问（advisory）。
 * 复用既有 TRIZ Skill 层 facade（activation/budget/audit 语义全部留在宿主），
 * 输出建议草稿；不复制 TRIZ registry 或算法。
 */
export const OFFICIAL_TOOL_TRIZ_ADVISOR: CopilotToolDeclaration = {
  toolId: FIRST_PARTY_TOOL_TRIZ_ADVISOR_ID,
  version: '1.0.0',
  name: 'TRIZ 顾问',
  description:
    '引用既有 TRIZ 技能层给出创新与矛盾化解的建议草稿，标注激活状态与可用目的地；仅建议，不写入任何项目或蓝图数据。',
  sideEffectClass: 'advisory',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: '项目 ID' },
      problem: { type: 'string', description: '待解决的工程或管理问题描述' },
    },
    required: ['projectId', 'problem'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '建议草稿中文摘要' },
      activationState: { type: 'string', description: 'TRIZ 技能激活状态说明' },
      dataCutoffAt: { type: 'string', description: '数据截止时间（ISO 8601）' },
    },
  },
  requiredPermissions: [{ permissionKey: 'triz_skill_layer:view', scopeKind: 'project' }],
  intentTags: ['triz', '创新', '矛盾'],
  budget: { maxResultBytes: 8192, timeoutMs: 10000 },
  hostContractVersion: '1.0',
}

/**
 * 工具三：周报草稿（advisory）。
 * 基于用户可访问的项目事实生成有界中文草稿，明确数据截止时间、来源范围与缺失项；
 * 不发布、不发送、不写回正式报表（report_versions 表零变化）。
 */
export const OFFICIAL_TOOL_WEEKLY_REPORT_DRAFT: CopilotToolDeclaration = {
  toolId: FIRST_PARTY_TOOL_WEEKLY_REPORT_DRAFT_ID,
  version: '1.0.0',
  name: '周报草稿',
  description:
    '基于可访问项目事实生成有界中文周报草稿，标注数据截止时间、来源范围与一般性缺口；仅草稿，不发布、不外发、不写回正式报表。',
  sideEffectClass: 'advisory',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: '项目 ID' },
      weekOffset: { type: 'number', description: '相对当前周的偏移（0=本周，-1=上周）' },
    },
    required: ['projectId'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '周报草稿中文文本' },
      sourceScopeNote: { type: 'string', description: '来源范围与一般性缺口说明' },
      dataCutoffAt: { type: 'string', description: '数据截止时间（ISO 8601）' },
    },
  },
  requiredPermissions: [
    { permissionKey: 'project:view', scopeKind: 'organization' },
    { permissionKey: 'report:view', scopeKind: 'project' },
  ],
  intentTags: ['周报', '周报草稿', '进展汇报'],
  budget: { maxResultBytes: 16384, timeoutMs: 10000 },
  hostContractVersion: '1.0',
}

/**
 * 工具四：风险解释（advisory）。
 * 解释当前可见风险的原因、影响与建议；草稿内含结构化「建议动作预览块」
 * （applied 恒为 false），正式登记/改级/关闭必须走既有核心风控流程人工确认。
 */
export const OFFICIAL_TOOL_RISK_EXPLAINER: CopilotToolDeclaration = {
  toolId: FIRST_PARTY_TOOL_RISK_EXPLAINER_ID,
  version: '1.0.0',
  name: '风险解释',
  description:
    '解释当前可见风险的原因、影响并给出应对建议，附结构化建议动作预览块；不自动新增风险、不改级、不关闭，正式变更需人工流程确认。',
  sideEffectClass: 'advisory',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'number', description: '项目 ID' },
      keyword: { type: 'string', description: '风险标题关键词过滤' },
      limit: { type: 'number', description: '返回条数上限（1-10，默认 5）' },
    },
    required: ['projectId'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '风险解释与建议中文摘要' },
      suggestedActionPreviewJson: {
        type: 'string',
        description: '建议动作预览块 JSON 文本（applied=false）',
      },
      dataCutoffAt: { type: 'string', description: '数据截止时间（ISO 8601）' },
    },
  },
  requiredPermissions: [{ permissionKey: 'risk:view', scopeKind: 'project' }],
  intentTags: ['风险解释', '风险分析', '风险应对'],
  budget: { maxResultBytes: 8192, timeoutMs: 8000 },
  hostContractVersion: '1.0',
}

// ===========================================================================
// 4. 官方包 payload 与确定性 digest
// ===========================================================================

/** 官方包完整 contribution 负载（四工具，确定性顺序）。 */
export const COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD: CopilotToolContributionPayloadV1 = {
  schemaVersion: '1.0',
  tools: [
    OFFICIAL_TOOL_PROJECT_QUERY,
    OFFICIAL_TOOL_TRIZ_ADVISOR,
    OFFICIAL_TOOL_WEEKLY_REPORT_DRAFT,
    OFFICIAL_TOOL_RISK_EXPLAINER,
  ],
}

/** 单工具声明 digest 注册表（key 序无关的确定性锚点，用于损坏检测）。 */
export const OFFICIAL_TOOL_DIGEST_REGISTRY: Readonly<Record<string, string>> = Object.fromEntries(
  COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools.map((t) => [t.toolId, computeCopilotToolDigest(t)]),
)

/** 整包负载 digest（重复构建同一版本必须一致）。 */
export function computeOfficialToolPackPayloadDigest(
  payload: CopilotToolContributionPayloadV1 = COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD,
): string {
  return computeCopilotToolPayloadDigest(payload)
}

/** 官方包 manifest/package 层确定性 digest（绑定 identity+version+payload digest）。 */
export function computeOfficialToolPackManifestDigest(): string {
  return seamFnv1aHash(
    `${COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID}@${COPILOT_FIRST_PARTY_TOOL_PACK_VERSION}:${computeOfficialToolPackPayloadDigest()}`,
  )
}

// ===========================================================================
// 5. release metadata 模板（私有目录 approved release 的 metadata 形状）
// ===========================================================================

/**
 * 官方 release metadata（seed 进 plugin_private_registry_release.metadata）。
 * 形状与上游 fixture/E2E 一致：contributions[] + permissions[]，纯声明式本机数据。
 */
export const COPILOT_FIRST_PARTY_TOOL_PACK_MANIFEST_METADATA = {
  name: '开项官方 Copilot 工具包',
  version: COPILOT_FIRST_PARTY_TOOL_PACK_VERSION,
  contributions: [
    {
      contributionKey: 'official-copilot-tools',
      seamKey: COPILOT_TOOL_PACK_SEAM_KEY,
      seamVersion: COPILOT_TOOL_PACK_SEAM_VERSION,
      title: '开项官方四工具包（项目查询/TRIZ 顾问/周报草稿/风险解释）',
      payload: COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD,
    },
  ],
  permissions: [
    {
      permissionKey: 'project:view',
      seamKey: COPILOT_TOOL_PACK_SEAM_KEY,
      sideEffect: 'read-only',
      network: 'none',
      purpose: '读取当前可见项目有界摘要',
    },
    {
      permissionKey: 'risk:view',
      seamKey: COPILOT_TOOL_PACK_SEAM_KEY,
      sideEffect: 'read-only',
      network: 'none',
      purpose: '读取当前可见风险并生成解释草稿',
    },
    {
      permissionKey: 'report:view',
      seamKey: COPILOT_TOOL_PACK_SEAM_KEY,
      sideEffect: 'read-only',
      network: 'none',
      purpose: '基于可访问事实生成周报草稿（不写回报表）',
    },
    {
      permissionKey: 'triz_skill_layer:view',
      seamKey: COPILOT_TOOL_PACK_SEAM_KEY,
      sideEffect: 'read-only',
      network: 'none',
      purpose: '引用 TRIZ 技能层生成建议草稿',
    },
  ],
} as const

// ===========================================================================
// 6. 校验与损坏检测（任务 1.3）
// ===========================================================================

export interface OfficialPackIntegrityFinding {
  readonly code:
    | 'pack-schema-invalid'
    | 'pack-digest-mismatch'
    | 'pack-tool-set-changed'
    | 'pack-network-claim-violated'
  readonly severity: 'info' | 'warning' | 'blocking'
  readonly path: string
  readonly message: string
}

export interface OfficialPackIntegrityResult {
  /** 结构校验 + digest 锚点全部通过。 */
  readonly intact: boolean
  readonly findings: readonly OfficialPackIntegrityFinding[]
}

/** URL / 网络目标形态（零网络声明扫描；与契约注入模式同源收紧到网络语义）。 */
const NETWORK_CLAIM_PATTERNS: readonly RegExp[] = [/https?:\/\//i, /ftp:\/\//i]

function collectDeclaredTexts(declaration: CopilotToolDeclaration): readonly string[] {
  return [
    declaration.name,
    declaration.description,
    ...declaration.intentTags,
    ...Object.entries(declaration.inputSchema.properties).flatMap(([k, v]) => [
      k,
      v.description ?? '',
    ]),
    ...Object.entries(declaration.outputSchema.properties).flatMap(([k, v]) => [
      k,
      v.description ?? '',
    ]),
  ]
}

/**
 * 官方包完整性校验：
 * 1) 结构层复用契约校验器（字段封闭、注入 fail-closed、class/permission 一致性）；
 * 2) digest 锚点比对——任一工具被篡改（哪怕一个字符）即 digest mismatch blocking；
 * 3) 工具集合比对——增删工具即 tool-set-changed blocking；
 * 4) 零网络声明扫描——声明文本出现 URL 形态即 network-claim-violated blocking。
 *
 * @param payload 待检负载（缺省用官方常量，测试传篡改副本）。
 */
export function verifyOfficialToolPackIntegrity(
  payload: unknown = COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD,
): OfficialPackIntegrityResult {
  const findings: OfficialPackIntegrityFinding[] = []

  // ── 1. 结构层 ──
  const structural: CopilotToolValidationResult = validateCopilotToolContributionPayload(payload)
  for (const f of structural.findings) {
    if (f.severity === 'blocking') {
      findings.push({
        code: 'pack-schema-invalid',
        severity: 'blocking',
        path: f.path,
        message: f.message,
      })
    }
  }

  // ── 2/3. digest 与工具集合锚点 ──
  const tools = (payload as { tools?: readonly CopilotToolDeclaration[] }).tools ?? []
  const expectedIds = new Set<string>(FIRST_PARTY_TOOL_IDS)
  const seenIds = new Set<string>()
  for (const tool of tools) {
    seenIds.add(tool.toolId)
    const expectedDigest = OFFICIAL_TOOL_DIGEST_REGISTRY[tool.toolId]
    if (expectedDigest === undefined) continue // 未收录 id 已由工具集检查报告
    if (computeCopilotToolDigest(tool) !== expectedDigest) {
      findings.push({
        code: 'pack-digest-mismatch',
        severity: 'blocking',
        path: `$.tools[toolId=${tool.toolId}]`,
        message: '工具声明与官方注册 digest 不一致（疑似损坏或被篡改）',
      })
    }
  }
  for (const id of FIRST_PARTY_TOOL_IDS) {
    if (!seenIds.has(id)) {
      findings.push({
        code: 'pack-tool-set-changed',
        severity: 'blocking',
        path: '$.tools',
        message: `官方工具 "${id}" 缺失`,
      })
    }
  }
  for (const id of seenIds) {
    if (!expectedIds.has(id)) {
      findings.push({
        code: 'pack-tool-set-changed',
        severity: 'blocking',
        path: '$.tools',
        message: `非官方工具 "${id}" 混入官方包`,
      })
    }
  }

  // ── 4. 零网络声明 ──
  for (const tool of tools) {
    for (const text of collectDeclaredTexts(tool)) {
      if (NETWORK_CLAIM_PATTERNS.some((p) => p.test(text))) {
        findings.push({
          code: 'pack-network-claim-violated',
          severity: 'blocking',
          path: `$.tools[toolId=${tool.toolId}]`,
          message: '零网络声明违规：声明文本包含网络目标形态',
        })
        break
      }
    }
  }

  return { intact: !findings.some((f) => f.severity === 'blocking'), findings }
}

/** 带宿主词表的便捷校验（透传契约校验上下文）。 */
export function validateOfficialToolPackPayload(
  context: CopilotToolValidationContext = {},
): CopilotToolValidationResult {
  return validateCopilotToolContributionPayload(COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD, context)
}

// ===========================================================================
// 7. 低敏 provenance（任务 1.3）
// ===========================================================================

/** 低敏 provenance 摘要（禁存参数/结果/prompt/token/secret）。 */
export interface OfficialToolPackProvenance {
  readonly pluginId: typeof COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID
  readonly version: string
  readonly publisher: string
  readonly toolCount: number
  readonly toolIds: readonly string[]
  readonly packPayloadDigest: string
  readonly manifestDigest: string
  readonly networkClaim: 'none'
  readonly distribution: 'first-party'
}

export function buildOfficialToolPackProvenance(): OfficialToolPackProvenance {
  return {
    pluginId: COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID,
    version: COPILOT_FIRST_PARTY_TOOL_PACK_VERSION,
    publisher: COPILOT_FIRST_PARTY_TOOL_PACK_PUBLISHER,
    toolCount: COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools.length,
    toolIds: [...FIRST_PARTY_TOOL_IDS],
    packPayloadDigest: computeOfficialToolPackPayloadDigest(),
    manifestDigest: computeOfficialToolPackManifestDigest(),
    networkClaim: 'none',
    distribution: 'first-party',
  }
}

/** provenance 低敏守卫：出现禁存键即违规（复用上游 receipt 禁存词表语义）。 */
const PROVENANCE_FORBIDDEN_KEYS = [
  'arguments',
  'params',
  'result',
  'prompt',
  'modelOutput',
  'token',
  'tokens',
  'secret',
  'apiKey',
  'authorization',
  'password',
] as const

export function validateProvenanceNoSensitiveData(record: Record<string, unknown>): string[] {
  const violations: string[] = []
  for (const key of PROVENANCE_FORBIDDEN_KEYS) {
    if (record[key] !== undefined && record[key] !== null) violations.push(key)
  }
  return violations
}

// ===========================================================================
// 8. 确定性 fixtures（任务 1.4；零网络、providerCalls=0）
// ===========================================================================

/** 固定组织 A/B id（跨租负例用）。 */
export const OFFICIAL_PACK_FIXTURE_ORG_A_ID = 4201
export const OFFICIAL_PACK_FIXTURE_ORG_B_ID = 4202

/** 固定 actor key。 */
export const OFFICIAL_PACK_FIXTURE_ACTOR_KEY = 'user:99001'

/** 固定时钟（ISO 8601；所有断言时间相关字段以此为基准）。 */
export const OFFICIAL_PACK_FIXTURE_NOW_ISO = '2026-08-25T08:00:00.000Z'

/** 固定 provider stub 名（fake；真实模型/provider 调用数恒为 0）。 */
export const OFFICIAL_PACK_FIXTURE_PROVIDER_STUB = 'fake'

/** 宿主真实 RBAC 词表白名单 fixture（与 start/rbac/permissions.ts 对齐的最小集）。 */
export const OFFICIAL_PACK_HOST_PERMISSION_WHITELIST = [
  'project:view',
  'project:update',
  'risk:view',
  'risk:update',
  'report:view',
  'report:create',
  'triz_skill_layer:view',
  'triz_skill_layer:preview',
  'ai:trigger',
] as const

/** 组织 owner 全量权限 fixture（E2E 用）。 */
export const OFFICIAL_PACK_FIXTURE_OWNER_PERMISSIONS: readonly string[] = [
  ...OFFICIAL_PACK_HOST_PERMISSION_WHITELIST,
]
