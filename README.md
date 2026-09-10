# XivStrat Platform

攻略编辑平台与审核平台 monorepo。当前编辑器支持结构化攻略、受限富文本正文和独立的全文语言校对步骤。

## 本地启动

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd dev:editor --host 127.0.0.1
```

打开 http://127.0.0.1:4321/editor/。正文编辑无需模型服务；AI 校对需要另行配置服务端。

## 目录

- `apps/editor`：Astro 编辑器，正文工具栏使用 Tiptap 官方 UI 组件。
- `apps/reviewer`：审核平台目录。
- `packages/content-schema`：共享 TypeScript 数据契约、运行时校验、迁移和富文本渲染。
- `packages/ui`、`packages/config`：共享 UI 与配置目录。

[富文本与校对说明](docs/richtext-proofread.md)包含模型配置、数据兼容和验证边界；[DESIGN.md](DESIGN.md)记录界面约定。
