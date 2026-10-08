/** Session-only assets. References are portable; object URLs never enter JSON. */
export function createImageAssets() {
  const files = new Map<string, { blob: Blob; url: string }>()
  let generation = 0
  const store = {
    async add(blob: Blob): Promise<string> {
      const started = generation
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
        .map(byte => byte.toString(16).padStart(2, '0')).join('')
      const path = `assets/images/${hash}.webp`
      if (generation !== started) throw new Error('图片处理已取消')
      const used = [...files.values()].reduce((sum, file) => sum + file.blob.size, 0)
      if (!files.has(path) && used + blob.size > 60 * 1024 * 1024) throw new Error('当前页面素材超过 60 MiB，请导出攻略包后重新导入以清理未使用图片')
      if (!files.has(path)) files.set(path, { blob, url: URL.createObjectURL(blob) })
      return path
    },
    resolve(path: string): string | undefined { return files.get(path)?.url },
    get(path: string): Blob | undefined { return files.get(path)?.blob },
    entries(): [string, Blob][] { return [...files].map(([path, file]) => [path, file.blob]) },
    replaceFrom(other: { entries(): [string, Blob][] }) {
      store.clear()
      for (const [path, blob] of other.entries()) files.set(path, { blob, url: URL.createObjectURL(blob) })
    },
    clear() { generation++; files.forEach(file => URL.revokeObjectURL(file.url)); files.clear() },
  }
  return store
}
export type ImageAssets = ReturnType<typeof createImageAssets>

export async function convertImage(file: File): Promise<Blob> {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('原图大小须在 0 到 20 MiB 之间')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const png = bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const webp = new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  if (!png && !jpeg && !webp) throw new Error('请选择 PNG、JPEG 或静态 WebP 图片')
  // Reject animation instead of silently discarding all but the first frame.
  const view = new DataView(bytes.buffer)
  if (png) {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset)
      const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8))
      if (type === 'acTL') throw new Error('暂不支持动画图片')
      if (offset === 8 && (view.getUint32(16) * view.getUint32(20) > 25_000_000)) throw new Error('图片最多 2500 万像素')
      offset += length + 12
    }
  }
  if (webp) {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = new TextDecoder().decode(bytes.slice(offset, offset + 4))
      const length = view.getUint32(offset + 4, true)
      if (type === 'ANIM' || type === 'ANMF') throw new Error('暂不支持动画图片')
      offset += 8 + length + (length % 2)
    }
  }
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > 25_000_000) throw new Error('图片最多 2500 万像素')
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前环境无法处理图片')
    context.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.95))
    if (!blob || blob.type !== 'image/webp') throw new Error('当前环境不支持 WebP 编码，请换用系统浏览器')
    if (blob.size > 3 * 1024 * 1024) throw new Error('转换后超过 3 MiB，请缩小原图后重试')
    return blob
  } finally { bitmap.close() }
}
