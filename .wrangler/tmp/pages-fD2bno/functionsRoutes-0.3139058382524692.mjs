import { onRequestOptions as __api_transcribe_ts_onRequestOptions } from "/Users/kavya/DEVELPER/ANTIGRAVITY/SUBTITLE GENERATOR-TEST2/functions/api/transcribe.ts"
import { onRequestPost as __api_transcribe_ts_onRequestPost } from "/Users/kavya/DEVELPER/ANTIGRAVITY/SUBTITLE GENERATOR-TEST2/functions/api/transcribe.ts"

export const routes = [
    {
      routePath: "/api/transcribe",
      mountPath: "/api",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_transcribe_ts_onRequestOptions],
    },
  {
      routePath: "/api/transcribe",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_transcribe_ts_onRequestPost],
    },
  ]