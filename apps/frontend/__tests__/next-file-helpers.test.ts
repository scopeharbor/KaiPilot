/**
 * v3-ui-next-resource-team-domains W3 · tasks 3.2 —— 文件域工具函数单元测试
 * （MIME 映射 / 大小格式化 / 上传预检，纯函数零 DOM）。
 *
 * 覆盖（design §4.1 与 tasks 3.2）：
 * - 常见 MIME（application/pdf、docx、xlsx、csv、pptx、image/png、application/zip、
 *   json 等）正确映射到语义图标契约与主题色（PDF 红 #f87171 / Word 蓝 #60a5fa /
 *   Excel 翠绿 #4ade80 / PPT 橙 #fb923c / 图片紫 #c084fc / 压缩包琥珀 #fbbf24 /
 *   代码青 #22d3ee / 通用冷灰 #94a3b8）；
 * - MIME 缺失/未识别时按文件名后缀兜底；后缀也不识别回退通用冷灰；
 * - 文件大小单位换算（0 B、512 B、1024 B → 1.0 KB、1.5 MB、2.1 GB，一位小数）；
 * - 上传校验：0 字节拦截、9MB 放行、10MB 边界精确放行、11MB 拦截（消息含「10MB」）；
 *   扩展名白名单（pdf/md/txt/csv/docx/xlsx/pptx/png/jpg/jpeg/webp，对齐服务端契约，
 *   大小写不敏感）：白名单外与无扩展名文件阻断并列出支持格式；
 * - 大类 Tab 契约与 kind → category 收敛；上传时间格式化与非法输入占位。
 */
import { describe, expect, test } from 'vitest'
import {
  Archive,
  Code2,
  File,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Presentation,
} from 'lucide-react'
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  ALLOWED_UPLOAD_EXTENSIONS_LABEL,
  FILE_CATEGORY_TABS,
  MAX_FILE_SIZE_BYTES,
  fileKindCategoryOf,
  fileVisualOf,
  formatFileSize,
  formatFileTime,
  validateUploadFile,
} from '@/lib/next/files/file-helpers'

describe('fileVisualOf：MIME → 语义图标与主题色契约（design §4.1）', () => {
  test('PDF / Word / 表格 / PPT 精确匹配各自图标与色值', () => {
    const pdf = fileVisualOf('application/pdf', '方案.pdf')
    expect(pdf.kind).toBe('pdf')
    expect(pdf.icon).toBe(FileText)
    expect(pdf.color).toBe('#f87171')
    expect(pdf.label).toContain('PDF')

    const word = fileVisualOf(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '需求说明.docx',
    )
    expect(word.kind).toBe('word')
    expect(word.icon).toBe(FileText)
    expect(word.color).toBe('#60a5fa')

    const legacyWord = fileVisualOf('application/msword', '老版.doc')
    expect(legacyWord.kind).toBe('word')

    const excel = fileVisualOf(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '预算表.xlsx',
    )
    expect(excel.kind).toBe('sheet')
    expect(excel.icon).toBe(FileSpreadsheet)
    expect(excel.color).toBe('#4ade80')

    const csv = fileVisualOf('text/csv', '导出.csv')
    expect(csv.kind).toBe('sheet')
    expect(csv.color).toBe('#4ade80')

    const ppt = fileVisualOf(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '汇报.pptx',
    )
    expect(ppt.kind).toBe('slide')
    expect(ppt.icon).toBe(Presentation)
    expect(ppt.color).toBe('#fb923c')
  })

  test('图片 / 压缩包 / 代码 / 未知 MIME 大小写不敏感', () => {
    const png = fileVisualOf('image/png', '架构图.png')
    expect(png.kind).toBe('image')
    expect(png.icon).toBe(ImageIcon)
    expect(png.color).toBe('#c084fc')

    const svg = fileVisualOf('Image/SVG', '矢量图.svg')
    expect(svg.kind).toBe('image')

    const zip = fileVisualOf('application/zip', '材料.zip')
    expect(zip.kind).toBe('archive')
    expect(zip.icon).toBe(Archive)
    expect(zip.color).toBe('#fbbf24')

    const gzip = fileVisualOf('application/x-tar', '备份.tar')
    expect(gzip.kind).toBe('archive')

    const json = fileVisualOf('application/json', 'data.json')
    expect(json.kind).toBe('code')
    expect(json.icon).toBe(Code2)
    expect(json.color).toBe('#22d3ee')
  })

  test('MIME 缺失或未识别：后缀名兜底；两者皆无回退通用冷灰', () => {
    // MIME 缺失 → 后缀兜底
    expect(fileVisualOf(null, '周报.docx').kind).toBe('word')
    expect(fileVisualOf('', '架构图.png').kind).toBe('image')
    // 通用 application/octet-stream → 后缀兜底
    const octetZip = fileVisualOf('application/octet-stream', '压缩包.zip')
    expect(octetZip.kind).toBe('archive')
    // MIME 命中优先于后缀（不以文件名为准）
    const mimeWins = fileVisualOf('application/pdf', '其实是文本.txt')
    expect(mimeWins.kind).toBe('pdf')
    // 后缀也不识别（未知视频）→ 通用冷灰
    const generic = fileVisualOf('video/mp4', '录屏.mp4')
    expect(generic.kind).toBe('generic')
    expect(generic.icon).toBe(File)
    expect(generic.color).toBe('#94a3b8')
    // 完全无信息 → 通用冷灰
    expect(fileVisualOf(null, null).kind).toBe('generic')
    expect(fileVisualOf('weird/type', 'noext').kind).toBe('generic')
  })
})

describe('fileKindCategoryOf + FILE_CATEGORY_TABS：大类 Tab 收敛（全部/文档/表格/图片/压缩包）', () => {
  test('文档系（pdf/word/slide/code/generic）归并 document；其余按自身归类', () => {
    expect(fileKindCategoryOf('pdf')).toBe('document')
    expect(fileKindCategoryOf('word')).toBe('document')
    expect(fileKindCategoryOf('slide')).toBe('document')
    expect(fileKindCategoryOf('code')).toBe('document')
    expect(fileKindCategoryOf('generic')).toBe('document')
    expect(fileKindCategoryOf('sheet')).toBe('sheet')
    expect(fileKindCategoryOf('image')).toBe('image')
    expect(fileKindCategoryOf('archive')).toBe('archive')
  })

  test('Tab 白名单完整：全部/文档/表格/图片/压缩包', () => {
    expect(FILE_CATEGORY_TABS.map((tab) => tab.id)).toEqual([
      'all',
      'document',
      'sheet',
      'image',
      'archive',
    ])
    expect(FILE_CATEGORY_TABS.map((tab) => tab.label)).toEqual([
      '全部',
      '文档',
      '表格',
      '图片',
      '压缩包',
    ])
  })
})

describe('formatFileSize：可读大小单位换算（一位小数）', () => {
  test('B / KB / MB / GB 边界与典型值', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1023)).toBe('1023 B')
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(Math.round(1.5 * 1024 * 1024))).toBe('1.5 MB')
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB')
    expect(formatFileSize(2254857830)).toBe('2.1 GB')
  })

  test('非法输入（负数 / NaN）兜底 0 B', () => {
    expect(formatFileSize(-1)).toBe('0 B')
    expect(formatFileSize(Number.NaN)).toBe('0 B')
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe('0 B')
  })
})

describe('validateUploadFile：10MB 上限、扩展名白名单与空文件预检', () => {
  test('9MB 放行，10MB 边界精确放行，11MB 阻断并提示 10MB 限制', () => {
    const ok9 = validateUploadFile({ name: '周报.pdf', size: 9 * 1024 * 1024 })
    expect(ok9.ok).toBe(true)

    const okBoundary = validateUploadFile({ name: '周报.pdf', size: MAX_FILE_SIZE_BYTES })
    expect(okBoundary.ok).toBe(true)

    const tooLarge = validateUploadFile({ name: '视频.mp4', size: 11 * 1024 * 1024 })
    expect(tooLarge.ok).toBe(false)
    if (!tooLarge.ok) {
      expect(tooLarge.code).toBe('FILE_TOO_LARGE')
      expect(tooLarge.message).toContain('10MB')
    }
  })

  test('白名单扩展名放行（大小写不敏感），白名单外 / 无扩展名文件阻断并列出支持格式', () => {
    // 白名单全部扩展名逐个放行（小写；大小上限内）
    for (const ext of ALLOWED_UPLOAD_EXTENSIONS) {
      expect(validateUploadFile({ name: `sample.${ext}`, size: 1024 }).ok).toBe(true)
    }
    // 大小写不敏感：大写扩展名同样放行
    expect(validateUploadFile({ name: '架构图.PNG', size: 1024 }).ok).toBe(true)
    expect(validateUploadFile({ name: '需求说明.DOCX', size: 1024 }).ok).toBe(true)

    // 白名单外扩展名阻断：明确错误码 + 列出支持格式清单
    const blocked = validateUploadFile({ name: 'setup.exe', size: 2 * 1024 * 1024 })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.code).toBe('FILE_TYPE_NOT_ALLOWED')
      expect(blocked.message).toContain('不支持该文件格式')
      expect(blocked.message).toContain(ALLOWED_UPLOAD_EXTENSIONS_LABEL)
      expect(blocked.message).toContain('pdf')
      expect(blocked.message).toContain('webp')
    }

    // 无扩展名文件同样阻断
    const noExt = validateUploadFile({ name: 'README', size: 1024 })
    expect(noExt.ok).toBe(false)
    if (!noExt.ok) {
      expect(noExt.code).toBe('FILE_TYPE_NOT_ALLOWED')
    }
  })

  test('0 字节空文件拦截且错误码为 FILE_EMPTY', () => {
    const empty = validateUploadFile({ name: 'empty.txt', size: 0 })
    expect(empty.ok).toBe(false)
    if (!empty.ok) {
      expect(empty.code).toBe('FILE_EMPTY')
      expect(empty.message).toContain('空文件')
    }
  })
})

describe('formatFileTime：上传时间本地化格式化', () => {
  test('合法 ISO 输出 YYYY-MM-DD HH:mm（与本地 Date 字段逐项一致，含补零）', () => {
    const iso = '2026-09-09T06:30:05.000Z'
    const rendered = formatFileTime(iso)
    expect(rendered).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    const date = new Date(iso)
    const pad = (value: number) => String(value).padStart(2, '0')
    expect(rendered).toBe(
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    )
  })

  test('null / undefined / 非法字符串渲染占位符', () => {
    expect(formatFileTime(null)).toBe('—')
    expect(formatFileTime(undefined)).toBe('—')
    expect(formatFileTime('not-a-date')).toBe('—')
  })
})
