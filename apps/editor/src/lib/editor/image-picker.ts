import { el, errorMessage } from '../ui/dom'
import { convertImage, type ImageAssets } from './image-assets'

export function createImagePicker(assets: ImageAssets, initial: string, update: (path: string) => void) {
  let revision = 0
  let destroyed = false
  const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': '选择本地图片' })
  const status = el('p', { class: 'hint', role: 'status' }, '图片仅留在当前页面，关闭前请下载攻略包；尚不支持图片投稿。转换使用高质量有损 WebP，请放大检查文字。')
  const preview = el('img', { alt: '所选图片预览', style: 'max-width:100%;max-height:320px;object-fit:contain', hidden: true })
  const link = el('a', { target: '_blank', rel: 'noopener noreferrer', 'aria-label': '放大查看图片' }, preview)
  const show = (path: string) => {
    const url = assets.resolve(path) ?? (/^https?:\/\//i.test(path) ? path : undefined)
    preview.hidden = !url
    if (url) { preview.src = url; link.href = url }
    else { preview.removeAttribute('src'); link.removeAttribute('href') }
  }
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return
    const current = ++revision
    input.disabled = true; status.textContent = '正在转换图片…'
    try {
      const blob = await convertImage(file)
      if (destroyed || current !== revision) return
      const path = await assets.add(blob)
      if (destroyed || current !== revision) return
      update(path); show(path)
      status.textContent = `${(file.size / 1024).toFixed(1)} KiB → ${(blob.size / 1024).toFixed(1)} KiB。仅在当前页面，尚未上传；关闭前请下载攻略包。`
    } catch (error) { if (!destroyed && current === revision) status.textContent = errorMessage(error) }
    finally { if (!destroyed) { input.disabled = false; input.value = '' } }
  })
  show(initial)
  return { root: el('div', { class: 'stack' }, input, status, link), show, destroy() { destroyed = true; revision++ } }
}
