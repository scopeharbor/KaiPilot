import { describe, expect, it } from 'vitest'
import {
  COLLEAGUE_HANDOFF_MARKER,
  parseColleagueAnswerDirectives,
} from '../src/ai-colleague-app-map.js'

describe('AI 同事问答交接标记', () => {
  it('交接标记：要求转交执行器，正文为空', () => {
    expect(parseColleagueAnswerDirectives(COLLEAGUE_HANDOFF_MARKER)).toEqual({
      text: '',
      handoff: true,
      openPath: null,
    })
  })

  it('打开标记：取出站内路径并从正文去掉', () => {
    const parsed = parseColleagueAnswerDirectives(
      'AI 连接在「设置 · AI 与集成」分组。\n[[AI同事:打开:/next/settings/ai-connections]]',
    )
    expect(parsed.text).toBe('AI 连接在「设置 · AI 与集成」分组。')
    expect(parsed.openPath).toBe('/next/settings/ai-connections')
    expect(parsed.handoff).toBe(false)
  })

  it('不接受站外、带占位符或非 /next 的路径', () => {
    for (const path of ['https://evil.example.com', '/next/projects/:id/charts', '/dashboard']) {
      const parsed = parseColleagueAnswerDirectives(`说明\n[[AI同事:打开:${path}]]`)
      expect(parsed.openPath).toBeNull()
      expect(parsed.text).toBe('说明')
    }
  })

  it('流式输出时隐藏末尾未写完的标记片段', () => {
    expect(parseColleagueAnswerDirectives('在设置里。\n[[AI同', { streaming: true }).text).toBe(
      '在设置里。',
    )
    expect(
      parseColleagueAnswerDirectives('在设置里。\n[[AI同事:打开:/next/se', { streaming: true })
        .text,
    ).toBe('在设置里。')
    // 非流式时不吞正文
    expect(parseColleagueAnswerDirectives('数组 a[').text).toBe('数组 a[')
  })
})
