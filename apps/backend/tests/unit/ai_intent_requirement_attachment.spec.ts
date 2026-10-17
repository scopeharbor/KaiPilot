import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import RequirementAttachmentService, {
  AttachmentError,
  attachmentKind,
  decodeText,
  tidyText,
  type OcrCandidate,
} from '#services/ai_intent/requirement_attachment_service'
import type { PdfNormalizerAdapterContract } from '#services/ai_ocr/ocr_document_input_normalizer'

const noOcr = async (): Promise<OcrCandidate[]> => []
const fakeOcr =
  (text: string, calls: string[] = []) =>
  async (): Promise<OcrCandidate[]> => [
    {
      model: 'vision-model',
      recognize: async (image) => {
        calls.push(image)
        return text
      },
    },
  ]

async function pdfWith(lines: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const pageLines of lines) {
    const page = doc.addPage([400, 400])
    pageLines.forEach((line, index) =>
      page.drawText(line, { x: 20, y: 360 - index * 20, size: 12, font }),
    )
  }
  return doc.save()
}

const renderer = (pages: number): PdfNormalizerAdapterContract => ({
  rasterize: async () => ({
    ok: true,
    result: {
      pages: Array.from({ length: pages }, (_, pageIndex) => ({
        pageIndex,
        mimeType: 'image/png' as const,
        dataUrl: `data:image/png;base64,page${pageIndex}`,
        sizeBytes: 10,
      })),
      totalPages: pages,
      skippedPages: 0,
      warnings: [],
    },
  }),
})

describe('需求附件读取', () => {
  it('按扩展名分类；旧 .doc 与其它格式明确拒绝', async () => {
    expect(attachmentKind('需求.DOCX')).toBe('docx')
    expect(attachmentKind('a.md')).toBe('text')
    expect(attachmentKind('scan.jpeg')).toBe('image')
    expect(attachmentKind('a.xlsx')).toBeNull()
    const service = new RequirementAttachmentService()
    await expect(
      service.extract({ fileName: '旧.doc', bytes: new Uint8Array([1]), ocrCandidates: noOcr }),
    ).rejects.toThrow(/另存为 \.docx/)
  })

  it('文本：UTF-8（含 BOM）与 GBK 都能读', () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('报名小程序')])
    expect(decodeText(utf8)).toBe('报名小程序')
    // 「需求」的 GBK 编码
    expect(decodeText(new Uint8Array([0xd0, 0xe8, 0xc7, 0xf3]))).toBe('需求')
    expect(tidyText('a  \r\n\r\n\r\n\r\nb')).toBe('a\n\nb')
  })

  it('有文字层的 PDF 直接取文字，不调用识别', async () => {
    const bytes = await pdfWith([
      ['Volunteer sign-up mini program', 'Points exchange for residents'],
      ['Check-in by QR code at the event site', 'Admin console for community staff'],
    ])
    const service = new RequirementAttachmentService(renderer(2))
    const result = await service.extract({ fileName: 'req.pdf', bytes, ocrCandidates: noOcr })
    expect(result.method).toBe('pdf_text')
    expect(result.pages).toBe(2)
    expect(result.text).toContain('Volunteer sign-up mini program')
    expect(result.text).toContain('Check-in by QR code')
  })

  it('扫描件 PDF：渲染成图片逐页识别，超过 10 页只识别前 10 页并提醒', async () => {
    const bytes = await pdfWith(Array.from({ length: 12 }, () => []))
    const calls: string[] = []
    const service = new RequirementAttachmentService(renderer(12))
    const result = await service.extract({
      fileName: 'scan.pdf',
      bytes,
      ocrCandidates: fakeOcr('第一期上线报名功能', calls),
    })
    expect(result.method).toBe('ocr')
    expect(result.ocrModel).toBe('vision-model')
    expect(calls).toHaveLength(10)
    expect(result.warnings.join()).toContain('只识别了前 10 页')
  })

  it('图片：没有能识别的模型时明确告诉用户去配置', async () => {
    const service = new RequirementAttachmentService()
    const error = await service
      .extract({ fileName: 'a.png', bytes: new Uint8Array([1, 2, 3]), ocrCandidates: noOcr })
      .catch((e) => e)
    expect(error).toBeInstanceOf(AttachmentError)
    expect(error.code).toBe('NO_OCR_MODEL')
    expect(error.message).toContain('AI 设置')
  })

  it('图片：第一个模型失败就换下一个', async () => {
    const service = new RequirementAttachmentService()
    const result = await service.extract({
      fileName: 'a.png',
      bytes: new Uint8Array([1, 2, 3]),
      ocrCandidates: async () => [
        {
          model: 'broken',
          recognize: async () => {
            throw new Error('不支持图片')
          },
        },
        { model: 'ok', recognize: async () => '活动需要签到' },
      ],
    })
    expect(result.ocrModel).toBe('ok')
    expect(result.text).toBe('活动需要签到')
  })

  it('超过 5 万字截断并提醒', async () => {
    const service = new RequirementAttachmentService()
    const result = await service.extract({
      fileName: 'long.txt',
      bytes: new TextEncoder().encode('字'.repeat(50_010)),
      ocrCandidates: noOcr,
    })
    expect(result.chars).toBe(50_000)
    expect(result.warnings[0]).toContain('只取了前 5 万字')
  })
})
