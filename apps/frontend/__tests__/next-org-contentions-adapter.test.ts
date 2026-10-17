/**
 * v3-ui-next-org-portfolio-domains W5 · tasks 5.1 —— 争用适配器纯函数单元测试。
 *
 * 覆盖：severity/reasonCode 中文标签与徽标色阶（双通道）、redaction 受限判定与
 * 中性文案、list/matrix 视图行模型、URL 参数解析/序列化（restorable filters）、
 * 错误三态分类；零 DOM 高速单测。
 */
import { describe, expect, test } from 'vitest'
import {
  buildContentionListRow,
  buildContentionMatrixModel,
  classifyApiError,
  CONTENTION_DEFAULT_VIEW,
  CONTENTION_REDACTED_PLACEHOLDER,
  CONTENTION_REASON_LABELS,
  CONTENTION_SEVERITY_META,
  CONTENTION_SEVERITY_LABELS,
  contentionStateToQuery,
  formatContentionDate,
  formatContentionSubjectName,
  formatContentionWindow,
  hasActiveContentionFilters,
  isContentionRedacted,
  parseContentionUrlState,
  reasonLabelOf,
  serializeContentionUrlState,
} from '@/lib/next/org-contentions/org-contentions-adapter'
import type { ResourceContentionItem, ResourceContentionMatrix } from '@aiproj/types'

// ─── fixtures ─────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<ResourceContentionItem> = {}): ResourceContentionItem {
  return {
    contentionId: 'ctn-1',
    severity: 'high',
    reasonCode: 'cross-project-overload',
    resourceId: 11,
    resourceName: '张工',
    projectIds: [1, 2],
    projectNames: ['商城重构', '中台迁移'],
    taskId: null,
    allocationId: null,
    from: '2026-09-01',
    to: '2026-09-14',
    loadPercent: 145,
    affectedDateBuckets: null,
    description: '张工同时被两个项目过度分配',
    remediationHint: '建议调整其中一个项目的分配窗口',
    evidenceHash: 'abc123',
    target: null,
    redactionState: 'visible',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeMatrix(overrides: Partial<ResourceContentionMatrix> = {}): ResourceContentionMatrix {
  return {
    from: '2026-09-01',
    to: '2026-09-07',
    rows: [
      {
        resourceId: 11,
        resourceName: '张工',
        role: '后端工程师',
        totalContentions: 2,
        maxSeverity: 'critical',
        cells: [
          {
            date: '2026-09-01',
            severity: 'critical',
            reasonCode: 'cross-project-overload',
            loadPercent: 152,
            contentionCount: 2,
            redactionState: 'visible',
            drillDownTarget: null,
          },
          {
            date: '2026-09-02',
            severity: null,
            reasonCode: null,
            loadPercent: 30,
            contentionCount: 0,
            redactionState: 'visible',
            drillDownTarget: null,
          },
        ],
        redactionState: 'visible',
      },
      {
        resourceId: 12,
        resourceName: null,
        role: null,
        totalContentions: 1,
        maxSeverity: null,
        cells: [
          {
            date: '2026-09-01',
            severity: null,
            reasonCode: null,
            loadPercent: null,
            contentionCount: 0,
            redactionState: 'forbidden',
            drillDownTarget: null,
          },
          {
            date: '2026-09-02',
            severity: 'warning',
            reasonCode: 'duplicate-reservation',
            loadPercent: 88,
            contentionCount: 1,
            redactionState: 'forbidden',
            drillDownTarget: null,
          },
        ],
        redactionState: 'forbidden',
      },
    ],
    ...overrides,
  }
}

// ─── severity / reason 标签与徽标 ───────────────────────────────────────

describe('severity 标签与徽标色阶（tasks 5.1）', () => {
  test('四档 severity 中文标签齐全（信息/提示/高风险/严重）', () => {
    expect(CONTENTION_SEVERITY_LABELS).toEqual({
      info: '信息',
      warning: '提示',
      high: '高风险',
      critical: '严重',
    })
  })

  test('每档徽标 chipClass 为静态字符串且含令牌（双通道文字+色阶），关键档含语义色', () => {
    for (const severity of ['info', 'warning', 'high', 'critical'] as const) {
      const meta = CONTENTION_SEVERITY_META[severity]
      expect(meta.label).toBe(CONTENTION_SEVERITY_LABELS[severity])
      expect(meta.chipClass).toContain('var(--nx-')
    }
    expect(CONTENTION_SEVERITY_META.critical.chipClass).toContain('var(--nx-status-danger)')
    expect(CONTENTION_SEVERITY_META.warning.chipClass).toContain('var(--nx-status-warning)')
    expect(CONTENTION_SEVERITY_META.info.chipClass).toContain('var(--nx-text-secondary)')
  })

  test('六类 reasonCode 中文标签齐全', () => {
    expect(CONTENTION_REASON_LABELS).toEqual({
      'cross-project-overload': '跨项目过载',
      'unavailable-allocation': '不可用分配',
      'critical-skill-contention': '关键技能争用',
      'duplicate-reservation': '重复预留',
      'demand-window-contention': '需求窗口争用',
      'draft-allocation-contention': '调配草案冲突',
    })
    expect(reasonLabelOf('cross-project-overload')).toBe('跨项目过载')
    expect(reasonLabelOf(undefined)).toBe('未知原因')
    expect(reasonLabelOf('not-a-real-code')).toBe('not-a-real-code')
  })
})

// ─── redaction 判定与中性文案（RL-05） ──────────────────────────────────

describe('受限判定与中性文案（tasks 5.1 / RL-05）', () => {
  test('visible=false 其余四态均为受限', () => {
    expect(isContentionRedacted('visible')).toBe(false)
    expect(isContentionRedacted('redacted')).toBe(true)
    expect(isContentionRedacted('forbidden')).toBe(true)
    expect(isContentionRedacted('unavailable')).toBe(true)
    expect(isContentionRedacted('partial')).toBe(true)
    expect(isContentionRedacted(undefined)).toBe(false)
  })

  test('受限名称恒返回中性占位，绝不回显原文', () => {
    expect(formatContentionSubjectName('张工', true)).toBe(CONTENTION_REDACTED_PLACEHOLDER)
    expect(formatContentionSubjectName('张工', false)).toBe('张工')
    expect(formatContentionSubjectName('', false)).toBe(CONTENTION_REDACTED_PLACEHOLDER)
    expect(formatContentionSubjectName(null, false)).toBe(CONTENTION_REDACTED_PLACEHOLDER)
  })

  test('日期格式化：UTC 日历日 / 非法输入截断 / 窗口占位', () => {
    expect(formatContentionDate('2026-09-01T00:00:00.000Z')).toBe('2026-09-01')
    expect(formatContentionDate('2026-09-01')).toBe('2026-09-01')
    expect(formatContentionDate(null)).toBe('—')
    expect(formatContentionWindow('2026-09-01', '2026-09-14')).toBe('2026-09-01 ~ 2026-09-14')
    expect(formatContentionWindow(null, '2026-09-14')).toBe('— ~ 2026-09-14')
  })
})

// ─── list / matrix 视图行模型 ───────────────────────────────────────────

describe('list/matrix 视图行模型（tasks 5.1/5.2）', () => {
  test('列表行模型：可见条目完整映射标签/数值', () => {
    const row = buildContentionListRow(makeItem())
    expect(row.contentionId).toBe('ctn-1')
    expect(row.resourceDisplay).toBe('张工')
    expect(row.resourceRedacted).toBe(false)
    expect(row.severityLabel).toBe('高风险')
    expect(row.severityChipClass).toContain('var(--nx-')
    expect(row.reasonLabel).toBe('跨项目过载')
    expect(row.loadPercent).toBe(145)
    expect(row.projectNames).toEqual(['商城重构', '中台迁移'])
    expect(row.projectCount).toBe(2)
    expect(row.redacted).toBe(false)
  })

  test('列表行模型：受限条目中性化——负载/项目计数不泄露', () => {
    const row = buildContentionListRow(
      makeItem({
        resourceName: null,
        projectIds: null,
        projectNames: null,
        loadPercent: 200,
        redactionState: 'forbidden',
      }),
    )
    expect(row.resourceDisplay).toBe(CONTENTION_REDACTED_PLACEHOLDER)
    expect(row.resourceRedacted).toBe(true)
    expect(row.loadPercent).toBeNull()
    expect(row.projectCount).toBeNull()
    expect(row.projectNames).toEqual([])
    expect(row.redactionLabel).toBe('无权限')
  })

  test('矩阵模型：列=日期轴，行含单元格双通道模型', () => {
    const model = buildContentionMatrixModel(makeMatrix())
    expect(model.columns.map((c) => c.date)).toEqual(['2026-09-01', '2026-09-02'])
    expect(model.rows).toHaveLength(2)
    const visibleRow = model.rows[0]!
    expect(visibleRow.resourceDisplay).toBe('张工')
    expect(visibleRow.roleDisplay).toBe('后端工程师')
    expect(visibleRow.totalContentionsDisplay).toBe(2)
    expect(visibleRow.maxSeverityLabel).toBe('严重')
    expect(visibleRow.maxSeverityChipClass).toContain('var(--nx-status-danger)')
    expect(visibleRow.cells[0]!.hasSignal).toBe(true)
    expect(visibleRow.cells[0]!.severityLabel).toBe('严重')
    expect(visibleRow.cells[0]!.loadPercent).toBe(152)
    expect(visibleRow.cells[1]!.hasSignal).toBe(false)
    expect(visibleRow.cells[1]!.severityLabel).toBeNull()
    expect(visibleRow.cells[1]!.loadPercent).toBe(30)
  })

  test('矩阵模型：受限行/单元格中性化——计数恒 null，数值与信号均不出现', () => {
    const model = buildContentionMatrixModel(makeMatrix())
    const forbiddenRow = model.rows[1]!
    expect(forbiddenRow.resourceDisplay).toBe(CONTENTION_REDACTED_PLACEHOLDER)
    expect(forbiddenRow.totalContentionsDisplay).toBeNull()
    expect(forbiddenRow.maxSeverityLabel).toBeNull()
    expect(forbiddenRow.cells[0]!.loadPercent).toBeNull()
    expect(forbiddenRow.cells[0]!.contentionCount).toBe(0)
    expect(forbiddenRow.cells[0]!.hasSignal).toBe(false)
    expect(forbiddenRow.cells[0]!.severityLabel).toBeNull()
    expect(forbiddenRow.cells[1]!.loadPercent).toBeNull()
    expect(forbiddenRow.cells[1]!.contentionCount).toBe(0)
    expect(forbiddenRow.cells[1]!.hasSignal).toBe(false) // 受限单元格不泄露存在性
    expect(forbiddenRow.redactionLabel).toBe('无权限')
  })

  test('矩阵模型：空矩阵行安全回落空列', () => {
    const model = buildContentionMatrixModel({ from: '2026-09-01', to: '2026-09-02', rows: [] })
    expect(model.columns).toEqual([])
    expect(model.rows).toEqual([])
  })
})

// ─── URL 状态解析/序列化（restorable filters） ─────────────────────────

describe('URL 状态解析/序列化（tasks 5.1/5.2 restorable）', () => {
  test('解析：合法值原样落入状态', () => {
    const state = parseContentionUrlState(
      new URLSearchParams('view=list&severity=critical&reasonCode=duplicate-reservation&page=3'),
    )
    expect(state).toEqual({
      view: 'list',
      severity: 'critical',
      reasonCode: 'duplicate-reservation',
      page: 3,
    })
  })

  test('解析：非法/脏值一律回落默认，绝不原样外发', () => {
    expect(parseContentionUrlState(new URLSearchParams('view=hack&severity=xxx&page=abc'))).toEqual(
      {
        view: CONTENTION_DEFAULT_VIEW,
        severity: '',
        reasonCode: '',
        page: 1,
      },
    )
    expect(parseContentionUrlState(new URLSearchParams('page=0'))).toEqual({
      view: 'matrix',
      severity: '',
      reasonCode: '',
      page: 1,
    })
    expect(parseContentionUrlState(new URLSearchParams())).toEqual({
      view: 'matrix',
      severity: '',
      reasonCode: '',
      page: 1,
    })
  })

  test('序列化：默认值不落参，激活值可分享', () => {
    const qs = serializeContentionUrlState({
      view: 'list',
      severity: 'high',
      reasonCode: '',
      page: 2,
    })
    expect(qs.toString()).toBe('view=list&severity=high&page=2')
    expect(
      serializeContentionUrlState({
        view: 'matrix',
        severity: '',
        reasonCode: '',
        page: 1,
      }).toString(),
    ).toBe('')
  })

  test('round-trip：序列化产物再解析恒等', () => {
    const source = {
      view: 'list' as const,
      severity: 'warning' as const,
      reasonCode: '' as const,
      page: 5,
    }
    expect(parseContentionUrlState(serializeContentionUrlState(source))).toEqual(source)
  })

  test('stateToQuery：空筛选不落 undefined 外发键', () => {
    expect(
      contentionStateToQuery({ view: 'matrix', severity: '', reasonCode: '', page: 1 }),
    ).toEqual({
      page: 1,
      perPage: 20,
    })
    expect(
      contentionStateToQuery({
        view: 'list',
        severity: 'high',
        reasonCode: 'critical-skill-contention',
        page: 2,
      }),
    ).toEqual({ severity: 'high', reasonCode: 'critical-skill-contention', page: 2, perPage: 20 })
  })

  test('hasActiveContentionFilters：任一筛选激活即 true', () => {
    expect(
      hasActiveContentionFilters({ view: 'matrix', severity: 'high', reasonCode: '', page: 1 }),
    ).toBe(true)
    expect(
      hasActiveContentionFilters({ view: 'matrix', severity: '', reasonCode: '', page: 1 }),
    ).toBe(false)
  })
})

// ─── 错误三态分类 ───────────────────────────────────────────────────────

describe('错误三态分类（tasks 5.3）', () => {
  test('403 / PERMISSION_DENIED → forbidden（中性限制态依据）', () => {
    expect(classifyApiError({ status: 403, code: 'PERMISSION_DENIED', message: 'x' })).toEqual({
      kind: 'forbidden',
      status: 403,
    })
    expect(classifyApiError({ status: 403, code: 'FORBIDDEN', message: 'x' })).toEqual({
      kind: 'forbidden',
      status: 403,
    })
  })

  test('404 / RESOURCE_NOT_FOUND → not_found（中性未找到）', () => {
    expect(classifyApiError({ status: 404, code: 'RESOURCE_NOT_FOUND', message: 'x' })).toEqual({
      kind: 'not_found',
      status: 404,
    })
  })

  test('5xx 与网络错误 → server/network（可重试态）', () => {
    expect(classifyApiError({ status: 502, code: 'BAD_GATEWAY', message: 'x' })).toEqual({
      kind: 'server',
      status: 502,
    })
    expect(classifyApiError(new Error('fetch failed'))).toEqual({ kind: 'network', status: null })
    expect(classifyApiError(null)).toEqual({ kind: 'unknown', status: null })
  })
})
