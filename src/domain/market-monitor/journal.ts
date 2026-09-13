import { open } from 'node:fs/promises'

const BLOCK_BYTES = 64 * 1024

/** Read complete JSON records from a captured file tail, decoding UTF-8 only
 * after joining block boundaries. Appends beyond the captured size wait for
 * the next read. Malformed/partial records do not erase valid earlier rows. */
export async function readRecentJsonLines<T extends object>(
  file: string, limit: number, matches: (row: T) => boolean = () => true,
): Promise<{ rows: T[]; bytesRead: number }> {
  let handle
  try { handle = await open(file, 'r') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { rows: [], bytesRead: 0 }
    throw error
  }
  try {
    const rows: T[] = []
    const count = Math.max(1, Math.trunc(limit))
    let position = (await handle.stat()).size
    let pending = Buffer.alloc(0)
    let bytesRead = 0
    const collect = (line: Buffer) => {
      if (!line.length) return
      let row: T
      try { row = JSON.parse(line.toString('utf8')) as T } catch { return }
      if (row && typeof row === 'object' && !Array.isArray(row) && matches(row)) rows.push(row)
    }
    while (position > 0 && rows.length < count) {
      const length = Math.min(BLOCK_BYTES, position)
      position -= length
      const block = Buffer.allocUnsafe(length)
      const read = await handle.read(block, 0, length, position)
      bytesRead += read.bytesRead
      const chunk = Buffer.concat([block.subarray(0, read.bytesRead), pending])
      let end = chunk.length
      for (let i = chunk.length - 1; i >= 0; i--) {
        if (chunk[i] !== 10) continue
        collect(chunk.subarray(i + 1, end))
        end = i
        if (rows.length === count) break
      }
      pending = chunk.subarray(0, end)
    }
    if (position === 0 && rows.length < count) collect(pending)
    return { rows: rows.reverse(), bytesRead }
  } finally { await handle.close() }
}
