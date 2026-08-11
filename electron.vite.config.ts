import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const root = path.resolve(import.meta.dirname);

export default defineConfig({
  main: {
    resolve: {
      alias: {
        "@domain": path.join(root, "src/domain"),
        "@shared": path.join(root, "src/shared"),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
        },
      },
    },
    resolve: {
      alias: {
        "@shared": path.join(root, "src/shared"),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@": path.join(root, "src/renderer/src"),
        "@domain": path.join(root, "src/domain"),
        "@shared": path.join(root, "src/shared"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
