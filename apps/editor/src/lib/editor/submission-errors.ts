const descriptions: Record<string, string> = {
  GITHUB_NETWORK_ERROR: '网络连接异常：连接 GitHub 时中断，或 TLS / DNS 连接失败',
  GITHUB_TIMEOUT: '网络超时：等待 GitHub 响应超时',
  GITHUB_RATE_LIMIT: '请求限流：GitHub 请求额度或频率达到限制',
  GITHUB_AUTH_ERROR: '认证失败：GitHub 身份凭据无效或已过期',
  GITHUB_PERMISSION_ERROR: '访问被拒绝：请检查 GitHub 权限或访问限制',
  GITHUB_RESOURCE_UNAVAILABLE: '资源不可访问：仓库、分支或文件不存在，或当前身份无权访问',
  GITHUB_REQUEST_REJECTED: '请求被拒绝：GitHub 未接受本次提交参数',
  GITHUB_SERVICE_ERROR: '远端服务异常：GitHub 请求返回服务端错误',
  GITHUB_REQUEST_FAILED: '未分类异常：提交失败，当前记录没有更具体的原因',
  GITHUB_CONFIG_ERROR: '服务配置错误：请联系维护者检查 GitHub 配置',
  GITHUB_APP_AUTH_ERROR: 'App 认证失败：请检查 GitHub App 配置与连接',
  GITHUB_INSTALLATION_ERROR: 'App 安装异常：请检查安装身份',
  GITHUB_INSTALLATION_AUTH_ERROR: '安装认证失败：无法取得安装身份或可访问仓库',
  GITHUB_REPOSITORY_ACCESS_ERROR: '仓库访问异常：无法确认目标仓库或基准分支',
  REUPLOAD_REQUIRED: '素材已过期：请恢复原攻略包后继续原任务',
  PROCESS_INTERRUPTED: '服务中断：需要核查原任务的远端结果',
  BRANCH_OUTCOME_UNKNOWN: '分支创建结果未知：需要核查原任务',
  PR_OUTCOME_UNKNOWN: 'PR 创建结果未知：需要核查原任务',
  LOCAL_CLEANUP_PENDING: '清理异常：投稿成功，临时素材待清理',
  NETWORK_ERROR: '网络连接异常：浏览器未能取得提交结果',
  INVALID_SUBMISSION: '内容校验失败',
  UPLOAD_TIMEOUT: '上传超时：接收或校验素材超时',
  UPLOAD_FAILED: '素材接收失败：请查询原任务后再恢复',
  UPLOAD_NOT_READY: '素材未就绪：请先完整上传图片',
  UPLOAD_IN_PROGRESS: '上传进行中：请等待当前上传结束',
  NOT_FOUND: '任务不存在或已过期',
  UNAUTHORIZED: '身份验证失败：当前请求未授权',
  SUBMISSION_DISABLED: '功能未启用：图片投稿服务未开放',
  SUBMISSION_API_DISABLED: '功能未启用：当前环境未开放投稿',
  SUBMISSION_UNAVAILABLE: '服务不可用：请联系维护者检查配置与连接',
  SUBMISSION_FAILED: '提交失败：当前记录没有更具体的原因',
  SUBMISSION_OUTCOME_UNKNOWN: '提交结果未知：请先核实远端结果',
  PR_LOOKUP_LIMIT: '查询达到保护上限：请联系维护者核查 PR',
}
for (const code of ['INVALID_TASK_ID', 'INVALID_IDENTITY', 'MISSING_DIGEST', 'METHOD_NOT_ALLOWED', 'UNSUPPORTED_MEDIA_TYPE']) descriptions[code] = '请求格式错误：任务身份、参数或请求方式不符合要求'
for (const code of ['JSON_PARSE_ERROR', 'NORMALIZATION_ERROR', 'INVALID_STRATEGY_NAME', 'UNSAFE_TARGET_PATH']) descriptions[code] = '内容校验失败：攻略格式、名称或目标路径不符合要求'
for (const code of ['BRANCH_CREATE_ERROR', 'FILE_READ_ERROR', 'FILE_CREATE_ERROR', 'FILE_UPDATE_ERROR', 'PR_CREATE_ERROR']) descriptions[code] = 'GitHub 操作失败：请结合失败阶段核查原任务'
for (const code of ['TARGET_CHANGED', 'SNAPSHOT_CHANGED', 'DIGEST_MISMATCH', 'IMAGE_CHANGED', 'BLOB_MISMATCH', 'COMMIT_MISMATCH', 'REMOTE_CONTENT_MISMATCH', 'BRANCH_CHANGED', 'PR_CHANGED', 'MULTIPLE_PRS']) descriptions[code] = '一致性检查失败：任务内容或远端状态与预期不一致，请联系维护者'
for (const code of ['INVALID_SNAPSHOT', 'INVALID_MANIFEST', 'INVALID_PACKAGE', 'INVALID_MULTIPART']) descriptions[code] = '内容校验失败：攻略或图片素材不符合要求'
for (const code of ['UPLOAD_TOO_LARGE', 'IMAGE_TOO_LARGE']) descriptions[code] = '大小超限：图片或攻略超过上传限制'
for (const code of ['UPLOAD_BUSY', 'SUBMISSION_BUSY', 'TASK_CAPACITY', 'SPOOL_FULL']) descriptions[code] = '服务容量不足或繁忙：请稍后继续原任务'
export const failureStages: Record<string, string> = {
  initialize: '连接 GitHub 并检查身份与仓库', snapshot: '读取并校验素材', base: '读取基准提交',
  blobs: '上传文件到 GitHub', tree: '创建文件树', commit: '创建提交', verify: '核对远端内容',
  branch: '核查或创建分支', pr: '核查或创建 PR',
  'D1.1': '验证 App 身份', 'D1.2': '验证安装身份', 'D1.3': '获取安装可访问仓库', 'D1.4': '验证目标仓库',
  'D2.branch-create': '创建分支', 'D2.file-read': '读取攻略文件', 'D2.file-create': '创建攻略文件',
  'D2.file-update': '更新攻略文件', 'D2.pr-create': '创建 PR',
}
export function submissionErrorText(code: string, stage?: string): string {
  return `错误类型：${descriptions[code] ?? '提交异常，请根据错误码联系维护者'}（${code}）${stage && failureStages[stage] ? `；失败阶段：${failureStages[stage]}` : ''}`
}
