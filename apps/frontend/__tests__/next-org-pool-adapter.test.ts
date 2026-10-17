/**
 * v3-ui-next-org-portfolio-domains W4 · tasks 4.2 —— 组织资源池适配层纯函数单测。
 *
 * 覆盖：负载标签与 --nx-* 色阶全覆盖、超载边界（100% 不算 / 100.5% 算）、
 * 受限指标布尔与中性文案、受限行/技能列判定、容量矩阵聚合与逐日单元模型、
 * 冲突严重度标签色阶。全部零 DOM、零网络。
 */
import { describe, expect, test } from 'vitest'
import {
  buildPoolCapacityRowModel,
  buildPoolCapacityRows,
  collectPoolMatrixDates,
  formatPoolHours,
  formatPoolPercent,
  getPoolConflictSeverityLabel,
  getPoolConflictSeverityTone,
  getPoolLoadLabel,
  getPoolLoadTone,
  getPoolRowRestrictedLabel,
  isPoolCellOverloaded,
  isPoolMetricRestricted,
  isPoolOverloaded,
  isPoolRowIdentityRestricted,
  isPoolSkillColumnRestricted,
  POOL_CONFLICT_SEVERITY_LABELS,
  POOL_CONFLICT_SEVERITY_TONES,
  POOL_LOAD_LABELS,
  POOL_LOAD_TONES,
  POOL_RESTRICTED_TEXT,
  POOL_VIEW_LABELS,
} from '@/lib/next/org-pool/org-pool-adapter'
import type {
  OrganizationResourcePoolCapacityMatrix,
  OrganizationResourcePoolCapacityMatrixRow,
  OrganizationResourcePoolConflictSeverity,
  OrganizationResourcePoolLoadStatus,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 负载标签与色阶
// ---------------------------------------------------------------------------

describe('负载状态标签与色阶（tasks 4.1/4.2）', () => {
  test('五种负载状态中文标签全覆盖', () => {
    expect(POOL_LOAD_LABELS).toEqual({
      idle: '空闲',
      normal: '正常',
      high: '高负载',
      overloaded: '过载',
      unavailable: '不可用',
    })
  })

  test('五种负载状态均有 --nx-* 令牌色阶且过载为警戒红', () => {
    const statuses: OrganizationResourcePoolLoadStatus[] = [
      'idle',
      'normal',
      'high',
      'overloaded',
      'unavailable',
    ]
    for (const status of statuses) {
      const tone = getPoolLoadTone(status)
      expect(tone.startsWith('--nx-')).toBe(true)
      expect(tone).toBe(POOL_LOAD_TONES[status])
    }
    expect(POOL_LOAD_TONES.overloaded).toBe('--nx-status-danger')
    expect(POOL_LOAD_TONES.normal).toBe('--nx-chart-1')
    expect(getPoolLoadLabel('overloaded')).toBe('过载')
    expect(getPoolLoadLabel('normal')).toBe('正常')
  })

  test('视图 Tab 标签映射（URL view 参数可读，覆盖全部 view 白名单值）', () => {
    expect(POOL_VIEW_LABELS).toEqual({
      matrix: '容量矩阵',
      list: '资源底册',
      skills: '技能',
      conflicts: '冲突',
      demand_gaps: '需求缺口',
      trend: '趋势',
    })
  })
})

// ---------------------------------------------------------------------------
// 超载判定
// ---------------------------------------------------------------------------

describe('超载判定（>100%）', () => {
  test('100% 不算超载、100.5% 算超载', () => {
    expect(isPoolOverloaded(100)).toBe(false)
    expect(isPoolOverloaded(100, 'high')).toBe(false)
    expect(isPoolOverloaded(100.5)).toBe(true)
    expect(isPoolOverloaded(125, 'overloaded')).toBe(true)
    expect(isPoolOverloaded(80, 'overloaded')).toBe(true)
  })

  test('容量单元：利用率或冲突标记任一超载即红', () => {
    expect(
      isPoolCellOverloaded({ utilizationPercent: 75, loadStatus: 'normal', conflictFlags: [] }),
    ).toBe(false)
    expect(
      isPoolCellOverloaded({ utilizationPercent: 100, loadStatus: 'high', conflictFlags: [] }),
    ).toBe(false)
    expect(
      isPoolCellOverloaded({
        utilizationPercent: 100,
        loadStatus: 'high',
        conflictFlags: ['error'],
      }),
    ).toBe(true)
    expect(
      isPoolCellOverloaded({
        utilizationPercent: 105,
        loadStatus: 'overloaded',
        conflictFlags: [],
      }),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 受限脱敏
// ---------------------------------------------------------------------------

describe('受限列脱敏判定与中性文案（RL-05）', () => {
  test('forbidden / redacted / unavailable 状态视为受限指标', () => {
    expect(isPoolMetricRestricted({ status: 'forbidden' })).toBe(true)
    expect(isPoolMetricRestricted({ status: 'redacted' })).toBe(true)
    expect(isPoolMetricRestricted({ status: 'unavailable' })).toBe(true)
    expect(isPoolMetricRestricted({ status: 'ok' })).toBe(false)
    expect(isPoolMetricRestricted({ status: 'stale' })).toBe(false)
  })

  test('中性文案「不可见」', () => {
    expect(POOL_RESTRICTED_TEXT).toBe('不可见')
  })

  test('行身份受限：redacted 标记或名称为空；技能列随行级受限', () => {
    expect(isPoolRowIdentityRestricted({ redacted: true, resourceName: '张三' })).toBe(true)
    expect(isPoolRowIdentityRestricted({ redacted: false, resourceName: null })).toBe(true)
    expect(isPoolRowIdentityRestricted({ redacted: false, resourceName: '张三' })).toBe(false)
    expect(isPoolSkillColumnRestricted({ redacted: true })).toBe(true)
    expect(isPoolSkillColumnRestricted({ redacted: false })).toBe(false)
    expect(getPoolRowRestrictedLabel()).toBe('已脱敏')
  })

  test('受限行模型不携带身份细节', () => {
    const row: OrganizationResourcePoolCapacityMatrixRow = {
      resourceId: 9,
      resourceName: null,
      role: null,
      loadStatus: 'normal',
      totalCapacityHours: 80,
      totalAllocatedHours: 60,
      totalRemainingHours: 20,
      utilizationPercent: 75,
      redacted: true,
      cells: [
        {
          date: '2026-07-01',
          capacityHours: 8,
          allocatedHours: 6,
          remainingHours: 2,
          utilizationPercent: 75,
          loadStatus: 'normal',
          conflictFlags: [],
        },
      ],
    }
    const model = buildPoolCapacityRowModel(row)
    expect(model.restricted).toBe(true)
    expect(model.name).toBeNull()
    expect(model.role).toBeNull()
    expect(model.cells).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 数值格式化
// ---------------------------------------------------------------------------

describe('数值格式化', () => {
  test('小时格式化：0h / 一位小数 / 非法值', () => {
    expect(formatPoolHours(0)).toBe('0h')
    expect(formatPoolHours(960)).toBe('960.0h')
    expect(formatPoolHours(80.25)).toBe('80.3h')
    expect(formatPoolHours(Number.NaN)).toBe('—')
    expect(formatPoolHours(Number.POSITIVE_INFINITY)).toBe('—')
  })

  test('百分比格式化取整', () => {
    expect(formatPoolPercent(75.4)).toBe('75%')
    expect(formatPoolPercent(100)).toBe('100%')
    expect(formatPoolPercent(125.6)).toBe('126%')
    expect(formatPoolPercent(Number.NaN)).toBe('—')
  })
})

// ---------------------------------------------------------------------------
// 冲突严重度标签与色阶
// ---------------------------------------------------------------------------

describe('冲突严重度标签与色阶', () => {
  test('四级标签全覆盖', () => {
    expect(POOL_CONFLICT_SEVERITY_LABELS).toEqual({
      info: '信息',
      warning: '警告',
      error: '错误',
      critical: '严重',
    })
  })

  test('error/critical 同警戒红、warning 警告黄、info 冷蓝', () => {
    expect(POOL_CONFLICT_SEVERITY_TONES).toEqual({
      info: '--nx-chart-1',
      warning: '--nx-status-warning',
      error: '--nx-status-danger',
      critical: '--nx-status-danger',
    })
    const sev: OrganizationResourcePoolConflictSeverity[] = ['info', 'warning', 'error', 'critical']
    for (const s of sev) {
      expect(getPoolConflictSeverityLabel(s)).toBe(POOL_CONFLICT_SEVERITY_LABELS[s])
      expect(getPoolConflictSeverityTone(s)).toBe(POOL_CONFLICT_SEVERITY_TONES[s])
    }
  })
})

// ---------------------------------------------------------------------------
// 容量矩阵行模型
// ---------------------------------------------------------------------------

function makeMatrix(overrides: Partial<OrganizationResourcePoolCapacityMatrix> = {}) {
  const row: OrganizationResourcePoolCapacityMatrixRow = {
    resourceId: 1,
    resourceName: '张三',
    role: '前端开发',
    loadStatus: 'normal',
    totalCapacityHours: 40,
    totalAllocatedHours: 34,
    totalRemainingHours: 6,
    utilizationPercent: 85,
    redacted: false,
    cells: [
      {
        date: '2026-07-01',
        capacityHours: 8,
        allocatedHours: 4,
        remainingHours: 4,
        utilizationPercent: 50,
        loadStatus: 'normal',
        conflictFlags: [],
      },
      {
        date: '2026-07-02',
        capacityHours: 8,
        allocatedHours: 8.4,
        remainingHours: 0,
        utilizationPercent: 105,
        loadStatus: 'overloaded',
        conflictFlags: ['error'],
      },
    ],
  }
  return { from: '2026-07-01', to: '2026-07-02', rows: [row], ...overrides }
}

describe('容量矩阵行模型与日期聚合', () => {
  test('行模型携带总计/状态/双通道信息', () => {
    const model = buildPoolCapacityRows(makeMatrix())[0]!
    expect(model.resourceId).toBe(1)
    expect(model.restricted).toBe(false)
    expect(model.name).toBe('张三')
    expect(model.role).toBe('前端开发')
    expect(model.loadLabel).toBe('正常')
    expect(model.loadTone).toBe('--nx-chart-1')
    expect(model.utilizationText).toBe('85%')
    expect(model.totalCapacityHours).toBe(40)
  })

  test('超载行（>100%）警戒红 + 过载文字徽标', () => {
    const overloadedRow: OrganizationResourcePoolCapacityMatrixRow = {
      ...makeMatrix().rows[0]!,
      resourceId: 2,
      resourceName: '李四',
      utilizationPercent: 125,
      loadStatus: 'overloaded',
      totalAllocatedHours: 50,
      totalRemainingHours: -10,
    }
    const model = buildPoolCapacityRowModel(overloadedRow)
    expect(model.overloaded).toBe(true)
    expect(model.loadLabel).toBe('过载')
    expect(model.loadTone).toBe('--nx-status-danger')
  })

  test('逐日单元模型：色阶/超载/文字双通道', () => {
    const cells = buildPoolCapacityRows(makeMatrix())[0]!.cells
    const normalCell = cells[0]!
    expect(normalCell.text).toBe('50%')
    expect(normalCell.overloaded).toBe(false)
    expect(normalCell.tone).toBe('--nx-chart-1')

    const overloadedCell = cells[1]!
    expect(overloadedCell.overloaded).toBe(true)
    expect(overloadedCell.tone).toBe('--nx-status-danger')
    expect(overloadedCell.text).toBe('105%')
  })

  test('日期列头并集去重保序（多行错位日期）', () => {
    const matrix = makeMatrix()
    matrix.rows[0]!.cells[1]!.date = '2026-07-03'
    matrix.rows.push({
      resourceId: 2,
      resourceName: '李四',
      role: '后端开发',
      loadStatus: 'high',
      totalCapacityHours: 40,
      totalAllocatedHours: 40,
      totalRemainingHours: 0,
      utilizationPercent: 100,
      redacted: false,
      cells: [
        {
          date: '2026-07-03',
          capacityHours: 8,
          allocatedHours: 8,
          remainingHours: 0,
          utilizationPercent: 100,
          loadStatus: 'high',
          conflictFlags: [],
        },
      ],
    })
    expect(collectPoolMatrixDates(matrix)).toEqual(['2026-07-01', '2026-07-03'])
  })

  test('空矩阵安全返回空数组', () => {
    expect(buildPoolCapacityRows({ from: '', to: '', rows: [] })).toEqual([])
    expect(collectPoolMatrixDates({ from: '', to: '', rows: [] })).toEqual([])
  })
})
