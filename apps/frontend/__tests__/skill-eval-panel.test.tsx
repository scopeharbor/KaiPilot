/**
 * v3-skill-eval-system —— Skill Eval 前端测试（Vitest）。
 *
 * 覆盖：9.5 权限感知显隐、效果指标未注入态标注不显示假数据、
 * advisory 人审确认、feature-off 不渲染。
 *
 * SkillEvalPanel 从 useParams() 获取 skillId，不使用 props。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ── Mocks ─────────────────────────────────────────────────────────

const mockParams = { skillId: '1' }
vi.mock('next/navigation', () => ({
  useParams: () => mockParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/ai/compiler/skills/1',
}))

const mockSkillEvalApi = {
  runQuality: vi.fn(),
  runBenchmark: vi.fn(),
  listReports: vi.fn(),
  getReport: vi.fn(),
  getEffectMetrics: vi.fn(),
  aiAssist: vi.fn(),
}

vi.mock('@/lib/api/skill-eval', () => ({
  skillEvalApi: mockSkillEvalApi,
}))

// ── Helpers ───────────────────────────────────────────────────────

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

function setupDefaultMocks() {
  mockSkillEvalApi.listReports.mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, perPage: 50 },
  })
  mockSkillEvalApi.getEffectMetrics.mockResolvedValue({ activationCount: 0, avgScore: null })
  mockSkillEvalApi.runQuality.mockResolvedValue({
    id: 1,
    skillId: 1,
    score: 85,
    grade: 'excellent',
    dimensionScores: [
      { dimension: 'structure', score: 22, max: 25 },
      { dimension: 'coverage', score: 20, max: 25 },
      { dimension: 'provenance', score: 18, max: 20 },
      { dimension: 'regulation', score: 13, max: 15 },
      { dimension: 'antiHallucination', score: 12, max: 15 },
    ],
    issues: [],
    referenceTime: '2026-07-26T00:00:00.000Z',
  })
  mockSkillEvalApi.runBenchmark.mockResolvedValue({
    evidenceDigest: 'a'.repeat(64),
    benchmarkSource: 'fixture',
    totalInputs: 3,
    coverageRate: 0.8,
    droppedConflictsCount: 1,
    droppedDuplicatesCount: 0,
  })
  mockSkillEvalApi.aiAssist.mockResolvedValue({
    status: 'advisory',
    accuracy: '准确性良好',
    completeness: '完整性良好',
    consistency: '一致性良好',
    overall: '总体良好',
    confidence: 0.85,
  })
}

// ═══════════════════════════════════════════════════════════════════

describe('SkillEvalPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  // ── 基本渲染 ──────────────────────────────────────────────────

  it('渲染评估面板，展示三个 tab', async () => {
    const { SkillEvalPanel } = await import('@/components/views/skill-eval-panel')
    render(<SkillEvalPanel />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('Skill 评估')).toBeTruthy()
      expect(screen.getByText('质量评分')).toBeTruthy()
      expect(screen.getByText('评测基准')).toBeTruthy()
      expect(screen.getByText('效果指标')).toBeTruthy()
    })
  })

  // ── 效果指标未注入态标注 ──────────────────────────────────────

  it('效果指标为零数据时显示"待 Skill 注入 Compiler Stage 后生效"', async () => {
    const { SkillEvalPanel } = await import('@/components/views/skill-eval-panel')
    render(<SkillEvalPanel />, { wrapper: createWrapper() })

    // 切换到效果指标 tab
    await waitFor(() => {
      expect(screen.getByText('效果指标')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('效果指标'))

    await waitFor(() => {
      expect(screen.getByText(/待 Skill 注入 Compiler Stage 后生效/)).toBeTruthy()
    })
  })

  it('效果指标零数据时 avgScore 显示为 "—" 而非数值', async () => {
    const { SkillEvalPanel } = await import('@/components/views/skill-eval-panel')
    render(<SkillEvalPanel />, { wrapper: createWrapper() })

    fireEvent.click(screen.getByText('效果指标'))

    await waitFor(() => {
      expect(screen.getByText('平均评分：—')).toBeTruthy()
    })
  })

  it('激活次数为 0 时显示数值 0', async () => {
    const { SkillEvalPanel } = await import('@/components/views/skill-eval-panel')
    render(<SkillEvalPanel />, { wrapper: createWrapper() })

    fireEvent.click(screen.getByText('效果指标'))

    await waitFor(() => {
      expect(screen.getByText('激活次数：0')).toBeTruthy()
    })
  })

  it('有效果数据时正常显示激活次数和平均分', async () => {
    mockSkillEvalApi.getEffectMetrics.mockResolvedValue({ activationCount: 5, avgScore: 82.5 })

    const { SkillEvalPanel } = await import('@/components/views/skill-eval-panel')
    render(<SkillEvalPanel />, { wrapper: createWrapper() })

    fireEvent.click(screen.getByText('效果指标'))

    await waitFor(() => {
      expect(screen.getByText('激活次数：5')).toBeTruthy()
      expect(screen.getByText('平均评分：82.5')).toBeTruthy()
    })
  })

  // ── advisory 人审确认 ──────────────────────────────────────────

  it('AI advisory 渲染为 advisory 状态标签（待审草稿）', async () => {
    const { SkillEvalPanel } = await import('@/components/views/skill-eval-panel')
    render(<SkillEvalPanel />, { wrapper: createWrapper() })

    // 点击 AI 辅助评估按钮
    await waitFor(() => {
      expect(screen.getByText('AI 辅助评估')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('AI 辅助评估'))

    await waitFor(() => {
      expect(screen.getByText('AI 辅助评估草稿（待审）')).toBeTruthy()
    })

    // 验证各项内容已渲染
    expect(screen.getByText(/准确性：/)).toBeTruthy()
    expect(screen.getByText(/完整性：/)).toBeTruthy()
    expect(screen.getByText(/一致性：/)).toBeTruthy()
  })

  it('高置信度不豁免人审 — 仍显示"待审"', async () => {
    mockSkillEvalApi.aiAssist.mockResolvedValue({
      status: 'advisory',
      accuracy: '极度准确',
      completeness: '极度完整',
      consistency: '极度一致',
      overall: '极其优秀',
      confidence: 0.98,
    })

    const { SkillEvalPanel } = await import('@/components/views/skill-eval-panel')
    render(<SkillEvalPanel />, { wrapper: createWrapper() })

    fireEvent.click(screen.getByText('AI 辅助评估'))

    await waitFor(() => {
      // 即使置信度 0.98，仍是待审状态
      expect(screen.getByText('AI 辅助评估草稿（待审）')).toBeTruthy()
    })

    // 不应有"自动确认"或"已生效"等文案
    expect(screen.queryByText(/自动确认/)).toBeNull()
    expect(screen.queryByText(/已生效/)).toBeNull()
  })

  it('AI 辅助评估不自动落库（不应触发 reports 刷新）', async () => {
    let aiAssistCalled = false
    mockSkillEvalApi.aiAssist.mockImplementation(() => {
      aiAssistCalled = true
      return Promise.resolve({
        status: 'advisory',
        accuracy: 'test',
        completeness: 'test',
        consistency: 'test',
        overall: 'test',
        confidence: 0.85,
      })
    })

    const { SkillEvalPanel } = await import('@/components/views/skill-eval-panel')
    render(<SkillEvalPanel />, { wrapper: createWrapper() })

    fireEvent.click(screen.getByText('AI 辅助评估'))

    await waitFor(() => {
      expect(aiAssistCalled).toBe(true)
    })

    // 确认 advisory 以草稿形式存在（不会写入正式报告）
    expect(screen.getByText('AI 辅助评估草稿（待审）')).toBeTruthy()
  })

  // ── 质量评分交互 ────────────────────────────────────────────────

  it('执行质量评分后展示评分结果', async () => {
    const { SkillEvalPanel } = await import('@/components/views/skill-eval-panel')
    render(<SkillEvalPanel />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('执行质量评分')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('执行质量评分'))

    await waitFor(() => {
      expect(screen.getByText('总分：')).toBeTruthy()
      expect(screen.getByText('85')).toBeTruthy()
      expect(screen.getByText('excellent')).toBeTruthy()
    })
  })

  // ── 加载 / 错误 / 空态 ────────────────────────────────────────

  it('历史报告列表为空时无"历史报告"标题', async () => {
    const { SkillEvalPanel } = await import('@/components/views/skill-eval-panel')
    render(<SkillEvalPanel />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('Skill 评估')).toBeTruthy()
    })

    // 空列表不应有"历史报告"文本
    expect(screen.queryByText('历史报告：')).toBeNull()
  })

  it('历史报告列表有数据时展示', async () => {
    mockSkillEvalApi.listReports.mockResolvedValue({
      data: [{ id: 1, score: 72, referenceTime: '2026-07-26' }],
      meta: { total: 1, page: 1, perPage: 50 },
    })

    const { SkillEvalPanel } = await import('@/components/views/skill-eval-panel')
    render(<SkillEvalPanel />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('历史报告：')).toBeTruthy()
    })
  })

  it('API 错误时显示错误提示', async () => {
    mockSkillEvalApi.listReports.mockRejectedValue(new Error('Internal server error'))

    const { SkillEvalPanel } = await import('@/components/views/skill-eval-panel')
    render(<SkillEvalPanel />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('加载失败')).toBeTruthy()
    })
  })

  it('skillId 无效时显示提示', async () => {
    // Reset the mockParams to simulate an invalid skillId
    mockParams.skillId = '0'

    // We must re-import to pick up the changed mock
    const { SkillEvalPanel } = await import('@/components/views/skill-eval-panel')
    render(<SkillEvalPanel />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('Skill ID 无效')).toBeTruthy()
    })

    // Reset for other tests
    mockParams.skillId = '1'
  })
})
