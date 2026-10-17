/**
 * v3-ui-next-resource-team-domains W1 · tasks 1.2 —— 资源域适配层纯函数单测
 * （零 DOM 依赖，直接调用 lib/next/resources/resource-workbench-adapter）。
 *
 * 覆盖（spec「资源负载分析紧凑视图」/「资源域工作空间与资源列表管理」场景）：
 * - buildTeamRows（图表馆同源再导出）：成员总容量/总分配/平均利用率计算、
 *   超载判定（>100% 为 true，恰 100% 为 false）与空闲标记；
 * - 30 天滑动窗口边界（含跨月/跨年、窗口内天数恒定）；
 * - 全类型资源列表的类型 / 状态 / 名称模糊多维过滤（含交集与兜底行为）；
 * - 紧凑负荷条带分段：正常成员纯蓝段、超载成员红段>0、闲置成员蓝段为 0；
 * - 展示标签 / 技能标签解析 / 成本格式化 / 日期范围文本；
 * - 新建资源 Zod 表单契约：名称/工时/时区/单价/邮箱非法输入逐项阻断与载荷转换。
 */
import { describe, expect, test } from 'vitest'
import type { Resource, ResourceLoadItem } from '@/lib/api/resources'
import type { TeamMemberRow } from '@/lib/next/charts/resource-load-adapter'
import {
  ALLOCATION_TYPE_LABELS,
  buildCompactLoadBar,
  buildTeamRows,
  createDefaultLoadWindow,
  filterResources,
  formatAllocationRange,
  formatHours,
  formatUnitCost,
  parseSkillTags,
  RESOURCE_STATUS_LABELS,
  RESOURCE_TYPE_LABELS,
  resourceFormSchema,
  resourceRoleLabel,
  resourceStatusLabel,
  resourceTypeLabel,
  toCreateResourceInput,
} from '@/lib/next/resources/resource-workbench-adapter'

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeLoadItem(overrides: Partial<ResourceLoadItem>): ResourceLoadItem {
  return {
    resourceId: 1,
    resourceName: '张工',
    role: 'member',
    dailyCapacityHours: 8,
    days: [],
    overallUtilizationPercent: 0,
    ...overrides,
  }
}

function day(date: string, capacityHours: number, allocatedHours: number) {
  return { date, totalAllocatedPercent: 0, allocatedHours, capacityHours }
}

function makeResource(overrides: Partial<Resource>): Resource {
  return {
    id: 1,
    projectId: 42,
    userId: null,
    name: '张工',
    email: 'zhang@example.com',
    resourceType: 'human',
    role: 'member',
    status: 'active',
    dailyCapacityHours: 8,
    skillTags: null,
    workDays: '1,2,3,4,5',
    timezone: 'Asia/Shanghai',
    costPerUnitCents: 15000,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. 团队负载：buildTeamRows 容量/分配/利用率与超载判定
// ---------------------------------------------------------------------------

describe('buildTeamRows：团队负载行计算（复用图表馆纯函数）', () => {
  test('按日容量与分配累计总额定/总分配，平均利用率 = 分配/容量', () => {
    const items = [
      makeLoadItem({
        resourceId: 11,
        resourceName: '张工',
        role: 'team_lead',
        dailyCapacityHours: 8,
        days: [day('2026-09-01', 8, 8), day('2026-09-02', 8, 4), day('2026-09-03', 0, 0)],
      }),
    ]
    const rows = buildTeamRows(items)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.totalCapacityHours).toBe(16)
    expect(row.totalAllocatedHours).toBe(12)
    expect(row.utilizationPercent).toBe(75)
    expect(row.overloaded).toBe(false)
    expect(row.idle).toBe(false)
    expect(row.resourceName).toBe('张工')
    expect(row.role).toBe('team_lead')
    expect(row.dailyCapacityHours).toBe(8)
  })

  test('利用率 >100% 判定为超载，恰 100% 与低于 100% 不超载', () => {
    const rows = buildTeamRows([
      makeLoadItem({
        resourceId: 1,
        resourceName: '超载甲',
        days: [day('2026-09-01', 8, 8), day('2026-09-02', 8, 10), day('2026-09-03', 8, 8)],
      }),
      makeLoadItem({
        resourceId: 2,
        resourceName: '满载乙',
        days: [day('2026-09-01', 8, 8), day('2026-09-02', 8, 8), day('2026-09-03', 8, 8)],
      }),
      makeLoadItem({
        resourceId: 3,
        resourceName: '空闲丙',
        days: [day('2026-09-01', 8, 0), day('2026-09-02', 8, 0), day('2026-09-03', 8, 0)],
      }),
    ])
    expect(rows[0]).toMatchObject({ utilizationPercent: 108.33, overloaded: true, idle: false })
    expect(rows[1]).toMatchObject({ utilizationPercent: 100, overloaded: false, idle: false })
    expect(rows[2]).toMatchObject({ utilizationPercent: 0, overloaded: false, idle: true })
  })

  test('零容量成员（容量合计为 0）利用率按 0 处理且不超载', () => {
    const rows = buildTeamRows([
      makeLoadItem({ resourceId: 9, resourceName: '无容量', days: [day('2026-09-01', 0, 5)] }),
    ])
    expect(rows[0]).toMatchObject({ utilizationPercent: 0, overloaded: false })
  })
})

// ---------------------------------------------------------------------------
// 2. 30 天滑动窗口边界
// ---------------------------------------------------------------------------

describe('createDefaultLoadWindow：30 天滑动窗口', () => {
  test('默认窗口：含今天共 30 天，起日 = 今天前 29 天', () => {
    const window = createDefaultLoadWindow(new Date(2026, 8, 15)) // 2026-09-15
    expect(window.from).toBe('2026-08-17')
    expect(window.to).toBe('2026-09-15')
    expect(window.days).toBe(30)
  })

  test('跨月边界（月末倒数第二天）正确回退到上月末', () => {
    const window = createDefaultLoadWindow(new Date(2026, 8, 2)) // 2026-09-02（8 月有 31 天）
    expect(window.from).toBe('2026-08-04')
    expect(window.to).toBe('2026-09-02')
    expect(window.days).toBe(30)
  })

  test('跨年边界（1 月中旬）正确回退到上一年 12 月', () => {
    const window = createDefaultLoadWindow(new Date(2026, 0, 10)) // 2026-01-10
    expect(window.from).toBe('2025-12-12')
    expect(window.to).toBe('2026-01-10')
    expect(window.days).toBe(30)
  })

  test('闰年 2 月边界（2028-03-01 前推 29 天）', () => {
    const window = createDefaultLoadWindow(new Date(2028, 1, 29)) // 2028-02-29（闰日）
    expect(window.from).toBe('2028-01-31')
    expect(window.to).toBe('2028-02-29')
    expect(window.days).toBe(30)
  })

  test('自定义窗口天数（未来窗口由调用方另行换算，纯函数尊重参数）', () => {
    const window = createDefaultLoadWindow(new Date(2026, 8, 15), 7)
    expect(window.from).toBe('2026-09-09')
    expect(window.days).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// 3. 多维条件过滤
// ---------------------------------------------------------------------------

describe('filterResources：类型 / 状态 / 名称模糊多维过滤', () => {
  const resources: Resource[] = [
    makeResource({ id: 1, name: '张工', resourceType: 'human', status: 'active', role: 'member' }),
    makeResource({
      id: 2,
      name: '前端李工',
      resourceType: 'human',
      status: 'inactive',
      role: 'team_lead',
    }),
    makeResource({
      id: 3,
      name: '双路 GPU 服务器',
      resourceType: 'equipment',
      status: 'active',
      role: 'owner',
    }),
    makeResource({
      id: 4,
      name: '差旅预算池',
      resourceType: 'budget',
      status: 'active',
      role: 'project_manager',
    }),
    makeResource({
      id: 5,
      name: '结构钢 12mm',
      resourceType: 'material',
      status: 'active',
      role: 'viewer',
    }),
  ]

  test('不过滤时全量返回', () => {
    expect(filterResources(resources)).toHaveLength(5)
    expect(filterResources(resources, { resourceType: '', status: '', keyword: '' })).toHaveLength(
      5,
    )
  })

  test('按类型过滤仅命中对应条目（human / equipment / budget）', () => {
    const humans = filterResources(resources, { resourceType: 'human' })
    expect(humans.map((item) => item.id)).toEqual([1, 2])
    expect(
      filterResources(resources, { resourceType: 'equipment' }).map((item) => item.id),
    ).toEqual([3])
    expect(filterResources(resources, { resourceType: 'budget' }).map((item) => item.id)).toEqual([
      4,
    ])
    // 未登记类型兜底：物料
    expect(filterResources(resources, { resourceType: 'material' }).map((item) => item.id)).toEqual(
      [5],
    )
  })

  test('按状态过滤（活跃 / 停用）', () => {
    const active = filterResources(resources, { status: 'active' })
    expect(active).toHaveLength(4)
    expect(filterResources(resources, { status: 'inactive' }).map((item) => item.id)).toEqual([2])
  })

  test('名称模糊过滤不区分大小写并容忍首尾空白', () => {
    expect(filterResources(resources, { keyword: '张工' }).map((item) => item.id)).toEqual([1])
    expect(filterResources(resources, { keyword: '  GPU ' }).map((item) => item.id)).toEqual([3])
    // 英文大小写不敏感
    const english = [makeResource({ id: 9, name: 'React Native 工程师' })]
    expect(filterResources(english, { keyword: 'react native' }).map((item) => item.id)).toEqual([
      9,
    ])
  })

  test('多条件交集过滤与无命中返回空数组', () => {
    const hits = filterResources(resources, {
      resourceType: 'human',
      status: 'active',
      keyword: '张',
    })
    expect(hits.map((item) => item.id)).toEqual([1])
    expect(
      filterResources(resources, { resourceType: 'human', status: 'active', keyword: '李' }),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. 紧凑负荷条带分段
// ---------------------------------------------------------------------------

describe('buildCompactLoadBar：负荷条带双段计算', () => {
  function rowOf(overrides: Partial<TeamMemberRow>): TeamMemberRow {
    return {
      resourceId: 1,
      resourceName: '张工',
      role: 'member',
      dailyCapacityHours: 8,
      totalCapacityHours: 160,
      totalAllocatedHours: 80,
      utilizationPercent: 50,
      overloaded: false,
      idle: false,
      ...overrides,
    }
  }

  test('正常成员（50%）：蓝段 50%，无红段，余量留白', () => {
    const bar = buildCompactLoadBar(rowOf({}))
    expect(bar).toMatchObject({
      scaleHours: 160,
      normalPercent: 50,
      overloadPercent: 0,
      utilizationPercent: 50,
      overloaded: false,
    })
  })

  test('超载成员（160h 容量 / 184h 分配 / 115%）：蓝段为容量占比、红段 >0', () => {
    const bar = buildCompactLoadBar(
      rowOf({
        totalCapacityHours: 160,
        totalAllocatedHours: 184,
        utilizationPercent: 115,
        overloaded: true,
      }),
    )
    expect(bar.scaleHours).toBe(184)
    expect(bar.normalPercent).toBeCloseTo((160 / 184) * 100, 1)
    expect(bar.overloadPercent).toBeCloseTo((24 / 184) * 100, 1)
    expect(bar.overloadPercent).toBeGreaterThan(0)
    expect(bar.overloaded).toBe(true)
    // 双段合并不超过基准宽度
    expect(bar.normalPercent + bar.overloadPercent).toBeCloseTo(100, 1)
  })

  test('空闲成员：蓝段 0；空窗口（容量分配均为 0）不产生 NaN', () => {
    const idle = buildCompactLoadBar(
      rowOf({ totalAllocatedHours: 0, utilizationPercent: 0, idle: true }),
    )
    expect(idle.normalPercent).toBe(0)
    expect(idle.overloadPercent).toBe(0)
    const empty = buildCompactLoadBar(
      rowOf({ totalCapacityHours: 0, totalAllocatedHours: 0, utilizationPercent: 0, idle: true }),
    )
    expect(Number.isFinite(empty.normalPercent)).toBe(true)
    expect(empty.scaleHours).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 5. 展示标签 / 技能标签 / 成本 / 日期文本
// ---------------------------------------------------------------------------

describe('展示标签与格式化纯函数', () => {
  test('全类型/状态/分配类型标签映射完整', () => {
    expect(RESOURCE_TYPE_LABELS).toEqual({
      human: '人员',
      material: '物料',
      equipment: '设备',
      budget: '预算',
    })
    expect(RESOURCE_STATUS_LABELS).toEqual({ active: '活跃', inactive: '停用' })
    expect(ALLOCATION_TYPE_LABELS).toEqual({
      assigned: '已指派',
      allocated: '已分配',
      reserved: '预留',
    })
    expect(resourceTypeLabel('human')).toBe('人员')
    expect(resourceStatusLabel('inactive')).toBe('停用')
    // 未知代码兜底原文
    expect(resourceTypeLabel('vehicle' as Resource['resourceType'])).toBe('vehicle')
    expect(resourceStatusLabel('x' as Resource['status'])).toBe('x')
  })

  test('角色标签映射（图表馆同源）', () => {
    expect(resourceRoleLabel('owner')).toBe('负责人')
    expect(resourceRoleLabel('project_manager')).toBe('项目经理')
    expect(resourceRoleLabel('member')).toBe('成员')
    expect(resourceRoleLabel('ghost_role')).toBe('ghost_role')
  })

  test('技能标签解析：JSON 数组 / 逗号顿号 / 空值与非法输入', () => {
    expect(parseSkillTags(null)).toEqual([])
    expect(parseSkillTags('')).toEqual([])
    expect(parseSkillTags('   ')).toEqual([])
    expect(parseSkillTags('["React","TypeScript","React"]')).toEqual(['React', 'TypeScript'])
    expect(parseSkillTags('React, TypeScript、性能优化；Vue')).toEqual([
      'React',
      'TypeScript',
      '性能优化',
      'Vue',
    ])
    expect(parseSkillTags('{"a":1}')).toEqual([]) // 合法 JSON 但非数组 → 无标签
  })

  test('单位成本格式化为人民币（分 → 元），null 显示占位', () => {
    expect(formatUnitCost(15000)).toBe('¥150.00')
    expect(formatUnitCost(150000)).toBe('¥1500.00')
    expect(formatUnitCost(null)).toBe('—')
    expect(formatUnitCost(undefined)).toBe('—')
  })

  test('分配日期范围文本：双端 / 单端 / 空', () => {
    expect(formatAllocationRange('2026-09-01', '2026-09-30')).toBe('2026-09-01 ~ 2026-09-30')
    expect(formatAllocationRange('2026-09-01', null)).toBe('自 2026-09-01')
    expect(formatAllocationRange(null, '2026-09-30')).toBe('至 2026-09-30')
    expect(formatAllocationRange(null, null)).toBe('—')
  })

  test('工时格式化去多余小数尾零', () => {
    expect(formatHours(8)).toBe('8')
    expect(formatHours(184.0)).toBe('184')
    expect(formatHours(8.5)).toBe('8.5')
  })
})

// ---------------------------------------------------------------------------
// 6. 新建资源 Zod 表单契约
// ---------------------------------------------------------------------------

describe('resourceFormSchema：新建资源表单校验契约', () => {
  const valid = {
    name: '张工',
    resourceType: 'human',
    role: 'member',
    timezone: 'Asia/Shanghai',
    email: '',
    dailyCapacityHoursInput: '8',
    costInput: '',
    skillTagText: 'React, TypeScript',
  }

  test('合法输入通过校验', () => {
    const result = resourceFormSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  test('名称为空或全空白 → 阻断并提示「请输入资源名称」', () => {
    for (const name of ['', '   ']) {
      const result = resourceFormSchema.safeParse({ ...valid, name })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.message === '请输入资源名称')).toBe(true)
      }
    }
  })

  test('类型缺失 → 阻断', () => {
    const { resourceType: _omitted, ...rest } = valid
    const result = resourceFormSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  test('日额定工时非法（空 / 0.4 / 25 / 非数字）→ 阻断并提示区间', () => {
    for (const value of ['', '0.4', '25', 'abc']) {
      const result = resourceFormSchema.safeParse({ ...valid, dailyCapacityHoursInput: value })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(
          result.error.issues.some((issue) =>
            issue.message.includes('日额定工时需在 0.5 ~ 24 小时之间'),
          ),
        ).toBe(true)
      }
    }
    // 边界合法
    expect(resourceFormSchema.safeParse({ ...valid, dailyCapacityHoursInput: '0.5' }).success).toBe(
      true,
    )
    expect(resourceFormSchema.safeParse({ ...valid, dailyCapacityHoursInput: '24' }).success).toBe(
      true,
    )
  })

  test('时区为空 → 阻断', () => {
    const result = resourceFormSchema.safeParse({ ...valid, timezone: '  ' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message === '请输入时区')).toBe(true)
    }
  })

  test('单价非负校验：负数与非法数字阻断，空串放行', () => {
    expect(resourceFormSchema.safeParse({ ...valid, costInput: '-1' }).success).toBe(false)
    expect(resourceFormSchema.safeParse({ ...valid, costInput: 'NaN' }).success).toBe(false)
    expect(resourceFormSchema.safeParse({ ...valid, costInput: '' }).success).toBe(true)
    expect(resourceFormSchema.safeParse({ ...valid, costInput: '150.5' }).success).toBe(true)
  })

  test('邮箱格式校验：非法邮箱阻断，空串放行', () => {
    expect(resourceFormSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
    expect(resourceFormSchema.safeParse({ ...valid, email: 'zhang@example.com' }).success).toBe(
      true,
    )
    expect(resourceFormSchema.safeParse({ ...valid, email: '' }).success).toBe(true)
  })

  test('载荷转换：元 → 分、标签文本 → 数组、空单价 → null', () => {
    const result = resourceFormSchema.safeParse({
      ...valid,
      email: 'zhang@example.com',
      costInput: '150.5',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(toCreateResourceInput(result.data)).toMatchObject({
        name: '张工',
        resourceType: 'human',
        role: 'member',
        timezone: 'Asia/Shanghai',
        email: 'zhang@example.com',
        dailyCapacityHours: 8,
        costPerUnitCents: 15050,
        skillTags: ['React', 'TypeScript'],
      })
    }
    const emptyCost = resourceFormSchema.safeParse(valid)
    if (emptyCost.success) {
      expect(toCreateResourceInput(emptyCost.data).costPerUnitCents).toBeNull()
    }
  })
})
