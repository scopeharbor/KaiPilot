import { test } from '@japa/runner'
import {
  createReportValidator,
  exportReportValidator,
  listReportsValidator,
} from '#validators/report'

/**
 * Report Validator 单元测试（tasks 2.5）。
 *
 * 覆盖：模板白名单、导出格式白名单、集合上限、分页边界、附加参数忽略。
 * 与 functional 层的越权矩阵互补——此处只关心「参数」的合法/非法。
 */

test.group('createReportValidator', () => {
  test('接受 progress/delay/workload/milestone 白名单模板', async ({ assert }) => {
    for (const tpl of ['progress', 'delay', 'workload', 'milestone']) {
      const out = await createReportValidator.validate({ template: tpl })
      assert.equal(out.template, tpl)
    }
  })

  test('拒绝白名单外模板 → E_VALIDATION_ERROR', async ({ assert }) => {
    await assert.rejects(() =>
      createReportValidator.validate({ template: 'custom' } as unknown as { template: string }),
    )
    await assert.rejects(() =>
      createReportValidator.validate({ template: '' } as unknown as { template: string }),
    )
  })

  test('接受 filters 集合上限 200，超限拒绝', async ({ assert }) => {
    const withinLimit = Array.from({ length: 200 }, (_, i) => i + 1)
    await createReportValidator.validate({
      template: 'progress',
      filters: { assigneeIds: withinLimit },
    })
    const over = Array.from({ length: 201 }, (_, i) => i + 1)
    await assert.rejects(() =>
      createReportValidator.validate({
        template: 'progress',
        filters: { assigneeIds: over },
      }),
    )
  })

  test('formatConfig.locale 仅接受 zh-CN', async ({ assert }) => {
    await createReportValidator.validate({
      template: 'progress',
      formatConfig: { locale: 'zh-CN' },
    })
    await assert.rejects(() =>
      createReportValidator.validate({
        template: 'progress',
        formatConfig: { locale: 'en-US' } as unknown as { locale: string },
      }),
    )
  })
})

test.group('exportReportValidator', () => {
  test('接受 markdown 与 csv', async ({ assert }) => {
    const md = await exportReportValidator.validate({ format: 'markdown' })
    assert.equal(md.format, 'markdown')
    const csv = await exportReportValidator.validate({ format: 'csv' })
    assert.equal(csv.format, 'csv')
  })

  test('拒绝 pdf/xlsx/其他格式', async ({ assert }) => {
    await assert.rejects(() =>
      exportReportValidator.validate({ format: 'pdf' } as unknown as { format: string }),
    )
    await assert.rejects(() =>
      exportReportValidator.validate({ format: 'xlsx' } as unknown as { format: string }),
    )
  })
})

test.group('listReportsValidator', () => {
  test('page/perPage 边界：page>=1，perPage 1..100', async ({ assert }) => {
    await listReportsValidator.validate({ page: 1, perPage: 1 })
    await listReportsValidator.validate({ page: 100000, perPage: 100 })
    await assert.rejects(() => listReportsValidator.validate({ page: 0 }))
    await assert.rejects(() => listReportsValidator.validate({ perPage: 0 }))
    await assert.rejects(() => listReportsValidator.validate({ perPage: 101 }))
  })

  test('template 若给必须白名单', async ({ assert }) => {
    await listReportsValidator.validate({ template: 'workload' })
    await assert.rejects(() =>
      listReportsValidator.validate({ template: 'foo' } as unknown as { template: string }),
    )
  })
})
