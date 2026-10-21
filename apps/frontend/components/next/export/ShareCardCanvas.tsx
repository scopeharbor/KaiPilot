'use client'

import type { CSSProperties, ReactNode } from 'react'
import { MONO_FONT_STACK, SYSTEM_CN_FONT_STACK } from '@/lib/next/chart-export'

/**
 * 分享卡自包含设计令牌（镜像 `app/(next)/next-tokens.css` 的 `--nx-*` 值）。
 *
 * html-to-image 导出的 SVG/位图为独立文档：令牌样式表作用域 `[data-next-track]`
 * 无法到达克隆子树，因此分享卡根节点以**内联 CSS 自定义属性**自包含全部
 * `--nx-*` 令牌（design §4 样式隔离铁律的镜像机制），模板组件统一消费
 * `var(--nx-*)`，保证预览与导出像素级一致。
 */
export const SHARE_CARD_TOKENS = {
  '--nx-space-bg': '#040508',
  '--nx-workspace-bg': '#0a0b0d',
  '--nx-workspace-surface': '#121418',
  '--nx-bg-0': '#0a0b0d',
  '--nx-bg-1': '#121418',
  '--nx-accent': '#38bdf8',
  '--nx-ai': '#00f0ff',
  '--nx-text-primary': '#f1f5f9',
  '--nx-text-secondary': '#94a3b8',
  '--nx-text-muted': '#7a8ba1',
  '--nx-border-hairline': 'rgba(255, 255, 255, 0.08)',
  '--nx-border-focus': 'rgba(56, 189, 248, 0.4)',
  '--nx-status-success': '#10b981',
  '--nx-status-warning': '#f59e0b',
  '--nx-status-danger': '#ef4444',
  '--nx-chart-1': '#38bdf8',
  '--nx-chart-2': '#818cf8',
  '--nx-chart-3': '#34d399',
  '--nx-chart-4': '#fbbf24',
  '--nx-chart-5': '#f87171',
  '--nx-chart-6': '#22d3ee',
  '--nx-chart-7': '#c084fc',
  '--nx-chart-8': '#a3e635',
} as const satisfies Record<string, string>

export interface ShareCardCanvasProps {
  /** 实体标识（项目全称或草案编号 #DRAFT-XXXXXXXX），Header 左侧主标。 */
  entityName: string
  /** 视图类型胶囊徽章（如 看板工作面 / 反幻觉自检报告）。 */
  viewType: string
  /** 数据区内容模板（看板微缩结构 / 五维能量条等）。 */
  children: ReactNode
  /** 生成时间戳（缺省为渲染时刻，测试可注入）。 */
  timestamp?: Date
}

/** 分享卡时间戳格式：`YYYY-MM-DD HH:mm:ss`（本地时区，spec §Footer）。 */
export function formatShareCardTimestamp(now: Date): string {
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`
}

/**
 * 1200×630 规范分享卡画布外壳（spec §1200×630 分享卡模板 / design §5）。
 *
 * - 固定 1200×630（1.91:1 Open Graph 比例），Midnight 午夜底色 `#020617`、
 *   1px 发丝线外框 `#1e293b`、8px 微圆角；
 * - Header：品牌徽记 + 项目/草案全称（左），视图类型胶囊徽章 + 租户物理隔离（右）；
 * - Body：由各模板填充（flex:1）；
 * - Footer：精确时间戳（等宽字体）、租户安全防线、Evidence Console 防伪水印。
 */
export function ShareCardCanvas({
  entityName,
  viewType,
  children,
  timestamp = new Date(),
}: ShareCardCanvasProps) {
  return (
    <div
      data-share-card
      aria-label={`${entityName} ${viewType}分享卡`}
      style={
        {
          ...SHARE_CARD_TOKENS,
          width: 1200,
          height: 630,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          backgroundColor: '#020617',
          color: 'var(--nx-text-primary)',
          fontFamily: SYSTEM_CN_FONT_STACK,
          borderRadius: 8,
          border: '1px solid #1e293b',
        } as CSSProperties
      }
    >
      <header
        data-share-card-header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '20px 28px 14px',
          borderBottom: '1px solid var(--nx-border-hairline)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span
            data-share-card-brand
            aria-hidden
            style={{
              width: 28,
              height: 28,
              flexShrink: 0,
              borderRadius: 6,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'var(--nx-accent)',
              color: '#040508',
              fontFamily: MONO_FONT_STACK,
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            智
          </span>
          <span
            data-share-card-entity
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {entityName}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span
            data-share-card-view-badge
            style={{
              padding: '3px 10px',
              borderRadius: 999,
              border: '1px solid var(--nx-border-focus)',
              backgroundColor: 'rgba(56, 189, 248, 0.08)',
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--nx-accent)',
            }}
          >
            {viewType}
          </span>
          <span
            data-share-card-header-tenant
            style={{
              padding: '3px 10px',
              borderRadius: 999,
              border: '1px solid var(--nx-border-hairline)',
              fontSize: 11,
              color: 'var(--nx-text-muted)',
              fontFamily: MONO_FONT_STACK,
            }}
          >
            租户物理隔离
          </span>
        </div>
      </header>

      <div
        data-share-card-body
        style={{ flex: 1, minHeight: 0, padding: '16px 28px 14px', display: 'flex' }}
      >
        {children}
      </div>

      <footer
        data-share-card-footer
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '12px 28px',
          borderTop: '1px solid var(--nx-border-hairline)',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <span
          data-share-card-timestamp
          style={{ fontSize: 11, color: 'var(--nx-text-muted)', fontFamily: MONO_FONT_STACK }}
        >
          导出时间：{formatShareCardTimestamp(timestamp)}
        </span>
        <span data-share-card-tenant style={{ fontSize: 11, color: 'var(--nx-text-secondary)' }}>
          租户物理隔离 · 内部凭证
        </span>
        <span
          data-share-card-watermark
          style={{ fontSize: 11, color: 'var(--nx-text-muted)', fontFamily: MONO_FONT_STACK }}
        >
          开项 KaiPilot · Evidence Console
        </span>
      </footer>
    </div>
  )
}

export default ShareCardCanvas
