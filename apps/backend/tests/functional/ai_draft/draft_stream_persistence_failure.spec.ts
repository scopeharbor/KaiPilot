import { test } from '@japa/runner'
import { draftGenerationRunner } from '#services/ai_draft/draft_generation_runner'
import ProjectDraftSessionService from '#services/ai_draft/session_service'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  useAuthDatabase,
} from '../auth/_helpers.js'

/**
 * 回归：流式生成期间写库失败（真实场景为 Supabase pooler 断开连接）曾让事件链
 * 留下无人接的 rejection，Node 直接杀掉整个后端进程。修复后只允许本次生成失败。
 */

const STREAM = '/api/v1/ai/project-drafts/stream'

function makeReadyContext() {
  return {
    schemaVersion: '1.0',
    rawInput: '开发一个面向运营人员的内部审批系统。',
    parsedIntent: {
      schemaVersion: '1.0',
      projectType: 'software',
      projectName: '内部审批系统',
      objectives: ['减少重复录入'],
      deliverables: [],
      timeline: { startDate: null, deadline: null, durationDays: null },
      constraints: [],
      entities: [],
      overallConfidence: 0.72,
    },
    resolvedFields: {},
    assumptions: {},
    unresolvedCriticalFields: [],
    unansweredOptionalFields: [],
  }
}

function sseEventTypes(text: string): string[] {
  return text
    .split('\n\n')
    .map((block) => block.split('\n').find((line) => line.startsWith('event: ')))
    .filter((line): line is string => Boolean(line))
    .map((line) => line.slice(7).trim())
}

test.group('AI Draft 流式生成 — 写库失败不拖垮进程', (group) => {
  let ownerEmail: string

  useAuthDatabase(group)

  group.each.setup(async () => {
    draftGenerationRunner.reset()
    const owner = await createUser()
    await createOrganization(owner)
    ownerEmail = owner.email
  })

  async function login(client: any): Promise<string> {
    const res = await client.post('/api/v1/auth/login').json({
      email: ownerEmail,
      password: STRONG_PASSWORD,
    })
    res.assertStatus(200)
    return res.body().data.accessToken
  }

  test('事件写库持续失败 → 本次生成以 draft.failed 结束，服务仍可用', async ({
    client,
    assert,
  }) => {
    const token = await login(client)
    const original = ProjectDraftSessionService.prototype.appendEvent
    let attempts = 0
    ProjectDraftSessionService.prototype.appendEvent = async function (session, event) {
      // draft.started 在 SSE 打开前同步写入，放行；后台生成期间的事件一律失败。
      if (event.type === 'draft.started') return original.call(this, session, event)
      attempts++
      throw new Error('Connection terminated unexpectedly')
    }

    try {
      const res = await client
        .post(STREAM)
        .header('Authorization', `Bearer ${token}`)
        .json({ context: makeReadyContext() })
      res.assertStatus(200)

      const types = sseEventTypes(res.text())
      assert.include(types, 'draft.failed')
      assert.notInclude(types, 'draft.completed')
      // 首个失败事件重试一次后停摆，不再逐条重试后续事件。
      assert.isAtLeast(attempts, 2)
    } finally {
      ProjectDraftSessionService.prototype.appendEvent = original
    }

    // 进程仍存活并能继续服务。
    const again = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })
    again.assertStatus(200)
    assert.include(sseEventTypes(again.text()), 'draft.completed')
  })

  test('事件写库偶发失败一次 → 重试后生成照常完成', async ({ client, assert }) => {
    const token = await login(client)
    const original = ProjectDraftSessionService.prototype.appendEvent
    let failedOnce = false
    ProjectDraftSessionService.prototype.appendEvent = async function (session, event) {
      if (event.type !== 'draft.started' && !failedOnce) {
        failedOnce = true
        throw new Error('Connection terminated unexpectedly')
      }
      return original.call(this, session, event)
    }

    try {
      const res = await client
        .post(STREAM)
        .header('Authorization', `Bearer ${token}`)
        .json({ context: makeReadyContext() })
      res.assertStatus(200)
      assert.isTrue(failedOnce)
      assert.include(sseEventTypes(res.text()), 'draft.completed')
    } finally {
      ProjectDraftSessionService.prototype.appendEvent = original
    }
  })

  test('checkpoint 写库失败 → 只记警告，生成照常完成', async ({ client, assert }) => {
    const token = await login(client)
    const original = ProjectDraftSessionService.prototype.saveCheckpoint
    let checkpointAttempts = 0
    ProjectDraftSessionService.prototype.saveCheckpoint = async function () {
      checkpointAttempts++
      throw new Error('Connection terminated unexpectedly')
    }

    try {
      const res = await client
        .post(STREAM)
        .header('Authorization', `Bearer ${token}`)
        .json({ context: makeReadyContext() })
      res.assertStatus(200)
      assert.isAbove(checkpointAttempts, 0)
      assert.include(sseEventTypes(res.text()), 'draft.completed')
    } finally {
      ProjectDraftSessionService.prototype.saveCheckpoint = original
    }
  })
})
