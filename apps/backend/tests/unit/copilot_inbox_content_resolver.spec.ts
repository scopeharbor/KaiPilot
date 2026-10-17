import { test } from '@japa/runner'
import {
  buildHealthItemContent,
  buildPmoRecommendationContent,
  buildProjectSignalContent,
} from '#services/copilot_inbox/inbox_content_resolver'

/**
 * 收件箱正文回源投影：三类来源的正文构建（纯函数，不连库）。
 * 权限与回源查询由 InboxContentResolver 负责，这里只锁定展示口径。
 */
test.group('InboxContentResolver 正文构建', () => {
  test('PMO 推荐透传标题、摘要与建议动作，空串视为缺省', ({ assert }) => {
    assert.deepEqual(
      buildPmoRecommendationContent({
        title: '优先推进项目 A',
        summary: '评分领先',
        suggestedAction: '提前分配资源',
      }),
      { title: '优先推进项目 A', summary: '评分领先', suggestedAction: '提前分配资源' },
    )
    assert.deepEqual(
      buildPmoRecommendationContent({ title: 'T', summary: '', suggestedAction: null }),
      { title: 'T', summary: null, suggestedAction: null },
    )
  })

  test('健康诊断项以维度中文名与规则作标题，证据作摘要', ({ assert }) => {
    const content = buildHealthItemContent({
      dimension: 'resource',
      ruleId: 'HR-RES-01',
      evidence: '3 名成员负载超过 120%',
      suggestedAction: '调整任务指派',
    })
    assert.equal(content.title, '健康诊断 · 资源（HR-RES-01）')
    assert.equal(content.summary, '3 名成员负载超过 120%')
    assert.equal(content.suggestedAction, '调整任务指派')
  })

  test('信号只展示指标与数值读数/阈值，不编造建议动作', ({ assert }) => {
    const content = buildProjectSignalContent({
      signalType: 'progress_deviation',
      observationWindow: '2026-09-01..2026-09-07',
      evidence: {
        metric: 'schedule_performance_index',
        readings: { current: 0.8123, entityId: 'task-9' },
        thresholds: { warning: 0.9 },
      },
    })
    assert.equal(content.title, '进度偏差（观测窗 2026-09-01..2026-09-07）')
    assert.equal(
      content.summary,
      '指标 schedule_performance_index；读数 current=0.81；阈值 warning=0.9',
    )
    assert.isNull(content.suggestedAction)
  })

  test('信号证据缺失时摘要为 null', ({ assert }) => {
    const content = buildProjectSignalContent({
      signalType: 'risk_surge',
      observationWindow: '2026-09-01..2026-09-07',
      evidence: null,
    })
    assert.isNull(content.summary)
  })
})
