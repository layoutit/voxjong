# Voxjong

Voxjong is a browser-based 3D CSS Mahjong Solitaire game built with Nuxt and
VoxCSS. The board renders as DOM/CSS rather than canvas or WebGL.

## Development

Install dependencies:

```sh
npm install
```

Run the development server:

```sh
npm run dev
```

Production checks:

```sh
npm run check
npm run generate
npm run audit
```

`npm run check` builds the Nuxt app. `npm run audit` fails on
moderate-or-higher findings. Use `npm run audit:all` when you want to see
low-severity advisories too.

## Assets

Bundled tile and brand images live in `src/assets/`. Public web metadata files
live in `public/`.
