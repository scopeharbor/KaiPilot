/**
 * 文档全文搜索审计事件与动词映射单元测试（v3-document-full-text-search §9.4）。
 *
 * 断言：DOCUMENT_SEARCH_* 事件全部注册到 AuditEvent 与 EVENT_TO_ACTION，
 * 映射到 audit_logs.action CHECK 约束允许的既有动词。
 */
import { test } from '@japa/runner'
import { AuditEvent, EVENT_TO_ACTION } from '#services/audit_service'

// audit_logs.action CHECK 约束允许的动词枚举（sec7）
const ALLOWED_ACTIONS = new Set([
  'create',
  'read',
  'update',
  'delete',
  'export',
  'import',
  'login',
  'logout',
  'approve',
  'reject',
  'ai_generate',
  'apply',
  'rollback',
  'sys_warning',
])

const EVENTS = [
  AuditEvent.DOCUMENT_SEARCH_QUERIED,
  AuditEvent.DOCUMENT_SEARCH_INDEX_REBUILT,
  AuditEvent.DOCUMENT_SEARCH_REINDEX_DENIED,
  AuditEvent.DOCUMENT_SEARCH_INDEX_WARN,
]

test.group('Document search audit events - registration & action mapping', () => {
  test('every document search event is registered in AuditEvent', ({ assert }) => {
    for (const evt of EVENTS) {
      assert.isString(evt)
      assert.isTrue(evt.startsWith('DOCUMENT_SEARCH_'))
    }
  })

  test('every document search event maps to an allowed action verb', ({ assert }) => {
    for (const evt of EVENTS) {
      assert.property(EVENT_TO_ACTION, evt, `事件 ${evt} 必须映射到 action 动词`)
      const action = EVENT_TO_ACTION[evt]
      assert.isTrue(
        ALLOWED_ACTIONS.has(action),
        `事件 ${evt} 映射的动词 ${action} 必须在 CHECK 约束允许范围内`,
      )
    }
  })

  test('DOCUMENT_SEARCH_QUERIED maps to read action', ({ assert }) => {
    assert.strictEqual(EVENT_TO_ACTION[AuditEvent.DOCUMENT_SEARCH_QUERIED], 'read')
  })

  test('DOCUMENT_SEARCH_INDEX_REBUILT maps to apply action', ({ assert }) => {
    assert.strictEqual(EVENT_TO_ACTION[AuditEvent.DOCUMENT_SEARCH_INDEX_REBUILT], 'apply')
  })

  test('DOCUMENT_SEARCH_REINDEX_DENIED maps to reject action', ({ assert }) => {
    assert.strictEqual(EVENT_TO_ACTION[AuditEvent.DOCUMENT_SEARCH_REINDEX_DENIED], 'reject')
  })

  test('DOCUMENT_SEARCH_INDEX_WARN maps to sys_warning action', ({ assert }) => {
    assert.strictEqual(EVENT_TO_ACTION[AuditEvent.DOCUMENT_SEARCH_INDEX_WARN], 'sys_warning')
  })
})

test.group('Document search audit metadata schema', () => {
  test('DOCUMENT_SEARCH_QUERIED metadata should contain keywordHash, keywordPrefix, resultCount, resultCountRange', ({
    assert,
  }) => {
    const metadata = {
      keywordHash: 'abc123',
      keywordPrefix: '关键',
      resultCount: 42,
      resultCountRange: '21-50',
    }
    assert.property(metadata, 'keywordHash')
    assert.property(metadata, 'keywordPrefix')
    assert.property(metadata, 'resultCount')
    assert.property(metadata, 'resultCountRange')
    assert.isString(metadata.keywordHash)
    assert.strictEqual(metadata.keywordPrefix.length, 2)
  })

  test('DOCUMENT_SEARCH_INDEX_REBUILT metadata should contain counts and warnings', ({
    assert,
  }) => {
    const metadata = {
      indexed: 10,
      skipped: 2,
      removed: 1,
      truncated: 0,
      warnings: [],
      full: false,
    }
    assert.property(metadata, 'indexed')
    assert.property(metadata, 'warnings')
    assert.isArray(metadata.warnings)
  })
})
