/**
 * v3-ui-next-help-knowledge-domain W2 · tasks 2.4 —— 知识库底册表格交互与多维过滤测试。
 *
 * 覆盖（spec「四层知识库底册表格浏览与多维过滤」场景 + tasks 2.4）：
 * - 高密度表格完整渲染：L1-L4 层级徽标（语义色类名）、SYNTHETIC 显式标注、
 *   领域/复杂度/状态/更新时间列、36px 行高（h-9）；
 * - 关键词输入即时过滤（本地纯函数收敛，零网络）；
 * - 层级多选下拉切换与状态多选下拉切换（含「全部」重置）；
 * - 点击条目触发详情/审查选中回调（onOpenReview）；
 * - 行内快速治理（确认转正/状态推进）先弹二次确认模态，取消不产生写请求；
 * - 只读（无 knowledge:manage）：行内操作按钮物理隐藏，仅剩状态徽标与只读行；
 * - 空态引导（无记录 + knowledge:author → 「新建第一条规范」CTA）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  KnowledgeItemLowSensitiveProjection,
  KnowledgeLayer,
  KnowledgeLifecycleStatus,
} from '@aiproj/types'
import { KnowledgeListTable } from '@/components/next/knowledge/KnowledgeListTable'
import { SYNTHETIC_BADGE_TEXT } from '@/lib/next/knowledge/knowledge-adapter'

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<KnowledgeItemLowSensitiveProjection> = {}) {
  const now = '2026-09-01T00:00:00.000Z'
  return {
    id: 1,
    layer: 'L1' as KnowledgeLayer,
    title: 'API 错误处理规范',
    status: 'active' as KnowledgeLifecycleStatus,
    domain: '接口架构',
    purpose: '参考',
    complexity: '初级',
    provenance: {
      sources: [{ layer: 'L1' as KnowledgeLayer, sourceId: 's1', title: '团队工程规范 V2' }],
    },
    isSynthetic: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } satisfies KnowledgeItemLowSensitiveProjection
}

function seedItems(): KnowledgeItemLowSensitiveProjection[] {
  return [
    makeItem({
      id: 1,
      layer: 'L1',
      title: 'API 错误处理规范',
      domain: '接口架构',
      status: 'active',
      complexity: '初级',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }),
    makeItem({
      id: 2,
      layer: 'L2',
      title: '双机房割接观察记录',
      domain: '运维',
      status: 'pending',
      complexity: '中级',
      updatedAt: '2026-09-02T00:00:00.000Z',
    }),
    makeItem({
      id: 3,
      layer: 'L3',
      title: '合成压测案例：千任务甘特重排',
      domain: '性能评测',
      status: 'active',
      complexity: '高级',
      isSynthetic: true,
      updatedAt: '2026-09-03T00:00:00.000Z',
    }),
    makeItem({
      id: 4,
      layer: 'L4',
      title: 'Q3 真实排程耗时分布',
      domain: '产品数据',
      status: 'deprecated',
      complexity: '高级',
      updatedAt: '2026-09-04T00:00:00.000Z',
    }),
    makeItem({
      id: 5,
      layer: 'L2',
      title: '风险例会迟到观察',
      domain: '协作观察',
      status: 'draft',
      updatedAt: '2026-09-05T00:00:00.000Z',
    }),
  ]
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
}
function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderTable(overrides: Partial<React.ComponentProps<typeof KnowledgeListTable>> = {}) {
  const client = newClient()
  const onOpenReview = vi.fn()
  const onRequestCreate = vi.fn()
  const onRetry = vi.fn()
  const props: React.ComponentProps<typeof KnowledgeListTable> = {
    items: seedItems(),
    isLoading: false,
    isError: false,
    errorMessage: null,
    onRetry,
    canManage: true,
    canAuthor: true,
    onOpenReview,
    onRequestCreate,
    ...overrides,
  }
  const utils = render(<KnowledgeListTable {...props} />, { wrapper: wrapper(client) })
  return { onOpenReview, onRequestCreate, onRetry, client, utils }
}

function visibleRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-knowledge-row]'))
}

// ---------------------------------------------------------------------------

describe('KnowledgeListTable：高密度底册完整渲染（tasks 2.4 / spec 四层底册）', () => {
  it('五条种子条目全渲染：标题/领域/复杂度/状态徽标/更新时间 + 36px 行高', () => {
    renderTable()
    expect(visibleRows()).toHaveLength(5)
    expect(screen.getByText('API 错误处理规范')).toBeInTheDocument()
    expect(screen.getByText('双机房割接观察记录')).toBeInTheDocument()
    expect(screen.getByText('合成压测案例：千任务甘特重排')).toBeInTheDocument()
    expect(screen.getByText('Q3 真实排程耗时分布')).toBeInTheDocument()
    expect(screen.getByText('风险例会迟到观察')).toBeInTheDocument()

    // 36px 行高（高密度表格）
    const row = document.querySelector('[data-knowledge-row="1"]')
    expect(row?.className).toContain('h-9')

    // 层级语义色徽标（L1 冷蓝令牌 / L4 琥珀令牌）
    const layerBadge = document.querySelector('[data-knowledge-layer-badge="L1"]')
    expect(layerBadge?.textContent).toBe('L1 规范')
    expect(layerBadge?.className).toContain('text-[var(--nx-workspace-blue)]')
    const l4Badge = document.querySelector('[data-knowledge-layer-badge="L4"]')
    expect(l4Badge?.textContent).toBe('L4 现实')
    expect(l4Badge?.className).toContain('text-[var(--nx-chart-4)]')

    // 状态徽标文本（状态列恒为徽标；治理控件在「操作」列）
    const statusCells = Array.from(document.querySelectorAll('[data-knowledge-cell-status]'))
    expect(statusCells.some((el) => el.textContent === '草稿')).toBe(true)
    expect(statusCells.some((el) => el.textContent === '已弃用')).toBe(true)
    expect(statusCells.some((el) => el.textContent === '活跃')).toBe(true)
    // 更新时间列（UTC 日历日）
    expect(
      document.querySelector('[data-knowledge-row="5"] [data-knowledge-cell-updated]')?.textContent,
    ).toBe('2026-09-05')
  })

  it('SYNTHETIC 徽章显式标注：仅合成条目渲染（L3 行），普通行占位不误报', () => {
    renderTable()
    const badges = document.querySelectorAll('[data-knowledge-synthetic-badge]')
    expect(badges).toHaveLength(1)
    const row3 = document.querySelector('[data-knowledge-row="3"]')
    expect(row3?.querySelector('[data-knowledge-synthetic-badge]')?.textContent).toBe(
      SYNTHETIC_BADGE_TEXT,
    )
    // L3 徽标带警示 tooltip 语义
    expect(
      row3?.querySelector('[data-knowledge-synthetic-badge]')?.getAttribute('title'),
    ).toContain('仅供模型评测参考')
    // L1 行无 SYNTHETIC
    const row1 = document.querySelector('[data-knowledge-row="1"]')
    expect(row1?.querySelector('[data-knowledge-synthetic-badge]')).toBeNull()
  })

  it('共 N 条汇总与筛选计数正确', () => {
    renderTable()
    expect(document.querySelector('[data-knowledge-register-total]')?.textContent).toContain(
      '共 5 条',
    )
  })
})

describe('KnowledgeListTable：多维过滤即时收敛（tasks 2.4 / spec 组合筛选场景）', () => {
  it('关键词输入即时过滤标题（无提交、零网络语义下的本地收敛）', () => {
    renderTable()
    const keywordInput = document.querySelector(
      '[data-knowledge-filter-keyword]',
    ) as HTMLInputElement
    fireEvent.change(keywordInput, { target: { value: '割接' } })
    expect(visibleRows()).toHaveLength(1)
    expect(document.querySelector('[data-knowledge-row="2"]')).not.toBeNull()
    expect(document.querySelector('[data-knowledge-row="1"]')).toBeNull()

    // 继续输入不匹配词 → 空态提示（带重置出口）
    fireEvent.change(keywordInput, { target: { value: 'xyz-unmatched-term' } })
    expect(visibleRows()).toHaveLength(0)
    expect(screen.getByText('暂无匹配的四层知识')).toBeInTheDocument()
    expect(document.querySelector('[data-knowledge-empty-reset]')).not.toBeNull()
  })

  it('层级多选下拉切换：选 L1 单选、加选 L4 双选、全部层级重置', () => {
    renderTable()
    // 打开层级菜单 → 勾选 L1
    fireEvent.click(document.querySelector('[data-knowledge-filter-layer]') as Element)
    expect(document.querySelector('[data-knowledge-layer-menu]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-knowledge-filter-layer-option="L1"]') as Element)
    expect(visibleRows()).toHaveLength(1)
    expect(document.querySelector('[data-knowledge-row="1"]')).not.toBeNull()
    expect(document.querySelector('[data-knowledge-filter-layer]')?.textContent).toContain(
      'L1 规范',
    )

    // 加选 L4 → L1+L4 并集
    fireEvent.click(document.querySelector('[data-knowledge-filter-layer]') as Element)
    fireEvent.click(document.querySelector('[data-knowledge-filter-layer-option="L4"]') as Element)
    expect(visibleRows()).toHaveLength(2)

    // 菜单「全部层级」→ 清除多选恢复全量
    fireEvent.click(document.querySelector('[data-knowledge-filter-layer]') as Element)
    fireEvent.click(document.querySelector('[data-knowledge-filter-layer-all]') as Element)
    expect(visibleRows()).toHaveLength(5)
  })

  it('状态多选下拉切换：选待审收敛一条，叠加层级多选组合收敛', () => {
    renderTable()
    fireEvent.click(document.querySelector('[data-knowledge-filter-status]') as Element)
    expect(document.querySelector('[data-knowledge-status-menu]')).not.toBeNull()
    fireEvent.click(
      document.querySelector('[data-knowledge-filter-status-option="pending"]') as Element,
    )
    expect(visibleRows()).toHaveLength(1)
    expect(document.querySelector('[data-knowledge-row="2"]')).not.toBeNull()
    expect(document.querySelector('[data-knowledge-filter-status]')?.textContent).toContain('待审')

    // 组合：状态待审 × 层级多选 L2（命中行 2，保持 1 条）
    fireEvent.click(document.querySelector('[data-knowledge-filter-layer]') as Element)
    fireEvent.click(document.querySelector('[data-knowledge-filter-layer-option="L2"]') as Element)
    expect(visibleRows()).toHaveLength(1)

    // 加选 L1 → 并集仍只有行 2；再取消 L2 → 只剩 L1 ∩ pending = 0 条
    fireEvent.click(document.querySelector('[data-knowledge-filter-layer]') as Element)
    fireEvent.click(document.querySelector('[data-knowledge-filter-layer-option="L1"]') as Element)
    expect(visibleRows()).toHaveLength(1)
    fireEvent.click(document.querySelector('[data-knowledge-filter-layer]') as Element)
    fireEvent.click(document.querySelector('[data-knowledge-filter-layer-option="L2"]') as Element)
    expect(visibleRows()).toHaveLength(0)
    expect(screen.getByText('暂无匹配的四层知识')).toBeInTheDocument()
  })

  it('领域精确收敛 + 重置筛选一键恢复', () => {
    renderTable()
    const domainInput = document.querySelector('[data-knowledge-filter-domain]') as HTMLInputElement
    fireEvent.change(domainInput, { target: { value: '接口架构' } })
    expect(visibleRows()).toHaveLength(1)
    // 重置按钮出现，点击后全量恢复
    expect(document.querySelector('[data-knowledge-filter-reset]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-knowledge-filter-reset]') as Element)
    expect(visibleRows()).toHaveLength(5)
    expect((domainInput as HTMLInputElement).value).toBe('')
    expect(document.querySelector('[data-knowledge-filter-reset]')).toBeNull()
  })
})

describe('KnowledgeListTable：行交互与受控治理（tasks 2.3/2.4）', () => {
  it('点击条目行触发详情/审查选中回调（携带知识 ID）', () => {
    const { onOpenReview } = renderTable()
    fireEvent.click(document.querySelector('[data-knowledge-row="3"]') as Element)
    expect(onOpenReview).toHaveBeenCalledTimes(1)
    expect(onOpenReview).toHaveBeenCalledWith(3)
  })

  it('「查看 / 审查」按钮（只读模式）触发选中回调且不双重触发', () => {
    const { onOpenReview } = renderTable({ canManage: false })
    fireEvent.click(
      document.querySelector('[data-knowledge-row="1"] [data-knowledge-row-review]') as Element,
    )
    expect(onOpenReview).toHaveBeenCalledTimes(1)
    expect(onOpenReview).toHaveBeenCalledWith(1)
  })

  it('pending 行：确认转正按钮先弹二次确认模态，取消零写请求（RL-06）', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy.mockResolvedValue(new Response('{}', { status: 200 })))
    try {
      renderTable()
      const row2 = document.querySelector('[data-knowledge-row="2"]')
      const confirmButton = row2?.querySelector('[data-knowledge-row-confirm]')
      expect(confirmButton).not.toBeNull()
      fireEvent.click(confirmButton as Element)
      // 模态阻断出现
      const modal = document.querySelector('[data-testid="knowledge-row-confirm-modal"]')
      expect(modal).not.toBeNull()
      expect(modal?.textContent).toContain('确认转正知识记录')
      // 取消 → 不产生任何写请求
      fireEvent.click(document.querySelector('[data-knowledge-confirm-cancel]') as Element)
      await waitFor(() =>
        expect(document.querySelector('[data-testid="knowledge-row-confirm-modal"]')).toBeNull(),
      )
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('非 pending 行：状态推进下拉只含白名单目标（不含 pending→active 转正通道）', () => {
    renderTable()
    const row1 = document.querySelector('[data-knowledge-row="1"]')
    const select = row1?.querySelector('[data-knowledge-row-status]') as HTMLSelectElement
    expect(select).not.toBeNull()
    const options = Array.from(select.options).map((o) => o.value)
    expect(options).toEqual(['active', 'deprecated', 'outdated'])
    const row4 = document.querySelector('[data-knowledge-row="4"]')
    const select4 = row4?.querySelector('[data-knowledge-row-status]') as HTMLSelectElement
    const options4 = Array.from(select4.options).map((o) => o.value)
    expect(options4).toEqual(['deprecated', 'active'])
    // draft 行推进出口 = pending
    const row5 = document.querySelector('[data-knowledge-row="5"]')
    const select5 = row5?.querySelector('[data-knowledge-row-status]') as HTMLSelectElement
    expect(Array.from(select5.options).map((o) => o.value)).toEqual(['draft', 'pending'])
  })

  it('只读（无 knowledge:manage）：行内操作按钮物理隐藏，仅状态徽标与只读呈现', () => {
    renderTable({ canManage: false })
    expect(document.querySelector('[data-knowledge-row-confirm]')).toBeNull()
    expect(document.querySelector('[data-knowledge-row-status]')).toBeNull()
    // 状态徽标仍在（只读可读）
    expect(document.querySelectorAll('[data-knowledge-cell-status]').length).toBeGreaterThan(0)
    expect(
      document.querySelector('[data-knowledge-row="2"] [data-knowledge-cell-status]')?.textContent,
    ).toBe('待审')
    // 查看入口保留（只读审查）
    expect(document.querySelector('[data-knowledge-row-review]')).not.toBeNull()
  })
})

describe('KnowledgeListTable：加载/空态三态', () => {
  it('加载中渲染 5 行高密度骨架并标注 aria-busy', () => {
    renderTable({ isLoading: true })
    expect(document.querySelector('[data-knowledge-ledger-skeleton]')).not.toBeNull()
    expect(
      document.querySelector('[data-knowledge-ledger-skeleton]')?.getAttribute('aria-busy'),
    ).toBe('true')
    expect(document.querySelectorAll('[data-knowledge-ledger-skeleton] > div')).toHaveLength(5)
  })

  it('加载失败渲染错误卡并提供重新加载出口', () => {
    const { onRetry } = renderTable({
      isError: true,
      errorMessage: 'network down',
    })
    expect(document.querySelector('[data-knowledge-ledger-error]')).not.toBeNull()
    expect(screen.getByText('四层知识底册加载失败')).toBeInTheDocument()
    fireEvent.click(document.querySelector('[data-knowledge-ledger-retry]') as Element)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('空库 + knowledge:author：展示「新建第一条规范」CTA 并触发回调', () => {
    const { onRequestCreate } = renderTable({ items: [] })
    expect(screen.getByText('知识库暂无记录')).toBeInTheDocument()
    fireEvent.click(document.querySelector('[data-knowledge-empty-create]') as Element)
    expect(onRequestCreate).toHaveBeenCalledTimes(1)
  })

  it('空库 + 只读：CTA 不渲染，给出权限引导文案', () => {
    renderTable({ items: [], canAuthor: false })
    expect(document.querySelector('[data-knowledge-empty-create]')).toBeNull()
    expect(document.body.textContent).toContain('knowledge:author')
  })
})
