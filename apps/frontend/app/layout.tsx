import type { Metadata } from 'next'
import { sansFont } from '@/lib/fonts'
import { ThemeProvider } from '@/providers/theme-provider'
import { QueryProvider } from '@/providers/query-provider'
import { AuthSessionProvider } from '@/providers/auth-session-provider'
import { RealtimeProvider } from '@/providers/realtime-provider'
import { Toaster } from '@/components/ui/Toast'
import { UI_STORE_KEY } from '@/stores/ui-store'
import { RegisterOfflineFallback } from '@/components/layout/RegisterOfflineFallback'
import VariantRuntime from '@/components/locale/variant-runtime'
import './globals.css'

export const metadata: Metadata = {
  title: '开项 OpenXiang',
  description: 'AI 驅動的專案管理平台，協助規劃專案、管理任務與追蹤進度。',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/branding/aiproj-logo-mark-light.svg',
    shortcut: '/branding/aiproj-logo-mark-light.svg',
    apple: '/branding/app-icon-192.png',
  },
}

const densityScript = `(function(){try{var s=localStorage.getItem('${UI_STORE_KEY}');var d=s&&JSON.parse(s).state&&JSON.parse(s).state.density;document.documentElement.setAttribute('data-density',d==='compact'?'compact':'comfortable');}catch(e){document.documentElement.setAttribute('data-density','comfortable');}})();`

// 文字变体防闪烁脚本（比照 densityScript 模式）：SSR 恒输出简体
// （html lang 固定 zh-CN，getServerSnapshot 恒回 'cn'），此脚本在 hydration
// 前把 documentElement.lang 与 data-text-variant 对齐用户已保存的变体，
// 避免繁体页面首帧闪回简体。key 必须与 lib/locale/variant-store.ts 的
// localStorage key 保持一致；取值非法时回退 'cn'。
const VARIANT_STORAGE_KEY = 'aiproj-text-variant'
const variantScript = `(function(){try{var v=localStorage.getItem('${VARIANT_STORAGE_KEY}');var lang='zh-CN';if(v==='tw'){lang='zh-TW';}else if(v==='hk'){lang='zh-HK';}else{v='cn';}document.documentElement.lang=lang;document.documentElement.setAttribute('data-text-variant',v);}catch(e){document.documentElement.setAttribute('data-text-variant','cn');}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={sansFont.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: densityScript }} />
        <script dangerouslySetInnerHTML={{ __html: variantScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthSessionProvider>
            <QueryProvider>
              <RealtimeProvider>
                {children}
                <VariantRuntime />
                <RegisterOfflineFallback />
              </RealtimeProvider>
            </QueryProvider>
          </AuthSessionProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
