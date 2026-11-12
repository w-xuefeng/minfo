import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requestedDirectory = process.argv[2] ?? 'public/media-runtime'
const runtimeDirectory = path.resolve(root, requestedDirectory)
const corePackageName = '@ffmpeg/core'
const wrapperPackageName = '@ffmpeg/ffmpeg'
const exactVersion = /^\d+\.\d+\.\d+$/
const sha256Pattern = /^[a-f0-9]{64}$/i
const safeSegment = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const embeddedFfmpegVersionByCoreVersion = new Map([['0.12.10', 'n5.1.4']])

const fail = (message) => {
  throw new Error(`[minfo] invalid media runtime: ${message}`)
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

const exactDependency = (manifest, packageName) => {
  const version = manifest.dependencies?.[packageName]
  if (typeof version !== 'string' || !exactVersion.test(version)) {
    fail(`${packageName} must be an exact dependency version.`)
  }
  return version
}

const safeRuntimeFile = (file) =>
  typeof file === 'string' && file.split('/').every((segment) => safeSegment.test(segment))

if (!runtimeDirectory.startsWith(`${root}${path.sep}`)) {
  fail('runtime directory must be inside the repository.')
}

const packageJson = await readJson(path.join(root, 'package.json'))
const coreVersion = exactDependency(packageJson, corePackageName)
const wrapperVersion = exactDependency(packageJson, wrapperPackageName)
const expectedFfmpegVersion = embeddedFfmpegVersionByCoreVersion.get(coreVersion)
if (!expectedFfmpegVersion)
  fail(`no reviewed FFmpeg baseline exists for ${corePackageName}@${coreVersion}.`)

const manifest = await readJson(path.join(runtimeDirectory, 'manifest.json'))
if (manifest.schemaVersion !== 3 || manifest.enabled !== true) {
  fail('manifest must be an enabled schemaVersion 3 document.')
}
if (manifest.coreVariant !== 'single-thread') {
  fail('GitHub Pages runtime must use the single-thread core.')
}
if (manifest.runtimeVersion !== `ffmpeg-wasm-${wrapperVersion}-core-${coreVersion}`) {
  fail('runtimeVersion does not match the pinned package versions.')
}

const distribution = manifest.distribution
if (
  !distribution ||
  distribution.corePackage !== corePackageName ||
  distribution.coreVersion !== coreVersion ||
  distribution.wrapperPackage !== wrapperPackageName ||
  distribution.wrapperVersion !== wrapperVersion ||
  distribution.ffmpegVersion !== expectedFfmpegVersion
) {
  fail('distribution metadata does not match the reviewed pnpm runtime combination.')
}

if (!Array.isArray(manifest.assets) || manifest.assets.length !== 2) {
  fail('manifest must declare the core and wasm assets exactly once.')
}

const requiredAssets = new Set(['core', 'wasm'])
for (const asset of manifest.assets) {
  if (
    !asset ||
    typeof asset.logicalName !== 'string' ||
    !requiredAssets.delete(asset.logicalName) ||
    !safeRuntimeFile(asset.file) ||
    typeof asset.mime !== 'string' ||
    !Number.isSafeInteger(asset.bytes) ||
    asset.bytes <= 0 ||
    typeof asset.sha256 !== 'string' ||
    !sha256Pattern.test(asset.sha256)
  ) {
    fail('manifest contains an invalid or duplicate asset declaration.')
  }

  const file = path.resolve(runtimeDirectory, asset.file)
  if (!file.startsWith(`${runtimeDirectory}${path.sep}`))
    fail('asset path escapes the runtime directory.')
  const [metadata, bytes] = await Promise.all([stat(file), readFile(file)])
  if (metadata.size !== asset.bytes) fail(`${asset.logicalName} has an unexpected byte length.`)
  if (sha256(bytes) !== asset.sha256.toLowerCase())
    fail(`${asset.logicalName} failed SHA-256 verification.`)
}

if (requiredAssets.size !== 0) fail('manifest is missing the core or wasm asset.')

const coreAsset = manifest.assets.find((asset) => asset.logicalName === 'core')
if (!coreAsset) fail('manifest is missing the core asset.')

const coreFile = path.resolve(runtimeDirectory, coreAsset.file)
try {
  const core = await import(pathToFileURL(coreFile).href)
  if (typeof core.default !== 'function') {
    fail('core JavaScript must be an ESM module with a callable default export.')
  }
} catch (error) {
  if (error instanceof Error && error.message.startsWith('[minfo] invalid media runtime:')) {
    throw error
  }
  const detail = error instanceof Error ? error.message : String(error)
  fail(`core JavaScript cannot be imported as an ESM module: ${detail}`)
}

process.stdout.write(
  `[minfo] verified ${requestedDirectory}: ${corePackageName}@${coreVersion}, ${wrapperPackageName}@${wrapperVersion}.\n`,
)
