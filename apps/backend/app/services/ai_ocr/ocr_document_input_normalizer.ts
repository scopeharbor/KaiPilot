/**
 * OCR 文档输入归一化器接口与实现。
 *
 * 将有界上传/附件文件归一化为 provider-ready 页面图像 payload。
 * 镜像支持：PNG/JPEG/WebP 直接转换；PDF 按 adapter 处理（默认无安全
 * rasterizer 则返回 unsupported 失败，不发起 provider 调用）。
 */

import {
  OCR_DOCUMENT_MAX_FILE_BYTES,
  OCR_DOCUMENT_MAX_PAGES,
  OCR_DOCUMENT_MAX_PAGE_BYTES,
  isOcrDocumentSupportedMimeType,
  isOcrDocumentImageMimeType,
  type OcrSupportedImageMimeType,
  type OcrDocumentWarning,
  type OcrDocumentProviderErrorKind,
  type OcrNormalizedPage,
  type OcrNormalizationResult,
  type OcrNormalizationFailure,
  type OcrNormalizationOutcome,
} from '@aiproj/types'
import * as fs from 'node:fs'

// ---------------------------------------------------------------------------
// 导出类型
// ---------------------------------------------------------------------------

export interface NormalizerOptions {
  maxFileBytes: number
  maxPages: number
  maxPageBytes: number
  maxPagePixels: number
}

export const DEFAULT_NORMALIZER_OPTIONS: NormalizerOptions = {
  maxFileBytes: OCR_DOCUMENT_MAX_FILE_BYTES,
  maxPages: OCR_DOCUMENT_MAX_PAGES,
  maxPageBytes: OCR_DOCUMENT_MAX_PAGE_BYTES,
  maxPagePixels: 4096 * 4096,
}

// ---------------------------------------------------------------------------
// 接口
// ---------------------------------------------------------------------------

export interface OcrDocumentInputNormalizerContract {
  normalize(
    filePath: string,
    mimeType: string,
    fileName: string,
    options?: Partial<NormalizerOptions>,
  ): Promise<OcrNormalizationOutcome>
}

// ---------------------------------------------------------------------------
// 默认实现：图像直传 + PDF 安全拒绝 (no rasterizer)
// ---------------------------------------------------------------------------

export class OcrDocumentInputNormalizer implements OcrDocumentInputNormalizerContract {
  readonly #pdfAdapter: PdfNormalizerAdapterContract | null

  constructor(pdfAdapter: PdfNormalizerAdapterContract | null = null) {
    this.#pdfAdapter = pdfAdapter
  }

  async normalize(
    filePath: string,
    mimeType: string,
    fileName: string,
    options?: Partial<NormalizerOptions>,
  ): Promise<OcrNormalizationOutcome> {
    const opts: NormalizerOptions = { ...DEFAULT_NORMALIZER_OPTIONS, ...options }

    // MIME 白名单检查
    if (!isOcrDocumentSupportedMimeType(mimeType)) {
      return this.#fail('NORMALIZATION_FAILED', `不支持的文件类型: ${mimeType}`, [
        { code: 'UNSUPPORTED_MIME', message: `MIME 类型 ${mimeType} 不在支持列表中` },
      ])
    }

    // 文件存在性与大小检查
    try {
      const stat = fs.statSync(filePath)
      if (stat.size > opts.maxFileBytes) {
        return this.#fail('NORMALIZATION_FAILED', '文件大小超过上限', [
          {
            code: 'PAYLOAD_OVERSIZE',
            message: `文件 ${stat.size} bytes 超过限制 ${opts.maxFileBytes} bytes`,
          },
        ])
      }
    } catch {
      return this.#fail('NORMALIZATION_FAILED', '文件不存在或无法读取', [
        { code: 'MALFORMED_FILE', message: `无法读取文件: ${fileName}` },
      ])
    }

    // 图像文件直接编码
    if (isOcrDocumentImageMimeType(mimeType)) {
      return this.#normalizeImage(filePath, mimeType, opts)
    }

    // PDF 处理
    if (mimeType === 'application/pdf') {
      return this.#normalizePdf(filePath, fileName, opts)
    }

    return this.#fail('NORMALIZATION_FAILED', '无法归一化的文件类型', [
      { code: 'UNSUPPORTED_MIME', message: `不支持的 MIME: ${mimeType}` },
    ])
  }

  // -----------------------------------------------------------------------
  // 图像归一化
  // -----------------------------------------------------------------------

  async #normalizeImage(
    filePath: string,
    mimeType: string,
    opts: NormalizerOptions,
  ): Promise<OcrNormalizationOutcome> {
    try {
      const buf = fs.readFileSync(filePath)
      if (buf.length > opts.maxPageBytes) {
        return this.#fail('NORMALIZATION_FAILED', '图片文件过大', [
          { code: 'PAYLOAD_OVERSIZE', message: `图片 ${buf.length} bytes 超过限制` },
        ])
      }

      const b64 = buf.toString('base64')
      const dataUrl = `data:${mimeType};base64,${b64}`

      const page: OcrNormalizedPage = {
        pageIndex: 0,
        mimeType: mimeType as OcrSupportedImageMimeType,
        dataUrl,
        sizeBytes: buf.length,
        widthPixels: null,
        heightPixels: null,
      }

      const result: OcrNormalizationResult = {
        pages: [page],
        totalPages: 1,
        skippedPages: 0,
        warnings: [],
      }

      return { ok: true, result }
    } catch (err) {
      return this.#fail('NORMALIZATION_FAILED', '图片归一化失败', [
        { code: 'MALFORMED_FILE', message: String(err) },
      ])
    }
  }

  // -----------------------------------------------------------------------
  // PDF 归一化
  // -----------------------------------------------------------------------

  async #normalizePdf(
    filePath: string,
    fileName: string,
    opts: NormalizerOptions,
  ): Promise<OcrNormalizationOutcome> {
    if (!this.#pdfAdapter) {
      return this.#fail('NORMALIZATION_FAILED', 'PDF 归一化器不可用', [
        { code: 'PDF_NORMALIZER_UNAVAILABLE', message: 'PDF 归一化器未配置' },
      ])
    }

    try {
      return await this.#pdfAdapter.rasterize(filePath, fileName, opts)
    } catch (err) {
      return this.#fail('NORMALIZATION_FAILED', 'PDF 归一化失败', [
        { code: 'MALFORMED_FILE', message: String(err) },
      ])
    }
  }

  // -----------------------------------------------------------------------
  // 工具
  // -----------------------------------------------------------------------

  #fail(
    reason: OcrDocumentProviderErrorKind,
    message: string,
    warnings: OcrDocumentWarning[],
  ): OcrNormalizationOutcome {
    const failure: OcrNormalizationFailure = { reason, message, warnings }
    return { ok: false, failure }
  }
}

// ---------------------------------------------------------------------------
// PDF 归一化适配器接口
// ---------------------------------------------------------------------------

export interface PdfNormalizerAdapterContract {
  rasterize(
    filePath: string,
    fileName: string,
    opts: NormalizerOptions,
  ): Promise<OcrNormalizationOutcome>
}
