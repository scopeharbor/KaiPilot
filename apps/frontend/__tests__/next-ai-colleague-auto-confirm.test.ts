/**
 * AI 同事全自动：草案生成后自己修正阻断项、接受系统自动修正、处理版本冲突并转正（同一个 confirm 端点，审计标记）。
 */
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { DraftValidationReport, ProjectDraft } from '@aiproj/types'
import { autoConfirmDraft, describeAutoConfirmOutcome } from '@/lib/next/ai-colleague-auto-confirm'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAuthStore } from '@/stores/auth-store'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { useTheaterColleagueBridge } from '@/hooks/use-theater-colleague-bridge'

const apiMock = vi.hoisted(() => ({
  confirm: vi.fn(),
  validate: vi.fn(),
  aiFix: vi.fn(),
  get: vi.fn(),
}))
vi.mock('@/lib/api/ai-draft', () => ({
  aiDraftApi: {
    confirm: apiMock.confirm,
    validate: apiMock.validate,
    aiFix: apiMock.aiFix,
    get: apiMock.get,
  },
}))
vi.mock('@/lib/api/ai-tools', () => ({
  aiToolsApi: { chooseTheaterAnswer: vi.fn(), suggestReplies: vi.fn() },
  isScheduleStaleError: () => false,
}))

const draft = {
  wbs: [{ id: 'w1', children: [] }],
  tasks: [{ id: 't1' }, { id: 't2' }],
  dependencies: [],
  acceptanceCriteria: [],
  milestoneHints: [],
  riskHints: [],
} as unknown as ProjectDraft

function validation(patch: Partial<DraftValidationReport> = {}): DraftValidationReport {
  return {
    blocking: [],
    warning: [],
    info: [],
    canConfirm: true,
    ...patch,
  } as DraftValidationReport
}

const blocked = (message: string, autoFixable = false) =>
  validation({
    canConfirm: false,
    blocking: [{ ruleId: 'VE-002', severity: 'blocking', message, path: null, autoFixable }],
  })

const response = {
  projectId: 88,
  createdCounts: {
    wbsNodes: 1,
    tasks: 2,
    dependencies: 0,
    milestones: 0,
    acceptanceCriteria: 0,
    risks: 0,
  },
}

beforeEach(() => {
  for (const mock of Object.values(apiMock)) mock.mockReset()
  apiMock.get.mockImplementation(async () => ({
    draftId: 'df_1',
    version: 4,
    draft,
    meta: {},
    validation: validation(),
  }))
  useAuthStore.setState({ permissions: ['ai:confirm', 'ai:trigger'], user: null } as never)
  useAiProjectDraftStore.setState({
    draftId: 'df_1',
    draft,
    draftVersion: 3,
    validation: validation(),
    pendingModifications: [],
    draftStatus: 'reviewing',
    confirmResponse: null,
  })
  useAiDraftConfirmStore.setState({ isConfirming: false, roleAssignments: {} })
})

describe('全自动：AI 同事自己修正并转正', () => {
  test('无阻断：全部接受、代为复核提醒、标记 AI 同事全自动，成功后进入已转正', async () => {
    useAiProjectDraftStore.setState({
      validation: validation({
        warning: [{ ruleId: 'W1', severity: 'warning', message: '工期偏紧', path: null }],
      }),
    })
    apiMock.confirm.mockResolvedValueOnce(response)
    const outcome = await autoConfirmDraft()
    expect(apiMock.confirm).toHaveBeenCalledWith(
      'df_1',
      expect.objectContaining({
        version: 3,
        mode: 'all',
        acknowledgedWarnings: true,
        confirmedVia: 'ai_colleague_autopilot',
        selection: expect.objectContaining({ taskIds: ['t1', 't2'] }),
      }),
    )
    expect(outcome).toMatchObject({ kind: 'confirmed', response, warningCount: 1 })
    expect(useAiProjectDraftStore.getState().draftStatus).toBe('confirmed')
    const text = describeAutoConfirmOutcome(outcome)
    expect(text).toContain('/next/projects/88')
    expect(text).toContain('1 条提醒已代为复核')
    expect(text).toContain('变更')
  })

  test('有阻断：先按系统规则自动修正，剩下的交给模型改，带着修改确认转正（不再问用户）', async () => {
    useAiProjectDraftStore.setState({ validation: blocked('工期与起止日不一致', true) })
    apiMock.validate.mockResolvedValueOnce({
      version: 4,
      report: blocked('依赖成环'),
      autoFixDiffs: [{ path: 'tasks[t1].durationDays' }],
    })
    const modifications = [{ path: 'dependencies[d2].predecessorId', value: 't1' }]
    apiMock.aiFix.mockResolvedValueOnce({
      version: 4,
      modifications,
      applied: modifications,
      operations: [],
      reasons: ['把成环的依赖改回原方向'],
      report: validation(),
      model: 'test/fix',
    })
    apiMock.confirm.mockResolvedValueOnce(response)
    const progress: string[] = []
    const outcome = await autoConfirmDraft({
      onProgress: (text) => progress.push(text),
      model: { connectionId: 5, modelId: 9 },
    })
    expect(apiMock.validate).toHaveBeenCalledWith(
      'df_1',
      expect.objectContaining({ autoFix: true, phase: 'all' }),
    )
    expect(apiMock.aiFix).toHaveBeenCalledWith('df_1', {
      version: 4,
      modifications: [],
      connectionId: 5,
      modelId: 9,
    })
    expect(apiMock.confirm).toHaveBeenCalledWith(
      'df_1',
      expect.objectContaining({ version: 4, modifications }),
    )
    expect(outcome).toMatchObject({ kind: 'confirmed', ruleFixes: 1, aiFixes: 1 })
    expect(progress.join('\n')).toContain('AI 同事正在修改草案')
    const text = describeAutoConfirmOutcome(outcome)
    expect(text).toContain('系统规则自动修正 1 处')
    expect(text).toContain('把成环的依赖改回原方向')
  })

  test('改字段修不了时 AI 同事做结构调整（增删任务 / 依赖）：载入新草案版本后转正；修正时版本过期自动重载', async () => {
    useAiProjectDraftStore.setState({ validation: blocked('缺少收尾任务') })
    apiMock.aiFix
      .mockRejectedValueOnce({ status: 422, details: { expected: 4, received: 3 } })
      .mockResolvedValueOnce({
        version: 5,
        modifications: [],
        applied: [],
        operations: [{ op: 'add_task', name: '上线验收' }, { op: 'remove_dependency' }],
        reasons: ['补上收尾任务并去掉多余依赖'],
        report: validation(),
        model: 'test/fix',
      })
    apiMock.get
      .mockResolvedValueOnce({
        draftId: 'df_1',
        version: 4,
        draft,
        meta: {},
        validation: blocked('缺少收尾任务'),
      })
      .mockResolvedValueOnce({
        draftId: 'df_1',
        version: 5,
        draft,
        meta: {},
        validation: validation(),
      })
    apiMock.confirm.mockResolvedValueOnce(response)
    const outcome = await autoConfirmDraft()
    expect(apiMock.aiFix).toHaveBeenLastCalledWith('df_1', { version: 4, modifications: [] })
    expect(apiMock.confirm).toHaveBeenCalledWith(
      'df_1',
      expect.objectContaining({ version: 5, modifications: [] }),
    )
    expect(outcome).toMatchObject({ kind: 'confirmed', structuralFixes: 2 })
    expect(describeAutoConfirmOutcome(outcome)).toContain('调整 2 处结构')
  })

  test('确认时服务端产生自动修正 / 版本过期：载入最新版本后继续，直到转正', async () => {
    apiMock.confirm
      .mockRejectedValueOnce({
        status: 422,
        details: { autoFixDiffs: [{ path: 'tasks[t1].endDate' }], version: 4 },
      })
      .mockRejectedValueOnce({ status: 422, details: { expected: 5, received: 4 } })
      .mockResolvedValueOnce(response)
    const outcome = await autoConfirmDraft()
    expect(apiMock.get).toHaveBeenCalledTimes(2)
    expect(apiMock.confirm).toHaveBeenCalledTimes(3)
    expect(outcome).toMatchObject({ kind: 'confirmed', ruleFixes: 1 })
    expect(useAiDraftConfirmStore.getState().isConfirming).toBe(false)
  })

  test('模型不可用 / 没有转正权限 / 用户停止：停下并说明原因', async () => {
    useAiProjectDraftStore.setState({ validation: blocked('依赖成环') })
    apiMock.aiFix.mockResolvedValueOnce({
      version: 3,
      modifications: [],
      applied: [],
      operations: [],
      reasons: [],
      report: blocked('依赖成环'),
      model: null,
      unavailable: true,
    })
    const outcome = await autoConfirmDraft()
    expect(outcome.kind).toBe('unfixable')
    expect(describeAutoConfirmOutcome(outcome)).toContain('依赖成环')
    expect(apiMock.confirm).not.toHaveBeenCalled()

    expect((await autoConfirmDraft({ isCancelled: () => true })).kind).toBe('cancelled')

    useAuthStore.setState({ permissions: [] } as never)
    expect((await autoConfirmDraft()).kind).toBe('no_permission')
    expect(apiMock.confirm).not.toHaveBeenCalled()
  })

  test('停止全自动：结束联动、剧场不再自动生成，对话里说明；手动模式下不起作用', () => {
    useAiProjectDraftStore.setState({ autoPilot: true })
    useNextAiColleagueStore.setState({ messages: [], theaterLink: { mode: 'auto' } })
    useNextAiColleagueStore.getState().stopAutopilot()
    expect(useNextAiColleagueStore.getState().theaterLink).toBeNull()
    expect(useAiProjectDraftStore.getState().autoPilot).toBe(false)
    expect(useNextAiColleagueStore.getState().messages.at(-1)?.content).toContain('已停止全自动')

    useNextAiColleagueStore.setState({ messages: [], theaterLink: { mode: 'manual' } })
    useNextAiColleagueStore.getState().stopAutopilot()
    expect(useNextAiColleagueStore.getState().theaterLink).toEqual({ mode: 'manual' })
    expect(useNextAiColleagueStore.getState().messages).toHaveLength(0)
  })

  test('联动：全自动模式下草案生成完成 → 进入审查 → 代为确认转正并在对话里汇报；手动模式只提醒去审查', async () => {
    const linked = {
      projectId: 91,
      createdCounts: {
        wbsNodes: 1,
        tasks: 2,
        dependencies: 0,
        milestones: 0,
        acceptanceCriteria: 0,
        risks: 0,
      },
    }
    apiMock.confirm.mockResolvedValueOnce(linked)
    useAiProjectDraftStore.setState({ draft: null, validation: null, draftStatus: 'drafting' })
    useNextAiColleagueStore.setState({ messages: [], theaterLink: { mode: 'auto' } })
    const { unmount } = renderHook(() => useTheaterColleagueBridge())
    useAiProjectDraftStore.setState({ draft, validation: validation(), draftStatus: null })
    await waitFor(() => expect(useNextAiColleagueStore.getState().theaterLink).toBeNull())
    expect(apiMock.confirm).toHaveBeenCalledTimes(1)
    expect(useAiProjectDraftStore.getState().draftStatus).toBe('confirmed')
    const said = useNextAiColleagueStore
      .getState()
      .messages.map((message) => message.content ?? '')
      .join('\n')
    expect(said).toContain('/next/projects/91')
    unmount()

    apiMock.confirm.mockClear()
    useAiProjectDraftStore.setState({ draft: null, validation: null, draftStatus: 'drafting' })
    useNextAiColleagueStore.setState({ messages: [], theaterLink: { mode: 'manual' } })
    const manual = renderHook(() => useTheaterColleagueBridge())
    useAiProjectDraftStore.setState({ draft, validation: validation(), draftStatus: null })
    await waitFor(() => expect(useNextAiColleagueStore.getState().theaterLink).toBeNull())
    expect(apiMock.confirm).not.toHaveBeenCalled()
    expect(
      useNextAiColleagueStore
        .getState()
        .messages.map((message) => message.content ?? '')
        .join('\n'),
    ).toContain('确认转正')
    manual.unmount()
  })
})
