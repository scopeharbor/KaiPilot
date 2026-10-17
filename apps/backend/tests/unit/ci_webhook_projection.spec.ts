import { test } from '@japa/runner'
import type { Group } from '@japa/runner/core'
import {
  projectWebhookCiEvent,
  type CiEventLocator,
  type WebhookCiEvent,
} from '#services/integrations/ci_status_projector'
import { shouldReplaceCiSummary } from '@aiproj/types'
import type { CodeRepositoryCiSummary } from '@aiproj/types'

/**
 * v2-5-code-repository-ci-status-display 任务 4.6 + 3.6 —— webhook fixture 投影与乱序/幂等。
 *
 * 说明：webhook foundation 只校验签名+记账、不派发 payload 到 CI handler（设计 D4），真实回调受授权门控。
 * 故这里在**已验证事件**基础上测投影 + 对象绑定 + 时间/source priority 判定（shouldReplaceCiSummary），
 * 默认全部 fixture/mock，不触真实 provider/webhook。
 */

const LINK: CiEventLocator = {
  provider: 'github',
  repositoryOwner: 'acme',
  repositoryName: 'web',
  externalNumber: 7,
  linkType: 'pull_request',
}

function ghEvent(overrides: Partial<WebhookCiEvent> = {}): WebhookCiEvent {
  return {
    provider: 'github',
    eventType: 'check_suite',
    repositoryFullName: 'acme/web',
    externalNumber: 7,
    status: 'completed',
    conclusion: 'success',
    name: 'CI',
    targetUrl: 'https://github.com/acme/web/runs/1',
    observedAt: '2026-07-23T10:00:00.000Z',
    ...overrides,
  }
}

/** 模拟服务侧「应用事件」：投影 + 对象绑定 + 时间优先。 */
function applyEvent(
  existing: CodeRepositoryCiSummary | null,
  event: WebhookCiEvent,
): { applied: boolean; next: CodeRepositoryCiSummary | null } {
  const { matched, summary } = projectWebhookCiEvent(event, LINK, 'github.com')
  if (!matched || !summary) return { applied: false, next: existing }
  if (!shouldReplaceCiSummary(existing, summary)) return { applied: false, next: existing }
  return { applied: true, next: summary }
}

test.group('Webhook CI 事件 fixture 投影（任务 4.6）', (group: Group) => {
  void group

  test('已验证事件匹配 locator → 产出脱敏 summary', ({ assert }) => {
    const { matched, summary } = projectWebhookCiEvent(ghEvent(), LINK, 'github.com')
    assert.isTrue(matched)
    assert.equal(summary?.state, 'passed')
    assert.equal(summary?.source, 'webhook')
    assert.equal(summary?.observedAt, '2026-07-23T10:00:00.000Z')
  })

  test('对象不匹配（跨 PR）→ 不产出、不更新', ({ assert }) => {
    const existing = applyEvent(null, ghEvent()).next
    const r = applyEvent(existing, ghEvent({ externalNumber: 42, conclusion: 'failure' }))
    assert.isFalse(r.applied)
    assert.equal(r.next?.state, 'passed') // 既有成功摘要保留，未被跨对象失败事件污染
  })

  test('重复事件幂等（相同 observedAt+state 不重复应用）', ({ assert }) => {
    const first = applyEvent(null, ghEvent())
    assert.isTrue(first.applied)
    const second = applyEvent(first.next, ghEvent())
    assert.isFalse(second.applied) // 幂等：相同事件第二次不再更新
    assert.deepEqual(second.next, first.next)
  })

  test('敏感 payload 字段不进入 summary（webhook 白名单）', ({ assert }) => {
    // 即便调用方在白名单字段塞进疑似敏感串，targetUrl 跨 host 被剥离、无额外键泄露
    const { summary } = projectWebhookCiEvent(
      ghEvent({ targetUrl: 'https://evil.com/steal?token=SECRET', name: 'deploy' }),
      LINK,
      'github.com',
    )
    assert.isNotNull(summary)
    assert.isNull(summary?.targetUrl)
    const serialized = JSON.stringify(summary)
    assert.notInclude(serialized, 'SECRET')
    assert.notInclude(serialized, 'evil.com')
  })

  test('GitLab pipeline webhook 事件投影为 pipeline 语义', ({ assert }) => {
    const gitlabLink: CiEventLocator = { ...LINK, provider: 'gitlab', linkType: 'merge_request' }
    const { matched, summary } = projectWebhookCiEvent(
      {
        provider: 'gitlab',
        eventType: 'pipeline',
        repositoryFullName: 'acme/web',
        externalNumber: 7,
        status: 'running',
        name: 'pipeline',
        targetUrl: 'https://gitlab.com/acme/web/-/pipelines/3',
        observedAt: '2026-07-23T11:00:00.000Z',
      },
      gitlabLink,
      'gitlab.com',
    )
    assert.isTrue(matched)
    assert.equal(summary?.state, 'running')
    assert.equal(summary?.source, 'webhook')
    assert.equal(summary?.targetUrl, 'https://gitlab.com/acme/web/-/pipelines/3')
  })
})

test.group('CI 乱序/竞争/幂等（任务 3.6）', (group: Group) => {
  void group

  test('旧失败事件不覆盖较新成功摘要', ({ assert }) => {
    const success = applyEvent(null, ghEvent({ observedAt: '2026-07-23T12:00:00.000Z' })).next
    assert.equal(success?.state, 'passed')
    // 一条更早的失败事件到达
    const r = applyEvent(
      success,
      ghEvent({ conclusion: 'failure', observedAt: '2026-07-23T09:00:00.000Z' }),
    )
    assert.isFalse(r.applied)
    assert.equal(r.next?.state, 'passed') // 较新成功不被旧失败覆盖
  })

  test('较新失败事件覆盖较旧成功摘要', ({ assert }) => {
    const success = applyEvent(null, ghEvent({ observedAt: '2026-07-23T09:00:00.000Z' })).next
    const r = applyEvent(
      success,
      ghEvent({ conclusion: 'failure', observedAt: '2026-07-23T12:00:00.000Z' }),
    )
    assert.isTrue(r.applied)
    assert.equal(r.next?.state, 'failed')
  })

  test('webhook 与手动刷新竞争：同刻失败优先于成功（状态权重）', ({ assert }) => {
    // 同一 observedAt，failed 状态权重高于 passed → 失败胜出（更安全的可见性）
    const passed = applyEvent(null, ghEvent({ observedAt: '2026-07-23T10:00:00.000Z' })).next
    const r = applyEvent(
      passed,
      ghEvent({ conclusion: 'failure', observedAt: '2026-07-23T10:00:00.000Z' }),
    )
    assert.isTrue(r.applied)
    assert.equal(r.next?.state, 'failed')
  })

  test('同刻同状态重复事件不重复应用（幂等）', ({ assert }) => {
    const a = applyEvent(null, ghEvent({ observedAt: '2026-07-23T10:00:00.000Z' })).next
    const r = applyEvent(a, ghEvent({ observedAt: '2026-07-23T10:00:00.000Z' }))
    assert.isFalse(r.applied)
  })
})
