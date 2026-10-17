'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, LoaderCircle } from 'lucide-react'
import type { TwoFactorEnrollment } from '@/lib/api/two-factor'
import { copyTextToClipboard } from '@/lib/clipboard'

/**
 * 把 otpauth URI 渲染成 data URL 二维码。
 *
 * 二维码里装的是**共享密钥种子**（OWASP：软件 OTP 靠 "scanning a QR code provided by
 * the web application which provides the initial seed"），所以它只在绑定那一刻出现，
 * 绑定完成后服务端不再回传，任何界面都无法再次显示。
 */
function useQrDataUrl(otpauthUri: string | null, size = 200): string | null {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!otpauthUri) {
      setSrc(null)
      return
    }
    QRCode.toDataURL(otpauthUri, {
      width: size,
      margin: 1,
      // 二维码要在浅色卡片上被手机稳定识别，固定黑白而不跟随主题变量。
      color: { dark: '#111827', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {
        // 渲染失败不阻断流程：下方始终提供可手工录入的密钥。
        if (!cancelled) setSrc(null)
      })
    return () => {
      cancelled = true
    }
  }, [otpauthUri, size])
  return src
}

/** 复制密钥的小按钮，复制后短暂显示对勾。 */
function CopySecretButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label="复制密钥"
      onClick={() => {
        void copyTextToClipboard(value).then((ok) => {
          if (!ok) return
          setCopied(true)
          window.setTimeout(() => setCopied(false), 2000)
        })
      }}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-strong bg-background px-2.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:shadow-focus"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      {copied ? '已复制' : '复制'}
    </button>
  )
}

/**
 * 认证器绑定二维码面板——登录页与设置页共用。
 *
 * 同时给出二维码与可手工录入的 Base32 密钥：桌面端扫码，手机端（自己就是那台设备、
 * 没法自拍屏幕）直接复制密钥粘进认证器。Auth0 在移动端也是这么降级的。
 */
export function AuthenticatorQrPanel({
  enrollment,
  loading = false,
  size = 200,
}: {
  enrollment: TwoFactorEnrollment | null
  loading?: boolean
  size?: number
}) {
  const qrDataUrl = useQrDataUrl(enrollment?.otpauthUri ?? null, size)

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <div
        className="flex shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-border bg-white p-3"
        style={{ width: size + 24, height: size + 24 }}
      >
        {loading || !enrollment ? (
          <span className="flex flex-col items-center gap-2 text-xs text-gray-500">
            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
            正在生成二维码…
          </span>
        ) : qrDataUrl ? (
          <img src={qrDataUrl} alt="两步验证配置二维码" width={size} height={size} />
        ) : (
          <span className="px-2 text-center text-xs text-gray-500">
            二维码不可用，请用右侧密钥手工录入
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-gray-600">
          <li>
            在手机上打开认证器 App（Google Authenticator、1Password、Microsoft Authenticator 等）。
          </li>
          <li>扫描左侧二维码，App 里会出现一条每 30 秒刷新的 6 位验证码。</li>
          <li>把当前显示的验证码填到下方完成绑定。</li>
        </ol>

        <div>
          <p className="text-sm font-medium text-gray-700">无法扫码？手工输入密钥</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded-[var(--radius-sm)] bg-gray-100 px-2 py-1 font-mono text-sm tracking-[0.08em] text-gray-800">
              {enrollment?.secret ?? '——'}
            </code>
            {enrollment ? <CopySecretButton value={enrollment.secret} /> : null}
          </div>
        </div>

        {enrollment ? (
          <dl className="grid grid-cols-3 gap-2 text-xs text-gray-500">
            <div>
              <dt>算法</dt>
              <dd className="font-mono text-gray-700">{enrollment.algorithm}</dd>
            </div>
            <div>
              <dt>位数</dt>
              <dd className="font-mono text-gray-700">{enrollment.digits}</dd>
            </div>
            <div>
              <dt>周期</dt>
              <dd className="font-mono text-gray-700">{enrollment.period}s</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </div>
  )
}
