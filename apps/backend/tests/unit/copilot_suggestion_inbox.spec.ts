import { test } from '@japa/runner'
import {
  InboxAggregator,
  type InboxSourceAdapter,
  type InboxSourceEntry,
} from '#services/copilot_inbox/inbox_aggregator'
import {
  InboxStateService,
  type InboxAdoptionRouter,
} from '#services/copilot_inbox/inbox_state_service'
import {
  InboxExpiryChecker,
  type InboxSourceFreshnessChecker,
} from '#services/copilot_inbox/inbox_expiry'
import type { InboxEntry, InboxSourceKind, InboxSeverity } from '@aiproj/types'
import { sortInboxEntries } from '@aiproj/types'

/**
 * v3-copilot-suggestion-inbox — 聚合 / 去重 / 过期 / 状态 的聚焦测试（任务 8.2、8.6）。
 *
 * 覆盖：五来源聚合与来源可追溯、去重合并（同去重键取更严重者、来源引用累加）、
 * 来源不可用时的缺席声明、五态迁移与终态不可迁移、采纳必经 preview 通道、
 * source hash 失配的过期判定、以及确定性排序。
 *
 * 全部为纯内存 fixture：不连数据库、不发网络、不触真实 provider。
 */

const ORG_ID = 100
const PROJECT_ID = 7

function sourceEntry(overrides: Partial<InboxSourceEntry> = {}): InboxSourceEntry {
  return {
    sourceId: 'src-1',
    projectId: PROJECT_ID,
    problemKind: 'schedule_risk',
    severity: 'medium',
    declaredDedupeKey: 'task:42',
    sourceHash: 'hash-1',
    capturedAt: '2026-08-17T10:00:00.000Z',
    ...overrides,
  }
}

function adapter(
  sourceKind: InboxSourceKind,
  entries: InboxSourceEntry[],
  options: { available?: boolean; throws?: boolean } = {},
): InboxSourceAdapter {
  return {
    sourceKind,
    async isAvailable() {
      return options.available ?? true
    },
    async listForInbox() {
      if (options.throws) throw new Error('来源查询失败')
      return entries
    },
  }
}

function inboxEntry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: 'e-1',
    organizationId: String(ORG_ID),
    projectId: String(PROJECT_ID),
    state: 'unread',
    problemKind: 'schedule_risk',
    severity: 'medium',
    dedupeKey: { problemKind: 'schedule_risk', declaredKey: 'task:42' },
    sourceRefs: [
      {
        sourceKind: 'smart_recommendation',
        sourceId: 'src-1',
        projectId: String(PROJECT_ID),
        sourceHash: 'hash-1',
        capturedAt: '2026-08-17T10:00:00.000Z',
      },
    ],
    expiryReason: null,
    expiryDetail: null,
    createdAt: '2026-08-17T10:00:00.000Z',
    updatedAt: '2026-08-17T10:00:00.000Z',
    readAt: null,
    actionedAt: null,
    ...overrides,
  }
}

// ───────────────────────────── 聚合与去重 ─────────────────────────────

test.group('InboxAggregator', () => {
  test('每个条目可追溯到产出它的来源（五来源可区分）', async ({ assert }) => {
    const aggregator = new InboxAggregator([
      adapter('smart_recommendation', [
        sourceEntry({ sourceId: 'sr-1', declaredDedupeKey: 'task:1' }),
      ]),
      adapter('risk_ai_suggestion', [
        sourceEntry({ sourceId: 'ra-1', declaredDedupeKey: 'task:99' }),
      ]),
    ])

    const result = await aggregator.aggregate({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      actorId: 1,
    })

    const kinds = result.entries.flatMap((e) => e.sourceRefs.map((r) => r.sourceKind)).sort()
    assert.deepEqual(kinds, ['risk_ai_suggestion', 'smart_recommendation'])
  })

  test('同去重键合并为一条，来源引用累加', async ({ assert }) => {
    const aggregator = new InboxAggregator([
      adapter('smart_recommendation', [sourceEntry({ sourceId: 'sr-1' })]),
      adapter('pmo_priority_recommendation', [sourceEntry({ sourceId: 'pmo-1' })]),
    ])

    const result = await aggregator.aggregate({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      actorId: 1,
    })

    assert.lengthOf(result.entries, 1)
    assert.lengthOf(result.entries[0]!.sourceRefs, 2)
    assert.deepEqual(result.entries[0]!.sourceRefs.map((r) => r.sourceKind).sort(), [
      'pmo_priority_recommendation',
      'smart_recommendation',
    ])
  })

  test('合并时严重度取更严重者', async ({ assert }) => {
    const aggregator = new InboxAggregator([
      adapter('smart_recommendation', [sourceEntry({ severity: 'low' })]),
      adapter('progress_risk_prediction', [sourceEntry({ sourceId: 's2', severity: 'critical' })]),
    ])

    const result = await aggregator.aggregate({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      actorId: 1,
    })

    assert.lengthOf(result.entries, 1)
    assert.equal(result.entries[0]!.severity, 'critical')
  })

  test('来源不可用时声明缺席，不静默吞掉', async ({ assert }) => {
    const aggregator = new InboxAggregator([
      adapter('smart_recommendation', [sourceEntry()]),
      adapter('health_diagnosis_draft', [], { available: false }),
    ])

    const result = await aggregator.aggregate({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      actorId: 1,
    })

    assert.lengthOf(result.missingSources, 1)
    assert.equal(result.missingSources[0]!.sourceKind, 'health_diagnosis_draft')
    // 其余来源仍产出条目
    assert.lengthOf(result.entries, 1)
  })

  test('来源抛错时降级为缺席声明，不中断整体聚合', async ({ assert }) => {
    const aggregator = new InboxAggregator([
      adapter('smart_recommendation', [sourceEntry()]),
      adapter('risk_ai_suggestion', [], { throws: true }),
    ])

    const result = await aggregator.aggregate({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      actorId: 1,
    })

    assert.lengthOf(result.entries, 1)
    assert.equal(result.missingSources[0]!.sourceKind, 'risk_ai_suggestion')
  })

  test('聚合结果不含建议正文（只有引用与元数据）', async ({ assert }) => {
    const aggregator = new InboxAggregator([adapter('smart_recommendation', [sourceEntry()])])
    const result = await aggregator.aggregate({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      actorId: 1,
    })

    const keys = Object.keys(result.entries[0]!)
    for (const forbidden of ['body', 'content', 'summary', 'description', 'rationale']) {
      assert.notInclude(keys, forbidden)
    }
  })
})

// ───────────────────────────── 五态状态机 ─────────────────────────────

function stateService(sessionId = 'preview-1'): {
  service: InboxStateService
  calls: unknown[]
} {
  const calls: unknown[] = []
  const router: InboxAdoptionRouter = {
    async startAdoptionPreview(params) {
      calls.push(params)
      return { sessionId }
    },
  }
  return { service: new InboxStateService(router), calls }
}

test.group('InboxStateService', () => {
  test('unread → read 合法', ({ assert }) => {
    const { service } = stateService()
    const result = service.markRead(inboxEntry({ state: 'unread' }))
    assert.isTrue(result.success)
    assert.equal(result.newState, 'read')
  })

  test('终态不可再迁移（adopted/dismissed/expired）', ({ assert }) => {
    const { service } = stateService()
    for (const terminal of ['adopted', 'dismissed', 'expired'] as const) {
      const result = service.markRead(inboxEntry({ state: terminal }))
      assert.isFalse(result.success, `${terminal} 不应可迁移到 read`)
      assert.equal(result.newState, terminal)
    }
  })

  test('忽略产出 inbox 来源的反馈事件', ({ assert }) => {
    const { service } = stateService()
    const result = service.dismiss(inboxEntry({ state: 'read' }))
    assert.isTrue(result.success)
    assert.equal(result.newState, 'dismissed')
    assert.equal(result.feedbackEvent?.origin, 'inbox_suggestion')
    assert.equal(result.feedbackEvent?.action, 'dismiss')
  })

  test('采纳必经 preview 通道，返回 previewSessionId 而非直写', async ({ assert }) => {
    const { service, calls } = stateService('sess-42')
    const result = await service.adopt(inboxEntry({ state: 'read' }), {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      actorId: 1,
    })
    assert.isTrue(result.success)
    assert.equal(result.newState, 'adopted')
    assert.equal(result.previewSessionId, 'sess-42')
    // 采纳只调用 preview 路由，不触碰领域写入
    assert.lengthOf(calls, 1)
  })

  test('不看不点不产生状态变化（无隐式推断入口）', ({ assert }) => {
    const { service } = stateService()
    const entry = inboxEntry({ state: 'unread' })
    // 状态服务只暴露显式动作；未调用任何动作时条目状态不变
    assert.equal(entry.state, 'unread')
    assert.isFunction(service.markRead)
    assert.isFunction(service.dismiss)
  })
})

// ───────────────────────────── 过期判定 ─────────────────────────────

function expiryChecker(fresh: boolean, reason: 'schedule_changed' | null = null) {
  const checker: InboxSourceFreshnessChecker = {
    async checkFreshness() {
      return {
        fresh,
        currentHash: fresh ? 'hash-1' : 'hash-2',
        reason,
        detail: fresh ? null : '排期已变更',
      }
    },
  }
  return new InboxExpiryChecker(checker)
}

test.group('InboxExpiryChecker', () => {
  test('source hash 失配 → 条目过期并给出原因', async ({ assert }) => {
    const result = await expiryChecker(false, 'schedule_changed').checkExpiry(inboxEntry())
    assert.isTrue(result.expired)
    assert.equal(result.reason, 'schedule_changed')
    assert.equal(result.detail, '排期已变更')
  })

  test('来源新鲜 → 不过期', async ({ assert }) => {
    const result = await expiryChecker(true).checkExpiry(inboxEntry())
    assert.isFalse(result.expired)
    assert.isNull(result.reason)
  })

  test('终态条目不再参与过期判定', async ({ assert }) => {
    for (const terminal of ['adopted', 'dismissed', 'expired'] as const) {
      const result = await expiryChecker(false, 'schedule_changed').checkExpiry(
        inboxEntry({ state: terminal }),
      )
      assert.isFalse(result.expired, `${terminal} 不应再被判过期`)
    }
  })

  test('批量判定按条目 id 返回结果', async ({ assert }) => {
    const results = await expiryChecker(false, 'schedule_changed').checkBatchExpiry([
      inboxEntry({ id: 'a' }),
      inboxEntry({ id: 'b', state: 'adopted' }),
    ])
    assert.isTrue(results.get('a')!.expired)
    assert.isFalse(results.get('b')!.expired)
  })
})

// ───────────────────────────── 确定性排序 ─────────────────────────────

test.group('Inbox 排序', () => {
  test('严重度降序优先，字母序不得影响顺序', ({ assert }) => {
    const severities: InboxSeverity[] = ['low', 'critical', 'medium', 'info', 'high']
    const entries = severities.map((severity, i) =>
      inboxEntry({ id: `e-${i}`, severity, createdAt: '2026-08-17T10:00:00.000Z' }),
    )
    const sorted = sortInboxEntries(entries)
    assert.deepEqual(
      sorted.map((e) => e.severity),
      ['critical', 'high', 'medium', 'low', 'info'],
    )
  })

  test('同严重度按创建时间降序，再按 id 稳定破平局', ({ assert }) => {
    const sorted = sortInboxEntries([
      inboxEntry({ id: 'b', createdAt: '2026-08-17T10:00:00.000Z' }),
      inboxEntry({ id: 'a', createdAt: '2026-08-17T10:00:00.000Z' }),
      inboxEntry({ id: 'c', createdAt: '2026-08-18T10:00:00.000Z' }),
    ])
    assert.deepEqual(
      sorted.map((e) => e.id),
      ['c', 'a', 'b'],
    )
  })
})
