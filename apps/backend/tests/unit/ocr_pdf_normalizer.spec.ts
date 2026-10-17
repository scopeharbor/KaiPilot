/**
 * v3-ocr-multipage-pdf-support §3.9 + §4.13 — 后端 PDF 归一化 + job 处理测试 (Japa)。
 *
 * 所有测试使用 FakePdfNormalizerAdapter 和 fake OCR provider，
 * 不依赖真实 PDF 文件、canvas 渲染、真实 OCR provider 或网络调用。
 */

import { test } from '@japa/runner'
import { OcrDocumentInputNormalizer } from '#services/ai_ocr/ocr_document_input_normalizer'
import FakePdfNormalizerAdapter from '#services/ai_ocr/fake_pdf_normalizer_adapter'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 创建临时文件用于绕过文件存在性检查 */
function tempFile(filename: string): string {
  const p = join(tmpdir(), filename)
  writeFileSync(p, 'fake-pdf-content')
  return p
}

function removeFile(path: string) {
  try {
    unlinkSync(path)
  } catch {}
}

test.group('PDF Normalizer (Fake Adapter)', () => {
  test('成功归一化多页 PDF (3 页)', async ({ assert }) => {
    const tf = tempFile('three-pages.pdf')
    try {
      const fake = new FakePdfNormalizerAdapter({ totalPages: 3 })
      const normalizer = new OcrDocumentInputNormalizer(fake)
      const result = await normalizer.normalize(tf, 'application/pdf', 'three-pages.pdf')

      assert.isTrue(result.ok)
      if (result.ok) {
        assert.equal(result.result.totalPages, 3)
        assert.equal(result.result.pages.length, 3)
        assert.equal(result.result.skippedPages, 0)
        assert.equal(result.result.pages[0].pageIndex, 0)
        assert.equal(result.result.pages[2].pageIndex, 2)
        assert.isString(result.result.pages[0].dataUrl)
        assert.include(result.result.pages[0].dataUrl ?? '', 'FAKE_PAGE_0')
      }
    } finally {
      removeFile(tf)
    }
  })

  test('成功归一化单页 PDF', async ({ assert }) => {
    const tf = tempFile('single.pdf')
    try {
      const fake = new FakePdfNormalizerAdapter({ totalPages: 1 })
      const normalizer = new OcrDocumentInputNormalizer(fake)
      const result = await normalizer.normalize(tf, 'application/pdf', 'single.pdf')

      assert.isTrue(result.ok)
      if (result.ok) {
        assert.equal(result.result.totalPages, 1)
        assert.equal(result.result.pages.length, 1)
      }
    } finally {
      removeFile(tf)
    }
  })

  test('adapter 不可用时返回失败', async ({ assert }) => {
    const tf = tempFile('doc-unavailable.pdf')
    try {
      const fake = new FakePdfNormalizerAdapter({ unavailable: true })
      const normalizer = new OcrDocumentInputNormalizer(fake)
      const result = await normalizer.normalize(tf, 'application/pdf', 'doc.pdf')

      assert.isFalse(result.ok)
      if (!result.ok) {
        const code = result.failure.warnings[0]?.code
        assert.isDefined(code)
        assert.include(['PDF_NORMALIZER_UNAVAILABLE', 'MALFORMED_FILE'], code)
      }
    } finally {
      removeFile(tf)
    }
  })

  test('adapter 抛异常时返回失败', async ({ assert }) => {
    const tf = tempFile('doc-throw.pdf')
    try {
      const fake = new FakePdfNormalizerAdapter({ throwError: true })
      const normalizer = new OcrDocumentInputNormalizer(fake)
      const result = await normalizer.normalize(tf, 'application/pdf', 'doc.pdf')

      assert.isFalse(result.ok)
    } finally {
      removeFile(tf)
    }
  })

  test('不支持的 MIME 类型返回错误', async ({ assert }) => {
    const fake = new FakePdfNormalizerAdapter()
    const normalizer = new OcrDocumentInputNormalizer(fake)
    const result = await normalizer.normalize(
      '/fake/doc.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'doc.docx',
    )

    assert.isFalse(result.ok)
    if (!result.ok) {
      assert.equal(result.failure.warnings[0].code, 'UNSUPPORTED_MIME')
    }
  })

  test('图像文件不受 PDF adapter 影响 (MIME 路由正确)', async ({ assert }) => {
    // 图像文件先走 image 路径（检查文件是否存在）
    const resultWithoutFile = await new OcrDocumentInputNormalizer(
      new FakePdfNormalizerAdapter({ unavailable: true }),
    ).normalize('/no/such/image.png', 'image/png', 'image.png')

    assert.isFalse(resultWithoutFile.ok)
    // 不存在的图像文件 → MALFORMED_FILE（不是 PDF_NORMALIZER_UNAVAILABLE）
    if (!resultWithoutFile.ok) {
      assert.notEqual(resultWithoutFile.failure.warnings[0]?.code, 'PDF_NORMALIZER_UNAVAILABLE')
    }
  })

  test('部分 page 失败时 still returns success pages', async ({ assert }) => {
    const tf = tempFile('partial-fail.pdf')
    try {
      const fake = new FakePdfNormalizerAdapter({
        totalPages: 3,
        failedPages: [1],
      })
      const normalizer = new OcrDocumentInputNormalizer(fake)
      const result = await normalizer.normalize(tf, 'application/pdf', 'partial-fail.pdf')

      assert.isTrue(result.ok)
      if (result.ok) {
        assert.equal(result.result.totalPages, 3)
        assert.equal(result.result.pages.length, 2)
        assert.equal(result.result.skippedPages, 1)
        assert.isAtLeast(result.result.warnings.length, 1)
      }
    } finally {
      removeFile(tf)
    }
  })
})
