/**
 * 生成剧场后台运行状态 → 通知文案（纯函数）。
 *
 * - `attention`：需要用户处理（手动模式下等回答 / 等开始生成 / 草案待审查；任何模式下失败；
 *   全自动转正完成也提醒一次），用户不在生成剧场页时发通知；
 * - `key`：同一件事只通知一次（换题、换版本、换阶段才算新的一件）。
 */
import { isTheaterReady } from '@/lib/next/theater-runner'
import type { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

type DraftState = ReturnType<typeof useAiProjectDraftStore.getState>

export type TheaterRunPhase =
  | 'none'
  | 'analyzing'
  | 'clarifying'
  | 'understanding'
  | 'ready'
  | 'generating'
  | 'review'
  | 'auto_confirming'
  | 'confirmed'
  | 'error'

export interface TheaterRunStatus {
  phase: TheaterRunPhase
  /** 全自动（用户在 AI 同事里选了全自动，或剧场正在全自动开始生成）。 */
  auto: boolean
  attention: boolean
  key: string
  title: string
  detail: string
  /** 点通知 / 卡片去哪里。 */
  href: string
  actionLabel: string
}

const THEATER_HREF = '/next/create'

export function describeTheaterRun(state: DraftState, autoLinked: boolean): TheaterRunStatus {
  const auto = autoLinked || state.autoPilot
  const base = { auto, href: THEATER_HREF, actionLabel: '前往生成剧场' }
  const idea = state.rawInput.trim()
  const subject = idea ? `「${idea.length > 24 ? `${idea.slice(0, 24)}…` : idea}」` : '项目'

  if (state.status === 'error' || state.draftStatus === 'error' || state.draftFailure) {
    const message = state.draftFailure?.message ?? state.error ?? '未知原因'
    return {
      ...base,
      phase: 'error',
      attention: true,
      key: `error:${state.draftId ?? ''}:${message}`,
      title: `生成${subject}没有完成`,
      detail: `${message}。点这里回到生成剧场重试。`,
    }
  }
  if (state.draftStatus === 'confirmed' && state.confirmResponse) {
    const projectId = state.confirmResponse.projectId
    return {
      ...base,
      phase: 'confirmed',
      attention: true,
      key: `confirmed:${projectId}`,
      title: `${subject}已转为正式项目`,
      detail: '项目已创建，之后要调整请发起变更。',
      href: `/next/projects/${projectId}`,
      actionLabel: '打开项目',
    }
  }
  if (state.draft && state.validation && state.draftStatus !== 'drafting') {
    if (autoLinked) {
      return {
        ...base,
        phase: 'auto_confirming',
        attention: false,
        key: `auto_confirming:${state.draftId}:${state.draftVersion}`,
        title: `AI 同事正在修正并转正${subject}`,
        detail: '全自动进行中，完成后会通知你。',
      }
    }
    return {
      ...base,
      phase: 'review',
      attention: true,
      key: `review:${state.draftId}:${state.draftVersion}`,
      title: `${subject}的草案已生成，等你审查`,
      detail: '确认无误后点「确认转正」才会成为正式项目。',
    }
  }
  if (state.draftStatus === 'drafting') {
    return {
      ...base,
      phase: 'generating',
      attention: false,
      key: `generating:${state.draftId}`,
      title: `正在生成${subject}的草案`,
      detail: auto ? '全自动进行中，可以继续做别的事。' : '可以继续做别的事，生成完会通知你。',
    }
  }
  if (state.status === 'analyzing') {
    return {
      ...base,
      phase: 'analyzing',
      attention: false,
      key: 'analyzing',
      title: `AI 正在理解${subject}`,
      detail: '正在准备澄清问题。',
    }
  }
  if (state.status === 'clarifying') {
    const card = state.activeCard ?? state.cards[0] ?? null
    return {
      ...base,
      phase: 'clarifying',
      attention: !auto,
      key: `clarifying:${card?.cardId ?? ''}`,
      title: auto ? `AI 同事正在回答澄清问题` : `生成剧场在等你回答问题`,
      detail: card ? card.title : '有新的澄清问题。',
    }
  }
  if (isTheaterReady(state)) {
    if (state.understandingStatus === 'idle' || state.understandingStatus === 'loading') {
      return {
        ...base,
        phase: 'understanding',
        attention: false,
        key: 'understanding',
        title: `AI 正在梳理${subject}的项目理解`,
        detail: '要解决的问题、成功画面、业务流程与能力地图。',
      }
    }
    return {
      ...base,
      phase: 'ready',
      attention: !auto,
      key: `ready:${state.understandingStatus}`,
      title: auto ? `即将开始生成${subject}` : `${subject}已准备好，可以开始生成`,
      detail: auto ? '全自动进行中。' : '项目理解已梳理完，回生成剧场核对后点「开始生成」。',
    }
  }
  return { ...base, phase: 'none', attention: false, key: 'none', title: '', detail: '' }
}
