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
          name: "theme-color",
          content: "#165930"
        }
      ]
    }
  },
  runtimeConfig: {
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || "https://voxjong.com"
    }
  },
  devtools: {
    enabled: false
  }
})
