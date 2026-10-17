/**
 * v3-ui-next-chart-export W3（tasks 3.2）—— 沉浸三档视觉平整化与打印垫白模式集成测试。
 *
 * 验证（spec「沉浸档位导出表现一致性」+「导出底色模式与深浅色打印适配」）：
 * - 沉浸档（immersive）/ 轻量档（light）/ 精确档（precise）下，看板与报告分享卡
 *   的捕获契约（选项、过滤器语义、节点状态）与几何结构 100% 恒定；
 * - 沉浸/轻量档导出时深空光晕（.nx-space-atmosphere::before 径向渐变）通过临时
 *   平整化规则被中性化（content:none → html-to-image 跳过伪元素克隆），捕获完成
 *   即移除，实时界面零污染（样式隔离铁律）；精确档由全局 CSS 原生停用光晕；
 * - 垫白模式（whiteBackdrop）：捕获根节点注入 data-export-theme="white" + 内联
 *   --nx-* 令牌覆盖（设计 §4 打印适配对照表），PNG/JPG 背景强制 #ffffff，深色
 *   文字/发丝线变灰适配白底，文字对比度满足打印规范（主文本 ≥ 7:1、微弱 ≥ 4.5:1）。
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { toBlob, toJpeg, toPng, toSvg } from 'html-to-image'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftValidationReport } from '@aiproj/types'
import { ShareCardCanvas } from '@/components/next/export/ShareCardCanvas'
import { ValidationReportShareCardTemplate } from '@/components/next/export/ValidationReportShareCardTemplate'

vi.mock('html-to-image', () => ({
  toSvg: vi.fn(),
  toPng: vi.fn(),
  toJpeg: vi.fn(),
  toBlob: vi.fn(),
}))

vi.mock('@/components/ui/Toast', () => ({
  toast: vi.fn(),
}))

import {
  ATMOSPHERE_FLATTEN_CSS,
  WHITE_BACKDROP_TOKENS,
  exportNodeToBlob,
  exportNodeToJpeg,
  exportNodeToPng,
  exportNodeToSvg,
} from '@/lib/next/chart-export'

const urlMock = URL as unknown as {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}
const createObjectURLMock = vi.fn<(blob: Blob) => string>(() => 'blob:mock-url')
const revokeObjectURLMock = vi.fn<(url: string) => void>()

type ImmersionTier = 'immersive' | 'light' | 'precise'

/** 看板工作面模拟节点：四列 × 3 张任务卡片 + 沉浸档氛围层类（近似 ProjectSpaceContainer）。 */
function buildBoardNode(): HTMLElement {
  const section = document.createElement('section')
  section.setAttribute('data-project-space-board-slot', '')
  section.className = 'nx-space-atmosphere'
  section.style.backgroundColor = 'var(--nx-workspace-bg)'
  section.style.color = 'var(--nx-text-primary)'
  const columns = ['待处理', '进行中', '已完成', '其他']
  columns.forEach((name, index) => {
    const column = document.createElement('div')
    column.setAttribute('data-kanban-column', String(index))
    const heading = document.createElement('h4')
    heading.textContent = name
    column.appendChild(heading)
    for (let i = 0; i < 3; i += 1) {
      const card = document.createElement('div')
      card.className = 'kanban-card'
      card.textContent = `任务 ${index}-${i}`
      column.appendChild(card)
    }
    section.appendChild(column)
  })
  return section
}

/** 引擎 filter 语义探测器：普通节点 / 忽略节点 / tooltip。 */
function probeFilter(filter: ((node: Node) => boolean) | undefined): boolean[] {
  if (!filter) return []
  const plain = document.createElement('div')
  const ignored = document.createElement('div')
  ignored.setAttribute('data-export-ignore', 'true')
  const tooltip = document.createElement('div')
  tooltip.setAttribute('role', 'tooltip')
  return [filter(plain), filter(ignored), filter(tooltip)]
}

interface CaptureSnapshot {
  flattenStylePresent: boolean
  flattenRuleText: string | null
  themeAttr: string | null
  workspaceBgVar: string
  textPrimaryVar: string
  textSecondaryVar: string
  mutedVar: string
  hairlineVar: string
  accentVar: string
  options: {
    type: string | undefined
    pixelRatio: number | undefined
    skipFonts: boolean | undefined
    cacheBust: boolean | undefined
    backgroundColor: string | undefined
    fontFamily: string | undefined
    filterBehavior: boolean[]
  }
}

/** 捕获期快照：html-to-image 出口在克隆发生瞬间回调，记录注入痕迹与真实选项。 */
let snapshots: CaptureSnapshot[] = []

function installCaptureHooks(): void {
  snapshots = []
  const capture = (
    node: HTMLElement,
    options: {
      type?: string
      pixelRatio?: number
      skipFonts?: boolean
      cacheBust?: boolean
      backgroundColor?: string
      style?: { fontFamily?: string }
      filter?: (node: Node) => boolean
    },
  ) => {
    const flattenStyle = document.head.querySelector('[data-export-atmosphere-flatten]')
    snapshots.push({
      flattenStylePresent: flattenStyle !== null,
      flattenRuleText: flattenStyle?.textContent ?? null,
      themeAttr: node.getAttribute('data-export-theme'),
      workspaceBgVar: node.style.getPropertyValue('--nx-workspace-bg'),
      textPrimaryVar: node.style.getPropertyValue('--nx-text-primary'),
      textSecondaryVar: node.style.getPropertyValue('--nx-text-secondary'),
      mutedVar: node.style.getPropertyValue('--nx-text-muted'),
      hairlineVar: node.style.getPropertyValue('--nx-border-hairline'),
      accentVar: node.style.getPropertyValue('--nx-accent'),
      options: {
        type: options.type,
        pixelRatio: options.pixelRatio,
        skipFonts: options.skipFonts,
        cacheBust: options.cacheBust,
        backgroundColor: options.backgroundColor,
        fontFamily: options.style?.fontFamily,
        filterBehavior: probeFilter(options.filter),
      },
    })
  }
  vi.mocked(toSvg).mockImplementation(
    async (node: HTMLElement, options: Parameters<typeof toSvg>[1]) => {
      capture(node, {
        ...options,
        filter: options?.filter as ((node: Node) => boolean) | undefined,
      })
      return '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    },
  )
  vi.mocked(toPng).mockImplementation(
    async (node: HTMLElement, options: Parameters<typeof toPng>[1]) => {
      capture(node, {
        ...options,
        filter: options?.filter as ((node: Node) => boolean) | undefined,
      })
      return 'data:image/png;base64,AAAA'
    },
  )
  vi.mocked(toJpeg).mockImplementation(
    async (node: HTMLElement, options: Parameters<typeof toJpeg>[1]) => {
      capture(node, {
        ...options,
        filter: options?.filter as ((node: Node) => boolean) | undefined,
      })
      return 'data:image/jpeg;base64,AAAA'
    },
  )
  vi.mocked(toBlob).mockImplementation(
    async (node: HTMLElement, options: Parameters<typeof toBlob>[1]) => {
      capture(node, {
        ...options,
        filter: options?.filter as ((node: Node) => boolean) | undefined,
      })
      return new Blob(['mock'], { type: 'image/png' })
    },
  )
}

function setTier(tier: ImmersionTier): void {
  document.documentElement.setAttribute('data-immersion', tier)
}

/** 捕获契约的恒定部分：剔除注入痕迹后，其余必须跨档位完全一致。 */
function stableContract(snapshot: CaptureSnapshot): string {
  const {
    flattenStylePresent: _flattenPresent,
    flattenRuleText: _flattenRule,
    ...stable
  } = snapshot
  return JSON.stringify(stable)
}

/** 相对亮度（WCAG）：sRGB → 线性化。 */
function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255,
  )
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

/** WCAG 对比度：(L1 + 0.05) / (L2 + 0.05)，恒 ≥ 1。 */
function contrastRatio(a: string, b: string): number {
  const luminance = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  const lighter = luminance[0]!
  const darker = luminance[1]!
  return (lighter + 0.05) / (darker + 0.05)
}

beforeEach(() => {
  vi.clearAllMocks()
  urlMock.createObjectURL = createObjectURLMock as unknown as typeof urlMock.createObjectURL
  urlMock.revokeObjectURL = revokeObjectURLMock as unknown as typeof urlMock.revokeObjectURL
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  installCaptureHooks()
  document.documentElement.removeAttribute('data-immersion')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.head.querySelectorAll('[data-export-atmosphere-flatten]').forEach((el) => el.remove())
  document.documentElement.removeAttribute('data-immersion')
})

describe('沉浸档深空光晕平整化（spec「沉浸档导出时自动剥离动态光晕」）', () => {
  it('平整化规则在捕获期间生效：content:none / display:none / background:none', async () => {
    setTier('immersive')
    const board = buildBoardNode()
    document.body.appendChild(board)

    await exportNodeToPng(board, { entityName: '开项核心引擎', viewType: '看板工作面' })

    const snapshot = snapshots.at(-1)!
    expect(snapshot.flattenStylePresent).toBe(true)
    expect(snapshot.flattenRuleText).toContain('content: none')
    expect(snapshot.flattenRuleText).toContain('display: none')
    expect(snapshot.flattenRuleText).toContain('background: none')
    expect(ATMOSPHERE_FLATTEN_CSS).toContain('.nx-space-atmosphere::before')

    // 捕获完成即移除：实时界面零污染（样式隔离铁律）
    expect(document.head.querySelector('[data-export-atmosphere-flatten]')).toBeNull()
    expect(board.className).toContain('nx-space-atmosphere')
  })

  it('沉浸/轻量档注入平整化规则；精确档由全局 CSS 原生停用、不重复注入', async () => {
    const expectations: Array<[ImmersionTier, boolean]> = [
      ['immersive', true],
      ['light', true],
      ['precise', false],
    ]
    for (const [tier, shouldInject] of expectations) {
      setTier(tier)
      const board = buildBoardNode()
      document.body.appendChild(board)
      await exportNodeToPng(board, { entityName: '开项', viewType: '看板工作面' })
      expect(snapshots.at(-1)!.flattenStylePresent, `tier=${tier}`).toBe(shouldInject)
      expect(
        document.head.querySelector('[data-export-atmosphere-flatten]'),
        `tier=${tier}`,
      ).toBeNull()
      board.remove()
    }
  })

  it('沉浸/轻量/精确三档：捕获契约（选项+过滤语义+节点状态）与几何排布 100% 恒定', async () => {
    const contracts: Record<ImmersionTier, string> = {
      immersive: '',
      light: '',
      precise: '',
    }
    const geometries: Record<ImmersionTier, string> = { immersive: '', light: '', precise: '' }

    for (const tier of ['immersive', 'light', 'precise'] as const) {
      setTier(tier)
      const board = buildBoardNode()
      document.body.appendChild(board)
      await exportNodeToPng(board, { entityName: '开项核心引擎', viewType: '看板工作面' })

      const snapshot = snapshots.at(-1)!
      contracts[tier] = stableContract(snapshot)
      geometries[tier] = board.innerHTML

      // 捕获期节点状态：渐进式默认（非垫白）零注入
      expect(snapshot.themeAttr).toBeNull()
      expect(snapshot.workspaceBgVar).toBe('')
      expect(snapshot.options.type).toBe('image/png')
      expect(snapshot.options.pixelRatio).toBe(2)
      expect(snapshot.options.skipFonts).toBe(true)
      expect(snapshot.options.cacheBust).toBe(false)
      expect(snapshot.options.fontFamily).toContain('PingFang SC')
      expect(snapshot.options.filterBehavior).toEqual([true, false, false])
      board.remove()
    }

    // 三档导出契约恒等 → 同一看板在任意档位下的导出数据结构与几何 100% 一致
    expect(contracts.immersive).toBe(contracts.precise)
    expect(contracts.light).toBe(contracts.precise)
    expect(geometries.immersive).toBe(geometries.precise)
    expect(geometries.light).toBe(geometries.precise)
  })

  it('报告侧（1200×630 分享卡 / 反幻觉报告模板）：三档导出结构与内容恒定且无氛围层干扰', async () => {
    const validation: DraftValidationReport = {
      overallRiskLevel: 'low',
      confidenceScore: 94,
      dimensionScores: {
        factualAccuracy: 95,
        logicalConsistency: 90,
        assumptionClarity: 92,
        completeness: 88,
        numericPlausibility: 96,
      },
      blocking: [],
      warning: [],
      info: [],
      ruleResults: [],
      autoFixDiffs: [],
      canConfirm: true,
    }

    const contracts: Record<ImmersionTier, string> = { immersive: '', light: '', precise: '' }
    const cardStructures: Record<ImmersionTier, string> = { immersive: '', light: '', precise: '' }

    // 分享卡带「导出时间」（精确到秒）：冻结时钟，三档渲染跨过秒边界时不应被当成结构差异
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T03:41:57Z'))
    try {
      for (const tier of ['immersive', 'light', 'precise'] as const) {
        setTier(tier)
        const { container } = render(
          <ShareCardCanvas entityName="反幻觉自检报告" viewType="反幻觉自检报告">
            <ValidationReportShareCardTemplate validation={validation} />
          </ShareCardCanvas>,
        )
        const card = container.querySelector('[data-share-card]') as HTMLElement
        expect(card).not.toBeNull()
        // 结构内权威数据回显（spec：五维能量条 + 置信度 + 维度权重）
        expect(card.querySelector('[data-validation-confidence]')?.textContent).toBe('94')
        expect(card.querySelectorAll('[data-dimension-bar]')).toHaveLength(5)

        await exportNodeToBlob(card, 'png', { entityName: '反幻觉自检报告', viewType: '分享卡' })

        const snapshot = snapshots.at(-1)!
        // 分享卡不含氛围层：不触发光晕平整化，三档同样零注入
        expect(snapshot.flattenStylePresent).toBe(false)
        contracts[tier] = stableContract(snapshot)
        cardStructures[tier] = card.innerHTML
      }
    } finally {
      vi.useRealTimers()
    }

    expect(contracts.immersive).toBe(contracts.precise)
    expect(contracts.light).toBe(contracts.precise)
    expect(cardStructures.immersive).toBe(cardStructures.precise)
    expect(cardStructures.light).toBe(cardStructures.precise)
  })
})

describe('高对比垫白打印模式（design §4 / spec「导出底色模式与深浅色打印适配」）', () => {
  it('垫白导出：捕获根节点注入 data-export-theme="white" 与内联 --nx-* 覆盖（参照 SHARE_CARD_TOKENS 机制）', async () => {
    const board = buildBoardNode()
    document.body.appendChild(board)

    await exportNodeToPng(board, {
      entityName: '开项核心引擎',
      viewType: '看板工作面',
      whiteBackdrop: true,
    })

    const snapshot = snapshots.at(-1)!
    expect(snapshot.themeAttr).toBe('white')
    // 设计 §4 打印适配对照表：白底、深蓝灰主文本、中性浅灰发丝线、深色化信号色
    expect(snapshot.workspaceBgVar).toBe('#ffffff')
    expect(snapshot.textPrimaryVar).toBe('#0f172a')
    expect(snapshot.textSecondaryVar).toBe('#475569')
    expect(snapshot.mutedVar).toBe('#64748b')
    expect(snapshot.hairlineVar).toBe('#cbd5e1')
    expect(snapshot.accentVar).toBe('#0284c7')
    expect(snapshot.options.backgroundColor).toBe('#ffffff')

    // 捕获完成后同步还原：实时工作面零污染（样式隔离铁律）
    expect(board.hasAttribute('data-export-theme')).toBe(false)
    expect(board.style.getPropertyValue('--nx-text-primary')).toBe('')
    expect(board.style.getPropertyValue('--nx-workspace-bg')).toBe('')
  })

  it('垫白导出文字对比度满足打印规范：主文本 ≥ 7:1、次级/微弱 ≥ 4.5:1（对纯白背景）', () => {
    expect(WHITE_BACKDROP_TOKENS['--nx-workspace-bg']).toBe('#ffffff')
    // 主文本：深蓝灰 #0f172a 对纯白 ≥ 7:1（WCAG AAA）
    expect(
      contrastRatio(WHITE_BACKDROP_TOKENS['--nx-text-primary'], '#ffffff'),
    ).toBeGreaterThanOrEqual(7)
    // 次级 #475569 / 微弱 #64748b 对纯白 ≥ 4.5:1（WCAG AA 正文）
    expect(
      contrastRatio(WHITE_BACKDROP_TOKENS['--nx-text-secondary'], '#ffffff'),
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrastRatio(WHITE_BACKDROP_TOKENS['--nx-text-muted'], '#ffffff'),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('PNG / JPG / SVG 三格式垫白一致：位图背景强制 #ffffff，SVG 经变量覆盖呈现白底', async () => {
    const board = buildBoardNode()
    document.body.appendChild(board)

    await exportNodeToPng(board, {
      entityName: '开项',
      viewType: '看板工作面',
      whiteBackdrop: true,
    })
    await exportNodeToJpeg(board, {
      entityName: '开项',
      viewType: '看板工作面',
      whiteBackdrop: true,
    })
    await exportNodeToSvg(board, {
      entityName: '开项',
      viewType: '看板工作面',
      whiteBackdrop: true,
    })

    const [pngSnapshot, jpegSnapshot, svgSnapshot] = snapshots
    expect(pngSnapshot?.options.backgroundColor).toBe('#ffffff')
    expect(jpegSnapshot?.options.backgroundColor).toBe('#ffffff')
    // SVG 无位图背景通道：垫白主题完全依赖注入的 --nx-* 覆盖（--nx-workspace-bg: #ffffff）
    expect(svgSnapshot?.options.backgroundColor).toBeUndefined()
    for (const snapshot of [pngSnapshot, jpegSnapshot, svgSnapshot]) {
      expect(snapshot?.themeAttr).toBe('white')
      expect(snapshot?.workspaceBgVar).toBe('#ffffff')
      expect(snapshot?.textPrimaryVar).toBe('#0f172a')
    }

    // 全部还原，无残留
    expect(board.hasAttribute('data-export-theme')).toBe(false)
    expect(document.head.querySelector('[data-export-atmosphere-flatten]')).toBeNull()
  })

  it('非垫白导出不注入任何主题痕迹（默认暗黑模式保持零改动）', async () => {
    const board = buildBoardNode()
    document.body.appendChild(board)

    await exportNodeToPng(board, { entityName: '开项', viewType: '看板工作面' })

    const snapshot = snapshots.at(-1)!
    expect(snapshot.themeAttr).toBeNull()
    expect(snapshot.workspaceBgVar).toBe('')
    expect(snapshot.textPrimaryVar).toBe('')
    expect(snapshot.hairlineVar).toBe('')
    expect(snapshot.options.backgroundColor).toBeUndefined()
    expect(board.hasAttribute('data-export-theme')).toBe(false)
  })
})
