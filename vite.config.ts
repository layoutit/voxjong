import { execSync } from "node:child_process";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

function voxjongVersion(): string {
  try {
    const commitCount = execSync("git rev-list --count HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return `0.${commitCount}`;
  } catch {
    return "0.0";
  }
}

export default defineConfig({
  plugins: [vue()],
  define: {
    __VOXJONG_VERSION__: JSON.stringify(voxjongVersion()),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
