import { describe, expect, it } from 'vitest'

import { maximumLyricsFileBytes, parseLyricsFile } from './lyric-file'

const lyricFile = (contents: BlobPart[], name: string): File => new File(contents, name)

describe('parseLyricsFile', () => {
  it('keeps a UTF-8 LRC file intact and identifies it as synchronised lyrics', async () => {
    const result = await parseLyricsFile(
      lyricFile(['\uFEFF[00:01.20]第一行\r\n[00:02.00]第二行'], 'song.lrc'),
    )

    expect(result).toMatchObject({
      ok: true,
      format: 'lrc',
      text: '[00:01.20]第一行\r\n[00:02.00]第二行',
      representation: 'synchronised',
    })
  })

  it('decodes a UTF-16LE text file with a BOM', async () => {
    const encoded = new Uint8Array([
      0xff, 0xfe, 0x4c, 0x00, 0x79, 0x00, 0x72, 0x00, 0x69, 0x00, 0x63, 0x00,
    ])
    const result = await parseLyricsFile(lyricFile([encoded], 'song.txt'))

    expect(result).toMatchObject({
      ok: true,
      format: 'text',
      text: 'Lyric',
      representation: 'plain',
    })
  })

  it('converts plaintext QRC line and word timing into line-level LRC', async () => {
    const result = await parseLyricsFile(
      lyricFile(['[1234,2100]你(1234,400)好(1634,500)\n[5000,800]世界(5000,800)'], 'song.qrc'),
    )

    expect(result).toMatchObject({
      ok: true,
      format: 'qrc',
      text: '[00:01.234]你好\n[00:05.000]世界',
      representation: 'synchronised',
    })
    expect(result.ok && result.notice).toContain('逐字时间转换为 LRC 行级时间')
  })

  it('extracts plaintext QRC from XML LyricContent', async () => {
    const result = await parseLyricsFile(
      lyricFile(
        [
          '<QrcInfos><Lyric_1 LyricContent="[2000,1200]Hello(2000,500) world(2500,700)" /></QrcInfos>',
        ],
        'song.qrc',
      ),
    )

    expect(result).toMatchObject({ ok: true, text: '[00:02.000]Hello world' })
  })

  it('rejects encrypted or malformed QRC without returning text', async () => {
    const result = await parseLyricsFile(lyricFile(['QrcEncV2:opaque-payload'], 'song.qrc'))

    expect(result).toEqual({
      ok: false,
      error:
        '无法解析 QRC。仅支持明文 QRC 或包含 LyricContent 的 XML QRC；请先导出为明文 LRC/QRC。',
    })
  })

  it('rejects unsupported, empty, binary-like, and oversized files', async () => {
    await expect(parseLyricsFile(lyricFile(['words'], 'song.srt'))).resolves.toEqual({
      ok: false,
      error: '仅支持 .txt、.lrc 或 .qrc 歌词文件。',
    })
    await expect(parseLyricsFile(lyricFile([], 'empty.txt'))).resolves.toEqual({
      ok: false,
      error: '歌词文件为空，请选择包含歌词内容的文件。',
    })
    await expect(
      parseLyricsFile(lyricFile([new Uint8Array([0, 1, 2])], 'binary.txt')),
    ).resolves.toEqual({
      ok: false,
      error: '歌词文件包含不能作为文本导入的控制字符。',
    })
    await expect(
      parseLyricsFile(lyricFile([new Uint8Array(maximumLyricsFileBytes + 1)], 'large.txt')),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining('不能超过 2 MB') })
  })
})
