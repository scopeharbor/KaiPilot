/**
 * 帮助中心 TanStack Query keys + 数据获取（分层 query keys，见 AGENTS.md 前端约定）。
 */
import { fetchHelpIndex } from './client'

export const helpKeys = {
  all: ['help'] as const,
  index: () => [...helpKeys.all, 'index'] as const,
  article: (id: string) => [...helpKeys.all, 'article', id] as const,
}

export { fetchHelpIndex }
