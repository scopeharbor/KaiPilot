/**
 * v3-llm-wiki-default-on —— 维基所有版本默认开启（未设置视为开启、显式关闭仍关闭、命令处理未设置的组织），
 * 全部 fixture。维基导出的 DLP 放宽测试属企业版，另见同目录的企业版专属测试文件。
 */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import WikiSettingsService, {
  isWikiEnabledInSettings,
} from '#services/wiki_memory/wiki_settings_service'
import {
  addOrgMember,
  createOrganization,
  createUser,
  orgBearer,
  useAuthDatabase,
} from '../auth/_helpers.js'
import { API, resolveSpace } from './_wiki_helpers.js'

test.group('记忆维基 · 默认开启', (group) => {
  useAuthDatabase(group)

  test('判定：未设置、空设置视为开启；只有显式 false 关闭', ({ assert }) => {
    assert.isTrue(isWikiEnabledInSettings(null))
    assert.isTrue(isWikiEnabledInSettings(undefined))
    assert.isTrue(isWikiEnabledInSettings({}))
    assert.isTrue(isWikiEnabledInSettings({ wikiMemoryEnabled: true }))
    assert.isFalse(isWikiEnabledInSettings({ wikiMemoryEnabled: false }))
  })

  test('从未设置开关的组织可直接使用维基；管理员关闭后禁用、再开启恢复', async ({
    client,
    assert,
  }) => {
    const admin = await createUser()
    const org = await createOrganization(admin)
    const member = await createUser()
    await addOrgMember(org, member, 'member')
    assert.isUndefined(org.settings?.wikiMemoryEnabled)
    const adminAuth = await orgBearer(admin, org.id)
    const memberAuth = await orgBearer(member, org.id)

    const settings = await client.get(`${API}/settings`).header('authorization', memberAuth)
    settings.assertStatus(200)
    assert.isTrue(settings.body().data.enabled)
    const space = await resolveSpace(client, adminAuth, 'organization')
    space.assertStatus(200)
    const service = await app.container.make(WikiSettingsService)
    assert.isTrue(await service.isEnabled(org.id))
    assert.isFalse(await service.isEnabled(999_999))

    const off = await client
      .put(`${API}/settings`)
      .header('authorization', adminAuth)
      .json({ enabled: false })
    off.assertStatus(200)
    const disabled = await client.get(`${API}/spaces`).header('authorization', memberAuth)
    disabled.assertStatus(503)
    const on = await client
      .put(`${API}/settings`)
      .header('authorization', adminAuth)
      .json({ enabled: true })
    on.assertStatus(200)
    const spaces = await client.get(`${API}/spaces`).header('authorization', memberAuth)
    spaces.assertStatus(200)
  })

  test('wiki:dossier 处理未设置开关的组织，跳过显式关闭的组织', async ({ assert }) => {
    const admin = await createUser()
    const unset = await createOrganization(admin)
    const off = await createOrganization(await createUser())
    off.settings = { wikiMemoryEnabled: false }
    await off.save()
    const { default: WikiDossier } = await import('../../../commands/wiki_dossier.js')
    const ace = await app.container.make('ace')
    ace.ui.switchMode('raw')
    const run = await ace.create(WikiDossier, [`--org=${unset.id}`])
    await run.exec()
    run.assertSucceeded()
    run.assertLogMatches(new RegExp(`组织 ${unset.id}：新建`))
    const skipped = await ace.create(WikiDossier, [`--org=${off.id}`])
    await skipped.exec()
    skipped.assertSucceeded()
    assert.notMatch(JSON.stringify(skipped.ui.logger.getLogs()), new RegExp(`组织 ${off.id}：新建`))
  })
})
