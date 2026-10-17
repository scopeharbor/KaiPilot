/**
 * v3-chart-gallery-data-foundation —— W4.6 SpcMetricService 功能测试。
 *
 * 确定性场景（手工核算）：
 * - cycle_time 10 常规样本 [2,3,4,5,6]×2 + 极端样本 25 天：
 *   mean=5、σ=√23≈4.8、UCL≈19.39 → 25 天任务被标定为 rule1_beyond_3sigma；
 * - lead_time 以 created_at(时刻) 到 actual_end_date(日) 的实数天差；
 * - N<5 → SAMPLE_SIZE_TOO_SMALL；Nelson 9 点同侧 / 6 点单调趋势；跨组织 404。
 */
import Task from '#models/task'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import SpcMetricService, {
  SPC_RULE1_BEYOND_3SIGMA,
  SPC_RULE2_NINE_SAME_SIDE,
  SPC_RULE3_SIX_MONOTONIC_TREND,
  SPC_WARNING_SAMPLE_SIZE_TOO_SMALL,
} from '#services/spc_metric_service'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('SpcMetricService', (group) => {
  useAuthDatabase(group)

  let spcSvc: SpcMetricService
  group.each.setup(() => {
    spcSvc = new SpcMetricService()
  })

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('spc-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(org, owner, owner, 'Project Manager')
    return { owner, org, project }
  }

  /** 完工任务：actual 工期 durationDays 天，actualStart 统一 2026-07-01。 */
  async function completedTask(
    projectId: number,
    name: string,
    durationDays: number,
    startOffsetDays = 0,
    createdAt?: string,
  ) {
    const start = DateTime.fromISO('2026-07-01').plus({ days: startOffsetDays })
    return Task.create({
      projectId,
      name,
      status: 'completed',
      progressPercent: 100,
      actualStartDate: start,
      actualEndDate: start.plus({ days: durationDays }),
      ...(createdAt ? { createdAt: DateTime.fromISO(createdAt) } : {}),
    })
  }

  test('cycle_time：均值/σ/UCL/LCL/UWL/LWL 精确核算', async ({ assert }) => {
    const { org, project } = await setupProject()
    // [2,3,4,5,6] × 2 = 10 个常规样本（完工日以 10 天为间隔错开，保证时序=输入序）
    const normalDurations = [2, 3, 4, 5, 6, 2, 3, 4, 5, 6]
    for (const [i, normalDuration] of normalDurations.entries()) {
      await completedTask(project.id, `常规任务-${i}`, normalDuration, i * 10)
    }

    const result = await spcSvc.getControlChart(org.id, project.id, 'cycle_time')

    assert.equal(result.warning, null)
    assert.equal(result.summary.metric, 'cycle_time')
    assert.equal(result.summary.sampleCount, 10)
    assert.equal(result.summary.mean, 4) // (2+3+4+5+6)*2 / 10 = 4
    // dev² = (4+1+0+1+4) × 2 = 20 → σ = sqrt(20/9) ≈ 1.4907
    const sigma = Math.sqrt(20 / 9)
    assert.equal(result.summary.sigma, Number(sigma.toFixed(2)))
    assert.equal(result.summary.ucl, Number((4 + 3 * sigma).toFixed(2)))
    assert.equal(result.summary.lcl, 0) // 4 - 3σ < 0 → 钳制 0
    assert.equal(result.summary.uwl, Number((4 + 2 * sigma).toFixed(2)))
    assert.equal(result.summary.lwl, Number(Math.max(0, 4 - 2 * sigma).toFixed(2)))

    assert.equal(result.samples.length, 10)
    // 完工时间升序 = 输入顺序
    assert.deepEqual(
      result.samples.map((s) => s.value),
      normalDurations,
    )
    for (const sample of result.samples) {
      assert.equal(sample.isOutlier, false)
      assert.deepEqual(sample.violatedRules, [])
    }
  })

  test('极端延期任务（25 天）被标定为 rule1_beyond_3sigma 失控点', async ({ assert }) => {
    const { org, project } = await setupProject()
    // 20 个常规样本围绕均值 5 交替（4/6 各 10 个，切断 Nelson 2/3 干扰）+ 25 天极端
    for (let i = 0; i < 20; i++) {
      await completedTask(project.id, `常规任务-${i}`, i % 2 === 0 ? 4 : 6, i * 10)
    }
    await completedTask(project.id, '极端延期任务', 25, 200)

    const result = await spcSvc.getControlChart(org.id, project.id, 'cycle_time')

    assert.equal(result.summary.sampleCount, 21)
    // mean = (20×5 + 25) / 21 = 125/21；σ 由公式精确推导（断言与实现同公式复核）
    const mean = (20 * 5 + 25) / 21
    const devSquares = 10 * ((mean - 4) ** 2 + (6 - mean) ** 2) + (25 - mean) ** 2
    const sigma = Math.sqrt(devSquares / 20)
    assert.equal(result.summary.mean, Number(mean.toFixed(2)))
    assert.equal(result.summary.sigma, Number(sigma.toFixed(2)))
    assert.equal(result.summary.ucl, Number((mean + 3 * sigma).toFixed(2))) // ≈ 19.38 < 25
    assert.equal(result.summary.lcl, 0)
    // 常规样本不触发任何规则（交替切断了同侧连击与单调连击）
    for (const sample of result.samples) {
      if (sample.taskName === '极端延期任务') continue
      assert.equal(sample.isOutlier, false)
      assert.deepEqual(sample.violatedRules, [])
    }
    const outlier = result.samples.find((s) => s.taskName === '极端延期任务')
    assert.isDefined(outlier)
    assert.equal(outlier!.value, 25)
    assert.equal(outlier!.isOutlier, true)
    assert.isTrue(outlier!.violatedRules.includes(SPC_RULE1_BEYOND_3SIGMA))
  })

  test('lead_time：created_at 时刻到完工日的实数天差（含小数）', async ({ assert }) => {
    const { org, project } = await setupProject()
    // 各任务同于 07-01 06:00 创建，完工分别为 +1..+5 天 → lead = n - 0.25
    for (let n = 1; n <= 5; n++) {
      await completedTask(project.id, `提前期任务-${n}`, n, 0, '2026-07-01T06:00:00')
    }

    const result = await spcSvc.getControlChart(org.id, project.id, 'lead_time')

    assert.equal(result.summary.metric, 'lead_time')
    assert.equal(result.summary.sampleCount, 5)
    assert.deepEqual(
      result.samples.map((s) => s.value),
      [0.75, 1.75, 2.75, 3.75, 4.75],
    )
    // mean = 2.75；dev = ±2,±1,0 → Σdev² = 10 → σ = sqrt(10/4)
    const sigma = Math.sqrt(10 / 4)
    assert.equal(result.summary.mean, 2.75)
    assert.equal(result.summary.sigma, Number(sigma.toFixed(2)))
  })

  test('样本不足 5 条：warning=SAMPLE_SIZE_TOO_SMALL 且控制限为 null', async ({ assert }) => {
    const { org, project } = await setupProject()
    for (let n = 1; n <= 4; n++) {
      await completedTask(project.id, `样本-${n}`, n, n)
    }

    const result = await spcSvc.getControlChart(org.id, project.id, 'cycle_time')

    assert.equal(result.warning, SPC_WARNING_SAMPLE_SIZE_TOO_SMALL)
    assert.equal(result.summary.sampleCount, 4)
    assert.equal(result.summary.mean, null)
    assert.equal(result.summary.sigma, null)
    assert.equal(result.summary.ucl, null)
    assert.equal(result.summary.lcl, null)
    assert.equal(result.summary.uwl, null)
    assert.equal(result.summary.lwl, null)
    assert.equal(result.samples.length, 4)
    for (const sample of result.samples) {
      assert.equal(sample.isOutlier, false)
      assert.deepEqual(sample.violatedRules, [])
    }
  })

  test('无任何完工任务：同样返回样本不足提示而非报错', async ({ assert }) => {
    const { org, project } = await setupProject()
    const result = await spcSvc.getControlChart(org.id, project.id, 'cycle_time')
    assert.equal(result.warning, SPC_WARNING_SAMPLE_SIZE_TOO_SMALL)
    assert.equal(result.summary.sampleCount, 0)
    assert.deepEqual(result.samples, [])
  })

  test('Nelson rule2：连续 9 点落在中心线同侧 → rule2_nine_same_side', async ({ assert }) => {
    const { org, project } = await setupProject()
    // 9 个 3 天（全部低于均值 3.7）+ 1 个 10 天
    const durations = [3, 3, 3, 3, 3, 3, 3, 3, 3, 10]
    for (const [i, duration] of durations.entries()) {
      await completedTask(project.id, `rule2-任务-${i}`, duration, i)
    }

    const result = await spcSvc.getControlChart(org.id, project.id, 'cycle_time')

    // 第 9 个 3 天样本（index 8）触发 9 连击
    assert.isTrue(result.samples[8].violatedRules.includes(SPC_RULE2_NINE_SAME_SIDE))
    // 第 1..8 个点连击不足 9
    for (let i = 0; i < 8; i++) {
      assert.isFalse(result.samples[i].violatedRules.includes(SPC_RULE2_NINE_SAME_SIDE))
    }
    // 10 天样本为另一侧，不触发 rule2
    assert.isFalse(result.samples[9].violatedRules.includes(SPC_RULE2_NINE_SAME_SIDE))
  })

  test('Nelson rule3：连续 6 点严格单调递增 → rule3_six_monotonic_trend', async ({ assert }) => {
    const { org, project } = await setupProject()
    // 1,2,3,4,5,6 连续单调升后回落，再 3,4,5 仅 3 连（完工日错开保证时序=输入序）
    const durations = [1, 2, 3, 4, 5, 6, 3, 4, 5]
    for (const [i, duration] of durations.entries()) {
      await completedTask(project.id, `rule3-任务-${i}`, duration, i * 10)
    }

    const result = await spcSvc.getControlChart(org.id, project.id, 'cycle_time')

    // index 5（value 6）完成第 6 个连续递增点
    assert.isTrue(result.samples[5].violatedRules.includes(SPC_RULE3_SIX_MONOTONIC_TREND))
    for (let i = 0; i < 5; i++) {
      assert.isFalse(result.samples[i].violatedRules.includes(SPC_RULE3_SIX_MONOTONIC_TREND))
    }
    // 3,4,5 仅 3 连不触发
    assert.isFalse(result.samples[8].violatedRules.includes(SPC_RULE3_SIX_MONOTONIC_TREND))
  })

  test('limit 采样上限：仅保留最近 N 条完工任务', async ({ assert }) => {
    const { org, project } = await setupProject()
    for (let n = 1; n <= 10; n++) {
      await completedTask(project.id, `限流任务-${n}`, n, n)
    }

    const result = await spcSvc.getControlChart(org.id, project.id, 'cycle_time', 5)

    assert.equal(result.summary.sampleCount, 5)
    // 最近的 5 个完工任务 = 工期 6..10 天，按完工升序
    assert.deepEqual(
      result.samples.map((s) => s.value),
      [6, 7, 8, 9, 10],
    )
  })

  test('跨组织访问返回 404（ResourceNotFoundException）', async ({ assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('spc-owner-a') })
    const orgA = await createOrganization(ownerA)
    const { project } = await createProjectWithMember(orgA, ownerA, ownerA, 'Project Manager')
    await completedTask(project.id, 'A 项目任务', 3)

    const userB = await createUser({ email: uniqueEmail('spc-user-b') })
    const orgB = await createOrganization(userB)

    let caught: unknown
    try {
      await spcSvc.getControlChart(orgB.id, project.id, 'cycle_time')
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ResourceNotFoundException)
  })
})
