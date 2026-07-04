import { computed, type Ref } from "vue";

const pageTitle = "VoxJong - CSS Mahjong Solitaire";
const pageDescription = "Play VoxJong, a free CSS Mahjong Solitaire.";
const defaultThemeColor = "#165930";

type VoxjongSeoOptions = {
  themeColor?: Ref<string> | string;
};

export function useVoxjongSeo(
  socialCardUrl: string,
  options: VoxjongSeoOptions = {}
): void {
  const route = useRoute();
  const runtimeConfig = useRuntimeConfig();
  const siteUrl = computed(() => {
    const raw =
      (runtimeConfig.public.siteUrl as string | undefined)?.trim() ?? "";
    return raw ? raw.replace(/\/+$/, "") : "";
  });
  const canonicalUrl = computed(() => {
    if (!siteUrl.value) {
      return undefined;
    }
    const path = route.path === "/" ? "" : route.path;
    return `${siteUrl.value}${path}`;
  });
  const socialImageUrl = computed(() => {
    if (
      socialCardUrl.startsWith("http://") ||
      socialCardUrl.startsWith("https://")
    ) {
      return socialCardUrl;
    }
    return siteUrl.value ? `${siteUrl.value}${socialCardUrl}` : socialCardUrl;
  });
  const jsonLd = computed(() => ({
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: "VoxJong",
    description: pageDescription,
    applicationCategory: "Game",
    genre: "Mahjong Solitaire",
    operatingSystem: "Any",
    ...(canonicalUrl.value ? { url: canonicalUrl.value } : {}),
  }));
  const themeColor = computed(() => {
    if (!options.themeColor) {
      return defaultThemeColor;
    }
    return typeof options.themeColor === "string"
      ? options.themeColor
      : options.themeColor.value;
  });

  useSeoMeta({
    title: pageTitle,
    description: pageDescription,
    robots:
      "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",
    ogTitle: pageTitle,
    ogDescription: pageDescription,
    ogType: "website",
    ogSiteName: "VoxJong",
    ogUrl: () => canonicalUrl.value,
    ogImage: () => socialImageUrl.value,
    twitterCard: "summary_large_image",
    twitterTitle: pageTitle,
    twitterDescription: pageDescription,
    twitterImage: () => socialImageUrl.value,
  });

  useHead(() => ({
    link: canonicalUrl.value
      ? [{ rel: "canonical", href: canonicalUrl.value }]
      : [],
    meta: [
      {
        key: "theme-color",
        name: "theme-color",
        content: themeColor.value,
      },
    ],
    script: [
      {
        key: "voxjong-jsonld",
        type: "application/ld+json",
        children: JSON.stringify(jsonLd.value),
      },
    ],
  }));
}
