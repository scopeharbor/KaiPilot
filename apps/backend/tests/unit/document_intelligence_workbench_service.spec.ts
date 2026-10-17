/**
 * Document Intelligence Workbench Service 单元测试（vitest，fake ports）
 *
 * 覆盖 tasks §3：
 * - 3.2  read ports 静态/运行时回归：owning command 无法注入
 * - 3.11 Map-based 线性合并、server-authoritative entrypoint
 * - 3.12 核心 source 失败 fail-closed、维度单独降级、禁止 false-zero/false-ready、
 *        无 N+1（port 调用族数为常数）
 * - 3.15/3.16 Validator 封闭枚举与边界（vine 运行时验证）
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  assertNoOwningCommands,
  DOCUMENT_INTELLIGENCE_PORT_KEYS,
  type DocumentIntelligenceReadPorts,
  type WorkbenchSourceRow,
} from '#services/document_intelligence/read_ports'
import DocumentIntelligenceWorkbenchService from '#services/document_intelligence/workbench_service'
import {
  assertOnlyAllowedQueryKeys,
  documentIntelligenceListQueryValidator,
  documentIntelligenceSourceParamsValidator,
} from '#validators/document_intelligence'
import type { DocumentIntelligenceListQuery } from '@aiproj/types'

/** 默认适配器源码路径（纯逻辑单测不直接 import，避免拉起 Lucid 模型图） */
const ADAPTER_SOURCE_PATH = fileURLToPath(
  new URL('../../app/services/document_intelligence/default_read_adapters.ts', import.meta.url),
)

// ─── fake ports ──────────────────────────────────────────────────────────

function makeRow(
  kind: WorkbenchSourceRow['sourceKind'],
  id: number,
  overrides: Partial<WorkbenchSourceRow> = {},
): WorkbenchSourceRow {
  return {
    sourceKind: kind,
    sourceId: id,
    displayName: `src-${kind}-${id}`,
    mimeType: kind === 'attachment' ? 'application/pdf' : null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

interface FakeWorld {
  rows: WorkbenchSourceRow[]
}

function makeFakePorts(world: FakeWorld) {
  const calls: string[] = []
  const ports: DocumentIntelligenceReadPorts = {
    async pageVisibleSources(params) {
      calls.push('pageVisibleSources')
      const start = (params.page - 1) * params.perPage
      return { items: world.rows.slice(start, start + params.perPage), total: world.rows.length }
    },
    async loadLatestJobsBySourceIds(params) {
      calls.push(`loadLatestJobsBySourceIds:${params.sourceIds.length}`)
      const map = new Map()
      for (const id of params.sourceIds) {
        if (id % 10 === 7) continue // 模拟部分源无 job
        map.set(id, {
          jobId: id * 1000,
          sourceAttachmentId: id,
          status: 'reviewable',
          warningCodes: [],
          succeededPages: 1,
          pageCount: 2,
          provider: 'fake-adapter',
          costSummaryPresent: false,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        })
      }
      return map
    },
    async loadExtractionsBySourceIds() {
      calls.push('loadExtractionsBySourceIds')
      return new Map()
    },
    async loadSearchIndexEntriesBySourceIds() {
      calls.push('loadSearchIndexEntriesBySourceIds')
      return new Map()
    },
    async loadSnapshotSummariesByExtractionIds() {
      calls.push('loadSnapshotSummariesByExtractionIds')
      return new Map()
    },
    async loadEntityLinkSummariesByExtractionIds() {
      calls.push('loadEntityLinkSummariesByExtractionIds')
      return { rows: new Map(), available: true }
    },
    async loadGovernanceSummary() {
      calls.push('loadGovernanceSummary')
      return {
        available: true,
        retentionHoldActive: false,
        retentionExpiredCount: 0,
        privacyBlocked: false,
        privacyOutputMode: 'snippet',
        auditAccess: 'restricted' as const,
        profileProvenance: null,
      }
    },
  }
  return { ports, calls }
}

const ACCESS = { readOnly: false, canManageFiles: true, canReadAudit: false }

const BASE_QUERY: DocumentIntelligenceListQuery = {
  attention: null,
  sourceKind: null,
  capability: null,
  status: null,
  sort: 'updated_at',
  direction: 'desc',
  page: 1,
  perPage: 20,
  search: null,
}

// ─── 3.2 owning command 注入防护 ────────────────────────────────────────

describe('read ports | owning command 注入防护', () => {
  it('封闭键集之外的功能属性被运行时守卫拒绝', () => {
    const fake = makeFakePorts({ rows: [] }).ports as unknown as Record<string, unknown>
    const malicious = {
      ...fake,
      confirmJob: async () => null,
      executeIndexing: async () => null,
    }
    const result = assertNoOwningCommands(malicious)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violations.sort()).toEqual(['confirmJob', 'executeIndexing'])
    }
  })

  it('合法 read ports 通过守卫；默认适配器方法集与封闭词表一致（源码级）', () => {
    expect(assertNoOwningCommands(makeFakePorts({ rows: [] }).ports).ok).toBe(true)

    const source = readFileSync(ADAPTER_SOURCE_PATH, 'utf-8')
    const methods = [...source.matchAll(/async (pageVisibleSources|load[A-Za-z]+)\(/g)].map(
      (m) => m[1],
    )
    expect(methods.sort()).toEqual([...DOCUMENT_INTELLIGENCE_PORT_KEYS].sort())
    // 源码中不存在任何 owning 命令形态的方法定义
    expect(
      source.match(/async (confirm|execute|create|retry|export|cleanup)[A-Za-z]*\(/),
    ).toBeNull()
    // 运行时守卫对从源码提取的方法名对象同样放行
    const shape = Object.fromEntries(methods.map((m) => [m, async () => null]))
    expect(assertNoOwningCommands(shape).ok).toBe(true)
  })

  it('静态回归：向 ports 字面量注入命令方法必须类型报错（excess property check）', () => {
    const fake = makeFakePorts({ rows: [] }).ports
    // @ts-expect-error — owning command 不属于 DocumentIntelligenceReadPorts
    const bad: DocumentIntelligenceReadPorts = { ...fake, confirmationSave: async () => null }
    void bad
    expect(true).toBe(true)
  })
})

// ─── 3.11 合并与 entrypoint ─────────────────────────────────────────────

describe('listSources | Map-based 线性合并与 entrypoint', () => {
  it('native document 显示 ocr_not_applicable 且无 review 入口；attachment reviewable 有 review 入口', async () => {
    const world: FakeWorld = {
      rows: [makeRow('native_document', 1), makeRow('attachment', 2)],
    }
    const svc = new DocumentIntelligenceWorkbenchService(makeFakePorts(world).ports)
    const res = await svc.listSources({
      organizationId: 1,
      projectId: 1,
      query: BASE_QUERY,
      access: ACCESS,
    })

    expect(res.meta.countMode).toBe('exact') // 全量在预算内且无维度过滤 → 诚实 exact
    const native = res.data.find((r) => r.sourceKind === 'native_document')!
    expect(native.dimensionStates.ocr_job).toBe('not_applicable')
    const nativeReview = native.entrypoints.find((e) => e.surface === 'review')!
    expect(nativeReview.enabled).toBe(false)

    const att = res.data.find((r) => r.sourceKind === 'attachment')!
    expect(att.attentionFacets).toContain('needs_review')
    const reviewEp = att.entrypoints.find((e) => e.surface === 'review')!
    expect(reviewEp.enabled).toBe(true)
    expect(reviewEp.confirmationOwnedBy).toBe('ocr-review-confirmation-flow')
    // 无 current extraction → 下游入口禁用且带低敏原因
    const searchEp = att.entrypoints.find((e) => e.surface === 'search_index')!
    expect(searchEp.enabled).toBe(false)
    expect(searchEp.reasonCode).toBe('no_accepted_extraction')
  })

  it('只读用户：所有 owning 写入面板入口 disabled（client 无法声称 allowed）', async () => {
    const world: FakeWorld = { rows: [makeRow('attachment', 5)] }
    const svc = new DocumentIntelligenceWorkbenchService(makeFakePorts(world).ports)
    const res = await svc.listSources({
      organizationId: 1,
      projectId: 1,
      query: BASE_QUERY,
      access: { readOnly: true, canManageFiles: false, canReadAudit: false },
    })
    for (const ep of res.data[0].entrypoints) {
      if (
        ['review', 'search_index', 'structured_extraction', 'entity_linking'].includes(ep.surface)
      ) {
        expect(ep.enabled).toBe(false)
      } else {
        expect(ep.enabled).toBe(true) // document_reader/governance 只读可用
      }
    }
  })
})

// ─── 3.12 fail-closed / 维度隔离 / N+1 门禁 ─────────────────────────────

describe('listSources | 失败隔离与查询预算', () => {
  it('核心来源失败 → 整体 fail closed 抛错', async () => {
    const { ports } = makeFakePorts({ rows: [] })
    const failing: DocumentIntelligenceReadPorts = {
      ...ports,
      async pageVisibleSources() {
        throw new Error('db down')
      },
    }
    const svc = new DocumentIntelligenceWorkbenchService(failing)
    await expect(
      svc.listSources({ organizationId: 1, projectId: 1, query: BASE_QUERY, access: ACCESS }),
    ).rejects.toThrow('db down')
  })

  it('实体关联摘要不可用 → 该维度显式 unavailable，其余维度不受影响', async () => {
    const { ports } = makeFakePorts({
      rows: [makeRow('attachment', 3)],
    })
    const degraded: DocumentIntelligenceReadPorts = {
      ...ports,
      async loadEntityLinkSummariesByExtractionIds() {
        return { rows: new Map(), available: false }
      },
    }
    const svc = new DocumentIntelligenceWorkbenchService(degraded)
    const res = await svc.listSources({
      organizationId: 1,
      projectId: 1,
      query: BASE_QUERY,
      access: ACCESS,
    })
    expect(res.data[0].dimensionStates.entity_link).toBe('unavailable')
    expect(res.data[0].dimensionStates.governance).toBe('ready')
  })

  it('port 调用族数为常数：不随行数线性增长（无逐行 N+1）', async () => {
    const bigRows = Array.from({ length: 300 }, (_, i) =>
      makeRow(i % 2 === 0 ? 'attachment' : 'native_document', i + 1),
    )
    const { ports, calls } = makeFakePorts({ rows: bigRows })
    const svc = new DocumentIntelligenceWorkbenchService(ports)
    await svc.listSources({ organizationId: 1, projectId: 1, query: BASE_QUERY, access: ACCESS })
    // 6 个维度族各至多调用一次（snapshot 族在无 extraction 时也调用一次）
    expect(calls.length).toBeLessThanOrEqual(7)
    expect(calls.filter((c) => c.startsWith('loadLatestJobsBySourceIds')).length).toBe(1)
  })
})

// ─── 3.11/7.4 扫描预算与诚实计数 ────────────────────────────────────────

describe('扫描预算 | 超预算时 total 不得被静默截断', () => {
  /** 构造一个「超扫描预算」的 fake port：total 权威、items 按请求页返回 */
  function makeBigPorts(total: number) {
    const base = makeFakePorts({ rows: [] }).ports
    const calls: Array<{ page: number; perPage: number }> = []
    const ports: DocumentIntelligenceReadPorts = {
      ...base,
      async pageVisibleSources(params) {
        calls.push({ page: params.page, perPage: params.perPage })
        const start = (params.page - 1) * params.perPage
        const items = []
        for (let i = start; i < Math.min(start + params.perPage, total); i += 1) {
          items.push(makeRow('attachment', i + 1))
        }
        return { items, total }
      },
    }
    return { ports, calls }
  }

  it('无维度过滤：total 为权威计数，走 DB 级分页且 scanTruncated=false', async () => {
    const { ports, calls } = makeBigPorts(1007)
    const svc = new DocumentIntelligenceWorkbenchService(ports)
    const res = await svc.listSources({
      organizationId: 1,
      projectId: 1,
      query: { ...BASE_QUERY, page: 11, perPage: 100 },
      access: ACCESS,
    })
    expect(res.meta.total).toBe(1007)
    expect(res.meta.totalPages).toBe(11)
    expect(res.meta.scanTruncated).toBe(false)
    // 计数覆盖不了全量 → 诚实标注 page
    expect(res.meta.countMode).toBe('page')
    // 第 11 页只剩 7 行，且确实按请求页查询（不是切 1000 行窗口）
    expect(res.data.length).toBe(7)
    expect(calls.some((c) => c.page === 11 && c.perPage === 100)).toBe(true)
  })

  it('带维度过滤且超预算：显式 scanTruncated=true，绝不冒充全量精确', async () => {
    const { ports } = makeBigPorts(1007)
    const svc = new DocumentIntelligenceWorkbenchService(ports)
    const res = await svc.listSources({
      organizationId: 1,
      projectId: 1,
      query: { ...BASE_QUERY, attention: 'needs_review', page: 1, perPage: 20 },
      access: ACCESS,
    })
    expect(res.meta.scanTruncated).toBe(true)
    expect(res.meta.countMode).toBe('page')
  })

  it('预算内：total 与 facet 计数均为 exact 且 scanTruncated=false', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => makeRow('attachment', i + 1))
    const { ports } = makeFakePorts({ rows })
    const svc = new DocumentIntelligenceWorkbenchService(ports)
    const res = await svc.listSources({
      organizationId: 1,
      projectId: 1,
      query: { ...BASE_QUERY, perPage: 5 },
      access: ACCESS,
    })
    expect(res.meta.total).toBe(12)
    expect(res.meta.countMode).toBe('exact')
    expect(res.meta.scanTruncated).toBe(false)
    expect(res.data.length).toBe(5)
  })
})

// ─── 3.15/3.16 Validator 边界 ───────────────────────────────────────────

describe('validator 边界', () => {
  it('合法最小查询通过并补齐默认值语义（optional）', async () => {
    const v = await documentIntelligenceListQueryValidator.validate({})
    expect(v.page).toBeUndefined()
    expect(v.sort).toBeUndefined()
  })

  it('未知枚举 / 过大页 / 非法 ID / 注入值拒绝', async () => {
    await expect(
      documentIntelligenceListQueryValidator.validate({ attention: 'everything' }),
    ).rejects.toBeTruthy()
    await expect(
      documentIntelligenceListQueryValidator.validate({ sort: 'drop table users' }),
    ).rejects.toBeTruthy()
    await expect(
      documentIntelligenceListQueryValidator.validate({ perPage: 5000 }),
    ).rejects.toBeTruthy()
    await expect(documentIntelligenceListQueryValidator.validate({ page: -1 })).rejects.toBeTruthy()
    await expect(
      documentIntelligenceSourceParamsValidator.validate({
        projectId: 1,
        sourceKind: 'external_file',
        sourceId: 1,
      }),
    ).rejects.toBeTruthy()
    await expect(
      documentIntelligenceSourceParamsValidator.validate({
        projectId: 1,
        sourceKind: 'attachment',
        sourceId: 0,
      }),
    ).rejects.toBeTruthy()
    await expect(
      documentIntelligenceListQueryValidator.validate({ search: '<script>alert(1)</script>' }),
    ).rejects.toBeTruthy()
  })

  it('未知字段拒绝（封闭白名单，vine 剥离语义之外的显式守卫）', () => {
    expect(() => assertOnlyAllowedQueryKeys({ evilParam: 'x', page: 1 })).toThrow(/evilParam/)
    expect(() => assertOnlyAllowedQueryKeys({ page: 1, search: 'a' })).not.toThrow()
  })
})
