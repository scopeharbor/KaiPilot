/**
 * v3-v2-5-compatibility-gate-ledger —— V3 对 V2.5 GA 的 curated 兼容账本与账本校验 helpers。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块，零运行时依赖（同 @aiproj/types 其他模块）。
 * 类型契约见 `v3-v2-5-compatibility-gate.ts`；规则引擎见 `v3-v2-5-compatibility-gate-rules.ts`。
 *
 * # 账本数据来源（observation-and-inventory.md §5，2026-08-16 apply 前刷新）
 * - §5.1 GA P0 三主线：AI 草案真实流式进度 / 甘特 What-if / Compiler 编排增量增强（verified-archived）。
 * - §5.2 P1/Optional 已交付表面（verified-archived）。
 * - §5.3 授权门 6 项 conditional + 3 项 deferred（GA 收口不解除）。
 * - §5.4 API/运行时基线裁决；§5.5 产品红线。
 *
 * # source priority（observation-and-inventory.md §4，与 V3 baseline §1 一致）
 * 1. 已归档单项能力规范 `openspec/specs/<capability>/spec.md`（单项能力行为以此为准）
 * 2. 当前实现状态：代码、测试、发布证据、活动/归档 change（事实基线）
 * 3. `docs/v2-v3/planning/v3-development-baseline.md`（V3 范围裁决唯一入口）
 * 4. `docs/v2-v3/source-package/v2.5-v3-prd/` 与 V3 compiler 规格（产品意图，非实现事实）
 * 5. V2.5 历史 baseline / release map（已收口的历史裁决记录，不构成 V3 mandate）
 *
 * # 状态迁移纪律（assertSupportedStatusTransition）
 * - `verified-archived` 是终态：任何变化（含降级为 deferred/rejected）均非法。
 * - `rejected` 是终态：不得直接变 verified-archived 或任何其他状态。
 * - `conditional` → `verified-archived`、`deferred` → `conditional`/`verified-archived`
 *   只允许由独立授权的 OpenSpec change 显式推进；同状态为恒等（合法）。
 */

import type {
  ApiRuntimeBaselineDecision,
  AuthorizationGate,
  CompatibilityLedger,
  CompatibilitySourceRef,
  CompatibilitySurface,
  LedgerValidationIssue,
  ProductRedLine,
  V25SurfaceStatus,
} from './v3-v2-5-compatibility-gate.js'
import { V25_COMPATIBILITY_LEDGER_VERSION } from './v3-v2-5-compatibility-gate.js'

// =============================================================================
// 1. 必填常量（供测试与规则引擎复用）
// =============================================================================

/** 账本必须包含的 GA P0 三主线表面 ID（observation-and-inventory.md §5.1）。 */
export const REQUIRED_GA_P0_SURFACE_IDS = [
  'ai-draft-live-sse-progress',
  'gantt-what-if',
  'compiler-orchestration-wiring',
] as const

/** 账本必须包含的授权门 ID（observation-and-inventory.md §5.3 六项 conditional）。 */
export const REQUIRED_AUTHORIZATION_GATE_IDS = [
  'real-oauth-token-exchange',
  'real-webhook-callback-and-smoke',
  'github-gitlab-writeback',
  'web-push',
  'public-npm-publish',
  'real-model-evaluation',
] as const

/** 具备权威性的 sourceRef 类别：每个 surface 至少含一条。 */
const AUTHORITATIVE_SOURCE_KINDS = ['openspec-spec', 'openspec-archive', 'planning-doc'] as const

// =============================================================================
// 2. GA P0 三主线表面（§5.1，status: verified-archived）
// =============================================================================

const GA_P0_SURFACES: CompatibilitySurface[] = [
  {
    surfaceId: 'ai-draft-live-sse-progress',
    label: 'AI 草案真实流式进度（SSE）',
    status: 'verified-archived',
    sourceRefs: [
      {
        kind: 'openspec-spec',
        path: 'openspec/specs/streaming-progress-contract/spec.md',
        note: '§权威契约：StreamingProgressEnvelope',
      },
      { kind: 'openspec-spec', path: 'openspec/specs/ai-draft-generation/spec.md' },
      { kind: 'openspec-spec', path: 'openspec/specs/ai-draft-live-progress-projection/spec.md' },
      {
        kind: 'openspec-spec',
        path: 'openspec/specs/streaming-timeout-and-stall-recovery/spec.md',
      },
      { kind: 'openspec-spec', path: 'openspec/specs/streaming-release-evidence-gate/spec.md' },
      { kind: 'openspec-spec', path: 'openspec/specs/streaming-operational-observability/spec.md' },
      { kind: 'source-file', path: 'packages/types/src/progress-streaming.ts' },
      { kind: 'source-file', path: 'apps/backend/app/services/ai_draft/events.ts' },
      { kind: 'source-file', path: 'apps/frontend/lib/api/ai-draft.ts' },
    ],
    allowedV3Consumption: ['reference-evidence', 'consume-contract', 'extend-surface'],
    requiredVerification: [
      '真实事件随发生进入 SSE，禁止生成完成后批量回放',
      'heartbeat 独立 sequence；events 端点 Last-Event-ID 幂等恢复',
      'focused SSE 测试须全绿',
    ],
    notes: 'GA P0 主线之一；归档事实不得以「需重建」名义重开。',
  },
  {
    surfaceId: 'gantt-what-if',
    label: '甘特 What-if 本地情景推演',
    status: 'verified-archived',
    sourceRefs: [
      { kind: 'openspec-spec', path: 'openspec/specs/gantt-what-if-local-session/spec.md' },
      { kind: 'openspec-spec', path: 'openspec/specs/gantt-what-if-impact-summary/spec.md' },
      {
        kind: 'openspec-spec',
        path: 'openspec/specs/gantt-baseline-and-export/spec.md',
        note: '底座能力',
      },
      {
        kind: 'openspec-spec',
        path: 'openspec/specs/gantt-critical-path/spec.md',
        note: '底座能力',
      },
      { kind: 'source-file', path: 'apps/frontend/lib/gantt/model-from-api.ts' },
      {
        kind: 'source-file',
        path: 'apps/backend/app/api/v1/gantt/schedule.ts',
        note: 'POST /api/v1/projects/:projectId/gantt/schedule',
      },
    ],
    allowedV3Consumption: ['reference-evidence', 'consume-contract', 'extend-surface'],
    requiredVerification: [
      '单一内存场景、undo/redo、stale 检测、正式数据零写入',
      'Apply 复用 schedule commit + preview token + RBAC + 显式确认',
      '影响摘要只读，不做自动优化排程',
    ],
    notes: 'GA P0 主线之一。',
  },
  {
    surfaceId: 'compiler-orchestration-wiring',
    label: 'Compiler 编排增量增强（executor/resume-replay/stage event 桥）',
    status: 'verified-archived',
    sourceRefs: [
      { kind: 'openspec-spec', path: 'openspec/specs/compiler-execution-gap-benchmark/spec.md' },
      { kind: 'openspec-spec', path: 'openspec/specs/compiler-run-executor-wiring/spec.md' },
      { kind: 'openspec-spec', path: 'openspec/specs/compiler-resume-replay-wiring/spec.md' },
      {
        kind: 'openspec-spec',
        path: 'openspec/specs/compiler-stage-event-realtime-bridge/spec.md',
      },
      { kind: 'openspec-spec', path: 'openspec/specs/compiler-dynamic-routing/spec.md' },
      { kind: 'openspec-spec', path: 'openspec/specs/compiler-stage-cache-wiring/spec.md' },
      { kind: 'openspec-spec', path: 'openspec/specs/compiler-config-management-api/spec.md' },
      { kind: 'source-file', path: 'apps/backend/app/services/compiler/pipeline_executor.ts' },
      { kind: 'source-file', path: 'apps/backend/app/services/compiler/compiler_run_service.ts' },
      { kind: 'source-file', path: 'apps/backend/app/services/compiler/stage_cache_service.ts' },
    ],
    allowedV3Consumption: ['reference-evidence', 'consume-contract', 'extend-surface'],
    requiredVerification: [
      'executor 接线 / resume-replay 幂等接线 / stage event 实时桥（低敏 envelope）保持全绿',
      '缓存与动态路由须保留基准 + 组织隔离 + 降级证据',
    ],
    notes: '「首次并行化」叙事已裁决为事实错误并 rejected；真实交付为增量接线。',
  },
]

// =============================================================================
// 3. P1/Optional 已交付表面（§5.2，status: verified-archived）
// =============================================================================

const DELIVERED_P1_SURFACES: CompatibilitySurface[] = [
  {
    surfaceId: 'command-palette',
    label: 'Command Palette 命令面板',
    status: 'verified-archived',
    sourceRefs: [{ kind: 'openspec-spec', path: 'openspec/specs/command-palette/spec.md' }],
    allowedV3Consumption: ['reference-evidence', 'extend-surface'],
    requiredVerification: ['命令输出落正式数据仍须 RBAC + 预览/差异 + 显式确认 + 审计'],
  },
  {
    surfaceId: 'ai-model-catalog-rate-limits',
    label: 'AI 模型目录与限流',
    status: 'verified-archived',
    sourceRefs: [
      { kind: 'openspec-spec', path: 'openspec/specs/ai-model-catalog-rate-limits/spec.md' },
    ],
    allowedV3Consumption: ['reference-evidence', 'consume-contract', 'extend-surface'],
    requiredVerification: ['默认 fixture/mock；真实 provider 调用属未授权外部动作'],
  },
  {
    surfaceId: 'third-party-ocr-provider-foundation',
    label: '第三方 OCR provider 底座',
    status: 'verified-archived',
    sourceRefs: [
      { kind: 'openspec-spec', path: 'openspec/specs/third-party-ocr-provider-foundation/spec.md' },
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '2026-07-19 用户裁决：OCR 优先第三方 API/视觉模型',
      },
    ],
    allowedV3Consumption: ['reference-evidence', 'extend-surface'],
    requiredVerification: ['真实 OCR provider 调用默认停在 fixture 边界'],
  },
  {
    surfaceId: 'streaming-realtime-log-panel',
    label: '流式实时日志面板（流式加固）',
    status: 'verified-archived',
    sourceRefs: [
      { kind: 'openspec-spec', path: 'openspec/specs/streaming-realtime-log-panel/spec.md' },
    ],
    allowedV3Consumption: ['reference-evidence', 'extend-surface'],
    requiredVerification: ['日志面板仅展示低敏 envelope，禁止原始载荷'],
  },
  {
    surfaceId: 'compiler-34-stage-code-generation-pipeline',
    label: 'Compiler 34-stage 候选代码生成流水线（动态路由三切片）',
    status: 'verified-archived',
    sourceRefs: [
      {
        kind: 'openspec-spec',
        path: 'openspec/specs/compiler-34-stage-code-generation-pipeline/spec.md',
      },
      { kind: 'openspec-spec', path: 'openspec/specs/compiler-dynamic-routing/spec.md' },
    ],
    allowedV3Consumption: ['reference-evidence', 'extend-surface'],
    requiredVerification: [
      'feature-gated + 人工 review gate；不写仓库、不自动 apply',
      '普通 Compiler change 不得实现 34 Stage 表（非目标红线）',
    ],
  },
  {
    surfaceId: 'provider-incoming-webhook',
    label: '代码托管 provider incoming webhook',
    status: 'verified-archived',
    sourceRefs: [
      { kind: 'openspec-spec', path: 'openspec/specs/provider-incoming-webhook/spec.md' },
    ],
    allowedV3Consumption: ['reference-evidence', 'consume-contract', 'extend-surface'],
    requiredVerification: [
      '真实回调接收默认 fixture；真实接收属授权门 real-webhook-callback-and-smoke',
    ],
  },
  {
    surfaceId: 'outgoing-webhook-subscriptions',
    label: '外发 webhook 订阅与投递账本',
    status: 'verified-archived',
    sourceRefs: [
      { kind: 'openspec-spec', path: 'openspec/specs/outgoing-webhook-subscriptions/spec.md' },
      { kind: 'openspec-spec', path: 'openspec/specs/outgoing-webhook-delivery-ledger/spec.md' },
    ],
    allowedV3Consumption: ['reference-evidence', 'consume-contract', 'extend-surface'],
    requiredVerification: [
      '外发 smoke 默认 fixture；真实外发属授权门 real-webhook-callback-and-smoke',
    ],
  },
  {
    surfaceId: 'github-readonly-oauth-connection',
    label: 'GitHub 只读 OAuth 连接',
    status: 'verified-archived',
    sourceRefs: [
      { kind: 'openspec-spec', path: 'openspec/specs/github-readonly-oauth-connection/spec.md' },
    ],
    allowedV3Consumption: ['reference-evidence', 'consume-contract', 'extend-surface'],
    requiredVerification: [
      '真实 OAuth 交换属授权门 real-oauth-token-exchange；未授权停在 fixture 边界',
    ],
  },
  {
    surfaceId: 'gitlab-readonly-oauth-connection',
    label: 'GitLab 只读 OAuth 连接',
    status: 'verified-archived',
    sourceRefs: [
      { kind: 'openspec-spec', path: 'openspec/specs/gitlab-readonly-oauth-connection/spec.md' },
    ],
    allowedV3Consumption: ['reference-evidence', 'consume-contract', 'extend-surface'],
    requiredVerification: [
      '真实 OAuth 交换属授权门 real-oauth-token-exchange',
      'GitLab base URL 仅从服务端 env 派生防 SSRF',
    ],
  },
  {
    surfaceId: 'code-repository-link-candidates',
    label: '代码仓库关联候选（高置信匹配）',
    status: 'verified-archived',
    sourceRefs: [
      { kind: 'openspec-spec', path: 'openspec/specs/code-repository-link-candidates/spec.md' },
    ],
    allowedV3Consumption: ['reference-evidence', 'extend-surface'],
    requiredVerification: ['高置信匹配仍须逐条人工确认，不得自动绑定'],
  },
  {
    surfaceId: 'pwa-installable-shell',
    label: 'PWA 可安装外壳与静态离线 fallback',
    status: 'verified-archived',
    sourceRefs: [
      { kind: 'openspec-spec', path: 'openspec/specs/pwa-installable-shell/spec.md' },
      { kind: 'openspec-spec', path: 'openspec/specs/pwa-static-offline-fallback/spec.md' },
    ],
    allowedV3Consumption: ['reference-evidence', 'extend-surface'],
    requiredVerification: ['无离线写入；Web Push 属授权门 web-push（conditional）'],
  },
  {
    surfaceId: 'typescript-sdk-core',
    label: 'TypeScript SDK 核心',
    status: 'verified-archived',
    sourceRefs: [{ kind: 'openspec-spec', path: 'openspec/specs/typescript-sdk-core/spec.md' }],
    allowedV3Consumption: ['reference-evidence', 'consume-contract', 'extend-surface'],
    requiredVerification: ['公开 npm 发布属授权门 public-npm-publish，必须独立授权'],
  },
  {
    surfaceId: 'v2-5-validation-gate-repair-and-archive',
    label: 'V2.5 GA 验证门修复与归档证据',
    status: 'verified-archived',
    sourceRefs: [
      {
        kind: 'openspec-spec',
        path: 'openspec/specs/v2-5-validation-gate-repair-and-archive/spec.md',
      },
      {
        kind: 'openspec-spec',
        path: 'openspec/specs/v2-5-release-baseline/spec.md',
        note: '[S] V2.5 GA 收口基线',
      },
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-release-map.md',
        note: '[R] 发布证据',
      },
    ],
    allowedV3Consumption: ['reference-evidence'],
    requiredVerification: ['GA 收口声明不得覆盖/解除任何授权门与延期边界'],
  },
]

// =============================================================================
// 4. /api/v2 适配器表面（§5.4，status: archived-but-stub —— 归档 ≠ 已接通）
// =============================================================================

const API_V2_ADAPTER_SURFACE: CompatibilitySurface = {
  surfaceId: 'api-v2-adapter',
  label: '/api/v2 适配器（脚手架 + 501 stub）',
  status: 'archived-but-stub',
  sourceRefs: [
    {
      kind: 'planning-doc',
      path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
      note: '[B] /api/v1 为唯一默认稳定产品 API 的裁决记录',
    },
    {
      kind: 'planning-doc',
      path: 'docs/v2-v3/planning/v3-development-baseline.md',
      note: 'V3 范围裁决唯一入口',
    },
  ],
  allowedV3Consumption: ['no-touch', 'reference-evidence'],
  requiredVerification: [
    '归档 ≠ 已接通：V2_ADAPTER_NOT_IMPLEMENTED 501 stub，feature-gated（API_V2_ENABLED）',
    'V2 surface 禁用时本地与 P0 流程必须继续走 /api/v1',
  ],
  notes: '唯一已知 archived-but-stub 表面；接通须独立授权的 change。',
}

// =============================================================================
// 5. 授权门（§5.3：6 项 conditional + 3 项 deferred）
// =============================================================================

const AUTHORIZATION_GATES: AuthorizationGate[] = [
  {
    gateId: 'real-oauth-token-exchange',
    label: '真实 GitHub/GitLab OAuth 令牌交换',
    status: 'conditional',
    requiredAuthorization: '用户在独立授权的 OpenSpec change 中明确授权',
    defaultBoundary:
      '未授权停在 fixture/mock 可验证边界；GitLab base URL 仅从服务端 env 派生防 SSRF',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 授权门边界记录',
      },
      { kind: 'openspec-spec', path: 'openspec/specs/github-readonly-oauth-connection/spec.md' },
      { kind: 'openspec-spec', path: 'openspec/specs/gitlab-readonly-oauth-connection/spec.md' },
    ],
  },
  {
    gateId: 'real-webhook-callback-and-smoke',
    label: '真实 Webhook 回调接收 / 外发 smoke',
    status: 'conditional',
    requiredAuthorization: '用户在独立授权的 OpenSpec change 中明确授权',
    defaultBoundary: 'incoming/outgoing 拆分建模；未授权默认 fixture',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 授权门边界记录',
      },
      { kind: 'openspec-spec', path: 'openspec/specs/provider-incoming-webhook/spec.md' },
      { kind: 'openspec-spec', path: 'openspec/specs/outgoing-webhook-subscriptions/spec.md' },
    ],
  },
  {
    gateId: 'github-gitlab-writeback',
    label: 'GitHub/GitLab 写回',
    status: 'conditional',
    requiredAuthorization: '用户在独立授权的 OpenSpec change 中明确授权',
    defaultBoundary: '只读优先；未授权不得写回任何外部系统',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 授权门边界记录',
      },
      { kind: 'openspec-spec', path: 'openspec/specs/github-readonly-oauth-connection/spec.md' },
      { kind: 'openspec-spec', path: 'openspec/specs/gitlab-readonly-oauth-connection/spec.md' },
    ],
  },
  {
    gateId: 'web-push',
    label: 'Web Push 推送',
    status: 'conditional',
    requiredAuthorization: '用户在独立授权的 OpenSpec change 中明确授权',
    defaultBoundary: 'PWA 首期只做静态 fallback，不接入推送',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 授权门边界记录',
      },
      { kind: 'openspec-spec', path: 'openspec/specs/pwa-installable-shell/spec.md' },
    ],
  },
  {
    gateId: 'public-npm-publish',
    label: '公开 npm 发布',
    status: 'conditional',
    requiredAuthorization: '必须独立授权，不得与功能 change 合并',
    defaultBoundary: '未授权仅本地构建与 fixture 验证，不发布任何包',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 授权门边界记录',
      },
      { kind: 'openspec-spec', path: 'openspec/specs/typescript-sdk-core/spec.md' },
    ],
  },
  {
    gateId: 'real-model-evaluation',
    label: '大规模真实模型评测（720 矩阵）/ 真实模型 A/B 编译',
    status: 'conditional',
    requiredAuthorization: '用户在独立授权的 OpenSpec change 中明确授权',
    defaultBoundary: '未授权只产 fixture evidence，不调用真实模型',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 授权门边界记录',
      },
    ],
  },
  {
    gateId: 'containerized-private-deployment',
    label: '容器化 / 私有化部署',
    status: 'deferred',
    requiredAuthorization: '设计性延期：V2.5 非目标，须独立 change 显式立项',
    defaultBoundary: '本机 pnpm dev 单体为唯一支持形态',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 延期边界记录',
      },
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v3-development-baseline.md',
        note: 'V3 范围裁决唯一入口',
      },
    ],
  },
  {
    gateId: 'full-internationalization',
    label: '完整国际化',
    status: 'deferred',
    requiredAuthorization: '设计性延期：V2.5 非目标，须独立 change 显式立项',
    defaultBoundary: '仅维护既有文案结构，不扩展完整 i18n 体系',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 延期边界记录',
      },
    ],
  },
  {
    gateId: 'open-plugin-marketplace',
    label: '开放插件市场',
    status: 'deferred',
    requiredAuthorization: '设计性延期：同时为产品红线，须独立 change 显式立项',
    defaultBoundary: '不实现任何插件分发/安装机制',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 延期边界记录（同时为产品红线）',
      },
    ],
  },
]

// =============================================================================
// 6. API / 运行时基线裁决（§5.4）
// =============================================================================

const API_RUNTIME_DECISIONS: ApiRuntimeBaselineDecision[] = [
  {
    decisionId: 'api-v1-default',
    label: '/api/v1 为唯一默认稳定产品 API',
    decision:
      '所有本地与 P0 流程必须走 /api/v1；任何新 API 版本须独立授权的 change 并保留 /api/v1 fallback。',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] API 基线裁决',
      },
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v3-development-baseline.md',
        note: 'V3 范围裁决唯一入口',
      },
    ],
  },
  {
    decisionId: 'api-v2-stub-gated',
    label: '/api/v2 为脚手架 + 501 stub，feature-gated',
    decision:
      '归档 ≠ 已接通：V2_ADAPTER_NOT_IMPLEMENTED 501 stub，由 API_V2_ENABLED 门控；禁用时本地与 P0 流程必须继续走 /api/v1。',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] API 基线裁决',
      },
    ],
  },
  {
    decisionId: 'sqlite-first-local-monolith',
    label: 'SQLite + 本机 pnpm dev 单体为仓库事实',
    decision:
      '任何数据库/部署形态迁移须独立 change 证明必要性且保留本机 fallback；不得在普通 change 中夹带。',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 运行时基线裁决',
      },
    ],
  },
  {
    decisionId: 'no-docker-no-microservices',
    label: '无 Docker/容器化，无微服务',
    decision: '容器化与微服务叙事均已裁决 rejected；任何引入须独立授权的 change。',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 运行时基线裁决',
      },
    ],
  },
  {
    decisionId: 'no-forced-redis-kafka-vectordb',
    label: '不得强制 Redis/Kafka/VectorDB',
    decision:
      '强制 PostgreSQL/Redis/Kafka/VectorDB/Nginx/微服务均 rejected；Redis 不可用时 memory fallback 必须通过。',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 运行时基线裁决',
      },
    ],
  },
  {
    decisionId: 'sse-default-transport',
    label: 'SSE 为默认实时传输',
    decision:
      'WebSocket 微服务是显式保留的 PRD change；现有 SSE 工作不得被解释成已实现它，也不得被替换。',
    sourceRefs: [
      { kind: 'openspec-spec', path: 'openspec/specs/streaming-progress-contract/spec.md' },
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 运行时基线裁决',
      },
    ],
  },
  {
    decisionId: 'gantt-visx-no-d3',
    label: '甘特继续 @visx，不引入 D3 替换',
    decision: '甘特可视化栈维持 @visx；任何替换须独立 change 证明必要性。',
    sourceRefs: [
      { kind: 'openspec-spec', path: 'openspec/specs/gantt-baseline-and-export/spec.md' },
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 运行时基线裁决',
      },
    ],
  },
]

// =============================================================================
// 7. 产品红线（§5.5）
// =============================================================================

const PRODUCT_RED_LINES: ProductRedLine[] = [
  {
    redLineId: 'ai-suggest-only-no-auto-execute',
    label: 'AI 只建议不自动执行',
    statement:
      '任何置信度、快捷命令、自动恢复、离线队列均不得绕过 RBAC + 组织隔离 + 预览/差异 + 显式确认 + 审计。',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 产品红线 §5.5-1',
      },
    ],
  },
  {
    redLineId: 'organization-isolation',
    label: '组织隔离',
    statement: '所有查询自动附加 organization_id；禁止跨组织数据合并或泄漏。',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 产品红线 §5.5-2',
      },
    ],
  },
  {
    redLineId: 'low-sensitive-evidence',
    label: '低敏证据',
    statement:
      'prompt、模型输出、令牌、secret、完整日志、完整源码、跨组织数据禁止进入 envelope/日志面板/findings。',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 产品红线 §5.5-3',
      },
    ],
  },
  {
    redLineId: 'fixture-first',
    label: 'fixture-first',
    statement: '默认自动化测试必须使用 fixture/mock；真实外部动作全部走授权门。',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 产品红线 §5.5-4',
      },
    ],
  },
  {
    redLineId: 'evidence-discipline',
    label: '证据纪律',
    statement: '无基线 KPI 不得冒充完成门禁；局部测试通过只能声明窄范围完成。',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 产品红线 §5.5-5',
      },
      {
        kind: 'openspec-spec',
        path: 'openspec/specs/v2-5-validation-gate-repair-and-archive/spec.md',
      },
    ],
  },
  {
    redLineId: 'non-goal-red-lines',
    label: '非目标红线集合',
    statement:
      '软件代码生成器（普通 Compiler change 不得实现 34 Stage 表）、代码托管/CI-CD 产品、独立时间跟踪、内置 CRM、开放插件市场均为非目标。',
    sourceRefs: [
      {
        kind: 'planning-doc',
        path: 'docs/v2-v3/planning/v2.5-development-baseline.md',
        note: '[B] 产品红线 §5.5-6',
      },
    ],
  },
]

// =============================================================================
// 8. curated 兼容账本
// =============================================================================

/** V3 对 V2.5 GA 的 curated 兼容账本（数据源：observation-and-inventory.md §5）。 */
export const V25_COMPATIBILITY_LEDGER: CompatibilityLedger = {
  ledgerVersion: V25_COMPATIBILITY_LEDGER_VERSION,
  generatedAt: '2026-08-16',
  surfaces: [...GA_P0_SURFACES, ...DELIVERED_P1_SURFACES, API_V2_ADAPTER_SURFACE],
  authorizationGates: AUTHORIZATION_GATES,
  apiRuntimeDecisions: API_RUNTIME_DECISIONS,
  redLines: PRODUCT_RED_LINES,
}

// =============================================================================
// 9. 状态迁移纪律（任务 2.3）
// =============================================================================

/**
 * 各状态允许迁移到的目标状态集合（不含恒等迁移）。
 * 注意：此处仅表达「结构上可能合法」的迁移；真实推进必须由独立授权的 OpenSpec change 显式执行，
 * 本函数不做授权判定，只做状态机层面的拦截。
 */
const SUPPORTED_STATUS_TRANSITIONS: Record<V25SurfaceStatus, readonly V25SurfaceStatus[]> = {
  // 终态：已交付归档事实不得被降级或改写（含降级为 deferred/rejected）。
  'verified-archived': [],
  // stub 接通后可升级为已交付归档（须独立授权的 change）。
  'archived-but-stub': ['verified-archived'],
  // 授权门可经显式授权升级为已交付，或收紧为延期。
  conditional: ['verified-archived', 'deferred'],
  // 延期项可经显式立项回到授权门或直接升级为已交付。
  deferred: ['conditional', 'verified-archived'],
  // 终态：已裁决拒绝不得直接变 verified-archived 或任何其他状态。
  rejected: [],
}

/**
 * 断言一次账本状态迁移在状态机层面是否受支持。
 *
 * @returns 迁移合法返回 `null`；非法返回 kind 为 `unsupported-status-transition` 的 issue。
 *   恒等迁移（from === to）恒合法。verified-archived 与 rejected 为终态，任何变化均非法。
 */
export function assertSupportedStatusTransition(
  from: V25SurfaceStatus,
  to: V25SurfaceStatus,
): LedgerValidationIssue | null {
  if (from === to) return null
  if (SUPPORTED_STATUS_TRANSITIONS[from].includes(to)) return null
  return {
    kind: 'unsupported-status-transition',
    message: `状态迁移 ${from} → ${to} 不受支持：verified-archived/rejected 为终态，conditional/deferred 仅可经独立授权的 change 显式推进。`,
  }
}

// =============================================================================
// 10. 账本校验与查询 helpers（任务 2.3）
// =============================================================================

/** 判断 sourceRef.path 是否为非空仓库相对路径（拒绝绝对路径、盘符、URL、越级 ..）。 */
function isRepoRelativePath(path: string): boolean {
  if (typeof path !== 'string' || path.trim() === '') return false
  if (path.startsWith('/') || path.startsWith('\\')) return false
  if (/^[a-zA-Z]:[\\/]/.test(path)) return false
  if (/^https?:\/\//i.test(path)) return false
  if (path.split(/[\\/]/).includes('..')) return false
  return true
}

/** 收集一组 sourceRefs 的结构问题（invalid-source-ref / missing-authoritative-ref）。 */
function collectSourceRefIssues(
  ownerId: string,
  sourceRefs: CompatibilitySourceRef[],
  requireAuthoritative: boolean,
): LedgerValidationIssue[] {
  const issues: LedgerValidationIssue[] = []
  if (sourceRefs.length === 0) {
    issues.push({
      kind: 'invalid-source-ref',
      message: `${ownerId} 没有任何 sourceRef：账本条目必须可追溯到证据来源。`,
      surfaceId: ownerId,
    })
    return issues
  }
  for (const ref of sourceRefs) {
    if (!isRepoRelativePath(ref.path)) {
      issues.push({
        kind: 'invalid-source-ref',
        message: `${ownerId} 的 sourceRef.path "${ref.path}" 非法：必须为非空仓库相对路径。`,
        surfaceId: ownerId,
      })
    }
  }
  if (
    requireAuthoritative &&
    !sourceRefs.some((ref) => (AUTHORITATIVE_SOURCE_KINDS as readonly string[]).includes(ref.kind))
  ) {
    issues.push({
      kind: 'missing-authoritative-ref',
      message: `${ownerId} 缺少权威证据引用：至少需一条 openspec-spec / openspec-archive / planning-doc。`,
      surfaceId: ownerId,
    })
  }
  return issues
}

/**
 * 校验兼容账本自身完整性（结构级，非被检 change 级）。
 *
 * 校验项：
 * - `duplicate-surface-id`：surfaceId 必须唯一。
 * - `missing-authoritative-ref`：每个 surface 至少一条 openspec-spec/openspec-archive/planning-doc。
 * - `invalid-source-ref`：sourceRef.path 非空且为仓库相对路径。
 * - `missing-ga-p0`：REQUIRED_GA_P0_SURFACE_IDS 全部存在。
 * - `missing-authorization-gate`：REQUIRED_AUTHORIZATION_GATE_IDS 全部存在。
 *
 * @returns 全部通过的账本返回空数组。
 */
export function validateCompatibilityLedger(ledger: CompatibilityLedger): LedgerValidationIssue[] {
  const issues: LedgerValidationIssue[] = []

  // surfaceId 唯一性
  const seen = new Set<string>()
  for (const surface of ledger.surfaces) {
    if (seen.has(surface.surfaceId)) {
      issues.push({
        kind: 'duplicate-surface-id',
        message: `surfaceId "${surface.surfaceId}" 重复：账本表面 ID 必须唯一。`,
        surfaceId: surface.surfaceId,
      })
    }
    seen.add(surface.surfaceId)
  }

  // 每个 surface 的 sourceRef 结构 + 权威引用
  for (const surface of ledger.surfaces) {
    issues.push(...collectSourceRefIssues(surface.surfaceId, surface.sourceRefs, true))
  }

  // 授权门/裁决/红线的 sourceRef 结构（不要求权威类别，但路径必须合法）
  for (const gate of ledger.authorizationGates) {
    issues.push(...collectSourceRefIssues(gate.gateId, gate.sourceRefs, false))
  }
  for (const decision of ledger.apiRuntimeDecisions) {
    issues.push(...collectSourceRefIssues(decision.decisionId, decision.sourceRefs, false))
  }
  for (const redLine of ledger.redLines) {
    issues.push(...collectSourceRefIssues(redLine.redLineId, redLine.sourceRefs, false))
  }

  // 必填 GA P0 三主线
  for (const requiredId of REQUIRED_GA_P0_SURFACE_IDS) {
    if (!ledger.surfaces.some((surface) => surface.surfaceId === requiredId)) {
      issues.push({
        kind: 'missing-ga-p0',
        message: `账本缺少必填 GA P0 表面 "${requiredId}"（observation-and-inventory.md §5.1）。`,
        surfaceId: requiredId,
      })
    }
  }

  // 必填授权门（§5.3 六项 conditional）
  for (const requiredId of REQUIRED_AUTHORIZATION_GATE_IDS) {
    if (!ledger.authorizationGates.some((gate) => gate.gateId === requiredId)) {
      issues.push({
        kind: 'missing-authorization-gate',
        message: `账本缺少必填授权门 "${requiredId}"（observation-and-inventory.md §5.3）。`,
      })
    }
  }

  return issues
}

/** 按 surfaceId 查询账本表面；未命中返回 undefined。 */
export function findLedgerSurface(
  ledger: CompatibilityLedger,
  surfaceId: string,
): CompatibilitySurface | undefined {
  return ledger.surfaces.find((surface) => surface.surfaceId === surfaceId)
}

/** 按 gateId 查询授权门；未命中返回 undefined。 */
export function getAuthorizationGate(
  ledger: CompatibilityLedger,
  gateId: string,
): AuthorizationGate | undefined {
  return ledger.authorizationGates.find((gate) => gate.gateId === gateId)
}
