import { describe, expect, it } from 'vitest'
import { planExportTiles, tileStyle } from '@/lib/next/chart-export-full-content'

describe('planExportTiles（像素比不降、超限才分块）', () => {
  it('200+ 节点 AON 实测尺寸（4976×6672 @2x）在单张画布上限内：一张图', () => {
    const tiles = planExportTiles(4976, 6672, 2)
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toMatchObject({ x: 0, y: 0, width: 4976, height: 6672, index: 1, total: 1 })
  })

  it('超出单边上限时按原像素比分块，块内像素不超过 16384，且完整覆盖内容', () => {
    const width = 3000
    const height = 20_000
    const tiles = planExportTiles(width, height, 2)
    expect(tiles.length).toBeGreaterThan(1)
    for (const tile of tiles) {
      expect(tile.width * 2).toBeLessThanOrEqual(16_384)
      expect(tile.height * 2).toBeLessThanOrEqual(16_384)
      expect(tile.total).toBe(tiles.length)
    }
    expect(tiles.reduce((sum, t) => sum + t.height, 0)).toBe(height)
    expect(tiles.at(-1)!.y + tiles.at(-1)!.height).toBe(height)
  })

  it('又宽又高时按行列二维分块', () => {
    const tiles = planExportTiles(10_000, 10_000, 2)
    expect(new Set(tiles.map((t) => t.x)).size).toBeGreaterThan(1)
    expect(new Set(tiles.map((t) => t.y)).size).toBeGreaterThan(1)
    const area = tiles.reduce((sum, t) => sum + t.width * t.height, 0)
    expect(area).toBe(10_000 * 10_000)
  })
})

describe('tileStyle', () => {
  it('以完整内容尺寸排版并平移到该块，且不出现滚动条', () => {
    const style = tileStyle(
      {
        node: document.createElement('div'),
        width: 500,
        height: 900,
        originX: 48,
        originY: 10,
        restore: () => undefined,
      },
      { x: 0, y: 400, width: 500, height: 500, index: 2, total: 2 },
    )
    expect(style).toMatchObject({
      width: '500px',
      height: '900px',
      transform: 'translate(48px, -390px) scale(1)',
      overflow: 'hidden',
      scrollbarWidth: 'none',
    })
  })
})
