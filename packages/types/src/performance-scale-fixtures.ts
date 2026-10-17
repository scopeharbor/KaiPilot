/**
 * performance-scale-fixtures —— V3 性能与规模门禁的确定性规模 fixture 生成器（D4）。
 *
 * 规则：
 * - 全部使用稳定 seed + mulberry32 PRNG 生成，禁止读取生产数据或跨租户记录。
 * - 三档 profile：smoke（默认）/ v3-default（可选）/ stress-local（archive/release 或显式运行）。
 * - 组织镜像：每个实体绑定其 owning organization；跨租户标识不暴露为原始报告明细
 *   （fixture 内只使用 org 本地合成 id，如 `t-1-42`，绝无真实 tenant id）。
 * - 资源归属、依赖密度、关键路径链、失败/降级样本、高风险流程句柄全部确定性生成。
 * - 所有 fixture 支持 `computeSourceHash`（稳定 hash），用于证明重复生成完全一致。
 * - AI/Compiler/企业安全 fixture 均为 mock 摘要，providerCalls 恒为 0（无真实 provider 调用）。
 */
import { fnv1aHash, type GateProfile, type MetricSummary } from './performance-and-scale-gates.js'

// =============================================================================
// 1. Fixture profile 规格
// =============================================================================

export const FIXTURE_PROFILE_NAMES = ['smoke', 'v3-default', 'stress-local'] as const
export type FixtureProfileName = (typeof FIXTURE_PROFILE_NAMES)[number]

/** 每档 profile 的体量上界（bounded volumes，catalog 预算以此为锚）。 */
export interface FixtureBounds {
  organizations: number
  projectsPerOrg: number
  tasksPerProject: number
  wbsLevels: number
  ganttTasks: number
  /** 0..1：任务间依赖密度。 */
  dependencyDensity: number
  criticalPathChains: number
  tenants: number
  connectionPools: number
  streamEvents: number
  compilerValidations: number
  reportRows: number
  exportBytes: number
  jobs: number
  renderNodes: number
}

export const FIXTURE_PROFILE_SPECS: Record<FixtureProfileName, FixtureBounds> = {
  smoke: {
    organizations: 2,
    projectsPerOrg: 3,
    tasksPerProject: 20,
    wbsLevels: 3,
    ganttTasks: 60,
    dependencyDensity: 0.25,
    criticalPathChains: 2,
    tenants: 2,
    connectionPools: 4,
    streamEvents: 50,
    compilerValidations: 5,
    reportRows: 100,
    exportBytes: 10 * 1024,
    jobs: 3,
    renderNodes: 100,
  },
  'v3-default': {
    organizations: 3,
    projectsPerOrg: 6,
    tasksPerProject: 80,
    wbsLevels: 4,
    ganttTasks: 300,
    dependencyDensity: 0.3,
    criticalPathChains: 4,
    tenants: 3,
    connectionPools: 8,
    streamEvents: 200,
    compilerValidations: 20,
    reportRows: 500,
    exportBytes: 64 * 1024,
    jobs: 8,
    renderNodes: 400,
  },
  'stress-local': {
    organizations: 5,
    projectsPerOrg: 15,
    tasksPerProject: 400,
    wbsLevels: 5,
    ganttTasks: 2000,
    dependencyDensity: 0.4,
    criticalPathChains: 10,
    tenants: 8,
    connectionPools: 32,
    streamEvents: 2000,
    compilerValidations: 100,
    reportRows: 5000,
    exportBytes: 1024 * 1024,
    jobs: 50,
    renderNodes: 5000,
  },
}

/** gate profile 与 fixture profile 的映射（smoke→smoke 等）。 */
export const GATE_TO_FIXTURE_PROFILE: Record<GateProfile, FixtureProfileName> = {
  smoke: 'smoke',
  'v3-default': 'v3-default',
  'stress-local': 'stress-local',
}

/** 依赖扫描窗口：每个任务最多向前扫描的前驱数（O(t*w) 生成，保证 stress 体量可控）。 */
export const MAX_DEP_SCAN = 10

// =============================================================================
// 2. 确定性 PRNG（mulberry32）
// =============================================================================

/** mulberry32：稳定 seed 的确定性 PRNG（0..1）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 从字符串 seed 派生数值 seed（确定性）。 */
export function seedFromString(s: string): number {
  return (fnv1aHash(s).slice(0, 8) + '00000000')
    .slice(0, 8)
    .split('')
    .reduce((acc, ch, i) => acc + ch.charCodeAt(0) * (i + 1), 0)
}

// =============================================================================
// 3. 项目 / 任务 / WBS / Gantt fixture
// =============================================================================

export interface FixtureTask {
  taskId: string
  name: string
  wbsPath: string
  durationDays: number
  dependencies: string[]
  ownerOrgId: string
  status: 'todo' | 'doing' | 'done'
}

export interface FixtureProject {
  projectId: string
  name: string
  tasks: FixtureTask[]
}

export interface FixtureOrganization {
  /** 合成 org id（org-1、org-2 …），绝不使用真实租户标识。 */
  orgId: string
  label: string
  projects: FixtureProject[]
}

export interface GanttFixtureEdge {
  from: string
  to: string
}

export interface GanttFixture {
  tasks: Array<{ taskId: string; projectId: string; ownerOrgId: string; durationDays: number }>
  edges: GanttFixtureEdge[]
  /** 关键路径链（每条 = 一串 taskId）。 */
  criticalPaths: string[][]
}

/** 项目/任务/WBS/Gantt 规模 fixture 根对象。 */
export interface ProjectScaleFixture {
  profile: FixtureProfileName
  seed: string
  organizations: FixtureOrganization[]
  gantt: GanttFixture
  sourceHash: string
  counts: {
    organizations: number
    projects: number
    tasks: number
    wbsNodes: number
    ganttTasks: number
    dependencyEdges: number
    criticalPathLength: number
  }
}

/** 确定性排序的 JSON 序列化（键排序，保证 hash 稳定）。 */
export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableSerialize(v)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries.map(([k, v]) => JSON.stringify(k) + ':' + stableSerialize(v)).join(',')}}`
  }
  return JSON.stringify(value)
}

/** 计算对象的稳定 source hash（确定性）。 */
export function computeSourceHash(value: unknown): string {
  return fnv1aHash(stableSerialize(value))
}

/**
 * 生成项目/任务/WBS/Gantt fixture（3.2）。
 * - 组织镜像：N 个 org，每 org 固定数量项目，每项目固定任务数。
 * - 依赖密度：按 density 概率在序号更小的任务间连边（保证 DAG、无环）。
 * - 关键路径链：显式构造 `criticalPathChains` 条链（任务首尾相接），
 *   链长 = 链内任务数（作为 critical-path-like 指标）。
 * - 全部实体绑定 ownerOrgId；id 为合成 id（`t-<orgIdx>-<n>`）。
 */
export function generateProjectScaleFixture(
  profile: FixtureProfileName = 'smoke',
  seed = 'v3-performance-gates',
): ProjectScaleFixture {
  const bounds = FIXTURE_PROFILE_SPECS[profile]
  const rand = mulberry32(seedFromString(seed))
  const organizations: FixtureOrganization[] = []
  const ganttTasks: GanttFixture['tasks'] = []
  const ganttEdges: GanttFixtureEdge[] = []
  const criticalPaths: string[][] = []

  let wbsNodes = 0
  let dependencyEdges = 0

  for (let o = 1; o <= bounds.organizations; o += 1) {
    const orgId = `org-${o}`
    const projects: FixtureProject[] = []
    for (let p = 1; p <= bounds.projectsPerOrg; p += 1) {
      const projectId = `p-${o}-${p}`
      const tasks: FixtureTask[] = []
      for (let t = 1; t <= bounds.tasksPerProject; t += 1) {
        const taskId = `t-${o}-${p}-${t}`
        const wbsLevel = Math.min(bounds.wbsLevels, 1 + Math.floor(rand() * 4))
        const wbsPath = Array.from(
          { length: wbsLevel },
          (_, i) => `W${i + 1}-${Math.floor(rand() * 9) + 1}`,
        ).join('/')
        wbsNodes += 1
        // 依赖：只指向本 project 内序号更小的任务 → 天然无环；
        // 扫描窗口 MAX_DEP_SCAN 限制前驱数（O(t*w)，stress 体量可控）
        const deps: string[] = []
        const scanStart = Math.max(1, t - MAX_DEP_SCAN)
        for (let d = scanStart; d < t; d += 1) {
          if (rand() < bounds.dependencyDensity) {
            deps.push(`t-${o}-${p}-${d}`)
            dependencyEdges += 1
            ganttEdges.push({ from: `t-${o}-${p}-${d}`, to: taskId })
          }
        }
        tasks.push({
          taskId,
          name: `任务 ${o}-${p}-${t}`,
          wbsPath,
          durationDays: 1 + Math.floor(rand() * 10),
          dependencies: deps,
          ownerOrgId: orgId,
          status: rand() < 0.6 ? 'done' : rand() < 0.5 ? 'doing' : 'todo',
        })
        ganttTasks.push({
          taskId,
          projectId,
          ownerOrgId: orgId,
          durationDays: 1 + Math.floor(rand() * 10),
        })
      }
      projects.push({ projectId, name: `项目 ${o}-${p}`, tasks })
    }
    organizations.push({ orgId, label: `组织镜像 ${o}`, projects })
  }

  // 关键路径链：在最后一个 org 的项目里显式构造链（首尾相接），不进 ganttEdges（避免重复边）
  const chainProject = organizations[organizations.length - 1]?.projects[0]
  const chainTasks = chainProject?.tasks ?? []
  for (let c = 0; c < bounds.criticalPathChains && chainTasks.length >= 3; c += 1) {
    const chain: string[] = []
    const step = Math.max(1, Math.floor(chainTasks.length / (bounds.criticalPathChains + 1)))
    for (let i = c * step; i < chainTasks.length && chain.length < 8; i += 1) {
      chain.push(chainTasks[i]!.taskId)
    }
    if (chain.length >= 2) criticalPaths.push(chain)
  }
  const criticalPathLength = criticalPaths.reduce((acc, c) => acc + c.length, 0)

  const counts = {
    organizations: organizations.length,
    projects: organizations.reduce((a, o) => a + o.projects.length, 0),
    tasks: organizations.reduce(
      (a, o) => a + o.projects.reduce((b, p) => b + p.tasks.length, 0),
      0,
    ),
    wbsNodes,
    ganttTasks: ganttTasks.length,
    dependencyEdges,
    criticalPathLength,
  }

  const fixture: ProjectScaleFixture = {
    profile,
    seed,
    organizations,
    gantt: { tasks: ganttTasks, edges: ganttEdges, criticalPaths },
    sourceHash: '',
    counts,
  }
  // 紧凑确定性摘要：只含 shape/计数/边，避免对 30k 级对象全量序列化（stress 性能）
  fixture.sourceHash = computeSourceHash({
    profile,
    seed,
    counts,
    edges: ganttEdges,
    criticalPaths,
    shape: organizations.map((o) => [
      o.orgId,
      o.projects.map((p) => [p.projectId, p.tasks.map((t) => t.taskId)]),
    ]),
  })
  return fixture
}

// =============================================================================
// 4. 租户镜像 fixture（3.3）
// =============================================================================

export interface TenantMirrorEntry {
  /** org 本地合成 id（`m-<orgIdx>-<n>`），绝无真实 tenant id。 */
  mirrorId: string
  ownerOrgId: string
  projectCount: number
  taskCount: number
  reportCount: number
  aiDraftCount: number
  compilerRunCount: number
  enterpriseSecurityCount: number
}

export interface TenantMirrorFixture {
  profile: FixtureProfileName
  seed: string
  entries: TenantMirrorEntry[]
  sourceHash: string
  counts: { mirrors: number; totalTasks: number }
}

/**
 * 生成多租户镜像 fixture：每个 org 一份结构相似的镜像数据（项目/任务/报表/AI/Compiler/
 * 企业安全计数），全部绑定 ownerOrgId。跨租户标识不暴露为原始报告明细——
 * 报告只允许出现 org 本地合成 id（mirrorId），不允许出现真实 tenant id 字符串。
 */
export function generateTenantMirrorFixture(
  profile: FixtureProfileName = 'smoke',
  seed = 'v3-performance-gates',
): TenantMirrorFixture {
  const bounds = FIXTURE_PROFILE_SPECS[profile]
  const rand = mulberry32(seedFromString(seed + ':tenant'))
  const entries: TenantMirrorEntry[] = []
  for (let o = 1; o <= bounds.tenants; o += 1) {
    for (let m = 1; m <= Math.max(1, Math.floor(bounds.organizations / 2)); m += 1) {
      const taskCount = Math.floor(rand() * bounds.tasksPerProject) + 5
      entries.push({
        mirrorId: `m-${o}-${m}`,
        ownerOrgId: `org-${o}`,
        projectCount: 1 + Math.floor(rand() * bounds.projectsPerOrg),
        taskCount,
        reportCount: 1 + Math.floor(rand() * 5),
        aiDraftCount: 1 + Math.floor(rand() * 3),
        compilerRunCount: 1 + Math.floor(rand() * bounds.compilerValidations),
        enterpriseSecurityCount: 1 + Math.floor(rand() * 4),
      })
    }
  }
  const fixture: TenantMirrorFixture = {
    profile,
    seed,
    entries,
    sourceHash: '',
    counts: {
      mirrors: entries.length,
      totalTasks: entries.reduce((a, e) => a + e.taskCount, 0),
    },
  }
  fixture.sourceHash = computeSourceHash({ profile, seed, entries })
  return fixture
}

// =============================================================================
// 5. AI / Compiler / 报表导出 / 企业安全 mock fixture 摘要（3.4）
// =============================================================================

export interface AiDraftStreamingMock {
  profile: FixtureProfileName
  seed: string
  /** mock 生成的 SSE 事件数（全部本地合成，providerCalls=0）。 */
  streamEvents: number
  providerCalls: 0
  /** AI 人工确认边界必须保留：所有 mock 摘要标注 draft 未落库。 */
  humanConfirmationBoundary: 'preserved'
  draftPersisted: false
  sourceHash: string
}

export interface CompilerValidationMock {
  profile: FixtureProfileName
  seed: string
  validationRuns: number
  /** 确定性决策摘要（低敏：只含 count/status，无模型原文）。 */
  decisionSummary: Array<{
    run: number
    status: 'pass' | 'soft-attention' | 'hard-fail'
    findings: number
  }>
  sourceHash: string
}

export interface ReportExportJobMock {
  profile: FixtureProfileName
  seed: string
  reportRows: number
  exportBytes: number
  jobs: number
  /** 导出物为合成字节（无生产数据）。 */
  syntheticPayload: boolean
  sourceHash: string
}

export interface EnterpriseSecurityMock {
  profile: FixtureProfileName
  seed: string
  dlpScans: number
  watermarkings: number
  auditEntries: number
  /** 全部本地合成，无真实凭据/密钥/跨租户数据。 */
  syntheticOnly: true
  sourceHash: string
}

export interface MockSummaries {
  aiDraft: AiDraftStreamingMock
  compiler: CompilerValidationMock
  reportExportJob: ReportExportJobMock
  enterpriseSecurity: EnterpriseSecurityMock
  sourceHash: string
}

/**
 * 生成 AI draft streaming / Compiler validation / report-export-job / enterprise-security
 * mock fixture 摘要（3.4）。全部为本地合成数据，providerCalls=0，无真实 provider 调用，
 * AI 人工确认边界保留（draftPersisted=false）。
 */
export function generateMockSummaries(
  profile: FixtureProfileName = 'smoke',
  seed = 'v3-performance-gates',
): MockSummaries {
  const bounds = FIXTURE_PROFILE_SPECS[profile]
  const rand = mulberry32(seedFromString(seed + ':mock'))

  const aiDraft: AiDraftStreamingMock = {
    profile,
    seed,
    streamEvents: bounds.streamEvents,
    providerCalls: 0,
    humanConfirmationBoundary: 'preserved',
    draftPersisted: false,
    sourceHash: '',
  }
  const compiler: CompilerValidationMock = {
    profile,
    seed,
    validationRuns: bounds.compilerValidations,
    decisionSummary: Array.from({ length: bounds.compilerValidations }, (_, i) => {
      const r = rand()
      return {
        run: i + 1,
        status: r < 0.7 ? 'pass' : r < 0.9 ? 'soft-attention' : 'hard-fail',
        findings: r < 0.7 ? 0 : 1 + Math.floor(rand() * 3),
      }
    }),
    sourceHash: '',
  }
  const reportExportJob: ReportExportJobMock = {
    profile,
    seed,
    reportRows: bounds.reportRows,
    exportBytes: bounds.exportBytes,
    jobs: bounds.jobs,
    syntheticPayload: true,
    sourceHash: '',
  }
  const enterpriseSecurity: EnterpriseSecurityMock = {
    profile,
    seed,
    dlpScans: 1 + Math.floor(rand() * 5),
    watermarkings: 1 + Math.floor(rand() * 3),
    auditEntries: 5 + Math.floor(rand() * 10),
    syntheticOnly: true,
    sourceHash: '',
  }

  aiDraft.sourceHash = computeSourceHash(aiDraft)
  compiler.sourceHash = computeSourceHash(compiler)
  reportExportJob.sourceHash = computeSourceHash(reportExportJob)
  enterpriseSecurity.sourceHash = computeSourceHash(enterpriseSecurity)

  return {
    aiDraft,
    compiler,
    reportExportJob,
    enterpriseSecurity,
    sourceHash: computeSourceHash({ aiDraft, compiler, reportExportJob, enterpriseSecurity }),
  }
}

// =============================================================================
// 6. Metric 观察辅助（runner 消费）
// =============================================================================

/** 从 fixture counts 构造 gate metric 观察值（count 类）。 */
export function fixtureCountMetrics(fixture: ProjectScaleFixture): MetricSummary[] {
  return [
    { metric: 'projects', kind: 'count', observed: fixture.counts.projects },
    { metric: 'tasks', kind: 'count', observed: fixture.counts.tasks },
    { metric: 'wbs-nodes', kind: 'count', observed: fixture.counts.wbsNodes },
    { metric: 'gantt-tasks', kind: 'count', observed: fixture.counts.ganttTasks },
    { metric: 'dependency-edges', kind: 'count', observed: fixture.counts.dependencyEdges },
    { metric: 'critical-path-length', kind: 'count', observed: fixture.counts.criticalPathLength },
  ]
}

/** 验证 fixture 体量不超过 profile 上界（bounded volumes 断言用）。 */
export function assertBoundedVolumes(fixture: ProjectScaleFixture): string[] {
  const bounds = FIXTURE_PROFILE_SPECS[fixture.profile]
  const issues: string[] = []
  if (fixture.counts.organizations > bounds.organizations) issues.push('organizations 超上界')
  if (
    fixture.counts.tasks >
    bounds.organizations * bounds.projectsPerOrg * bounds.tasksPerProject
  ) {
    issues.push('tasks 超上界')
  }
  if (
    fixture.counts.ganttTasks >
    bounds.organizations * bounds.projectsPerOrg * bounds.tasksPerProject
  ) {
    issues.push('ganttTasks 超上界')
  }
  return issues
}
