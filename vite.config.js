import { defineConfig } from 'vite'
import { liveWatchPlugin } from './scripts/live-watch-plugin.mjs'

// 本机 Node 17+ 把 localhost 解析为 ::1，导致 Vite 只绑 IPv6 回环，
// 浏览器走 127.0.0.1 时被拒。显式绑定 IPv4 回环。
export default defineConfig({
  server: {
    host: '127.0.0.1',
  },
  plugins: [liveWatchPlugin()],
})
