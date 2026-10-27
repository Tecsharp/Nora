/** Reduce una imagen a un máximo de `max` píxeles de lado y la devuelve como data URI (los documentos llevan sus imágenes dentro). */
export async function shrinkImage(file: File, max: number, quality: number): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  const ctx = canvas.getContext('2d')!
  const keepAlpha = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp'
  if (!keepAlpha) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', quality)
}
