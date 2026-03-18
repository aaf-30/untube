import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import pLimit from 'p-limit'
import { fetch, ProxyAgent } from 'undici'

const CHUNK_SIZE = 5 * 1024 * 1024
const CONCURRENCY = 20
const RETRY_LIMIT = 3

export interface DownloadProgress {
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
}

export async function downloadVideoParallel(url: string, proxy?: string, signal?: AbortSignal, onProgressCallback: ((progress: DownloadProgress) => void) | null = null): Promise<string | null> {
  const tempFileName = `download_${randomUUID()}.mp4`
  const filePath = path.join(os.tmpdir(), tempFileName)
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined

  try {
    let progress = 0
    const limit = pLimit(CONCURRENCY)
    let fileHandle: fs.FileHandle | null = null

    async function downloadAndWriteChunk(start: number, end: number, chunkIndex: number, retryCount: number = 0): Promise<void> {
      try {
        const response = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}` },
          signal: signal || AbortSignal.timeout(30000),
          dispatcher
        } as any)
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status} for chunk ${chunkIndex}`)
        }
        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        if (fileHandle) {
          await fileHandle.write(buffer, 0, buffer.length, start)
        }
      } catch (error: any) {
        if (retryCount >= RETRY_LIMIT) {
          throw new Error(`Chunk ${chunkIndex} failed after ${RETRY_LIMIT} retries: ${error.message}`)
        }
        return downloadAndWriteChunk(start, end, chunkIndex, retryCount + 1)
      }
    }

    try {
      const headResponse = await fetch(url, {
        method: 'HEAD',
        headers: { 'Accept-Encoding': 'identity' },
        dispatcher
      } as any)

      if (!headResponse.ok) {
        throw new Error(`Server response: ${headResponse.status}`)
      }

      const acceptRanges = headResponse.headers.get('accept-ranges') === 'bytes'
      const totalSize = Number.parseInt(String(headResponse.headers.get('content-length')), 10)

      if (!acceptRanges || Number.isNaN(totalSize)) {
        console.log(`[Downloader] Range not supported or unknown size. Using fallback streaming...`)
        const response = await fetch(url, { dispatcher, signal } as any)
        if (!response.ok || !response.body)
          throw new Error(`Fallback HTTP Error: ${response.status}`)

        await pipeline(Readable.fromWeb(response.body as any), createWriteStream(filePath), { signal })
        return filePath
      }

      fileHandle = await fs.open(filePath, 'w')
      const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)
      const downloadTasks = []
      let downloadedCount = 0

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE - 1, totalSize - 1)

        const task = limit(async () => {
          await downloadAndWriteChunk(start, end, i)
          downloadedCount++
          const percent = Math.ceil((downloadedCount / totalChunks) * 100)
          const downloadedBytes = Math.min(downloadedCount * CHUNK_SIZE, totalSize)

          if (onProgressCallback && percent !== progress) {
            progress = percent
            try {
              onProgressCallback({ percent, downloadedBytes, totalBytes: totalSize })
            } catch (cbError) {
              console.error(cbError)
            }
          }
        })
        downloadTasks.push(task)
      }

      await Promise.all(downloadTasks)
      await fileHandle.close()

      return filePath
    } catch (error: any) {
      console.error(`[Downloader] Failed to process ${url}:`, error.message)
      if (fileHandle) {
        await fileHandle.close().catch(() => {})
      }
      await fs.unlink(filePath).catch(() => {})
      return null
    }
  } catch (err: any) {
    await fs.unlink(filePath).catch(() => {})
    const errStr = err instanceof Error ? err.stack || err.message : String(err)
    console.error(`[Downloader] Critical Error:\n${errStr}`)
    throw err
  }
}
