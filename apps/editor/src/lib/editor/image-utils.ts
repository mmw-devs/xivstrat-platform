export function sanitizeName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return sanitized || `img-${Math.floor(Date.now() % 100000)}`
}

export function makeThumbnail(file: File): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    const finish = (result: string): void => {
      URL.revokeObjectURL(url)
      resolve(result)
    }
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const size = 48
        const scale = Math.min(1, size / Math.max(image.width || 1, image.height || 1))
        canvas.width = Math.max(1, Math.round((image.width || 1) * scale))
        canvas.height = Math.max(1, Math.round((image.height || 1) * scale))
        const context = canvas.getContext('2d')
        if (!context) return finish('')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', 0.7))
      } catch {
        finish('')
      }
    }
    image.onerror = () => finish('')
    image.src = url
  })
}