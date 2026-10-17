/**
 * v3-ocr-multipage-pdf-support §3.8 — Fake PDF normalize adapter（测试用）。
 *
 * 纯确定性 fake：按配置产出成功或失败结果，不依赖任何 PDF 库、文件 I/O 或网络。
 */

import {
  type OcrDocumentWarning,
  type OcrNormalizedPage,
  type OcrNormalizationResult,
  type OcrNormalizationOutcome,
} from '@aiproj/types'
import type {
  PdfNormalizerAdapterContract,
  NormalizerOptions,
} from '#services/ai_ocr/ocr_document_input_normalizer'

export interface FakePdfNormalizerConfig {
  /** 为这些 pageIndex 产生失败页 */
  failedPages?: number[]
  /** 为这些 pageIndex 产生跳过页（同时记录 reason） */
  skippedPages?: number[]
  /** 总页面数（用于 page-limit 测试） */
  totalPages?: number
  /** 是否模拟 adapter 不可用 */
  unavailable?: boolean
  /** 是否模拟抛异常 */
  throwError?: boolean
  /** 自定义 per-page mimeType */
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp'
  /** 自定义 per-page dataUrl */
  dataUrlPrefix?: string
}

export default class FakePdfNormalizerAdapter implements PdfNormalizerAdapterContract {
  readonly #config: FakePdfNormalizerConfig

  constructor(config: FakePdfNormalizerConfig = {}) {
    this.#config = config
  }

  async rasterize(
    _filePath: string,
    _fileName: string,
    _opts: NormalizerOptions,
  ): Promise<OcrNormalizationOutcome> {
    if (this.#config.unavailable) {
      return {
        ok: false,
        failure: {
          reason: 'NORMALIZATION_FAILED',
          message: 'PDF 归一化器不可用',
          warnings: [{ code: 'PDF_NORMALIZER_UNAVAILABLE', message: 'PDF 归一化器未配置' }],
        },
      }
    }

    if (this.#config.throwError) {
      return {
        ok: false,
        failure: {
          reason: 'NORMALIZATION_FAILED',
          message: 'PDF 归一化器抛异常',
          warnings: [{ code: 'MALFORMED_FILE', message: '模拟异常' }],
        },
      }
    }

    const totalPages = this.#config.totalPages ?? 3
    const failedSet = new Set(this.#config.failedPages ?? [])
    const skippedSet = new Set(this.#config.skippedPages ?? [])
    const prefix = this.#config.dataUrlPrefix ?? 'data:image/png;base64,FAKE_'
    const mime = this.#config.mimeType ?? 'image/png'

    const pages: OcrNormalizedPage[] = []
    const skippedPages = skippedSet.size
    const warnings: OcrDocumentWarning[] = []
    let failedCount = 0

    for (let i = 0; i < totalPages; i++) {
      if (skippedSet.has(i)) {
        warnings.push({
          code: 'PAGE_OVERFLOW',
          message: `第 ${i + 1} 页因 pageLimit 被跳过`,
          pageIndex: i,
        })
        continue
      }
      if (failedSet.has(i)) {
        warnings.push({
          code: 'NORMALIZATION_WARNING',
          message: `第 ${i + 1} 页渲染失败`,
          pageIndex: i,
        })
        failedCount++
        continue
      }
      pages.push({
        pageIndex: i,
        mimeType: mime as any,
        dataUrl: `${prefix}PAGE_${i}`,
        sizeBytes: 45000,
        widthPixels: 800,
        heightPixels: 1200,
      })
    }

    const result: OcrNormalizationResult = {
      pages,
      totalPages,
      skippedPages: skippedPages + failedCount,
      warnings,
    }

    return { ok: true, result }
  }
}
