import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetCriticalPathMemo,
  computeCriticalPath,
  memoizedComputeCriticalPath,
  type CpmDependencyInput,
  type CpmTaskInput,
} from '@/lib/gantt/critical-path'
import {
  createWorkingCalendar,
  parseIsoDate,
  type WorkingCalendar,
} from '@/lib/gantt/working-calendar'

const cal: WorkingCalendar = createWorkingCalendar({ workdays: [1, 2, 3, 4, 5] })

function ms(iso: string): number {
  return parseIsoDate(iso)
}

function task(
  id: number,
  startIso: string,
  endIso: string,
  taskType: 'task' | 'milestone' | 'summary' = 'task',
): CpmTaskInput {
  return { taskId: id, startMs: ms(startIso), endMs: ms(endIso), taskType }
}

function dep(
  depId: number,
  predId: number,
  succId: number,
  type: 'fs' | 'ss' | 'ff' | 'sf' = 'fs',
  lagDays = 0,
): CpmDependencyInput {
  return { depId, predecessorId: predId, successorId: succId, type, lagDays }
}

function criticalIds(result: ReturnType<typeof computeCriticalPath>): Set<number> {
  if (!result.ok) return new Set()
  const set = new Set<number>()
  for (const [id, r] of result.tasks) if (r.isCritical) set.add(id)
  return set
}

function floatOf(result: ReturnType<typeof computeCriticalPath>, id: number): number {
  if (!result.ok) return -1
  return result.tasks.get(id)?.totalFloat ?? -1
}

beforeEach(() => {
  __resetCriticalPathMemo()
})

describe('CPM 计算核 —— 单链与浮动', () => {
  it('单链 A→B→C（FS 无 lag）全部关键、浮动 0', () => {
    // A: 07-06(周一)..07-07(周二) ; B: 07-08..07-09 ; C: 07-10
    const tasks = [
      task(1, '2026-07-06', '2026-07-07'),
      task(2, '2026-07-08', '2026-07-09'),
      task(3, '2026-07-10', '2026-07-10'),
    ]
    const deps = [dep(1, 1, 2, 'fs'), dep(2, 2, 3, 'fs')]
    const result = computeCriticalPath(tasks, deps, cal)
    expect(result.ok).toBe(true)
    expect(criticalIds(result)).toEqual(new Set([1, 2, 3]))
    expect(floatOf(result, 1)).toBe(0)
    expect(floatOf(result, 2)).toBe(0)
    expect(floatOf(result, 3)).toBe(0)
    // 关键依赖全部标记
    if (result.ok) {
      expect(result.deps.get(1)).toBe(true)
      expect(result.deps.get(2)).toBe(true)
    }
  })

  it('并行分支 A→B→D 与 A→C→D：长路径关键，短路径有浮动', () => {
    // A: 07-06(1天) ; B: 07-07..07-09(3天) ; C: 07-07(1天) ; D: 07-10
    const tasks = [
      task(1, '2026-07-06', '2026-07-06'),
      task(2, '2026-07-07', '2026-07-09'),
      task(3, '2026-07-07', '2026-07-07'),
      task(4, '2026-07-10', '2026-07-10'),
    ]
    const deps = [dep(1, 1, 2, 'fs'), dep(2, 1, 3, 'fs'), dep(3, 2, 4, 'fs'), dep(4, 3, 4, 'fs')]
    const result = computeCriticalPath(tasks, deps, cal)
    expect(result.ok).toBe(true)
    expect(criticalIds(result)).toEqual(new Set([1, 2, 4])) // C(3) 非关键
    expect(floatOf(result, 3)).toBeGreaterThan(0)
    if (result.ok) {
      // A→C、C→D 非关键依赖（C 非关键）
      expect(result.deps.get(2)).toBe(false)
      expect(result.deps.get(4)).toBe(false)
      // A→B、B→D 关键依赖
      expect(result.deps.get(1)).toBe(true)
      expect(result.deps.get(3)).toBe(true)
    }
  })

  it('多终点取最大 EF 为锚：早终点有浮动，晚终点关键', () => {
    // X: 07-06(1天, EF=周一) ; Y: 07-06..07-08(3天, EF=周三)
    const tasks = [task(1, '2026-07-06', '2026-07-06'), task(2, '2026-07-06', '2026-07-08')]
    const result = computeCriticalPath(tasks, [], cal)
    expect(result.ok).toBe(true)
    expect(criticalIds(result)).toEqual(new Set([2]))
    expect(floatOf(result, 1)).toBe(2) // 周一→周三 = 3 工作日 - 1 = 2
  })

  it('单链全关键（无依赖，单任务终点）', () => {
    const tasks = [task(1, '2026-07-06', '2026-07-08')]
    const result = computeCriticalPath(tasks, [], cal)
    expect(result.ok).toBe(true)
    expect(criticalIds(result)).toEqual(new Set([1]))
    expect(floatOf(result, 1)).toBe(0)
  })
})

describe('CPM 计算核 —— 四类依赖约束与工作日感知', () => {
  it('FS 跨周末：前置周五结束，后继周一开始周二结束', () => {
    // A: 07-03(周五) ; B: 07-06(周一)..07-07(周二)
    const tasks = [task(1, '2026-07-03', '2026-07-03'), task(2, '2026-07-06', '2026-07-07')]
    const deps = [dep(1, 1, 2, 'fs')]
    const result = computeCriticalPath(tasks, deps, cal)
    expect(result.ok).toBe(true)
    // 周末不产生浮动：单链全关键
    expect(criticalIds(result)).toEqual(new Set([1, 2]))
    expect(floatOf(result, 1)).toBe(0)
    expect(floatOf(result, 2)).toBe(0)
  })

  it('SS 依赖带 lag：前置周一开始，lag=2 → 后继周三开始', () => {
    // A: 07-06..07-08 ; B: SS lag=2 → 07-08(周三) 开始
    const tasks = [task(1, '2026-07-06', '2026-07-08'), task(2, '2026-07-08', '2026-07-08')]
    const deps = [dep(1, 1, 2, 'ss', 2)]
    const result = computeCriticalPath(tasks, deps, cal)
    expect(result.ok).toBe(true)
    // A 是长任务（EF=周三），B 也周三开始周三结束；锚=周三，两者关键
    expect(criticalIds(result)).toEqual(new Set([1, 2]))
  })

  it('FF 依赖反推最早开始：前置周三结束，FF lag=1，后继工期 3 → 后继 EF=周四、ES=周二', () => {
    // A: 07-06..07-08(EF=周三) ; B: 07-06..07-08(ownStart=周一, dur 3)
    // FF lag=1：B.EF = shift(周三, 1) = 周四(07-09)；B.ES = startFromEnd(周四, 3) = 周二(07-07)
    // FF 把 B 从周一推到周二开始 → projectDeadline=周四；单链 A→B 全关键
    const tasks = [task(1, '2026-07-06', '2026-07-08'), task(2, '2026-07-06', '2026-07-08')]
    const deps = [dep(1, 1, 2, 'ff', 1)]
    const result = computeCriticalPath(tasks, deps, cal)
    expect(result.ok).toBe(true)
    // FF 单链：A、B 均关键（B.EF=周四=锚，A.LF=周三=A.EF）
    expect(criticalIds(result)).toEqual(new Set([1, 2]))
    expect(floatOf(result, 1)).toBe(0)
    expect(floatOf(result, 2)).toBe(0)
  })

  it('负 lag（lead）：FS lag=−1 → 后继可在前置结束当日开始', () => {
    // A: 07-06..07-08(EF=周三) ; B: FS lag=-1 → ES=shift(周三, 0)=周三
    const tasks = [task(1, '2026-07-06', '2026-07-08'), task(2, '2026-07-08', '2026-07-08')]
    const deps = [dep(1, 1, 2, 'fs', -1)]
    const result = computeCriticalPath(tasks, deps, cal)
    expect(result.ok).toBe(true)
    // B.ES = 周三 = A.EF，两任务都在周三收尾，单链关键
    expect(criticalIds(result)).toEqual(new Set([1, 2]))
  })

  it('跨节假日：节假日不产生浮动', () => {
    const holidayCal = createWorkingCalendar({
      workdays: [1, 2, 3, 4, 5],
      holidays: ['2026-07-06'],
    })
    // A: 07-03(周五) ; B: FS → 跳过周末 + 07-06 节假 → 07-07(周二) 开始
    const tasks = [task(1, '2026-07-03', '2026-07-03'), task(2, '2026-07-07', '2026-07-07')]
    const deps = [dep(1, 1, 2, 'fs')]
    const result = computeCriticalPath(tasks, deps, holidayCal)
    expect(result.ok).toBe(true)
    expect(criticalIds(result)).toEqual(new Set([1, 2]))
    expect(floatOf(result, 1)).toBe(0)
    expect(floatOf(result, 2)).toBe(0)
  })
})

describe('CPM 计算核 —— 关键依赖识别', () => {
  it('关键任务间的非约束依赖不标记', () => {
    // A→C（关键链）与 X→B（关键链）两条并列；额外加一条 A→B（非约束）。
    // A: 07-06(1天) ; C: 07-07..07-08(2天, EF=周四=锚)
    // X: 07-06..07-07(2天, EF=周二) ; B: 07-08(1天)
    // A→B（FS）：required=shift(A.EF=周一,1)=周二 < B.ES=周三 → 边浮动>0 → 非关键依赖
    // X→B（FS）：required=shift(X.EF=周二,1)=周三 = B.ES → 边浮动 0 → 关键依赖
    // A 经 A→C 路径关键；B 经 X→B 路径关键。
    const tasks = [
      task(1, '2026-07-06', '2026-07-06'), // A
      task(2, '2026-07-07', '2026-07-08'), // C
      task(3, '2026-07-06', '2026-07-07'), // X
      task(4, '2026-07-08', '2026-07-08'), // B
    ]
    const deps = [
      dep(1, 1, 2, 'fs'), // A→C
      dep(2, 3, 4, 'fs'), // X→B
      dep(3, 1, 4, 'fs'), // A→B（非约束）
    ]
    const result = computeCriticalPath(tasks, deps, cal)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tasks.get(1)?.isCritical).toBe(true) // A
      expect(result.tasks.get(2)?.isCritical).toBe(true) // C
      expect(result.tasks.get(3)?.isCritical).toBe(true) // X
      expect(result.tasks.get(4)?.isCritical).toBe(true) // B
      expect(result.deps.get(1)).toBe(true) // A→C 约束边
      expect(result.deps.get(2)).toBe(true) // X→B 约束边
      expect(result.deps.get(3)).toBe(false) // A→B 非约束（边浮动>0）
    }
  })

  it('并列多关键路径全标记', () => {
    // A→B→D 与 A→C→D 两条路径工期完全相等 → 全部关键
    // A: 07-06 ; B: 07-07 ; C: 07-07 ; D: 07-08
    const tasks = [
      task(1, '2026-07-06', '2026-07-06'),
      task(2, '2026-07-07', '2026-07-07'),
      task(3, '2026-07-07', '2026-07-07'),
      task(4, '2026-07-08', '2026-07-08'),
    ]
    const deps = [dep(1, 1, 2, 'fs'), dep(2, 1, 3, 'fs'), dep(3, 2, 4, 'fs'), dep(4, 3, 4, 'fs')]
    const result = computeCriticalPath(tasks, deps, cal)
    expect(result.ok).toBe(true)
    expect(criticalIds(result)).toEqual(new Set([1, 2, 3, 4]))
    if (result.ok) {
      for (const id of [1, 2, 3, 4]) expect(result.deps.get(id)).toBe(true)
    }
  })
})

describe('CPM 计算核 —— 环与异常降级', () => {
  it('依赖图存在环：返回 CYCLE 警示，全部不标记关键', () => {
    // A→B→A 成环
    const tasks = [task(1, '2026-07-06', '2026-07-06'), task(2, '2026-07-06', '2026-07-06')]
    const deps = [dep(1, 1, 2, 'fs'), dep(2, 2, 1, 'fs')]
    const result = computeCriticalPath(tasks, deps, cal)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('CYCLE')
      expect(criticalIds(result).size).toBe(0)
      for (const r of result.tasks.values()) expect(r.isCritical).toBe(false)
    }
  })

  it('端点缺失的依赖被跳过，不报错', () => {
    const tasks = [task(1, '2026-07-06', '2026-07-06'), task(2, '2026-07-07', '2026-07-07')]
    // dep 引用不存在的任务 999
    const deps = [dep(1, 1, 2, 'fs'), dep(2, 1, 999, 'fs'), dep(3, 999, 2, 'fs')]
    const result = computeCriticalPath(tasks, deps, cal)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.deps.has(2)).toBe(false)
      expect(result.deps.has(3)).toBe(false)
      expect(result.deps.get(1)).toBe(true)
    }
  })

  it('自环依赖被跳过', () => {
    const tasks = [task(1, '2026-07-06', '2026-07-06')]
    const deps = [dep(1, 1, 1, 'fs')]
    const result = computeCriticalPath(tasks, deps, cal)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.deps.has(1)).toBe(false)
  })

  it('重复依赖按 id 去重', () => {
    const tasks = [task(1, '2026-07-06', '2026-07-06'), task(2, '2026-07-07', '2026-07-07')]
    const deps = [dep(1, 1, 2, 'fs'), dep(1, 1, 2, 'fs')]
    const result = computeCriticalPath(tasks, deps, cal)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.deps.size).toBe(1)
  })

  it('空任务集返回 EMPTY', () => {
    const result = computeCriticalPath([], [], cal)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('EMPTY')
  })
})

describe('CPM 计算核 —— 汇总与里程碑', () => {
  it('汇总任务排除出 CPM（isCritical=false）', () => {
    const tasks = [
      task(1, '2026-07-06', '2026-07-08', 'summary'), // 汇总，不参与
      task(2, '2026-07-06', '2026-07-08'), // 子任务
    ]
    const result = computeCriticalPath(tasks, [], cal)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tasks.has(1)).toBe(false) // 汇总不在结果中
      expect(result.tasks.get(2)?.isCritical).toBe(true)
    }
  })

  it('里程碑零工期作为节点正常参与传递', () => {
    // A→M（里程碑）→B ；M 零工期
    const tasks = [
      task(1, '2026-07-06', '2026-07-06'),
      task(2, '2026-07-07', '2026-07-07', 'milestone'),
      task(3, '2026-07-08', '2026-07-08'),
    ]
    const deps = [dep(1, 1, 2, 'fs'), dep(2, 2, 3, 'fs')]
    const result = computeCriticalPath(tasks, deps, cal)
    expect(result.ok).toBe(true)
    expect(criticalIds(result)).toEqual(new Set([1, 2, 3]))
    expect(floatOf(result, 2)).toBe(0)
  })
})

describe('CPM 记忆化（design D8）', () => {
  it('同签名复用结果（同引用）；滚动/视口变化不改签名', () => {
    const tasks = [task(1, '2026-07-06', '2026-07-08')]
    const depsEmpty: CpmDependencyInput[] = []
    // 首次计算
    const r1 = memoizedComputeCriticalPath(tasks, depsEmpty, cal)
    // 同签名再次 → 同引用
    const r2 = memoizedComputeCriticalPath(tasks, depsEmpty, cal)
    expect(r2).toBe(r1)
  })

  it('拖拽改日期 → 签名变化 → 重算', () => {
    const t1 = [task(1, '2026-07-06', '2026-07-08')]
    const t2 = [task(1, '2026-07-06', '2026-07-09')] // 日期变了
    const r1 = memoizedComputeCriticalPath(t1, [], cal)
    const r2 = memoizedComputeCriticalPath(t2, [], cal)
    expect(r2).not.toBe(r1)
  })

  it('增删依赖 → 签名变化 → 重算', () => {
    const tasks = [task(1, '2026-07-06', '2026-07-06'), task(2, '2026-07-07', '2026-07-07')]
    const r1 = memoizedComputeCriticalPath(tasks, [], cal)
    const r2 = memoizedComputeCriticalPath(tasks, [dep(1, 1, 2, 'fs')], cal)
    expect(r2).not.toBe(r1)
  })

  it('改日历 → 签名变化 → 重算', () => {
    const tasks = [task(1, '2026-07-06', '2026-07-08')]
    const calA = createWorkingCalendar({ workdays: [1, 2, 3, 4, 5] })
    const calB = createWorkingCalendar({ workdays: [1, 2, 3, 4, 5], holidays: ['2026-07-06'] })
    const r1 = memoizedComputeCriticalPath(tasks, [], calA)
    const r2 = memoizedComputeCriticalPath(tasks, [], calB)
    expect(r2).not.toBe(r1)
  })
})
