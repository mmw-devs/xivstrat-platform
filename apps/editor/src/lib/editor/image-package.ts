import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { structureToJson, stampOperation, type StrategyStructure } from '@xivstrat/content-schema'
import { parseTemplate } from './import'
import { imageReferences } from './image-references'
import type { ImageAssets } from './image-assets'

const IMAGE_PATH = /^assets\/images\/[a-f0-9]{64}\.webp$/
const TOTAL_LIMIT = 20 * 1024 * 1024

export async function exportImagePackage(structure: StrategyStructure, assets: ImageAssets): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = { 'strategy.json': strToU8(structureToJson(stampOperation(structure))) }
  let total = files['strategy.json'].length
  if (total > 1024 * 1024) throw new Error('JSON 超过 1 MiB')
  const references = imageReferences(structure)
  if (references.length > 30) throw new Error('每篇最多 30 张图片')
  for (const path of references) {
    if (/^https?:\/\//i.test(path)) continue
    const blob = assets.get(path)
    if (!IMAGE_PATH.test(path) || !blob) throw new Error(`缺少本地图片：${path}，请先补选图片`)
    total += blob.size
    if (total > TOTAL_LIMIT) throw new Error('攻略包内容超过 20 MiB')
    files[path] = new Uint8Array(await blob.arrayBuffer())
  }
  return zipSync(files, { level: 0 })
}

export async function importImagePackage(file: File): Promise<{ structure: StrategyStructure; images: Blob[] }> {
  if (file.size > 25 * 1024 * 1024) throw new Error('攻略包超过 25 MiB')
  let total = 0, count = 0
  const names = new Set<string>()
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter(entry) {
    if (++count > 31 || names.has(entry.name)) throw new Error('攻略包文件过多或包含重名文件')
    names.add(entry.name)
    if (entry.name !== 'strategy.json' && !IMAGE_PATH.test(entry.name)) throw new Error('攻略包包含不允许的路径')
    total += entry.originalSize
    if (total > TOTAL_LIMIT || entry.originalSize > (entry.name === 'strategy.json' ? 1024 * 1024 : 3 * 1024 * 1024)) throw new Error('攻略包解压大小超限')
    return true
  } })
  if (!entries['strategy.json']) throw new Error('攻略包缺少 strategy.json')
  const structure = parseTemplate(strFromU8(entries['strategy.json']))
  const refs = new Set(imageReferences(structure))
  for (const path of refs) if (!/^https?:\/\//i.test(path) && !entries[path]) throw new Error(`攻略包缺少图片：${path}`)
  const images: Blob[] = []
  for (const [path, bytes] of Object.entries(entries)) {
    if (path === 'strategy.json') continue
    if (!refs.has(path)) throw new Error('攻略包含未被引用的图片')
    const buffer = Uint8Array.from(bytes).buffer
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    if (path !== `assets/images/${hash}.webp`) throw new Error('图片内容与文件名不匹配')
    if (strFromU8(bytes.slice(0, 4)) !== 'RIFF' || strFromU8(bytes.slice(8, 12)) !== 'WEBP') throw new Error('攻略包包含非 WebP 图片')
    const blob = new Blob([buffer], { type: 'image/webp' })
    const bitmap = await createImageBitmap(blob)
    try { if (bitmap.width * bitmap.height > 25_000_000) throw new Error('图片像素数超限') }
    finally { bitmap.close() }
    images.push(blob)
  }
  return { structure, images }
}
