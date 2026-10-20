import type { MetadataRoute } from 'next'

/**
 * Web App Manifest — v2-5-pwa-installable-shell
 *
 * 使用 Next.js App Router `manifest.ts` 约定，通过 TypeScript 类型约束字段。
 * 所有图标路径指向 `public/branding/` 正式品牌资产。
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '开项 Kaiplan',
    short_name: '开项',
    description: 'AI 驅動的專案管理平台，協助規劃專案、管理任務與追蹤進度。',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#4338CA',
    lang: 'zh-CN',
    prefer_related_applications: false,
    icons: [
      {
        src: '/branding/app-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/branding/app-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/branding/app-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/branding/app-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
