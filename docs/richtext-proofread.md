# 正文编辑与全文校对

## 编辑流程

1. 基本信息。
2. 参考与宏。
3. 阶段与机制：编辑正文及格式。
4. 全文校对：只读全文，显示建议，可定位、逐条接受或忽略。
5. 预览、校验与导出。

正文工具栏提供撤销、重做、加粗、斜体、下划线、删除线、超链接、颜色、清除格式。Enter 另起一段 · Shift + Enter 同段换行。历史记录属于各正文块；回到第三步可撤销该块的校对修改。重新导入会重新创建编辑器并清空其历史记录。

官方 UI 来源与 MIT 许可证见 `apps/editor/src/vendor/tiptap-ui/UPSTREAM.md`。使用官方 MarkButton、UndoRedoButton、LinkPopover 和工具栏基础组件；文字颜色和清除格式基于官方基础组件组合，未引入整套 Simple Editor 模板的额外功能。

## 数据契约

- 新导出为 `schemaVersion: 2`。正文块使用稳定 `id` 和受限 Tiptap JSON `doc`，不同时维护另一份纯文本。
- 导入旧的 `value: string[]` 自动迁移；空段落、空格和换行保留。下载旧版纯文本 JSON 会提示格式丢失。
- 只允许普通段落、文本、段内换行和工具栏支持的格式。保留旧数据中 16/20/24px 字号，但工具栏不提供字号选择。颜色限制为五种预设。
- 链接允许 http、https、mailto；拒绝脚本协议和带用户名密码的地址。渲染统一转义 HTML/Astro 特殊字符。
- 预览、只读校对全文和网站文件生成复用同一渲染函数。校验由 TypeScript 与运行时解析实现，不是独立的标准 JSON Schema 文件。

## 配置 AI 校对

在仓库根目录 `.env` 设置服务端变量（不要提交密钥）：

```dotenv
PROOFREAD_ENDPOINT=https://your-provider.example/v1/chat/completions
PROOFREAD_MODEL=your-model
PROOFREAD_API_KEY=your-key
```

`PROOFREAD_ENDPOINT` 是完整的 Chat Completions 兼容地址。模型必须能按指令返回纯 JSON，非流式响应需包含 `choices[0].finish_reason = "stop"`。密钥只在服务端读取。

另一个终端运行：

```powershell
pnpm.cmd --dir apps/editor proofread:dev
```

服务绑定 `127.0.0.1:4322`，Astro 开发代理把 `/api/proofread` 转发给它。可通过 `PROOFREAD_PORT` 调整端口（同时调整代理），通过 `PROOFREAD_ALLOWED_ORIGINS` 配置逗号分隔的来源白名单。默认允许 localhost/127.0.0.1 的 4321 端口。

当前 Astro 构建仍为静态站点。生产环境需要独立运行校对服务，并通过同源反向代理提供 `/api/proofread`；公开部署还需在代理层做身份验证、用户级限流和预算控制。本次没有部署生产接口或选择真实模型。

校对只发送递归正文、层级标题上下文和术语偏好，不发送图片、宏、参考链接或编辑器密钥。单轮最多 60000 字符，超限明确拒绝，不截断全文；服务超时 60 秒，限制请求并发和响应大小。不记录正文与密钥。

建议依赖原文及相邻上下文唯一定位，歧义项只能人工判断。接受后更新同段后续偏移；重叠、上下文变化、手动改文、结构变化或撤销会使相关建议过期。修改跨越不同格式时拒绝自动替换。模型结果仅用于语言建议，不证明游戏机制正确。

## 验证

```powershell
pnpm.cmd --dir apps/editor richtext:test
pnpm.cmd --dir apps/editor github:submission:test
node apps/editor/node_modules/typescript/bin/tsc --noEmit -p packages/content-schema/tsconfig.json
pnpm.cmd build:editor
```

2026-09-10：富文本/校对 15 项测试通过，覆盖旧数据迁移、JSON 往返、所有格式、链接限制、定位歧义、建议偏移、格式保留、独立撤销/重做、emoji、模型异常和响应大小限制。开发代理到本地固定测试模型的 HTTP 请求返回两条可定位建议。

浏览器已检查官方九项工具栏、组合格式、颜色和链接弹窗，以及只读校对全文和换行提示。

2026-09-10 后续浏览器验收：在 127.0.0.1:4321 使用本地固定结果服务完成两条建议的逐条流程：先后定位原文高亮，接受第一条后再定位并接受第二条，最终正文为“奶妈 提前远离队伍。”，证明后续建议偏移仍可正确应用。另以 390×844 手机视口检查全文校对的单列布局、建议卡片和底部上一步/下一步按钮；页面无横向溢出，且“下一步：预览与导出”可进入第⑤步。固定结果服务仅用于链路验收；事务测试不能替代这些浏览器验收，且尚未验证真实模型质量。

`apps/editor/scripts/proofread-fixture.ts` 是独立的固定结果测试服务（4323），只用于复现链路，不会被生产代码或默认启动命令导入。不要将它配置为实际校对模型。

构建会提示 React 官方组件的 `use client` 指令在此客户端构建中被忽略，以及主脚本超过 500 kB；构建可完成，后续可针对加载体积优化。保留原有复制功能的 execCommand 弃用提示。
