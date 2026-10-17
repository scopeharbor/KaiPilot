'use client'

import * as React from 'react'

export interface LoginStaticFallbackProps {
  className?: string
  style?: React.CSSProperties
}

/**
 * 纯 CSS 静态降级与占位底图
 *
 * 规范遵循：v3-next-layer1-login-3d-m0 design.md Decision 3 & Decision 4
 * 零 Canvas / 零 WebGL 运行时，纯 CSS 径向渐变光晕，保证在任何设备下秒级渲染。
 */
export function LoginStaticFallback({ className = '', style }: LoginStaticFallbackProps) {
  return (
    <div
      data-testid="login-static-fallback"
      aria-hidden="true"
      tabIndex={-1}
      className={`fixed inset-0 pointer-events-none z-0 overflow-hidden select-none bg-[var(--nx-space-bg,#05070f)] ${className}`}
      style={style}
    >
      {/* 品牌定案双层径向渐变光晕（天青 #38bdf8 与 冷青 #00f0ff） */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(circle at 50% -10%, rgba(56, 189, 248, 0.12) 0%, transparent 50%),
            radial-gradient(circle at 85% 15%, rgba(0, 240, 255, 0.06) 0%, transparent 35%),
            radial-gradient(circle at 20% 80%, rgba(56, 189, 248, 0.05) 0%, transparent 40%)
          `,
        }}
      />

      {/* 极简深空网格与微光点缀 */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.15) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
    </div>
  )
}
