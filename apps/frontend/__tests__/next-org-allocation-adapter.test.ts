/**
 * v3-ui-next-org-portfolio-domains W7 · tasks 7.1 —— 跨项目调配纯函数适配器单测。
 *
 * 覆盖（spec「跨项目资源调配草案工作台」+ design Decision 6）：
 * - 草案七状态中文标签全覆盖 + 未知状态兜底返回原文（永不崩溃）；
 * - 徽标档位映射（draft→neutral / previewed→info / confirmed→warning /
 *   applied→success / cancelled→muted / failed→danger）；
 * - 可编辑 / 可取消状态判定边界（draft/previewed 可编辑；终态不可取消）；
 * - 调配项类型 / 状态 / 应用结果 / 候选来源标签映射；
 * - 冲突严重度标签 + 排序（critical>error>warning>info）与降序稳定排序；
 * - 候选按项目 / 技能分组（多技能候选跨组出现、无技能候选落入空组）；
 * - URL draft 参数解析（非法值 → null）与序列化往返；
 * - 日期窗口默认值（注入 now）与非法 ISO 展示兜底 '—'。
 */
import { describe, expect, test } from 'vitest'
import {
  allocationDraftStatusLabel,
  allocationDraftStatusTone,
  allocationItemStatusLabel,
  allocationItemTypeLabel,
  applyResultLabel,
  applyResultTone,
  asSinglePayload,
  candidateSourceLabel,
  compareConflictSeverity,
  conflictSeverityLabel,
  conflictSeverityTone,
  createDefaultAllocationDateWindow,
  filterCandidatesBySkillKeyword,
  formatShortDate,
  groupCandidatesByProject,
  groupCandidatesBySkill,
  isAllocationDraftCancellable,
  isAllocationDraftEditable,
  isAiSourcedCandidate,
  normalizeCandidatesPayload,
  normalizeDraftListPayload,
  parseAllocationDraftIdParam,
  serializeAllocationUrlState,
  sortConflictsBySeverity,
  toAllocationDraftRowModel,
} from '@/lib/next/org-allocation/org-allocation-adapter'
import type { CrossProjectAllocationCandidateResource } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 草案状态标签 / 档位
// ---------------------------------------------------------------------------

describe('草案状态标签与徽标档位映射', () => {
  test('七状态全覆盖：中文标签一一对应', () => {
    expect(allocationDraftStatusLabel('draft')).toBe('草案')
    expect(allocationDraftStatusLabel('previewed')).toBe('已预览')
    expect(allocationDraftStatusLabel('confirmed')).toBe('已确认')
    expect(allocationDraftStatusLabel('applied')).toBe('已应用')
    expect(allocationDraftStatusLabel('cancelled')).toBe('已取消')
    expect(allocationDraftStatusLabel('expired')).toBe('已过期')
    expect(allocationDraftStatusLabel('failed')).toBe('失败')
  })

  test('未知状态兜底返回原文；空值返回占位符', () => {
    expect(allocationDraftStatusLabel('mystery')).toBe('mystery')
    expect(allocationDraftStatusLabel(null)).toBe('—')
    expect(allocationDraftStatusLabel(undefined)).toBe('—')
    expect(allocationDraftStatusLabel('')).toBe('—')
  })

  test('徽标档位边界映射', () => {
    expect(allocationDraftStatusTone('draft')).toBe('neutral')
    expect(allocationDraftStatusTone('previewed')).toBe('info')
    expect(allocationDraftStatusTone('confirmed')).toBe('warning')
    expect(allocationDraftStatusTone('applied')).toBe('success')
    expect(allocationDraftStatusTone('cancelled')).toBe('muted')
    expect(allocationDraftStatusTone('failed')).toBe('danger')
    expect(allocationDraftStatusTone('unknown')).toBe('neutral')
    expect(allocationDraftStatusTone(null)).toBe('neutral')
  })

  test('可编辑 / 可取消状态判定边界', () => {
    expect(isAllocationDraftEditable('draft')).toBe(true)
    expect(isAllocationDraftEditable('previewed')).toBe(true)
    expect(isAllocationDraftEditable('confirmed')).toBe(false)
    expect(isAllocationDraftEditable('applied')).toBe(false)
    expect(isAllocationDraftEditable('cancelled')).toBe(false)
    expect(isAllocationDraftEditable('expired')).toBe(false)
    expect(isAllocationDraftEditable(null)).toBe(false)

    expect(isAllocationDraftCancellable('draft')).toBe(true)
    expect(isAllocationDraftCancellable('previewed')).toBe(true)
    expect(isAllocationDraftCancellable('confirmed')).toBe(true)
    expect(isAllocationDraftCancellable('applied')).toBe(false)
    expect(isAllocationDraftCancellable('cancelled')).toBe(false)
    expect(isAllocationDraftCancellable('expired')).toBe(false)
  })

  test('草案行模型聚合字段（id 数值化 / 项目范围数 / 警告数）', () => {
    const row = toAllocationDraftRowModel({
      id: '12',
      organizationId: 1,
      status: 'previewed',
      name: '九月调配',
      queryShape: {
        organizationId: 1,
        projectIds: [1, 2, 3],
        dateWindow: { from: '2026-09-01', to: '2026-11-30' },
        resourceTypes: [],
        roles: [],
        skillTags: [],
        departments: [],
        loadStatuses: [],
        conflictSeverities: [],
        draftStatuses: [],
        search: null,
        sort: 'created_at',
        sortDir: 'desc',
        page: 1,
        perPage: 20,
        topN: 10,
        freshnessThresholdMinutes: 60,
      },
      itemCount: 2,
      evidence: null,
      previewHash: null,
      previewExpiresAt: null,
      warnings: [{ code: 'NO_CANDIDATES', message: '无候选', severity: 'warning' }],
      createdAt: '2026-09-01T02:00:00.000Z',
      updatedAt: '2026-09-01T02:00:00.000Z',
    } as Parameters<typeof toAllocationDraftRowModel>[0])
    expect(row.id).toBe(12)
    expect(row.statusLabel).toBe('已预览')
    expect(row.statusTone).toBe('info')
    expect(row.editable).toBe(true)
    expect(row.scopeProjectCount).toBe(3)
    expect(row.warningCount).toBe(1)
    expect(row.createdAtLabel).toBe('2026-09-01')
  })
})

// ---------------------------------------------------------------------------
// 调配项 / 应用结果 / 候选来源
// ---------------------------------------------------------------------------

describe('调配项类型、状态与应用结果标签', () => {
  test('调配项类型四种标签', () => {
    expect(allocationItemTypeLabel('allocate')).toBe('分配')
    expect(allocationItemTypeLabel('reallocate')).toBe('重新分配')
    expect(allocationItemTypeLabel('remove')).toBe('移除')
    expect(allocationItemTypeLabel('map_resource')).toBe('资源映射')
    expect(allocationItemTypeLabel('weird')).toBe('weird')
    expect(allocationItemTypeLabel(null)).toBe('—')
  })

  test('调配项状态六种标签', () => {
    expect(allocationItemStatusLabel('pending')).toBe('待处理')
    expect(allocationItemStatusLabel('conflict')).toBe('冲突')
    expect(allocationItemStatusLabel('ready')).toBe('就绪')
    expect(allocationItemStatusLabel('applied')).toBe('已应用')
    expect(allocationItemStatusLabel('failed')).toBe('失败')
    expect(allocationItemStatusLabel('skipped')).toBe('已跳过')
    expect(allocationItemStatusLabel('x')).toBe('x')
  })

  test('应用结果标签与档位', () => {
    expect(applyResultLabel('success')).toBe('成功')
    expect(applyResultLabel('partial')).toBe('部分成功')
    expect(applyResultLabel('failed')).toBe('失败')
    expect(applyResultLabel('stale')).toBe('已过期')
    expect(applyResultLabel(null)).toBe('—')
    expect(applyResultTone('success')).toBe('success')
    expect(applyResultTone('partial')).toBe('warning')
    expect(applyResultTone('stale')).toBe('warning')
    expect(applyResultTone('failed')).toBe('danger')
    expect(applyResultTone('mystery')).toBe('neutral')
  })

  test('候选来源标签与 AI 来源判定', () => {
    expect(candidateSourceLabel('rule')).toBe('规则')
    expect(candidateSourceLabel('ai')).toBe('AI')
    expect(candidateSourceLabel('manual')).toBe('人工')
    expect(candidateSourceLabel('imported')).toBe('导入')
    expect(candidateSourceLabel('x')).toBe('x')
    expect(candidateSourceLabel(null)).toBe('—')
    expect(isAiSourcedCandidate('ai')).toBe(true)
    expect(isAiSourcedCandidate('rule')).toBe(false)
    expect(isAiSourcedCandidate(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 冲突严重度
// ---------------------------------------------------------------------------

describe('冲突严重度标签与排序', () => {
  test('严重度标签四种 + 档位', () => {
    expect(conflictSeverityLabel('info')).toBe('提示')
    expect(conflictSeverityLabel('warning')).toBe('警告')
    expect(conflictSeverityLabel('error')).toBe('错误')
    expect(conflictSeverityLabel('critical')).toBe('严重')
    expect(conflictSeverityLabel(null)).toBe('—')
    expect(conflictSeverityTone('info')).toBe('neutral')
    expect(conflictSeverityTone('warning')).toBe('warning')
    expect(conflictSeverityTone('error')).toBe('danger')
    expect(conflictSeverityTone('critical')).toBe('danger')
  })

  test('排序比较器：critical > error > warning > info（含未知兜底）', () => {
    expect(compareConflictSeverity('critical', 'error')).toBeGreaterThan(0)
    expect(compareConflictSeverity('error', 'warning')).toBeGreaterThan(0)
    expect(compareConflictSeverity('warning', 'info')).toBeGreaterThan(0)
    expect(compareConflictSeverity('info', 'warning')).toBeLessThan(0)
    expect(compareConflictSeverity('warning', 'warning')).toBe(0)
    expect(compareConflictSeverity('mystery', 'info')).toBe(0)
  })

  test('降序排序稳定：混合严重度按档位排列', () => {
    const sorted = sortConflictsBySeverity([
      { severity: 'info', id: 1 },
      { severity: 'critical', id: 2 },
      { severity: 'warning', id: 3 },
      { severity: 'error', id: 4 },
      { severity: 'warning', id: 5 },
    ])
    expect(sorted.map((item) => item.severity)).toEqual([
      'critical',
      'error',
      'warning',
      'warning',
      'info',
    ])
  })
})

// ---------------------------------------------------------------------------
// 候选分组
// ---------------------------------------------------------------------------

function makeCandidate(
  resourceId: number,
  overrides: Partial<CrossProjectAllocationCandidateResource> = {},
): CrossProjectAllocationCandidateResource {
  return {
    resourceId,
    resourceName: `资源 ${resourceId}`,
    redaction: 'visible',
    sourceProjectId: 1,
    sourceProjectName: '商城重构',
    remainingCapacityHours: 40,
    dailyCapacityHours: 8,
    skillTags: ['React', 'Node'],
    skillFitPercent: 80,
    availabilitySlots: [],
    unavailableDates: [],
    currentUtilizationPercent: 60,
    afterAllocationUtilizationPercent: null,
    pmoPriorityScore: null,
    source: 'rule',
    rationale: null,
    ...overrides,
  }
}

describe('候选按项目 / 技能分组', () => {
  const candidates = [
    makeCandidate(1, { sourceProjectId: 10, sourceProjectName: '项目甲' }),
    makeCandidate(2, { sourceProjectId: 10, sourceProjectName: '项目甲', skillTags: ['Go'] }),
    makeCandidate(3, { sourceProjectId: 20, sourceProjectName: '项目乙', skillTags: ['React'] }),
    makeCandidate(4, { sourceProjectId: 30, sourceProjectName: '', skillTags: [] }),
  ]

  test('按项目分组：同项目聚合、保留顺序、空名称以 #id 兜底', () => {
    const groups = groupCandidatesByProject(candidates)
    expect(groups).toHaveLength(3)
    expect(groups[0]?.projectName).toBe('项目甲')
    expect(groups[0]?.items.map((item) => item.resourceId)).toEqual([1, 2])
    expect(groups[1]?.projectName).toBe('项目乙')
    expect(groups[1]?.items.map((item) => item.resourceId)).toEqual([3])
    expect(groups[2]?.projectName).toBe('项目 #30')
    expect(groups[2]?.items.map((item) => item.resourceId)).toEqual([4])
    expect(groups[2]?.projectId).toBe(30)
  })

  test('按技能分组：多技能候选跨组出现、无技能候选落入空组', () => {
    const groups = groupCandidatesBySkill(candidates)
    const bySkill = new Map(groups.map((group) => [group.skill, group.items]))
    expect(bySkill.get('React')?.map((item) => item.resourceId)).toEqual([1, 3])
    expect(bySkill.get('Go')?.map((item) => item.resourceId)).toEqual([2])
    expect(bySkill.get('')?.map((item) => item.resourceId)).toEqual([4])
  })

  test('技能关键词过滤：大小写不敏感子串；空关键词返回全量', () => {
    expect(
      filterCandidatesBySkillKeyword(candidates, 'react').map((item) => item.resourceId),
    ).toEqual([1, 3])
    expect(
      filterCandidatesBySkillKeyword(candidates, 'REACT').map((item) => item.resourceId),
    ).toEqual([1, 3])
    expect(filterCandidatesBySkillKeyword(candidates, 'go').map((item) => item.resourceId)).toEqual(
      [2],
    )
    expect(filterCandidatesBySkillKeyword(candidates, '不存在').length).toBe(0)
    expect(filterCandidatesBySkillKeyword(candidates, null).length).toBe(4)
    expect(filterCandidatesBySkillKeyword(candidates, '  ').length).toBe(4)
  })

  test('空候选返回空分组', () => {
    expect(groupCandidatesByProject([])).toEqual([])
    expect(groupCandidatesBySkill([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// URL 状态
// ---------------------------------------------------------------------------

describe('URL draft 参数解析与序列化', () => {
  test('合法正整数解析为 number', () => {
    expect(parseAllocationDraftIdParam('12')).toBe(12)
    expect(parseAllocationDraftIdParam(' 7 ')).toBe(7)
    expect(serializeAllocationUrlState(12)).toBe('?draft=12')
  })

  test('非法值一律 null：空串 / 零 / 负数 / 非数字 / 浮点', () => {
    expect(parseAllocationDraftIdParam(null)).toBeNull()
    expect(parseAllocationDraftIdParam(undefined)).toBeNull()
    expect(parseAllocationDraftIdParam('')).toBeNull()
    expect(parseAllocationDraftIdParam('0')).toBeNull()
    expect(parseAllocationDraftIdParam('-3')).toBeNull()
    expect(parseAllocationDraftIdParam('abc')).toBeNull()
    expect(parseAllocationDraftIdParam('1.5')).toBeNull()
    expect(parseAllocationDraftIdParam('12abc')).toBeNull()
  })

  test('序列化：null → 空串（清空参数）', () => {
    expect(serializeAllocationUrlState(null)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 日期窗口与展示格式化
// ---------------------------------------------------------------------------

describe('日期窗口与展示格式化', () => {
  test('默认窗口：今天 → +90 天（注入固定 now）', () => {
    const window = createDefaultAllocationDateWindow(new Date('2026-09-01T08:00:00.000Z'), 90)
    expect(window.from).toBe('2026-09-01')
    expect(window.to).toBe('2026-11-30')
  })

  test('自定义窗口天数', () => {
    const window = createDefaultAllocationDateWindow(new Date('2026-12-31T00:00:00.000Z'), 1)
    expect(window.to).toBe('2027-01-01')
  })

  test('短日期展示：ISO → yyyy-mm-dd；非法 / 空值 → —', () => {
    expect(formatShortDate('2026-09-01T02:00:00.000Z')).toBe('2026-09-01')
    expect(formatShortDate('2026-09-01')).toBe('2026-09-01')
    expect(formatShortDate(null)).toBe('—')
    expect(formatShortDate(undefined)).toBe('—')
    expect(formatShortDate('not-a-date')).toBe('—')
  })
})

// ---------------------------------------------------------------------------
// 单对象端点载荷收敛（Major-1：apiFetch 解包后裸载荷 / 信封两态归一）
// ---------------------------------------------------------------------------

describe('asSinglePayload 单对象载荷收敛', () => {
  const draft = { id: '2', name: 'Q3 前端人力调配' } as const

  test('裸载荷（apiFetch 已解包的真实后端形态）原样返回', () => {
    expect(asSinglePayload<{ id: string; name: string }>(draft)).toBe(draft)
  })

  test('单层信封（历史夹具 / 服务端信封形态）取 data 收敛', () => {
    expect(asSinglePayload<{ id: string; name: string }>({ data: draft })).toEqual(draft)
  })

  test('data 为 undefined 的信封不误取（视同裸载荷返回原值）', () => {
    const weird = { data: undefined }
    expect(asSinglePayload(weird)).toBe(weird)
  })

  test('与列表归一化兼容：数组载荷不做信封误判', () => {
    const rows = [draft]
    expect(asSinglePayload(rows)).toBe(rows)
    expect(normalizeDraftListPayload(rows).rows).toHaveLength(1)
    expect(normalizeDraftListPayload({ data: rows, meta: { total: 1 } }).total).toBe(1)
    expect(normalizeCandidatesPayload([{ resourceId: 1 }]).rows).toHaveLength(1)
  })
})
