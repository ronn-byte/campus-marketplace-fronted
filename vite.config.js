import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.BACKEND_URL || env.VITE_API_URL || "http://localhost:5000";

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api/v1": {
          target: new URL(backendUrl).origin,
        },
      },
    },
  };
})
