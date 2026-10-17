import Link from 'next/link'
import { Settings2 } from 'lucide-react'
import { AI_CONNECTION_SETTINGS_PATH } from '@aiproj/types'
import { cn } from '@/lib/utils'

/**
 * 「没有可用 AI 连接」时的设置入口（v3-personal-edition-open-source-export 任务 4.6）。
 *
 * AI 草案、AI 同事、矛盾求解收到 `AI_CONNECTION_REQUIRED`（HTTP `details.reason`）或流式
 * `ai-connection-required` 时，在提示语旁渲染本按钮，跳到「设置 → AI 连接」添加模型与 API Key。
 */
export function AiConnectionRequiredAction({ className }: { className?: string }) {
  return (
    <Link
      href={AI_CONNECTION_SETTINGS_PATH}
      data-ai-connection-required-action
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] px-3 py-1.5 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:bg-[var(--nx-accent)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
        className,
      )}
    >
      <Settings2 className="h-3.5 w-3.5" aria-hidden />
      前往设置添加 AI 连接
    </Link>
  )
}
