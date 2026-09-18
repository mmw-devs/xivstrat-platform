import { errorMessage, type ElementLookup } from '../ui/dom'
import { COS_SETTING_KEYS, getCosSettings } from './asset-storage'
import { ensureCosSdk, hasCosUploadSettings } from './cos-client'
import { sanitizeName } from './image-utils'
import type { CosSettings } from './types'
const HOME_IMAGES = { banner: 'banners/07/' } as const
type HomeImageKey = keyof typeof HOME_IMAGES
export function mountBannerUpload(byId: ElementLookup, signal: AbortSignal): void {
  function loadCosSettings(): void {
    const settings = getCosSettings()
    COS_SETTING_KEYS.forEach((key) => {
      byId<HTMLInputElement>(key).value = settings[key]
    })
  }

  function saveCosSettings(): void {
    const settings = {} as CosSettings
    COS_SETTING_KEYS.forEach((key) => {
      settings[key] = byId<HTMLInputElement>(key).value.trim()
    })
    localStorage.setItem('xivstrat_cos_settings', JSON.stringify(settings))
    byId<HTMLElement>('cos-status').textContent = '✓ 已保存'
  }

  async function testCos(): Promise<void> {
    const settings = getCosSettings()
    const status = byId<HTMLElement>('cos-status')
    if (!settings['cos-secret-id'] || !settings['cos-secret-key']) {
      status.textContent = '请先填写 SecretId / SecretKey'
      return
    }
    try {
      const COS = await ensureCosSdk()
      const client = new COS({ SecretId: settings['cos-secret-id'], SecretKey: settings['cos-secret-key'] })
      client.getService({}, (error) => {
        status.textContent = error ? `连接失败：${errorMessage(error)}` : '✓ 连接成功'
      })
    } catch (error) {
      status.textContent = errorMessage(error)
    }
  }

  function initHomeImageRows(): void {
    ; (Object.keys(HOME_IMAGES) as HomeImageKey[]).forEach((key) => {
      const fileInput = byId<HTMLInputElement>(`f-${key}`)
      const pathInput = byId<HTMLInputElement>(`inp-${key}`)
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0]
        if (!file) return
        const dutyId = byId<HTMLInputElement>('inp-id').value.trim() || 'duty'
        const base = sanitizeName(file.name.replace(/\.[^.]+$/, ''))
        const extension = (file.name.match(/\.[^.]+$/) ?? ['.png'])[0].toLowerCase()
        pathInput.value = `${HOME_IMAGES[key]}${dutyId}/${base}${extension}`
        pathInput.dispatchEvent(new Event('input', { bubbles: true }))
        byId<HTMLElement>(`st-${key}`).textContent = '待上传'
      }, { signal })
    })
  }

  function uploadHomeImage(key: HomeImageKey): void {
    const file = byId<HTMLInputElement>(`f-${key}`).files?.[0]
    const path = byId<HTMLInputElement>(`inp-${key}`).value.trim()
    if (!file) {
      alert('请先点击「🖼 选图」选择图片文件')
      return
    }
    if (!path) {
      alert('请先填写图片路径')
      return
    }
    const settings = getCosSettings()
    if (!hasCosUploadSettings(settings)) {
      alert('请先在「☁️ 图片直传 COS 设置」里填写并保存密钥')
      return
    }
    const status = byId<HTMLElement>(`st-${key}`)
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
            } else status.textContent = '✓ 已上传'
          },
        )
      })
      .catch((error) => alert(errorMessage(error)))
  }
  byId('btn-upload-banner').addEventListener('click', () => uploadHomeImage('banner'), { signal })
  byId('btn-save-cos').addEventListener('click', saveCosSettings, { signal })
  byId('btn-test-cos').addEventListener('click', () => { void testCos() }, { signal })
  loadCosSettings()
  initHomeImageRows()
}
