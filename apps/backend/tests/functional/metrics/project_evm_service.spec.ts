/**
 * v3-chart-gallery-data-foundation —— W4.2 ProjectEvmService 功能测试。
 *
 * 已知输入 → 期望输出的确定性断言（基准场景全部手工核算）：
 * - 双任务基线（T1 100000¢ / 07-01..07-10 已完工；T2 200000¢ / 07-01..07-20 进度 50%）
 * - asOf=2026-07-10 时 PV=194736.84、EV=200000、AC=180000、CPI=1.111、SPI=1.027 …
 * - S 曲线逐点重放与 EAC 预测趋势；无基线降级；旧快照 ?? 0 防御；空数据；跨组织 404。
 */
import GanttBaseline from '#models/gantt_baseline'
import Task from '#models/task'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import ProjectEvmService from '#services/project_evm_service'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('ProjectEvmService', (group) => {
  useAuthDatabase(group)

  let evmSvc: ProjectEvmService
  group.each.setup(() => {
    evmSvc = new ProjectEvmService()
  })

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('evm-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'Project Manager')
    return { owner, org, project }
  }

  /** 主基准场景：T1 按期完工但超支，T2 进度 50% 尚未完工。 */
  async function seedBaselineScenario(projectId: number, overrides: { delayed?: boolean } = {}) {
    const task1 = await Task.create({
      projectId,
      name: '任务一',
      status: 'completed',
      progressPercent: 100,
      startDate: DateTime.fromISO('2026-07-01'),
      endDate: DateTime.fromISO('2026-07-10'),
      actualStartDate: DateTime.fromISO('2026-07-01'),
      actualEndDate: overrides.delayed
        ? DateTime.fromISO('2026-07-12')
        : DateTime.fromISO('2026-07-10'),
      costEstimateCents: 100000,
      costActualCents: overrides.delayed ? 130000 : 120000,
    })
    const task2 = await Task.create({
      projectId,
      name: '任务二',
      status: 'in_progress',
      progressPercent: overrides.delayed ? 40 : 50,
      startDate: DateTime.fromISO('2026-07-01'),
      endDate: DateTime.fromISO('2026-07-20'),
      actualStartDate: overrides.delayed
        ? DateTime.fromISO('2026-07-08')
        : DateTime.fromISO('2026-07-05'),
      costEstimateCents: 200000,
      costActualCents: overrides.delayed ? 150000 : 60000,
    })
    await GanttBaseline.create({
      projectId,
      createdBy: 1,
      snapshot: {
        tasks: [
          {
            id: task1.id,
            startDate: '2026-07-01',
            endDate: '2026-07-10',
            baselineCostCents: 100000,
          },
          {
            id: task2.id,
            startDate: '2026-07-01',
            endDate: '2026-07-20',
            baselineCostCents: 200000,
          },
        ],
        milestones: [],
        savedAt: '2026-06-30T00:00:00.000Z',
        totalBaselineCostCents: 300000,
      },
    })
    return { task1, task2 }
  }

  test('标准场景：BAC/PV/EV/AC 与偏差指数精确核算（on_track + under_budget）', async ({
    assert,
  }) => {
    const { org, project } = await setupProject()
    await seedBaselineScenario(project.id)

    const result = await evmSvc.getIndicators(org.id, project.id, '2026-07-10')

    assert.equal(result.asOfDate, '2026-07-10')
    assert.equal(result.hasBaseline, true)
    assert.equal(result.bac, 300000)
    // PV = 100000（T1 期满）+ 200000 × 9/19 ≈ 94736.84
    assert.equal(result.pv, 194736.84)
    assert.equal(result.ev, 200000)
    assert.equal(result.ac, 180000)
    assert.equal(result.cv, 20000)
    assert.equal(result.sv, 5263.16)
    assert.equal(result.cpi, 1.111)
    assert.equal(result.spi, 1.027)
    // ETC = (BAC-EV)/rawCPI = 100000 / (10/9) = 90000；EAC = AC + ETC
    assert.equal(result.etc, 90000)
    assert.equal(result.eac, 270000)
    assert.equal(result.vac, 30000)
    assert.equal(result.tcpi, 0.833)
    assert.equal(result.costStatus, 'under_budget')
    assert.equal(result.scheduleStatus, 'on_track')
  })

  test('滞后超支场景：SPI/CPI 双双跌破阈值 → delayed + over_budget', async ({ assert }) => {
    const { org, project } = await setupProject()
    await seedBaselineScenario(project.id, { delayed: true })

    const result = await evmSvc.getIndicators(org.id, project.id, '2026-07-15')

    // PV = 100000（T1 基线期满 07-10）+ 200000 × 14/19 ≈ 147368.42
    assert.equal(result.pv, 247368.42)
    assert.equal(result.ev, 180000)
    assert.equal(result.ac, 280000)
    assert.equal(result.cv, -100000)
    assert.equal(result.cpi, 0.643)
    assert.equal(result.spi, 0.728)
    // ETC = 120000 / (18/28) = 186666.67 → round 186667
    assert.equal(result.etc, 186667)
    assert.equal(result.eac, 466667)
    assert.equal(result.vac, -166667)
    assert.equal(result.tcpi, 6)
    assert.equal(result.costStatus, 'over_budget')
    assert.equal(result.scheduleStatus, 'delayed')
  })

  test('S 曲线：日粒度点阵连续性、历史 EV/AC 重放与 EAC 预测', async ({ assert }) => {
    const { org, project } = await setupProject()
    await seedBaselineScenario(project.id)

    const curve = await evmSvc.getSCurve(org.id, project.id, '2026-07-10')

    assert.equal(curve.startDate, '2026-07-01')
    assert.equal(curve.endDate, '2026-07-20')
    assert.equal(curve.points.length, 20) // 07-01..07-20 每日共 20 天
    assert.isAtMost(curve.points.length, 150)
    const byDate = new Map(curve.points.map((p) => [p.date, p]))

    // 起点：全部为 0
    const first = byDate.get('2026-07-01')!
    assert.deepEqual(first, { date: '2026-07-01', pv: 0, ev: 0, ac: 0, eacForecast: null })

    // 中点 07-05：PV = 100000×4/9 + 200000×4/19；EV 仅 T1 爬升 4/9；AC 同构
    const mid = byDate.get('2026-07-05')!
    assert.equal(mid.pv, 86549.71)
    assert.equal(mid.ev, 44444.44)
    assert.equal(mid.ac, 53333.33)
    assert.equal(mid.eacForecast, null)

    // asOf 当日点 = 指标卡数值
    const current = byDate.get('2026-07-10')!
    assert.equal(current.pv, 194736.84)
    assert.equal(current.ev, 200000)
    assert.equal(current.ac, 180000)
    assert.equal(current.eacForecast, null)

    // 未来点：仅 pv + eacForecast 线性预测（AC + ETC × 已过/总剩）
    const future = byDate.get('2026-07-15')!
    assert.equal(future.pv, 247368.42)
    assert.equal(future.ev, null)
    assert.equal(future.ac, null)
    assert.equal(future.eacForecast, 225000) // 180000 + 90000 × 5/10

    const finish = byDate.get('2026-07-20')!
    assert.equal(finish.pv, 300000)
    assert.equal(finish.eacForecast, 270000) // 终点收敛于 EAC
  })

  test('无基线优雅降级：任务成本估算为基线，BAC=估算总和', async ({ assert }) => {
    const { org, project } = await setupProject()
    await Task.create({
      projectId: project.id,
      name: '降级任务一',
      status: 'completed',
      progressPercent: 100,
      startDate: DateTime.fromISO('2026-07-01'),
      endDate: DateTime.fromISO('2026-07-10'),
      actualStartDate: DateTime.fromISO('2026-07-01'),
      actualEndDate: DateTime.fromISO('2026-07-10'),
      costEstimateCents: 40000,
      costActualCents: 40000,
    })
    await Task.create({
      projectId: project.id,
      name: '降级任务二',
      status: 'in_progress',
      progressPercent: 25,
      startDate: DateTime.fromISO('2026-07-01'),
      endDate: DateTime.fromISO('2026-07-20'),
      costEstimateCents: 40000,
      costActualCents: 5000,
    })

    const result = await evmSvc.getIndicators(org.id, project.id, '2026-07-20')

    assert.equal(result.hasBaseline, false)
    assert.equal(result.bac, 80000) // 预算缺省 → 估算总和
    assert.equal(result.ev, 50000) // 40000 + 40000×25%
    assert.equal(result.ac, 45000)
  })

  test('预算优先于估算：设置 budgetCents 后 BAC=预算', async ({ assert }) => {
    const { org, project } = await setupProject()
    project.budgetCents = 500000
    await project.save()
    await Task.create({
      projectId: project.id,
      name: '任务',
      status: 'in_progress',
      progressPercent: 10,
      costEstimateCents: 80000,
      costActualCents: 30000,
    })

    const result = await evmSvc.getIndicators(org.id, project.id, '2026-07-01')

    assert.equal(result.hasBaseline, false)
    assert.equal(result.bac, 500000)
    assert.equal(result.ev, 8000) // 10% × 估算 80000（无基线任务基准=当前估算）
  })

  test('旧快照防御：缺 baselineCostCents/totalBaselineCostCents 按 0 回退不崩溃', async ({
    assert,
  }) => {
    const { org, project } = await setupProject()
    project.budgetCents = 400000
    await project.save()
    const task = await Task.create({
      projectId: project.id,
      name: '旧快照任务',
      status: 'in_progress',
      progressPercent: 50,
      startDate: DateTime.fromISO('2026-07-01'),
      endDate: DateTime.fromISO('2026-07-10'),
      costEstimateCents: 100000,
      costActualCents: 20000,
    })
    // 旧结构快照：任务节点无 baselineCostCents、根无 totalBaselineCostCents
    await GanttBaseline.create({
      projectId: project.id,
      createdBy: 1,
      snapshot: {
        tasks: [{ id: task.id, startDate: '2026-07-01', endDate: '2026-07-10' }],
        milestones: [],
        savedAt: '2026-06-30T00:00:00.000Z',
      } as never,
    })

    const result = await evmSvc.getIndicators(org.id, project.id, '2026-07-10')

    assert.equal(result.hasBaseline, true)
    assert.equal(result.bac, 400000) // 基线总成本 0 → 回退项目预算
    assert.equal(result.ev, 0) // 旧快照任务成本缺省 ?? 0 → EV 为 0
    assert.equal(result.pv, 0)
    assert.equal(result.ac, 20000)
    // AC>0、EV=0 → CPI = 0/20000 = 0 → over_budget；PV=0 保底 SPI=1.0 → on_track
    assert.equal(result.cpi, 0)
    assert.equal(result.costStatus, 'over_budget')
    assert.equal(result.spi, 1)
    assert.equal(result.scheduleStatus, 'on_track')
  })

  test('空项目（无任务无基线无日期）：指标零值 + S 曲线空点阵', async ({ assert }) => {
    const { org, project } = await setupProject()

    const result = await evmSvc.getIndicators(org.id, project.id, '2026-07-10')
    assert.equal(result.bac, 0)
    assert.equal(result.pv, 0)
    assert.equal(result.ev, 0)
    assert.equal(result.ac, 0)
    assert.equal(result.cpi, 1)
    assert.equal(result.spi, 1)
    assert.equal(result.etc, 0)
    assert.equal(result.tcpi, 1)

    const curve = await evmSvc.getSCurve(org.id, project.id, '2026-07-10')
    assert.deepEqual(curve.points, [])
  })

  test('跨组织访问返回 404（ResourceNotFoundException）', async ({ assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('evm-owner-a') })
    const orgA = await createOrganization(ownerA)
    const { project } = await createProjectWithMember(orgA, ownerA, ownerA, 'Project Manager')
    await seedBaselineScenario(project.id)

    const userB = await createUser({ email: uniqueEmail('evm-user-b') })
    const orgB = await createOrganization(userB)

    let caught: unknown
    try {
      await evmSvc.getIndicators(orgB.id, project.id, '2026-07-10')
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ResourceNotFoundException)

    let curveCaught: unknown
    try {
      await evmSvc.getSCurve(orgB.id, project.id, '2026-07-10')
    } catch (error) {
      curveCaught = error
    }
    assert.instanceOf(curveCaught, ResourceNotFoundException)
  })

  test('周粒度采样：工期 > 30 天按 7 天步进且点阵 <= 150', async ({ assert }) => {
    const { org, project } = await setupProject()
    await Task.create({
      projectId: project.id,
      name: '长工期任务',
      status: 'in_progress',
      progressPercent: 30,
      startDate: DateTime.fromISO('2026-01-01'),
      endDate: DateTime.fromISO('2027-06-01'),
      costEstimateCents: 500000,
      costActualCents: 100000,
    })

    const curve = await evmSvc.getSCurve(org.id, project.id, '2026-03-01')

    assert.equal(curve.startDate, '2026-01-01')
    assert.isAtMost(curve.points.length, 150)
    assert.equal(curve.points[0].date, '2026-01-01')
    // 步进为 7 天：第 2 个点应为 01-08
    assert.equal(curve.points[1].date, '2026-01-08')
    const last = curve.points[curve.points.length - 1]
    assert.equal(last.date, curve.endDate)
  })
})
