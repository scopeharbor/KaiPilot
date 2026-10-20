# 品牌素材（开项 KaiPilot）

本目录是开项的运行时品牌素材。文件名沿用内部代号 `aiproj-*`，代码引用不变。

标志是「开项」二字的融合字形：「开」的两横是两条甘特任务条，两条腿是 K 和 P；「项」左边的「工」是 I——读作「开项」，也读作 KPI。

## 文件

- `aiproj-logo-mark-light.svg` / `aiproj-logo-mark-dark.svg`：静态标志，朱砂圆角方块 +「开」，小尺寸也清楚。
- `aiproj-logo-loader-light.svg` / `aiproj-logo-loader-dark.svg`：载入动画。先画出任务条，再写出 K、P、I，然后淡出并循环。内置 `prefers-reduced-motion` 降级。
- `kaipilot-lockup-light.svg` / `kaipilot-lockup-dark.svg`：横版「开项 KaiPilot」。中英文都是路径，不依赖字体。
- `app-icon-192.png` / `app-icon-512.png`：PWA 图标，满版朱砂底，图案落在 maskable 安全区内。

## 配色

| 用途             | 亮底      | 暗底 / 朱砂底 |
| ---------------- | --------- | ------------- |
| 朱砂（K、P、I）  | `#C2410C` | —             |
| 金（K、P、I）    | —         | `#FBBF24`     |
| 墨（任务条、页） | `#1C1917` | `#F5F5F4`     |
| 米白             | —         | `#FFF7ED`     |

## 使用规则

- React 组件里用 `<img src>` 引用这些文件，不要把 SVG 内联进代码。
- 载入动画只用在超过约 500ms 的 AI 等待，以及页面或视图级的加载。不要用在按钮、表格行，或小于 32px 的进度状态里。
- 不要单独修改标志的颜色、比例或圆角。
