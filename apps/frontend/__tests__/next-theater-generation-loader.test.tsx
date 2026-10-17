/**
 * v3-ui-next-theater-generation tasks 3.2 —— 品牌 Loader 等待态、7 阶段中文文案与纯派生 ETA。
 *
 * 覆盖：>3s 常驻主标题、<3s 不闪文案、7 阶段标准中文子说明、ETA 暖机期隐藏与收敛后
 * 呈现（全部经真实 selectDraftEta 纯派生，零本地倒计时）、品牌 SVG 深浅自适应，
 * 以及「禁止项目已创建类措辞」文案审查断言。
 */
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PROJECT_DRAFT_MODULES } from '@aiproj/types'
import type {
  DraftHeartbeatEvent,
  DraftProgressEvent,
  DraftStartedEvent,
  ProjectDraftModule,
  ProjectDraftStreamEvent,
} from '@aiproj/types'
import {
  createDraftProgressProjection,
  reduceDraftProgress,
  type DraftProgressProjection,
} from '@/lib/ai-draft/progress-projection'
import {
  BRAND_LOADER_DARK_SRC,
  BRAND_LOADER_LIGHT_SRC,
  PROGRESS_PHASE_COPY,
  TheaterGenerationLoader,
  WAIT_COPY_THRESHOLD_MS,
} from '@/components/next/theater/TheaterGenerationLoader'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

const themeState = vi.hoisted(() => ({ resolvedTheme: undefined as 'light' | 'dark' | undefined }))

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: themeState.resolvedTheme }),
}))

/** 禁措辞审查清单（spec「绝对禁止暗示项目已创建」：暗示正式表落库的违规词汇）。 */
const FORBIDDEN_COPY = [
  '项目已创建',
  '项目已完成',
  '创建成功',
  '项目创建完毕',
  '正式项目已入库',
  '已写入数据库',
]

function sessionReset() {
  sessionStorage.clear()
  useAiProjectDraftStore.setState({
    schemaVersion: '1.0',
    status: 'ready',
    draftStatus: 'drafting',
    draftId: 'pending',
    draftVersion: 1,
    draft: null,
    draftMeta: null,
    draftFailure: null,
    validation: null,
    lastEventSequence: 0,
    moduleStatuses: {},
    progressProjection: createDraftProgressProjection({
      draftId: 'pending',
      version: 1,
      connection: 'connecting',
    }),
  })
}

beforeEach(() => {
  themeState.resolvedTheme = 'light'
  sessionReset()
})

afterEach(() => {
  vi.useRealTimers()
})

/** 以真实事件归约构建投影（与服务端事件驱动完全同构，未注入任何伪进度）。 */
function buildProjection(events: ProjectDraftStreamEvent[]): DraftProgressProjection {
  let projection = createDraftProgressProjection({
    draftId: 'pending',
    version: 1,
    connection: 'connecting',
  })
  for (const event of events) {
    projection = reduceDraftProgress(projection, { kind: 'event', event })
  }
  return projection
}

function base<T extends ProjectDraftStreamEvent['type']>(
  sequence: number,
  type: T,
): { type: T; draftId: string; version: number; sequence: number } {
  return { type, draftId: 'draft-gen-1', version: 1, sequence }
}

function startedEvent(): DraftStartedEvent {
  return {
    ...base(1, 'draft.started'),
    projectType: 'software',
    modules: [...PROJECT_DRAFT_MODULES],
  }
}

function delta(sequence: number, module: ProjectDraftModule): ProjectDraftStreamEvent {
  return { ...base(sequence, 'module.delta'), module, status: 'generating' }
}

function completed(sequence: number, module: ProjectDraftModule): ProjectDraftStreamEvent {
  return { ...base(sequence, 'module.completed'), module }
}

function progress(sequence: number, phase: DraftProgressEvent['phase']): DraftProgressEvent {
  return { ...base(sequence, 'draft.progress'), phase, receivedChars: 100 }
}

function heartbeat(elapsedMs: number): DraftHeartbeatEvent {
  return { ...base(90, 'draft.heartbeat'), elapsedMs }
}

function seedProjection(events: ProjectDraftStreamEvent[]) {
  useAiProjectDraftStore.setState({ progressProjection: buildProjection(events) })
}

describe('components/next/theater/TheaterGenerationLoader（tasks 3.1）', () => {
  test('生成耗时未满 3 秒不展示常驻文案，仅保留读屏兜底', () => {
    seedProjection([startedEvent(), progress(3, 'receiving')])
    vi.useFakeTimers()
    try {
      render(<TheaterGenerationLoader />)

      expect(screen.queryByText('AI 正在生成项目草案')).toBeNull()
      expect(screen.getByText('草案生成中')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(WAIT_COPY_THRESHOLD_MS - 1)
      })
      expect(screen.queryByText('AI 正在生成项目草案')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('生成耗时超过 3 秒常驻展示主标题与标准中文阶段子说明', () => {
    seedProjection([startedEvent(), progress(2, 'receiving')])
    vi.useFakeTimers()
    try {
      render(<TheaterGenerationLoader />)
      act(() => {
        vi.advanceTimersByTime(WAIT_COPY_THRESHOLD_MS)
      })

      expect(screen.getByText('AI 正在生成项目草案')).toBeInTheDocument()
      expect(screen.getByText('正在接收草案结构')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  test('7 阶段标准中文子说明随 draft.progress 的 phase 动态切换', () => {
    vi.useFakeTimers()
    try {
      const phases = Object.keys(PROGRESS_PHASE_COPY) as DraftProgressEvent['phase'][]
      phases.forEach((phase) => {
        // 每次独立重播种：started(1) 后紧跟 progress(2)，保证序列连续无 gap。
        seedProjection([startedEvent(), progress(2, phase)])
        const { unmount } = render(<TheaterGenerationLoader />)
        act(() => {
          vi.advanceTimersByTime(WAIT_COPY_THRESHOLD_MS)
        })
        expect(screen.getByText(PROGRESS_PHASE_COPY[phase])).toBeInTheDocument()
        unmount()
      })
    } finally {
      vi.useRealTimers()
    }
  })

  test('ETA 暖机期（completed < 2，confidence=initial）完全隐藏', () => {
    seedProjection([
      startedEvent(),
      delta(2, 'charter'),
      progress(3, 'receiving'),
      completed(4, 'charter'),
      heartbeat(20_000),
    ])
    vi.useFakeTimers()
    try {
      render(<TheaterGenerationLoader />)
      act(() => {
        vi.advanceTimersByTime(WAIT_COPY_THRESHOLD_MS)
      })

      expect(screen.getByText('AI 正在生成项目草案')).toBeInTheDocument()
      expect(screen.queryByText(/预计剩余/)).toBeNull()
      expect(screen.queryByText(/估算中…/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('ETA 收敛后（completed >= 2）按纯派生展示预计剩余，无本地倒计时', () => {
    seedProjection([
      startedEvent(),
      delta(2, 'charter'),
      progress(3, 'receiving'),
      completed(4, 'charter'),
      delta(5, 'wbs'),
      progress(6, 'validating'),
      completed(7, 'wbs'),
      heartbeat(30_000),
    ])
    vi.useFakeTimers()
    try {
      render(<TheaterGenerationLoader />)
      act(() => {
        vi.advanceTimersByTime(WAIT_COPY_THRESHOLD_MS)
      })

      // (30000/2)*7 = 105000ms → 「~2 分钟」，完成率 2/9 < 50% → converging → 「估算中…」
      expect(screen.getByText('估算中…')).toBeInTheDocument()
      expect(screen.getByText('~2 分钟')).toBeInTheDocument()
      expect(screen.queryByText('预计剩余')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('ETA 达到 stable 后以「预计剩余」前缀呈现', () => {
    const events: ProjectDraftStreamEvent[] = [
      startedEvent(),
      delta(2, 'charter'),
      progress(3, 'receiving'),
      completed(4, 'charter'),
    ]
    let sequence = 5
    for (const module of ['wbs', 'tasks', 'dependencies', 'acceptance'] as ProjectDraftModule[]) {
      events.push(delta(sequence++, module))
      events.push(completed(sequence++, module))
    }
    events.push(progress(sequence, 'parsing'))
    events.push(heartbeat(24_000))
    seedProjection(events)

    vi.useFakeTimers()
    try {
      render(<TheaterGenerationLoader />)
      act(() => {
        vi.advanceTimersByTime(WAIT_COPY_THRESHOLD_MS)
      })

      // (24000/5)*4 = 19200ms → 「不到 1 分钟」，完成率 5/9 >= 50% → stable → 「预计剩余」
      expect(screen.getByText('预计剩余')).toBeInTheDocument()
      expect(screen.getByText('不到 1 分钟')).toBeInTheDocument()
      expect(screen.queryByText('估算中…')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('品牌 Loader 随主题自适应（light 默认 / dark 切暗色资产）', () => {
    seedProjection([startedEvent()])
    const { container, rerender } = render(<TheaterGenerationLoader />)
    const image = () => container.querySelector('img')

    expect(image()?.getAttribute('src')).toBe(BRAND_LOADER_LIGHT_SRC)
    expect(image()?.getAttribute('aria-hidden')).toBe('true')

    themeState.resolvedTheme = 'dark'
    rerender(<TheaterGenerationLoader />)
    expect(image()?.getAttribute('src')).toBe(BRAND_LOADER_DARK_SRC)
  })

  test('等待态全程杜绝「项目已创建」类违规措辞（含读屏文本与 ETA）', () => {
    seedProjection([
      startedEvent(),
      delta(2, 'charter'),
      progress(3, 'receiving'),
      completed(4, 'charter'),
      delta(5, 'wbs'),
      progress(6, 'validating'),
      completed(7, 'wbs'),
      heartbeat(30_000),
    ])
    vi.useFakeTimers()
    try {
      render(<TheaterGenerationLoader />)
      act(() => {
        vi.advanceTimersByTime(WAIT_COPY_THRESHOLD_MS)
      })

      expect(screen.getByText('AI 正在生成项目草案')).toBeInTheDocument()
      const bodyText = document.body.textContent ?? ''
      for (const forbidden of FORBIDDEN_COPY) {
        expect(bodyText).not.toContain(forbidden)
      }
      // 合规措辞常在
      expect(bodyText).toContain('AI 正在生成项目草案')
    } finally {
      vi.useRealTimers()
    }
  })
})
