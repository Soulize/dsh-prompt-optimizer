import { openSync, readSync, closeSync, fstatSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute, win32, basename, extname } from 'node:path'
import { createHash } from 'node:crypto'

export const MATERIAL_MAX_FILES = 4
export const MATERIAL_MAX_IMAGES = 4
export const MATERIAL_FILE_BYTES = 2 * 1024 * 1024
export const MATERIAL_TEXT_CHARS = 16000
export const MATERIAL_TOTAL_CHARS = 48000
export const MATERIAL_IMAGE_BYTES = 5 * 1024 * 1024
export const MATERIAL_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024
const mediaTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

export function validateMaterialInput(args) {
  const descriptor = x => x && typeof x === 'object' && typeof x.path === 'string' && x.path.trim() && x.path.length <= 1000
    && typeof x.purpose === 'string' && x.purpose.trim() && x.purpose.length <= 1200
  const legacy = args.artifacts || []
  const files = args.files || []
  const images = args.images || []
  if (!Array.isArray(legacy) || !legacy.every(p => typeof p === 'string' && p.trim() && p.length <= 1000)
    || !Array.isArray(files) || !files.every(descriptor) || legacy.length + files.length > MATERIAL_MAX_FILES) return 'invalid-artifacts'
  if (!Array.isArray(images) || !images.every(descriptor) || images.length > MATERIAL_MAX_IMAGES) return 'invalid-images'
  return null
}

// Lexical and realpath checks. Refuse directories, outside symlinks, UNC and drive-relative names.
export function materialPath(root, path) {
  if (!root || typeof path !== 'string' || !path.trim() || isAbsolute(path) || win32.isAbsolute(path) || /^[a-z]:/i.test(path)) throw new Error('outside-workspace')
  const base = realpathSync(root)
  const target = resolve(base, path)
  const back = relative(base, target)
  if (!back || back === '..' || back.startsWith('..' + '/') || back.startsWith('..' + String.fromCharCode(92)) || isAbsolute(back)) throw new Error('outside-workspace')
  const actual = realpathSync(target)
  const rel = relative(base, actual)
  if (!rel || rel === '..' || rel.startsWith('..' + '/') || rel.startsWith('..' + String.fromCharCode(92)) || isAbsolute(rel)) throw new Error('outside-workspace')
  return actual
}
function readBounded(root, path, cap) {
  const actual = materialPath(root, path)
  const fd = openSync(actual, 'r')
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error('not-a-file')
    if (stat.size > cap) throw new Error('file-too-large')
    const buffer = Buffer.alloc(stat.size + 1)
    let count = 0, n
    while (count < buffer.length && (n = readSync(fd, buffer, count, buffer.length - count, null)) > 0) count += n
    if (count > stat.size) throw new Error('file-changed-during-read')
    return { data: buffer.subarray(0, count), actual }
  } finally { closeSync(fd) }
}
function reasonOf(error) {
  if (error?.code === 'ENOENT') return 'file-not-found'
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'permission-denied'
  return String(error?.message || 'material-unavailable').slice(0, 180)
}

// Text payload and image blocks stay separate: no image bytes in the UI or tool result.
export async function prepareAdvisorMaterials({ args, root, enabled, imageSupport, attachments, signal } = {}) {
  const materials = [], evidence = [], images = [], evidenceIds = new Set(), resultIds = new Set()
  const files = [...(args.artifacts || []).map(path => ({ path, purpose: '本次成果或验证材料' })), ...(args.files || [])]
  let chars = 0, imageBytes = 0, limited = false
  const descriptors = [...files.map((d,i)=>({...d,id:'F'+i,kind:'file'})), ...(args.images || []).map((d,i)=>({...d,id:'I'+i,kind:'image'}))]
  for (const descriptor of descriptors) {
    if (signal?.aborted) throw signal.reason || new Error('cancelled')
    const row = { ...descriptor, status: 'unavailable', sent: false, previewAvailable: false }
    materials.push(row)
    const fail = reason => { row.reason = reason; limited = true; evidence.push({ id: row.id, path: row.path, purpose: row.purpose, status: row.status, reason }) }
    if (!enabled || !root) { fail('read-tools-disabled-or-no-cwd'); continue }
    try {
      if (row.kind === 'file') {
        const { data, actual } = readBounded(root, row.path, MATERIAL_FILE_BYTES)
        row.previewAvailable = true; row.previewPath = actual; row.bytes = data.length
        if (data.includes(0)) { fail('binary-file-not-supported'); continue }
        let text
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(data) } catch { fail('text-is-not-utf8'); continue }
        const available = Math.min(MATERIAL_TEXT_CHARS, Math.max(0, MATERIAL_TOTAL_CHARS - chars))
        if (!available) { fail('text-budget-exhausted'); continue }
        const body = text.slice(0, available)
        chars += body.length
        row.status = body.length < text.length ? 'truncated' : 'ready'
        row.truncated = row.status === 'truncated'; row.sent = true
        row.chars = text.length; row.sentChars = body.length
        row.sha256 = createHash('sha256').update(data).digest('hex')
        row.excerpt = body.slice(0, 2400)
        evidence.push({ id: row.id, path: row.path, purpose: row.purpose, status: row.status, chars: text.length, sentChars: body.length, text: body })
        evidenceIds.add(row.id); resultIds.add(row.id)
        limited ||= row.truncated
      } else {
        const type = mediaTypes[extname(row.path).toLowerCase()]
        if (!type) { fail('unsupported-image-format'); continue }
        const { data, actual } = readBounded(root, row.path, MATERIAL_IMAGE_BYTES)
        row.previewAvailable = true; row.previewPath = actual; row.bytes = data.length
        if (imageSupport !== true) { row.status = 'not-inspected'; fail(imageSupport === false ? 'model-text-only' : 'model-image-capability-unknown'); continue }
        if (!attachments || typeof attachments.saveImage !== 'function') { row.status = 'not-inspected'; fail('attachment-service-unavailable'); continue }
        if (imageBytes + data.length > MATERIAL_TOTAL_IMAGE_BYTES) { fail('image-budget-exhausted'); continue }
        const attachment = await attachments.saveImage({ data, mediaType: type, name: basename(row.path) })
        if (signal?.aborted) throw signal.reason || new Error('cancelled')
        imageBytes += data.length
        row.status = 'ready'; row.sent = true
        row.image = { mediaType: attachment.mediaType, bytes: attachment.bytes, width: attachment.width, height: attachment.height,
          resized: !!attachment.originalDimensions }
        row.sha256 = createHash('sha256').update(data).digest('hex')
        evidence.push({ id: row.id, path: row.path, purpose: row.purpose, status: 'ready', image: row.image })
        images.push({ type: 'text', text: '图像证据 ' + row.id + '：' + row.path + '；检查用途：' + row.purpose }, { type: 'image', attachment })
        evidenceIds.add(row.id); resultIds.add(row.id)
      }
    } catch (error) {
      if (signal?.aborted) throw error
      fail(reasonOf(error))
    }
  }
  return { materials, evidence, images, evidenceIds, resultIds, limited }
}
