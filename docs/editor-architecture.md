# 编辑器模块边界

## 依赖方向

页面和布局负责静态区域装配，`scripts/editor.ts` 是应用组合入口。功能模块依赖通用 UI 工具、内容模型和适配器，不反向引用入口、页面或布局。`lib/ui` 不依赖编辑器功能。

| 模块 | 职责 |
| --- | --- |
| components/editor | 五个编辑步骤的静态容器 |
| metadata | 有类型的基本信息状态、表单绑定、整体替换 |
| authoring / ordered-list | 阶段、机制、区块、参考和宏的状态、顺序与组件生命周期 |
| richtext/editor | Tiptap 正文、事务与撤销历史；通过 BodyEditorHandle 暴露能力 |
| snapshot | 按需缓存当前内容快照与校验结果 |
| preview / proofread/reading | 从内容快照呈现不同阅读视图 |
| preview-view / submission-view / local-save | 预览校验展示、GitHub 提交状态与临时本地保存 |
| content-schema | 共享类型、业务规则、规范化、校验与内容序列化 |

## 数据所有权

标量字段由所属组件的状态持有，列表顺序由 typed ordered-list 持有。组件的 read 方法构造独立快照，不从 CSS 类名、父子选择器或页面 DOM 顺序推断业务结构。普通布局包装层不会改变序列化逻辑。

正文的唯一可编辑文档和撤销历史由 Tiptap 持有，快照时读取 BodyEditorHandle。应用不同时维护另一份可独立编辑的正文 JSON。正文块注册表以内容 id 为键，不以 DOM 元素为键；移位保留同一个实例，删除和导入替换立即调用 destroy。

编辑事件立即使预览缓存失效，将可见视图更新合并到一个微任务。只有进入预览步骤或其他快照消费者读取时才执行校验。提交直接读取当前编辑状态，由服务端完成 canonical JSON 序列化。校对使用当前内容，程序修改作者字段时须派发 input 事件，使状态同步。

## 单一来源

- SectionType 和 SECTION_RULES 定义合法类型、业务名称和标题必填规则；编辑器、预览、共享校验共同使用。输入占位提示属于编辑器 presentation。
- 内容颜色和字号白名单属于 content-schema；CSS tokens 只管理界面外观。
- 页面实例通过根元素隔离；静态监听由 AbortSignal 管理，destroy 清理正文和校对实例。页面移除时，集成方应调用返回的 destroy。
- packages/ui 仍为占位目录，待跨应用确有稳定复用需求后迁入共享组件，不复制当前基础变量形成第二个来源。

## 验证

`pnpm.cmd --dir apps/editor editor:state:test` 检查排序身份、快照缓存、业务规则和架构约束；`richtext:test`、`submission:ui:test` 覆盖既有富文本、校对及提交状态。`check` / `build` 负责类型和静态构建。

浏览器应另外验证：导入示例、正文编辑及撤销、加粗与颜色、区块增删排序、子机制、编辑到校对/预览的数据同步、桌面和窄屏浮层、键盘焦点。单元测试与静态构建不替代这些检查。真实 GitHub 写入需要相应服务环境与操作授权。

## 发布入口

第⑤步提供内容预览、校验与 GitHub Submission，并在提交按钮旁保留“保存到本地（JSON）”作为临时导出出口。它独立于提交状态和业务必填校验，直接从当前状态通过共享 structureToJson 生成规范 JSON；未完成或没有阶段的草稿也可导入恢复。已移除复制 JSON、旧版纯文本 JSON、Astro/衍生文件生成及其文件列表。导入现有 JSON 和载入示例属于编辑输入，继续保留；结构检查、富文本 HTML 安全转义及服务端 canonical 序列化继续由共享内容模型负责。

浏览器回归通过实际页面的组合入口，验证表单/正文编辑与排序到预览、保存和提交请求体的整条链路，以及生产提交禁用时本地保存与恢复。图片投稿测试额外启动临时本地 HTTP / SQLite / worker 服务，并复用模拟 GitHub 客户端；其余 API 和外部请求被拦截，不访问真实 GitHub。依赖检查解析 TS/TSX 导入与 Astro frontmatter/脚本中的导入（含无绑定导入）；颜色检查覆盖 CSS/SCSS 和 Astro 样式，并阻止直接引用基础色板。它们是本地回归命令，尚未接入 CI。

导入使用当前单一字段格式：根对象包含 metadata、references、macros、phases；字段及嵌套结构见 [业务文档](strategy-authoring-platform.md)。字符串可为空以保存未完成草稿，未知字段、旧 id／版本号／正文 value 格式及损坏结构均拒绝，不做旧格式迁移。导入失败保留当前内容；正式提交另外检查必填、命名、唯一性和安全规则。

## 名称、状态与操作时间

副本 name 决定文件名；阶段 name 由共享解析器拆出数值，组件排序只移动现有节点，保留正文实例和撤销历史。机制及子机制按同阶段名称检查唯一。正文仍使用全篇唯一的系统 id。

普通字段不 trim；极神、绝本和 other 的副本名仅把普通空格转换为短横线。状态在编辑器中只读为 draft，导入其他共享状态时明确提示。每次本地保存使用设备时间，提交服务使用服务端时间覆盖输入时间，统一写入 UTC ISO 8601 的 publish_time。成功响应使用 strategyName 标识副本，并返回 publishTime。

`pnpm.cmd --dir apps/editor schema:test` 验证命名边界、递归唯一性、字符限制、草稿恢复和字段删除。结构解析限制机制嵌套深度为 64，副本文件名最长 120 个字符；这两项保护边界同样适用于导入与提交。
