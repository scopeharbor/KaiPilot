/**
 * 从正式品牌 SVG 生成 PWA 应用图标（192x192 和 512x512 PNG）。
 *
 * 用法: node scripts/generate-pwa-icons.mjs
 *
 * 本脚本由 v2-5-pwa-installable-shell change 引入，只运行一次。
 * 若将来品牌图标更新，重新运行即可覆盖。
 */

import sharp from 'sharp'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const BRANDING_DIR = resolve(root, 'public', 'branding')

const svgLight = readFileSync(resolve(BRANDING_DIR, 'aiproj-logo-mark-light.svg'), 'utf-8')

async function generate() {
  const sizes = [192, 512]

  for (const size of sizes) {
    // 将 SVG 渲染为透明 PNG
    const svgPng = await sharp(Buffer.from(svgLight)).resize(size, size).png().toBuffer()

    // 在白色背景上合成 SVG
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([{ input: svgPng, top: 0, left: 0 }])
      .png()
      .toFile(resolve(BRANDING_DIR, `app-icon-${size}.png`))

    console.log(`✅ Generated app-icon-${size}.png`)
  }
}

generate().catch((err) => {
  console.error('Failed to generate icons:', err)
  process.exit(1)
})
