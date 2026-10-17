'use client'

import { useEffect } from 'react'
import { aiToolsApi } from '@/lib/api/ai-tools'
import { autoConfirmDraft, describeAutoConfirmOutcome } from '@/lib/next/ai-colleague-auto-confirm'
import {
  currentTheaterCard,
  describeTheaterAnswer,
  fallbackAutoAnswer,
  finishTheaterRoundIfDone,
  ruleBasedAutoAnswer,
  theaterAnswerFromText,
} from '@/lib/next/ai-colleague-theater-bridge'
import { buildClarificationAnswer, useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import type { ClarificationAnswer, ClarificationCard } from '@aiproj/types'

/** 代答结果：答案 + 在对话里怎么交代（模型理由 / 兜底说明）。 */
export interface AutoAnswerOutcome {
  answer: ClarificationAnswer
  note: string | null
}

/**
 * 全自动代答：由 AI 同事的模型独立审阅这个问题与它的全部选项（含说明、推荐标记、默认值、
 * 原话解析值），结合项目原话与之前的回答选出答案——推荐 / 默认只是参考，不直接采用。
 * 模型不可用或给不出合法答案时，才按规则（原话 → 推荐 → 默认 → 第一个选项）兜底。
 */
export async function autoAnswerTheaterCard(
  card: ClarificationCard,
  previousAnswers: readonly { question: string; answer: string }[],
): Promise<AutoAnswerOutcome> {
  const { rawInput } = useAiProjectDraftStore.getState()
  const preference = useNextAiColleagueStore.getState().modelPreference
  try {
    const choice = await aiToolsApi.chooseTheaterAnswer({
      projectInput: rawInput.slice(0, 4000) || card.title,
      previousAnswers: previousAnswers.slice(-30),
      question: {
        title: card.title,
        description: card.description || null,
        reasoning: card.reasoning || null,
        questionType: card.questionType,
        options: card.quickOptions.map((option) => ({
          label: option.label,
          value: option.value,
          description: option.description || null,
          ...(option.recommended ? { recommended: true } : {}),
        })),
        customInput: Boolean(card.customInput?.enabled),
        defaultValue: card.defaultValue?.value ?? null,
        suggestedValue: card.suggestedValue ?? null,
        allowSkip: card.allowSkip,
        isRequired: card.isRequired,
      },
      ...(preference ? { connectionId: preference.connectionId, modelId: preference.modelId } : {}),
    })
    if (choice) {
      return {
        answer: buildClarificationAnswer(card, choice.action, choice.value),
        note: choice.reason ? `理由：${choice.reason}` : null,
      }
    }
  } catch {
    // 模型代答失败：按规则兜底
  }
  const ruled = ruleBasedAutoAnswer(card)
  if (ruled) return { answer: ruled, note: '模型暂时无法作答，按推荐 / 默认值代答' }
  // 纯自填题：再请模型按原话给一句回答
  try {
    const [first] = await aiToolsApi.suggestReplies({
      conversation: [{ role: 'user', text: `我要做的项目：${rawInput}`.slice(0, 4000) }],
      question: `${card.title}${card.description ? `（${card.description}）` : ''}`,
      ...(preference ? { connectionId: preference.connectionId, modelId: preference.modelId } : {}),
    })
    if (first) return { answer: theaterAnswerFromText(card, first), note: null }
  } catch {
    // 仍失败：用兜底
  }
  return { answer: fallbackAutoAnswer(card), note: '模型暂时无法作答，按常见做法代答' }
}

/**
 * AI 同事 ↔ 生成剧场联动（AI 同事发起一键生成后生效，见 store.theaterLink）：
 * - 手动：带到生成剧场由用户自己回答（离开剧场页时由后台运行器 TheaterBackgroundRunner 发通知提醒）；
 * - 全自动：AI 同事的模型逐题审阅问题与全部选项后代答，并告诉用户选了什么、为什么；剧场就绪后由剧场页自动开始生成；
 * - 进度播报：开始生成、草案已生成或失败，随后结束联动；手动模式提醒去审查，全自动模式（用户已选择
 *   包括转为正式项目）进入审查后由 AI 同事自己修正阻断项、接受系统自动修正、处理版本冲突并确认转正，
 *   全程不再询问用户（见 ai-colleague-auto-confirm）。
 * 挂在 AI 同事面板上（新版壳层常驻），离开剧场页也能在对话里继续回答。
 */
export function useTheaterColleagueBridge(): void {
  useEffect(() => {
    const handledCards = new Set<string>()
    /** 本次联动里已代答的问题（交给模型保持前后一致）。 */
    const answeredHistory: { question: string; answer: string }[] = []
    let lastDraftStatus: string | null = useAiProjectDraftStore.getState().draftStatus ?? null
    let lastStatus: string | null = useAiProjectDraftStore.getState().status ?? null
    let busy = false
    /** 全自动代为确认转正进行中（期间草案状态的变化不再触发联动）。 */
    let autoConfirming = false

    const tick = async () => {
      const colleague = useNextAiColleagueStore.getState()
      const link = colleague.theaterLink
      const draft = useAiProjectDraftStore.getState()
      const draftStatus = draft.draftStatus ?? null
      const status = draft.status ?? null
      const draftChanged = draftStatus !== lastDraftStatus
      const statusChanged = status !== lastStatus
      lastDraftStatus = draftStatus
      lastStatus = status
      if (!link) {
        handledCards.clear()
        return
      }

      if (draftChanged && draftStatus === 'drafting') {
        colleague.noteTheaterEvent('已开始生成项目草案，进度可以在生成剧场里看。')
      }
      if (autoConfirming) return
      if (
        draftChanged &&
        (draftStatus === 'reviewing' || draft.draft) &&
        draftStatus !== 'drafting'
      ) {
        if (link.mode !== 'auto') {
          colleague.noteTheaterEvent(
            '项目草案已生成 ✅ 请到 [生成剧场](/next/create) 审查：确认无误后点「确认转正」才会成为正式项目。',
          )
          colleague.endTheaterLink()
          return
        }
        // 全自动（用户已明确选择包括转为正式项目）：进入审查 → 校验无阻断即代为确认转正
        autoConfirming = true
        colleague.noteTheaterEvent(
          '项目草案已生成 ✅ 全自动进入审查：AI 同事会自己修正校验问题并确认转为正式项目，不会再问你。',
        )
        if (draftStatus !== 'reviewing') useAiProjectDraftStore.getState().enterReview()
        try {
          const outcome = await autoConfirmDraft({
            onProgress: (text) => useNextAiColleagueStore.getState().noteTheaterEvent(text),
            model: colleague.modelPreference
              ? {
                  connectionId: colleague.modelPreference.connectionId,
                  modelId: colleague.modelPreference.modelId,
                }
              : null,
            // 用户点了「停止全自动」
            isCancelled: () => useNextAiColleagueStore.getState().theaterLink === null,
          })
          useNextAiColleagueStore.getState().noteTheaterEvent(describeAutoConfirmOutcome(outcome))
        } finally {
          autoConfirming = false
          lastDraftStatus = useAiProjectDraftStore.getState().draftStatus ?? null
          useNextAiColleagueStore.getState().endTheaterLink()
        }
        return
      }
      if ((draftChanged && draftStatus === 'error') || (statusChanged && status === 'error')) {
        colleague.noteTheaterEvent(
          `生成没有完成：${draft.draftFailure?.message ?? draft.error ?? '未知原因'}。可以在 [生成剧场](/next/create) 重试。`,
        )
        colleague.endTheaterLink()
        return
      }

      // 用户在剧场里直接答掉的问题：对话里那张转发卡标为已处理
      colleague.settleTheaterQuestions(
        draft.status === 'clarifying'
          ? [...draft.cards.map((item) => item.cardId), draft.activeCard?.cardId ?? '']
          : [],
      )
      const card = currentTheaterCard()
      if (!card || handledCards.has(card.cardId) || busy) return
      handledCards.add(card.cardId)
      // 手动：用户在生成剧场里自己回答；不在剧场页时由后台运行器发通知提醒
      if (link.mode === 'manual') return
      busy = true
      try {
        const { answer, note } = await autoAnswerTheaterCard(card, answeredHistory)
        // 代答期间用户可能已在剧场里自己答了
        if (currentTheaterCard()?.cardId !== card.cardId) return
        useAiProjectDraftStore.getState().recordAnswer(answer)
        const described = describeTheaterAnswer(card, answer)
        answeredHistory.push({ question: card.title, answer: described })
        colleague.noteTheaterEvent(
          `已代答「${card.title}」：${described}${note ? `（${note}）` : ''}`,
        )
        finishTheaterRoundIfDone()
      } finally {
        busy = false
        // 同一轮可能还有下一题
        void tick()
      }
    }

    const unsubscribeDraft = useAiProjectDraftStore.subscribe(() => void tick())
    const unsubscribeColleague = useNextAiColleagueStore.subscribe((state, previous) => {
      if (state.theaterLink !== previous.theaterLink) void tick()
    })
    void tick()
    return () => {
      unsubscribeDraft()
      unsubscribeColleague()
    }
  }, [])
}
