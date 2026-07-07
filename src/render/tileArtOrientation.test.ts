import { describe, expect, it } from "vitest";
import {
  defaultTileArtTransform,
  majorityTileTopArtBasis,
  parseCssTransform2dBasis,
  tileArtTransformForBasis,
  tileTopArtBasisKey,
} from "./tileArtOrientation";

describe("tile top art orientation", () => {
  it("extracts the local 2D basis from PolyCSS matrix3d transforms", () => {
    const basis = parseCssTransform2dBasis(
      "matrix3d(0, 0.781, 0, 0, -0.781, 0, 0, 0, 0, 0, 1, 0, -175, -350, 25, 1)"
    );

    expect(basis).not.toBeNull();
    expect(tileTopArtBasisKey(basis!)).toBe("0.000,1.000,-1.000,0.000");
  });

  it("extracts the local 2D basis from CSS matrix transforms", () => {
    const basis = parseCssTransform2dBasis("matrix(0, 2, -2, 0, 10, 20)");

    expect(basis).not.toBeNull();
    expect(tileTopArtBasisKey(basis!)).toBe("0.000,1.000,-1.000,0.000");
  });

  it("uses the default compensation for missing or invalid bases", () => {
    const basis = parseCssTransform2dBasis("matrix(0, 1, -1, 0, 0, 0)");

    expect(tileArtTransformForBasis(null, basis)).toBe(defaultTileArtTransform);
    expect(tileArtTransformForBasis(basis, null)).toBe(defaultTileArtTransform);
    expect(parseCssTransform2dBasis("none")).toBeNull();
    expect(parseCssTransform2dBasis("rotate(180deg)")).toBeNull();
  });

  it("keeps the majority orientation equivalent to the old 180 degree art rotation", () => {
    const basis = parseCssTransform2dBasis("matrix(0, 1, -1, 0, 0, 0)");

    expect(tileArtTransformForBasis(basis, basis)).toBe(
      "matrix(-1, 0, 0, -1, 0, 0)"
    );
  });

  it("returns an identity compensation for a half-turned outlier", () => {
    const reference = parseCssTransform2dBasis("matrix(0, 1, -1, 0, 0, 0)");
    const outlier = parseCssTransform2dBasis("matrix(0, -1, 1, 0, 0, 0)");

    expect(tileArtTransformForBasis(outlier, reference)).toBe(
      "matrix(1, 0, 0, 1, 0, 0)"
    );
  });

  it("returns a reflection compensation for the Firefox post-removal basis", () => {
    const reference = parseCssTransform2dBasis("matrix(0, 1, -1, 0, 0, 0)");
    const reflected = parseCssTransform2dBasis("matrix(0, 1, 1, 0, 0, 0)");

    expect(tileArtTransformForBasis(reflected, reference)).toBe(
      "matrix(-1, 0, 0, 1, 0, 0)"
    );
  });

  it("chooses the majority basis instead of the first basis", () => {
    const outlier = parseCssTransform2dBasis("matrix(0, 1, 1, 0, 0, 0)");
    const majority = parseCssTransform2dBasis("matrix(0, 1, -1, 0, 0, 0)");

    expect(
      tileTopArtBasisKey(majorityTileTopArtBasis([outlier, majority, majority])!)
    ).toBe("0.000,1.000,-1.000,0.000");
  });
});
