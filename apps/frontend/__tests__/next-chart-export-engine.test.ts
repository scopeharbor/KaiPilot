import { toBlob, toJpeg, toPng, toSvg } from 'html-to-image'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('html-to-image', () => ({
  toSvg: vi.fn(),
  toPng: vi.fn(),
  toJpeg: vi.fn(),
  toBlob: vi.fn(),
}))

vi.mock('@/components/ui/Toast', () => ({
  toast: vi.fn(),
}))

import { toast } from '@/components/ui/Toast'
import {
  MONO_FONT_STACK,
  SYSTEM_CN_FONT_STACK,
  buildExportFilename,
  copyBlobToClipboard,
  defaultExportFilter,
  exportNodeToBlob,
  exportNodeToJpeg,
  exportNodeToPng,
  exportNodeToSvg,
  sanitizeFilenamePart,
} from '@/lib/next/chart-export'

/** jsdom 未实现 Blob URL API：以 mock 桩替代并保留调用记录。 */
const urlMock = URL as unknown as {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}

const createObjectURLMock = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url')
const revokeObjectURLMock = vi.fn<(url: string) => void>()

let clickSpy: ReturnType<typeof vi.spyOn>

function makeElement(): HTMLElement {
  return document.createElement('div')
}

/** 冲刷引擎异步 revoke 调度（setTimeout 0）。 */
async function flushMacrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** 最近一次触发下载的 `<a download>` 元素。 */
function lastDownloadLink(): HTMLAnchorElement | undefined {
  const instance = clickSpy.mock.instances.at(-1) as HTMLAnchorElement | undefined
  return instance
}

/** 标准的 image/png Blob 测试样本。 */
function pngBlob(): Blob {
  return new Blob(['png'], { type: 'image/png' })
}

beforeEach(() => {
  vi.clearAllMocks()
  urlMock.createObjectURL = createObjectURLMock as unknown as typeof urlMock.createObjectURL
  urlMock.revokeObjectURL = revokeObjectURLMock as unknown as typeof urlMock.revokeObjectURL
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  vi.mocked(toPng).mockResolvedValue('data:image/png;base64,AAAA')
  vi.mocked(toJpeg).mockResolvedValue('data:image/jpeg;base64,AAAA')
  vi.mocked(toSvg).mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  vi.mocked(toBlob).mockResolvedValue(new Blob(['mock'], { type: 'image/png' }))
})

afterEach(() => {
  clickSpy.mockRestore()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('sanitizeFilenamePart（文件名字符安全清洗）', () => {
  it('剥离 OS 保留非法字符 \\ / : * ? " < > |', () => {
    expect(sanitizeFilenamePart('AI/ML: 推荐系统 (v2.0 *草案?)')).toBe('AIML 推荐系统 (v2.0 草案)')
  })

  it('剥离 ASCII 控制字符（0-31）', () => {
    expect(sanitizeFilenamePart('a\x00b\x1fc')).toBe('abc')
  })

  it('制表符/换行（控制字符）被剥离，连续空格归一化为单个空格', () => {
    // design §2 算法：控制字符（0-31，含 \t \n）先剥离，随后连续空白折叠为单空格。
    expect(sanitizeFilenamePart('智能  车载\t系统\n研发')).toBe('智能 车载系统研发')
  })

  it('简体中文 / 英文 / 数字 / 中英文括号原样保留', () => {
    expect(sanitizeFilenamePart('开项核心引擎 V3（Beta）(2nd)')).toBe(
      '开项核心引擎 V3（Beta）(2nd)',
    )
  })

  it('空字符串与空白字符串返回空串', () => {
    expect(sanitizeFilenamePart('')).toBe('')
    expect(sanitizeFilenamePart('   ')).toBe('')
  })
})

describe('buildExportFilename（规范化命名）', () => {
  const FIXED_NOW = new Date(2026, 8, 9, 15, 30, 0) // 2026-09-09 15:30:00 本地时区

  it('按 [实体]-[视图]-[YYYYMMDD]_[HHmmss] 规范生成（spec 场景 1）', () => {
    expect(buildExportFilename('开项核心引擎 V3', '看板工作面', 'png', FIXED_NOW)).toBe(
      '开项核心引擎 V3-看板工作面-20260909_153000.png',
    )
  })

  it('实体名含 OS 保留字符时被安全清洗（spec 场景 2）', () => {
    expect(
      buildExportFilename('AI/ML: 推荐系统 (v2.0 *草案?)', '看板工作面', 'svg', FIXED_NOW),
    ).toBe('AIML 推荐系统 (v2.0 草案)-看板工作面-20260909_153000.svg')
  })

  it('实体名为空时使用「开项导出」兜底（spec 场景 3）', () => {
    expect(buildExportFilename('', '看板工作面', 'png', FIXED_NOW)).toBe(
      '开项导出-看板工作面-20260909_153000.png',
    )
    expect(buildExportFilename(undefined, '反幻觉自检报告', 'jpg', FIXED_NOW)).toBe(
      '开项导出-反幻觉自检报告-20260909_153000.jpg',
    )
  })

  it('视图类型为空时兜底为「图表视图」', () => {
    expect(buildExportFilename('开项', '   ', 'png', FIXED_NOW)).toBe(
      '开项-图表视图-20260909_153000.png',
    )
  })

  it('扩展名规范化：剥离前导点并转小写', () => {
    expect(buildExportFilename('开项', '分享卡', '.PNG', FIXED_NOW)).toBe(
      '开项-分享卡-20260909_153000.png',
    )
  })

  it('默认时间戳精确到秒且格式为 YYYYMMDD_HHmmss', () => {
    const name = buildExportFilename('开项核心引擎 V3', '看板工作面', 'png')
    expect(name).toMatch(/^开项核心引擎 V3-看板工作面-\d{8}_\d{6}\.png$/)
  })
})

describe('exportNodeToPng（PNG 2x 超采样导出）', () => {
  it('传递 pixelRatio 2 / skipFonts true / cacheBust false / type image/png', async () => {
    const node = makeElement()
    await exportNodeToPng(node, { entityName: '开项核心引擎 V3', viewType: '看板工作面' })

    const options = vi.mocked(toPng).mock.calls[0]![1]!
    expect(options.pixelRatio).toBe(2)
    expect(options.skipFonts).toBe(true)
    expect(options.cacheBust).toBe(false)
    expect(options.type).toBe('image/png')
    expect(options.style?.fontFamily).toBe(SYSTEM_CN_FONT_STACK)
  })

  it('触发本地下载：Object URL 创建、锚点文件名规范、异步 revoke 释放', async () => {
    await exportNodeToPng(makeElement(), {
      entityName: '智能车载系统研发',
      viewType: '分享卡',
    })
    await flushMacrotasks()

    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    const blob = createObjectURLMock.mock.calls[0]![0] as Blob
    expect(blob.type).toBe('image/png')
    expect(lastDownloadLink()?.download).toMatch(/^智能车载系统研发-分享卡-\d{8}_\d{6}\.png$/)
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url')
  })

  it('支持显式 filename（不含扩展名）', async () => {
    await exportNodeToPng(makeElement(), { filename: '我的图表' })
    expect(lastDownloadLink()?.download).toBe('我的图表.png')
  })

  it('异常时向上抛出（由调用方 Toast 容错）', async () => {
    // 注：本仓库 vitest 2.1.9 的 rejects.toThrow 有缺陷（TypeError indexOf），
    // 统一改用 rejects.toMatchObject 断言错误消息。
    vi.mocked(toPng).mockImplementation(() => Promise.reject(new Error('render timeout')))
    await expect(exportNodeToPng(makeElement(), { entityName: '开项' })).rejects.toMatchObject({
      message: 'render timeout',
    })
  })
})

describe('exportNodeToJpeg（JPG 白底垫底导出）', () => {
  it('强制 backgroundColor #ffffff 并传递 2x 超采样', async () => {
    await exportNodeToJpeg(makeElement(), { entityName: '开项' })

    const options = vi.mocked(toJpeg).mock.calls[0]![1]!
    expect(options.backgroundColor).toBe('#ffffff')
    expect(options.type).toBe('image/jpeg')
    expect(options.pixelRatio).toBe(2)
    expect(options.skipFonts).toBe(true)
    expect(options.cacheBust).toBe(false)
  })

  it('JPG 无法垫白时按用户指定背景色填充', async () => {
    await exportNodeToJpeg(makeElement(), { entityName: '开项', backgroundColor: '#0a0b0d' })
    const options = vi.mocked(toJpeg).mock.calls[0]![1]!
    expect(options.backgroundColor).toBe('#0a0b0d')
  })

  it('触发 .jpg 下载且文件名后缀正确', async () => {
    await exportNodeToJpeg(makeElement(), {
      entityName: '智能车载系统研发',
      viewType: '看板工作面',
    })
    expect(lastDownloadLink()?.download).toMatch(/看板工作面-\d{8}_\d{6}\.jpg$/)
    const blob = createObjectURLMock.mock.calls[0]![0] as Blob
    expect(blob.type).toBe('image/jpeg')
  })
})

describe('exportNodeToSvg（纯净矢量导出）', () => {
  it('传递零网络配置并返回 SVG 字符串', async () => {
    const node = makeElement()
    const svg = await exportNodeToSvg(node, { entityName: '开项', viewType: '图表' })

    expect(svg).toContain('<svg')
    const options = vi.mocked(toSvg).mock.calls[0]![1]!
    expect(options.skipFonts).toBe(true)
    expect(options.cacheBust).toBe(false)
    expect(options.pixelRatio).toBeUndefined()
  })

  it('以 image/svg+xml Blob 触发 .svg 下载', async () => {
    await exportNodeToSvg(makeElement(), { entityName: '智能车载系统研发', viewType: '看板工作面' })
    const blob = createObjectURLMock.mock.calls[0]![0] as Blob
    expect(blob.type).toBe('image/svg+xml')
    expect(lastDownloadLink()?.download).toMatch(/\.svg$/)
  })
})

describe('exportNodeToBlob（底层 Blob 导出）', () => {
  it('svg 格式经 toSvg 序列化为 image/svg+xml Blob', async () => {
    const node = makeElement()
    const blob = await exportNodeToBlob(node, 'svg')
    expect(blob.type).toBe('image/svg+xml')
    expect(toSvg).toHaveBeenCalledTimes(1)
  })

  it('png 格式经 toBlob 2x 超采样', async () => {
    await exportNodeToBlob(makeElement(), 'png', { entityName: '开项' })
    const options = vi.mocked(toBlob).mock.calls[0]![1]!
    expect(options.type).toBe('image/png')
    expect(options.pixelRatio).toBe(2)
    expect(options.cacheBust).toBe(false)
  })

  it('jpeg 格式经 toBlob 强制纯白垫底', async () => {
    const blob = await exportNodeToBlob(makeElement(), 'jpeg')
    const options = vi.mocked(toBlob).mock.calls[0]![1]!
    expect(options.type).toBe('image/jpeg')
    expect(options.backgroundColor).toBe('#ffffff')
    expect(blob.type).toBe('image/png') // mock 出口原样返回
  })

  it('toBlob 返回 null 时抛出友好错误', async () => {
    vi.mocked(toBlob).mockImplementation(() => Promise.resolve(null))
    await expect(exportNodeToBlob(makeElement(), 'png')).rejects.toMatchObject({
      message: expect.stringContaining('图表渲染失败'),
    })
  })
})

describe('defaultExportFilter 与过滤器组合（DOM 噪点剥离）', () => {
  it('剥离 data-export-ignore="true" 节点', () => {
    const el = makeElement()
    el.setAttribute('data-export-ignore', 'true')
    expect(defaultExportFilter(el)).toBe(false)
  })

  it('剥离 .export-ignore 类节点', () => {
    const el = makeElement()
    el.classList.add('export-ignore')
    expect(defaultExportFilter(el)).toBe(false)
  })

  it('剥离 role="tooltip" 悬浮层', () => {
    const el = makeElement()
    el.setAttribute('role', 'tooltip')
    expect(defaultExportFilter(el)).toBe(false)
  })

  it('普通元素与文本节点放行', () => {
    expect(defaultExportFilter(makeElement())).toBe(true)
    expect(defaultExportFilter(document.createTextNode('x'))).toBe(true)
  })

  it('引擎透传的 filter 同时应用默认规则与用户自定义规则', async () => {
    const secret = makeElement()
    secret.classList.add('secret')
    const ignored = makeElement()
    ignored.setAttribute('data-export-ignore', 'true')
    const plain = makeElement()

    await exportNodeToPng(makeElement(), {
      entityName: '开项',
      filter: (node) => !node.classList.contains('secret'),
    })
    const options = vi.mocked(toPng).mock.calls[0]![1]!
    const filter = options.filter!
    expect(filter(secret)).toBe(false) // 用户规则
    expect(filter(ignored)).toBe(false) // 默认规则叠加
    expect(filter(plain)).toBe(true)
  })
})

describe('copyBlobToClipboard（剪贴板写入与平滑降级）', () => {
  function installClipboardSupport(writeImpl: () => Promise<void>) {
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: class ClipboardItemMock {
        items: Record<string, Blob>
        constructor(items: Record<string, Blob>) {
          this.items = items
        }
      },
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: vi.fn(writeImpl) },
    })
  }

  function removeClipboardSupport() {
    delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem
    delete (navigator as { clipboard?: unknown }).clipboard
  }

  it('支持环境写入成功返回 copied 并弹出成功 Toast', async () => {
    installClipboardSupport(() => Promise.resolve())
    const result = await copyBlobToClipboard(pngBlob(), '开项-分享卡.png')

    expect(result).toBe('copied')
    const write = (navigator.clipboard as { write: unknown }).write as ReturnType<typeof vi.fn>
    expect(write).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '分享卡已复制到剪贴板' }))
    expect(createObjectURLMock).not.toHaveBeenCalled()
  })

  it('写入内容为 image/png ClipboardItem', async () => {
    installClipboardSupport(() => Promise.resolve())
    await copyBlobToClipboard(pngBlob())
    const write = (navigator.clipboard as { write: unknown }).write as ReturnType<typeof vi.fn>
    const item = write.mock.calls[0]![0]![0] as { items: Record<string, Blob> }
    expect(item.items['image/png']).toBeInstanceOf(Blob)
  })

  it('环境不支持 ClipboardItem 时降级下载 + 降级 Toast', async () => {
    removeClipboardSupport()
    const result = await copyBlobToClipboard(pngBlob(), '开项-分享卡.png')

    expect(result).toBe('downloaded')
    expect(lastDownloadLink()?.download).toBe('开项-分享卡.png')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '浏览器不支持复制图片' }))
  })

  it('缺少 navigator.clipboard.write 时降级下载', async () => {
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: class ClipboardItemMock {},
    })
    delete (navigator as { clipboard?: unknown }).clipboard

    const result = await copyBlobToClipboard(pngBlob())
    expect(result).toBe('downloaded')
    expect(lastDownloadLink()?.download).toMatch(/^开项导出-分享卡-\d{8}_\d{6}\.png$/)
  })

  it('权限拒绝（NotAllowedError）时降级下载 + 降级 Toast', async () => {
    installClipboardSupport(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    const result = await copyBlobToClipboard(pngBlob(), '开项-分享卡.png')

    expect(result).toBe('downloaded')
    expect(lastDownloadLink()?.download).toBe('开项-分享卡.png')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '剪贴板权限受限' }))
  })
})

describe('零网络请求红线（RL-01 回归防线）', () => {
  it('全程导出链路 fetch / XMLHttpRequest 调用次数严格为 0', async () => {
    const fetchSpy = vi.fn()
    const xhrSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('XMLHttpRequest', xhrSpy)

    const node = makeElement()
    await exportNodeToPng(node, { entityName: '开项' })
    await exportNodeToJpeg(node, { entityName: '开项' })
    await exportNodeToSvg(node, { entityName: '开项' })
    await exportNodeToBlob(node, 'png')
    await copyBlobToClipboard(pngBlob(), '开项-分享卡.png')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
  })
})

describe('字体保真栈', () => {
  it('中文字体栈覆盖 macOS / Windows / Linux 系统字体', () => {
    expect(SYSTEM_CN_FONT_STACK).toContain('PingFang SC')
    expect(SYSTEM_CN_FONT_STACK).toContain('Microsoft YaHei')
    expect(SYSTEM_CN_FONT_STACK).toContain('WenQuanYi Micro Hei')
    expect(SYSTEM_CN_FONT_STACK).toContain('sans-serif')
  })

  it('等宽字体栈以 JetBrains Mono 领衔', () => {
    expect(MONO_FONT_STACK).toContain('JetBrains Mono')
    expect(MONO_FONT_STACK).toContain('ui-monospace')
  })
})
