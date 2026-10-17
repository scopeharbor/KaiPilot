/**
 * cc-loader（Compiler 层）单元测试。
 *
 * 覆盖：单行 JSXText 改写（s/tw/hk 正确性经真实 opencc-js 验证）、
 * 排除规则、data-no-cc、cc-disable、无差异不改写、import 注入与
 * _CC 碰撞改名、glossary 覆写、loader 包装。
 * 产物断言统一走「重新 parse 生成代码」提取 JSXElement 属性，避免
 * 依赖 generator 的引号/排版细节。
 */
import { describe, expect, it } from 'vitest'
import { parse } from '@babel/parser'
import { Converter } from 'opencc-js'
// TypeScript 7 的 `typescript` 包不再导出编译器 API；改用 Next.js 自带 SWC——
// 即生产构建实际编译 cc-loader 产物的编译器
import { loadBindings, transform } from 'next/dist/build/swc/index.js'
import ccLoader, { transformSource, applyGlossary } from '../../compiler/cc-loader'

// ── 工具 ──

/** 极简 AST 遍历（babel 8 节点为 class 实例，避免引用 @types 旧版声明） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walk(node: unknown, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'tokens' || key === 'comments')
      continue
    const value = (node as Record<string, unknown>)[key]
    if (value && typeof value === 'object') walk(value, visit)
  }
}

interface CcElement {
  name: string
  s?: string
  tw?: string
  hk?: string
}

/** 从生成代码中提取全部 _CC/_CC2/… 元素及其属性（属性值支持字符串字面量与 {表达式} 两种形态） */
function findCcElements(code: string): CcElement[] {
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
  const out: CcElement[] = []
  walk(ast, (node) => {
    if (
      node.type === 'JSXElement' &&
      node.openingElement?.name?.type === 'JSXIdentifier' &&
      /^_CC\d*$/.test(node.openingElement.name.name)
    ) {
      const props: Record<string, string> = {}
      for (const attr of node.openingElement.attributes ?? []) {
        const value = attr.value
        if (attr.type !== 'JSXAttribute' || !value) continue
        if (value.type === 'StringLiteral') {
          props[attr.name.name] = value.value
        } else if (
          value.type === 'JSXExpressionContainer' &&
          value.expression?.type === 'StringLiteral'
        ) {
          props[attr.name.name] = value.expression.value
        }
      }
      out.push({ name: node.openingElement.name.name, ...props })
    }
  })
  return out
}

/** 提取注入的 cc import 语句的本地名列表 */
function findCcImports(code: string): string[] {
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
  const out: string[] = []
  walk(ast, (node) => {
    if (
      node.type === 'ImportDeclaration' &&
      node.source?.type === 'StringLiteral' &&
      node.source.value === '@/components/locale/cc'
    ) {
      for (const spec of node.specifiers ?? []) {
        if (spec.type === 'ImportDefaultSpecifier' && spec.local?.name) out.push(spec.local.name)
      }
    }
  })
  return out
}

/** 真实 opencc 期望值（契约要求的实跑验证基准） */
const twConverter = Converter({ from: 'cn', to: 'twp' })
const hkConverter = Converter({ from: 'cn', to: 'hk' })

const PAGE_TSX = '/repo/apps/frontend/app/some/page.tsx'

// ── 用例 ──

describe('opencc-js 转换基准（实跑验证）', () => {
  it.each([
    ['头发', '頭髮', '頭髮'],
    ['软件', '軟體', '軟件'],
    ['项目', '專案', '項目'],
    ['里面', '裡面', '裏面'],
  ])('%s → tw=%s / hk=%s', (cn, tw, hk) => {
    expect(twConverter(cn)).toBe(tw)
    expect(hkConverter(cn)).toBe(hk)
  })

  it('你好 两变体均无差异（作为不改写用例的依据）', () => {
    expect(twConverter('你好')).toBe('你好')
    expect(hkConverter('你好')).toBe('你好')
  })
})

describe('transformSource：单行 JSXText 改写', () => {
  it('生成 _CC 元素且 s/tw/hk 正确（含 import 注入）', () => {
    const source = `const App = () => <div>软件</div>;`
    const out = transformSource(source, PAGE_TSX)

    const elements = findCcElements(out)
    expect(elements).toHaveLength(1)
    expect(elements[0]).toMatchObject({ name: '_CC', s: '软件', tw: '軟體', hk: '軟件' })
    expect(findCcImports(out)).toEqual(['_CC'])
  })

  it('组合文本：欢迎回来，软件项目（含全角标点与组件 return 形状）', () => {
    const source = [
      `'use client';`,
      `import { useState } from 'react';`,
      `export default function Home() {`,
      `  return <div>欢迎回来，软件项目</div>;`,
      `}`,
    ].join('\n')
    const out = transformSource(source, PAGE_TSX)

    const elements = findCcElements(out)
    expect(elements).toHaveLength(1)
    expect(elements[0]!.s).toBe('欢迎回来，软件项目')
    expect(elements[0]!.tw).toBe('歡迎回來，軟體專案')
    expect(elements[0]!.hk).toBe('歡迎回來，軟件項目')
    expect(findCcImports(out)).toEqual(['_CC'])
  })

  it('JSX Fragment 内的文本同样转换', () => {
    const out = transformSource(`const A = () => <>里面</>;`, PAGE_TSX)
    const elements = findCcElements(out)
    expect(elements).toHaveLength(1)
    expect(elements[0]).toMatchObject({ s: '里面', tw: '裡面', hk: '裏面' })
  })

  it('单变体有差异即改写（端口：仅 tw 变体）', () => {
    const out = transformSource(`const A = () => <div>端口</div>;`, PAGE_TSX)
    const elements = findCcElements(out)
    expect(elements).toHaveLength(1)
    expect(elements[0]).toMatchObject({ s: '端口', tw: '埠', hk: '端口' })
  })

  it('文本含引号与反斜杠时 s 精确还原原文', () => {
    // 模板字符串源码 4 个反斜杠 → 运行时 JSXText 2 个；babel 的 JSXText
    // 词法不做转义折叠（value 即源码原样），s 应完整还原
    const out = transformSource(`const A = () => <div>配置"引号"和\\\\路径</div>;`, PAGE_TSX)
    const elements = findCcElements(out)
    expect(elements).toHaveLength(1)
    expect(elements[0]!.s).toBe('配置"引号"和\\\\路径')
  })

  it('单行文本带前后空白：s/tw/hk 保留空白原样', () => {
    const out = transformSource(`const A = () => <div> 软件 </div>;`, PAGE_TSX)
    const elements = findCcElements(out)
    expect(elements).toHaveLength(1)
    expect(elements[0]).toMatchObject({ s: ' 软件 ', tw: ' 軟體 ', hk: ' 軟件 ' })
  })

  it('相邻表达式：JSXText 分段各自独立转换', () => {
    const out = transformSource(`const A = () => <div>确认{count}个任务</div>;`, PAGE_TSX)
    const elements = findCcElements(out)
    expect(elements).toHaveLength(2)
    expect(elements[0]).toMatchObject({ s: '确认', tw: '確認', hk: '確認' })
    expect(elements[1]).toMatchObject({ s: '个任务', tw: '個任務', hk: '個任務' })
    // 表达式容器原样保留
    expect(out).toContain('{count}')
  })

  it('多个可转换文本共享一次 import、同一组件名', () => {
    const source = `const A = () => (<><div>软件</div><p>里面</p></>);`
    const out = transformSource(source, PAGE_TSX)
    expect(findCcElements(out)).toHaveLength(2)
    expect(findCcImports(out)).toEqual(['_CC'])
  })
})

describe('transformSource：跳过规则', () => {
  it('无 CJK 文件原样返回', () => {
    const source = `const A = () => <div>hello world</div>;`
    expect(transformSource(source, PAGE_TSX)).toBe(source)
  })

  it('多行 JSXText 跳过（保留 JSX 空白语义，交 runtime）', () => {
    const source = `const A = () => <div>\n  软件\n</div>;`
    expect(transformSource(source, PAGE_TSX)).toBe(source)
  })

  it('data-no-cc 祖先跳过，同文件其他文本仍转换', () => {
    const source = `const A = () => (<><div data-no-cc>软件</div><div>软件</div></>);`
    const out = transformSource(source, PAGE_TSX)

    const elements = findCcElements(out)
    expect(elements).toHaveLength(1)
    expect(elements[0]!.s).toBe('软件')
    // 带 data-no-cc 的 JSXText 原文保留且未被改写
    expect(out).toContain('<div data-no-cc>软件</div>')
  })

  it('数据层嵌套 data-no-cc（子元素继承祖先跳过）', () => {
    const source = `const A = () => <div data-no-cc><span>软件</span></div>;`
    expect(transformSource(source, PAGE_TSX)).toBe(source)
  })

  it('cc-disable 行注释整体跳过', () => {
    const source = `// cc-disable 本文件不做变体\nconst A = () => <div>软件</div>;`
    expect(transformSource(source, PAGE_TSX)).toBe(source)
  })

  it('cc-disable 块注释整体跳过', () => {
    const source = `/* cc-disable */\nconst A = () => <div>软件</div>;`
    expect(transformSource(source, PAGE_TSX)).toBe(source)
  })

  it('字符串字面量中的 cc-disable 字样不触发跳过', () => {
    const source = `const msg = 'cc-disable 只是文案';\nconst A = () => <div>软件</div>;`
    const out = transformSource(source, PAGE_TSX)
    expect(findCcElements(out)).toHaveLength(1)
  })

  it('字符串内含 cc-disable 的 URL 不触发跳过（cc-disable 只认真注释）', () => {
    const source = `const url = 'https://example.com/cc-disable';\nconst A = () => <div>软件</div>;`
    const out = transformSource(source, PAGE_TSX)
    expect(findCcElements(out)).toHaveLength(1)
  })

  it('模板字符串内的 https URL 不触发跳过', () => {
    const source =
      'const url = `https://example.com/cc-disable/路径`;\nconst A = () => <div>软件</div>;'
    const out = transformSource(source, PAGE_TSX)
    expect(findCcElements(out)).toHaveLength(1)
  })

  it.each([
    ['script', 'script'],
    ['style', 'style'],
    ['noscript', 'noscript'],
    ['template', 'template'],
    ['textarea', 'textarea'],
    ['code', 'code'],
    ['pre', 'pre'],
  ])('<%s> 祖先标签跳过（与 runtime 对齐）', (_name, tag) => {
    const source = `const A = () => <${tag}>软件</${tag}>;`
    expect(transformSource(source, PAGE_TSX)).toBe(source)
  })

  it('大写 SCRIPT 祖先标签同样跳过', () => {
    const source = `const A = () => <SCRIPT>软件</SCRIPT>;`
    expect(transformSource(source, PAGE_TSX)).toBe(source)
  })

  it('translate="no" 祖先跳过；translate="yes" 不跳过', () => {
    const skip = `const A = () => <div translate="no">软件</div>;`
    expect(transformSource(skip, PAGE_TSX)).toBe(skip)

    const keep = `const A = () => <div translate="yes">软件</div>;`
    const out = transformSource(keep, PAGE_TSX)
    expect(findCcElements(out)).toHaveLength(1)
  })

  it('className 含 ignore-opencc 祖先跳过', () => {
    const source = `const A = () => <div className="foo ignore-opencc bar">软件</div>;`
    expect(transformSource(source, PAGE_TSX)).toBe(source)
  })

  it('class 属性（非 React 写法）含 ignore-opencc 祖先跳过', () => {
    const source = `const A = () => <div class="ignore-opencc">软件</div>;`
    expect(transformSource(source, PAGE_TSX)).toBe(source)
  })

  it('ignore-opencc 前缀词（非独立 token）不误伤', () => {
    const source = `const A = () => <div className="ignore-openccx">软件</div>;`
    const out = transformSource(source, PAGE_TSX)
    expect(findCcElements(out)).toHaveLength(1)
  })

  it('tw 与 hk 转换结果都等于原文 → 不改写', () => {
    const source = `const A = () => <div>你好</div>;`
    expect(transformSource(source, PAGE_TSX)).toBe(source)
  })

  it.each([
    ['非 .tsx 文件', '/repo/apps/frontend/lib/foo.ts'],
    ['node_modules', '/repo/node_modules/pkg/dist/index.tsx'],
    ['app/api', '/repo/apps/frontend/app/api/hello/route.tsx'],
    ['route 文件', '/repo/apps/frontend/app/projects/[id]/route.tsx'],
    ['middleware 文件', '/repo/apps/frontend/middleware.tsx'],
    ['__tests__ 目录', '/repo/apps/frontend/__tests__/locale/foo.tsx'],
    ['content 目录', '/repo/apps/frontend/content/docs/page.tsx'],
  ])('排除规则：%s → 原样返回', (_name, resourcePath) => {
    const source = `const A = () => <div>软件</div>;`
    expect(transformSource(source, resourcePath)).toBe(source)
  })
})

describe('transformSource：import 注入与碰撞', () => {
  it('_CC 被文件自身绑定占用时改用 _CC2', () => {
    const source = `import _CC from './other-module';\nconst A = () => <div>软件</div>;`
    const out = transformSource(source, PAGE_TSX)

    const elements = findCcElements(out)
    expect(elements).toHaveLength(1)
    expect(elements[0]!.name).toBe('_CC2')
    expect(findCcImports(out)).toEqual(['_CC2'])
    // 原 import 保留
    expect(out).toContain(`import _CC from './other-module'`)
  })

  it('_CC 与 _CC2 都被占用时改用 _CC3', () => {
    const source = [
      `import _CC from './a';`,
      `import _CC2 from './b';`,
      `const A = () => <div>软件</div>;`,
    ].join('\n')
    const out = transformSource(source, PAGE_TSX)

    const elements = findCcElements(out)
    expect(elements[0]!.name).toBe('_CC3')
    expect(findCcImports(out)).toEqual(['_CC3'])
  })

  it('变量声明（非 import）占用 _CC 同样避让', () => {
    const source = `const _CC = 1;\nconst A = () => <div>软件</div>;`
    const out = transformSource(source, PAGE_TSX)
    expect(findCcImports(out)).toEqual(['_CC2'])
    expect(findCcElements(out)[0]!.name).toBe('_CC2')
  })

  it('函数内 const _CC shadow 注入 import：改用 _CC2 不被 shadow', () => {
    const source = `function A(){ const _CC = 1; return <div>软件</div>; }`
    const out = transformSource(source, PAGE_TSX)

    expect(findCcImports(out)).toEqual(['_CC2'])
    const elements = findCcElements(out)
    expect(elements).toHaveLength(1)
    expect(elements[0]!.name).toBe('_CC2')
    // 函数内 const _CC 原样保留，不被注入的 _CC2 影响
    expect(out).toContain('const _CC = 1')
  })

  it('函数参数 _CC 同样避让（shadow 场景）', () => {
    const source = `function A(_CC){ return <div>软件</div>; }`
    const out = transformSource(source, PAGE_TSX)
    expect(findCcImports(out)).toEqual(['_CC2'])
    expect(findCcElements(out)[0]!.name).toBe('_CC2')
  })

  it('JSX 中已有 _CC 引用（未 import）也触发改名', () => {
    const source = `const X = <_CC />;\nconst A = () => <div>软件</div>;`
    const out = transformSource(source, PAGE_TSX)
    expect(findCcImports(out)).toEqual(['_CC2'])
    const elements = findCcElements(out)
    // 用户原有的 <_CC /> 保留（无 s 属性），新生成元素用 _CC2
    expect(elements.some((el) => el.name === '_CC' && el.s === undefined)).toBe(true)
    expect(elements.some((el) => el.name === '_CC2' && el.s === '软件')).toBe(true)
  })

  it('cc import 只注入一次（即使产生多个 _CC 元素）', () => {
    const source = `const A = () => (<><div>软件</div><div>里面</div></>);`
    const out = transformSource(source, PAGE_TSX)
    expect(findCcImports(out)).toEqual(['_CC'])
    expect(findCcElements(out)).toHaveLength(2)
  })
})

describe('glossary 覆写', () => {
  it('applyGlossary：tw/hk 覆写与缺省变体保持', () => {
    // 契约指定词：OpenCC 不转换 → 覆写生效
    expect(applyGlossary('計算機', 'tw')).toBe('電腦')
    expect(applyGlossary('計算機', 'hk')).toBe('電腦')
    // 双击为 tw only：hk 保持 OpenCC 的 雙擊
    expect(applyGlossary('雙擊', 'tw')).toBe('連按兩下')
    expect(applyGlossary('雙擊', 'hk')).toBe('雙擊')
    // 回收站两变体都覆写（香港 Windows 标准用语）
    expect(applyGlossary('回收站', 'tw')).toBe('資源回收筒')
    expect(applyGlossary('回收站', 'hk')).toBe('資源回收筒')
    // 賬→帳（覆写键 = opencc(variant)(s)，实测 tw/hk 对 账号 的输出均为「賬號」）
    expect(applyGlossary('賬號管理', 'tw')).toBe('帳號管理')
    expect(applyGlossary('賬號', 'hk')).toBe('帳號')
    expect(applyGlossary('賬户', 'hk')).toBe('帳戶')
    // 許可權→權限、釋出→發布、儀表盤→儀表板、質量→品質、撤銷→復原
    expect(applyGlossary('許可權', 'tw')).toBe('權限')
    expect(applyGlossary('釋出', 'tw')).toBe('發布')
    expect(applyGlossary('儀表盤', 'tw')).toBe('儀表板')
    expect(applyGlossary('質量', 'tw')).toBe('品質')
    expect(applyGlossary('撤銷', 'tw')).toBe('復原')
    // 缺省变体不受影响：权限 的 hk 保持 OpenCC 输出
    expect(applyGlossary('許可權', 'hk')).toBe('許可權')
  })

  it('transformSource：glossary 覆写在产物中生效', () => {
    const source = `const A = () => <div>计算机 / 双击 / 回收站</div>;`
    const out = transformSource(source, PAGE_TSX)

    const elements = findCcElements(out)
    expect(elements).toHaveLength(1)
    expect(elements[0]).toMatchObject({
      s: '计算机 / 双击 / 回收站',
      tw: '電腦 / 連按兩下 / 資源回收筒',
      hk: '電腦 / 雙擊 / 資源回收筒',
    })
  })

  it('glossary 条目均按契约覆写键成立（opencc(s) 真实存在于转换结果中）', () => {
    const glossary = require('../../lib/locale/glossary') // eslint-disable-line @typescript-eslint/no-require-imports
    expect(Array.isArray(glossary)).toBe(true)
    expect(glossary.length).toBeGreaterThanOrEqual(10)
    expect(glossary.length).toBeLessThanOrEqual(20)

    for (const entry of glossary as Array<{ s: string; tw?: string; hk?: string }>) {
      for (const variant of ['tw', 'hk'] as const) {
        const target = entry[variant]
        if (target == null) continue
        // 覆写键 = opencc(entry.s)；套用后结果应为 target（在纯词串上验证）
        expect(applyGlossary(twConverter(entry.s), 'tw')).toBeDefined()
      }
      // 完整性：s 必须含 CJK（防止混入无效条目）
      expect(entry.s).toMatch(/[\u4e00-\u9fff]/)
    }
  })
})

describe('ccLoader webpack 包装', () => {
  it('通过 this.resourcePath 调用 transformSource', () => {
    const source = `const A = () => <div>软件</div>;`
    const out = (ccLoader as any).call({ resourcePath: PAGE_TSX }, source) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(findCcElements(out)).toHaveLength(1)
  })

  it('无 this.resourcePath 时原样返回（防御）', () => {
    const source = `const A = () => <div>软件</div>;`
    expect((ccLoader as any).call(null, source)).toBe(source) // eslint-disable-line @typescript-eslint/no-explicit-any
  })
})

describe('产物可被 JSX 编译器正确编译（_CC 视为组件而非标签）', () => {
  it('Next.js SWC transform：<_CC/> 编译为组件引用而非字符串标签', async () => {
    await loadBindings()
    const { code } = await transform(`const A = () => <_CC s="软件" tw="軟體" hk="軟件" />;`, {
      filename: 'generated.tsx',
      jsc: {
        parser: { syntax: 'typescript', tsx: true },
        transform: { react: { runtime: 'automatic' } },
      },
    })
    // 组件引用（jsx(_CC, …)），而非字符串标签（jsx("_CC", …)）
    expect(code).toContain('_CC')
    expect(code).not.toContain('"_CC"')
  })
})
