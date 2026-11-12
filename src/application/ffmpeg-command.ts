import { getExtension, isSafeExtension, isStableFormat, normalizeFormat } from '@/domain/format'
import type {
  CoverArtwork,
  ExportPlan,
  MetadataDraft,
  NativeTag,
  StableOutputFormat,
} from '@/domain/model'

import { managedLyricsNativeTagKeys } from './audio-metadata-reader'
import {
  buildFfmpegArguments,
  buildMetadataArguments,
  exportableCovers,
  survivingCovers,
} from './ffmpeg-arguments'

export type ShellDialect = 'posix' | 'powershell'

export interface LocalCommandPaths {
  readonly sourcePath: string
  readonly outputPath: string
  readonly coverPaths: Readonly<Record<string, string>>
}

export interface LocalCommandRequest {
  readonly dialect: ShellDialect
  readonly plan: ExportPlan
  readonly draft: MetadataDraft
  readonly originalDraft: MetadataDraft
  /** Original native tags let the script clear the exact managed lyric aliases. */
  readonly nativeTags?: readonly NativeTag[]
  readonly sourceName: string
  readonly customFormat: string
  readonly allowOverwrite: boolean
  readonly paths: LocalCommandPaths
}

interface RenderedArguments {
  readonly args: readonly string[]
  readonly replacementCovers: readonly CoverArtwork[]
}

export const sourcePathPlaceholder = '__MINFO_SOURCE_PATH__'
export const outputPathPlaceholder = '__MINFO_OUTPUT_PATH__'
const coverPathPlaceholder = (index: number): string => `__MINFO_COVER_${index + 1}_PATH__`

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\"'\"'")}'`
const powerShellQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`

const isPlaceholder = (value: string): boolean => /^__MINFO_[A-Z0-9_]+__$/.test(value)
const assertNoNul = (value: string, label: string): void => {
  if (value.includes('\u0000')) throw new Error(`${label} 不能包含 NUL 字符。`)
}

const assertSafeRequest = (request: LocalCommandRequest): void => {
  const values = [
    request.sourceName,
    request.customFormat,
    request.paths.sourcePath,
    request.paths.outputPath,
    ...Object.values(request.paths.coverPaths),
    request.draft.title,
    request.draft.album,
    request.draft.releaseDate,
    request.draft.comment,
    request.draft.trackNo,
    request.draft.trackTotal,
    request.draft.discNo,
    request.draft.discTotal,
    ...request.draft.lyricsSlots.flatMap((slot) => [slot.language, slot.text]),
    ...request.draft.artists,
    ...request.draft.albumArtists,
    ...request.draft.genres,
    ...request.draft.composers,
    ...request.draft.rawTags.flatMap((tag) => [tag.key, tag.value]),
  ]
  values.forEach((value) => assertNoNul(value, '命令参数'))
}

export const hasUnfilledLocalPaths = (request: LocalCommandRequest): boolean => {
  let replacementCovers: readonly CoverArtwork[]
  try {
    replacementCovers = replacementCoversForLocalCommand(request)
  } catch {
    return true
  }
  const paths = [request.paths.sourcePath, request.paths.outputPath]
  for (const cover of replacementCovers) {
    paths.push(request.paths.coverPaths[cover.id] ?? '')
  }
  return paths.some((value) => !value.trim() || isPlaceholder(value.trim()))
}

const localTargetExtension = (request: LocalCommandRequest): string => {
  const custom = normalizeFormat(request.customFormat)
  if (custom) {
    if (!isSafeExtension(custom))
      throw new Error('自定义扩展名只能包含小写字母、数字、点、连字符或下划线。')
    return custom
  }
  if (request.plan.requestedExtension) return request.plan.requestedExtension
  if (request.plan.resolvedFormat) return request.plan.resolvedFormat
  return getExtension(request.sourceName) || 'mp3'
}

const localPlan = (request: LocalCommandRequest, extension: StableOutputFormat): ExportPlan => {
  const sourceExtension = getExtension(request.sourceName)
  return {
    ...request.plan,
    resolvedFormat: extension,
    requiresTranscode: sourceExtension !== extension,
  }
}

const customExportableCovers = (request: LocalCommandRequest): readonly CoverArtwork[] =>
  survivingCovers(request.draft, request.originalDraft).filter(
    (cover) => cover.source === 'replacement' || cover.sourceIndex !== undefined,
  )

const commandCovers = (
  request: LocalCommandRequest,
  extension: string,
): readonly CoverArtwork[] =>
  isStableFormat(extension)
    ? exportableCovers(localPlan(request, extension), request.draft, request.originalDraft)
    : customExportableCovers(request)

const commandReplacementCovers = (
  request: LocalCommandRequest,
  extension: string,
): readonly CoverArtwork[] =>
  commandCovers(request, extension).filter((cover) => cover.source === 'replacement')

/** Covers for which the rendered local script actually needs a file path. */
export const replacementCoversForLocalCommand = (
  request: LocalCommandRequest,
): readonly CoverArtwork[] => commandReplacementCovers(request, localTargetExtension(request))

const buildCustomFormatArguments = (
  request: LocalCommandRequest,
  covers: readonly CoverArtwork[],
  coverPaths: readonly string[],
  output: string,
  preserveAllSourceVideoStreams: boolean,
): string[] => {
  const args = ['-hide_banner', '-nostdin', '-i', '__MINFO_SOURCE__']
  coverPaths.forEach((cover) => args.push('-i', cover))
  args.push('-map', '0:a:0', '-map_metadata', '0')
  if (preserveAllSourceVideoStreams) {
    args.push('-map', '0:v?')
  } else {
    let replacementIndex = 0
    covers.forEach((cover) => {
      if (cover.source === 'embedded' && cover.sourceIndex !== undefined) {
        args.push('-map', `0:v:${cover.sourceIndex}?`)
        return
      }
      args.push('-map', `${replacementIndex + 1}:v:0`)
      replacementIndex += 1
    })
  }
  if (covers.length > 0) {
    args.push('-c:v', 'copy')
  }
  args.push(
    ...buildMetadataArguments(request.draft, request.originalDraft, {
      managedLyricsSourceTagKeys: managedLyricsNativeTagKeys(request.nativeTags ?? []),
    }),
    output,
  )
  return args
}

const originalCoverLayoutIsRetained = (request: LocalCommandRequest): boolean =>
  request.draft.covers.length === request.originalDraft.covers.length &&
  request.draft.covers.every(
    (cover, index) =>
      cover.source === 'embedded' &&
      cover.id === request.originalDraft.covers[index]?.id &&
      cover.kind === request.originalDraft.covers[index]?.kind,
  )

const commandArguments = (request: LocalCommandRequest): RenderedArguments => {
  const extension = localTargetExtension(request)
  const hasUnmappedEmbeddedCover = survivingCovers(request.draft, request.originalDraft).some(
    (cover) => cover.source === 'embedded' && cover.sourceIndex === undefined,
  )
  const preserveAllSourceVideoStreams =
    hasUnmappedEmbeddedCover && originalCoverLayoutIsRetained(request)
  const covers = commandCovers(request, extension)
  const replacementCovers = covers.filter((cover) => cover.source === 'replacement')
  const coverPaths = replacementCovers.map((_cover, index) => `__MINFO_COVER_${index + 1}__`)
  const output = '__MINFO_OUTPUT__'
  if (!isStableFormat(extension)) {
    return {
      args: buildCustomFormatArguments(
        request,
        covers,
        coverPaths,
        output,
        preserveAllSourceVideoStreams,
      ),
      replacementCovers,
    }
  }

  return {
    args: buildFfmpegArguments(
      localPlan(request, extension),
      request.draft,
      request.originalDraft,
      {
        source: '__MINFO_SOURCE__',
        covers: coverPaths,
        output,
      },
      {
        preserveAllSourceVideoStreams,
        managedLyricsSourceTagKeys: managedLyricsNativeTagKeys(request.nativeTags ?? []),
      },
    ),
    replacementCovers,
  }
}

const bashVariableFor = (token: string): string | null => {
  if (token === '__MINFO_SOURCE__') return '"$SOURCE_PATH"'
  if (token.startsWith('__MINFO_COVER_') && token.endsWith('__')) {
    const index = Number(token.slice('__MINFO_COVER_'.length, -'__'.length))
    return Number.isFinite(index) ? `"$COVER_${index}_PATH"` : null
  }
  if (token === '__MINFO_OUTPUT__') return `"$OUTPUT_PATH"`
  return null
}

const powerShellVariableFor = (token: string): string | null => {
  if (token === '__MINFO_SOURCE__') return '$SourcePath'
  if (token.startsWith('__MINFO_COVER_') && token.endsWith('__')) {
    const index = Number(token.slice('__MINFO_COVER_'.length, -'__'.length))
    return Number.isFinite(index) ? `$Cover${index}Path` : null
  }
  if (token === '__MINFO_OUTPUT__') return '$OutputPath'
  return null
}

const filledPath = (value: string, placeholder: string): string => value.trim() || placeholder

const expectedContainerFor = (extension: string): string | null => {
  const containers: Readonly<Record<string, string>> = {
    mp3: 'mp3',
    m4a: 'm4a',
    aac: 'aac',
    flac: 'flac',
    wav: 'wav',
    ogg: 'ogg',
    oga: 'ogg',
    wma: 'asf',
    amr: 'amr',
    mid: 'smf',
    alac: 'm4a',
  }
  return containers[extension] ?? null
}

const renderPosix = (request: LocalCommandRequest, command: RenderedArguments): string => {
  const { args, replacementCovers } = command
  const coverDeclarations = replacementCovers
    .map(
      (cover, index) =>
        `COVER_${index + 1}_PATH=${shellQuote(
          filledPath(request.paths.coverPaths[cover.id] ?? '', coverPathPlaceholder(index)),
        )}`,
    )
    .join('\n')
  const coverChecks = replacementCovers
    .map(
      (_cover, index) =>
        `require_path "COVER_${index + 1}_PATH" "$COVER_${index + 1}_PATH" ${shellQuote(
          coverPathPlaceholder(index),
        )}`,
    )
    .join('\n')
  const overwrite = request.allowOverwrite ? '-y' : '-n'
  const extension = localTargetExtension(request)
  const expectedContainer = expectedContainerFor(extension)

  return `#!/usr/bin/env bash
set -euo pipefail

SOURCE_PATH=${shellQuote(filledPath(request.paths.sourcePath, sourcePathPlaceholder))}
OUTPUT_PATH=${shellQuote(filledPath(request.paths.outputPath, outputPathPlaceholder))}
EXPECTED_EXTENSION=${shellQuote(extension)}
EXPECTED_CONTAINER=${shellQuote(expectedContainer ?? '')}
${coverDeclarations ? `${coverDeclarations}\n` : ''}
require_path() {
  local label="$1" value="$2" placeholder="$3"
  if [ -z "$value" ] || [ "$value" = "$placeholder" ]; then
    printf '%s\\n' "MINFO: please fill $label before running this script." >&2
    exit 2
  fi
}

require_path 'SOURCE_PATH' "$SOURCE_PATH" ${shellQuote(sourcePathPlaceholder)}
require_path 'OUTPUT_PATH' "$OUTPUT_PATH" ${shellQuote(outputPathPlaceholder)}
${coverChecks ? `${coverChecks}\n` : ''}
# Validate the requested extension before FFmpeg can create an unintended file.
case "$OUTPUT_PATH" in
  *."$EXPECTED_EXTENSION") ;;
  *)
    printf '%s\\n' "MINFO: output path must end in .$EXPECTED_EXTENSION." >&2
    exit 2
    ;;
esac
ffmpeg ${overwrite} ${args.map((arg) => bashVariableFor(arg) ?? shellQuote(arg)).join(' ')}

if [ ! -s "$OUTPUT_PATH" ]; then
  printf '%s\\n' 'MINFO: FFmpeg did not create a non-empty output file.' >&2
  exit 1
fi
format_name="$(ffprobe -v error -show_entries format=format_name -of default=nw=1:nk=1 "$OUTPUT_PATH")"
audio_kind="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of default=nw=1:nk=1 "$OUTPUT_PATH")"
if [ "$audio_kind" != 'audio' ]; then
  printf '%s\\n' 'MINFO: FFprobe did not find an audio stream in the output.' >&2
  exit 1
fi
if [ -n "$EXPECTED_CONTAINER" ]; then
  case ",$format_name," in
    *,"$EXPECTED_CONTAINER",*) ;;
    *)
      printf '%s\\n' "MINFO: output container '$format_name' does not match .$EXPECTED_EXTENSION." >&2
      exit 1
      ;;
  esac
fi
ffprobe -v error -show_entries format=format_name,duration:stream=codec_type,codec_name -of json "$OUTPUT_PATH"
`
}

const renderPowerShell = (request: LocalCommandRequest, command: RenderedArguments): string => {
  const { args, replacementCovers } = command
  const coverDeclarations = replacementCovers
    .map(
      (cover, index) =>
        `$Cover${index + 1}Path = ${powerShellQuote(
          filledPath(request.paths.coverPaths[cover.id] ?? '', coverPathPlaceholder(index)),
        )}`,
    )
    .join('\n')
  const coverChecks = replacementCovers
    .map(
      (_cover, index) =>
        `Assert-MinfoPath 'Cover${index + 1}Path' $Cover${index + 1}Path ${powerShellQuote(
          coverPathPlaceholder(index),
        )}`,
    )
    .join('\n')
  const overwrite = request.allowOverwrite ? '-y' : '-n'
  const extension = localTargetExtension(request)
  const expectedContainer = expectedContainerFor(extension)

  return `$ErrorActionPreference = 'Stop'

$SourcePath = ${powerShellQuote(filledPath(request.paths.sourcePath, sourcePathPlaceholder))}
$OutputPath = ${powerShellQuote(filledPath(request.paths.outputPath, outputPathPlaceholder))}
$ExpectedExtension = ${powerShellQuote(extension)}
$ExpectedContainer = ${powerShellQuote(expectedContainer ?? '')}
${coverDeclarations ? `${coverDeclarations}\n` : ''}function Assert-MinfoPath([string]$Name, [string]$Value, [string]$Placeholder) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -eq $Placeholder) {
    throw "MINFO: please fill $Name before running this script."
  }
}

Assert-MinfoPath 'SourcePath' $SourcePath ${powerShellQuote(sourcePathPlaceholder)}
Assert-MinfoPath 'OutputPath' $OutputPath ${powerShellQuote(outputPathPlaceholder)}
${coverChecks ? `${coverChecks}\n` : ''}# Validate the requested extension before FFmpeg can create an unintended file.
if (-not $OutputPath.ToLowerInvariant().EndsWith(".$ExpectedExtension")) {
  throw "MINFO: output path must end in .$ExpectedExtension."
}
& ffmpeg ${overwrite} ${args.map((arg) => powerShellVariableFor(arg) ?? powerShellQuote(arg)).join(' ')}
if ($LASTEXITCODE -ne 0) {
  throw "MINFO: FFmpeg exited with code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $OutputPath) -or (Get-Item -LiteralPath $OutputPath).Length -eq 0) {
  throw 'MINFO: FFmpeg did not create a non-empty output file.'
}
$ProbeJson = & ffprobe -v error -show_entries 'format=format_name,duration:stream=codec_type,codec_name' -of json $OutputPath
if ($LASTEXITCODE -ne 0) {
  throw "MINFO: FFprobe exited with code $LASTEXITCODE."
}
$Probe = $ProbeJson | ConvertFrom-Json
if (-not ($Probe.streams | Where-Object { $_.codec_type -eq 'audio' })) {
  throw 'MINFO: FFprobe did not find an audio stream in the output.'
}
if ($ExpectedContainer -and -not (($Probe.format.format_name -split ',') -contains $ExpectedContainer)) {
  throw "MINFO: output container '$($Probe.format.format_name)' does not match .$ExpectedExtension."
}
$Probe | ConvertTo-Json -Depth 8
`
}

export const renderFfmpegCommand = (request: LocalCommandRequest): string => {
  assertSafeRequest(request)
  const command = commandArguments(request)
  return request.dialect === 'posix'
    ? renderPosix(request, command)
    : renderPowerShell(request, command)
}
