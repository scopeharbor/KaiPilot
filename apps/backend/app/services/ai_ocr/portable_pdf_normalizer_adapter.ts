/**
 * v3-ocr-multipage-pdf-support §3 — 可移植 PDF 归一化适配器。
 *
 * 将有界 PDF 文件转换为 OcrNormalizedPage[] 格式（每页为 image/png dataUrl）。
 * 使用 pdfjs-dist（legacy 构建）+ @napi-rs/canvas 渲染，不依赖 Docker/OS 二进制文件/外部服务。
 *
 * 如果不能初始化（缺渲染器/系统不兼容），返回 PDF_NORMALIZER_UNAVAILABLE。
 */

import {
  type OcrDocumentWarning,
  type OcrDocumentProviderErrorKind,
  type OcrNormalizedPage,
  type OcrNormalizationResult,
  type OcrNormalizationFailure,
  type OcrNormalizationOutcome,
  OCR_DOCUMENT_MAX_PAGES,
  OCR_DOCUMENT_MAX_PAGE_BYTES,
} from '@aiproj/types'
import {
  type PdfNormalizerAdapterContract,
  type NormalizerOptions,
} from '#services/ai_ocr/ocr_document_input_normalizer'
import * as fs from 'node:fs'

// ---------------------------------------------------------------------------
// 辅助类型
// ---------------------------------------------------------------------------

interface PdfPageInfo {
  pageIndex: number
  /** 原始 PDF 中声明的 MediaBox 宽度 pts */
  widthPts: number
  /** 原始 PDF 中声明的 MediaBox 高度 pts */
  heightPts: number
}

interface RenderingResult {
  dataUrl: string
  sizeBytes: number
  widthPixels: number
  heightPixels: number
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** PDF 渲染分辨率 (px/pt)。72 对应 1:1, 144 对应 2x。 */
const RENDER_SCALE = 1.5
/** 最大 PDF 文件字节数 (与 OCR 全局配置保持一致)。 */
const MAX_PDF_BYTES = OCR_DOCUMENT_MAX_PAGE_BYTES * OCR_DOCUMENT_MAX_PAGES

// ---------------------------------------------------------------------------
// Node 渲染环境
// ---------------------------------------------------------------------------

/**
 * pdfjs 在 Node 里默认找 `canvas`（node-canvas）包并依赖浏览器的 DOMMatrix / Path2D；
 * 本项目装的是 @napi-rs/canvas，不补这两样就会「Cannot read properties of undefined
 * (reading 'createCanvas')」、页面渲染失败被跳过（2026-09-28 实测扫描件整份读不出来）。
 */
async function napiCanvasFactory() {
  const napi = await import('@napi-rs/canvas')
  const g = globalThis as Record<string, unknown>
  g.DOMMatrix ??= napi.DOMMatrix
  g.Path2D ??= napi.Path2D
  g.ImageData ??= napi.ImageData
  return {
    create(width: number, height: number) {
      const canvas = napi.createCanvas(width, height)
      return { canvas, context: canvas.getContext('2d') }
    },
    reset(entry: { canvas: any }, width: number, height: number) {
      entry.canvas.width = width
      entry.canvas.height = height
    },
    destroy(entry: { canvas: any; context: any }) {
      entry.canvas.width = 0
      entry.canvas.height = 0
      entry.canvas = null
      entry.context = null
    },
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export default class PortablePdfNormalizerAdapter implements PdfNormalizerAdapterContract {
  /** 标记 adapter 是否可用。 */
  #available: boolean | null = null

  /**
   * 惰性初始化：检测 pdfjs-dist + canvas 环境是否可用。
   * 只在第一次 rasterize 调用时执行；抛出或被缺依赖时标记 unavailable。
   */
  async ensureAvailable(): Promise<boolean> {
    if (this.#available !== null) return this.#available

    // 检查 pdfjs-dist legacy build 是否可加载
    try {
      await import('pdfjs-dist/legacy/build/pdf.mjs')
    } catch {
      this.#available = false
      return false
    }

    // 检查 @napi-rs/canvas
    try {
      await import('@napi-rs/canvas')
    } catch {
      this.#available = false
      return false
    }

    this.#available = true
    return true
  }

  /**
   * 将有界 PDF 文件按页渲染为 image/png data URL。
   */
  async rasterize(
    filePath: string,
    fileName: string,
    opts: NormalizerOptions,
  ): Promise<OcrNormalizationOutcome> {
    // 前置检查：文件可读
    const pdfBuf = await this.#readFile(filePath).catch(() => null)
    if (!pdfBuf) {
      return this.#fail('NORMALIZATION_FAILED', `PDF 文件不存在或无法读取: ${fileName}`, [
        { code: 'MALFORMED_FILE', message: `无法读取: ${fileName}` },
      ])
    }

    // 文件大小检查
    if (pdfBuf.byteLength > MAX_PDF_BYTES) {
      return this.#fail('NORMALIZATION_FAILED', 'PDF 文件过大', [
        {
          code: 'PAYLOAD_OVERSIZE',
          message: `PDF ${pdfBuf.byteLength} bytes 超过限制 ${MAX_PDF_BYTES} bytes`,
        },
      ])
    }

    // 检查 adapter 可用性
    const available = await this.ensureAvailable()
    if (!available) {
      return this.#fail('NORMALIZATION_FAILED', 'PDF 归一化器不可用', [
        { code: 'PDF_NORMALIZER_UNAVAILABLE', message: 'PDF 渲染器无法初始化' },
      ])
    }

    try {
      return await this.#rasterizeInternal(pdfBuf, opts)
    } catch (err: any) {
      return this.#fail('NORMALIZATION_FAILED', 'PDF 归一化失败', [
        { code: 'MALFORMED_FILE', message: err.message ?? String(err) },
      ])
    }
  }

  async #rasterizeInternal(
    pdfBuf: ArrayBuffer,
    opts: NormalizerOptions,
  ): Promise<OcrNormalizationOutcome> {
    const canvasFactory = await napiCanvasFactory()
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const createCanvas = (width: number, height: number) =>
      canvasFactory.create(width, height).canvas

    // 配置 pdfjs worker（禁用 worker 以简化，使用 fake worker）
    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuf),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: false,
      canvasFactory,
    } as Parameters<typeof pdfjsLib.getDocument>[0]).promise

    const totalPages = pdf.numPages

    // 页面溢出检查
    if (totalPages > opts.maxPages) {
      return this.#fail(
        'NORMALIZATION_FAILED',
        `PDF 页面数 ${totalPages} 超过上限 ${opts.maxPages}`,
        [
          {
            code: 'PAGE_OVERFLOW',
            message: `PDF 共 ${totalPages} 页，超过系统上限 ${opts.maxPages}`,
          },
        ],
      )
    }

    // 检测加密（通过 isEncrypted 或 metadata.encrypted）
    const isEncrypted = this.#checkEncrypted(pdf)
    if (isEncrypted) {
      return this.#fail('NORMALIZATION_FAILED', 'PDF 已加密，无法处理', [
        { code: 'MALFORMED_FILE', message: 'PDF 已加密' },
      ])
    }

    const pageInfos: PdfPageInfo[] = []
    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 1.0 })
      pageInfos.push({
        pageIndex: i - 1,
        widthPts: viewport.width,
        heightPts: viewport.height,
      })
    }

    const pages: OcrNormalizedPage[] = []
    const warnings: OcrDocumentWarning[] = []

    for (const pageInfo of pageInfos) {
      const renderingResult = await this.#renderPage({
        pdf,
        _pdfjsLib: pdfjsLib,
        createCanvas,
        pageIndex: pageInfo.pageIndex,
        _widthPts: pageInfo.widthPts,
        _heightPts: pageInfo.heightPts,
        opts,
      })

      if (!renderingResult) {
        warnings.push({
          code: 'NORMALIZATION_WARNING',
          message: `第 ${pageInfo.pageIndex + 1} 页渲染失败，已跳过`,
          pageIndex: pageInfo.pageIndex,
        })
        continue
      }

      pages.push({
        pageIndex: pageInfo.pageIndex,
        mimeType: 'image/png',
        dataUrl: renderingResult.dataUrl,
        sizeBytes: renderingResult.sizeBytes,
        widthPixels: renderingResult.widthPixels,
        heightPixels: renderingResult.heightPixels,
      })
    }

    const result: OcrNormalizationResult = {
      pages,
      totalPages,
      skippedPages: totalPages - pages.length,
      warnings,
    }

    return { ok: true, result }
  }

  async #renderPage(params: {
    pdf: any
    _pdfjsLib: any
    createCanvas: any
    pageIndex: number
    _widthPts: number
    _heightPts: number
    opts: NormalizerOptions
  }): Promise<RenderingResult | null> {
    const { pdf, createCanvas, pageIndex, opts } = params

    try {
      const page = await pdf.getPage(pageIndex + 1)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const width = Math.round(viewport.width)
      const height = Math.round(viewport.height)

      // 尺寸检查
      const pixels = width * height
      if (pixels > opts.maxPagePixels) {
        return null
      }

      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')

      // 白底
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)

      // 渲染 PDF 页面到 canvas
      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise

      // 导出为 PNG base64 data URL
      const pngBuffer = canvas.toBuffer('image/png')

      // 💰 内存检查：每个 page image 不超过 maxPageBytes
      if (pngBuffer.byteLength > opts.maxPageBytes) {
        return null
      }

      const b64 = pngBuffer.toString('base64')
      const dataUrl = `data:image/png;base64,${b64}`

      return {
        dataUrl,
        sizeBytes: pngBuffer.byteLength,
        widthPixels: width,
        heightPixels: height,
      }
    } catch {
      return null
    }
  }

  // -----------------------------------------------------------------------
  // 工具
  // -----------------------------------------------------------------------

  #checkEncrypted(_pdf: any): boolean {
    // pdfjs-dist 在检测到加密 PDF 时会抛异常而不是暴露属性，
    // 因此我们在一开始加载 PDF 时捕获异常即可。
    // 这里默认返回 false；加密文件在 getDocument 阶段已失败。
    return false
  }

  async #readFile(filePath: string): Promise<ArrayBuffer> {
    const buf = fs.readFileSync(filePath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }

  #fail(
    reason: OcrDocumentProviderErrorKind,
    message: string,
    warnings: OcrDocumentWarning[],
  ): OcrNormalizationOutcome {
    const failure: OcrNormalizationFailure = { reason, message, warnings }
    return { ok: false, failure }
  }
}
