import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import Project from '#models/project'
import { AnalysisJobService } from '#services/ai_analysis/analysis_job_service'
import { LucidAnalysisJobRepository } from '#services/ai_analysis/lucid_analysis_job_repository'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAuthDatabase,
} from '../auth/_helpers.js'

const SUBMIT = '/api/v1/ai/project-intents/analyze/jobs'
const rawInput = '我想筹办一场演唱会活动'

test.group('后台 AI 分析 API 与持久化', (group) => {
  useAuthDatabase(group)

  test('返回 202、查询到完成结果、重放同一任务且不创建正式项目', async ({ client, assert }) => {
    const user = await createUser()
    await createOrganization(user)
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: user.email, password: STRONG_PASSWORD })
    login.assertStatus(200)
    const token = login.body().data.accessToken
    const requestKey = randomUUID()
    const first = await client.post(SUBMIT).bearerToken(token).json({ requestKey, rawInput })
    first.assertStatus(202)
    const id = first.body().data.id
    let completed = false
    for (let attempt = 0; attempt < 20; attempt++) {
      const status = await client.get(`/api/v1/ai/analysis-jobs/${id}`).bearerToken(token)
      status.assertStatus(200)
      if (status.body().data.state === 'completed') {
        assert.equal(status.body().data.result.confirmedContext.rawInput, rawInput)
        completed = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.isTrue(completed)
    const replay = await client.post(SUBMIT).bearerToken(token).json({ requestKey, rawInput })
    replay.assertStatus(202)
    assert.equal(replay.body().data.id, id)
    const rows = await db.from('ai_analysis_jobs').count('* as count').first()
    assert.equal(Number(rows.count), 1)
    const row = await db.from('ai_analysis_jobs').where('id', id).first()
    assert.notInclude(row.result_encrypted, rawInput)
    const projectCounts = await Project.query().count('* as total')
    assert.equal(projectCounts[0].$extras.total, 0)
  })

  test('原组织的其他成员与另一组织用户都不能读取任务', async ({ client }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const peer = await createUser()
    await addOrgMember(org, peer, 'owner')
    const outsider = await createUser()
    await createOrganization(outsider)
    const repository = new LucidAnalysisJobRepository()
    const service = new AnalysisJobService(repository)
    const job = await service.submit({
      owner: { organizationId: org.id, userId: user.id },
      requestKey: randomUUID(),
      kind: 'intent',
      input: { rawInput },
      liveOutputId: null,
      run: async () => ({ safe: true }),
    })
    // 等待写入完成，避免每条测试的 DB teardown 与后台工作竞争。
    for (let i = 0; i < 20; i++) {
      const status = await service.show({ organizationId: org.id, userId: user.id }, job.id)
      if (status.state === 'completed') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    for (const actor of [peer, outsider]) {
      const login = await client
        .post('/api/v1/auth/login')
        .json({ email: actor.email, password: STRONG_PASSWORD })
      login.assertStatus(200)
      const response = await client
        .get(`/api/v1/ai/analysis-jobs/${job.id}`)
        .bearerToken(login.body().data.accessToken)
      response.assertStatus(404)
    }
  })

  test('无权限的观察者不能提交或查询，未登录也不能访问', async ({ client }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: viewer.email, password: STRONG_PASSWORD })
    login.assertStatus(200)
    const token = login.body().data.accessToken
    const post = await client
      .post(SUBMIT)
      .bearerToken(token)
      .json({ requestKey: randomUUID(), rawInput })
    post.assertStatus(403)
    const get = await client.get(`/api/v1/ai/analysis-jobs/${randomUUID()}`).bearerToken(token)
    get.assertStatus(403)
    const anonymous = await client.post(SUBMIT).json({ requestKey: randomUUID(), rawInput })
    anonymous.assertStatus(401)
  })

  test('项目理解也使用短提交与可恢复任务，重放不新建任务', async ({ client, assert }) => {
    const user = await createUser()
    await createOrganization(user)
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: user.email, password: STRONG_PASSWORD })
    login.assertStatus(200)
    const token = login.body().data.accessToken
    const body = {
      requestKey: randomUUID(),
      context: {
        schemaVersion: '1.0',
        rawInput,
        parsedIntent: {
          schemaVersion: '1.0',
          projectType: 'event',
          projectName: '演唱会',
          objectives: ['举办演唱会'],
          deliverables: [],
          timeline: { startDate: null, deadline: null, durationDays: null },
          constraints: [],
          entities: [],
          overallConfidence: 0.7,
        },
        resolvedFields: {},
        assumptions: {},
        unresolvedCriticalFields: [],
        unansweredOptionalFields: [],
      },
    }
    const path = '/api/v1/ai/project-drafts/understanding/jobs'
    const first = await client.post(path).bearerToken(token).json(body)
    first.assertStatus(202)
    const id = first.body().data.id
    assert.equal(first.body().data.kind, 'understanding')
    const replay = await client.post(path).bearerToken(token).json(body)
    replay.assertStatus(202)
    assert.equal(replay.body().data.id, id)
    let terminal = false
    for (let i = 0; i < 100; i++) {
      const status = await client.get(`/api/v1/ai/analysis-jobs/${id}`).bearerToken(token)
      status.assertStatus(200)
      if (['completed', 'failed'].includes(status.body().data.state)) {
        terminal = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.isTrue(terminal)
    const count = await db.from('ai_analysis_jobs').count('* as total').first()
    assert.equal(Number(count.total), 1)
    const projectCounts = await Project.query().count('* as total')
    assert.equal(Number(projectCounts[0].$extras.total), 0)
  })

  test('同一请求编号改变输入被拒绝，非法编号不创建任务', async ({ client }) => {
    const user = await createUser()
    await createOrganization(user)
    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: user.email, password: STRONG_PASSWORD })
    login.assertStatus(200)
    const token = login.body().data.accessToken
    const requestKey = randomUUID()
    const first = await client.post(SUBMIT).bearerToken(token).json({ requestKey, rawInput })
    first.assertStatus(202)
    for (let i = 0; i < 20; i++) {
      const result = await client
        .get(`/api/v1/ai/analysis-jobs/${first.body().data.id}`)
        .bearerToken(token)
      if (result.body().data.state === 'completed') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const changed = await client
      .post(SUBMIT)
      .bearerToken(token)
      .json({ requestKey, rawInput: '筹办另一个大型演唱会活动' })
    changed.assertStatus(422)
    const invalid = await client
      .post(SUBMIT)
      .bearerToken(token)
      .json({ requestKey: 'bad', rawInput })
    invalid.assertStatus(422)
  })
})
