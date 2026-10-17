'use client'

import { useEffect } from 'react'
import { useNextTrackStore, type NxTheme } from '@/stores/next-track-store'

/**
 * 新轨页面根明暗主题同步（v3-next-cinematic-techniques-completion D5）。
 *
 * 仅供新轨壳层/登录页调用；临时切换控件直接订阅 store，避免卸载时清除根属性。
 * 照 use-immersion-tier 同款模式：读取 next-track-store 的 nxTheme（持久化偏好），
 * 写入 `<html data-nx-theme>`；令牌覆盖经 `:root[data-nx-theme='light'] [data-next-track]`
 * 选择器命中（见 next-tokens.css 浅色覆盖块）。
 */
export function useNxTheme(): NxTheme {
  const nxTheme = useNextTrackStore((state) => state.nxTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-nx-theme', nxTheme)
    return () => document.documentElement.removeAttribute('data-nx-theme')
  }, [nxTheme])

  return nxTheme
}
