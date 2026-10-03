/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  /** Порт локального бэкенда на localhost (по умолчанию 8001). */
  readonly VITE_LOCAL_API_PORT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
