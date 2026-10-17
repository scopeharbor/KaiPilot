/**
 * v3-uat-release-stabilization —— 发布稳定化契约的确定性 fixtures（任务 2.2）。
 *
 * 覆盖六态：passing / blocked / deferred / authorization-gated / missing-specialized-gate / stale-scope，
 * 供契约单测与本地稳定化检查 CLI（fixture-first）使用。所有 fixture 低敏：不含 secret/token/
 * 原始 prompt/模型输出/provider 载荷/完整日志/生产数据/跨租户明细。
 */

import {
  REQUIRED_STABILIZATION_ARTIFACTS,
  RELEASE_CRITICAL_WORKFLOWS,
  type EvidenceManifest,
  type EvidenceGate,
  type ScopeLedger,
  type SpecializedGateSummary,
  type StabilizationInput,
  type TriageFinding,
  type UatMatrix,
  type UatScenario,
} from './v3-uat-release-stabilization.js'

/** fixture 固定捕获时间（与 apply 会话一致，fresh）。 */
export const UAT_FIXTURE_CAPTURED_AT = '2026-08-16'

/** 全部必填工件在列（passing 用）。 */
export function fixtureArtifactsAllPresent(): string[] {
  return [...REQUIRED_STABILIZATION_ARTIFACTS]
}

// =============================================================================
// Scope ledger fixture
// =============================================================================

export function makeScopeLedgerFixture(overrides: Partial<ScopeLedger> = {}): ScopeLedger {
  return {
    capture: {
      capturedAt: UAT_FIXTURE_CAPTURED_AT,
      openspecListRef:
        'openspec/changes/v3-uat-and-release-stabilization/observation-and-inventory.md §2.1',
      perChangeStatusRefs: ['同上 §2.2'],
      archivedDependencyRefs: ['openspec/changes/archive/'],
      gitHeadSha: '8c89390c',
      graphFreshnessNote:
        'codebase-memory aiproj fresh（79035 nodes）；已知漏索引缺口见 observation §1.2',
      progressRefs: [
        'progress/current-focus.md',
        'progress/completed.md',
        'progress/next-candidates.md',
      ],
    },
    v3ReleaseMapGap: true,
    authorityNote:
      'V3 release 裁决依据当前 OpenSpec 状态/progress/归档规范与直接证据；V2.5 release map 是历史收口记录，不作为 V3 authority。',
    authorityRefs: ['docs/v2-v3/planning/v3-development-baseline.md'],
    entries: [
      {
        id: 'uat-release-stabilization',
        label: 'V3 UAT 与发布稳定化收口治理（本 change）',
        status: 'active',
        sourceRefs: ['openspec/changes/v3-uat-and-release-stabilization/'],
      },
      {
        id: 'v3-performance-and-scale-gates',
        label: '性能/规模专项门禁（上游证据输入）',
        status: 'archived',
        rationale: '46/46 complete，摘要见 release-evidence-manifest §4.1',
        sourceRefs: ['openspec/changes/v3-performance-and-scale-gates/'],
      },
      {
        id: 'v3-security-and-penetration-gate',
        label: '安全/渗透专项门禁',
        status: 'blocked',
        rationale: 'apply 未开始，无证据输出（pending 输入）',
        sourceRefs: ['openspec/changes/v3-security-and-penetration-gate/'],
      },
      {
        id: 'containerization',
        label: '容器化/私有化部署',
        status: 'excluded',
        rationale: '项目红线：本机启动优先',
        sourceRefs: ['docs/v2-v3/planning/v3-development-baseline.md'],
      },
      {
        id: 'v3-release-map',
        label: '权威 V3 release map',
        status: 'deferred',
        rationale: '本 ledger 为首个受控 scope 工件；正式 release map 另立 change',
      },
      {
        id: 'real-oauth-token-exchange',
        label: '真实 OAuth/token 交换',
        status: 'authorization-gated',
        rationale: '未授权默认 fixture/mock',
      },
      {
        id: 'v3-ga-declaration',
        label: '最终 V3 GA 声明',
        status: 'blocked',
        rationale: '无权威 release map + 安全门禁 pending + 浏览器 smoke 未执行',
      },
    ],
    ...overrides,
  }
}

// =============================================================================
// UAT matrix fixture
// =============================================================================

function makeScenario(
  id: string,
  workflow: string,
  actor: string,
  severity: UatScenario['severity'],
  status: UatScenario['status'] = 'planned',
  extra: Partial<UatScenario> = {},
): UatScenario {
  return {
    id,
    workflow,
    actor,
    tenantContext: '测试组织 A（fixture seed）',
    fixture: 'fixtures/uat/*.json（本地 seed，无生产数据）',
    entryPoint: '本机 localhost 应用',
    expectedEvidence: '低敏行为断言 + 审计记录',
    severity,
    status,
    ...extra,
  }
}

export function makeUatMatrixFixture(overrides: Partial<UatMatrix> = {}): UatMatrix {
  return {
    scenarios: [
      makeScenario('UAT-001', 'project-task-workflows', '专业PM', 'release-blocking', 'planned', {
        expectedEvidence: '项目/任务 CRUD 在测试组织 A 内可见；RBAC 断言；审计记录',
      }),
      makeScenario('UAT-002', 'project-task-workflows', '非专业入门者', 'high', 'planned', {
        expectedEvidence: '直觉入口与专业入口共用同一数据模型',
      }),
      makeScenario('UAT-003', 'ai-draft-preview-confirm', '专业PM', 'release-blocking', 'planned', {
        expectedEvidence:
          'AI 输出保持 draft/candidate，未经授权人工确认不得落库；确认走既有审查边界',
        assertions: ['AI 只建议不自动执行', '确认前零持久化'],
      }),
      makeScenario('UAT-004', 'tenant-selection', '团队成员', 'high', 'planned', {
        expectedEvidence: '组织选择/切换受保护；跨租资源隐藏（404/非泄露拒绝）',
      }),
      makeScenario('UAT-005', 'enterprise-governance', '组织管理员', 'high', 'planned', {
        expectedEvidence: 'RBAC/租户隔离/审计在企业治理面生效；sso/scim 配置面仅管理员可见',
      }),
      makeScenario('UAT-006', 'audit-evidence', '组织管理员', 'medium', 'planned', {
        expectedEvidence: '关键操作审计落库且低敏；审计查询按组织隔离',
      }),
      makeScenario('UAT-007', 'reporting-export', '专业PM', 'high', 'planned', {
        expectedEvidence: '报表/导出/下载只含本组织数据；导出 job 租户 scope 绑定',
      }),
      makeScenario('UAT-008', 'cross-tenant-negative', '团队成员', 'release-blocking', 'planned', {
        expectedEvidence: '跨租访问被非泄露拒绝或隐藏资源（与租户隔离规范一致）',
        assertions: ['响应体不泄露存在性', '不返回跨租明细'],
      }),
    ],
    workflowDeferrals: [],
    ...overrides,
  }
}

// =============================================================================
// Evidence manifest fixture
// =============================================================================

function makeGate(
  gateId: string,
  name: string,
  status: EvidenceGate['status'],
  extra: Partial<EvidenceGate> = {},
): EvidenceGate {
  return {
    gateId,
    name,
    scope: 'fixture',
    status,
    resultSummary: 'fixture 摘要（低敏）',
    timestamp: UAT_FIXTURE_CAPTURED_AT,
    owner: 'fixture',
    ...extra,
  }
}

const PASSING_SPECIALIZED: SpecializedGateSummary[] = [
  {
    gateId: 'performance-scale',
    sourceChange: 'v3-performance-and-scale-gates',
    sourceArtifact: 'packages/types/src/performance-gate-runner.ts',
    scope: 'smoke 18 gates',
    status: 'passed',
    blockingFindings: [],
    residualRisk: ['real-provider-smoke 未授权（skipped，授权门）'],
    commandRefs: [
      'pnpm performance:gates -- --change v3-performance-and-scale-gates --profile smoke',
    ],
    date: UAT_FIXTURE_CAPTURED_AT,
  },
  {
    gateId: 'security-penetration',
    sourceChange: 'v3-security-and-penetration-gate',
    sourceArtifact: 'openspec/changes/v3-security-and-penetration-gate/',
    scope: 'propose 完成，apply 未开始',
    status: 'pending',
    blockingFindings: [],
    residualRisk: ['安全/渗透专项门禁未落地：release candidate 不以此覆盖'],
    commandRefs: [],
    date: UAT_FIXTURE_CAPTURED_AT,
  },
]

const DEFERRAL_FINDING: TriageFinding = {
  findingId: 'F-DEF-001',
  category: 'deferred',
  summary:
    '真实外部 provider smoke / OAuth / Webhook / Web Push / 公开发布 / 大规模真实模型评测未授权',
  rationale: '设计性延期（授权门）：默认 fixture/mock 可验证边界',
  evidenceRef: 'docs/v2-v3/planning/v3-uat-release-stabilization/scope-ledger.md §2.6',
  owner: '用户授权',
  nextAction: '用户明确授权后按 AuthorizedRealVerification 模板记录',
  releaseImpact: '不影响本地稳定化结论；影响真实外部验证声明',
}

/** 深拷贝专项门禁摘要（防模块级共享引用被测试原地修改污染）。 */
function cloneSpecializedGates(): SpecializedGateSummary[] {
  return PASSING_SPECIALIZED.map((g) => ({
    ...g,
    blockingFindings: [...g.blockingFindings],
    residualRisk: [...g.residualRisk],
    commandRefs: [...g.commandRefs],
  }))
}

/** 深拷贝 deferred finding（同上）。 */
function cloneDeferralFinding(): TriageFinding {
  return { ...DEFERRAL_FINDING }
}

export function makeEvidenceManifestFixture(
  overrides: Partial<EvidenceManifest> = {},
): EvidenceManifest {
  return {
    manifestId: 'v3-uat-release-evidence-fixture-passing',
    createdAt: UAT_FIXTURE_CAPTURED_AT,
    releaseStatus: 'ready',
    releaseClaim: 'locally-stabilized-with-deferrals',
    gates: [
      makeGate('openspec', 'OpenSpec strict validation', 'passed'),
      makeGate('typecheck', '受影响包 typecheck', 'passed'),
      makeGate('lint', 'ESLint（我方文件）', 'passed'),
      makeGate('format', 'Prettier（我方文件）', 'passed'),
      makeGate('tests', '契约 focused 单测', 'passed'),
      makeGate('build', '构建', 'skipped', {
        triageNote: '治理型 change 无产物构建面；turbo build 不适用，显式记录跳过',
      }),
      makeGate('browser-smoke', '浏览器 smoke', 'skipped', {
        triageNote: '本机 UAT 轮次未执行；环境波动分类见 uat-matrix.md §6.5',
      }),
      makeGate('specialized-gates', '专项门禁输入', 'pending', {
        triageNote: 'performance passed（摘要见下）；security pending（apply 未开始）',
      }),
      makeGate('uat-scenarios', 'UAT 场景', 'pending', {
        triageNote: 'matrix 已规划（planned），执行留待正式 UAT 轮次',
      }),
      makeGate('known-issues', '已知问题', 'passed'),
    ],
    specializedGates: cloneSpecializedGates(),
    findings: [cloneDeferralFinding()],
    authorizedRealVerifications: [],
    knownIssues: [],
    // v3-release-gate-ai-quality-slots 新增：五个 AI 门槽（全绿 fixture）
    aiQualitySlots: [
      {
        slotId: 'ai-output-quality',
        name: '输出质量',
        status: 'passed',
        runReference: {
          evidenceSource: 'online-evaluation',
          runId: 'eval-run-fixture-001',
          runAt: '2026-08-22T11:00:00.000Z',
        },
        criterion: '最近一次在线评测运行的通过率 >= 阈值',
        aggregateValue: 0.92,
        aggregateDescription: '通过率 92.0%（460/500）',
        evaluatedAt: '2026-08-22T12:00:00.000Z',
        organizationId: 42,
      },
      {
        slotId: 'ai-offline-regression',
        name: '离线回归',
        status: 'passed',
        runReference: {
          evidenceSource: 'offline-eval-dataset',
          runId: 'offline-run-fixture-001',
          runAt: '2026-08-22T10:30:00.000Z',
        },
        criterion: '最近一次离线回归运行无样本回归',
        aggregateValue: 0,
        aggregateDescription: '无回归（共 100 样本）',
        evaluatedAt: '2026-08-22T12:00:00.000Z',
        organizationId: 42,
      },
      {
        slotId: 'ai-cost',
        name: '成本',
        status: 'passed',
        runReference: {
          evidenceSource: 'invocation-ledger',
          runId: 'cost-window-fixture-001',
          runAt: '2026-08-22T12:00:00.000Z',
        },
        criterion: '最近一个时间窗口的累计成本 <= 预算上限',
        aggregateValue: 12.5,
        aggregateDescription: '累计成本 12.5000 / 预算 50.0000（120 次调用）',
        evaluatedAt: '2026-08-22T12:00:00.000Z',
        organizationId: 42,
      },
      {
        slotId: 'ai-model-drift',
        name: '模型漂移',
        status: 'passed',
        runReference: {
          evidenceSource: 'drift-detection',
          runId: 'drift-run-fixture-001',
          runAt: '2026-08-22T09:00:00.000Z',
        },
        criterion: '无未经确认的漂移事件',
        aggregateValue: 0,
        aggregateDescription: '无未经确认的漂移事件',
        evaluatedAt: '2026-08-22T12:00:00.000Z',
        organizationId: 42,
      },
      {
        slotId: 'ai-security-events',
        name: '安全事件',
        status: 'passed',
        runReference: {
          evidenceSource: 'security-observability',
          runId: 'security-window-fixture-001',
          runAt: '2026-08-22T12:00:00.000Z',
        },
        criterion: '最近一个时间窗口的安全事件聚合计数 = 0',
        aggregateValue: 0,
        aggregateDescription: '无安全事件',
        evaluatedAt: '2026-08-22T12:00:00.000Z',
        organizationId: 42,
      },
    ],
    ...overrides,
  }
}

// =============================================================================
// 六态 StabilizationInput fixtures（任务 2.2）
// =============================================================================

function makeBaseInput(manifest: EvidenceManifest): StabilizationInput {
  return {
    artifactsPresent: fixtureArtifactsAllPresent(),
    tasksComplete: true,
    ledger: makeScopeLedgerFixture(),
    matrix: makeUatMatrixFixture(),
    manifest,
  }
}

/** 1/6 passing：全部门禁/专项门禁/延期齐备，无 release-blocking。 */
export function makePassingStabilizationInput(): StabilizationInput {
  return makeBaseInput(makeEvidenceManifestFixture())
}

/** 2/6 blocked：存在未解决 release-blocking finding。 */
export function makeBlockedStabilizationInput(): StabilizationInput {
  const manifest = makeEvidenceManifestFixture({
    releaseStatus: 'not-ready',
    findings: [
      {
        findingId: 'F-BLK-001',
        category: 'release-blocking',
        summary: '示例阻塞：release-critical 工作流回归未通过（fixture）',
        rationale: 'fixture 构造的阻塞示例',
        evidenceRef: 'fixture',
        owner: 'fixture',
        nextAction: '修复并重跑回归',
        releaseImpact: '发布声明被阻塞',
      },
    ],
  })
  return makeBaseInput(manifest)
}

/** 3/6 deferred：deferred finding 齐备（rationale/nextAction），可 ready。 */
export function makeDeferredStabilizationInput(): StabilizationInput {
  return makeBaseInput(makeEvidenceManifestFixture())
}

/** 4/6 authorization-gated：授权门 finding 可见且无任何真实验证记录。 */
export function makeAuthorizationGatedStabilizationInput(): StabilizationInput {
  const manifest = makeEvidenceManifestFixture({
    manifestId: 'v3-uat-release-evidence-fixture-auth-gated',
    findings: [
      DEFERRAL_FINDING,
      {
        findingId: 'F-AUTH-001',
        category: 'authorization-gated',
        summary: '真实 OAuth/token 交换未授权：证据为 fixture/mock',
        rationale: '用户未授权真实 token 交换',
        evidenceRef: 'scope-ledger.md §2.6',
        owner: '用户授权',
        nextAction: '授权后按 AuthorizedRealVerification 模板记录',
        releaseImpact: '真实外部验证声明受限',
      },
    ],
  })
  return makeBaseInput(manifest)
}

/** 5/6 missing-specialized-gate：security 专项门禁摘要缺失（不得计为 passed）。 */
export function makeMissingSpecializedGateStabilizationInput(): StabilizationInput {
  const manifest = makeEvidenceManifestFixture({
    manifestId: 'v3-uat-release-evidence-fixture-missing-specialized',
    specializedGates: cloneSpecializedGates().filter((g) => g.gateId !== 'security-penetration'),
  })
  return makeBaseInput(manifest)
}

/** 6/6 stale-scope：scope ledger 捕获时间过期（阻塞发布声明）。 */
export function makeStaleScopeStabilizationInput(): StabilizationInput {
  return {
    ...makeBaseInput(makeEvidenceManifestFixture()),
    ledger: makeScopeLedgerFixture({
      capture: { ...makeScopeLedgerFixture().capture, capturedAt: '2020-01-01' },
    }),
  }
}

/** 缺工件变体：missing artifact 必须被低敏指出（任务 4.4）。 */
export function makeMissingArtifactStabilizationInput(): StabilizationInput {
  return {
    ...makePassingStabilizationInput(),
    artifactsPresent: fixtureArtifactsAllPresent().filter(
      (path) => path !== 'docs/v2-v3/planning/v3-uat-release-stabilization/uat-matrix.md',
    ),
  }
}

/** 未完成任务变体。 */
export function makeTasksIncompleteStabilizationInput(): StabilizationInput {
  return { ...makePassingStabilizationInput(), tasksComplete: false }
}

/** UAT matrix 缺 release-critical 工作流场景变体（任务 3.3）。 */
export function makeMissingWorkflowScenarioInput(): StabilizationInput {
  const matrix = makeUatMatrixFixture()
  matrix.scenarios = matrix.scenarios.filter((s) => s.workflow !== 'cross-tenant-negative')
  return { ...makePassingStabilizationInput(), matrix }
}

/** 未授权真实动作变体（任务 5.4 断言素材）。 */
export function makeUnauthorizedActionInput(): StabilizationInput {
  return makeAuthorizationGatedStabilizationInput()
}

/** 供测试直接引用的场景 id 常量。 */
export const UAT_FIXTURE_WORKFLOWS: readonly string[] = [...RELEASE_CRITICAL_WORKFLOWS]
