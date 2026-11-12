/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Enables FFmpeg / FFprobe console.debug() output in Vite development mode only. */
  readonly VITE_MINFO_MEDIA_DEBUG?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
