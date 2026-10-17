/**
 * AI 同事对话分页的纯工具（不依赖状态仓库，界面组件与仓库共用）。
 */

/** 同时打开的对话分页上限（像浏览器分页，超出时需先关掉一些）。 */
export const MAX_OPEN_TABS = 12

/** 对话标题：首条用户消息的前 24 个字。 */
export function conversationTitleOf(
  messages: ReadonlyArray<{ sender: string; content?: string }>,
): string {
  const first = messages.find((m) => m.sender === 'user' && m.content?.trim())
  const text = first?.content?.trim().replace(/\s+/g, ' ') ?? '新对话'
  return text.length > 24 ? `${text.slice(0, 24)}…` : text
}
