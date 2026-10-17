'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowLeft, CheckCircle2 } from 'lucide-react'

/**
 * 集成回调契约镜像页（/next/settings/integrations/callback，
 * v3-ui-next-settings-admin-domains W5 · tasks 5.8，spec「第三方集成与回调契约」/ design D-INT）。
 *
 * 【契约归属与架构决策 D-INT 说明】：
 * 后端 IntegrationsController.callback（apps/backend/app/controllers/integrations_controller.ts:72）
 * 将 OAuth 外部回跳硬编码 302 重定向至 `{FRONTEND_URL}/settings/integrations/callback`。
 * 该路径已作为 GitHub、GitLab、Google 等外部 OAuth Provider 控制台登记的
 * redirect_uri 物理契约锚点，不可中断。
 *
 * 为保持双轨平滑并避免破坏外部 OAuth 流程：
 * 1. 旧轨路由 `/settings/integrations/callback` 作为「契约保留页」物理保留、不迁不删；
 * 2. 本新轨镜像页承接同参（provider / status / codeReceived / message / errorCode）
 *    的双态渲染，供新轨用户手工直达或书签等价访问；
 * 3. 【B8 退役方案】：在后续 B8 旧轨退役批次中，可将旧轨路由原地替换为同路径 Next Route Handler，
 *    或引入 `INTEGRATIONS_CALLBACK_PATH` 环境变量将后端 302 重定向统一致切新轨。
 */

export interface IntegrationCallbackPageProps {
  searchParams?:
    | Promise<{
        provider?: string
        status?: string
        codeReceived?: string
        message?: string
        errorCode?: string
      }>
    | {
        provider?: string
        status?: string
        codeReceived?: string
        message?: string
        errorCode?: string
      }
}

export function IntegrationCallbackPage(props: IntegrationCallbackPageProps) {
  const urlSearchParams = useSearchParams()

  // 解析 searchParams（兼容 props 与 URL 实时状态）
  const resolvedFromProps =
    props.searchParams && typeof (props.searchParams as Promise<unknown>).then === 'function'
      ? React.use(
          props.searchParams as Promise<{
            provider?: string
            status?: string
            codeReceived?: string
            message?: string
            errorCode?: string
          }>,
        )
      : (props.searchParams as
          | {
              provider?: string
              status?: string
              codeReceived?: string
              message?: string
              errorCode?: string
            }
          | undefined)

  const provider = resolvedFromProps?.provider ?? urlSearchParams?.get('provider') ?? undefined
  const status = resolvedFromProps?.status ?? urlSearchParams?.get('status') ?? undefined
  const codeReceived =
    resolvedFromProps?.codeReceived ?? urlSearchParams?.get('codeReceived') ?? undefined
  const message = resolvedFromProps?.message ?? urlSearchParams?.get('message') ?? undefined
  const errorCode = resolvedFromProps?.errorCode ?? urlSearchParams?.get('errorCode') ?? undefined

  const isSuccess = status === 'connected' || status === 'preconnected'

  let displayTitle: string
  if (status === 'connected' && provider === 'github') {
    displayTitle = 'GitHub 已连接'
  } else if (status === 'connected' && provider === 'gitlab') {
    displayTitle = 'GitLab 已连接'
  } else if (status === 'connected' && provider === 'google_calendar') {
    displayTitle = 'Google Calendar 已连接'
  } else if (status === 'connected') {
    displayTitle = `${provider || '第三方服务'} 已连接`
  } else if (status === 'preconnected') {
    displayTitle = 'OAuth 预连接已完成'
  } else {
    displayTitle = 'OAuth 预连接未完成'
  }

  return (
    <div
      data-integrations-callback-mirror
      className="mx-auto flex max-w-lg flex-col items-center justify-center gap-6 px-4 py-16 text-center"
    >
      {/* 状态大图标 */}
      <span
        data-testid="callback-status-icon"
        className={
          isSuccess
            ? 'flex h-16 w-16 items-center justify-center rounded-2xl border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.1)] text-[var(--nx-status-success)]'
            : 'flex h-16 w-16 items-center justify-center rounded-2xl border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.1)] text-[var(--nx-status-warning)]'
        }
      >
        {isSuccess ? (
          <CheckCircle2 className="h-9 w-9" aria-hidden />
        ) : (
          <AlertCircle className="h-9 w-9" aria-hidden />
        )}
      </span>

      <div className="flex flex-col gap-2">
        <h1
          data-testid="callback-title"
          className="text-xl font-semibold tracking-tight text-[var(--nx-text-primary)]"
        >
          {displayTitle}
        </h1>

        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          {message || '当前版本只校验回调链路，不交换 token，也不会开始同步或外部推送。'}
        </p>

        {provider ? (
          <p className="text-[11px] text-[var(--nx-text-secondary)]">
            Provider 标识：
            <span className="font-mono text-[var(--nx-text-primary)]">{provider}</span>
          </p>
        ) : null}

        {codeReceived ? (
          <p className="text-[11px] text-[var(--nx-status-success)]">回调凭证：已成功接收校验码</p>
        ) : null}

        {errorCode ? (
          <p className="text-[11px] text-[var(--nx-status-danger)]">
            错误码：<span className="font-mono">{errorCode}</span>
          </p>
        ) : null}
      </div>

      <Link
        href="/next/settings/integrations"
        data-testid="back-to-integrations-link"
        className="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        返回集成设置
      </Link>
    </div>
  )
}

export default IntegrationCallbackPage
