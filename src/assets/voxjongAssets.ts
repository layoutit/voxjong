import {
  requiredTileNames,
  type TileCode,
} from "../game/mahjong";

const imageModules = import.meta.glob("./*.png", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const loadedTextures = Object.fromEntries(
  Object.entries(imageModules).map(([path, url]) => [
    path.split("/").pop()?.replace(".png", "") ?? path,
    url,
  ])
) as Record<string, string>;

const missingTileNames = requiredTileNames.filter(
  (name) => !loadedTextures[name]
);
if (missingTileNames.length > 0) {
  throw new Error(`Missing tile images: ${missingTileNames.join(", ")}`);
}

export const tileTextures = loadedTextures as Record<TileCode, string> &
  Record<string, string>;

export const logoUrl = imageModules["./voxjong-logo.png"];
export const socialCardUrl = imageModules["./voxjong-social.png"];

if (!logoUrl) {
  throw new Error("Missing VoxJong logo image.");
}

if (!socialCardUrl) {
  throw new Error("Missing VoxJong social image.");
}
