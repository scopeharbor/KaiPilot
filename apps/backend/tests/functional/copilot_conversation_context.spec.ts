import db from '@adonisjs/lucid/services/db'
import AiConnection from '#models/ai_connection'
import { cleanupAiRecords } from '#services/ai_records/cleanup_service'
import { test } from '@japa/runner'
import { CopilotSessionService } from '#services/copilot_session/copilot_session_service'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  useAuthDatabase,
} from './auth/_helpers.js'

test.group('Copilot conversation context', (group) => {
  useAuthDatabase(group)

  test('recent summaries preserve order, omit current turn and reject other actors/scopes', async ({
    assert,
  }) => {
    const actor = await createUser()
    const organization = await createOrganization(actor)
    const service = new CopilotSessionService()
    const session = await service.createSession({
      organizationId: organization.id,
      actorId: actor.id,
      scope: 'global',
      attribution: {},
    })
    for (let i = 0; i < 10; i++) {
      await service.appendMessage({
        organizationId: organization.id,
        actorId: actor.id,
        sessionId: session.sessionId,
        role: i % 2 ? 'assistant' : 'user',
        contentSummary: `对话内容 ${i}`,
        idempotencyKey: `history-${i}`,
      })
    }
    const input = {
      organizationId: organization.id,
      actorId: actor.id,
      sessionId: session.sessionId,
      scope: 'global' as const,
      attribution: {},
      currentIdempotencyKey: 'history-9',
    }
    const history = await service.conversationContext(input)
    assert.lengthOf(history, 8)
    assert.equal(history[0].content, '对话内容 1')
    assert.equal(history[7].content, '对话内容 8')
    assert.deepEqual(await service.conversationContext({ ...input, actorId: actor.id + 1 }), [])
    assert.deepEqual(
      await service.conversationContext({ ...input, organizationId: organization.id + 1 }),
      [],
    )
    assert.deepEqual(
      await service.conversationContext({
        ...input,
        scope: 'project',
        attribution: { projectId: '99' },
      }),
      [],
    )
  })

  test('同组织与跨组织账号均不能读取、修改、导出、续接他人会话', async ({ assert }) => {
    const actor = await createUser()
    const otherActor = await createUser()
    const organization = await createOrganization(actor)
    await addOrgMember(organization, otherActor, 'member')
    const otherOrganization = await createOrganization(otherActor)
    const service = new CopilotSessionService()
    const session = await service.createSession({
      organizationId: organization.id,
      actorId: actor.id,
      scope: 'global',
      attribution: {},
      idempotencyKey: 'shared-key',
    })
    await service.appendMessage({
      organizationId: organization.id,
      actorId: actor.id,
      sessionId: session.sessionId,
      role: 'user',
      contentSummary: '本人私有内容',
    })
    const own = await service.listSessions({ organizationId: organization.id, actorId: actor.id })
    assert.equal(own.meta.total, 1)
    for (const orgId of [organization.id, otherOrganization.id]) {
      const list = await service.listSessions({ organizationId: orgId, actorId: otherActor.id })
      assert.equal(list.meta.total, 0)
      assert.isNull(await service.listMessages(orgId, otherActor.id, session.sessionId))
      assert.isNull(await service.renameSession(orgId, otherActor.id, session.sessionId, '篡改'))
      assert.isNull(await service.archiveSession(orgId, otherActor.id, session.sessionId))
      assert.isNull(await service.exportSession(orgId, otherActor.id, session.sessionId))
      const resume = await service.resumeSession({
        organizationId: orgId,
        actorId: otherActor.id,
        sessionId: session.sessionId,
        lastSequence: 0,
      })
      assert.isFalse(resume.resumable)
      const deletion = await service.deleteSession(orgId, otherActor.id, session.sessionId)
      assert.isFalse(deletion.deleted)
      await assert.rejects(() =>
        service.appendMessage({
          organizationId: orgId,
          actorId: otherActor.id,
          sessionId: session.sessionId,
          role: 'assistant',
          contentSummary: '篡改',
        }),
      )
    }
    const otherSession = await service.createSession({
      organizationId: organization.id,
      actorId: otherActor.id,
      scope: 'global',
      attribution: {},
      idempotencyKey: 'shared-key',
    })
    assert.notEqual(otherSession.sessionId, session.sessionId)
    const ownMessages = await service.listMessages(organization.id, actor.id, session.sessionId)
    assert.equal(ownMessages?.meta.total, 1)
  })

  test('全量真实迁移下清理 AI 记录，正式项目和连接设置保留', async ({ assert }) => {
    const actor = await createUser()
    const organization = await createOrganization(actor)
    const { project } = await createProjectWithMember(organization, actor, actor, 'owner')
    const connection = await AiConnection.create({
      organizationId: organization.id,
      displayName: '保留设置',
      protocol: 'openai_compatible',
      apiKeyEncrypted: 'test-encrypted-fixture',
      model: 'fixture',
      isActive: true,
    })
    const service = new CopilotSessionService()
    const session = await service.createSession({
      organizationId: organization.id,
      actorId: actor.id,
      scope: 'global',
      attribution: {},
    })
    await service.appendMessage({
      organizationId: organization.id,
      actorId: actor.id,
      sessionId: session.sessionId,
      role: 'user',
      contentSummary: '待删除私有历史',
    })
    const result = await cleanupAiRecords(db.connection().getWriteClient(), true)
    assert.isTrue(result.applied)
    assert.isAtLeast(result.total, 2)
    const remaining = await service.listSessions({
      organizationId: organization.id,
      actorId: actor.id,
    })
    assert.equal(remaining.meta.total, 0)
    assert.isNotNull(await db.from('projects').where('id', project.id).first())
    assert.isNotNull(await AiConnection.find(connection.id))
  })

  test('sensitive summaries and archived sessions do not enter history', async ({ assert }) => {
    const actor = await createUser()
    const organization = await createOrganization(actor)
    const service = new CopilotSessionService()
    const session = await service.createSession({
      organizationId: organization.id,
      actorId: actor.id,
      scope: 'global',
      attribution: {},
    })
    await service.appendMessage({
      organizationId: organization.id,
      actorId: actor.id,
      sessionId: session.sessionId,
      role: 'user',
      contentSummary: 'authorization: Bearer secret-test-value',
    })
    const input = {
      organizationId: organization.id,
      actorId: actor.id,
      sessionId: session.sessionId,
      scope: 'global' as const,
      attribution: {},
      currentIdempotencyKey: 'current',
    }
    assert.deepEqual(await service.conversationContext(input), [])
    await service.archiveSession(organization.id, actor.id, session.sessionId)
    assert.deepEqual(await service.conversationContext(input), [])
  })
})
