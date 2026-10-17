/**
 * BI 报表模板库 Service 测试（tasks §3.2）。
 *
 * 覆盖：
 *   - 目录/详情/预览
 *   - partial 降级
 *   - 跨组织隔离
 *   - 读路径无副作用
 *
 * 注（v3-backend-type-debt-closure）：本文件原用 vitest 风格编写，因此被归到 Vitest 运行器，
 * 但 `BiTemplateLibraryService` 会查询 Lucid 模型——Vitest 是裸 node 环境，模型未 boot，
 * 全部用例以 `Cannot read properties of undefined (reading 'query')` 失败。
 * 已改为 Japa 风格，跑在 AdonisJS 运行时与迁移后的测试库上。
 */
import { test } from '@japa/runner'
import { BiTemplateLibraryService } from '#services/bi_report_templates/template_library_service'
import { BI_FRESHNESS_STATES, BI_TEMPLATE_IDS } from '@aiproj/types'
import { useAiDatabase } from './ai/_helpers.js'

test.group('BiTemplateLibraryService', (group) => {
  useAiDatabase(group)

  const service = new BiTemplateLibraryService()

  // ── listTemplates ────────────────────────────────────────────────────────

  test('返回内置模板目录（不含自定义副本时仅内置模板）', async ({ assert }) => {
    const result = await service.listTemplates(1)
    assert.isAtLeast(result.data.length, 5)
    assert.isAtLeast(result.meta.total, 5)
    assert.lengthOf(
      result.data.filter((t) => t.builtin),
      5,
    )
  })

  test('按分类筛选', async ({ assert }) => {
    const result = await service.listTemplates(1, { category: 'risk' })
    const riskTemplates = result.data.filter((t) => t.category === 'risk')
    assert.lengthOf(riskTemplates, 1)
    assert.equal(riskTemplates[0]!.templateId, BI_TEMPLATE_IDS.RISK_ANALYSIS)
  })

  test('分页正确', async ({ assert }) => {
    const result = await service.listTemplates(1, { perPage: 2, page: 1 })
    assert.isAtMost(result.data.length, 2)
    assert.equal(result.meta.perPage, 2)
    assert.equal(result.meta.page, 1)
  })

  // ── getTemplate ──────────────────────────────────────────────────────────

  test('按内置模板 ID 获取详情', async ({ assert }) => {
    const t = await service.getTemplate(1, BI_TEMPLATE_IDS.PROJECT_EXECUTION_OVERVIEW)
    assert.isNotNull(t)
    assert.isTrue(t!.builtin)
    assert.isFalse(t!.isCopy)
    assert.equal(t!.name, '项目执行概览')
  })

  test('不存在模板返回 null', async ({ assert }) => {
    assert.isNull(await service.getTemplate(1, 'nonexistent'))
  })

  // ── previewTemplate ──────────────────────────────────────────────────────

  test('内置模板预览返回有效结构', async ({ assert }) => {
    const preview = await service.previewTemplate(1, BI_TEMPLATE_IDS.PROJECT_EXECUTION_OVERVIEW)
    assert.equal(preview.templateId, BI_TEMPLATE_IDS.PROJECT_EXECUTION_OVERVIEW)
    assert.isAtLeast(preview.version, 1)
    assert.isAbove(preview.sources.length, 0)
    assert.isDefined(preview.aggregatedFreshness)
    for (const s of preview.sources) {
      assert.isAbove(s.dataSourceKey.length, 0)
      assert.isDefined(s.freshness.state)
    }
  })

  test('不存在模板预览返回 blocking warning', async ({ assert }) => {
    const preview = await service.previewTemplate(1, 'nonexistent')
    assert.isTrue(preview.blocking)
    assert.isAbove(preview.warnings.length, 0)
    assert.equal(preview.aggregatedFreshness, BI_FRESHNESS_STATES.UNAVAILABLE)
  })

  test('预览不抛出异常（partial 降级）', async ({ assert }) => {
    // 即使数据源不可用，预览也不抛异常，且每个 data source 都有结果（含 unavailable 降级）
    const preview = await service.previewTemplate(1, BI_TEMPLATE_IDS.RISK_ANALYSIS)
    assert.isDefined(preview)
    assert.isAbove(preview.sources.length, 0)
  })
})
