/**
 * 旧版界面精选色系（v3-classic-ui-openproject-style）。
 *
 * 色值本身写在 `app/classic-theme.css`（`:root[data-classic-palette='<id>']`），这里只放清单、
 * 名称、菜单预览用的色块，以及顶栏是深底还是浅底（决定 logo 用哪一版）。
 * 预览色块与 CSS 的一致性由测试比对。
 *
 * 色系只作用于旧版界面：属性由根布局首屏脚本（非 /next 路径）与旧版 AppShell 写入。
 */

export const CLASSIC_PALETTE_IDS = [
  'brand',
  'sky',
  'forest',
  'teal',
  'wine',
  'graphite',
  'violet',
] as const

export type ClassicPaletteId = (typeof CLASSIC_PALETTE_IDS)[number]

export const DEFAULT_CLASSIC_PALETTE: ClassicPaletteId = 'brand'

/** `<html>` 上承载色系的属性名。 */
export const CLASSIC_PALETTE_ATTRIBUTE = 'data-classic-palette'

export interface ClassicPalette {
  id: ClassicPaletteId
  label: string
  /** 浅色模式下的预览色块：顶栏、侧栏、强调色。 */
  swatch: { header: string; sidebar: string; accent: string }
  /** 浅色模式下顶栏 / 侧栏是深底（白字、深色版 logo）还是浅底。深色模式下一律深底。 */
  headerTone: 'dark' | 'light'
  sidebarTone: 'dark' | 'light'
}

export const CLASSIC_PALETTES: readonly ClassicPalette[] = [
  {
    id: 'brand',
    label: '开项蓝',
    swatch: { header: '#1e3a8a', sidebar: '#262b33', accent: '#3b6bef' },
    headerTone: 'dark',
    sidebarTone: 'dark',
  },
  {
    id: 'sky',
    label: '晴空浅色',
    swatch: { header: '#ffffff', sidebar: '#f6f8fa', accent: '#0969da' },
    headerTone: 'light',
    sidebarTone: 'light',
  },
  {
    id: 'forest',
    label: '森林绿',
    swatch: { header: '#14532d', sidebar: '#1c2620', accent: '#1a7f37' },
    headerTone: 'dark',
    sidebarTone: 'dark',
  },
  {
    id: 'teal',
    label: '湖水青',
    swatch: { header: '#134e4a', sidebar: '#1b2a2b', accent: '#0e7490' },
    headerTone: 'dark',
    sidebarTone: 'dark',
  },
  {
    id: 'wine',
    label: '勃艮第红',
    swatch: { header: '#7a1f2b', sidebar: '#2a1f22', accent: '#be123c' },
    headerTone: 'dark',
    sidebarTone: 'dark',
  },
  {
    id: 'graphite',
    label: '石墨橙',
    swatch: { header: '#24292f', sidebar: '#2d333b', accent: '#c2410c' },
    headerTone: 'dark',
    sidebarTone: 'dark',
  },
  {
    id: 'violet',
    label: '暮光紫',
    swatch: { header: '#3b2a7a', sidebar: '#27233a', accent: '#6941c6' },
    headerTone: 'dark',
    sidebarTone: 'dark',
  },
]

export function isClassicPaletteId(value: unknown): value is ClassicPaletteId {
  return typeof value === 'string' && (CLASSIC_PALETTE_IDS as readonly string[]).includes(value)
}

/** 未知或缺失的 id 回退默认色系。 */
export function resolveClassicPalette(value: unknown): ClassicPalette {
  const id = isClassicPaletteId(value) ? value : DEFAULT_CLASSIC_PALETTE
  return CLASSIC_PALETTES.find((palette) => palette.id === id)!
}

/** 新版界面路径（`/next`、`/next-login` 及其子路径）不使用旧版色系。 */
export function isNextTrackPath(pathname: string): boolean {
  return /^\/next(?:-login)?(?:\/|$)/.test(pathname)
}

/** 写入或移除 `<html>` 上的色系属性。 */
export function applyClassicPalette(id: ClassicPaletteId | null) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (id === null) root.removeAttribute(CLASSIC_PALETTE_ATTRIBUTE)
  else root.setAttribute(CLASSIC_PALETTE_ATTRIBUTE, id)
}

/**
 * 根布局首屏脚本：hydration 前按本地偏好写入色系，避免旧版页面首帧闪回默认色。
 * 新版路径不写；store key 与 `ui-store` 的 `UI_STORE_KEY` 一致。
 */
export function classicPaletteBootScript(storeKey: string): string {
  const ids = JSON.stringify(CLASSIC_PALETTE_IDS)
  return `(function(){try{if(/^\\/next(?:-login)?(?:\\/|$)/.test(location.pathname))return;var ids=${ids};var p='${DEFAULT_CLASSIC_PALETTE}';var s=localStorage.getItem('${storeKey}');var v=s&&JSON.parse(s).state&&JSON.parse(s).state.classicPalette;if(ids.indexOf(v)>=0)p=v;document.documentElement.setAttribute('${CLASSIC_PALETTE_ATTRIBUTE}',p);}catch(e){document.documentElement.setAttribute('${CLASSIC_PALETTE_ATTRIBUTE}','${DEFAULT_CLASSIC_PALETTE}');}})();`
}
