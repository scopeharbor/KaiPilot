import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createDomConverter,
  registerConvertedOutput,
  type DomConverter,
} from '@/lib/locale/dom-converter'

// 等待 opencc lazy 加载 + 初始扫描（jsdom 无 requestIdleCallback，走 setTimeout fallback）
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** 启动一个转换器并等待初始扫描完成，登记到 active 以便用例结束后清理。 */
async function startConverter(variant: 'tw' | 'hk'): Promise<DomConverter> {
  const converter = createDomConverter(variant)
  active.push(converter)
  await converter.start()
  await flush()
  return converter
}

let active: DomConverter[] = []

beforeEach(() => {
  active = []
  document.body.innerHTML = ''
  document.title = ''
})

afterEach(() => {
  for (const converter of active) {
    converter.stop()
    converter.restore()
  }
  active = []
})

describe('createDomConverter', () => {
  it('初始扫描：文本节点被转换（tw 词表）', async () => {
    document.body.innerHTML = '<div id="app">软件开发 内存</div>'
    await startConverter('tw')
    expect(document.querySelector('#app')!.textContent).toBe('軟體開發 記憶體')
  })

  it('初始扫描：hk 变体使用香港词表', async () => {
    document.body.innerHTML = '<div id="app">软件开发 计算机</div>'
    await startConverter('hk')
    expect(document.querySelector('#app')!.textContent).toBe('軟件開發 電腦')
  })

  it('初始扫描：glossary 覆写生效（计算机→電腦、回收站→資源回收筒）', async () => {
    document.body.innerHTML = '<div id="app">把文件移入计算机 回收站</div>'
    await startConverter('tw')
    expect(document.querySelector('#app')!.textContent).toBe('把檔案移入電腦 資源回收筒')
  })

  it('MutationObserver：新增节点被转换', async () => {
    document.body.innerHTML = '<div id="host"></div>'
    await startConverter('tw')
    const host = document.querySelector('#host')!
    host.innerHTML = '<p>软件开发</p>'
    await flush()
    expect(host.textContent).toBe('軟體開發')
  })

  it('外部写入会被重新转换，且不会死循环（mutation 计数有上界）', async () => {
    document.body.innerHTML = '<div id="t">软件开发</div>'
    await startConverter('tw')

    // 独立计数观察器：记录转换器自身写回引发的 mutation
    let mutations = 0
    const counter = new MutationObserver(() => {
      mutations += 1
    })
    counter.observe(document.body, { subtree: true, characterData: true })

    const node = document.querySelector('#t')!.firstChild as Text
    for (let i = 0; i < 5; i += 1) {
      node.nodeValue = '软件开发' // 外部（React 风格）写入
      await flush()
    }
    counter.disconnect()

    expect(node.nodeValue).toBe('軟體開發')
    // 每次外部写入最多产生 1 次转换器写回；若防循环失效计数会显著超界
    expect(mutations).toBeLessThanOrEqual(10)
  })

  it('属性写入不会死循环（mutation 计数有上界）', async () => {
    document.body.innerHTML = '<div id="el" title="查看详情"></div>'
    await startConverter('tw')

    let mutations = 0
    const counter = new MutationObserver(() => {
      mutations += 1
    })
    counter.observe(document.body, { subtree: true, attributes: true })

    const el = document.querySelector('#el') as HTMLDivElement
    for (let i = 0; i < 5; i += 1) {
      el.setAttribute('title', '查看详情')
      await flush()
    }
    counter.disconnect()

    expect(el.getAttribute('title')).toBe('檢視詳情')
    expect(mutations).toBeLessThanOrEqual(10)
  })

  it('restore 还原全部文本、属性与 document.title', async () => {
    document.title = '项目管理系统'
    document.body.innerHTML = '<div id="a" title="查看详情">软件开发</div><div id="b">计算机</div>'
    const converter = await startConverter('tw')

    expect(document.querySelector('#a')!.textContent).toBe('軟體開發')
    expect(document.querySelector('#b')!.textContent).toBe('電腦')
    expect(document.querySelector('#a')!.getAttribute('title')).toBe('檢視詳情')
    expect(document.title).toBe('專案管理系統')

    converter.stop()
    converter.restore()

    expect(document.querySelector('#a')!.textContent).toBe('软件开发')
    expect(document.querySelector('#b')!.textContent).toBe('计算机')
    expect(document.querySelector('#a')!.getAttribute('title')).toBe('查看详情')
    expect(document.title).toBe('项目管理系统')
    converter.restore() // 二次 restore 安全无副作用
  })

  it('INPUT/TEXTAREA 文字内容与 opt-out 子树不转换（白名单属性除外）', async () => {
    document.body.innerHTML = `
      <input placeholder="请输入项目名称" />
      <textarea placeholder="请输入描述">用户输入内容</textarea>
      <code>const 变量 = 1</code>
      <pre>软件开发</pre>
      <div data-no-cc>软件开发</div>
      <div translate="no">软件开发</div>
      <div class="ignore-opencc">软件开发</div>
      <input data-no-cc placeholder="请输入项目名称" />
    `
    await startConverter('tw')

    const input = document.querySelector('input') as HTMLInputElement
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    // 产品裁定：input/textarea 的文字内容 / value 属用户数据不动，
    // 但其 placeholder 等白名单属性要转（placeholder 的主要载体就是 input）
    expect(input.placeholder).toBe('請輸入專案名稱')
    expect(textarea.placeholder).toBe('請輸入描述')
    expect(textarea.textContent).toBe('用户输入内容')
    expect(document.querySelector('code')!.textContent).toBe('const 变量 = 1')
    expect(document.querySelector('pre')!.textContent).toBe('软件开发')
    expect(document.querySelector('[data-no-cc]')!.textContent).toBe('软件开发')
    expect(document.querySelector('[translate="no"]')!.textContent).toBe('软件开发')
    expect(document.querySelector('.ignore-opencc')!.textContent).toBe('软件开发')
    // opt-out 标记仍是整区域不转：属性也不动
    const optOutInput = document.querySelector('input[data-no-cc]') as HTMLInputElement
    expect(optOutInput.placeholder).toBe('请输入项目名称')
  })

  it('input/textarea 白名单属性：初始扫描、observer 变更与 restore 还原', async () => {
    document.body.innerHTML =
      '<input id="in" placeholder="请输入项目名称" title="搜索项目" /><textarea id="ta" placeholder="请输入描述">用户输入内容</textarea>'
    const converter = await startConverter('tw')

    const input = document.querySelector('#in') as HTMLInputElement
    const textarea = document.querySelector('#ta') as HTMLTextAreaElement
    expect(input.placeholder).toBe('請輸入專案名稱')
    expect(input.title).toBe('搜尋專案')
    expect(textarea.placeholder).toBe('請輸入描述')
    expect(textarea.textContent).toBe('用户输入内容')

    // observer 期间外部（React 风格）重写属性 → 重新转换
    input.setAttribute('placeholder', '请输入名称')
    textarea.setAttribute('aria-label', '打开设置')
    input.setAttribute('value', '用户已输入的值') // 非白名单属性，不转换
    await flush()
    expect(input.placeholder).toBe('請輸入名稱')
    expect(textarea.getAttribute('aria-label')).toBe('開啟設定')
    expect(input.getAttribute('value')).toBe('用户已输入的值')

    converter.stop()
    converter.restore()
    // restore 回到首次转换前的原文快照（含期间外部重写过的属性）
    expect(input.placeholder).toBe('请输入项目名称')
    expect(input.title).toBe('搜索项目')
    expect(textarea.placeholder).toBe('请输入描述')
    expect(textarea.getAttribute('aria-label')).toBe('打开设置')
    expect(textarea.textContent).toBe('用户输入内容')
  })

  it('白名单属性 placeholder/title/aria-label/aria-placeholder/alt 被转换', async () => {
    document.body.innerHTML =
      '<div id="el" title="查看详情" placeholder="请输入关键词" aria-label="打开设置" aria-placeholder="搜索项目" alt="项目封面"></div>'
    await startConverter('tw')
    const el = document.querySelector('#el')!
    expect(el.getAttribute('title')).toBe('檢視詳情')
    expect(el.getAttribute('placeholder')).toBe('請輸入關鍵詞')
    expect(el.getAttribute('aria-label')).toBe('開啟設定')
    expect(el.getAttribute('aria-placeholder')).toBe('搜尋專案')
    expect(el.getAttribute('alt')).toBe('專案封面')
  })

  it('document.title 初始与增量均被转换，restore 回到转换前原文', async () => {
    document.title = '项目管理系统'
    const converter = await startConverter('tw')
    expect(document.title).toBe('專案管理系統')

    document.title = '系统设置' // 外部（React）写入
    await flush()
    expect(document.title).toBe('系統設定')

    converter.stop()
    converter.restore()
    expect(document.title).toBe('系统设置')
  })

  it('已跳过子树内新增节点也不转换', async () => {
    document.body.innerHTML = '<div data-no-cc><p id="host">软件开发</p></div>'
    await startConverter('tw')
    const host = document.querySelector('#host')!
    host.innerHTML = '<span>内存</span>'
    await flush()
    expect(host.textContent).toBe('内存')
  })

  it('M1：可信输出注册表——tw 最终值不被二次转换腐蚀（儀表板 不变成 儀錶板）', async () => {
    registerConvertedOutput('儀表板') // 模拟 CC 组件渲染 tw 产物时的注册
    document.body.innerHTML = '<div id="t">儀表板</div>'

    // 初始扫描：值已在注册表 → 直接跳过，保持最终繁体
    await startConverter('tw')
    const node = document.querySelector('#t')!.firstChild as Text
    expect(node.nodeValue).toBe('儀表板')

    // observer 期间 React 重渲染写入同值 → 仍不腐蚀（twp('儀表板')='儀錶板'）
    node.nodeValue = '儀表板'
    await flush()
    expect(node.nodeValue).toBe('儀表板')

    // 简体「仪表盘」仍会被转成最终值「儀表板」，且只转一次（不会 儀表盤→儀錶板 二次污染）
    document.body.innerHTML = '<div id="s">仪表盘</div>'
    let mutations = 0
    const counter = new MutationObserver(() => {
      mutations += 1
    })
    counter.observe(document.body, { subtree: true, characterData: true })

    const sNode = document.querySelector('#s')!.firstChild as Text
    await flush()
    expect(sNode.nodeValue).toBe('儀表板')
    await flush()
    expect(sNode.nodeValue).toBe('儀表板')
    counter.disconnect()
    // innerHTML 触发一次转换写回即止；若再次被转（腐蝕路径）计数会多一轮
    expect(mutations).toBeLessThanOrEqual(2)
  })

  it('M1：注册表对白名单属性同样生效（placeholder 不被二次转换）', async () => {
    registerConvertedOutput('請輸入專案名稱')
    document.body.innerHTML = '<input id="in" placeholder="請輸入專案名稱" />'
    const converter = await startConverter('tw')
    const input = document.querySelector('#in') as HTMLInputElement
    expect(input.placeholder).toBe('請輸入專案名稱')

    input.setAttribute('placeholder', '請輸入專案名稱') // observer 期间外部同值写入
    await flush()
    expect(input.placeholder).toBe('請輸入專案名稱')
    converter.stop()
    converter.restore()
    expect(input.placeholder).toBe('請輸入專案名稱')
  })

  it('m5：title 元素被整棵替换后，新标题仍被转换（head childList 接管）', async () => {
    document.title = '项目管理系统'
    const converter = await startConverter('tw')
    expect(document.title).toBe('專案管理系統')

    const oldTitle = document.querySelector('title')!
    const freshTitle = document.createElement('title')
    freshTitle.textContent = '系统设置'
    oldTitle.parentNode!.replaceChild(freshTitle, oldTitle) // 整棵替换（部分 head 管理库的做法）
    await flush()
    expect(document.title).toBe('系統設定')

    converter.stop()
    converter.restore()
    expect(document.title).toBe('系统设置')
  })

  it('start 幂等：第二次调用返回同一个进行中的 promise；stop 后可重新启动', async () => {
    document.body.innerHTML = '<div id="t">软件开发</div>'
    const converter = createDomConverter('tw')
    const p1 = converter.start()
    const p2 = converter.start()
    expect(p2).toBe(p1) // 同一个 promise，await start(); await start() 语义一致
    await p1
    await p2
    await flush()
    expect(document.querySelector('#t')!.textContent).toBe('軟體開發')

    converter.stop()
    converter.stop()
    converter.restore()
    expect(document.querySelector('#t')!.textContent).toBe('软件开发')

    // stop 之后 start 会重新完整启动
    await converter.start()
    await flush()
    expect(document.querySelector('#t')!.textContent).toBe('軟體開發')
    converter.stop()
    converter.restore()
  })
})
