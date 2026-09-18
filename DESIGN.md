# 编辑器界面约定

- 保持深色界面与现有阶段卡片。正文工具栏直接使用 Tiptap 官方组件、图标和交互状态，嵌入正文块顶部；窄容器允许换行。
- 工具栏分为历史记录、文字格式、链接与颜色三组。仅包含撤销、重做、加粗、斜体、下划线、删除线、超链接、颜色、清除格式。
- 换行提示固定为：Enter 另起一段 · Shift + Enter 同段换行。
- 第③步承担正文编辑。第④步“全文校对”是只读全文阅读与建议处理界面，不重复放编辑框和格式工具栏。第⑤步承担预览、校验与提交审核。
- 第⑤步在校验结果后提供“提交审核”。提交态禁止并发请求，成功态只展示 PR 与 Submission ID；结果不确定时保持警告并禁止立即再次提交。
- 校对原文保留正文格式；定位使用高亮标记。建议逐条接受或忽略，不自动批量改写。手动修改回到第③步。
- 界面显示阶段、机制和小节名称，不暴露校对定位内部标识。
- UI 声称“校对完成”必须来自本次请求的有效模型响应，未配置、失败、取消与过期状态单独说明。

## 设计变量与单一来源

- `apps/editor/src/styles/tokens.css` 是界面数值来源：基础色 `palette-*` → 用途明确的语义色 → 组件样式。组件不直接引用基础色，也不自行写十六进制、RGB 或 HSL 色值。
- 主题色：`color-primary`、`color-on-primary`、`color-primary-hover`。主题按钮默认深紫、悬停亮紫；标题和链接使用更亮的主题前景色。
- 功能色：success / warning / danger / info 各有 text、bg、border。业务区块使用独立的 `section-mechanic-color`、`section-solution-color`、`section-note-color`，分别为黄、绿、蓝。通过 `data-section-type` 绑定，编辑与预览共用。
- 中性色按画布、面板、抬升表面、主文字、辅助文字、边框分层；焦点环、选区、校对高亮另有语义变量。状态必须同时提供文字或形状提示。
- 富文本中保存的颜色和字号属于 `content-schema` 的数据协议。保留既有白名单和序列化值，不随界面主题变化；工具栏色块是由该内容值驱动的合法动态样式。

## 排版、间距和形状

| 角色 | 字号 | 字重 | 行高 |
| --- | --- | --- | --- |
| 页面标题 | 20px | 600 | 1.4 |
| 区域标题 | 18px | 600 | 1.5 |
| 卡片标题 | 16px | 600 | 1.5 |
| 界面正文 | 14px | 400 | 1.6 |
| 表单标签 | 13px | 500 | 1.5 |
| 辅助说明 | 12px | 400 | 1.5 |
| 攻略正文 | 16px | 400 | 1.8 |

- 上表以 16px 根字号换算，实际变量使用 rem；每种角色分别定义 size、weight、leading。字体分别由 `font-ui`、`font-content`、`font-mono` 管理。
- `styles/content.css` 统一编辑、校对、预览的默认正文排版；导入内容中显式保存的字号仍保留。
- `space-*` 数字以 2px 为一个单位，以 4px 倍数为主要布局尺度，6px 用于紧凑控件。组件只拥有内部留白，父容器通过 gap 管理子组件间距。
- 圆角：small 4px、control 8px、panel 12px、pill。普通卡片不加阴影；浮层使用 popover 阴影，模态层使用 modal 阴影。焦点环独立于阴影。
- 容器宽度、侧栏宽度、控件高度和 z-index 各有独立变量。媒体查询的 900px、640px 断点在 CSS 中保持字面量，因为 CSS 变量不能作为媒体查询阈值。
- 新的固定 UI 样式写入组件类，不拼接到 TypeScript 或 Astro 的 style 属性。正文格式和用户选择的色块除外。

## 样式与组件边界

- `EditorLayout.astro` 按 tokens → base → components → layout → editor → content 加载样式，并装配功能样式。
- `components.css` 提供按钮、表单、卡片等基础类，不使用全局 input / label / header 规则替代组件类。
- `layout.css` 管理页面布局、响应式与布局工具类；`editor.css` 管理阶段、区块、预览和资源展示。
- `lib/proofread/panel.css`、`lib/editor/submission.css`、`lib/richtext/toolbar.scss` 分别管理功能自身的外观。
- Tiptap 组件和交互继续使用 vendored 官方 UI。`styles/tiptap-adapter.css` 将其变量映射到站点变量，不加载第三方的根级重置和第二套品牌色；映射在根作用域提供，确保 Portal 浮层也能继承。
- 导入成功与失败在页面的 live status 区域反馈，不使用阻塞式原生提示框。
