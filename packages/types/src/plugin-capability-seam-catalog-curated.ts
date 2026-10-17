/**
 * plugin-capability-seam-catalog-curated —— V3 插件能力接缝目录首批 curated entries（宿主维护，immutable）。
 *
 * 纪律（design D4 / spec Requirement 3、4、5）：
 * - 每个 `REQUIRED_PLUGIN_SEAM_FAMILIES` family 至少一个可独立验收条目；key/version 唯一。
 * - 一个条目不得捆绑多个不能独立验收的高风险 host；公开市场/计费/收益/任意不受控代码
 *   执行不进入首批 family。
 * - `availability` 全部保持 `cataloged`：既有 Skill/Compiler 底座只能证明 `deliveryStatus`，
 *   不能单独证明通用插件 host 已交付（无 adapter host 证据不得 `host-ready`）。
 * - 本文档 entries 是只读常量；任何修改必须先过 `validateSeamCatalog` + curated tests。
 */

import {
  computeSeamCatalogDigest,
  REQUIRED_PLUGIN_SEAM_FAMILIES,
  type PluginCapabilitySeamEntry,
} from './plugin-capability-seam-catalog.js'

/** 本目录允许引用的稳定 owner ref 集（低敏；validator 用 knownOwnerRefs 校验）。 */
export const SEAM_KNOWN_OWNER_REFS: readonly string[] = [
  'compiler-core',
  'platform-core',
  'security-core',
  'notification-core',
  'reporting-core',
  'document-core',
]

/** 本目录已知合法 contract ref 集（spec capability id，低敏；validator 用 knownContractRefs 校验）。 */
export const SEAM_KNOWN_CONTRACT_REFS: readonly string[] = [
  // Skill / Compiler 域（已归档 spec 能力）
  'compiler-skill-registry',
  'skill-activation-rules-engine',
  'compiler-skill-injection',
  'skill-knowledge-authoring',
  // 平台治理/服务/安全/多租户
  'service-architecture-expansion',
  'rbac-authorization',
  'multitenant-tenant-identification',
  'security-and-penetration-gate',
  'v3-release-baseline',
  // 领域（报告/导入导出/通知/UI）
  'reporting-system-upgrade',
  'preset-project-reports',
  'document-markdown-import-export',
  'project-files-and-attachments',
  'notification-center',
  'webhook-templates-and-stats',
  'app-shell-navigation',
  'bi-report-template-library',
  'plugin-template-pack',
  // 事件订阅契约（v3-plugin-event-subscription-contract）
  'plugin-event-subscription-contract',
  // Copilot 插件工具契约（v3-copilot-plugin-tool-contract）与既有 MCP 外部工具治理
  'copilot-plugin-tool-contract',
  'copilot-mcp-tools',
]

/**
 * 首批 curated catalog（8 类 family 全覆盖；immutable）。
 * 所有条目 `availability=cataloged`；证据 refs 指向既有 spec/source 低敏路径。
 */
export const PLUGIN_SEAM_CURATED_CATALOG: readonly PluginCapabilitySeamEntry[] = [
  // =========================================================================
  // 1. skill-adapter：插件携带 Skill/KnowledgeBundle 时引用既有 registry/lifecycle
  // =========================================================================
  {
    seamKey: 'skill-adapter.skill-bundle',
    seamVersion: '1.0.0',
    title: '插件 Skill/KnowledgeBundle 引用接缝',
    description:
      '插件未来声明 Skill bundle 时引用既有 Skill Registry 身份与生命周期、激活规则与知识溯源契约的接缝。',
    surface: 'skill-adapter',
    classification: 'hybrid',
    deliveryStatus: 'incremental-gap',
    ownerRef: 'compiler-core',
    contractRefs: [
      'compiler-skill-registry',
      'skill-activation-rules-engine',
      'compiler-skill-injection',
      'skill-knowledge-authoring',
    ],
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/compiler-skill-registry/spec.md' },
      { kind: 'spec', path: 'openspec/specs/skill-activation-rules-engine/spec.md' },
      {
        kind: 'source',
        path: 'apps/backend/app/services/compiler/skills/skill_registry_service.ts',
      },
      { kind: 'source', path: 'packages/types/src/skill-activation.js' },
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
  },

  // =========================================================================
  // 2. compiler-contribution：向 Compiler 提供受控、可溯源的 advisory/context contribution
  // =========================================================================
  {
    seamKey: 'compiler-contribution.context-contribution',
    seamVersion: '1.0.0',
    title: 'Compiler 受控上下文贡献接缝',
    description:
      '插件向 Compiler 提供 advisory/context 贡献的接缝；激活裁决、不变量与最终执行由核心保留。',
    surface: 'compiler-contribution',
    classification: 'hybrid',
    deliveryStatus: 'incremental-gap',
    ownerRef: 'compiler-core',
    contractRefs: ['compiler-skill-injection', 'compiler-skill-registry', 'v3-release-baseline'],
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/compiler-skill-injection/spec.md' },
      { kind: 'source', path: 'apps/backend/app/services/compiler/skill_activation_resolver.ts' },
      { kind: 'spec', path: 'openspec/specs/compiler-skill-registry/spec.md' },
    ],
    evidenceFreshness: 'fresh',
    operationModes: ['advisory'],
    inputContractRef: 'compiler-context-slot',
    outputContractRef: 'compiler-advisory-contribution',
    compatibilityPolicy: 'same-major',
    failureMode: 'isolate-drop',
    scopeModes: ['project'],
    requiredPermissions: ['compiler:run:view'],
    dataOwnership: 'non-authoritative-read',
    sideEffectClass: 'advisory',
    confirmationPolicy: 'not-required',
    auditPolicy: 'core-owned-low-sensitive',
    networkPolicy: 'none',
    compilerInvariantOwnership: 'core',
    tenantAuthority: 'server-resolved',
    availability: 'cataloged',
  },

  // =========================================================================
  // 3. server-query：只读 query provider，经宿主 tenant/RBAC/visibility preflight
  // =========================================================================
  {
    seamKey: 'server-query.readonly-provider',
    seamVersion: '1.0.0',
    title: '服务端只读查询提供者接缝',
    description:
      '插件提供只读 query 的接缝；tenant/RBAC/visibility 一律由宿主 preflight，query 非数据权威。',
    surface: 'server-query',
    classification: 'plugin',
    deliveryStatus: 'net-new',
    ownerRef: 'platform-core',
    contractRefs: [
      'service-architecture-expansion',
      'rbac-authorization',
      'multitenant-tenant-identification',
    ],
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/service-architecture-expansion/spec.md' },
      { kind: 'spec', path: 'openspec/specs/rbac-authorization/spec.md' },
      { kind: 'spec', path: 'openspec/specs/multitenant-tenant-identification/spec.md' },
    ],
    evidenceFreshness: 'fresh',
    operationModes: ['read-only'],
    inputContractRef: 'server-query-request',
    outputContractRef: 'server-query-result',
    compatibilityPolicy: 'same-major',
    failureMode: 'block-extension',
    scopeModes: ['organization', 'project'],
    requiredPermissions: ['project:task:view', 'project:view'],
    dataOwnership: 'non-authoritative-read',
    sideEffectClass: 'read-only',
    confirmationPolicy: 'not-required',
    auditPolicy: 'core-owned-low-sensitive',
    networkPolicy: 'none',
    tenantAuthority: 'server-resolved',
    availability: 'cataloged',
  },

  // =========================================================================
  // 4. server-command-proposal：只返回 proposal/preview，不直接提交正式领域写入
  // =========================================================================
  {
    seamKey: 'server-command-proposal.proposal-only',
    seamVersion: '1.0.0',
    title: '服务端命令提案（proposal/preview）接缝',
    description:
      '插件只产出 host 可验证的 command proposal/preview；RBAC、scope、validator、显式确认、事务与审计由核心保留。',
    surface: 'server-command-proposal',
    classification: 'plugin',
    deliveryStatus: 'net-new',
    ownerRef: 'platform-core',
    contractRefs: [
      'service-architecture-expansion',
      'rbac-authorization',
      'security-and-penetration-gate',
    ],
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/service-architecture-expansion/spec.md' },
      { kind: 'spec', path: 'openspec/specs/security-and-penetration-gate/spec.md' },
    ],
    evidenceFreshness: 'fresh',
    operationModes: ['proposal'],
    inputContractRef: 'command-proposal-request',
    outputContractRef: 'command-proposal-result',
    compatibilityPolicy: 'same-major',
    failureMode: 'block-extension',
    scopeModes: ['organization', 'project'],
    requiredPermissions: ['project:task:view', 'project:view'],
    dataOwnership: 'non-authoritative-read',
    sideEffectClass: 'proposal',
    confirmationPolicy: 'host-brokered',
    auditPolicy: 'core-owned-low-sensitive',
    networkPolicy: 'none',
    tenantAuthority: 'server-resolved',
    availability: 'cataloged',
  },

  // =========================================================================
  // 5. ui-slot：渲染低敏、权限感知的 UI contribution，不成为数据权威
  // =========================================================================
  {
    seamKey: 'ui-slot.contribution-panel',
    seamVersion: '1.0.0',
    title: '前端 UI slot 贡献接缝',
    description:
      '插件在宿主 UI slot 渲染低敏、权限感知的 contribution；UI 不得覆盖正式项目/任务/风险/权限事实。',
    surface: 'ui-slot',
    classification: 'plugin',
    deliveryStatus: 'net-new',
    ownerRef: 'platform-core',
    contractRefs: ['app-shell-navigation', 'rbac-authorization'],
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/app-shell-navigation/spec.md' },
      { kind: 'spec', path: 'openspec/specs/rbac-authorization/spec.md' },
      { kind: 'source', path: 'apps/frontend/app' },
    ],
    evidenceFreshness: 'fresh',
    operationModes: ['render'],
    inputContractRef: 'ui-slot-contribution-context',
    outputContractRef: 'ui-slot-rendered-content',
    compatibilityPolicy: 'same-major',
    failureMode: 'isolate-drop',
    scopeModes: ['organization', 'project'],
    requiredPermissions: ['project:view'],
    dataOwnership: 'non-authoritative-render',
    sideEffectClass: 'render',
    confirmationPolicy: 'not-required',
    auditPolicy: 'core-owned-low-sensitive',
    networkPolicy: 'none',
    availability: 'cataloged',
  },

  // =========================================================================
  // 6. report-renderer：受界限的报告/可视化转换，导出权限和证据由核心控制
  // =========================================================================
  {
    seamKey: 'report-renderer.report-block',
    seamVersion: '1.0.0',
    title: '报告/可视化渲染块接缝',
    description: '插件在核心报告面上渲染受界限的报告/可视化块；导出权限与证据事实仍由核心控制。',
    surface: 'report-renderer',
    classification: 'plugin',
    deliveryStatus: 'net-new',
    ownerRef: 'reporting-core',
    contractRefs: ['reporting-system-upgrade', 'preset-project-reports'],
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/reporting-system-upgrade/spec.md' },
      { kind: 'spec', path: 'openspec/specs/preset-project-reports/spec.md' },
    ],
    evidenceFreshness: 'fresh',
    operationModes: ['render'],
    inputContractRef: 'report-render-context',
    outputContractRef: 'report-rendered-block',
    compatibilityPolicy: 'same-major',
    failureMode: 'isolate-drop',
    scopeModes: ['organization', 'project'],
    requiredPermissions: ['report:view'],
    dataOwnership: 'non-authoritative-render',
    sideEffectClass: 'render',
    confirmationPolicy: 'not-required',
    auditPolicy: 'core-owned-low-sensitive',
    networkPolicy: 'none',
    availability: 'cataloged',
  },

  // =========================================================================
  // 7. data-transformer：导入/导出格式转换，不越过领域 validator/confirm/commit
  // =========================================================================
  {
    seamKey: 'data-transformer.import-export-converter',
    seamVersion: '1.0.0',
    title: '导入/导出格式转换接缝',
    description:
      '插件提供有界的导入/导出格式转换；不得绕过领域 validator/confirm/commit，也不拥有转换结果领域的权威事实。',
    surface: 'data-transformer',
    classification: 'plugin',
    deliveryStatus: 'net-new',
    ownerRef: 'document-core',
    contractRefs: ['document-markdown-import-export', 'project-files-and-attachments'],
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/document-markdown-import-export/spec.md' },
      { kind: 'spec', path: 'openspec/specs/project-files-and-attachments/spec.md' },
    ],
    evidenceFreshness: 'fresh',
    operationModes: ['transform'],
    inputContractRef: 'import-export-format',
    outputContractRef: 'import-export-converted',
    compatibilityPolicy: 'same-major',
    failureMode: 'block-extension',
    scopeModes: ['organization', 'project'],
    requiredPermissions: ['project:import-export:execute'],
    dataOwnership: 'host-brokered',
    sideEffectClass: 'transform',
    confirmationPolicy: 'host-brokered',
    auditPolicy: 'core-owned-low-sensitive',
    networkPolicy: 'none',
    availability: 'cataloged',
  },

  // =========================================================================
  // 8. notification-template：模板或 message shape，不直接执行未授权外发
  // =========================================================================
  {
    seamKey: 'notification-template.message-shape',
    seamVersion: '1.0.0',
    title: '通知模板/message shape 接缝',
    description:
      '插件提供通知模板或 message shape 的接缝；真实外发无授权时不执行（forbidden/host-brokered conditional，仅 fixture/mock 验证）。',
    surface: 'notification-template',
    classification: 'conditional',
    deliveryStatus: 'net-new',
    ownerRef: 'notification-core',
    contractRefs: ['notification-center', 'webhook-templates-and-stats'],
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/notification-center/spec.md' },
      { kind: 'spec', path: 'openspec/specs/webhook-templates-and-stats/spec.md' },
    ],
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
  },

  // =========================================================================
  // 9. template-pack：插件提供内容型模板包，宿主零持久化，生效绑定 enabled 安装态
  // =========================================================================
  {
    seamKey: 'template-pack.content-bundle',
    seamVersion: '1.0.0',
    title: '模板即插件包内容接缝',
    description:
      '插件提供声明式模板包（首期试点 BI 报表模板），生效严格绑定 enabled 安装态，宿主零持久化、卸载零残留。',
    surface: 'template-pack',
    classification: 'plugin',
    deliveryStatus: 'net-new',
    ownerRef: 'reporting-core',
    contractRefs: ['bi-report-template-library', 'plugin-template-pack'],
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/bi-report-template-library/spec.md' },
      {
        kind: 'spec',
        path: 'openspec/specs/plugin-template-pack/spec.md',
      },
      { kind: 'source', path: 'packages/types/src/plugin-template-pack.ts' },
    ],
    evidenceFreshness: 'fresh',
    operationModes: ['read-only'],
    inputContractRef: 'template-pack-payload',
    outputContractRef: 'bi-template-entry-list',
    compatibilityPolicy: 'same-major',
    failureMode: 'isolate-drop',
    scopeModes: ['organization'],
    requiredPermissions: ['report:view'],
    dataOwnership: 'non-authoritative-read',
    sideEffectClass: 'read-only',
    confirmationPolicy: 'not-required',
    auditPolicy: 'core-owned-low-sensitive',
    networkPolicy: 'none',
    availability: 'cataloged',
  },

  // =========================================================================
  // 10. event-subscription：平台内部事件订阅（只读/建议型，零网络零外发）
  // =========================================================================
  {
    seamKey: 'event-subscription.internal-events',
    seamVersion: '1.0.0',
    title: '平台内部事件订阅接缝（只读/建议型）',
    description:
      '插件声明订阅宿主版本化内部事件目录的最小投影；交付前宿主复核安装/grant/policy/scope，响应仅限 observation/advisory-draft/action-proposal；零网络、零外发、不参与原事务。',
    surface: 'event-subscription',
    classification: 'hybrid',
    deliveryStatus: 'net-new',
    ownerRef: 'platform-core',
    contractRefs: [
      'plugin-event-subscription-contract',
      'rbac-authorization',
      'multitenant-tenant-identification',
    ],
    evidenceRefs: [
      {
        kind: 'spec',
        // 该 change 已于 2026-08-23 归档合并，证据指向持久主规范而非活动区/归档区 change 目录。
        path: 'openspec/specs/plugin-event-subscription-contract/spec.md',
      },
      { kind: 'source', path: 'packages/types/src/plugin-event-subscription-contract.ts' },
      {
        kind: 'source',
        path: 'apps/backend/app/services/timeline/project_activity_event_service.ts',
      },
    ],
    evidenceFreshness: 'fresh',
    operationModes: ['read-only', 'advisory'],
    inputContractRef: 'plugin-event-subscription-declaration',
    outputContractRef: 'plugin-event-response-v1',
    compatibilityPolicy: 'same-major',
    failureMode: 'isolate-drop',
    scopeModes: ['organization', 'project'],
    requiredPermissions: ['project:view'],
    dataOwnership: 'non-authoritative-read',
    sideEffectClass: 'advisory',
    confirmationPolicy: 'host-brokered',
    auditPolicy: 'core-owned-low-sensitive',
    networkPolicy: 'none',
    tenantAuthority: 'server-resolved',
    availability: 'cataloged',
  },
  {
    seamKey: 'ocr-profile.content-bundle',
    seamVersion: '1.0.0',
    title: 'OCR 声明式 Profile 内容接缝',
    description:
      '插件仅提供抽取 schema、实体映射与宿主白名单审查布局；provider、凭据、运行与确认由宿主保留。',
    surface: 'ocr-profile',
    classification: 'hybrid',
    deliveryStatus: 'net-new',
    ownerRef: 'document-core',
    contractRefs: ['document-markdown-import-export', 'project-files-and-attachments'],
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/ocr-profile-plugin-pack/spec.md' },
      { kind: 'source', path: 'packages/types/src/ocr-profile-plugin-pack.ts' },
    ],
    evidenceFreshness: 'fresh',
    operationModes: ['read-only'],
    inputContractRef: 'ocr-profile-plugin-pack-payload',
    outputContractRef: 'ocr-profile-projection',
    compatibilityPolicy: 'same-major',
    failureMode: 'isolate-drop',
    scopeModes: ['organization'],
    requiredPermissions: ['document:view'],
    dataOwnership: 'non-authoritative-read',
    sideEffectClass: 'read-only',
    confirmationPolicy: 'not-required',
    auditPolicy: 'core-owned-low-sensitive',
    networkPolicy: 'none',
    availability: 'cataloged',
  },

  // =========================================================================
  // 11. copilot-tool：插件向 Copilot 贡献声明式工具（发现/路由/确认权留核心）
  // =========================================================================
  {
    seamKey: 'copilot-tool.declarative-tool',
    seamVersion: '1.0.0',
    title: 'Copilot 插件工具声明接缝',
    description:
      '插件向 Copilot 贡献声明式工具的接缝；资格快照、意图路由、权限过滤、预算与最终确认由宿主核心保留，write 类只产待审 proposal。',
    surface: 'copilot-tool',
    classification: 'hybrid',
    deliveryStatus: 'net-new',
    ownerRef: 'platform-core',
    contractRefs: [
      'copilot-plugin-tool-contract',
      'copilot-mcp-tools',
      'rbac-authorization',
      'v3-release-baseline',
    ],
    evidenceRefs: [
      { kind: 'spec', path: 'openspec/specs/copilot-mcp-tools/spec.md' },
      { kind: 'spec', path: 'openspec/specs/v3-release-baseline/spec.md' },
      { kind: 'source', path: 'packages/types/src/copilot-plugin-tool-contract.ts' },
      {
        kind: 'source',
        path: 'apps/backend/app/services/copilot_mcp_tools/copilot_mcp_tool_service.ts',
      },
    ],
    evidenceFreshness: 'fresh',
    operationModes: ['read-only', 'advisory', 'proposal'],
    inputContractRef: 'copilot-tool-declaration-v1',
    outputContractRef: 'copilot-plugin-tool-snapshot-v1',
    compatibilityPolicy: 'same-major',
    failureMode: 'isolate-drop',
    scopeModes: ['organization', 'project'],
    requiredPermissions: ['project:read', 'ai:trigger'],
    dataOwnership: 'non-authoritative-read',
    sideEffectClass: 'advisory',
    confirmationPolicy: 'host-brokered',
    auditPolicy: 'core-owned-low-sensitive',
    networkPolicy: 'none',
    tenantAuthority: 'server-resolved',
    availability: 'cataloged',
  },
]

/** 目录 digest（curated catalog 常量；checker/测试复用，输入顺序无关）。 */
export const PLUGIN_SEAM_CURATED_DIGEST: string = computeSeamCatalogDigest([
  ...PLUGIN_SEAM_CURATED_CATALOG,
])

/** 便捷引用：REQUIRED_PLUGIN_SEAM_FAMILIES 与 curated catalog 的 family 覆盖索引。 */
export function curatedSeamFamilies(): Record<string, string[]> {
  const index: Record<string, string[]> = {}
  for (const family of REQUIRED_PLUGIN_SEAM_FAMILIES) {
    index[family] = PLUGIN_SEAM_CURATED_CATALOG.filter((e) => e.surface === family).map(
      (e) => e.seamKey,
    )
  }
  return index
}
