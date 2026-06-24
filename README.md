# Voxjong

Voxjong is a browser-based 3D CSS Mahjong Solitaire game built with Nuxt and
VoxCSS. The board renders as DOM/CSS rather than canvas or WebGL.

Live site: https://voxjong.com

## What is here

- A Nuxt single-page game in `src/app.vue`
- Mahjong layout, deal, blocking, and pairing rules in `src/game/mahjong.ts`
- Rule-level tests in `src/game/mahjong.test.ts`
- Bundled tile, logo, and social images in `src/assets/`
- Static web metadata in `public/`

## Requirements

- Node.js 22.12.0 or newer
- npm 10 or newer

## Development

Install dependencies:

```sh
npm install
```

Run the development server:

```sh
npm run dev
```

## Commands

```sh
npm run test      # run Mahjong rule tests
npm run check     # run tests and production build
npm run generate  # generate static output in dist/
npm run audit     # fail on moderate-or-higher production advisories
npm run audit:all # include low-severity production advisories
npm run clean     # remove generated Nuxt/static output
```

## Deployment

The app is configured for static generation:

```sh
npm run generate
```

Generated output is written to `dist/`, which is ignored by Git.

## Repository Notes

`npm run audit` is the public release gate. `npm run audit:all` may report
low-severity advisories from nested build tooling even when the release gate
passes.
