# 品牌素材（开项 Kaiplan）

本目录是开项的运行时品牌素材。文件名沿用内部代号 `aiproj-*`，代码引用不变。

## 文件

- `aiproj-logo-mark-light.svg` / `aiproj-logo-mark-dark.svg`：静态标志（亮色 / 暗色）。
- `aiproj-logo-loader-light.svg` / `aiproj-logo-loader-dark.svg`：载入动画。「开引号」一笔画出，朱砂方块弹出，然后淡出并循环。内置 `prefers-reduced-motion` 降级。
- `kaiplan-lockup-light.svg` / `kaiplan-lockup-dark.svg`：标志加「开项」文字组合。文字是路径，不依赖字体。
- `app-icon-192.png` / `app-icon-512.png`：PWA 图标，白底。图案缩到 62%，落在 maskable 安全区内。

## 配色

| 用途       | 亮色      | 暗色      |
| ---------- | --------- | --------- |
| 靛蓝       | `#4338CA` | `#818CF8` |
| 朱砂       | `#F04E30` | `#FF6B4A` |
| 墨（文字） | `#1E1B4B` | `#EEF0FF` |

## 使用规则

- React 组件里用 `<img src>` 引用这些文件，不要把 SVG 内联进代码。
- 载入动画只用在超过约 500ms 的 AI 等待，以及页面或视图级的加载。不要用在按钮、表格行，或小于 32px 的进度状态里。
- 不要单独修改标志的颜色、比例或圆角。
