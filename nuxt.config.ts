import { execSync } from "node:child_process"

function voxjongVersion(): string {
  try {
    const commitCount = execSync("git rev-list --count HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim()
    return `0.${commitCount}`
  } catch {
    return "0.0"
  }
}

export default defineNuxtConfig({
  ssr: true,
  srcDir: "src",
  compatibilityDate: "2026-06-24",
  buildDir: process.env.NUXT_BUILD_DIR || ".nuxt",
  app: {
    head: {
      viewport:
        "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      htmlAttrs: {
        lang: "en"
      },
      link: [
        {
          rel: "icon",
          type: "image/svg+xml",
          href: "/favicon.svg"
        }
      ],
      meta: [
        {
          name: "color-scheme",
          content: "light dark"
        }
      ]
    }
  },
  runtimeConfig: {
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || "https://voxjong.com",
      voxjongVersion: voxjongVersion()
    }
  },
  devtools: {
    enabled: false
  }
})
