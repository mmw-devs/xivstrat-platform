import { el, errorMessage } from '../ui/dom'
import { convertImage, type ImageAssets } from './image-assets'

export function createImagePicker(assets: ImageAssets, initial: string, update: (path: string) => void) {
  let revision = 0, currentPath = initial
  let destroyed = false
  const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': '选择本地图片', hidden: true })
  const choose = el('button', { class: 'btn', type: 'button' }, '选择图片')
  const remove = el('button', { class: 'btn danger', type: 'button', hidden: true }, '移除图片')
  const selection = el('p', { class: 'hint image-selection', hidden: true })
  const status = el('p', { class: 'hint', role: 'status', hidden: true })
  const preview = el('img', { class: 'image-thumbnail', alt: '所选图片预览' })
  const link = el('a', { class: 'image-preview-link', target: '_blank', rel: 'noopener noreferrer', 'aria-label': '放大查看图片', hidden: true }, preview)
  const controls = el('div', { class: 'stack image-picker-controls' }, input, el('div', { class: 'actions' }, choose, remove), selection, status)
  const root = el('div', { class: 'image-picker stack' }, controls, link)
  function busy(value: boolean) { input.disabled = choose.disabled = value; root.setAttribute('aria-busy', String(value)) }
  const show = (path: string) => {
    revision++; currentPath = path; busy(false); input.value = ''
    status.hidden = true; status.textContent = ''; status.classList.remove('err')
    const blob = assets.get(path), name = assets.name(path)
    const url = assets.resolve(path) ?? (/^https?:\/\//i.test(path) ? path : undefined)
    choose.textContent = path ? '更换图片' : '选择图片'
    remove.hidden = selection.hidden = !path
    selection.textContent = !path ? '' : name ? `已选择：${name}` : blob ? '已从攻略包恢复图片' : /^https?:\/\//i.test(path) ? '已设置图片链接' : '已设置图片引用（当前页面无本地文件）'
    link.hidden = !url
    if (url) { preview.src = url; link.href = url }
    else { preview.removeAttribute('src'); link.removeAttribute('href') }
    if (blob) { status.hidden = false; status.textContent = `WebP · ${(blob.size / 1024).toFixed(1)} KiB · 当前页面素材，尚未上传` }
  }
  choose.addEventListener('click', () => input.click())
  remove.addEventListener('click', () => { show(''); update('') })
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return
    const current = ++revision
    busy(true); status.hidden = false; status.classList.remove('err'); status.textContent = `正在处理：${file.name}…`
    try {
      const blob = await convertImage(file)
      if (destroyed || current !== revision) return
      const path = await assets.add(blob, file.name)
      if (destroyed || current !== revision) return
      show(path); update(path)
    } catch (error) {
      if (!destroyed && current === revision) {
        const message = error instanceof DOMException ? '无法读取或转换该图片，请尝试其他图片或浏览器' : errorMessage(error)
        status.classList.add('err')
        status.textContent = `${currentPath ? '更换失败，仍保留原图片' : '图片处理失败'}：${message}`
      }
    } finally { if (!destroyed && current === revision) { busy(false); input.value = '' } }
  })
  show(initial)
  return { root, controls, show, destroy() { destroyed = true; revision++ } }
}
