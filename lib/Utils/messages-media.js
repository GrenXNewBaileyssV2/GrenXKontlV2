/**
 * messages-media.js — ESM gabungan untuk GrenXKontlV2
 */

import { Boom } from '@hapi/boom'
import { exec, spawn } from 'child_process'
import * as Crypto from 'crypto'
import { once } from 'events'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  promises as fs
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable, Transform } from 'stream'
import { URL } from 'url'
import { proto } from '../../WAProto/index.js'
import {
  DEFAULT_ORIGIN,
  MEDIA_HKDF_KEY_MAPPING,
  MEDIA_PATH_MAP
} from '../Defaults/index.js'
import {
  getBinaryNodeChild,
  getBinaryNodeChildBuffer,
  jidNormalizedUser
} from '../WABinary/index.js'
import { aesDecryptGCM, aesEncryptGCM, hkdf } from './crypto.js'
import { generateMessageID, generateMessageIDV2 } from './generics.js'

const genId = () =>
  typeof generateMessageIDV2 === 'function' ? generateMessageIDV2() : generateMessageID()

const getTmpFilesDirectory = () => tmpdir()

// ── Image library ────────────────────────────────────────────────────────────

const getImageProcessingLibrary = async () => {
  const [jimp, sharp] = await Promise.all([
    import('jimp').catch(() => undefined),
    import('sharp').catch(() => undefined)
  ])
  if (sharp) return { sharp }
  if (jimp) return { jimp }
  throw new Boom('No image processing library available')
}

// ── HKDF / media keys ────────────────────────────────────────────────────────

export const hkdfInfoKey = (type) => {
  const hkdfInfo = MEDIA_HKDF_KEY_MAPPING[type]
  return `WhatsApp ${hkdfInfo} Keys`
}

export async function getMediaKeys(buffer, mediaType) {
  if (!buffer) throw new Boom('Cannot derive from empty media key')
  if (typeof buffer === 'string') {
    buffer = Buffer.from(buffer.replace(/data:.*;base64,/, ''), 'base64')
  }
  const expanded = await Promise.resolve(
    hkdf(buffer, 112, { info: hkdfInfoKey(mediaType) })
  )
  return {
    iv: expanded.slice(0, 16),
    cipherKey: expanded.slice(16, 48),
    macKey: expanded.slice(48, 80)
  }
}

// ── Stream helpers ───────────────────────────────────────────────────────────

export const toReadable = (buffer) => {
  const readable = new Readable({ read() {} })
  readable.push(buffer)
  readable.push(null)
  return readable
}

export const toBuffer = async (stream) => {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  stream.destroy()
  return Buffer.concat(chunks)
}

export const getHttpStream = async (url, options = {}) => {
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: options.headers,
    dispatcher: options.dispatcher
  })
  if (!response.ok) {
    throw new Boom(`Failed to fetch stream from ${url}`, {
      statusCode: response.status,
      data: { url }
    })
  }
  return response.body instanceof Readable
    ? response.body
    : Readable.fromWeb(response.body)
}

export const getStream = async (item, opts) => {
  if (Buffer.isBuffer(item)) {
    return { stream: toReadable(item), type: 'buffer' }
  }
  if (item && typeof item === 'object' && 'stream' in item) {
    return { stream: item.stream, type: 'readable' }
  }
  const urlStr = item.url.toString()
  if (urlStr.startsWith('data:')) {
    const buffer = Buffer.from(urlStr.split(',')[1], 'base64')
    return { stream: toReadable(buffer), type: 'buffer' }
  }
  if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
    return { stream: await getHttpStream(item.url, opts), type: 'remote' }
  }
  return { stream: createReadStream(item.url), type: 'file' }
}

// ── Raw upload data ──────────────────────────────────────────────────────────

export const getRawMediaUploadData = async (media, mediaType, logger) => {
  const { stream } = await getStream(media)
  logger?.debug('got stream for raw upload')

  const hasher = Crypto.createHash('sha256')
  const filePath = join(tmpdir(), mediaType + genId())
  const fileWriteStream = createWriteStream(filePath)
  let fileLength = 0

  try {
    for await (const data of stream) {
      fileLength += data.length
      hasher.update(data)
      if (!fileWriteStream.write(data)) await once(fileWriteStream, 'drain')
    }
    fileWriteStream.end()
    await once(fileWriteStream, 'finish')
    stream.destroy()
    return { filePath, fileSha256: hasher.digest(), fileLength }
  } catch (error) {
    fileWriteStream.destroy()
    stream.destroy()
    try { await fs.unlink(filePath) } catch {}
    throw error
  }
}

// ── Image dimension fallback ─────────────────────────────────────────────────

export const parseImageDimensionsPureJs = (buf) => {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 24) return { width: 800, height: 600 }
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    }
    if (
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
    ) {
      const chunkType = buf.subarray(12, 16).toString('ascii')
      if (chunkType === 'VP8 ' && buf.length >= 30) {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
      }
      if (chunkType === 'VP8L' && buf.length >= 25) {
        const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24]
        return {
          width: 1 + (((b1 & 0x3f) << 8) | b0),
          height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
        }
      }
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) { offset++; continue }
        const marker = buf[offset + 1]
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) }
        }
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 2
        } else {
          const segLen = buf.readUInt16BE(offset + 2)
          if (segLen < 2) break
          offset += 2 + segLen
        }
      }
    }
  } catch {}
  return { width: 800, height: 600 }
}

// ── Thumbnails ───────────────────────────────────────────────────────────────

export const extractImageThumb = async (bufferOrFilePath, widthOrHdMode = 32) => {
  const width = typeof widthOrHdMode === 'boolean' ? (widthOrHdMode ? 320 : 32) : widthOrHdMode
  const quality = typeof widthOrHdMode === 'boolean' && widthOrHdMode ? 85 : 50

  if (typeof bufferOrFilePath === 'string' && bufferOrFilePath.startsWith('http')) {
    const res = await fetch(bufferOrFilePath)
    bufferOrFilePath = Buffer.from(await res.arrayBuffer())
  }
  if (bufferOrFilePath instanceof Readable) {
    bufferOrFilePath = await toBuffer(bufferOrFilePath)
  }

  const lib = await getImageProcessingLibrary().catch(() => ({}))

  if ('sharp' in lib && typeof lib.sharp?.default === 'function') {
    const img = lib.sharp.default(bufferOrFilePath)
    const dimensions = await img.metadata()
    const buffer = await img.resize(width).jpeg({ quality }).toBuffer()
    return { buffer, original: { width: dimensions.width, height: dimensions.height } }
  }

  if ('jimp' in lib) {
    try {
      const j = lib.jimp
      const read = j.read || j.Jimp?.read || j.default?.read
      const image = await read(bufferOrFilePath)
      const dimensions = {
        width: image.getWidth?.() ?? image.width,
        height: image.getHeight?.() ?? image.height
      }
      let buffer
      if (typeof image.resize === 'function' && image.getBufferAsync) {
        buffer = await image.quality(quality).resize(width, image.AUTO).getBufferAsync(image.MIME_JPEG || 'image/jpeg')
      } else {
        buffer = await image.resize({ w: width }).getBuffer('image/jpeg', { quality })
      }
      return { buffer, original: dimensions }
    } catch {}
  }

  let rawBuf = null
  try {
    if (Buffer.isBuffer(bufferOrFilePath)) rawBuf = bufferOrFilePath
    else if (typeof bufferOrFilePath === 'string' && existsSync(bufferOrFilePath)) {
      rawBuf = await fs.readFile(bufferOrFilePath)
    }
  } catch {}

  return { buffer: Buffer.alloc(0), original: parseImageDimensionsPureJs(rawBuf) }
}

const extractVideoThumb = (videoPath, destPath, time = '00:00:00', size = { width: 32 }) =>
  new Promise((resolve, reject) => {
    const cmd = `ffmpeg -ss \( {time} -i " \){videoPath}" -y -vf scale=\( {size.width}:-1 -vframes 1 -f image2 " \){destPath}"`
    exec(cmd, (err) => (err ? reject(err) : resolve()))
  })

export async function generateThumbnail(file, mediaType, options = {}) {
  let thumbnail
  let originalImageDimensions
  const hdMode = options.hdMode === true

  if (mediaType === 'image') {
    const { buffer, original } = await extractImageThumb(file, hdMode)
    if (buffer?.length) thumbnail = buffer.toString('base64')
    if (original.width && original.height) {
      originalImageDimensions = { width: original.width, height: original.height }
    }
  } else if (mediaType === 'video') {
    const imgFilename = join(getTmpFilesDirectory(), genId() + '.jpg')
    try {
      const size = hdMode ? { width: 320, height: 180 } : { width: 32, height: 32 }
      await extractVideoThumb(file, imgFilename, '00:00:00', size)
      const buff = await fs.readFile(imgFilename)
      thumbnail = buff.toString('base64')
      await fs.unlink(imgFilename).catch(() => {})
    } catch (err) {
      options.logger?.debug('could not generate video thumb: ' + err)
    }
  }
  return { thumbnail, originalImageDimensions }
}

// ── Profile pictures ─────────────────────────────────────────────────────────

export const generateProfilePicture = async (mediaUpload, dimensions) => {
  const { width: w = 640, height: h = 640 } = dimensions || {}
  let buffer
  if (Buffer.isBuffer(mediaUpload)) buffer = mediaUpload
  else {
    const { stream } = await getStream(mediaUpload)
    buffer = await toBuffer(stream)
  }

  const lib = await getImageProcessingLibrary()
  let img

  if ('sharp' in lib && typeof lib.sharp?.default === 'function') {
    img = await lib.sharp.default(buffer).resize(w, h).jpeg({ quality: 50 }).toBuffer()
  } else if ('jimp' in lib) {
    const j = lib.jimp
    const read = j.read || j.Jimp?.read
    const image = await read(buffer)
    const min = Math.min(image.getWidth?.() ?? image.width, image.getHeight?.() ?? image.height)
    const cropped = image.crop?.(0, 0, min, min) || image.crop({ x: 0, y: 0, w: min, h: min })
    img = await (cropped.resize?.(w, h)?.getBufferAsync?.('image/jpeg')
      || cropped.resize({ w, h }).getBuffer('image/jpeg', { quality: 50 }))
  } else {
    throw new Boom('No image processing library available')
  }
  return { img: await img }
}

export const generatePanoramaProfilePicture = async (mediaUpload, options = {}) => {
  const { maxWidth = 720, quality = 80 } = options
  let buffer

  if (Buffer.isBuffer(mediaUpload)) buffer = mediaUpload
  else if (mediaUpload?.url) {
    const urlStr = mediaUpload.url.toString()
    if (urlStr.startsWith('http')) {
      const res = await fetch(urlStr)
      buffer = Buffer.from(await res.arrayBuffer())
    } else {
      buffer = await toBuffer(createReadStream(urlStr))
    }
  } else {
    buffer = await toBuffer(mediaUpload.stream)
  }

  const lib = await getImageProcessingLibrary()
  let img, fullImg

  if ('sharp' in lib && typeof lib.sharp?.default === 'function') {
    const metadata = await lib.sharp.default(buffer).metadata()
    const ow = metadata.width || 640
    const oh = metadata.height || 640
    const ratio = ow / oh
    let nw = ow, nh = oh
    if (ow > maxWidth) { nw = maxWidth; nh = Math.round(maxWidth / ratio) }

    fullImg = await lib.sharp.default(buffer).resize(nw, nh, { fit: 'inside' }).jpeg({ quality }).toBuffer()
    img = await lib.sharp.default(buffer).resize(640, 640, { fit: 'cover', position: 'center' }).jpeg({ quality: 50 }).toBuffer()
  } else if ('jimp' in lib) {
    const read = lib.jimp.read || lib.jimp.Jimp?.read
    const jimp = await read(buffer)
    const ow = jimp.getWidth?.() ?? jimp.width
    const oh = jimp.getHeight?.() ?? jimp.height
    const ratio = ow / oh
    let nw = ow, nh = oh
    if (ow > maxWidth) { nw = maxWidth; nh = Math.round(maxWidth / ratio) }

    const panorama = jimp.clone().resize(nw, nh)
    fullImg = await (panorama.quality?.(quality)?.getBufferAsync?.('image/jpeg')
      || panorama.getBuffer?.('image/jpeg', { quality }))

    const min = Math.min(ow, oh)
    const x = Math.floor((ow - min) / 2)
    const y = Math.floor((oh - min) / 2)
    const cropped = jimp.clone().crop(x, y, min, min).resize(640, 640)
    img = await (cropped.quality?.(50)?.getBufferAsync?.('image/jpeg')
      || cropped.getBuffer?.('image/jpeg', { quality: 50 }))
  } else {
    throw new Boom('No image processing library available')
  }
  return { img, fullImg }
}

// ── Audio ────────────────────────────────────────────────────────────────────

export async function getAudioDuration(buffer) {
  try {
    const musicMetadata = await import('music-metadata')
    const options = { duration: true }
    let metadata
    if (Buffer.isBuffer(buffer)) metadata = await musicMetadata.parseBuffer(buffer, undefined, options)
    else if (typeof buffer === 'string') metadata = await musicMetadata.parseFile(buffer, options)
    else metadata = await musicMetadata.parseStream(buffer, undefined, options)
    return metadata?.format?.duration
  } catch {
    return undefined
  }
}

export async function getAudioWaveform(buffer, logger) {
  try {
    const { default: decoder } = await import('audio-decode')
    let audioData
    if (Buffer.isBuffer(buffer)) audioData = buffer
    else if (typeof buffer === 'string') audioData = await toBuffer(createReadStream(buffer))
    else audioData = await toBuffer(buffer)

    const audioBuffer = await decoder(audioData)
    const rawData = audioBuffer.getChannelData(0)
    const samples = 64
    const blockSize = Math.floor(rawData.length / samples)
    const filtered = []
    for (let i = 0; i < samples; i++) {
      let sum = 0
      const start = blockSize * i
      for (let j = 0; j < blockSize; j++) sum += Math.abs(rawData[start + j])
      filtered.push(sum / blockSize)
    }
    const multiplier = Math.pow(Math.max(...filtered), -1)
    return new Uint8Array(filtered.map(n => Math.floor(100 * n * multiplier)))
  } catch (e) {
    logger?.debug('Failed to generate waveform: ' + e)
  }
}

// ── Encrypt / prepare streams ────────────────────────────────────────────────

export const prepareStream = async (media, mediaType, { logger, saveOriginalFileIfRequired, opts } = {}) => {
  const { stream, type } = await getStream(media, opts)
  logger?.debug('fetched media stream')

  const encFilePath = join(tmpdir(), mediaType + genId() + '-plain')
  const encFileWriteStream = createWriteStream(encFilePath)
  let originalFilePath, originalFileStream

  if (type === 'file') originalFilePath = media.url.toString()
  else if (saveOriginalFileIfRequired) {
    originalFilePath = join(tmpdir(), mediaType + genId() + '-original')
    originalFileStream = createWriteStream(originalFilePath)
  }

  let fileLength = 0
  const sha256 = Crypto.createHash('sha256')

  try {
    for await (const data of stream) {
      fileLength += data.length
      if (type === 'remote' && opts?.maxContentLength && fileLength > opts.maxContentLength) {
        throw new Boom(`content length exceeded when preparing "${type}"`, { data: { media, type } })
      }
      sha256.update(data)
      if (!encFileWriteStream.write(data)) await once(encFileWriteStream, 'drain')
      if (originalFileStream && !originalFileStream.write(data)) await once(originalFileStream, 'drain')
    }
    encFileWriteStream.end()
    originalFileStream?.end?.()
    await once(encFileWriteStream, 'finish')
    if (originalFileStream) await once(originalFileStream, 'finish')
    stream.destroy()
    return {
      mediaKey: undefined,
      originalFilePath,
      encFilePath,
      mac: undefined,
      fileEncSha256: undefined,
      fileSha256: sha256.digest(),
      fileLength
    }
  } catch (error) {
    encFileWriteStream.destroy()
    originalFileStream?.destroy?.()
    stream.destroy()
    try {
      await fs.unlink(encFilePath)
      if (originalFilePath && type !== 'file') await fs.unlink(originalFilePath)
    } catch (err) {
      logger?.error({ err }, 'failed deleting tmp files')
    }
    throw error
  }
}

export const encryptedStream = async (media, mediaType, { logger, saveOriginalFileIfRequired, opts } = {}) => {
  const { stream, type } = await getStream(media, opts)
  logger?.debug('fetched media stream')

  const mediaKey = Crypto.randomBytes(32)
  const { cipherKey, iv, macKey } = await getMediaKeys(mediaKey, mediaType)
  const encFilePath = join(getTmpFilesDirectory(), mediaType + genId() + '-enc')
  const encFileWriteStream = createWriteStream(encFilePath)

  let originalFileStream, originalFilePath
  if (saveOriginalFileIfRequired) {
    originalFilePath = join(getTmpFilesDirectory(), mediaType + genId() + '-original')
    originalFileStream = createWriteStream(originalFilePath)
  }

  let fileLength = 0
  const aes = Crypto.createCipheriv('aes-256-cbc', cipherKey, iv)
  const hmac = Crypto.createHmac('sha256', macKey).update(iv)
  const sha256Plain = Crypto.createHash('sha256')
  const sha256Enc = Crypto.createHash('sha256')

  const onChunk = async (buff) => {
    sha256Enc.update(buff)
    hmac.update(buff)
    if (!encFileWriteStream.write(buff)) await once(encFileWriteStream, 'drain')
  }

  try {
    for await (const data of stream) {
      fileLength += data.length
      if (type === 'remote' && opts?.maxContentLength && fileLength > opts.maxContentLength) {
        throw new Boom(`content length exceeded when encrypting "${type}"`, { data: { media, type } })
      }
      if (originalFileStream) {
        if (!originalFileStream.write(data)) await once(originalFileStream, 'drain')
      }
      sha256Plain.update(data)
      await onChunk(aes.update(data))
    }
    await onChunk(aes.final())
    const mac = hmac.digest().slice(0, 10)
    sha256Enc.update(mac)
    encFileWriteStream.write(mac)
    encFileWriteStream.end()
    originalFileStream?.end?.()
    stream.destroy()
    await once(encFileWriteStream, 'finish')
    if (originalFileStream) await once(originalFileStream, 'finish')

    return {
      mediaKey,
      originalFilePath,
      encFilePath,
      mac,
      fileEncSha256: sha256Enc.digest(),
      fileSha256: sha256Plain.digest(),
      fileLength
    }
  } catch (error) {
    encFileWriteStream.destroy()
    originalFileStream?.destroy?.()
    aes.destroy()
    hmac.destroy()
    sha256Plain.destroy()
    sha256Enc.destroy()
    stream.destroy()
    try {
      await fs.unlink(encFilePath)
      if (originalFilePath) await fs.unlink(originalFilePath)
    } catch (err) {
      logger?.error({ err }, 'failed deleting tmp files')
    }
    throw error
  }
}

// ── Download ─────────────────────────────────────────────────────────────────

export const DEF_MEDIA_HOST = 'mmg.whatsapp.net'
const AES_CHUNK_SIZE = 16
const toSmallestChunkSize = (num) => Math.floor(num / AES_CHUNK_SIZE) * AES_CHUNK_SIZE

export const getUrlFromDirectPath = (directPath, host = DEF_MEDIA_HOST) =>
  `https://\( {host} \){directPath}`

const extractHost = (url) => {
  if (!url) return undefined
  try { return new URL(url).host } catch { return undefined }
}

export const downloadContentFromMessage = async ({ mediaKey, directPath, url }, type, opts = {}) => {
  const fallbackHost = opts.host ?? extractHost(url)
  const downloadUrl = directPath ? getUrlFromDirectPath(directPath, fallbackHost) : url
  if (!downloadUrl) {
    throw new Boom('No valid media URL or directPath present in message', { statusCode: 400 })
  }
  const keys = await getMediaKeys(mediaKey, type)
  return downloadEncryptedContent(downloadUrl, keys, opts)
}

export const downloadEncryptedContent = async (downloadUrl, { cipherKey, iv }, { startByte, endByte, options } = {}) => {
  let bytesFetched = 0
  let startChunk = 0
  let firstBlockIsIV = false

  if (startByte) {
    const chunk = toSmallestChunkSize(startByte || 0)
    if (chunk) {
      startChunk = chunk - AES_CHUNK_SIZE
      bytesFetched = chunk
      firstBlockIsIV = true
    }
  }

  const endChunk = endByte ? toSmallestChunkSize(endByte || 0) + AES_CHUNK_SIZE : undefined
  const headersInit = options?.headers
  const headers = {
    ...(headersInit ? (Array.isArray(headersInit) ? Object.fromEntries(headersInit) : headersInit) : {}),
    Origin: DEFAULT_ORIGIN
  }
  if (startChunk || endChunk) {
    headers.Range = `bytes=${startChunk}-`
    if (endChunk) headers.Range += endChunk
  }

  const fetched = await getHttpStream(downloadUrl, { ...(options || {}), headers })
  let remainingBytes = Buffer.from([])
  let aes

  const pushBytes = (bytes, push) => {
    if (startByte || endByte) {
      const start = bytesFetched >= startByte ? undefined : Math.max(startByte - bytesFetched, 0)
      const end = bytesFetched + bytes.length < endByte ? undefined : Math.max(endByte - bytesFetched, 0)
      push(bytes.slice(start, end))
      bytesFetched += bytes.length
    } else push(bytes)
  }

  const output = new Transform({
    transform(chunk, _, callback) {
      let data = remainingBytes.length ? Buffer.concat([remainingBytes, chunk]) : chunk
      const decryptLength = toSmallestChunkSize(data.length)
      remainingBytes = data.slice(decryptLength)
      data = data.slice(0, decryptLength)
      if (!aes) {
        let ivValue = iv
        if (firstBlockIsIV) {
          ivValue = data.slice(0, AES_CHUNK_SIZE)
          data = data.slice(AES_CHUNK_SIZE)
        }
        aes = Crypto.createDecipheriv('aes-256-cbc', cipherKey, ivValue)
        if (endByte) aes.setAutoPadding(false)
      }
      try {
        pushBytes(aes.update(data), b => this.push(b))
        callback()
      } catch (error) {
        callback(error)
      }
    },
    final(callback) {
      try {
        pushBytes(aes.final(), b => this.push(b))
        callback()
      } catch (error) {
        callback(error)
      }
    }
  })
  return fetched.pipe(output, { end: true })
}

// ── Upload ───────────────────────────────────────────────────────────────────

export const encodeBase64EncodedStringForUpload = (b64) =>
  encodeURIComponent(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))

const isNodeRuntime = () =>
  typeof process !== 'undefined' &&
  process.versions?.node != null &&
  typeof process.versions.bun === 'undefined' &&
  typeof globalThis.Deno === 'undefined'

export const uploadWithNodeHttp = async ({ url, filePath, headers, timeoutMs, agent }, redirectCount = 0) => {
  if (redirectCount > 5) throw new Error('Too many redirects')
  const parsedUrl = new URL(url)
  const httpModule = parsedUrl.protocol === 'https:' ? await import('https') : await import('http')
  const fileStats = await fs.stat(filePath)
  return new Promise((resolve, reject) => {
    const req = httpModule.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': fileStats.size },
      agent,
      timeout: timeoutMs
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return resolve(uploadWithNodeHttp({
          url: new URL(res.headers.location, url).toString(),
          filePath, headers, timeoutMs, agent
        }, redirectCount + 1))
      }
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch { resolve(undefined) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Upload timeout')) })
    createReadStream(filePath).pipe(req)
  })
}

const uploadWithFetch = async ({ url, filePath, headers, timeoutMs, agent }) => {
  const nodeStream = createReadStream(filePath)
  const webStream = Readable.toWeb(nodeStream)
  const dispatcher = typeof agent?.dispatch === 'function' ? agent : undefined
  const response = await fetch(url, {
    ...(dispatcher ? { dispatcher } : {}),
    method: 'POST',
    body: webStream,
    headers,
    duplex: 'half',
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
  })
  try { return await response.json() } catch { return undefined }
}

const uploadMedia = async (params, logger) => {
  if (isNodeRuntime()) {
    logger?.debug('Using Node.js https module for upload')
    return uploadWithNodeHttp(params)
  }
  logger?.debug('Using Fetch API for upload')
  return uploadWithFetch(params)
}

export const getWAUploadToServer = ({ customUploadHosts, fetchAgent, logger, options }, refreshMediaConn) => {
  return async (filePath, { mediaType, fileEncSha256B64, timeoutMs }) => {
    let uploadInfo = await refreshMediaConn(false)
    let urls
    const hosts = [...(customUploadHosts || []), ...uploadInfo.hosts]
    fileEncSha256B64 = encodeBase64EncodedStringForUpload(fileEncSha256B64)

    const customHeaders = (() => {
      const h = options?.headers
      if (!h) return {}
      return Array.isArray(h) ? Object.fromEntries(h) : h
    })()

    const headers = {
      ...customHeaders,
      'Content-Type': 'application/octet-stream',
      Origin: DEFAULT_ORIGIN
    }

    for (const { hostname } of hosts) {
      logger?.debug(`uploading to "${hostname}"`)
      const auth = encodeURIComponent(uploadInfo.auth)
      const url = `https://\( {hostname} \){MEDIA_PATH_MAP[mediaType]}/\( {fileEncSha256B64}?auth= \){auth}&token=${fileEncSha256B64}`
      let result
      try {
        result = await uploadMedia({ url, filePath, headers, timeoutMs, agent: fetchAgent }, logger)
        if (result?.url || result?.direct_path) {
          urls = {
            mediaUrl: result.url,
            directPath: result.direct_path,
            meta_hmac: result.meta_hmac,
            fbid: result.fbid,
            ts: result.ts
          }
          break
        }
        uploadInfo = await refreshMediaConn(true)
        throw new Error(`upload failed: ${JSON.stringify(result)}`)
      } catch (error) {
        const isLast = hostname === hosts[hosts.length - 1]?.hostname
        logger?.warn({ trace: error?.stack, uploadResult: result },
          `Error uploading to \( {hostname} \){isLast ? '' : ', retrying...'}`)
      }
    }
    if (!urls) throw new Boom('Media upload failed on all hosts', { statusCode: 500 })
    return urls
  }
}

// ── Media retry ──────────────────────────────────────────────────────────────

const getMediaRetryKey = (mediaKey) =>
  hkdf(mediaKey, 32, { info: 'WhatsApp Media Retry Notification' })

export const encryptMediaRetryRequest = (key, mediaKey, meId) => {
  const recp = { stanzaId: key.id }
  const recpBuffer = proto.ServerErrorReceipt.encode(recp).finish()
  const iv = Crypto.randomBytes(12)
  const retryKey = getMediaRetryKey(mediaKey)
  const ciphertext = aesEncryptGCM(recpBuffer, retryKey, iv, Buffer.from(key.id))
  return {
    tag: 'receipt',
    attrs: {
      id: key.id,
      to: jidNormalizedUser(meId),
      type: 'server-error'
    },
    content: [
      {
        tag: 'encrypt',
        attrs: {},
        content: [
          { tag: 'enc_p', attrs: {}, content: ciphertext },
          { tag: 'enc_iv', attrs: {}, content: iv }
        ]
      },
      {
        tag: 'rmr',
        attrs: {
          jid: key.remoteJid,
          from_me: (!!key.fromMe).toString(),
          participant: key.participant || undefined
        }
      }
    ]
  }
}

export const decodeMediaRetryNode = (node) => {
  const rmrNode = getBinaryNodeChild(node, 'rmr')
  const event = {
    key: {
      id: node.attrs.id,
      remoteJid: rmrNode.attrs.jid,
      fromMe: rmrNode.attrs.from_me === 'true',
      participant: rmrNode.attrs.participant
    }
  }
  const errorNode = getBinaryNodeChild(node, 'error')
  if (errorNode) {
    const errorCode = +errorNode.attrs.code
    event.error = new Boom(`Failed to re-upload media (${errorCode})`, {
      data: errorNode.attrs,
      statusCode: getStatusCodeForMediaRetry(errorCode)
    })
  } else {
    const encryptedInfoNode = getBinaryNodeChild(node, 'encrypt')
    const ciphertext = getBinaryNodeChildBuffer(encryptedInfoNode, 'enc_p')
    const iv = getBinaryNodeChildBuffer(encryptedInfoNode, 'enc_iv')
    if (ciphertext && iv) event.media = { ciphertext, iv }
    else event.error = new Boom('Failed to re-upload media (missing ciphertext)', { statusCode: 404 })
  }
  return event
}

export const decryptMediaRetryData = ({ ciphertext, iv }, mediaKey, msgId) => {
  const retryKey = getMediaRetryKey(mediaKey)
  const plaintext = aesDecryptGCM(ciphertext, retryKey, iv, Buffer.from(msgId))
  return proto.MediaRetryNotification.decode(plaintext)
}

export const getStatusCodeForMediaRetry = (code) => MEDIA_RETRY_STATUS_MAP[code]

const MEDIA_RETRY_STATUS_MAP = {
  [proto.MediaRetryNotification.ResultType.SUCCESS]: 200,
  [proto.MediaRetryNotification.ResultType.DECRYPTION_ERROR]: 412,
  [proto.MediaRetryNotification.ResultType.NOT_FOUND]: 404,
  [proto.MediaRetryNotification.ResultType.GENERAL_ERROR]: 418
}

// ── Misc helpers ─────────────────────────────────────────────────────────────

export const mediaMessageSHA256B64 = (message) => {
  const media = Object.values(message)[0]
  return media?.fileSha256 && Buffer.from(media.fileSha256).toString('base64')
}

export function extensionForMediaMessage(message) {
  const getExtension = (mimetype) => mimetype.split(';')[0]?.split('/')[1]
  const type = Object.keys(message)[0]
  if (type === 'locationMessage' || type === 'liveLocationMessage' || type === 'productMessage') {
    return '.jpeg'
  }
  return getExtension(message[type].mimetype)
}

export const crc32 = (buf) => {
  const table = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      t[n] = c >>> 0
    }
    return t
  })()
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export const buildZipArchive = (files) => {
  const localChunks = []
  const centralChunks = []
  let offset = 0
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localChunks.push(localHeader, nameBuf, data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt32LE(offset, 42)
    centralChunks.push(centralHeader, nameBuf)
    offset += localHeader.length + nameBuf.length + data.length
  }
  const centralDirBuf = Buffer.concat(centralChunks)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralDirBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...localChunks, centralDirBuf, eocd])
}

export const resolveStickerBuffer = async (item, opts) => {
  if (Buffer.isBuffer(item)) return item
  const media = typeof item === 'string' ? { url: item } : item
  const { stream } = await getStream(media, opts)
  return toBuffer(stream)
}

export default {
  hkdfInfoKey,
  getMediaKeys,
  extractImageThumb,
  parseImageDimensionsPureJs,
  encodeBase64EncodedStringForUpload,
  generateProfilePicture,
  generatePanoramaProfilePicture,
  mediaMessageSHA256B64,
  getAudioDuration,
  getAudioWaveform,
  toReadable,
  toBuffer,
  getStream,
  generateThumbnail,
  getHttpStream,
  prepareStream,
  encryptedStream,
  getUrlFromDirectPath,
  downloadContentFromMessage,
  downloadEncryptedContent,
  extensionForMediaMessage,
  getRawMediaUploadData,
  getWAUploadToServer,
  encryptMediaRetryRequest,
  decodeMediaRetryNode,
  decryptMediaRetryData,
  getStatusCodeForMediaRetry,
  crc32,
  buildZipArchive,
  resolveStickerBuffer,
  DEF_MEDIA_HOST
}
