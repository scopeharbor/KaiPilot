/**
 * performance-scale-fixtures.test —— V3 确定性规模 fixture 测试（任务 3.5）。
 *
 * 证明：
 * - 同一 profile + seed 重复生成 → 计数/标识/依赖形状/所有权绑定/source hash 完全一致。
 * - profile 体量有上界（bounded volumes）。
 * - 组织所有权绑定稳定：每个实体 ownerOrgId 合法且不跨租。
 * - 敏感字段缺失：fixture 序列化不含 secret/token/prompt/model output/原始 tenant id。
 * - AI/Compiler/报表/企业安全 mock 摘要零 provider 调用、人工确认边界保留。
 */
import { describe, expect, it } from 'vitest'
import { containsSensitiveContent, fnv1aHash } from './performance-and-scale-gates.js'
import {
  FIXTURE_PROFILE_NAMES,
  FIXTURE_PROFILE_SPECS,
  assertBoundedVolumes,
  computeSourceHash,
  fixtureCountMetrics,
  generateMockSummaries,
  generateProjectScaleFixture,
  generateTenantMirrorFixture,
  stableSerialize,
  type FixtureProfileName,
} from './performance-scale-fixtures.js'

const SEED = 'v3-performance-gates'

describe('确定性：重复生成完全一致', () => {
  for (const profile of FIXTURE_PROFILE_NAMES) {
    it(`${profile}: 两次生成 sourceHash/序列化一致`, { timeout: 60_000 }, () => {
      const a = generateProjectScaleFixture(profile, SEED)
      const b = generateProjectScaleFixture(profile, SEED)
      expect(a.sourceHash).toBe(b.sourceHash)
      expect(a.sourceHash).toBe(
        computeSourceHash({
          profile,
          seed: SEED,
          counts: a.counts,
          edges: a.gantt.edges,
          criticalPaths: a.gantt.criticalPaths,
          shape: a.organizations.map((o) => [
            o.orgId,
            o.projects.map((p) => [p.projectId, p.tasks.map((t) => t.taskId)]),
          ]),
        }),
      )
      expect(stableSerialize(a)).toBe(stableSerialize(b))
      expect(a.counts).toEqual(b.counts)
      expect(a.gantt.edges).toEqual(b.gantt.edges)
    })
  }

  it('不同 seed 产生不同 hash', () => {
    const a = generateProjectScaleFixture('smoke', SEED)
    const b = generateProjectScaleFixture('smoke', SEED + '-other')
    expect(a.sourceHash).not.toBe(b.sourceHash)
  })
})

describe('体量上界（bounded volumes）', () => {
  for (const profile of FIXTURE_PROFILE_NAMES) {
    it(`${profile}: 计数不超 profile 上界且为正`, () => {
      const fixture = generateProjectScaleFixture(profile, SEED)
      const bounds = FIXTURE_PROFILE_SPECS[profile]
      expect(assertBoundedVolumes(fixture)).toEqual([])
      expect(fixture.counts.organizations).toBeGreaterThan(0)
      expect(fixture.counts.tasks).toBeLessThanOrEqual(
        bounds.organizations * bounds.projectsPerOrg * bounds.tasksPerProject,
      )
      expect(fixture.counts.ganttTasks).toBe(fixture.counts.tasks)
      expect(fixture.counts.dependencyEdges).toBeGreaterThan(0)
    })
  }
})

describe('组织所有权绑定', () => {
  it('每个实体 ownerOrgId 为合成 org id 且不跨租', () => {
    const fixture = generateProjectScaleFixture('smoke', SEED)
    const orgIds = new Set(fixture.organizations.map((o) => o.orgId))
    for (const org of fixture.organizations) {
      expect(org.orgId).toMatch(/^org-\d+$/)
      for (const project of org.projects) {
        for (const task of project.tasks) {
          expect(task.ownerOrgId).toBe(org.orgId)
        }
        expect(orgIds.has(org.orgId)).toBe(true)
      }
    }
    for (const t of fixture.gantt.tasks) {
      expect(t.ownerOrgId).toMatch(/^org-\d+$/)
    }
  })

  it('依赖图无环（依赖只指向本项目内更小序号）', () => {
    const fixture = generateProjectScaleFixture('smoke', SEED)
    for (const edge of fixture.gantt.edges) {
      const from = Number(edge.from.split('-').pop())
      const to = Number(edge.to.split('-').pop())
      expect(from).toBeLessThan(to)
    }
  })

  it('关键路径链存在且长度 ≥ 2', () => {
    const fixture = generateProjectScaleFixture('smoke', SEED)
    expect(fixture.gantt.criticalPaths.length).toBeGreaterThan(0)
    for (const chain of fixture.gantt.criticalPaths) {
      expect(chain.length).toBeGreaterThanOrEqual(2)
    }
    expect(fixture.counts.criticalPathLength).toBe(
      fixture.gantt.criticalPaths.reduce((a, c) => a + c.length, 0),
    )
  })
})

describe('租户镜像 fixture', () => {
  it('重复生成一致 + 计数上界 + 所有权绑定', () => {
    const a = generateTenantMirrorFixture('smoke', SEED)
    const b = generateTenantMirrorFixture('smoke', SEED)
    expect(a.sourceHash).toBe(b.sourceHash)
    expect(stableSerialize(a)).toBe(stableSerialize(b))
    expect(a.counts.mirrors).toBeGreaterThan(0)
    expect(a.counts.totalTasks).toBeLessThanOrEqual(
      FIXTURE_PROFILE_SPECS.smoke.tenants * FIXTURE_PROFILE_SPECS.smoke.tasksPerProject * 2,
    )
    for (const e of a.entries) {
      expect(e.ownerOrgId).toMatch(/^org-\d+$/)
      expect(e.mirrorId).toMatch(/^m-\d+-\d+$/)
    }
  })

  it('不暴露原始跨租户标识', () => {
    const fixture = generateTenantMirrorFixture('smoke', SEED)
    const text = stableSerialize(fixture)
    expect(/\b(?:tenant[_ -]?id|tid)\b:\s*[A-Za-z0-9_-]{8,}/i.test(text)).toBe(false)
    expect(text).not.toMatch(/tenant[_ -]?id/i)
  })
})

describe('mock 摘要（AI/Compiler/报表/企业安全）', () => {
  it('AI draft streaming：零 provider 调用 + 人工确认边界保留 + 不落库', () => {
    const mock = generateMockSummaries('smoke', SEED)
    expect(mock.aiDraft.providerCalls).toBe(0)
    expect(mock.aiDraft.humanConfirmationBoundary).toBe('preserved')
    expect(mock.aiDraft.draftPersisted).toBe(false)
    expect(mock.aiDraft.streamEvents).toBeGreaterThan(0)
  })

  it('Compiler：validationRuns 正且有界、决策摘要无模型原文', () => {
    const mock = generateMockSummaries('smoke', SEED)
    expect(mock.compiler.validationRuns).toBeGreaterThan(0)
    expect(mock.compiler.validationRuns).toBeLessThanOrEqual(
      FIXTURE_PROFILE_SPECS.smoke.compilerValidations,
    )
    const text = stableSerialize(mock.compiler.decisionSummary)
    expect(/model_output|choices\[|generated_text/.test(text)).toBe(false)
    for (const d of mock.compiler.decisionSummary) {
      expect(['pass', 'soft-attention', 'hard-fail']).toContain(d.status)
    }
  })

  it('报表/导出/任务：合成 payload、体积有界', () => {
    const mock = generateMockSummaries('smoke', SEED)
    expect(mock.reportExportJob.syntheticPayload).toBe(true)
    expect(mock.reportExportJob.exportBytes).toBeLessThanOrEqual(
      FIXTURE_PROFILE_SPECS.smoke.exportBytes,
    )
    expect(mock.reportExportJob.jobs).toBeGreaterThan(0)
  })

  it('企业安全：全部本地合成、无敏感材料', () => {
    const mock = generateMockSummaries('smoke', SEED)
    expect(mock.enterpriseSecurity.syntheticOnly).toBe(true)
    expect(containsSensitiveContent(stableSerialize(mock.enterpriseSecurity))).toBe(false)
  })

  it('mock 摘要重复生成一致', () => {
    const a = generateMockSummaries('smoke', SEED)
    const b = generateMockSummaries('smoke', SEED)
    expect(a.sourceHash).toBe(b.sourceHash)
  })
})

describe('fixture 敏感字段缺失', () => {
  it('project fixture 序列化不含敏感关键词', () => {
    const fixture = generateProjectScaleFixture('smoke', SEED)
    const text = stableSerialize(fixture)
    expect(containsSensitiveContent(text)).toBe(false)
    for (const kw of ['sk-proj', 'ghp_', 'Bearer ', 'PRIVATE KEY', 'tenant_id', 'system prompt']) {
      expect(text).not.toContain(kw)
    }
  })

  it('fixtureCountMetrics 输出 count 类指标摘要', () => {
    const fixture = generateProjectScaleFixture('smoke', SEED)
    const metrics = fixtureCountMetrics(fixture)
    expect(metrics.length).toBeGreaterThanOrEqual(6)
    expect(metrics.find((m) => m.metric === 'tasks')?.observed).toBe(fixture.counts.tasks)
  })
})

describe('seed 派生稳定性', () => {
  it('fnv1aHash 与 seedFromString 确定性', () => {
    expect(fnv1aHash(SEED)).toBe(fnv1aHash(SEED))
    const p = (v: FixtureProfileName): number => generateProjectScaleFixture(v, SEED).counts.tasks
    expect(p('smoke')).toBe(p('smoke'))
  })
})
