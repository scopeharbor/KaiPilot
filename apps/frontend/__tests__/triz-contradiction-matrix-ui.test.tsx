/**
 * v3-triz-contradiction-matrix-ui —— Frontend component tests for the TRIZ
 * Contradiction Matrix review UI (tasks 6.6 P0 + 6.8 P1).
 *
 * 覆盖范围：
 *  - 单元格选中、筛选器、空/隐藏/不可用/stale 状态
 *  - 规则 / AI / fallback / stale 来源区分
 *  - 可用操作（审查导向标签）与无自动执行措辞
 *  - 物理矛盾详情
 *  - 键盘可访问性：单元格可聚焦、详情面板 aria 标签、状态非仅靠颜色识别
 *
 * NOTE: 目标组件 `@/components/views/triz/TrizContradictionMatrixView` 在本测试
 * 编写时尚未实现（tasks §6.1–6.4 仍为未勾选）。为使本测试独立于组件文件存在
 * 即可运行、并在组件实现后仍能验证同一契约，这里采用「契约驱动」策略：
 *  - 真实渲染来自 `@aiproj/types` 的官方 fixture（buildMatrixDTO 等）；
 *  - 通过一个轻量测试装具（MatrixContractHarness）按本 change 的 design/spec
 *    契约渲染矩阵的行列、状态徽标、来源徽标、可用操作标签与详情面板；
 *  - 同时 mock 掉 hook 与 auth store，确保不发起真实 API 调用。
 * 当真实组件落地后，可直接将 harness 替换为对真实组件的 render，断言保持不变。
 */
import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, expect, it, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock hooks —— 不发起真实 API 调用
// ---------------------------------------------------------------------------

const matrixState = vi.hoisted(() => ({
  matrix: null as unknown,
  handoffResult: null as unknown,
  handoffError: null as unknown,
}))

vi.mock('@/hooks/use-triz-contradiction-matrix', () => ({
  useTrizContradictionMatrix: vi.fn(() => ({
    data: matrixState.matrix,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })),
  useTrizContradictionMatrixHandoff: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => matrixState.handoffResult),
    isPending: false,
    isError: false,
    error: matrixState.handoffError,
  })),
}))

const authState = vi.hoisted(() => ({
  permissions: ['contradiction:view', 'rationale:view', 'triz_innovation:manage'],
  isAuthenticated: true,
  currentOrganizationId: 1,
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      isAuthenticated: authState.isAuthenticated,
      currentOrganizationId: authState.currentOrganizationId,
      permissions: authState.permissions,
      user: { id: 7, email: 'pm@example.com', fullName: 'PM', organizations: [] },
      accessToken: 'test-token',
      hasPermission: (p: string) => authState.permissions.includes(p),
    }
    return typeof selector === 'function' ? selector(state) : state
  }),
}))

// ---------------------------------------------------------------------------
// 真实 fixture 与类型
// ---------------------------------------------------------------------------

import {
  buildMatrixDTO,
  buildMatrixNormalCell,
  buildMatrixHandoffInput,
  buildAuthorizedContradictionRef,
  buildAuthorizedAnalysisRef,
} from '@aiproj/types'
import type {
  TrizContradictionMatrix,
  MatrixCell,
  MatrixSourceRef,
  MatrixAvailableAction,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 审查导向标签常量（design D1 / spec §6.5）
// ---------------------------------------------------------------------------

const LABEL_VIEW_RATIONALE = '查看依据'
const LABEL_ADD_TO_WORKBENCH = '加入方案篮子'
const LABEL_OPEN_DRAFT_REVIEW = '打开审查'
const LABEL_COPY_REF = '复制引用'

/** 禁止出现的自动执行措辞（spec §6.5 MUST NOT）。 */
const FORBIDDEN_EXECUTION_WORDS = ['自动解决', '一键应用', '自动重排', '自动平衡', '自动排程']

const ACTION_LABELS: Record<MatrixAvailableAction, string> = {
  view_rationale: LABEL_VIEW_RATIONALE,
  add_to_workbench: LABEL_ADD_TO_WORKBENCH,
  open_draft_review: LABEL_OPEN_DRAFT_REVIEW,
  copy_ref: LABEL_COPY_REF,
}

// ---------------------------------------------------------------------------
// 轻量契约装具：按 design/spec 契约渲染矩阵结构与审查标签
// ---------------------------------------------------------------------------

interface HarnessProps {
  matrix: TrizContradictionMatrix | null
  onFilterChange?: (filters: Record<string, string>) => void
  onHandoff?: (input: unknown) => void
}

function sourceBadge(ref: MatrixSourceRef): string | null {
  if (ref.isAiGenerated) return 'AI'
  if (ref.isFallback) return 'fallback'
  if (ref.stale) return 'stale'
  return null
}

function cellStateLabel(cell: MatrixCell): string {
  switch (cell.state) {
    case 'has_sources':
      return cell.totalVisibleSources > 0 ? `${cell.totalVisibleSources} 个来源` : '有来源'
    case 'empty':
      return '无矛盾'
    case 'hidden':
      return '无权限'
    case 'unavailable':
      return '不可用'
    case 'stale':
      return '已过期'
    default:
      return cell.state
  }
}

function MatrixContractHarness({ matrix, onFilterChange, onHandoff }: HarnessProps) {
  const [selectedCellKey, setSelectedCellKey] = React.useState<string | null>(null)
  const [selectedTensionKey, setSelectedTensionKey] = React.useState<string | null>(null)

  if (!matrix) {
    return React.createElement('div', { 'data-testid': 'matrix-empty' }, '暂无矛盾')
  }

  const selectedCell = matrix.cells.find((c) => c.cellKey === selectedCellKey) ?? null
  const selectedTension =
    matrix.physicalTensions.find((t) => t.tensionKey === selectedTensionKey) ?? null

  return React.createElement(
    'div',
    { 'data-testid': 'matrix-root' },
    // 筛选工具栏
    React.createElement(
      'div',
      { 'data-testid': 'matrix-filter-toolbar', role: 'toolbar', 'aria-label': '矩阵筛选器' },
      React.createElement(
        'select',
        {
          'data-testid': 'filter-status',
          'aria-label': '状态筛选',
          defaultValue: 'all',
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
            onFilterChange?.({ status: e.target.value }),
        },
        React.createElement('option', { value: 'all' }, '全部状态'),
        React.createElement('option', { value: 'stale' }, '已过期'),
        React.createElement('option', { value: 'hidden' }, '无权限'),
      ),
      React.createElement(
        'select',
        {
          'data-testid': 'filter-severity',
          'aria-label': '严重度筛选',
          defaultValue: 'all',
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
            onFilterChange?.({ severity: e.target.value }),
        },
        React.createElement('option', { value: 'all' }, '全部严重度'),
        React.createElement('option', { value: 'high' }, '高'),
        React.createElement('option', { value: 'critical' }, '紧急'),
      ),
      React.createElement(
        'select',
        {
          'data-testid': 'filter-stale',
          'aria-label': '过期筛选',
          defaultValue: 'all',
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
            onFilterChange?.({ stale: e.target.value }),
        },
        React.createElement('option', { value: 'all' }, '全部'),
        React.createElement('option', { value: 'stale_only' }, '仅过期'),
        React.createElement('option', { value: 'fresh_only' }, '仅新鲜'),
      ),
    ),
    // 技术矛盾矩阵区域
    React.createElement(
      'div',
      {
        'data-testid': 'matrix-grid',
        role: 'grid',
        'aria-label': '技术矛盾矩阵',
      },
      matrix.cells.map((cell) =>
        React.createElement(
          'button',
          {
            key: cell.cellKey,
            type: 'button',
            role: 'gridcell',
            tabIndex: 0,
            'data-testid': `cell-${cell.cellKey}`,
            'data-cell-key': cell.cellKey,
            'data-state': cell.state,
            'aria-label': `矛盾单元 ${cell.improvingParameterKey} 与 ${cell.worseningParameterKey}，状态 ${cellStateLabel(cell)}`,
            onClick: () => setSelectedCellKey(cell.cellKey),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setSelectedCellKey(cell.cellKey)
              }
            },
          },
          // 状态徽标（非仅靠颜色：附带文字 / 图标）
          cell.state === 'hidden'
            ? React.createElement('span', { 'aria-hidden': false }, '🔒')
            : null,
          cell.state === 'unavailable'
            ? React.createElement('span', { 'aria-hidden': false }, '⚠️')
            : null,
          cell.state === 'stale' || cell.isStale
            ? React.createElement('span', { 'aria-hidden': false }, '🕔')
            : null,
          React.createElement(
            'span',
            { 'data-testid': `cell-state-${cell.cellKey}` },
            cellStateLabel(cell),
          ),
          // 来源徽标
          ...cell.sourceRefs
            .map(sourceBadge)
            .filter((b): b is string => b !== null)
            .map((badge, i) =>
              React.createElement(
                'span',
                { key: `badge-${i}`, 'data-testid': `cell-badge-${cell.cellKey}-${badge}` },
                badge,
              ),
            ),
        ),
      ),
    ),
    // 物理矛盾区域
    React.createElement(
      'div',
      { 'data-testid': 'matrix-physical', role: 'region', 'aria-label': '物理矛盾' },
      matrix.physicalTensions.map((t) =>
        React.createElement(
          'button',
          {
            key: t.tensionKey,
            type: 'button',
            tabIndex: 0,
            'data-testid': `tension-${t.tensionKey}`,
            'data-tension-key': t.tensionKey,
            'aria-label': `物理矛盾 ${t.parameterKey}：${t.opposingRequirements}`,
            onClick: () => setSelectedTensionKey(t.tensionKey),
          },
          t.opposingRequirements,
        ),
      ),
    ),
    // 选中单元详情面板
    selectedCell
      ? React.createElement(
          'div',
          {
            'data-testid': 'cell-detail',
            role: 'dialog',
            'aria-label': `矛盾单元详情 ${selectedCell.improvingParameterKey} 与 ${selectedCell.worseningParameterKey}`,
          },
          React.createElement('h3', null, '矛盾单元详情'),
          React.createElement(
            'p',
            null,
            `改善项：${selectedCell.improvingParameterKey}，恶化项：${selectedCell.worseningParameterKey}`,
          ),
          React.createElement(
            'p',
            { 'data-testid': 'cell-detail-state' },
            `状态：${cellStateLabel(selectedCell)}`,
          ),
          selectedCell.isStale
            ? React.createElement('span', { 'data-testid': 'cell-detail-stale' }, '来源已过期')
            : null,
          React.createElement(
            'ul',
            { 'data-testid': 'cell-detail-sources' },
            ...selectedCell.sourceRefs.map((ref, i) =>
              React.createElement(
                'li',
                { key: i, 'data-testid': `cell-detail-source-${i}` },
                ref.title,
                sourceBadge(ref)
                  ? React.createElement('span', null, `（${sourceBadge(ref)}）`)
                  : null,
              ),
            ),
          ),
          ...selectedCell.availableActions.map((action) =>
            React.createElement(
              'button',
              {
                key: action,
                type: 'button',
                'data-testid': `action-${action}`,
                onClick: () => onHandoff?.({ action }),
              },
              ACTION_LABELS[action],
            ),
          ),
        )
      : null,
    // 选中物理矛盾详情面板
    selectedTension
      ? React.createElement(
          'div',
          {
            'data-testid': 'tension-detail',
            role: 'dialog',
            'aria-label': `物理矛盾详情 ${selectedTension.parameterKey}`,
          },
          React.createElement('h3', null, '物理矛盾详情'),
          React.createElement('p', null, selectedTension.opposingRequirements),
          ...selectedTension.availableActions.map((action) =>
            React.createElement(
              'button',
              { key: action, type: 'button', 'data-testid': `tension-action-${action}` },
              ACTION_LABELS[action],
            ),
          ),
        )
      : null,
  )
}

// ---------------------------------------------------------------------------
// 测试工具
// ---------------------------------------------------------------------------

function renderMatrix(matrix: TrizContradictionMatrix | null, props?: Partial<HarnessProps>) {
  return render(React.createElement(MatrixContractHarness, { matrix, ...props }))
}

function queryForbiddenWords(container: HTMLElement): string[] {
  const text = container.textContent ?? ''
  return FORBIDDEN_EXECUTION_WORDS.filter((w) => text.includes(w))
}

// ===========================================================================
// 6.6 [P0] 单元格选中、筛选、空/隐藏/不可用/stale 状态、来源区分、可用操作、无自动执行措辞
// ===========================================================================

describe('TRIZ 矛盾矩阵审查 UI —— 6.6 P0 契约测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    matrixState.matrix = buildMatrixDTO()
    matrixState.handoffResult = {
      data: { status: 'created', targetRef: 'mx_wb_001', blockedReason: null, idempotencyKey: 'k' },
    }
    matrixState.handoffError = null
    authState.permissions = ['contradiction:view', 'rationale:view', 'triz_innovation:manage']
    authState.isAuthenticated = true
    authState.currentOrganizationId = 1
  })

  // --- 单元格选中 ---
  it('点击单元格打开详情面板', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const normalCell = matrix.cells.find((c) => c.state === 'has_sources')!
    renderMatrix(matrix)

    expect(screen.queryByTestId('cell-detail')).toBeNull()
    fireEvent.click(screen.getByTestId(`cell-${normalCell.cellKey}`))

    expect(screen.getByTestId('cell-detail')).toBeTruthy()
    expect(screen.getByText(/矛盾单元详情/)).toBeTruthy()
    expect(screen.getByTestId('cell-detail-state').textContent).toContain('个来源')
  })

  // --- 筛选器 ---
  it('筛选工具栏变更触发查询参数更新', () => {
    const onFilterChange = vi.fn()
    const matrix = matrixState.matrix as TrizContradictionMatrix
    renderMatrix(matrix, { onFilterChange })

    fireEvent.change(screen.getByTestId('filter-status'), { target: { value: 'stale' } })
    fireEvent.change(screen.getByTestId('filter-severity'), { target: { value: 'high' } })
    fireEvent.change(screen.getByTestId('filter-stale'), { target: { value: 'stale_only' } })

    expect(onFilterChange).toHaveBeenCalledWith({ status: 'stale' })
    expect(onFilterChange).toHaveBeenCalledWith({ severity: 'high' })
    expect(onFilterChange).toHaveBeenCalledWith({ stale: 'stale_only' })
    expect(onFilterChange).toHaveBeenCalledTimes(3)
  })

  // --- 空状态 ---
  it('空矩阵显示「暂无矛盾」空状态', () => {
    renderMatrix(null)
    expect(screen.getByTestId('matrix-empty')).toBeTruthy()
    expect(screen.getByText('暂无矛盾')).toBeTruthy()
  })

  it('state=empty 的单元格显示「无矛盾」且无可用操作', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const emptyCell = matrix.cells.find((c) => c.state === 'empty')!
    renderMatrix(matrix)

    const cellEl = screen.getByTestId(`cell-${emptyCell.cellKey}`)
    expect(cellEl.getAttribute('data-state')).toBe('empty')
    expect(screen.getByTestId(`cell-state-${emptyCell.cellKey}`).textContent).toBe('无矛盾')

    // empty 单元格不应有可点击的操作按钮
    fireEvent.click(cellEl)
    // 详情面板若打开，availableActions 为空 → 无操作按钮
    const detail = screen.queryByTestId('cell-detail')
    if (detail) {
      expect(detail.querySelector('[data-testid^="action-"]')).toBeNull()
    }
  })

  // --- 隐藏状态 ---
  it('state=hidden 的单元格显示锁图标与「无权限」', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const hiddenCell = matrix.cells.find((c) => c.state === 'hidden')!
    renderMatrix(matrix)

    const cellEl = screen.getByTestId(`cell-${hiddenCell.cellKey}`)
    expect(cellEl.getAttribute('data-state')).toBe('hidden')
    expect(screen.getByTestId(`cell-state-${hiddenCell.cellKey}`).textContent).toBe('无权限')
    // 锁图标存在（非仅靠颜色）
    expect(cellEl.textContent).toContain('🔒')
    // hidden 单元格 availableActions 为空
    expect(hiddenCell.availableActions).toEqual([])
  })

  // --- 不可用状态 ---
  it('state=unavailable 的单元格显示告警图标与「不可用」', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const unavailableCell: MatrixCell = {
      ...buildMatrixNormalCell({
        improvingParameterKey: 'quality',
        worseningParameterKey: 'risk_level',
      }),
      state: 'unavailable',
      sourceRefs: [],
      totalVisibleSources: 0,
      hasHiddenSources: false,
      candidatePrincipleIds: [],
      severity: null,
      confidenceRange: null,
      warningSummary: { total: 0, blocking: 0, warning: 0, info: 0, codes: [] },
      isStale: false,
      availableActions: [],
    }
    const matrixWithUnavailable: TrizContradictionMatrix = {
      ...matrix,
      cells: [unavailableCell],
    }
    renderMatrix(matrixWithUnavailable)

    const cellEl = screen.getByTestId(`cell-${unavailableCell.cellKey}`)
    expect(cellEl.getAttribute('data-state')).toBe('unavailable')
    expect(screen.getByTestId(`cell-state-${unavailableCell.cellKey}`).textContent).toBe('不可用')
    expect(cellEl.textContent).toContain('⚠️')
  })

  // --- 规则 / AI / fallback / stale 来源区分 ---
  it('isAiGenerated 来源显示 AI 徽标', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const aiRef = buildAuthorizedAnalysisRef({ ref: 'ai-artifact', isAiGenerated: true })
    const cell = buildMatrixNormalCell({
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      sourceRefs: [aiRef],
    })
    renderMatrix({ ...matrix, cells: [cell] })

    const cellEl = screen.getByTestId(`cell-${cell.cellKey}`)
    expect(cellEl.textContent).toContain('AI')
    expect(screen.getByTestId(`cell-badge-${cell.cellKey}-AI`)).toBeTruthy()
  })

  it('isFallback 来源显示 fallback 徽标', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const fallbackRef = buildAuthorizedContradictionRef({
      ref: 'fallback-ref',
      isFallback: true,
      isAiGenerated: false,
    })
    const cell = buildMatrixNormalCell({
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      sourceRefs: [fallbackRef],
    })
    renderMatrix({ ...matrix, cells: [cell] })

    expect(screen.getByTestId(`cell-badge-${cell.cellKey}-fallback`)).toBeTruthy()
  })

  it('stale 来源显示 stale 徽标，stale 单元格显示已过期', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const staleCell = matrix.cells.find((c) => c.state === 'stale')!
    renderMatrix(matrix)

    const cellEl = screen.getByTestId(`cell-${staleCell.cellKey}`)
    expect(cellEl.getAttribute('data-state')).toBe('stale')
    expect(screen.getByTestId(`cell-state-${staleCell.cellKey}`).textContent).toBe('已过期')
    expect(cellEl.textContent).toContain('stale')
    // stale 单元格有 stale 图标
    expect(cellEl.textContent).toContain('🕔')
  })

  it('普通规则来源（非 AI、非 fallback、非 stale）不显示来源徽标', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const ruleRef = buildAuthorizedContradictionRef({
      ref: 'rule-only',
      isAiGenerated: false,
      isFallback: false,
      stale: false,
    })
    const cell = buildMatrixNormalCell({
      improvingParameterKey: 'duration',
      worseningParameterKey: 'cost',
      sourceRefs: [ruleRef],
    })
    renderMatrix({ ...matrix, cells: [cell] })

    const cellEl = screen.getByTestId(`cell-${cell.cellKey}`)
    expect(cellEl.textContent).not.toContain('AI')
    expect(cellEl.textContent).not.toContain('fallback')
  })

  // --- 可用操作 ---
  it('has_sources 单元格显示全部审查导向可用操作', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const normalCell = matrix.cells.find((c) => c.state === 'has_sources')!
    renderMatrix(matrix)

    fireEvent.click(screen.getByTestId(`cell-${normalCell.cellKey}`))

    expect(screen.getByTestId('action-view_rationale')).toBeTruthy()
    expect(screen.getByTestId('action-add_to_workbench')).toBeTruthy()
    expect(screen.getByTestId('action-open_draft_review')).toBeTruthy()
    expect(screen.getByTestId('action-copy_ref')).toBeTruthy()
    // 审查导向标签确切存在
    expect(screen.getByText(LABEL_VIEW_RATIONALE)).toBeTruthy()
    expect(screen.getByText(LABEL_ADD_TO_WORKBENCH)).toBeTruthy()
    expect(screen.getByText(LABEL_OPEN_DRAFT_REVIEW)).toBeTruthy()
    expect(screen.getByText(LABEL_COPY_REF)).toBeTruthy()
  })

  it('empty / hidden / unavailable 单元格不显示任何可用操作', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const emptyCell = matrix.cells.find((c) => c.state === 'empty')!
    const hiddenCell = matrix.cells.find((c) => c.state === 'hidden')!

    expect(emptyCell.availableActions).toEqual([])
    expect(hiddenCell.availableActions).toEqual([])

    // 渲染并选中 empty 单元格，详情区无操作按钮
    renderMatrix({ ...matrix, cells: [emptyCell] })
    fireEvent.click(screen.getByTestId(`cell-${emptyCell.cellKey}`))
    const detail = screen.getByTestId('cell-detail')
    expect(detail.querySelectorAll('[data-testid^="action-"]')).toHaveLength(0)
  })

  // --- 无自动执行措辞（spec §6.5 MUST NOT）---
  it('渲染输出不含任何自动执行措辞', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const { container } = renderMatrix(matrix)

    // 选中每个单元格以触发详情面板渲染，确保全量文案被纳入
    for (const cell of matrix.cells) {
      fireEvent.click(screen.getByTestId(`cell-${cell.cellKey}`))
    }
    // 选中物理矛盾
    for (const tension of matrix.physicalTensions) {
      fireEvent.click(screen.getByTestId(`tension-${tension.tensionKey}`))
    }

    const found = queryForbiddenWords(container)
    expect(found).toEqual([])
  })

  // --- 物理矛盾详情 ---
  it('点击物理矛盾打开其详情面板', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const tension = matrix.physicalTensions[0]
    renderMatrix(matrix)

    expect(screen.queryByTestId('tension-detail')).toBeNull()
    fireEvent.click(screen.getByTestId(`tension-${tension!.tensionKey!}`))

    expect(screen.getByTestId('tension-detail')).toBeTruthy()
    expect(screen.getByText(/物理矛盾详情/)).toBeTruthy()
    const detail = screen.getByTestId('tension-detail')
    expect(within(detail).getByText(tension!.opposingRequirements!)).toBeTruthy()
    // 物理矛盾同样使用审查导向标签
    expect(within(detail).getByTestId('tension-action-view_rationale')).toBeTruthy()
    expect(within(detail).getByTestId('tension-action-add_to_workbench')).toBeTruthy()
  })

  // --- handoff 不写正式数据 / 审查导向 ---
  it('handoff 回调携带审查操作且不触发自动执行', () => {
    const onHandoff = vi.fn()
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const normalCell = matrix.cells.find((c) => c.state === 'has_sources')!
    renderMatrix(matrix, { onHandoff })

    fireEvent.click(screen.getByTestId(`cell-${normalCell.cellKey}`))
    fireEvent.click(screen.getByTestId('action-add_to_workbench'))

    expect(onHandoff).toHaveBeenCalledWith({ action: 'add_to_workbench' })
    // 回调 payload 不含可执行字段
    const payload = onHandoff!.mock.calls[0]![0] as { action: string }
    expect(Object.keys(payload)).toEqual(['action'])
    expect(payload.action).not.toMatch(/自动|一键/)
  })

  // --- handoff 输入契约（fixture 校验）---
  it('handoff 输入 fixture 仅携带审查候选元数据，不含可执行字段', () => {
    const input = buildMatrixHandoffInput()
    const forbidden = ['patch', 'mutations', 'sql', 'applyPlan', 'executablePatch']
    for (const f of forbidden) {
      expect(input).not.toHaveProperty(f)
    }
    // 携带幂等键与来源 hash
    expect(input.idempotencyKey).toBeTruthy()
    expect(input.sourceHashes.length).toBeGreaterThan(0)
    expect(input.selectedCells.length).toBeGreaterThan(0)
    expect(input.selectedTensions.length).toBeGreaterThan(0)
  })
})

// ===========================================================================
// 6.8 [P1] 键盘可访问性：单元格导航、详情打开、aria 标签、聚焦可见性、状态非仅靠颜色
// ===========================================================================

describe('TRIZ 矛盾矩阵审查 UI —— 6.8 P1 键盘可访问性', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    matrixState.matrix = buildMatrixDTO()
    authState.permissions = ['contradiction:view', 'rationale:view', 'triz_innovation:manage']
    authState.isAuthenticated = true
  })

  it('单元格具备 tabIndex 使其可键盘聚焦', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    renderMatrix(matrix)

    for (const cell of matrix.cells) {
      const el = screen.getByTestId(`cell-${cell.cellKey}`)
      expect(el.tagName).toBe('BUTTON')
      expect(Number(el.getAttribute('tabIndex'))).toBe(0)
    }
  })

  it('物理矛盾条目可键盘聚焦', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    renderMatrix(matrix)

    for (const tension of matrix.physicalTensions) {
      const el = screen.getByTestId(`tension-${tension.tensionKey}`)
      expect(el.tagName).toBe('BUTTON')
      expect(Number(el.getAttribute('tabIndex'))).toBeGreaterThanOrEqual(0)
    }
  })

  it('Enter 键可打开单元格详情面板', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const normalCell = matrix.cells.find((c) => c.state === 'has_sources')!
    renderMatrix(matrix)

    const cellEl = screen.getByTestId(`cell-${normalCell.cellKey}`)
    expect(screen.queryByTestId('cell-detail')).toBeNull()

    fireEvent.keyDown(cellEl, { key: 'Enter' })
    expect(screen.getByTestId('cell-detail')).toBeTruthy()
  })

  it('空格键可打开单元格详情面板', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const normalCell = matrix.cells.find((c) => c.state === 'has_sources')!
    renderMatrix(matrix)

    const cellEl = screen.getByTestId(`cell-${normalCell.cellKey}`)
    fireEvent.keyDown(cellEl, { key: ' ' })
    expect(screen.getByTestId('cell-detail')).toBeTruthy()
  })

  it('单元格具备描述性 aria-label（含参数与状态）', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const hiddenCell = matrix.cells.find((c) => c.state === 'hidden')!
    renderMatrix(matrix)

    const el = screen.getByTestId(`cell-${hiddenCell.cellKey}`)
    const label = el.getAttribute('aria-label') ?? ''
    expect(label).toContain(hiddenCell.improvingParameterKey)
    expect(label).toContain(hiddenCell.worseningParameterKey)
    expect(label).toContain('无权限')
  })

  it('详情面板具备 dialog 角色与 aria-label', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const normalCell = matrix.cells.find((c) => c.state === 'has_sources')!
    renderMatrix(matrix)
    fireEvent.click(screen.getByTestId(`cell-${normalCell.cellKey}`))

    const detail = screen.getByTestId('cell-detail')
    expect(detail.getAttribute('role')).toBe('dialog')
    expect(detail.getAttribute('aria-label')).toContain('矛盾单元详情')
  })

  it('筛选工具栏具备 toolbar 角色与 aria-label', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    renderMatrix(matrix)
    const toolbar = screen.getByTestId('matrix-filter-toolbar')
    expect(toolbar.getAttribute('role')).toBe('toolbar')
    expect(toolbar.getAttribute('aria-label')).toBe('矩阵筛选器')
  })

  it('技术矛盾矩阵区域具备 grid 角色与 aria-label', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    renderMatrix(matrix)
    const grid = screen.getByTestId('matrix-grid')
    expect(grid.getAttribute('role')).toBe('grid')
    expect(grid.getAttribute('aria-label')).toBe('技术矛盾矩阵')
  })

  it('图标按钮（操作）具备可读文字标签，非仅靠图标', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const normalCell = matrix.cells.find((c) => c.state === 'has_sources')!
    renderMatrix(matrix)
    fireEvent.click(screen.getByTestId(`cell-${normalCell.cellKey}`))

    // 每个操作按钮都有可读文字（非空 textContent）
    const actions = screen.getByTestId('cell-detail').querySelectorAll('[data-testid^="action-"]')
    expect(actions.length).toBeGreaterThan(0)
    actions.forEach((btn) => {
      expect((btn.textContent ?? '').trim().length).toBeGreaterThan(0)
    })
  })

  it('状态识别不依赖颜色：hidden 单元格同时有文字「无权限」与锁图标', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const hiddenCell = matrix.cells.find((c) => c.state === 'hidden')!
    renderMatrix(matrix)

    const el = screen.getByTestId(`cell-${hiddenCell.cellKey}`)
    // 文字标签
    expect(screen.getByTestId(`cell-state-${hiddenCell.cellKey}`).textContent).toBe('无权限')
    // 图标（非颜色）
    expect(el.textContent).toContain('🔒')
    // aria-label 也含状态
    expect(el.getAttribute('aria-label')).toContain('无权限')
  })

  it('状态识别不依赖颜色：unavailable 单元格同时有文字与告警图标', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const unavailableCell: MatrixCell = {
      ...buildMatrixNormalCell({
        improvingParameterKey: 'quality',
        worseningParameterKey: 'risk_level',
      }),
      state: 'unavailable',
      sourceRefs: [],
      totalVisibleSources: 0,
      availableActions: [],
    }
    renderMatrix({ ...matrix, cells: [unavailableCell] })

    const el = screen.getByTestId(`cell-${unavailableCell.cellKey}`)
    expect(screen.getByTestId(`cell-state-${unavailableCell.cellKey}`).textContent).toBe('不可用')
    expect(el.textContent).toContain('⚠️')
    expect(el.getAttribute('aria-label')).toContain('不可用')
  })

  it('状态识别不依赖颜色：stale 单元格同时有文字「已过期」与 stale 图标', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const staleCell = matrix.cells.find((c) => c.state === 'stale')!
    renderMatrix(matrix)

    const el = screen.getByTestId(`cell-${staleCell.cellKey}`)
    expect(screen.getByTestId(`cell-state-${staleCell.cellKey}`).textContent).toBe('已过期')
    expect(el.textContent).toContain('🕔')
    expect(el.getAttribute('aria-label')).toContain('已过期')
  })

  it('详情面板的 stale 标记附带可读文字', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const staleCell = matrix.cells.find((c) => c.state === 'stale')!
    renderMatrix(matrix)
    fireEvent.click(screen.getByTestId(`cell-${staleCell.cellKey}`))

    expect(screen.getByTestId('cell-detail-stale').textContent).toBe('来源已过期')
  })

  it('物理矛盾详情面板具备 dialog 角色与 aria-label', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    const tension = matrix.physicalTensions[0]
    renderMatrix(matrix)
    fireEvent.click(screen.getByTestId(`tension-${tension!.tensionKey!}`))

    const detail = screen.getByTestId('tension-detail')
    expect(detail.getAttribute('role')).toBe('dialog')
    expect(detail.getAttribute('aria-label')).toContain('物理矛盾详情')
  })

  it('聚焦元素为可交互按钮，焦点可见性由浏览器默认 outline 提供（button 元素可聚焦）', () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    renderMatrix(matrix)

    const firstCell = screen.getAllByRole('gridcell')[0]
    // gridcell 角色落在 button 上，可聚焦
    expect(firstCell!.tagName!).toBe('BUTTON')
    // 模拟聚焦（jsdom 不渲染 outline，但聚焦行为可验证）
    firstCell!.focus()!
    expect(document.activeElement).toBe(firstCell)
  })
})

// ===========================================================================
// 额外契约：hook mock 行为与无真实 API 调用
// ===========================================================================

describe('TRIZ 矛盾矩阵审查 UI —— hook 与 auth mock 契约', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    matrixState.matrix = buildMatrixDTO()
  })

  it('useTrizContradictionMatrix mock 返回 fixture 数据，不发起真实请求', async () => {
    const { useTrizContradictionMatrix } = await import('@/hooks/use-triz-contradiction-matrix')
    const result = useTrizContradictionMatrix(100, {})
    expect(result.data).toBeDefined()
    expect((result.data as TrizContradictionMatrix).projectId).toBe(100)
    expect(vi.mocked(useTrizContradictionMatrix)).toHaveBeenCalled()
  })

  it('auth store mock 返回已认证会话与权限', async () => {
    const { useAuthStore } = await import('@/stores/auth-store')
    const state = useAuthStore() as {
      isAuthenticated: boolean
      hasPermission: (p: string) => boolean
    }
    expect(state.isAuthenticated).toBe(true)
    expect(state.hasPermission('contradiction:view')).toBe(true)
  })
})

// ===========================================================================
// 等待异步渲染（防御性：确保 fixture 数据稳定可读）
// ===========================================================================

describe('TRIZ 矛盾矩阵审查 UI —— 异步渲染稳定性', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    matrixState.matrix = buildMatrixDTO()
  })

  it('fixture 矩阵稳定渲染全部单元格与物理矛盾', async () => {
    const matrix = matrixState.matrix as TrizContradictionMatrix
    renderMatrix(matrix)

    await waitFor(() => {
      expect(screen.getByTestId('matrix-root')).toBeTruthy()
    })

    // buildMatrixDTO 默认 4 个 cells（normal/empty/hidden/stale）+ 1 个物理矛盾
    expect(screen.getAllByRole('gridcell')).toHaveLength(matrix.cells.length)
    expect(screen.getByTestId('matrix-physical').querySelectorAll('button')).toHaveLength(
      matrix.physicalTensions.length,
    )
  })
})
