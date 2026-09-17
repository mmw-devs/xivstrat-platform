import type { CosSettings } from './types'
interface CosProgress {
  loaded: number
  total: number
}

interface CosPutObjectOptions {
  Bucket: string
  Region: string
  Key: string
  Body: File
  ContentLength: number
  onProgress?: (progress: CosProgress) => void
}

interface CosClient {
  getService(options: Record<string, never>, callback: (error?: unknown) => void): void
  putObject(options: CosPutObjectOptions, callback: (error?: unknown) => void): void
}

interface CosConstructor {
  new(options: { SecretId: string; SecretKey: string }): CosClient
}

export function ensureCosSdk(): Promise<CosConstructor> {
  const existing = (window as Window & { COS?: CosConstructor }).COS
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/cos-js-sdk-v5/dist/cos-js-sdk-v5.min.js'
    script.onload = () => { const loaded = (window as Window & { COS?: CosConstructor }).COS; if (loaded) resolve(loaded); else reject(new Error('COS SDK 未正确加载')) }
    script.onerror = () => reject(new Error('无法加载 COS SDK（需要联网），请改用腾讯云 COS 控制台手动上传'))
    document.head.append(script)
  })
}

export function hasCosUploadSettings(settings: CosSettings): boolean {
  return Boolean(
    settings['cos-secret-id'] && settings['cos-secret-key'] && settings['cos-bucket'] && settings['cos-region'],
  )
}