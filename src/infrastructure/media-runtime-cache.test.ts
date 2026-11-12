import { describe, expect, it } from 'vitest'

import { parseMediaRuntimeManifest } from './media-runtime-cache'

const sha = 'b'.repeat(64)

const manifest = () => ({
  schemaVersion: 3,
  enabled: true,
  runtimeVersion: 'ffmpeg-wasm-0.12.15-core-0.12.10',
  coreVariant: 'single-thread',
  license: 'GPL-2.0-or-later',
  distribution: {
    corePackage: '@ffmpeg/core',
    coreVersion: '0.12.10',
    wrapperPackage: '@ffmpeg/ffmpeg',
    wrapperVersion: '0.12.15',
    ffmpegVersion: 'n5.1.4',
  },
  assets: [
    {
      logicalName: 'core',
      file: 'ffmpeg-core.js',
      mime: 'text/javascript',
      bytes: 1,
      sha256: sha,
    },
    {
      logicalName: 'wasm',
      file: 'ffmpeg-core.wasm',
      mime: 'application/wasm',
      bytes: 1,
      sha256: sha,
    },
  ],
})

describe('parseMediaRuntimeManifest', () => {
  it('accepts the pnpm-distributed core and does not gate on the license label', () => {
    const parsed = parseMediaRuntimeManifest(manifest())

    expect(parsed.license).toBe('GPL-2.0-or-later')
    expect(parsed.distribution).toMatchObject({
      corePackage: '@ffmpeg/core',
      coreVersion: '0.12.10',
      wrapperVersion: '0.12.15',
      ffmpegVersion: 'n5.1.4',
    })
  })

  it('rejects a runtime that does not name the locked ffmpeg.wasm packages', () => {
    const untrusted = manifest()
    untrusted.distribution.corePackage = '@example/ffmpeg-core'

    expect(() => parseMediaRuntimeManifest(untrusted)).toThrow('pnpm')
  })

  it('rejects malformed package or underlying FFmpeg versions', () => {
    const malformed = manifest()
    malformed.distribution.coreVersion = 'latest'

    expect(() => parseMediaRuntimeManifest(malformed)).toThrow('pnpm')
  })

  it('rejects duplicate runtime logical names', () => {
    const duplicate = manifest()
    duplicate.assets.push({
      logicalName: 'core',
      file: 'other-core.js',
      mime: 'text/javascript',
      bytes: 1,
      sha256: sha,
    })
    expect(() => parseMediaRuntimeManifest(duplicate)).toThrow('重复')
  })

  it('allows an intentionally disabled deployment without package provenance', () => {
    expect(
      parseMediaRuntimeManifest({
        schemaVersion: 3,
        enabled: false,
        runtimeVersion: 'unavailable',
        coreVariant: 'single-thread',
        reason: 'No runtime is configured.',
        assets: [],
      }),
    ).toMatchObject({ enabled: false, assets: [] })
  })
})
