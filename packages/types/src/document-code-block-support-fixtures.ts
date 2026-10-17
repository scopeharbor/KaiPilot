// v3-document-code-block-support fixtures —— 覆盖 supported/unsupported/unlabeled/unclosed/indented/
// long-line/inline-code/raw-HTML/remote-image 场景，供前后端测试共享。

import type { FencedCodeBlockMeta } from './document-code-block-support.js'

// ---------------------------------------------------------------------------
// Markdown 文本 fixture
// ---------------------------------------------------------------------------

/** 基础混合文档：多种语言代码块 + 文本 + 行内代码 + raw HTML + 远程图片 */
export const mdFixtureMixedContent = `# 项目部署指南

本文档介绍如何在生产环境中部署服务。

## 前置条件

\`\`\`bash
# 安装依赖
npm install
npm run build
\`\`\`

## 数据库配置

\`\`\`sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
\`\`\`

## API 接口

未标注语言的代码块：

\`\`\`
GET /api/v1/health
POST /api/v1/data
\`\`\`

## 前端代码示例

\`\`\`typescript
import { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>
}
\`\`\`

## JSON 配置

\`\`\`json
{
  "name": "aiproj",
  "version": "3.0.0",
  "dependencies": {
    "react": "^18.0.0"
  }
}
\`\`\`

## 警告

<div class="alert">这是 raw HTML，不应被渲染</div>

## 远程图片

![示例](https://example.com/image.png)

行内代码：\`const x = 1\` 是赋值语句。

## 长行代码

\`\`\`
echo "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
\`\`\`
`

/** 未闭合围栏 */
export const mdFixtureUnclosedFence = `# 未闭合测试

\`\`\`bash
echo "this fence is not closed"

后面是正文
`

/** 缩进围栏（≤3 空格） */
export const mdFixtureIndentedFence = `# 缩进围栏

   \`\`\`python
print("indented by 3 spaces")
   \`\`\`
`

/** ~ 围栏（tilde fence） */
export const mdFixtureTildeFence = `# Tilde 围栏

~~~bash
echo "tilde fence test"
~~~
`

/** 空文档 */
export const mdFixtureEmpty = ''

/** 纯文本（无代码块） */
export const mdFixtureProseOnly = `# 纯文本

这是一段没有任何代码块的文本。

仅包含标题、段落和列表。

- 项目 A
- 项目 B
`

/** 仅有行内代码（不产生块级代码块） */
export const mdFixtureInlineCodeOnly = `# 行内代码

在项目中使用 \`import { foo } from 'bar'\` 导入模块。

也可以使用 \`\`\` 三个反引号围栏语法。

\`const y = 2\` 是行内代码。
`

/** 超长行 */
export const mdFixtureLongLine = `# 超长行

\`\`\`
${'x'.repeat(500)}
\`\`\`
`

// ---------------------------------------------------------------------------
// 预期代码块元数据 fixture
// ---------------------------------------------------------------------------

/** mdFixtureMixedContent 的预期代码块 */
export const expectedMixedFencedBlocks: FencedCodeBlockMeta[] = [
  {
    language: 'bash',
    labeled: true,
    supported: true,
    startLine: 7,
    endLine: 11,
    lineCount: 3,
    byteCount: new Blob(['# 安装依赖\nnpm install\nnpm run build\n']).size,
    closed: true,
  },
  {
    language: 'sql',
    labeled: true,
    supported: true,
    startLine: 19,
    endLine: 24,
    lineCount: 4,
    byteCount: new Blob([
      'CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL\n);\n',
    ]).size,
    closed: true,
  },
  {
    language: null,
    labeled: false,
    supported: false,
    startLine: 30,
    endLine: 33,
    lineCount: 2,
    byteCount: new Blob(['GET /api/v1/health\nPOST /api/v1/data\n']).size,
    closed: true,
  },
  {
    language: 'typescript',
    labeled: true,
    supported: true,
    startLine: 37,
    endLine: 44,
    lineCount: 6,
    byteCount: new Blob([
      "import { useState } from 'react'\n\nexport function Counter() {\n  const [count, setCount] = useState(0)\n  return <button onClick={() => setCount(c => c + 1)}>{count}</button>\n}\n",
    ]).size,
    closed: true,
  },
  {
    language: 'json',
    labeled: true,
    supported: true,
    startLine: 48,
    endLine: 57,
    lineCount: 8,
    byteCount: new Blob([
      '{\n  "name": "aiproj",\n  "version": "3.0.0",\n  "dependencies": {\n    "react": "^18.0.0"\n  }\n}\n',
    ]).size,
    closed: true,
  },
  {
    language: null,
    labeled: false,
    supported: false,
    startLine: 73,
    endLine: 75,
    lineCount: 1,
    byteCount: new Blob([
      'echo "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"\n',
    ]).size,
    closed: true,
  },
]

/** mdFixtureUnclosedFence 的预期代码块 */
export const expectedUnclosedFencedBlocks: FencedCodeBlockMeta[] = [
  {
    language: 'bash',
    labeled: true,
    supported: true,
    startLine: 3,
    endLine: 6,
    lineCount: 2,
    byteCount: new Blob(['echo "this fence is not closed"\n']).size,
    closed: false,
  },
]

/** mdFixtureIndentedFence 的预期代码块 */
export const expectedIndentedFencedBlocks: FencedCodeBlockMeta[] = [
  {
    language: 'python',
    labeled: true,
    supported: true,
    startLine: 3,
    endLine: 5,
    lineCount: 1,
    byteCount: new Blob(['print("indented by 3 spaces")\n']).size,
    closed: true,
  },
]

/** mdFixtureTildeFence 的预期代码块 */
export const expectedTildeFencedBlocks: FencedCodeBlockMeta[] = [
  {
    language: 'bash',
    labeled: true,
    supported: true,
    startLine: 3,
    endLine: 5,
    lineCount: 1,
    byteCount: new Blob(['echo "tilde fence test"\n']).size,
    closed: true,
  },
]
