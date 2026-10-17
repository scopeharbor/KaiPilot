'use client'

/**
 * Foreground Cutout（前景剪纸层，v3-next-cinematic-techniques-completion D3）。
 *
 * DOM+WebGL 深度合成的 DOM 侧前景技法：
 * - 在 3D 场景（z-0）与表单（z-10）之间插入一层极轻剪纸剪影（z-[1]），
 *   用 SVG clip-path 切出斜角轮廓 + 发丝级渐变描边，营造「前/中/背景」的
 *   空间纵深，而不是一块平卡片盖在场景上；
 * - 纯 CSS/SVG 确定性渲染（RL-14），Reduced Motion 与 precise 档自动剥离动效；
 * - aria-hidden + pointer-events-none：不承载信息、不拦焦点（DOM 信息等价）。
 */
export function ForegroundCutout() {
  return (
    <div
      aria-hidden="true"
      data-foreground-cutout
      className="pointer-events-none fixed inset-0 z-[1] overflow-hidden"
    >
      {/* 右下大斜角剪纸剪影（微光渐变面，营造前景纵深） */}
      <svg
        className="absolute -bottom-24 -right-24 h-[520px] w-[520px] opacity-[0.16]"
        viewBox="0 0 520 520"
        fill="none"
      >
        <defs>
          <linearGradient id="cutout-edge" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--nx-space-cyan)" stopOpacity="0.55" />
            <stop offset="55%" stopColor="var(--nx-space-cyan)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>
        </defs>
        <path
          d="M520 520 L120 520 L520 120 Z"
          fill="url(#cutout-edge)"
          stroke="var(--nx-space-cyan)"
          strokeOpacity="0.35"
          strokeWidth="1"
        />
      </svg>
      {/* 左上发丝级斜切描边（呼应右下，形成对角空间张力） */}
      <svg
        className="absolute -left-16 -top-16 h-[360px] w-[360px] opacity-[0.10]"
        viewBox="0 0 360 360"
        fill="none"
      >
        <path
          d="M0 360 L0 90 L270 360 Z"
          fill="none"
          stroke="var(--nx-accent)"
          strokeOpacity="0.5"
          strokeWidth="1"
        />
      </svg>
    </div>
  )
}

export default ForegroundCutout
