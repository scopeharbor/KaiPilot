/**
 * v3-copilot-citations — CopilotCitationFilterService & ObservabilityService 单元测试。
 *
 * 覆盖：
 * §3.1 外部结论无引用 → 抑制
 * §3.5 同 URL 引用合并
 * §3.7 脚注编号分配
 * §7.2 引用展示/激活记录
 * §7.8 组织级数据隔离
 * §7.4 域名级存储（无完整 URL / query text）
 */
import { test } from '@japa/runner'
import type { CopilotCitation } from '@aiproj/types'
import {
  CopilotCitationFilterService,
  type ExternalConclusion,
} from '#services/copilot/copilot_citation_filter_service'
import { CopilotCitationObservabilityService } from '#services/copilot/copilot_citation_observability_service'

test.group('CopilotCitationFilterService', (group) => {
  const service = new CopilotCitationFilterService()

  group.setup(() => {
    // Pure logic service — no DB setup needed
  })

  test('suppress external conclusion without citation', ({ assert }) => {
    const conclusions: ExternalConclusion[] = [
      { conclusionId: 'c1', statement: 'test', sourceKind: 'external_content' },
    ]
    const result = service.filterConclusions(conclusions)
    assert.lengthOf(result.presented, 0)
    assert.lengthOf(result.suppressed, 1)
  })

  test('present external conclusion with complete citation', ({ assert }) => {
    const conclusions: ExternalConclusion[] = [
      {
        conclusionId: 'c2',
        statement: 'test',
        sourceKind: 'external_content',
        citation: {
          citationId: 'cit1',
          url: 'https://example.com',
          title: 'Test',
          fetchedAt: '2026-01-01T00:00:00Z',
          snapshotHash: 'hash',
          supportedConclusionIds: ['c2'],
        },
      },
    ]
    const result = service.filterConclusions(conclusions)
    assert.lengthOf(result.presented, 1)
    assert.lengthOf(result.suppressed, 0)
  })

  test('always present internal conclusions', ({ assert }) => {
    const conclusions: ExternalConclusion[] = [
      { conclusionId: 'c3', statement: 'internal', sourceKind: 'task' },
    ]
    const result = service.filterConclusions(conclusions)
    assert.lengthOf(result.presented, 1)
    assert.lengthOf(result.suppressed, 0)
  })

  test('suppress external conclusion with incomplete citation (missing fetchedAt)', ({
    assert,
  }) => {
    const conclusions: ExternalConclusion[] = [
      {
        conclusionId: 'c4',
        statement: 'test',
        sourceKind: 'search_result',
        citation: {
          citationId: 'cit4',
          url: 'https://example.com',
          title: 'Test',
          fetchedAt: '',
          snapshotHash: 'hash',
          supportedConclusionIds: ['c4'],
        },
      },
    ]
    const result = service.filterConclusions(conclusions)
    assert.lengthOf(result.presented, 0)
    assert.lengthOf(result.suppressed, 1)
  })

  test('merge citations by URL', ({ assert }) => {
    const citations: CopilotCitation[] = [
      {
        citationId: 'c1',
        url: 'https://same.com',
        title: 'A',
        fetchedAt: '2026-01-01T00:00:00Z',
        snapshotHash: 'h1',
        supportedConclusionIds: ['c1'],
      },
      {
        citationId: 'c2',
        url: 'https://same.com',
        title: 'A',
        fetchedAt: '2026-01-01T00:00:00Z',
        snapshotHash: 'h1',
        supportedConclusionIds: ['c2'],
      },
    ]
    const merged = service.mergeForRendering(citations)
    assert.lengthOf(merged, 1)
    assert.deepEqual(merged[0].supportedConclusionIds, ['c1', 'c2'])
  })

  test('assign footnote indices', ({ assert }) => {
    const citations: CopilotCitation[] = [
      {
        citationId: 'c1',
        url: 'https://a.com',
        title: 'A',
        fetchedAt: '2026-01-01T00:00:00Z',
        snapshotHash: 'h',
        supportedConclusionIds: [],
      },
      {
        citationId: 'c2',
        url: 'https://b.com',
        title: 'B',
        fetchedAt: '2026-01-01T00:00:00Z',
        snapshotHash: 'h',
        supportedConclusionIds: [],
      },
      {
        citationId: 'c3',
        url: 'https://a.com',
        title: 'A',
        fetchedAt: '2026-01-01T00:00:00Z',
        snapshotHash: 'h',
        supportedConclusionIds: [],
      },
    ]
    const indexed = service.assignFootnotes(citations)
    assert.equal(indexed[0].footNoteIndex, 1)
    assert.equal(indexed[1].footNoteIndex, 2)
    assert.equal(indexed[2].footNoteIndex, 1) // same URL → same footnote
  })

  test('empty conclusions produce empty result', ({ assert }) => {
    const result = service.filterConclusions([])
    assert.lengthOf(result.presented, 0)
    assert.lengthOf(result.suppressed, 0)
  })

  test('filter handles all external source kinds', ({ assert }) => {
    const externalKinds = ['external_content', 'search_result', 'help_article', 'general_knowledge']
    for (const kind of externalKinds) {
      const conclusions: ExternalConclusion[] = [
        { conclusionId: `c-${kind}`, statement: 'test', sourceKind: kind },
      ]
      const result = service.filterConclusions(conclusions)
      assert.lengthOf(result.suppressed, 1, `Expected suppression for kind: ${kind}`)
    }
  })
})

test.group('CopilotCitationObservabilityService', (group) => {
  group.each.setup(() => {
    // Fresh instance per test — no shared state
  })

  test('record presentation with org isolation', ({ assert }) => {
    const service = new CopilotCitationObservabilityService()
    service.recordPresentation({
      organizationId: 'org-1',
      domain: 'example.com',
      citationCount: 3,
    })
    const records = service.getRecordsForOrganization('org-1')
    assert.lengthOf(records, 1)
    assert.equal(records[0].citationsPresented, 3)
    assert.equal(records[0].domain, 'example.com')
  })

  test('cross-org records invisible', ({ assert }) => {
    const service = new CopilotCitationObservabilityService()
    service.recordPresentation({
      organizationId: 'org-1',
      domain: 'example.com',
      citationCount: 2,
    })
    const org2Records = service.getRecordsForOrganization('org-2')
    assert.lengthOf(org2Records, 0)
  })

  test('record activation', ({ assert }) => {
    const service = new CopilotCitationObservabilityService()
    service.recordPresentation({
      organizationId: 'org-1',
      domain: 'example.com',
      citationCount: 1,
    })
    service.recordActivation({
      organizationId: 'org-1',
      domain: 'example.com',
      citationId: 'cit-1',
    })
    const records = service.getRecordsForOrganization('org-1')
    assert.equal(records[0].citationsActivated, 1)
  })

  test('record injection interception', ({ assert }) => {
    const service = new CopilotCitationObservabilityService()
    service.recordInjectionInterception({
      organizationId: 'org-1',
      domain: 'evil.com',
    })
    const records = service.getRecordsForOrganization('org-1')
    assert.lengthOf(records, 1)
    assert.equal(records[0].injectionInterceptions, 1)
  })

  test('domain distribution aggregates correctly', ({ assert }) => {
    const service = new CopilotCitationObservabilityService()
    service.recordPresentation({ organizationId: 'org-1', domain: 'a.com', citationCount: 2 })
    service.recordPresentation({ organizationId: 'org-1', domain: 'a.com', citationCount: 1 })
    service.recordPresentation({ organizationId: 'org-1', domain: 'b.com', citationCount: 3 })
    const dist = service.getDomainDistribution('org-1')
    assert.equal(dist.get('a.com')?.presented, 3)
    assert.equal(dist.get('b.com')?.presented, 3)
  })

  test('record does not contain query text or full URL', ({ assert }) => {
    const service = new CopilotCitationObservabilityService()
    const record = service.recordPresentation({
      organizationId: 'org-1',
      domain: 'example.com',
      citationCount: 1,
    })
    assert.notProperty(record, 'queryText')
    assert.notProperty(record, 'fullUrl')
    assert.notProperty(record, 'pageBody')
  })

  test('validate record safety rejects sensitive fields', ({ assert }) => {
    const service = new CopilotCitationObservabilityService()
    const safe = service.validateRecordSafety({ domain: 'example.com', count: 1 })
    assert.isTrue(safe.valid)
    assert.lengthOf(safe.violations, 0)

    const unsafe = service.validateRecordSafety({
      domain: 'example.com',
      queryText: 'secret search',
      fullUrl: 'https://example.com?q=secret',
    })
    assert.isFalse(unsafe.valid)
    assert.lengthOf(unsafe.violations, 2)
  })
})
