# XivStrat Platform

面向最终幻想 XIV 攻略作者的结构化编辑器，支持富文本正文、全文语言校对、内容预览与校验，以及通过 GitHub Submission 创建审核 PR。当前已实现编辑器；独立审核平台尚未实现。

## 编辑流程

| 步骤 | 功能 |
| --- | --- |
| ① 基本信息 | 填写攻略标识、标题、作者等元数据 |
| ② 参考与宏 | 管理参考链接与游戏宏 |
| ③ 阶段与机制 | 编辑阶段、机制、子机制和内容区块，调整顺序；正文支持格式、链接、预设颜色及撤销/重做 |
| ④ 全文校对 | 阅读完整正文；配置模型服务后可生成语言建议，定位、逐条接受或忽略 |
| ⑤ 预览 · 校验 · 提交 | 查看当前内容与校验结果，通过 GitHub 提交审核，或临时保存 JSON 到本地；也可导入已有 JSON、载入示例及使用素材工具 |

正文编辑和预览无需模型服务。导入兼容旧版正文数据；提交时由服务端生成规范 JSON。正式发布入口统一为 GitHub Submission。“保存到本地（JSON）”与“提交审核”并列，作为临时本地导出出口保留；它不提交审核，也不自动保存后续修改。未完成必填项或尚未添加阶段的草稿也可保存并重新导入。不恢复复制 JSON、生成 Astro 文件或下载旧版衍生文件。

素材工具包括封面上传、COS 配置、图片库和游戏资源查询，使用外部服务的功能需要相应配置与网络连接。

## 本地启动

需要 Node.js 24 或以上版本、pnpm 10.33.0。以下命令在仓库根目录执行（Windows PowerShell）：

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd dev:editor --host 127.0.0.1
```

打开 [本地编辑器](http://127.0.0.1:4321/editor/)。依赖构建许可集中在 `pnpm-workspace.yaml`，当前仅允许 esbuild 和 sharp。

### 可选：AI 校对服务

按照 [.env.example](.env.example) 在根目录 `.env` 中配置 `PROOFREAD_ENDPOINT`、`PROOFREAD_MODEL` 和 `PROOFREAD_API_KEY`，另开终端执行：

```powershell
pnpm.cmd --dir apps/editor proofread:dev
```

默认监听 `127.0.0.1:4322`，开发服务器通过 `/api/proofread` 代理请求。模型协议、内容范围和部署要求见 [正文编辑与全文校对](docs/richtext-proofread.md)。

### 可选：GitHub 提交审核服务

在根目录 `.env` 配置 GitHub App 的 `GITHUB_APP_ID`、`GITHUB_APP_INSTALLATION_ID`，以及 `GITHUB_APP_PRIVATE_KEY_PATH` 或 `GITHUB_APP_PRIVATE_KEY`。目标仓库由服务端的 `GITHUB_OWNER`、`GITHUB_REPO`、`GITHUB_BASE_BRANCH` 指定，默认是本仓库的 `main`。私钥留在仓库外或服务端密钥管理中。

```powershell
pnpm.cmd --dir apps/editor submission:dev
```

服务监听 `127.0.0.1:4323`，开发服务器通过 `/api/submissions` 代理请求。点击“提交审核”会实际创建远程分支、内容提交和 PR；成功后显示 PR 链接与 Submission ID。写入结果不确定时，界面会阻止直接重试，需先核实远程状态。

当前构建为静态站点，生产模式下提交审核入口禁用，但本地保存仍可用；本地开发服务不等于已部署的生产发布能力。

## 设计与代码架构

界面颜色按主题色、功能色、标准色和内容区块角色分层；间距、字体、字号、字重、行高、圆角、阴影等由 `tokens.css` 集中定义。正文允许持久化的颜色与字号由共享内容模型管理。

页面负责装配步骤组件，脚本入口组合功能模块，功能模块依赖通用 UI 工具、适配器与共享内容模型，依赖保持单向。表单和列表由有类型的状态管理，正文文档与撤销历史由 Tiptap 持有，预览、校验和提交读取同一内容来源。

- [设计规范](DESIGN.md)：视觉变量、内容样式及第三方工具栏适配约定。
- [编辑器架构](docs/editor-architecture.md)：模块职责、状态所有权、依赖方向与验证边界。

## 目录

| 路径 | 职责 |
| --- | --- |
| `apps/editor/src/pages`、`layouts`、`components` | 页面、布局与步骤组件 |
| `apps/editor/src/scripts`、`lib/editor` | 应用装配、编辑状态、预览与提交界面 |
| `apps/editor/src/lib/richtext`、`lib/proofread` | 富文本编辑与全文校对 |
| `apps/editor/src/server` | GitHub Submission、校对等服务端逻辑 |
| `apps/editor/src/styles` | 设计变量、基础样式、组件样式和第三方适配 |
| `packages/content-schema` | 共享类型、业务规则、运行时校验、迁移及序列化 |
| `apps/reviewer`、`packages/ui`、`packages/config` | 预留目录，尚未实现独立应用或共享包 |

## 验证与构建

```powershell
pnpm.cmd check:editor
pnpm.cmd build:editor
pnpm.cmd --dir apps/editor editor:state:test
pnpm.cmd --dir apps/editor richtext:test
pnpm.cmd --dir apps/editor submission:ui:test
pnpm.cmd --dir apps/editor submission:http:test
pnpm.cmd --dir apps/editor github:submission:test
```

上述测试覆盖状态、架构约束、富文本、校对及模拟的 GitHub 提交流程，不会创建真实 PR。`github:submission:e2e` 是另行配置并确认后才运行的真实远程写入测试，不属于上述常规验证。

界面改动还需在浏览器检查编辑、撤销、区块排序、导入、预览同步及窄屏布局；类型检查和静态构建不能替代运行时验收。

### 浏览器回归测试

先执行 `pnpm.cmd build:editor`，再执行 `pnpm.cmd --dir apps/editor test:browser`。测试独立启动 4331 开发服务器与 4332 静态预览服务器，覆盖实际表单、Tiptap 正文、排序、预览、提交请求体及生产模式草稿下载与恢复。所有 API 和外部请求均被拦截，不创建远程 PR。

默认使用本机已安装的 Microsoft Edge。没有 Edge 的环境可先安装 Playwright Chromium，并设置 `PLAYWRIGHT_CHANNEL=chromium`。浏览器测试是独立命令，未添加 CI；截图和失败追踪保存在被 Git 忽略的 `apps/editor/test-results/`。
