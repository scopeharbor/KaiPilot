/**
 * 项目文档 Markdown 导入/导出 Validator 单元测试（v3-document-markdown-import-export §3.5）。
 */
import { test } from '@japa/runner'
import {
  markdownImportConfirmValidator,
  markdownImportPreviewValidator,
  markdownExportSingleParamsValidator,
  markdownExportTreeValidator,
} from '#validators/document_markdown'
import { MARKDOWN_BUNDLE_MAX_ITEMS, MARKDOWN_IMPORT_MAX_BYTES } from '@aiproj/types'

const VALID_PREVIEW = {
  mode: 'create',
  content: '# 标题\n\n正文内容',
  originalFilename: 'notes.md',
}

const VALID_CONFIRM = {
  mode: 'create',
  content: '# 标题\n\n正文内容',
  confirmed: true,
  previewHash: 'a'.repeat(16),
}

test.group('MarkdownImportPreviewValidator', () => {
  test('合法 create 预览通过', async ({ assert }) => {
    const result = await markdownImportPreviewValidator.validate(VALID_PREVIEW)
    assert.equal(result.mode, 'create')
    assert.equal(result.content, VALID_PREVIEW.content)
    assert.equal(result.originalFilename, 'notes.md')
  })

  test('合法 replace 预览通过（targetDocumentId + 预期源哈希）', async ({ assert }) => {
    const result = await markdownImportPreviewValidator.validate({
      mode: 'replace',
      content: '# 标题',
      targetDocumentId: 7,
      expectedSourceDocumentHash: 'a'.repeat(16),
    })
    assert.equal(result.mode, 'replace')
    assert.equal(result.targetDocumentId, 7)
    assert.equal(result.expectedSourceDocumentHash, 'a'.repeat(16))
  })

  test('非法 mode 拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      markdownImportPreviewValidator.validate({ ...VALID_PREVIEW, mode: 'delete' }),
    )
  })

  test('缺失 content 拒绝', async ({ assert }) => {
    await assert.rejects(() => markdownImportPreviewValidator.validate({ mode: 'create' }))
  })

  test('超长 content 拒绝（字符上限）', async ({ assert }) => {
    await assert.rejects(() =>
      markdownImportPreviewValidator.validate({
        mode: 'create',
        content: 'x'.repeat(MARKDOWN_IMPORT_MAX_BYTES + 1),
      }),
    )
  })

  test('非正整数 parentId 拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      markdownImportPreviewValidator.validate({ ...VALID_PREVIEW, parentId: 0 }),
    )
    await assert.rejects(() =>
      markdownImportPreviewValidator.validate({ ...VALID_PREVIEW, parentId: -3 }),
    )
  })

  test('非正整数 targetDocumentId 拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      markdownImportPreviewValidator.validate({ ...VALID_PREVIEW, targetDocumentId: -1 }),
    )
  })

  test('超长 expectedSourceDocumentHash 拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      markdownImportPreviewValidator.validate({
        ...VALID_PREVIEW,
        expectedSourceDocumentHash: 'a'.repeat(129),
      }),
    )
  })
})

test.group('MarkdownImportConfirmValidator', () => {
  test('合法确认通过', async ({ assert }) => {
    const result = await markdownImportConfirmValidator.validate(VALID_CONFIRM)
    assert.isTrue(result.confirmed)
    assert.equal(result.previewHash, 'a'.repeat(16))
  })

  test('confirmed 缺失拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      markdownImportConfirmValidator.validate({
        mode: 'create',
        content: '# 标题',
        previewHash: 'a'.repeat(16),
      }),
    )
  })

  test('confirmed 非布尔拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      markdownImportConfirmValidator.validate({ ...VALID_CONFIRM, confirmed: 'yes' }),
    )
  })

  test('previewHash 缺失拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      markdownImportConfirmValidator.validate({
        mode: 'create',
        content: '# 标题',
        confirmed: true,
      }),
    )
  })

  test('previewHash 超长拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      markdownImportConfirmValidator.validate({
        ...VALID_CONFIRM,
        previewHash: 'a'.repeat(65),
      }),
    )
  })

  test('超长 content 拒绝（字符上限）', async ({ assert }) => {
    await assert.rejects(() =>
      markdownImportConfirmValidator.validate({
        ...VALID_CONFIRM,
        content: 'x'.repeat(MARKDOWN_IMPORT_MAX_BYTES + 1),
      }),
    )
  })
})

test.group('MarkdownExportSingleParamsValidator', () => {
  test('合法 documentId 通过', async ({ assert }) => {
    const result = await markdownExportSingleParamsValidator.validate({ documentId: 42 })
    assert.equal(result.documentId, 42)
  })

  test('零 documentId 拒绝', async ({ assert }) => {
    await assert.rejects(() => markdownExportSingleParamsValidator.validate({ documentId: 0 }))
  })

  test('负数 documentId 拒绝', async ({ assert }) => {
    await assert.rejects(() => markdownExportSingleParamsValidator.validate({ documentId: -1 }))
  })

  test('非数字 documentId 拒绝', async ({ assert }) => {
    await assert.rejects(() => markdownExportSingleParamsValidator.validate({ documentId: 'abc' }))
  })
})

test.group('MarkdownExportTreeValidator', () => {
  test('合法 selectedIds 通过', async ({ assert }) => {
    const result = await markdownExportTreeValidator.validate({
      selectedIds: [1, 2, 3],
      includeChildren: true,
    })
    assert.deepEqual(result.selectedIds, [1, 2, 3])
    assert.isTrue(result.includeChildren)
  })

  test('重复 selectedIds 通过（服务层确定性去重）', async ({ assert }) => {
    const result = await markdownExportTreeValidator.validate({ selectedIds: [3, 1, 3, 2] })
    assert.deepEqual(result.selectedIds, [3, 1, 3, 2])
  })

  test('空 selectedIds 拒绝', async ({ assert }) => {
    await assert.rejects(() => markdownExportTreeValidator.validate({ selectedIds: [] }))
  })

  test('selectedIds 超过 bundle 上限拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      markdownExportTreeValidator.validate({
        selectedIds: Array.from({ length: MARKDOWN_BUNDLE_MAX_ITEMS + 1 }, (_, i) => i + 1),
      }),
    )
  })

  test('非正整数 selectedIds 拒绝', async ({ assert }) => {
    await assert.rejects(() => markdownExportTreeValidator.validate({ selectedIds: [0, 1] }))
  })

  test('includeChildren 非布尔拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      markdownExportTreeValidator.validate({ selectedIds: [1], includeChildren: 'yes' }),
    )
  })
})
