import { normalizeStructure, structureToJson, validateStructure, type StrategyStructure } from '@xivstrat/content-schema'
import { el } from '../ui/dom'
import type { ImageAssets } from './image-assets'
import { imageReferences } from './image-references'

const KEY = 'xivstrat:image-submission:v1'
type Receipt = { id: string; digest: string; complete: boolean; operationTime: string }
type Task = { id: string; state: string; remoteSubmission: string; code?: string; result?: { prNumber: number; prUrl: string } }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

/** Keep only the receipt across reloads. Image bytes remain in memory / the author's ZIP. */
export function mountImageSubmission(host: HTMLElement, assets: ImageAssets, getStructure: () => StrategyStructure,
  signal: AbortSignal, setBusy: (busy: boolean) => void) {
  const message = el('p', { role: 'status' })
  const identity = el('p', { class: 'submission-id' })
  const query = el('button', { type: 'button', class: 'btn sm' }, '查询图片任务')
  const resume = el('button', { type: 'button', class: 'btn sm' }, '继续图片任务')
  const root = el('div', { class: 'submission-result', id: 'image-submission-status' })
  root.append(message, identity, query, resume)
  host.insertAdjacentElement('afterend', root)
  let receipt: Receipt | undefined
  let busy = false
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
    if (saved && uuid.test(saved.id) && /^[a-f0-9]{64}$/.test(saved.digest) && typeof saved.complete === 'boolean' && typeof saved.operationTime === 'string') receipt = saved
  } catch { /* Storage is checked again before any write request. */ }

  function render(text: string) {
    message.textContent = text
    identity.textContent = receipt ? `图片任务：${receipt.id}` : ''
    query.hidden = resume.hidden = !receipt
    query.disabled = resume.disabled = busy
    resume.hidden ||= receipt?.complete === true
  }
  function save(next: Receipt) {
    // Fail closed: don't start an untraceable remote operation when storage is unavailable.
    try { sessionStorage.setItem(KEY, JSON.stringify(next)) }
    catch { throw new Error('浏览器无法保存任务编号，请允许会话存储后再提交；请先下载攻略包备份。') }
    receipt = next
  }
  const endpoint = () => `/api/upload-tasks/${receipt!.id}`
  async function request(method: string, body?: FormData, start = false): Promise<Task | null> {
    const response = await fetch(endpoint() + (start ? '/submit' : ''), {
      method, signal: AbortSignal.any([signal, AbortSignal.timeout(method === 'PUT' ? 130_000 : 35_000)]),
      ...(body ? { body, headers: { 'X-Submission-Digest': receipt!.digest } } : {}),
    })
    const value = await response.json()
    if (method === 'GET' && response.status === 404 && value?.error?.code === 'NOT_FOUND') return null
    if (!response.ok || value?.ok !== true) throw new Error(typeof value?.error?.message === 'string' ? value.error.message : '任务接口暂不可用')
    const task = value.task as Task
    if (!task || task.id !== receipt!.id || !['receiving', 'ready', 'reupload-required', 'submitted'].includes(task.state)
      || !['not-started', 'running', 'retryable', 'unknown', 'needs-attention', 'submitted'].includes(task.remoteSubmission)) throw new Error('任务响应无效，请查询原任务或联系维护者')
    return task
  }
  function show(task: Task | null) {
    if (!task) { render('任务不存在或已过期。继续时需当前页面保留原快照及图片，可先导入原攻略包。'); return }
    if (task.remoteSubmission === 'submitted') {
      const result = task.result
      if (!result || !Number.isSafeInteger(result.prNumber) || result.prNumber < 1
        || !/^https:\/\/github\.com\/[^/?#]+\/[^/?#]+\/pull\/\d+$/.test(result.prUrl)) throw new Error('任务结果无效，请联系维护者核实')
      save({ ...receipt!, complete: true })
      render(`提交成功，已创建 PR #${result.prNumber}。提交的是点击时的快照，之后的编辑未包含在内；PR 不代表已发布。`)
      message.append(' ', el('a', { href: result.prUrl, target: '_blank', rel: 'noopener noreferrer' }, '查看 PR'))
      return
    }
    const messages: Record<string, string> = {
      running: '后台正在提交 GitHub；关闭页面不会取消任务，可稍后查询。',
      unknown: '远端结果尚未确认。点击继续仅恢复原任务的核查，请勿换任务重复提交。',
      'needs-attention': '任务需要维护者处理，请提供下方任务编号。',
      retryable: '任务暂停，可点击继续恢复原任务。',
      'not-started': task.state === 'ready' ? '图片已暂存，可点击继续提交 GitHub。' : '素材未就绪，可保留原快照及图片后点击继续。',
    }
    render(task.state === 'receiving' ? '正在接收和校验图片…' : messages[task.remoteSubmission])
    if (task.code) message.append(`（${task.code}）`)
    resume.hidden = task.remoteSubmission === 'needs-attention'
  }
  async function poll(task: Task | null) {
    for (let count = 0; count < 60; count++) {
      show(task)
      if (!task || (task.remoteSubmission !== 'running' && task.state !== 'receiving')) return
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
        const timer = setTimeout(done, 1000)
        signal.addEventListener('abort', done, { once: true })
      })
      if (signal.aborted) return
      task = await request('GET')
    }
    show(task)
  }
  function snapshot(recover = false) {
    const structure = normalizeStructure(getStructure())
    // ZIP/JSON exports stamp their own operation time; that alone must not prevent recovery.
    if (recover) structure.metadata.publish_time = receipt!.operationTime
    const errors = validateStructure(structure)
    if (errors.length) throw new Error(errors.join('；'))
    const json = structureToJson(structure)
    let total = new TextEncoder().encode(json).length
    if (total > 1024 * 1024) throw new Error('JSON 超过 1 MiB')
    const refs = imageReferences(structure)
    if (refs.length > 30) throw new Error('每篇最多 30 张图片')
    const files: [string, Blob][] = []
    for (const path of refs) {
      if (/^https?:\/\//i.test(path)) continue
      const blob = assets.get(path)
      if (!/^assets\/images\/[a-f0-9]{64}\.webp$/.test(path) || !blob) throw new Error(`缺少本地图片：${path}，请补选或导入原攻略包。`)
      if (blob.size > 3 * 1024 * 1024) throw new Error('单张图片超过 3 MiB')
      total += blob.size
      files.push([path.split('/').at(-1)!, blob])
    }
    if (total > 20 * 1024 * 1024) throw new Error('攻略内容超过 20 MiB')
    return { json, files, operationTime: structure.metadata.publish_time }
  }
  async function upload(snapshot: { json: string; files: [string, Blob][] }) {
    render('正在上传并校验图片，请保留攻略包备份…')
    const body = new FormData()
    body.append('strategy', snapshot.json)
    snapshot.files.forEach(([name, blob]) => body.append('images', blob, name))
    return request('PUT', body)
  }
  async function digest(json: string) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  }
  async function run(action: () => Promise<void>) {
    if (busy || signal.aborted) return
    busy = true; setBusy(true); query.disabled = resume.disabled = true
    try { await action() }
    catch (error) {
      if (!signal.aborted) render(`${error instanceof Error ? error.message : '网络连接失败'}。请先查询原任务；不会自动重复提交。`)
    } finally {
      busy = false
      if (!signal.aborted) { setBusy(false); query.disabled = resume.disabled = false }
    }
  }
  async function advance(task: Task | null) {
    if (!task) { show(task); return }
    if (task.remoteSubmission === 'submitted' || task.remoteSubmission === 'needs-attention') { show(task); return }
    if (task.state !== 'receiving' && task.remoteSubmission !== 'running') task = await request('POST', undefined, true)
    await poll(task)
  }
  query.addEventListener('click', () => { void run(async () => { await poll(await request('GET')) }) }, { signal })
  resume.addEventListener('click', () => { void run(async () => {
    let task = await request('GET')
    if (!task && receipt!.complete) throw new Error('已完成任务的记录不可用，请联系维护者核实原 PR')
    if (!task || (task.state === 'reupload-required' && (task.remoteSubmission === 'not-started' || task.code === 'REUPLOAD_REQUIRED'))) {
      const frozen = snapshot(true)
      if (await digest(frozen.json) !== receipt!.digest) throw new Error('当前内容与原任务不一致，请恢复原快照；不要覆盖未确认的投稿')
      task = await upload(frozen)
    }
    await advance(task)
  }) }, { signal })
  render(receipt ? '发现之前的图片任务，可查询结果或继续原任务。图片本身没有保存在会话存储中。' : '图片随本次快照提交；请先下载攻略包备份。')
  signal.addEventListener('abort', () => root.remove(), { once: true })
  return {
    isBusy: () => busy,
    hasPending: () => !!receipt && !receipt.complete,
    submit: () => run(async () => {
      const frozen = snapshot() // Capture all bytes and JSON before the first await.
      const hash = await digest(frozen.json)
      if (receipt && receipt.digest !== hash && !receipt.complete) throw new Error('上一图片任务尚未结束，请先查询或继续该任务')
      if (!receipt || receipt.digest !== hash) save({ id: crypto.randomUUID(), digest: hash, complete: false, operationTime: frozen.operationTime })
      render('正在查询任务…')
      let task = await request('GET')
      // Never recreate a previously confirmed remote submission if its receipt disappears.
      if (!task && receipt!.complete) throw new Error('已完成任务的记录不可用，请联系维护者核实原 PR')
      if (!task || (task.state === 'reupload-required' && (task.remoteSubmission === 'not-started' || task.code === 'REUPLOAD_REQUIRED'))) task = await upload(frozen)
      await advance(task)
    }),
  }
}
