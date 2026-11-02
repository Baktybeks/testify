import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: loadEnv(mode, ".").VITE_BASE_PATH || "/",
  build: { sourcemap: false },
}));
