/**
 * plugin-capability-seam-catalog-fixtures —— 目录契约/validator 测试夹具（低敏，无 secret/token）。
 *
 * 夹具语义：`makeSeamFixture()` 返回一条结构合法的基准条目，测试用 spread 覆盖字段制造
 * 负例（缺字段/未知枚举/矛盾状态/红线/敏感材料等）。所有 fixture 均为纯内存数据，
 * 不访问网络/IO/时间/随机数。
 */

import type { PluginCapabilitySeamEntry } from './plugin-capability-seam-catalog.js'

/** 基准合法条目（契约 shape 测试与负例的基本盘；对应 curated 语义但独立于 curated catalog）。 */
export function makeSeamFixture(): PluginCapabilitySeamEntry {
  return {
    seamKey: 'server-query.readonly-provider',
    seamVersion: '1.0.0',
    title: '只读查询提供者（fixture）',
    description: 'fixture 基准条目',
    surface: 'server-query',
    classification: 'plugin',
    deliveryStatus: 'net-new',
    ownerRef: 'platform-core',
    contractRefs: ['service-architecture-expansion', 'rbac-authorization'],
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/rbac-authorization/spec.md' },
      { kind: 'spec', path: 'openspec/specs/service-architecture-expansion/spec.md' },
    ],
    evidenceFreshness: 'fresh',
    operationModes: ['read-only'],
    inputContractRef: 'server-query-request',
    outputContractRef: 'server-query-result',
    compatibilityPolicy: 'same-major',
    failureMode: 'block-extension',
    scopeModes: ['organization', 'project'],
    requiredPermissions: ['project:task:view'],
    dataOwnership: 'non-authoritative-read',
    sideEffectClass: 'read-only',
    confirmationPolicy: 'not-required',
    auditPolicy: 'core-owned-low-sensitive',
    networkPolicy: 'none',
    tenantAuthority: 'server-resolved',
    availability: 'cataloged',
  }
}

/** 缺必填字段的条目（ownerRef/scopeModes/evidenceFreshness 缺失）。 */
export function makeSeamMissingFieldsFixture(): Record<string, unknown> {
  const entry = makeSeamFixture() as unknown as Record<string, unknown>
  delete entry['ownerRef']
  delete entry['scopeModes']
  delete entry['evidenceFreshness']
  return entry
}

/** 未知枚举条目（surface/classification 非法 + tenantAuthority 非法）。 */
export function makeSeamUnknownEnumFixture(): Record<string, unknown> {
  const entry = makeSeamFixture() as unknown as Record<string, unknown>
  entry['surface'] = 'marketplace-runtime'
  entry['classification'] = 'public-market'
  entry['tenantAuthority'] = 'client-supplied-browser-hint'
  return entry
}

/** 非法版本条目（prerelease 不被接受）。 */
export function makeSeamInvalidVersionFixture(): PluginCapabilitySeamEntry {
  return { ...makeSeamFixture(), seamVersion: '1.2.0-beta.1' }
}

/** 三态矛盾条目：net-new + host-ready（无 host 证据）。 */
export function makeSeamStateContradictionFixture(): PluginCapabilitySeamEntry {
  return {
    ...makeSeamFixture(),
    deliveryStatus: 'net-new',
    availability: 'host-ready',
  }
}

/** host-ready 但无证据条目（evidenceFreshness=missing + 空 evidenceRefs）。 */
export function makeSeamHostReadyNoEvidenceFixture(): PluginCapabilitySeamEntry {
  return {
    ...makeSeamFixture(),
    availability: 'host-ready',
    deliveryStatus: 'delivered',
    evidenceFreshness: 'missing',
    evidenceRefs: [],
  }
}

/** 核心 authority 下放红线条目：global scope + client-supplied tenant + direct 写。 */
export function makeSeamCoreAuthorityDelegationFixture(): PluginCapabilitySeamEntry {
  return {
    ...makeSeamFixture(),
    scopeModes: ['global'],
    tenantAuthority: 'client-supplied',
    dataOwnership: 'core-authoritative',
    operationModes: ['formal-write'],
    formalWriteChannel: 'direct-model-db',
    auditPolicy: 'plugin-self-asserted',
    networkPolicy: 'direct-allowed',
    failureMode: 'fail-open',
    confirmationPolicy: 'not-required',
    sideEffectClass: 'formal-write',
    coreAuthorityDelegations: ['trusted-audit', 'ai-human-confirmation'],
  }
}

/** scope/权限缺失条目。 */
export function makeSeamScopeMissingFixture(): PluginCapabilitySeamEntry {
  return { ...makeSeamFixture(), scopeModes: [], requiredPermissions: [] }
}

/** 未授权外部动作条目（external-action 但非 conditional/host-brokered）。 */
export function makeSeamExternalActionUnauthorizedFixture(): PluginCapabilitySeamEntry {
  return {
    ...makeSeamFixture(),
    classification: 'plugin',
    sideEffectClass: 'external-action',
    operationModes: ['external-action'],
    networkPolicy: 'direct-allowed',
    confirmationPolicy: 'not-required',
    auditPolicy: 'none',
  }
}

/** 矩阵不一致：formal-write 但无通道/无确认/无审计。 */
export function makeSeamMatrixInconsistentFixture(): PluginCapabilitySeamEntry {
  return {
    ...makeSeamFixture(),
    sideEffectClass: 'formal-write',
    operationModes: ['formal-write'],
    confirmationPolicy: 'not-required',
    auditPolicy: 'none',
  }
}

/** 过期证据条目（cataloged + stale → warning；host-ready + stale → blocking）。 */
export function makeSeamStaleEvidenceFixture(): PluginCapabilitySeamEntry {
  return { ...makeSeamFixture(), evidenceFreshness: 'stale' }
}

/** 证据路径失效条目。 */
export function makeSeamInvalidEvidencePathFixture(): PluginCapabilitySeamEntry {
  return {
    ...makeSeamFixture(),
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/does-not-exist/spec.md' },
      { kind: 'source', path: 'apps/backend/app/services/missing_thing.ts' },
    ],
  }
}

/** 敏感材料条目（title 含 token/prompt，触发 redaction violation）。 */
export function makeSeamSensitiveFixture(): PluginCapabilitySeamEntry {
  return {
    ...makeSeamFixture(),
    title: 'Bearer sk-proj-fixture-token 你是一个系统提示',
    description: 'provider payload: api.openai.com/v1/chat/completions',
  }
}

/** 重复 identity 用：与 makeSeamFixture 相同 key+version 的另一条目。 */
export function makeSeamDuplicateFixture(): PluginCapabilitySeamEntry {
  return { ...makeSeamFixture(), seamKey: 'server-query.readonly-provider', seamVersion: '1.0.0' }
}

/** Skill/Compiler 正例：skill-adapter 复用既有 Skill registry 契约。 */
export function makeSeamSkillAdapterFixture(): PluginCapabilitySeamEntry {
  return {
    seamKey: 'skill-adapter.skill-bundle',
    seamVersion: '1.0.0',
    title: 'Skill bundle 引用接缝（fixture）',
    surface: 'skill-adapter',
    classification: 'hybrid',
    deliveryStatus: 'incremental-gap',
    ownerRef: 'compiler-core',
    contractRefs: ['compiler-skill-registry', 'skill-activation-rules-engine'],
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/compiler-skill-registry/spec.md' },
      {
        kind: 'source',
        path: 'apps/backend/app/services/compiler/skills/skill_registry_service.ts',
      },
    ],
    evidenceFreshness: 'fresh',
    operationModes: ['read-only'],
    inputContractRef: 'skill-bundle-reference',
    outputContractRef: 'skill-registry-match-output',
    compatibilityPolicy: 'same-major',
    failureMode: 'isolate-drop',
    scopeModes: ['organization'],
    requiredPermissions: ['compiler:skill:view'],
    dataOwnership: 'non-authoritative-read',
    sideEffectClass: 'read-only',
    confirmationPolicy: 'not-required',
    auditPolicy: 'core-owned-low-sensitive',
    networkPolicy: 'none',
    availability: 'cataloged',
  }
}

/** Skill 负例：把 Skill host 提升为 host-ready / 复制第二个 Skill Registry。 */
export function makeSeamSkillAdapterNegativeFixture(): PluginCapabilitySeamEntry {
  return {
    ...makeSeamSkillAdapterFixture(),
    deliveryStatus: 'delivered',
    availability: 'host-ready',
    evidenceFreshness: 'missing',
    evidenceRefs: [],
  }
}

/** 通知模板正例：message shape 无外发授权。 */
export function makeSeamNotificationTemplateFixture(): PluginCapabilitySeamEntry {
  return {
    seamKey: 'notification-template.message-shape',
    seamVersion: '1.0.0',
    title: '通知模板 message shape（fixture）',
    surface: 'notification-template',
    classification: 'conditional',
    deliveryStatus: 'net-new',
    ownerRef: 'notification-core',
    contractRefs: ['notification-center'],
    evidenceRefs: [{ kind: 'spec', path: 'openspec/specs/notification-center/spec.md' }],
    evidenceFreshness: 'fresh',
    operationModes: ['render'],
    inputContractRef: 'notification-template-context',
    outputContractRef: 'notification-message-shape',
    compatibilityPolicy: 'same-major',
    failureMode: 'controlled-degrade',
    scopeModes: ['organization'],
    requiredPermissions: ['notification:template:view'],
    dataOwnership: 'non-authoritative-render',
    sideEffectClass: 'render',
    confirmationPolicy: 'not-required',
    auditPolicy: 'core-owned-low-sensitive',
    networkPolicy: 'fixture-mock-only',
    availability: 'cataloged',
  }
}

/** 版本兼容测试用目录：同一 seamKey 多个版本（含 deprecated）。 */
export function makeSeamVersionCatalogFixture(): PluginCapabilitySeamEntry[] {
  const base = makeSeamFixture()
  return [
    { ...base, seamVersion: '1.0.0' },
    { ...base, seamVersion: '1.3.2' },
    {
      ...base,
      seamKey: 'report-renderer.report-block',
      seamVersion: '2.0.0',
      surface: 'report-renderer',
      deliveryStatus: 'deferred',
      availability: 'deprecated',
      deprecated: {
        replacedBy: 'server-query.readonly-provider',
        migrationRef: 'docs/v2-v3/runbook/plugin-seams.md',
      },
      contractRefs: ['reporting-system-upgrade'],
      scopeModes: ['organization', 'project'],
      requiredPermissions: ['report:view'],
    },
  ]
}
