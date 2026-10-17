'use client'

import { useRegisterOfflineFallback } from '@/hooks/use-register-offline-fallback'

/**
 * 静默注册离线 Fallback 服务工作者。
 *
 * 渲染在 HTML 末尾（不影响布局），仅在 feature flag 启用时注册。
 * 注册失败不阻塞 UI。
 *
 * @see design.md D5 / spec pwa-static-offline-fallback
 */
export function RegisterOfflineFallback() {
  useRegisterOfflineFallback()
  return null
}
