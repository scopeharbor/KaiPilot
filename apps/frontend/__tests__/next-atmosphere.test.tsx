import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import * as React from 'react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { RoleHomeContainer } from '@/components/next/home/RoleHomeContainer'
import { THREE_WHITELIST_SURFACES, isThreeWhitelistedPath } from '@/lib/next/3d/three-whitelist'

const NEXT_TOKENS_PATH = join(process.cwd(), 'app/(next)/next-tokens.css')

function getSourceFiles(dir: string): string[] {
  const results: string[] = []
  try {
    const list = readdirSync(dir)
    for (const file of list) {
      if (
        file.startsWith('.') ||
        file === 'node_modules' ||
        file === '.next' ||
        file === '__tests__' ||
        file === 'coverage'
      ) {
        continue
      }
      const fullPath = join(dir, file)
      const stat = statSync(fullPath)
      if (stat && stat.isDirectory()) {
        results.push(...getSourceFiles(fullPath))
      } else if (/\.(ts|tsx)$/.test(file) && !file.endsWith('.d.ts')) {
        results.push(fullPath)
      }
    }
  } catch {
    // Directory might not exist yet
  }
  return results
}

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: false,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
  document.documentElement.removeAttribute('data-immersion')
})

describe('空间层氛围纯 CSS（v3-ui-next-shell-space-map D7 / spec「空间层氛围纯 CSS 实现与精确档降级」）', () => {
  const css = readFileSync(NEXT_TOKENS_PATH, 'utf8')

  test('.nx-space-atmosphere 基座：令牌底色 + 双层径向渐变光晕（无任何 --nx- 变量声明越界）', () => {
    expect(css).toMatch(
      /\.nx-space-atmosphere\s*\{[\s\S]*?background-color:\s*var\(--nx-space-bg\)/,
    )
    expect(css).toMatch(/\.nx-space-atmosphere::before\s*\{/)
    // D18 定案的双层光晕：天青（--nx-space-cyan #38bdf8）与冷青（--nx-space-ai #00f0ff）
    expect(css).toContain(
      'radial-gradient(circle at 50% -10%, rgba(56, 189, 248, 0.12) 0%, transparent 50%)',
    )
    expect(css).toContain(
      'radial-gradient(circle at 85% 15%, rgba(0, 240, 255, 0.06) 0%, transparent 35%)',
    )
  })

  test('精确档（[data-immersion="precise"]）下彻底关闭光晕：display/background 双 none', () => {
    const block = css.match(
      /\[data-immersion=['"]precise['"]\]\s+\.nx-space-atmosphere::before\s*\{[\s\S]*?\}/,
    )
    expect(block, '缺少 [data-immersion="precise"] 降级规则').not.toBeNull()
    expect(block![0]).toContain('display: none !important')
    expect(block![0]).toContain('background: none !important')
    expect(block![0]).toContain('transition: none !important')
  })

  test('prefers-reduced-motion 媒体查询内彻底停用光晕与动效', () => {
    const media = css.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.nx-space-atmosphere::before\s*\{[\s\S]*?\}[\s\S]*?\}/,
    )
    expect(media, '缺少 prefers-reduced-motion 降级媒体查询').not.toBeNull()
    expect(media![0]).toContain('display: none !important')
    expect(media![0]).toContain('background: none !important')
  })

  test('氛围 token 样式实现零 WebGL / 画布 3D 运行时依赖（文件级验证）', () => {
    const lowered = css.toLowerCase()
    expect(lowered).not.toContain('getcontext')
    expect(lowered).not.toContain('<canvas')
    expect(lowered).not.toContain('@react-three')
    expect(lowered).not.toContain('three.module')
  })
})

describe('RL-15 白名单机制与静态扫描守护（v3-next-layer1-login-3d-m0 / v3-next-layer1-theater-3d-m1）', () => {
  test('白名单清单登记 M0 登录页、M1 生成剧场与 M2 空间地图合法路径，isThreeWhitelistedPath 正确放行与拦截', () => {
    expect(THREE_WHITELIST_SURFACES).toContain('app/next-login')
    expect(THREE_WHITELIST_SURFACES).toContain('components/next/3d/login')
    expect(THREE_WHITELIST_SURFACES).toContain('app/(next)/next/create')
    expect(THREE_WHITELIST_SURFACES).toContain('components/next/3d/theater')
    expect(THREE_WHITELIST_SURFACES).toContain('components/next/3d/spacemap')
    expect(THREE_WHITELIST_SURFACES).toContain('lib/next/3d')

    // 白名单路径判定（M0 登录页 + M1 生成剧场 + M2 空间地图）
    expect(isThreeWhitelistedPath('app/next-login/page.tsx')).toBe(true)
    expect(isThreeWhitelistedPath('components/next/3d/login/LoginSpaceCanvas.tsx')).toBe(true)
    expect(isThreeWhitelistedPath('app/(next)/next/create/page.tsx')).toBe(true)
    expect(isThreeWhitelistedPath('components/next/3d/theater/Theater3DCanvas.tsx')).toBe(true)
    expect(isThreeWhitelistedPath('components/next/3d/spacemap/SpaceMap3DCanvas.tsx')).toBe(true)
    expect(isThreeWhitelistedPath('lib/next/3d/webgl-capabilities.ts')).toBe(true)

    // 非白名单路径判定拦截（旧轨、其他工作面、Layer 2 业务组件）
    expect(isThreeWhitelistedPath('app/login/page.tsx')).toBe(false)
    expect(isThreeWhitelistedPath('components/auth/LoginForm.tsx')).toBe(false)
    expect(isThreeWhitelistedPath('app/(next)/next/projects/page.tsx')).toBe(false)
    expect(isThreeWhitelistedPath('components/next/charts/ParetoChartLens.tsx')).toBe(false)
    expect(isThreeWhitelistedPath('components/next/gantt/GanttView.tsx')).toBe(false)
  })

  test('静态扫描守护：白名单路径以外源码严禁导入 three 或 @react-three', () => {
    const frontendRoot = process.cwd()
    const scanDirs = ['app', 'components', 'lib', 'hooks', 'stores'].map((d) =>
      join(frontendRoot, d),
    )
    const allSourceFiles = scanDirs.flatMap(getSourceFiles)

    const threeImportRegex =
      /(from\s+['"](?:three|@react-three\/fiber|@react-three\/drei)(?:\/[^'"]*)?['"]|import\s*\(\s*['"](?:three|@react-three\/fiber|@react-three\/drei)(?:\/[^'"]*)?['"]\s*\))/

    const violations: { file: string; match: string }[] = []

    for (const filePath of allSourceFiles) {
      const relPath = relative(frontendRoot, filePath).replace(/\\/g, '/')
      if (isThreeWhitelistedPath(relPath)) {
        continue
      }

      const content = readFileSync(filePath, 'utf8')
      const match = content.match(threeImportRegex)
      if (match) {
        violations.push({ file: relPath, match: match[0] })
      }
    }

    expect(violations, `发现非白名单源码违规导入 3D 依赖: ${JSON.stringify(violations)}`).toEqual(
      [],
    )
  })
})

describe('空间层氛围 DOM 渲染（spec「沉浸或轻量档下的纯 CSS 空间层渲染」）', () => {
  test('角色化首页渲染后 DOM 中不存在任何 <canvas> / WebGL 画布', () => {
    const { container } = render(<RoleHomeContainer />)
    expect(container.querySelector('canvas')).toBeNull()
    expect(container.querySelector('[data-role-home]')?.className).toContain('nx-space-atmosphere')
  })

  test('精确档（data-immersion="precise"）下渲染正常且依旧零画布（降级由 CSS 规则承载）', () => {
    document.documentElement.setAttribute('data-immersion', 'precise')
    const { container } = render(<RoleHomeContainer />)

    expect(container.querySelector('[data-role-home]')).not.toBeNull()
    expect(container.querySelector('canvas')).toBeNull()
    expect(container.querySelector('.nx-space-atmosphere')).not.toBeNull()
  })
})
