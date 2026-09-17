# 编辑器模块边界

## 依赖方向

页面和布局负责静态区域装配，`scripts/editor.ts` 是应用组合入口。功能模块依赖通用 UI 工具、内容模型和适配器，不反向引用入口、页面或布局。`lib/ui` 不依赖编辑器功能。

| 模块 | 职责 |
| --- | --- |
| components/editor | 五个步骤及 COS、图库、游戏查询的静态容器 |
| metadata | 有类型的基本信息状态、表单绑定、整体替换 |
| authoring / ordered-list | 阶段、机制、区块、参考和宏的状态、顺序与组件生命周期 |
| richtext/editor | Tiptap 正文、事务与撤销历史；通过 BodyEditorHandle 暴露能力 |
| snapshot | 按需缓存当前内容快照与校验结果 |
| preview / proofread/reading | 从内容快照呈现不同阅读视图 |
| preview-view / submission-view | 预览校验展示和 GitHub 提交状态展示 |
| banner-upload / image-library / game-search | 各自的资源工具界面 |
| cos-client / asset-storage / image-utils | 外部 SDK、浏览器存储、图片处理适配 |
| content-schema | 共享类型、业务规则、规范化、校验与内容序列化 |

## 数据所有权

标量字段由所属组件的状态持有，列表顺序由 typed ordered-list 持有。组件的 read 方法构造独立快照，不从 CSS 类名、父子选择器或页面 DOM 顺序推断业务结构。普通布局包装层不会改变序列化逻辑。

正文的唯一可编辑文档和撤销历史由 Tiptap 持有，快照时读取 BodyEditorHandle。应用不同时维护另一份可独立编辑的正文 JSON。正文块注册表以内容 id 为键，不以 DOM 元素为键；移位保留同一个实例，删除和导入替换立即调用 destroy。

编辑事件立即使预览缓存失效，将可见视图更新合并到一个微任务。只有进入预览步骤或其他快照消费者读取时才执行校验。提交直接读取当前编辑状态，由服务端完成 canonical JSON 序列化。校对使用当前内容，辅助工具的关键词、图库字段等不参与攻略刷新。程序修改作者字段时须派发 input 事件，使状态同步。

## 单一来源

- SectionType 和 SECTION_RULES 定义合法类型、业务名称和标题必填规则；编辑器、预览、共享校验共同使用。输入占位提示属于编辑器 presentation。
- 内容颜色和字号白名单属于 content-schema；CSS tokens 只管理界面外观。
- 页面实例通过根元素隔离；静态监听由 AbortSignal 管理，destroy 清理正文和校对实例。页面移除时，集成方应调用返回的 destroy。
- packages/ui 仍为占位目录，待跨应用确有稳定复用需求后迁入共享组件，不复制当前基础变量形成第二个来源。

## 验证

`pnpm.cmd --dir apps/editor editor:state:test` 检查排序身份、快照缓存、业务规则和架构约束；`richtext:test`、`submission:ui:test` 覆盖既有富文本、校对及提交状态。`check` / `build` 负责类型和静态构建。

浏览器应另外验证：导入示例、正文编辑及撤销、加粗与颜色、区块增删排序、子机制、编辑到校对/预览的数据同步、桌面和窄屏浮层、键盘焦点。单元测试与静态构建不替代这些检查。真实 COS 上传、XIVAPI 请求及 GitHub 写入需要相应服务环境与操作授权。

## 发布入口

第⑤步只提供内容预览、校验与 GitHub Submission。已移除手动下载/复制 canonical JSON、旧版纯文本 JSON、Astro/衍生文件生成及其文件列表。导入现有 JSON 和载入示例属于编辑输入，继续保留；旧数据迁移、富文本 HTML 安全转义及服务端 canonical 序列化继续由共享内容模型负责。图库中的复制图标地址是素材工具，不属于发布流程。
