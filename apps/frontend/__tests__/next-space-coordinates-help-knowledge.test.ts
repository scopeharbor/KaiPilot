/**
 * v3-ui-next-help-knowledge-domain W3 · tasks 3.2 —— 空间地图帮助/知识两全局坐标
 * 注册与检索单测（spec「空间地图坐标点亮与 AI 同事意图直达三通道闭环」要求 1）。
 *
 * 覆盖：
 * - help / knowledge 全局坐标正式注册：available / 已就绪 / 全局绝对路径
 *   （无 :id 占位）/ 图标名契约（BookOpen / Database）与规范关键词；
 * - `filterSpaceCoordinates` 关键词精准归属：帮助/手册/指南 等词命中 help；
 *   知识库/规范/经验 等词命中 knowledge；「文档」为帮助与项目文件库共享检索词
 *   （双命中共存，与「人员/负荷」共享词同例）；
 * - `resolveSpaceCoordinatePath` 在单项目与全局视图下均原样返回全局绝对路径，
 *   绝不回退首页引导（帮助/知识为全域视窗，任何上下文均可直达）。
 */
import { describe, expect, test } from 'vitest'
import {
  PRESET_SPACE_COORDINATES,
  filterSpaceCoordinates,
  resolveSpaceCoordinatePath,
} from '@/lib/next/space-coordinates'

const help = PRESET_SPACE_COORDINATES.find((c) => c.id === 'help')!
const knowledge = PRESET_SPACE_COORDINATES.find((c) => c.id === 'knowledge')!

describe('帮助/知识全局坐标注册（tasks 3.1，spec「坐标点亮」）', () => {
  test('help 坐标：全局路径 + available / 已就绪 + BookOpen 图标契约', () => {
    expect(help.title).toBe('帮助中心')
    expect(help.path).toBe('/next/help')
    expect(help.status).toBe('available')
    expect(help.badge).toBe('已就绪')
    expect(help.iconName).toBe('BookOpen')
    expect(help.description).toBeTruthy()
    expect(help.keywords).toEqual(expect.arrayContaining(['帮助', '文档', '手册', '指南', 'help']))
  })

  test('knowledge 坐标：全局路径 + available / 已就绪 + Database 图标契约', () => {
    expect(knowledge.title).toBe('知识底座')
    expect(knowledge.path).toBe('/next/knowledge')
    expect(knowledge.status).toBe('available')
    expect(knowledge.badge).toBe('已就绪')
    expect(knowledge.iconName).toBe('Database')
    expect(knowledge.description).toBeTruthy()
    expect(knowledge.keywords).toEqual(
      expect.arrayContaining(['知识', '知识库', '规范', '经验', 'knowledge']),
    )
  })

  test('两坐标均为无 :id 占位的全局坐标（不参与项目镜头拼装）', () => {
    expect(help.path.includes(':id')).toBe(false)
    expect(knowledge.path.includes(':id')).toBe(false)
  })
})

describe('两全局坐标检索归属（spec「输入关键词即时模糊检索」）', () => {
  test('「帮助」/「手册」/「指南」/「help」精准命中 help 坐标', () => {
    expect(filterSpaceCoordinates('帮助').map((c) => c.id)).toEqual(['help'])
    expect(filterSpaceCoordinates('帮助中心').map((c) => c.id)).toEqual(['help'])
    expect(filterSpaceCoordinates('手册').map((c) => c.id)).toEqual(['help'])
    expect(filterSpaceCoordinates('指南').map((c) => c.id)).toEqual(['help'])
    expect(filterSpaceCoordinates('help').map((c) => c.id)).toEqual(['help'])
  })

  test('「文档」为帮助与项目文件库共享检索词 → 双命中（互不吞没）', () => {
    // files 坐标关键词自带「文档」；双卡共存语义与既有「人员/负荷」共享词一致
    expect(filterSpaceCoordinates('文档').map((c) => c.id)).toEqual(['files', 'help'])
  })

  test('「知识库」/「规范」/「经验」/「knowledge」精准命中 knowledge 坐标', () => {
    expect(filterSpaceCoordinates('知识').map((c) => c.id)).toEqual(['knowledge'])
    expect(filterSpaceCoordinates('知识库').map((c) => c.id)).toEqual(['knowledge'])
    expect(filterSpaceCoordinates('规范').map((c) => c.id)).toEqual(['knowledge'])
    expect(filterSpaceCoordinates('经验').map((c) => c.id)).toEqual(['knowledge'])
    expect(filterSpaceCoordinates('knowledge').map((c) => c.id)).toEqual(['knowledge'])
  })

  test('路径末段检索：help / knowledge 均由其全局路径末段命中', () => {
    expect(filterSpaceCoordinates('next/help').map((c) => c.id)).toEqual(['help'])
    expect(filterSpaceCoordinates('next/knowledge').map((c) => c.id)).toEqual(['knowledge'])
    // 共享前缀 next 仍只命中首页，不因新坐标漂移（路径段匹配语义不变）
    expect(filterSpaceCoordinates('next').map((c) => c.id)).toEqual(['home'])
  })

  test('非相关词不误伤两坐标；既有坐标归属零漂移', () => {
    expect(filterSpaceCoordinates('未知坐标XYZ')).toEqual([])
    expect(filterSpaceCoordinates('首页').map((c) => c.id)).toEqual(['home'])
    expect(filterSpaceCoordinates('图表').map((c) => c.id)).toEqual(['charts'])
    // 批4 org-reports-wing/pmo-reports 关键词含「报表」，与既有两卡共存
    expect(filterSpaceCoordinates('报表').map((c) => c.id)).toEqual([
      'charts',
      'reports',
      'org-reports-wing',
      'pmo-reports',
    ])
    // v3-ui-next-org-portfolio-domains 10.2：组织/全局资源系坐标注册后裸「资源」为
    // 共享词（项目资源工作台 + 组织/全局资源系）——帮助/知识两坐标零漂移；
    // 批4 pmo-reports 描述含「资源负荷」，一并共存
    expect(filterSpaceCoordinates('资源').map((c) => c.id)).toEqual([
      'resources',
      'org_resource_pool',
      'org_resource_gaps',
      'org_resource_contentions',
      'org_resource_demand',
      'global_resources',
      'pmo-reports',
    ])
    expect(filterSpaceCoordinates('成员').map((c) => c.id)).toEqual(['members'])
    expect(filterSpaceCoordinates('文件').map((c) => c.id)).toEqual(['files'])
  })
})

describe('resolveSpaceCoordinatePath（全局绝对路径恒定直达）', () => {
  test('单项目视图下原样返回 /next/help 与 /next/knowledge', () => {
    expect(resolveSpaceCoordinatePath(help.path, 42)).toBe('/next/help')
    expect(resolveSpaceCoordinatePath(knowledge.path, 42)).toBe('/next/knowledge')
  })

  test('全局视图（无项目上下文）同样原样返回，绝不回退首页引导', () => {
    expect(resolveSpaceCoordinatePath(help.path, null)).toBe('/next/help')
    expect(resolveSpaceCoordinatePath(knowledge.path, null)).toBe('/next/knowledge')
  })
})
