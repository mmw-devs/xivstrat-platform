import { el, errorMessage, type ElementLookup } from '../ui/dom'
import { getCosSettings, readImageLibrary, saveImageLibrary } from './asset-storage'
import { ensureCosSdk, hasCosUploadSettings } from './cos-client'
import { sanitizeName, makeThumbnail } from './image-utils'
import type { ImageLibraryEntry } from './types'
export function mountImageLibrary(byId: ElementLookup, signal: AbortSignal) {
  let libPendingFile: File | null = null
  function renderImageLibrary(): void {
    const list = byId<HTMLElement>('lib-list')
    const entries = readImageLibrary()
    list.innerHTML = ''
    if (!entries.length) {
      list.append(el('div', { class: 'hint' }, '（图库为空：选图后点「＋ 加入图库」，或手动填名称+路径加入）'))
      return
    }
    entries.forEach((entry) => {
      list.append(
        el(
          'div',
          { class: 'img-row' },
          entry.thumb
            ? el('img', {
              src: entry.thumb,
              class: 'asset-thumb',
            })
            : el('span', { class: 'asset-placeholder' }, '🖼'),
          el('span', { class: 'asset-name' }, entry.name),
          el('span', { class: 'hint asset-path' }, entry.path),
          el('button', { class: 'btn sm danger', onclick: () => removeImageLibraryEntry(entry.path) }, '删除'),
        ),
      )
    })
  }

  function removeImageLibraryEntry(path: string): void {
    saveImageLibrary(readImageLibrary().filter((entry) => entry.path !== path))
    renderImageLibrary()
  }

  function clearImageLibrary(): void {
    if (!confirm('确定清空整个图片图库吗？')) return
    localStorage.removeItem('xivstrat_img_lib')
    renderImageLibrary()
  }

  async function addImageLibraryEntry(): Promise<void> {
    const nameInput = byId<HTMLInputElement>('lib-name')
    const pathInput = byId<HTMLInputElement>('lib-path')
    const name = nameInput.value.trim()
    const path = pathInput.value.trim()
    if (!name && !path) {
      alert('请填写名称或路径')
      return
    }
    if (!path) {
      alert('请填写 COS 路径（或先选图自动生成）')
      return
    }
    const entries = readImageLibrary()
    if (entries.some((entry) => entry.path === path)) {
      alert('该路径已在图库中')
      return
    }
    const file = libPendingFile
    const finalName = name || (file ? file.name.replace(/\.[^.]+$/, '') : (path.split('/').pop() ?? path))
    const entry: ImageLibraryEntry = { name: finalName, path, thumb: file ? await makeThumbnail(file) : '' }
    entries.push(entry)
    saveImageLibrary(entries)
    renderImageLibrary()
    nameInput.value = ''
    pathInput.value = ''
    libPendingFile = null
    const status = byId<HTMLElement>('lib-status')
    if (status) status.textContent = '✓ 已加入图库'
  }

  function uploadSelectedLibraryImage(): void {
    const file = libPendingFile
    const path = byId<HTMLInputElement>('lib-path').value.trim()
    if (!file) {
      alert('请先点「🖼 选图」选择本地图片')
      return
    }
    if (!path) {
      alert('请先填写路径')
      return
    }
    const settings = getCosSettings()
    if (!hasCosUploadSettings(settings)) {
      alert('请先配置 COS 密钥（上方设置面板）')
      return
    }
    const status = byId<HTMLElement>('lib-status')
    void ensureCosSdk()
      .then((COS) => {
        const client = new COS({ SecretId: settings['cos-secret-id'], SecretKey: settings['cos-secret-key'] })
        client.putObject(
          {
            Bucket: settings['cos-bucket'],
            Region: settings['cos-region'],
            Key: path,
            Body: file,
            ContentLength: file.size,
            onProgress: (progress) => {
              status.textContent = `上传中 ${Math.round((progress.loaded / progress.total) * 100)}%`
            },
          },
          (error) => {
            if (error) {
              status.textContent = '✗ 失败'
              alert(`上传失败：${errorMessage(error)}`)
            } else status.textContent = `✓ 已上传：${path}`
          },
        )
      })
      .catch((error) => alert(errorMessage(error)))
  }

  function addXivIconToLibrary(name: string, icon: string): void {
    const entries = readImageLibrary()
    if (entries.some((entry) => entry.path === icon)) {
      alert('该图标已在图库中')
      return
    }
    entries.push({ name: `${name} 图标`, path: icon, thumb: '' })
    saveImageLibrary(entries)
    renderImageLibrary()
    alert(`已加入图库：${name}`)
  }
  byId<HTMLInputElement>('lib-file').addEventListener('change', (event) => {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement)) return
    const file = input.files?.[0]
    if (!file) return
    libPendingFile = file
    const base = sanitizeName(file.name.replace(/\.[^.]+$/, ''))
    const extension = (file.name.match(/\.[^.]+$/) ?? ['.png'])[0].toLowerCase()
    byId<HTMLInputElement>('lib-path').value = `07/entity_icons/${base}${extension}`
    byId<HTMLElement>('lib-status').textContent = `已选：${file.name}（可改路径后加入图库）`
  }, { signal })
  byId('btn-lib-add').addEventListener('click', () => { void addImageLibraryEntry() }, { signal })
  byId('btn-lib-upload').addEventListener('click', uploadSelectedLibraryImage, { signal })
  byId('btn-lib-clear').addEventListener('click', clearImageLibrary, { signal })
  renderImageLibrary()
  return { addIcon: addXivIconToLibrary }
}
