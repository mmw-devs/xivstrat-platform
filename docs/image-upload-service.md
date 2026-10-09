# 受控图片中转服务

目的：接收一份完整、不可变的图文投稿快照，短暂保存到磁盘，再由显式启动的后台任务将 JSON 和图片写入同一个 GitHub commit / PR。不提供图片公开访问，不保存长期用户图库。默认仅启用接收，远程投稿需另行开启。

## 本地启动

要求 Node 24，沿用项目 pnpm 工作区：

```powershell
pnpm.cmd --dir apps/editor upload:dev
pnpm.cmd --dir apps/editor upload:test
```

服务仅监听 `127.0.0.1:4324`，Astro 开发环境代理 `/api/upload-tasks`。本地适配器只允许回环连接，拒绝非白名单 Origin 和跨站浏览器请求，固定身份为 `local-developer`。仅接收不需要 GitHub 凭证。服务会加载仓库根目录 `.env`；只有 `ENABLE_IMAGE_SUBMISSION=1` 时启用后端投稿入口，使用现有 GitHub App 配置。这一开关不自动启动任何投稿。

这不是生产鉴权。通用处理器要求注入 `authenticate(request)`，由可信服务端产生身份；请求体和客户端 owner 字段不能指定身份。当前不能将该本地适配器直接公开部署。飞书身份接入不在本阶段任务范围。

## 上传协议

`PUT /api/upload-tasks/<小写 UUID v4>`

- 请求头 `X-Submission-Digest`：`SHA-256(structureToJson(normalizeStructure(strategy)))`，以 UTF-8 编码计算，64 位小写十六进制。JSON 内包含图片的内容哈希路径，因此摘要绑定完整内容。上传阶段不重新生成操作时间，后续真正投稿时由服务端固定一次操作时间。
- `Content-Type: multipart/form-data; boundary=...`，建议由 FormData 自动生成。
- 文本字段 `strategy`：完整 JSON，只允许出现一次。
- 文件字段 `images`：重复字段，每个文件名是 `<SHA-256>.webp`，对应 JSON 中 `assets/images/<SHA-256>.webp`。
- 所有非外链引用必须带对应图片，包括封面和递归子机制。首次实现不从 GitHub 下载或查询既有图片，不代抓外链，不接收无引用素材。旧相对路径须先重新选图转换。

响应示例：

```json
{
  "ok": true,
  "task": {
    "id": "00000000-0000-4000-8000-000000000001",
    "state": "ready",
    "bytes": 1024,
    "updatedAt": "2026-10-09T00:00:00.000Z",
    "remoteSubmission": "not-started"
  }
}
```

首次接收返回 201；同一身份、编号和摘要已 ready 则返回 200，复用原快照，不延长保存期限，也不接收新正文。重传时同一编号换摘要返回 409。客户端改动内容后必须换任务编号。

`GET /api/upload-tasks/<id>` 查询本人任务状态。未知编号或其他身份的任务返回 404，不暴露任务归属、磁盘路径或文件清单。

## 容量和清理

| 项目 | 默认值 |
| --- | --- |
| 原始请求字节 | 21 MiB，逐块统计，不依赖 Content-Length |
| JSON 字段／规范化 JSON | 各最多 1 MiB |
| 图片 | 静态 WebP，单张 3 MiB，2500 万像素，最多 30 张引用 |
| JSON 与图片的上传内容总量 | 20 MiB |
| 接收前预留 | 每任务 22 MiB，包含规范化余量 |
| 全局素材临时额度 | 256 MiB；ready 素材也计入 |
| 并发 | 全局 2 个，每个身份 1 个 |
| 接收与验证期限 | 120 秒 |
| ready 素材保存 | 1 小时，定时及请求时清理 |
| 记录容量 | 最多 10000 条；已无素材的记录 7 天后删除 |

在解析 multipart 之前预留额度；未完成的上传同样计入。文件以流方式写入磁盘，JSON 字段有界保留在内存；图片校验逐张读取最多 3 MiB。文件删除成功后才释放空间账目；磁盘删除失败会保留额度并记录错误，防止继续扩大占用。

超大流式请求可能在收到 413 前断开连接。上传响应丢失或连接中断时，应查询同一任务，而不是假定成功或立即换编号。该接口尚不产生远程副作用。

## 持久性和恢复

数据位于仓库根目录 `.local-data/image-submissions/`，已加入 Git 忽略：

```text
uploads.sqlite
upload-tmp/<任务编号>/strategy.json
upload-tmp/<任务编号>/<图片哈希>.webp
```

SQLite 保存任务摘要、身份、状态、空间账目和文件清单。使用独占连接锁，同一数据目录只能运行一个服务实例；进程退出后 SQLite 释放锁，第二实例不得同时回收第一实例的上传文件。

- `receiving`：正在接收／验证，由接收期限控制，不被定时清理删除。
- `ready`：完整校验已通过，素材等待后续处理，尚未创建 GitHub PR。
- `reupload-required`：失败、中断、到期或文件缺失，需要客户端重新发送相同快照。

启动时清理中断上传和无任务的临时目录；有效 ready 文件保留，缺文件则降为需重传。进程重启不从中间字节续传。客户端仍需保留攻略包，服务不是备份系统。逻辑额度只覆盖服务管理的素材，SQLite 元数据和系统其他文件另占空间；尚未验证机器断电下的持久性。

## 验证范围

本地测试使用真实 HTTP multipart、临时 SQLite 和 sharp，覆盖正常上传、重复请求、归属隔离、全局／单身份并发、容量、文件缺失、非法路径、哈希不符、实际内容超限、无 Content-Length 超限、客户端断开、接收超时、重启恢复及独占锁。测试不调用 GitHub。

后端多文件 GitHub 工作流已实现并经过模拟测试，尚未进行真实远程图片投稿。下一阶段接前端上传、启动与进度查询，再进行受控端到端验证。

## 图文 GitHub 投稿与恢复

`POST /api/upload-tasks/<id>/submit`：需要显式开启 `ENABLE_IMAGE_SUBMISSION=1`，未开启返回 503。开启后，这个接口可能真实创建 GitHub 分支、提交和 PR。它不接受新 JSON，只处理已接收的固定任务；检查任务归属后返回 202，后台执行。全局同时处理一个投稿，重复启动同一任务复用正在运行的工作，其他任务返回 429。

继续使用 `GET /api/upload-tasks/<id>` 查询；GET 不触发任何 GitHub 操作。`remoteSubmission` 可以是：

| 状态 | 含义 |
| --- | --- |
| not-started | 尚未启动 |
| running | 后台正在执行 |
| retryable | 尚未进入不确定的分支／PR 写入，可再次显式启动；若 code=REUPLOAD_REQUIRED，先上传原快照 |
| unknown | 进程中断或可变远程写入结果未知；再次启动先查证，查不到也不重复创建 |
| needs-attention | 目标仓库、分支、内容或 PR 与记录不一致，需要维护者处理 |
| submitted | 已确认对应 PR 及远程文件；result 包含 prNumber、prUrl 和 commitSha，不代表已合并或已发布 |

首次运行把投稿时间、目标仓库、基准 commit/tree、文件清单持久保存到 SQLite `submissions` 表。原始上传 JSON 不变，上传到 GitHub 的 JSON 使用固定的服务端操作时间。后续运行不切换到更新的 main 或新配置的仓库。

流程为 blobs → 基于 base_tree 的完整 tree → 单个 commit → 投稿分支 → PR。先查询 commit 并核对父节点、tree 和全部文件 SHA，再暴露分支。每个远程步骤结束后立即保存检查点。Blob/tree/commit 是不可变对象；恢复时只补未确认的对象，commit 的作者、提交者、时间和父节点固定。

创建分支或 PR 前先保存“已尝试”标记。超时后重新启动会查精确分支和所有状态的 PR（含已关闭的 PR，分页查询）。查到且内容一致才继续；查不到保持 unknown，不自动再次 POST。分支被他人修改、多个候选 PR 或 PR 内容不符会停止，不 force push、不删除远程对象。PR 已关闭且分支已删除时仍可识别原 PR，不新建。

确认完成后先持久保存结果，再清理临时文件。清理失败保留空间账目并标记 LOCAL_CLEANUP_PENDING，定时任务会继续尝试。运行中的任务有内存保护，不会被一小时清理任务删除；进程重启将遗留 running 标记为 unknown，不自动执行远程操作。等待查证的素材仍可到期清理，但投稿检查点保留；若 commit 已确认可直接查远端，无需重新上传。

有投稿检查点的记录不适用七天自动删除，仍受 10000 条任务总上限约束；达到上限需由维护者处理，不能自动遗忘旧投稿编号后再次创建 PR。该阶段尚未提供管理界面或“强制重试未知写入”的接口。

模拟验证：`pnpm.cmd --dir apps/editor images:submission:test`，覆盖每个写入步骤的响应丢失、重启、原快照/时间保持、关闭 PR 与删除分支、内容冲突、归属隔离及 POST/GET 接口；测试不访问 GitHub。
