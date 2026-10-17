/**
 * 需求附件读取（2026-09-28）：把用户上传的 Word / PDF / 文本 / 图片变成需求原文。
 *
 * - 文本（txt / md / csv / json）：按 UTF-8 读，读不通再按 GB18030（Windows 记事本常见）；
 * - Word（.docx）：mammoth 取纯文本；老的 .doc 不支持，提示另存为 .docx；
 * - PDF：pdfjs 逐页取文字；几乎取不到文字（扫描件）时把页面渲染成图片走识别；
 * - 图片：走识别。
 *
 * 识别的顺序：组织里标了 OCR 能力的模型 → 当前选的模型（若支持看图）→ 组织里任一支持看图的模型
 * （能力来自模型目录，即 models.dev）。都没有就明确告诉用户，不猜。
 * 读出来的文字只返回给前端放进输入框，用户看过、可改，再照常提交——这里不落库。
 */
import { writeFile, unlink, mkdtemp, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_NORMALIZER_OPTIONS,
  type PdfNormalizerAdapterContract,
} from '#services/ai_ocr/ocr_document_input_normalizer'
import PortablePdfNormalizerAdapter from '#services/ai_ocr/portable_pdf_normalizer_adapter'
import { REQUIREMENT_INPUT_MAX_CHARS } from './requirement_brief_service.js'

export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024
/** 单张图片交给识别的上限（与 OCR 预览一致）；前端会先压缩到这个以内。 */
export const ATTACHMENT_IMAGE_MAX_BYTES = 2 * 1024 * 1024
/** 扫描件最多识别的页数（每页一次模型调用）。 */
export const ATTACHMENT_OCR_MAX_PAGES = 10
/** 平均每页少于这么多字就当扫描件。 */
const SCANNED_CHARS_PER_PAGE = 30

export type AttachmentKind = 'text' | 'docx' | 'pdf' | 'image'
export type AttachmentMethod = 'text' | 'docx' | 'pdf_text' | 'ocr'

export interface AttachmentExtraction {
  fileName: string
  kind: AttachmentKind
  method: AttachmentMethod
  text: string
  chars: number
  pages: number | null
  /** 识别用的模型（只有 method = ocr 时有）。 */
  ocrModel: string | null
  warnings: string[]
}

/** 看图识字的一个候选：给一张图，返回文字；失败抛错。 */
export interface OcrCandidate {
  model: string
  recognize: (imageDataUrl: string) => Promise<string>
}

export class AttachmentError extends Error {
  constructor(
    message: string,
    readonly code: 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'EMPTY' | 'NO_OCR_MODEL' | 'READ_FAILED',
  ) {
    super(message)
  }
}

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log'])
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export function attachmentKind(fileName: string): AttachmentKind | null {
  const ext = extensionOf(fileName)
  if (TEXT_EXT.has(ext)) return 'text'
  if (ext === 'docx') return 'docx'
  if (ext === 'pdf') return 'pdf'
  if (ext in IMAGE_MIME) return 'image'
  return null
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase()
}

/** 先按 UTF-8 严格解码，失败再按 GB18030（兼容 GBK / GB2312）。 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}

/** 收拾空白：去掉行尾空格、连续三个以上空行压成一个。 */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u3000]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default class RequirementAttachmentService {
  constructor(
    private readonly pdfRenderer: PdfNormalizerAdapterContract = new PortablePdfNormalizerAdapter(),
  ) {}

  async extract(input: {
    fileName: string
    bytes: Uint8Array
    /** 按需才解析识别模型（纯文本 / Word 不需要，免得白查一次模型配置）。 */
    ocrCandidates: () => Promise<OcrCandidate[]>
  }): Promise<AttachmentExtraction> {
    const kind = attachmentKind(input.fileName)
    if (!kind) {
      const ext = extensionOf(input.fileName)
      throw new AttachmentError(
        ext === 'doc'
          ? '暂不支持旧版 .doc，请在 Word 里另存为 .docx 再上传'
          : '暂只支持 Word（.docx）、PDF、文本（txt / md / csv）和图片（png / jpg / webp）',
        'UNSUPPORTED_TYPE',
      )
    }
    if (input.bytes.byteLength === 0) throw new AttachmentError('文件是空的', 'EMPTY')
    if (input.bytes.byteLength > ATTACHMENT_MAX_BYTES) {
      throw new AttachmentError('文件超过 15 MB，请拆小或只上传需要的部分', 'TOO_LARGE')
    }
    const warnings: string[] = []
    let method: AttachmentMethod
    let text: string
    let pages: number | null = null
    let ocrModel: string | null = null

    if (kind === 'text') {
      method = 'text'
      text = decodeText(input.bytes)
    } else if (kind === 'docx') {
      method = 'docx'
      text = await this.readDocx(input.bytes)
    } else if (kind === 'pdf') {
      const pdf = await this.readPdfText(input.bytes)
      pages = pdf.pages
      const meaningful = pdf.text.replace(/\s/g, '').length
      if (pdf.pages > 0 && meaningful / pdf.pages >= SCANNED_CHARS_PER_PAGE) {
        method = 'pdf_text'
        text = pdf.text
      } else {
        method = 'ocr'
        const recognized = await this.ocrPdf(input, pdf.pages, warnings)
        text = recognized.text
        ocrModel = recognized.model
      }
    } else {
      method = 'ocr'
      if (input.bytes.byteLength > ATTACHMENT_IMAGE_MAX_BYTES) {
        throw new AttachmentError('图片超过 2 MB，请压缩或截取需要的部分', 'TOO_LARGE')
      }
      const mime = IMAGE_MIME[extensionOf(input.fileName)]!
      const dataUrl = `data:${mime};base64,${Buffer.from(input.bytes).toString('base64')}`
      const recognized = await this.recognize(await input.ocrCandidates(), [dataUrl], warnings)
      text = recognized.text
      ocrModel = recognized.model
    }

    text = tidyText(text)
    if (!text) {
      throw new AttachmentError(
        method === 'ocr' ? '没有从图片里识别出文字' : '这个文件里没有读到文字',
        'EMPTY',
      )
    }
    if (text.length > REQUIREMENT_INPUT_MAX_CHARS) {
      warnings.push(`文件有 ${text.length.toLocaleString()} 字，超过 5 万字上限，只取了前 5 万字`)
      text = text.slice(0, REQUIREMENT_INPUT_MAX_CHARS)
    }
    return {
      fileName: input.fileName,
      kind,
      method,
      text,
      chars: text.length,
      pages,
      ocrModel,
      warnings,
    }
  }

  private async readDocx(bytes: Uint8Array): Promise<string> {
    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
      return result.value
    } catch {
      throw new AttachmentError('Word 文件读取失败，可能已损坏或加密', 'READ_FAILED')
    }
  }

  private async readPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const pdf = await pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useWorkerFetch: false,
        useSystemFonts: true,
      }).promise
      const parts: string[] = []
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index)
        const content = await page.getTextContent()
        let line = ''
        for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
          line += item.str ?? ''
          if (item.hasEOL) line += '\n'
        }
        parts.push(line)
      }
      pdf.cleanup()
      return { text: parts.join('\n\n'), pages: pdf.numPages }
    } catch (error) {
      const encrypted = error instanceof Error && /password/i.test(error.message)
      throw new AttachmentError(
        encrypted ? 'PDF 设了密码，请先解除密码再上传' : 'PDF 读取失败，可能已损坏',
        'READ_FAILED',
      )
    }
  }

  /** 扫描件：把前几页渲染成图片逐页识别。 */
  private async ocrPdf(
    input: { fileName: string; bytes: Uint8Array; ocrCandidates: () => Promise<OcrCandidate[]> },
    pageCount: number,
    warnings: string[],
  ): Promise<{ text: string; model: string }> {
    const candidates = await input.ocrCandidates()
    if (candidates.length === 0) throw noOcrModel('这个 PDF 是扫描件（没有文字层）')
    const dir = await mkdtemp(join(tmpdir(), 'aiproj-attach-'))
    const file = join(dir, 'input.pdf')
    try {
      await writeFile(file, input.bytes)
      const rendered = await this.pdfRenderer.rasterize(file, input.fileName, {
        ...DEFAULT_NORMALIZER_OPTIONS,
        maxFileBytes: ATTACHMENT_MAX_BYTES,
      })
      if (!rendered.ok) {
        throw new AttachmentError(
          `这个 PDF 是扫描件，但页面转图片失败：${rendered.failure.message}`,
          'READ_FAILED',
        )
      }
      const images = rendered.result.pages.slice(0, ATTACHMENT_OCR_MAX_PAGES)
      if (images.length === 0) {
        throw new AttachmentError('这个 PDF 是扫描件，但页面转图片失败', 'READ_FAILED')
      }
      if (pageCount > ATTACHMENT_OCR_MAX_PAGES) {
        warnings.push(
          `扫描件共 ${pageCount} 页，只识别了前 ${ATTACHMENT_OCR_MAX_PAGES} 页；其余请分批上传或直接粘贴文字`,
        )
      }
      return await this.recognize(
        candidates,
        images.map((page) => page.dataUrl),
        warnings,
      )
    } finally {
      await unlink(file).catch(() => {})
      await rmdir(dir).catch(() => {})
    }
  }

  /** 逐个候选模型试：第一张图就失败的换下一个；中途某页失败只记提醒。 */
  private async recognize(
    candidates: OcrCandidate[],
    images: string[],
    warnings: string[],
  ): Promise<{ text: string; model: string }> {
    if (candidates.length === 0) throw noOcrModel('图片需要识别文字')
    let lastError: unknown = null
    for (const candidate of candidates) {
      const texts: string[] = []
      try {
        texts.push(await candidate.recognize(images[0]!))
      } catch (error) {
        lastError = error
        continue
      }
      for (let index = 1; index < images.length; index++) {
        try {
          texts.push(await candidate.recognize(images[index]!))
        } catch {
          warnings.push(`第 ${index + 1} 页识别失败，已跳过`)
        }
      }
      return { text: texts.join('\n\n'), model: candidate.model }
    }
    const reason = lastError instanceof Error ? `（${lastError.message.slice(0, 120)}）` : ''
    throw new AttachmentError(`识别文字失败${reason}，请稍后重试或直接粘贴文字`, 'READ_FAILED')
  }
}

function noOcrModel(what: string): AttachmentError {
  return new AttachmentError(
    `${what}，但组织里没有能识别图片文字的模型。请在「AI 设置」里接入带 OCR 或看图能力的模型，或把文字直接粘贴进来`,
    'NO_OCR_MODEL',
  )
}
