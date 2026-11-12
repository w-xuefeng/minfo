import { describe, expect, it } from 'vitest'

import {
  canonicalizeLyricsTextForComparison,
  duplicateLyricsLanguages,
  isLyricsLanguage,
  normalizeLyricsLanguage,
  ordinaryLyricsMetadataTags,
  lyricsManifestMetadataKeys,
  suggestedLyricsLanguageLabel,
  suggestedLyricsLanguages,
} from './lyrics'
import type { LyricsSlot } from './model'

const slot = (language: string, text: string): LyricsSlot => ({
  id: language,
  language,
  descriptor: '',
  representation: 'plain',
  text,
})

describe('lyrics slots', () => {
  it('offers the curated language list with Chinese labels', () => {
    expect(suggestedLyricsLanguages).toEqual([
      'und',
      'zho',
      'eng',
      'jpn',
      'kor',
      'fra',
      'deu',
      'spa',
      'ita',
      'rus',
      'por',
      'ara',
      'hin',
      'tha',
      'vie',
      'ind',
      'msa',
      'tam',
      'ben',
      'tur',
      'pol',
      'nld',
      'swe',
      'dan',
      'fin',
      'nor',
      'ces',
      'hun',
      'ron',
      'ukr',
      'ell',
      'heb',
      'cat',
      'fil',
    ])
    expect(suggestedLyricsLanguages.map(suggestedLyricsLanguageLabel)).toEqual([
      '未指定',
      '中文',
      '英语',
      '日语',
      '韩语',
      '法语',
      '德语',
      '西班牙语',
      '意大利语',
      '俄语',
      '葡萄牙语',
      '阿拉伯语',
      '印地语',
      '泰语',
      '越南语',
      '印尼语',
      '马来语',
      '泰米尔语',
      '孟加拉语',
      '土耳其语',
      '波兰语',
      '荷兰语',
      '瑞典语',
      '丹麦语',
      '芬兰语',
      '挪威语',
      '捷克语',
      '匈牙利语',
      '罗马尼亚语',
      '乌克兰语',
      '希腊语',
      '希伯来语',
      '加泰罗尼亚语',
      '菲律宾语',
    ])
    expect(suggestedLyricsLanguageLabel('zho-Hans')).toBeUndefined()
  })

  it('normalizes language input and finds duplicate language slots', () => {
    expect(normalizeLyricsLanguage(' ZHO ')).toBe('zho')
    expect(isLyricsLanguage('zho-Hans')).toBe(true)
    expect(isLyricsLanguage('zho/unsafe')).toBe(false)
    expect(duplicateLyricsLanguages([slot('eng', 'one'), slot('ENG', 'two')])).toEqual(['eng'])
  })

  it('treats equivalent LRC timestamp precisions as the same during readback', () => {
    expect(canonicalizeLyricsTextForComparison('[00:01.56] 第一行\r\n[00:02.560] 第二行')).toBe(
      '[1560] 第一行\n[2560] 第二行',
    )
  })

  it('maps the first slot to ordinary tags and subsequent slots to language-qualified tags', () => {
    expect(ordinaryLyricsMetadataTags([slot('zho', '中文'), slot('eng', 'English')])).toEqual([
      { key: 'lyrics', value: '中文', language: 'zho', primary: true },
      { key: 'lyrics_language', value: 'zho', language: 'zho', primary: true },
      { key: 'lyrics-eng', value: 'English', language: 'eng', primary: false },
    ])
    expect(lyricsManifestMetadataKeys([slot('eng', 'English')])).toEqual([
      'lyrics',
      'lyrics_language',
      'lyrics-eng',
    ])
  })
})
