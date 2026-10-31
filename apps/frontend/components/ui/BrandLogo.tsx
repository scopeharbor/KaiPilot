'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

export const BRAND_LOGO_LIGHT_SRC = '/branding/aiproj-logo-mark-light.svg'
export const BRAND_LOGO_DARK_SRC = '/branding/aiproj-logo-mark-dark.svg'
export const BRAND_LOADER_LIGHT_SRC = '/branding/aiproj-logo-loader-light.svg'
export const BRAND_LOADER_DARK_SRC = '/branding/aiproj-logo-loader-dark.svg'

const subscribeNothing = () => () => {}

/**
 * 是否已在客户端完成 hydration：服务端与 hydration 首帧为 false，之后为 true。
 * 主题只在客户端可知，按主题挑图必须等到这之后，否则深色主题下 `src` 与服务端不一致（hydration 警告）。
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  )
}

function useBrandAsset(lightSrc: string, darkSrc: string) {
  const { resolvedTheme } = useTheme()
  const hydrated = useHydrated()
  return hydrated && resolvedTheme === 'dark' ? darkSrc : lightSrc
}

export interface BrandLogoProps {
  size?: number
  showName?: boolean
  className?: string
  imageClassName?: string
  /** 放在深色底（如旧版深色顶栏）上时强制用深色底版本；不传则随主题。 */
  onDark?: boolean
}

export function BrandLogo({
  size = 32,
  showName = true,
  className,
  imageClassName,
  onDark,
}: BrandLogoProps) {
  const themed = useBrandAsset(BRAND_LOGO_LIGHT_SRC, BRAND_LOGO_DARK_SRC)
  const src = onDark ? BRAND_LOGO_DARK_SRC : themed

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        className={cn('shrink-0 object-contain', imageClassName)}
      />
      {showName ? <span className="truncate">开项 KaiPilot</span> : null}
    </span>
  )
}

export interface BrandLoaderProps {
  size?: number
  label?: string
  className?: string
}

export function BrandLoader({ size = 64, label, className }: BrandLoaderProps) {
  const boundedSize = Math.min(96, Math.max(32, size))
  const src = useBrandAsset(BRAND_LOADER_LIGHT_SRC, BRAND_LOADER_DARK_SRC)

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex flex-col items-center justify-center gap-3 text-center', className)}
    >
      <img
        src={src}
        width={boundedSize}
        height={boundedSize}
        alt=""
        aria-hidden="true"
        className="aspect-square shrink-0 object-contain"
      />
      {label ? (
        <span className="text-sm leading-6 text-gray-600">{label}</span>
      ) : (
        <span className="sr-only">加载中</span>
      )}
    </div>
  )
}
