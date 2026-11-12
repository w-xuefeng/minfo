export interface MediaRuntimeAsset {
  readonly logicalName: string
  readonly file: string
  readonly mime: string
  readonly bytes: number
  readonly sha256: string
}

/**
 * The browser only executes assets produced from these exact, pnpm-locked
 * packages. The package manager is the supply-chain trust boundary; the
 * browser separately verifies the copied asset bytes before loading them.
 */
export interface PnpmRuntimeDistribution {
  readonly corePackage: '@ffmpeg/core'
  readonly coreVersion: string
  readonly wrapperPackage: '@ffmpeg/ffmpeg'
  readonly wrapperVersion: string
  readonly ffmpegVersion: string
}

export interface MediaRuntimeManifest {
  readonly schemaVersion: 3
  readonly enabled: boolean
  readonly runtimeVersion: string
  readonly coreVariant: 'single-thread' | 'multi-thread'
  readonly distribution?: PnpmRuntimeDistribution
  /** Informational provenance only. It is deliberately not a load gate. */
  readonly license?: string
  readonly reason?: string
  readonly assets: readonly MediaRuntimeAsset[]
}

export interface PreparedMediaRuntime {
  readonly manifest: MediaRuntimeManifest
  readonly urls: Readonly<Record<string, string>>
  readonly source: 'opfs' | 'network'
  revoke(): void
}

interface CacheIndexEntry {
  readonly key: string
  readonly touchedAt: number
}

const cacheDirectoryName = 'minfo-media-runtime-v1'
const cacheIndexName = 'index.json'
const safeSegment = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const sha256Pattern = /^[a-f0-9]{64}$/i
const versionPattern = /^\d+\.\d+\.\d+$/
const ffmpegVersionPattern = /^n\d+\.\d+\.\d+$/

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer

const appAssetUrl = (file: string): string => {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return new URL(`${base}media-runtime/${file}`, window.location.origin).toString()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isSafeRuntimePath = (file: string): boolean =>
  file.split('/').every((segment) => safeSegment.test(segment))

const parseAsset = (value: unknown): MediaRuntimeAsset | null => {
  if (!isRecord(value)) return null
  const { logicalName, file, mime, bytes, sha256 } = value
  if (
    typeof logicalName !== 'string' ||
    typeof file !== 'string' ||
    typeof mime !== 'string' ||
    typeof bytes !== 'number' ||
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    typeof sha256 !== 'string' ||
    !sha256Pattern.test(sha256) ||
    !isSafeRuntimePath(file)
  ) {
    return null
  }
  return { logicalName, file, mime, bytes, sha256: sha256.toLowerCase() }
}

const parseDistribution = (value: unknown): PnpmRuntimeDistribution | null => {
  if (!isRecord(value)) return null
  const { corePackage, coreVersion, wrapperPackage, wrapperVersion, ffmpegVersion } = value
  if (
    corePackage !== '@ffmpeg/core' ||
    wrapperPackage !== '@ffmpeg/ffmpeg' ||
    !nonEmptyString(coreVersion) ||
    !nonEmptyString(wrapperVersion) ||
    !nonEmptyString(ffmpegVersion) ||
    !versionPattern.test(coreVersion) ||
    !versionPattern.test(wrapperVersion) ||
    !ffmpegVersionPattern.test(ffmpegVersion)
  ) {
    return null
  }
  return {
    corePackage,
    coreVersion,
    wrapperPackage,
    wrapperVersion,
    ffmpegVersion,
  }
}

export const parseMediaRuntimeManifest = (value: unknown): MediaRuntimeManifest => {
  if (!isRecord(value)) throw new Error('媒体运行时清单不是有效对象。')
  const { schemaVersion, enabled, runtimeVersion, coreVariant, assets } = value
  if (
    schemaVersion !== 3 ||
    typeof enabled !== 'boolean' ||
    !nonEmptyString(runtimeVersion) ||
    (coreVariant !== 'single-thread' && coreVariant !== 'multi-thread') ||
    !Array.isArray(assets)
  ) {
    throw new Error('媒体运行时清单缺少必填字段或 schema 不受支持。')
  }

  const parsedAssets = assets.map(parseAsset)
  if (parsedAssets.some((asset) => asset === null)) {
    throw new Error('媒体运行时清单含有不安全或不完整的资源定义。')
  }
  const resolvedAssets = parsedAssets as MediaRuntimeAsset[]
  if (
    new Set(resolvedAssets.map((asset) => asset.logicalName)).size !== resolvedAssets.length
  ) {
    throw new Error('媒体运行时清单含有重复的资源逻辑名称。')
  }

  const optionalString = (key: string): string | undefined => {
    const candidate = value[key]
    return nonEmptyString(candidate) ? candidate : undefined
  }
  const manifest: MediaRuntimeManifest = {
    schemaVersion,
    enabled,
    runtimeVersion,
    coreVariant,
    assets: resolvedAssets,
  }
  const distribution = parseDistribution(value.distribution)
  const license = optionalString('license')
  const reason = optionalString('reason')
  if ((value.distribution !== undefined && !distribution) || (enabled && !distribution)) {
    throw new Error('启用的媒体运行时缺少由 pnpm 锁定的核心与包装器版本记录。')
  }
  return {
    ...manifest,
    ...(distribution ? { distribution } : {}),
    ...(license ? { license } : {}),
    ...(reason ? { reason } : {}),
  }
}

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  if (!crypto.subtle) throw new Error('当前浏览器无法校验媒体运行时完整性。')
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes))
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('')
}

const assertAsset = async (asset: MediaRuntimeAsset, bytes: Uint8Array): Promise<void> => {
  if (bytes.byteLength !== asset.bytes) {
    throw new Error(`媒体运行时资源 ${asset.logicalName} 的大小校验失败。`)
  }
  if ((await sha256(bytes)) !== asset.sha256) {
    throw new Error(`媒体运行时资源 ${asset.logicalName} 的 SHA-256 校验失败。`)
  }
}

const fetchAssetOnce = async (
  asset: MediaRuntimeAsset,
  cache: RequestCache,
): Promise<Uint8Array> => {
  const response = await fetch(appAssetUrl(asset.file), { cache })
  if (!response.ok) {
    throw new Error(`无法下载媒体运行时资源 ${asset.logicalName}（HTTP ${response.status}）。`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  await assertAsset(asset, bytes)
  return bytes
}

/**
 * A CDN or a just-updated Pages edge can briefly serve a stale binary. Retry
 * exactly once with `reload`; any second failure stays controlled and does not
 * result in executing an unverified asset.
 */
const fetchAsset = async (asset: MediaRuntimeAsset): Promise<Uint8Array> => {
  try {
    return await fetchAssetOnce(asset, 'no-cache')
  } catch (firstError) {
    try {
      return await fetchAssetOnce(asset, 'reload')
    } catch (secondError) {
      const detail = secondError instanceof Error ? secondError.message : String(secondError)
      const firstDetail = firstError instanceof Error ? firstError.message : String(firstError)
      throw new Error(
        `媒体运行时资源 ${asset.logicalName} 重试一次后仍未通过下载或完整性校验：${detail}（首次失败：${firstDetail}）`,
        { cause: secondError },
      )
    }
  }
}

const assetKey = (manifest: MediaRuntimeManifest): string => {
  const fingerprint = [
    manifest.runtimeVersion,
    manifest.distribution?.corePackage ?? '',
    manifest.distribution?.coreVersion ?? '',
    manifest.distribution?.wrapperPackage ?? '',
    manifest.distribution?.wrapperVersion ?? '',
    ...manifest.assets.map((asset) => `${asset.logicalName}:${asset.sha256}`).sort(),
  ].join('|')
  let hash = 2166136261
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash ^= fingerprint.charCodeAt(index) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `${manifest.runtimeVersion.replace(/[^a-zA-Z0-9._-]/g, '-')}-${(hash >>> 0).toString(16)}`
}

const getOpfsRoot = async (): Promise<FileSystemDirectoryHandle | null> => {
  if (!navigator.storage?.getDirectory) return null
  try {
    return await navigator.storage.getDirectory()
  } catch {
    return null
  }
}

const directoryForPath = async (
  root: FileSystemDirectoryHandle,
  file: string,
  create: boolean,
): Promise<{ readonly directory: FileSystemDirectoryHandle; readonly fileName: string }> => {
  const segments = file.split('/')
  const fileName = segments.pop()
  if (!fileName || !safeSegment.test(fileName)) throw new Error('不安全的运行时缓存路径。')
  let directory = root
  for (const segment of segments) {
    if (!safeSegment.test(segment)) throw new Error('不安全的运行时缓存路径。')
    directory = await directory.getDirectoryHandle(segment, { create })
  }
  return { directory, fileName }
}

const readCachedAsset = async (
  root: FileSystemDirectoryHandle,
  asset: MediaRuntimeAsset,
): Promise<Uint8Array> => {
  const { directory, fileName } = await directoryForPath(root, asset.file, false)
  const handle = await directory.getFileHandle(fileName)
  const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer())
  await assertAsset(asset, bytes)
  return bytes
}

const writeCachedAsset = async (
  root: FileSystemDirectoryHandle,
  asset: MediaRuntimeAsset,
  bytes: Uint8Array,
): Promise<void> => {
  const { directory, fileName } = await directoryForPath(root, asset.file, true)
  const handle = await directory.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  await writable.write(toArrayBuffer(bytes))
  await writable.close()
}

const readJson = async <T>(
  root: FileSystemDirectoryHandle,
  fileName: string,
  fallback: T,
): Promise<T> => {
  try {
    const handle = await root.getFileHandle(fileName)
    return JSON.parse(await (await handle.getFile()).text()) as T
  } catch {
    return fallback
  }
}

const writeJson = async (
  root: FileSystemDirectoryHandle,
  fileName: string,
  value: unknown,
): Promise<void> => {
  const handle = await root.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(value))
  await writable.close()
}

const updateCacheIndex = async (
  cacheRoot: FileSystemDirectoryHandle,
  key: string,
): Promise<void> => {
  const oldEntries = await readJson<CacheIndexEntry[]>(cacheRoot, cacheIndexName, [])
  const entries = [
    { key, touchedAt: Date.now() },
    ...oldEntries.filter((entry) => entry.key !== key && safeSegment.test(entry.key)),
  ].slice(0, 2)
  await writeJson(cacheRoot, cacheIndexName, entries)

  const kept = new Set(entries.map((entry) => entry.key))
  for await (const [name, handle] of (cacheRoot as IterableDirectoryHandle).entries()) {
    if (name === cacheIndexName || kept.has(name) || handle.kind !== 'directory') continue
    await cacheRoot.removeEntry(name, { recursive: true })
  }
}

const urlSet = (
  manifest: MediaRuntimeManifest,
  bytesByName: ReadonlyMap<string, Uint8Array>,
): PreparedMediaRuntime => {
  const urls: Record<string, string> = {}
  const allocated: string[] = []
  for (const asset of manifest.assets) {
    const bytes = bytesByName.get(asset.logicalName)
    if (!bytes) throw new Error(`运行时资源 ${asset.logicalName} 未加载。`)
    const url = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: asset.mime }))
    urls[asset.logicalName] = url
    allocated.push(url)
  }
  return {
    manifest,
    urls,
    source: 'network',
    revoke: () => allocated.forEach((url) => URL.revokeObjectURL(url)),
  }
}

const cacheAndBuildUrls = async (
  manifest: MediaRuntimeManifest,
): Promise<PreparedMediaRuntime> => {
  const cacheKey = assetKey(manifest)
  const opfs = await getOpfsRoot()
  if (!opfs) {
    const bytes = new Map<string, Uint8Array>()
    for (const asset of manifest.assets) bytes.set(asset.logicalName, await fetchAsset(asset))
    return urlSet(manifest, bytes)
  }

  let cacheRoot: FileSystemDirectoryHandle
  try {
    cacheRoot = await opfs.getDirectoryHandle(cacheDirectoryName, { create: true })
  } catch {
    const bytes = new Map<string, Uint8Array>()
    for (const asset of manifest.assets) bytes.set(asset.logicalName, await fetchAsset(asset))
    return urlSet(manifest, bytes)
  }

  try {
    const versionDirectory = await cacheRoot.getDirectoryHandle(cacheKey)
    const bytes = new Map<string, Uint8Array>()
    for (const asset of manifest.assets) {
      bytes.set(asset.logicalName, await readCachedAsset(versionDirectory, asset))
    }
    await updateCacheIndex(cacheRoot, cacheKey)
    return { ...urlSet(manifest, bytes), source: 'opfs' }
  } catch {
    // A partial or corrupt cache is never used. Download and validate every
    // asset before replacing this version directory.
    try {
      await cacheRoot.removeEntry(cacheKey, { recursive: true })
    } catch {
      // The directory may not exist yet. This does not affect the verified
      // network fallback below.
    }
  }

  const downloaded = new Map<string, Uint8Array>()
  for (const asset of manifest.assets)
    downloaded.set(asset.logicalName, await fetchAsset(asset))

  try {
    const versionDirectory = await cacheRoot.getDirectoryHandle(cacheKey, { create: true })
    for (const asset of manifest.assets) {
      const bytes = downloaded.get(asset.logicalName)
      if (!bytes) throw new Error(`运行时资源 ${asset.logicalName} 未下载。`)
      await writeCachedAsset(versionDirectory, asset, bytes)
    }
    await updateCacheIndex(cacheRoot, cacheKey)
    return { ...urlSet(manifest, downloaded), source: 'opfs' }
  } catch {
    // Caching is an optimization. The already verified bytes are still safe to use.
    return urlSet(manifest, downloaded)
  }
}

export const loadMediaRuntimeManifest = async (): Promise<MediaRuntimeManifest> => {
  const response = await fetch(appAssetUrl('manifest.json'), { cache: 'no-cache' })
  if (!response.ok) throw new Error(`无法读取媒体运行时清单（HTTP ${response.status}）。`)
  return parseMediaRuntimeManifest(await response.json())
}

export const prepareMediaRuntime = async (): Promise<PreparedMediaRuntime> => {
  const manifest = await loadMediaRuntimeManifest()
  if (!manifest.enabled) {
    throw new Error(manifest.reason ?? '当前部署未提供媒体运行时。')
  }
  if (!manifest.distribution) {
    throw new Error('媒体运行时缺少由 pnpm 锁定的 @ffmpeg/core / @ffmpeg/ffmpeg 版本记录。')
  }
  if (!manifest.assets.some((asset) => asset.logicalName === 'core')) {
    throw new Error('媒体运行时缺少 core 资源。')
  }
  if (!manifest.assets.some((asset) => asset.logicalName === 'wasm')) {
    throw new Error('媒体运行时缺少 wasm 资源。')
  }
  if (
    manifest.coreVariant === 'multi-thread' &&
    !manifest.assets.some((asset) => asset.logicalName === 'worker')
  ) {
    throw new Error('多线程媒体运行时缺少 pthread worker 资源。')
  }
  if (manifest.coreVariant === 'multi-thread' && !globalThis.crossOriginIsolated) {
    throw new Error('多线程媒体运行时需要跨源隔离；GitHub Pages 请使用单线程核心。')
  }
  return cacheAndBuildUrls(manifest)
}
