'use client'

import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

export const BRAND_LOGO_LIGHT_SRC = '/branding/aiproj-logo-mark-light.svg'
export const BRAND_LOGO_DARK_SRC = '/branding/aiproj-logo-mark-dark.svg'
export const BRAND_LOADER_LIGHT_SRC = '/branding/aiproj-logo-loader-light.svg'
export const BRAND_LOADER_DARK_SRC = '/branding/aiproj-logo-loader-dark.svg'

function useBrandAsset(lightSrc: string, darkSrc: string) {
  const { resolvedTheme } = useTheme()
  return resolvedTheme === 'dark' ? darkSrc : lightSrc
}

export interface BrandLogoProps {
  size?: number
  showName?: boolean
  className?: string
  imageClassName?: string
}

export function BrandLogo({
  size = 32,
  showName = true,
  className,
  imageClassName,
}: BrandLogoProps) {
  const src = useBrandAsset(BRAND_LOGO_LIGHT_SRC, BRAND_LOGO_DARK_SRC)

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
      {showName ? <span className="truncate">开项 AI</span> : null}
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
