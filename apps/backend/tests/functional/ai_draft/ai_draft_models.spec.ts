import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import AiProjectDraft from '#models/ai_project_draft'
import AiProjectDraftVersion from '#models/ai_project_draft_version'
import AiProjectDraftEvent from '#models/ai_project_draft_event'
import AiProjectDraftConfirmation from '#models/ai_project_draft_confirmation'
import TenantScope from '#services/tenant_scope'
import { fixtureDraft } from '#services/ai_draft/fixtures'
import { createOrganization, createUser, useAuthDatabase } from '../auth/_helpers.js'

async function createDraftSession(organizationId: number, userId: number, uid: string) {
  return AiProjectDraft.create({
    draftUid: uid,
    organizationId,
    userId,
    projectType: 'software',
    status: 'reviewing',
    schemaVersion: '1.0',
    currentVersion: 1,
    structuredStrategy: 'prompt',
    consistency: 'strict',
    fallbackUsed: false,
    usingRealAdapter: false,
  })
}

test.group('AI 草案表：隔离/级联/敏感字段不落库', (group) => {
  useAuthDatabase(group)

  test('组织隔离：TenantScope 只返回本组织草案', async ({ assert }) => {
    const ownerA = await createUser()
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser()
    const orgB = await createOrganization(ownerB)

    await createDraftSession(orgA.id, ownerA.id, 'uid-a')
    await createDraftSession(orgB.id, ownerB.id, 'uid-b')

    const scoped = await TenantScope.forOrganization(AiProjectDraft.query(), orgA.id)
    assert.lengthOf(scoped, 1)
    assert.equal(scoped[0].draftUid, 'uid-a')
  })

  test('级联删除：删除会话连带清除版本/事件/确认', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const session = await createDraftSession(org.id, owner.id, 'uid-cascade')

    await AiProjectDraftVersion.create({
      draftId: session.id,
      version: 1,
      origin: 'generated',
      status: 'active',
      draft: fixtureDraft('software'),
      meta: null,
      validation: null,
    })
    await AiProjectDraftEvent.create({
      draftId: session.id,
      sequence: 1,
      version: 1,
      type: 'draft.completed',
      payload: {
        type: 'draft.completed',
        draftId: 'uid-cascade',
        version: 1,
        sequence: 1,
      } as never,
    })
    await AiProjectDraftConfirmation.create({
      draftId: session.id,
      version: 1,
      mode: 'all',
      selectionSummary: { tasks: 4 },
      validationSummary: { blocking: 0 },
      projectId: null,
      confirmedBy: owner.id,
    })

    await session.delete()

    assert.equal(
      await AiProjectDraftVersion.query()
        .where('draft_id', session.id)
        .then((r) => r.length),
      0,
    )
    assert.equal(
      await AiProjectDraftEvent.query()
        .where('draft_id', session.id)
        .then((r) => r.length),
      0,
    )
    assert.equal(
      await AiProjectDraftConfirmation.query()
        .where('draft_id', session.id)
        .then((r) => r.length),
      0,
    )
  })

  test('敏感字段不落库：会话表不含 rawInput/answers 列', async ({ assert }) => {
    const res = await db.rawQuery("PRAGMA table_info('ai_project_drafts')")
    const columns = (((res as any).rows ?? res) as any[]).map((r) => String(r.name).toLowerCase())
    for (const forbidden of ['raw_input', 'rawinput', 'answers', 'clarification_answers']) {
      assert.notInclude(columns, forbidden, `会话表不应存在敏感列 ${forbidden}`)
    }
  })

  test('确认记录只存摘要，不含草案全文/输入原文', async ({ assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const session = await createDraftSession(org.id, owner.id, 'uid-summary')
    const confirmation = await AiProjectDraftConfirmation.create({
      draftId: session.id,
      version: 1,
      mode: 'partial',
      selectionSummary: { tasks: 2, wbsNodes: 3 },
      validationSummary: { blocking: 0, warning: 1 },
      projectId: null,
      confirmedBy: owner.id,
    })
    const serialized = JSON.stringify(confirmation.serialize())
    assert.notInclude(serialized, 'charter')
    assert.notInclude(serialized, 'rawInput')
  })
})
