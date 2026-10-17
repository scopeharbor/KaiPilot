'use client'

import { useEffect, useRef } from 'react'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import { useBeforeUnload } from '@/hooks/use-before-unload'

/**
 * What-if 未保存变更路由守卫。
 *
 * - 监听 beforeunload（刷新/关闭时浏览器原生提示）。
 * - 集成到 App Router 的路由离开确认链，阻止意外离开。
 * - 在甘特页面内挂载一次即可。
 */
export function WhatIfRouteGuard() {
  const hasUnsavedRef = useRef(false)

  // 保持 ref 与 zustand 同步（避免 beforeunload 回调中读 stale 闭包）
  useEffect(() => {
    const unsub = useWhatIfSessionStore.subscribe((state) => {
      hasUnsavedRef.current =
        state.session.hasUnsavedChanges &&
        (state.session.status === 'active' || state.session.status === 'stale')
    })
    return () => unsub()
  }, [])

  useBeforeUnload(() => hasUnsavedRef.current, '您有未保存的 What-if 变更，确定要离开吗？')

  // 这个组件不渲染任何可见 UI
  return null
}
