'use client'

import '../(next)/next-tokens.css'
import { NextOfflineFallback } from '@/components/next/offline/NextOfflineFallback'

/**
 * 离线 Fallback 页面——当用户离线且导航请求无法命中网络时显示（深空外壳同化版）。
 *
 * 本页面是**纯静态 Client Component**，零外部网络请求，零写操作，
 * 零 Service Worker 注册逻辑改动。
 *
 * @see design.md W3 / tasks 3.1 & 3.3
 */
export default function OfflineFallbackPage() {
  return <NextOfflineFallback />
}
