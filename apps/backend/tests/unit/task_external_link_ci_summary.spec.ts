import { test } from '@japa/runner'
import TaskExternalLink from '#models/task_external_link'
import { createUser, createOrganization, useAuthDatabase } from '../functional/auth/_helpers.js'
import { DateTime } from 'luxon'
import type { CodeRepositoryCiSummary, ExternalLinkStatus } from '@aiproj/types'
import type { Group } from '@japa/runner/core'

/**
 * v2-5-code-repository-ci-status-display 任务 2.4 —— CI 摘要持久化（存于 metadata.ciSummary）。
 *
 * 证明：① 旧外链（metadata 为 null 或无 ciSummary）读出空 ciSummary 且不报错；
 * ② 新摘要可保存并原样读回；③ 写 CI 摘要不破坏 metadata 其他字段与既有外链 API 字段。
 */
test.group('TaskExternalLink CI summary 持久化', (group: Group) => {
  let orgId: number
  let userId: number
  useAuthDatabase(group)

  group.each.setup(async () => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    orgId = Number(org.id)
    userId = Number(owner.id)
  })

  async function createLink(overrides: Partial<TaskExternalLink> = {}) {
    return TaskExternalLink.create({
      organizationId: orgId,
      projectId: 1,
      taskId: 1,
      provider: 'github',
      linkType: 'pull_request',
      repositoryOwner: 'owner',
      repositoryName: 'repo',
      externalNumber: 7,
      externalId: null,
      externalTitle: 'PR #7',
      externalStatus: 'open' as ExternalLinkStatus,
      statusSource: 'manual',
      externalUrl: 'https://github.com/owner/repo/pull/7',
      note: null,
      metadata: null,
      lastObservedAt: DateTime.utc(),
      createdBy: userId,
      updatedBy: userId,
      ...overrides,
    })
  }

  const sampleSummary = (): CodeRepositoryCiSummary => ({
    state: 'passed',
    conclusion: 'success',
    label: 'CI',
    source: 'github_checks',
    targetUrl: 'https://github.com/owner/repo/pull/7/checks',
    observedAt: '2026-07-23T10:00:00.000Z',
    updatedAt: '2026-07-23T10:00:00.000Z',
    reasonCode: 'ok',
    isStale: false,
  })

  test('旧外链 metadata=null → getCiSummary 返回 null（不报错）', async ({ assert }) => {
    const link = await createLink({ metadata: null })
    const reloaded = await TaskExternalLink.findOrFail(link.id)
    assert.isNull(reloaded.getCiSummary())
  })

  test('旧外链 metadata 存在但无 ciSummary → 返回 null', async ({ assert }) => {
    const link = await createLink({ metadata: { legacyNote: 'x' } })
    const reloaded = await TaskExternalLink.findOrFail(link.id)
    assert.isNull(reloaded.getCiSummary())
    // 既有 metadata 字段保留
    assert.equal((reloaded.metadata as Record<string, unknown>)?.legacyNote, 'x')
  })

  test('新摘要可保存并原样读回（round-trip）', async ({ assert }) => {
    const link = await createLink()
    link.setCiSummary(sampleSummary())
    await link.save()

    const reloaded = await TaskExternalLink.findOrFail(link.id)
    assert.deepEqual(reloaded.getCiSummary(), sampleSummary())
  })

  test('写 CI 摘要保留 metadata 其他字段', async ({ assert }) => {
    const link = await createLink({ metadata: { keep: 'me' } })
    link.setCiSummary(sampleSummary())
    await link.save()

    const reloaded = await TaskExternalLink.findOrFail(link.id)
    assert.equal((reloaded.metadata as Record<string, unknown>)?.keep, 'me')
    assert.equal(reloaded.getCiSummary()?.state, 'passed')
  })

  test('setCiSummary(null) 清除 ciSummary 但保留其他 metadata', async ({ assert }) => {
    const link = await createLink({ metadata: { keep: 'me' } })
    link.setCiSummary(sampleSummary())
    await link.save()

    link.setCiSummary(null)
    await link.save()

    const reloaded = await TaskExternalLink.findOrFail(link.id)
    assert.isNull(reloaded.getCiSummary())
    assert.equal((reloaded.metadata as Record<string, unknown>)?.keep, 'me')
  })

  test('脏 metadata.ciSummary 不破坏读取（降级为安全值）', async ({ assert }) => {
    const link = await createLink({
      metadata: { ciSummary: { state: 'kaboom', rawPayload: { token: 'secret' } } },
    })
    const reloaded = await TaskExternalLink.findOrFail(link.id)
    const summary = reloaded.getCiSummary()
    assert.equal(summary?.state, 'unknown')
    // 未知字段（含潜在敏感字段）不会进入解析结果
    assert.isUndefined((summary as Record<string, unknown> | null)?.rawPayload)
  })

  test('保存 CI 摘要不改动既有外链 API 字段', async ({ assert }) => {
    const link = await createLink()
    const beforeStatus = link.externalStatus
    const beforeUrl = link.externalUrl
    link.setCiSummary(sampleSummary())
    await link.save()

    const reloaded = await TaskExternalLink.findOrFail(link.id)
    assert.equal(reloaded.externalStatus, beforeStatus)
    assert.equal(reloaded.externalUrl, beforeUrl)
    assert.equal(reloaded.externalTitle, 'PR #7')
  })
})
