import Link from 'next/link'
import type { Metadata } from 'next'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export const metadata: Metadata = {
  title: '集成回调',
  robots: { index: false, follow: false },
}

export default function IntegrationCallbackPage({
  searchParams,
}: {
  searchParams?: {
    provider?: string
    status?: string
    codeReceived?: string
    message?: string
    errorCode?: string
  }
}) {
  const provider = searchParams?.provider
  const ok = searchParams?.status === 'preconnected' || searchParams?.status === 'connected'
  const Icon = ok ? CheckCircle2 : AlertCircle

  let title: string
  if (searchParams?.status === 'connected' && provider === 'github') {
    title = 'GitHub 已连接'
  } else if (searchParams?.status === 'connected' && provider === 'gitlab') {
    title = 'GitLab 已连接'
  } else if (searchParams?.status === 'connected') {
    title = 'Google Calendar 已连接'
  } else if (ok) {
    title = 'OAuth 预连接已完成'
  } else {
    title = 'OAuth 预连接未完成'
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center justify-center gap-4 p-8 text-center">
      <span className={ok ? 'text-success' : 'text-warning'}>
        <Icon className="h-12 w-12" />
      </span>
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          {searchParams?.message ??
            '当前版本只校验回调链路，不交换 token，也不会开始同步或外部推送。'}
        </p>
        {searchParams?.provider ? (
          <p className="mt-2 text-xs text-gray-500">Provider：{searchParams.provider}</p>
        ) : null}
        {searchParams?.errorCode ? (
          <p className="mt-1 text-xs text-warning">错误码：{searchParams.errorCode}</p>
        ) : null}
      </div>
      <Button asChild>
        <Link href="/settings/integrations">返回集成设置</Link>
      </Button>
    </div>
  )
}
