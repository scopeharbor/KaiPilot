import { join, normalize, sep } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { NextResponse, type NextRequest } from 'next/server'
import { resolveHelpContentDir } from '@/lib/help/load'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
}

/**
 * 帮助中心静态资产出口（截图等，design H 静态 PNG 契约）。
 *
 * 鉴权说明：本出口**免鉴权公开**——文章正文中的 `<img>` 标签无法携带
 * Authorization header，若强制 Bearer 校验会导致文档内截图 401 破图。
 * 资产内容是随产品发布的文档图片、非用户数据，公开读取不泄露隐私；
 * 仍保留两层硬保护：路径包含校验（防目录穿越，仅允许内容树内文件）+
 * MIME 扩展名白名单。列表/索引/文章 Markdown 等出口维持原鉴权不变。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ area: string; file: string[] }> },
) {
  // 注：_request 参数为 Next.js Route Handler 签名强制保留（首参须为 Request 类型），
  // 本出口免鉴权，不读取请求头。
  const resolvedParams = await params
  const contentDir = resolveHelpContentDir()
  const base = normalize(join(contentDir, resolvedParams.area))
  if (!base.startsWith(normalize(contentDir) + sep)) {
    return NextResponse.json(
      { error: { code: 'RESOURCE_NOT_FOUND', message: '资源不存在' } },
      { status: 404 },
    )
  }

  const rel = (resolvedParams.file ?? []).join(sep)
  const target = normalize(join(base, rel))
  if (!target.startsWith(base + sep) && target !== base) {
    return NextResponse.json(
      { error: { code: 'RESOURCE_NOT_FOUND', message: '资源不存在' } },
      { status: 404 },
    )
  }
  if (!existsSync(target)) {
    return NextResponse.json(
      { error: { code: 'RESOURCE_NOT_FOUND', message: '资源不存在' } },
      { status: 404 },
    )
  }

  const lower = target.toLowerCase()
  const ext = Object.keys(MIME).find((e) => lower.endsWith(e))
  if (!ext) {
    return NextResponse.json(
      { error: { code: 'RESOURCE_NOT_FOUND', message: '不支持的资源类型' } },
      { status: 404 },
    )
  }

  const data = readFileSync(target)
  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': MIME[ext]!,
      'Cache-Control': 'public, max-age=3600',
      'X-Help-Asset': `${resolvedParams.area}/${rel}`,
    },
  })
}
