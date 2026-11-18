/** Pictures travel inside the project; external URLs are never loaded by a saved layout. */
export function isEmbeddedPicture(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
}
export async function readLayoutPicture(file: File): Promise<{ src: string; alt: string; aspect: number }> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP picture.')
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a picture smaller than 20 MB.')
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the picture.'))
    reader.readAsDataURL(file)
  })
  if (!isEmbeddedPicture(src)) throw new Error('Invalid picture data.')
  const image = new Image()
  image.src = src
  await image.decode()
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('The picture has no image dimensions.')
  return { src, alt: file.name, aspect: image.naturalWidth / image.naturalHeight }
}
