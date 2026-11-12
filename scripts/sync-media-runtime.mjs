import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(root, 'public', 'media-runtime')
const corePackageName = '@ffmpeg/core'
const wrapperPackageName = '@ffmpeg/ffmpeg'
const corePackageDirectory = path.join(root, 'node_modules', ...corePackageName.split('/'))
const wrapperPackageDirectory = path.join(
  root,
  'node_modules',
  ...wrapperPackageName.split('/'),
)
// Vite resolves @ffmpeg/ffmpeg to its ESM wrapper, which creates a module
// Worker. That Worker falls back to dynamic import(coreURL), so the core must
// be the ESM distribution with a callable default export. The UMD file does
// not provide one and fails at browser runtime before FFmpeg can initialize.
const coreAssetDirectory = path.join(corePackageDirectory, 'dist', 'esm')
const assetsToCopy = [
  { logicalName: 'core', file: 'ffmpeg-core.js', mime: 'text/javascript' },
  { logicalName: 'wasm', file: 'ffmpeg-core.wasm', mime: 'application/wasm' },
]

/**
 * `@ffmpeg/core` does not publish the embedded FFmpeg version in package.json.
 * Keep it explicit, so upgrading the core is an intentional reviewed change
 * rather than an inaccurate UI label.
 */
const embeddedFfmpegVersionByCoreVersion = new Map([['0.12.10', 'n5.1.4']])
const exactVersion = /^\d+\.\d+\.\d+$/

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

const exactDependency = (manifest, packageName) => {
  const version = manifest.dependencies?.[packageName]
  if (typeof version !== 'string' || !exactVersion.test(version)) {
    throw new Error(`${packageName} must be an exact dependency version in package.json.`)
  }
  return version
}

const readInstalledPackage = async (directory, packageName, expectedVersion) => {
  const manifest = await readJson(path.join(directory, 'package.json'))
  if (manifest.name !== packageName || manifest.version !== expectedVersion) {
    throw new Error(
      `Installed ${packageName} does not match the package.json lock target ${expectedVersion}. Run pnpm install --frozen-lockfile.`,
    )
  }
  return manifest
}

const ensureRegularFile = async (file) => {
  try {
    if ((await stat(file)).isFile()) return
  } catch {
    // The error below gives the caller a stable recovery action.
  }
  throw new Error(
    `Required @ffmpeg/core runtime asset is missing: ${path.relative(root, file)}.`,
  )
}

const packageJson = await readJson(path.join(root, 'package.json'))
const coreVersion = exactDependency(packageJson, corePackageName)
const wrapperVersion = exactDependency(packageJson, wrapperPackageName)
const [corePackage, wrapperPackage] = await Promise.all([
  readInstalledPackage(corePackageDirectory, corePackageName, coreVersion),
  readInstalledPackage(wrapperPackageDirectory, wrapperPackageName, wrapperVersion),
])
const ffmpegVersion = embeddedFfmpegVersionByCoreVersion.get(coreVersion)
if (!ffmpegVersion) {
  throw new Error(
    `No reviewed embedded FFmpeg baseline is recorded for ${corePackageName}@${coreVersion}. Update this script and docs/07-media-runtime-supply-chain.md together.`,
  )
}

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })

const assets = []
for (const asset of assetsToCopy) {
  const source = path.join(coreAssetDirectory, asset.file)
  const target = path.join(outputDirectory, asset.file)
  await ensureRegularFile(source)
  await cp(source, target)
  const bytes = await readFile(target)
  assets.push({
    ...asset,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  })
}

const manifest = {
  schemaVersion: 3,
  enabled: true,
  runtimeVersion: `ffmpeg-wasm-${wrapperVersion}-core-${coreVersion}`,
  coreVariant: 'single-thread',
  distribution: {
    corePackage: corePackage.name,
    coreVersion,
    wrapperPackage: wrapperPackage.name,
    wrapperVersion,
    ffmpegVersion,
  },
  ...(typeof corePackage.license === 'string' ? { license: corePackage.license } : {}),
  assets,
}

await writeFile(
  path.join(outputDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
)

process.stdout.write(
  `[minfo] prepared ${corePackageName}@${coreVersion} (${assets
    .map((asset) => asset.bytes)
    .reduce(
      (total, bytes) => total + bytes,
      0,
    )} bytes) for ${wrapperPackageName}@${wrapperVersion}.\n`,
)
