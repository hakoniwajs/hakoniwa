// tmp/17-ogp.md 「テスト」節: render.ts の画素と偽装ルールを検証する。
import { describe, expect, it } from "vite-plus/test";
import { defaultConfig } from "../core/config.ts";
import { LandKind } from "../core/constants.ts";
import { makeNewIsland } from "../core/island.ts";
import { createSeededRng } from "../core/rng.ts";
import { createTerrain } from "../core/terrain.ts";
import type { Island, Terrain } from "../core/types.ts";
import { blitTile, OGP_HEIGHT, OGP_WIDTH, renderIslandOgp } from "./render.ts";
import { tiles } from "./tiles.generated.ts";
import type { GeneratedTile } from "./tiles.generated.ts";

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  );
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const writeDone = writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close());
  const [buffer] = await Promise.all([new Response(stream.readable).arrayBuffer(), writeDone]);
  return new Uint8Array(buffer);
}

/** encodePng が出力する PNG (フィルタなし、単一 IDAT) を rgb (width*height*3) に戻す。 */
async function decodePngToRgb(png: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  // シグネチャ 8 バイト → IHDR チャンク (4+4+13+4=25 バイト) → IDAT チャンク。
  const idatOffset = 8 + 25;
  const idatLength = readUint32BE(png, idatOffset);
  const idatData = png.subarray(idatOffset + 8, idatOffset + 8 + idatLength);
  const raw = await inflate(idatData);
  const rowBytes = width * 3 + 1;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes + 1; // 先頭のフィルタバイトをスキップ
    rgb.set(raw.subarray(rowStart, rowStart + width * 3), y * width * 3);
  }
  return rgb;
}

function pixelAt(rgb: Uint8Array, width: number, x: number, y: number): [number, number, number] {
  const o = (y * width + x) * 3;
  return [rgb[o] ?? 0, rgb[o + 1] ?? 0, rgb[o + 2] ?? 0];
}

/** 生成済みタイル (パレット + インデックス) から (tx,ty) の RGB を求める。 */
function tilePixel(tile: GeneratedTile, tx: number, ty: number): [number, number, number] {
  const binary = atob(tile.data);
  const index = binary.charCodeAt(ty * tile.w + tx);
  const o = index * 3;
  return [tile.palette[o] ?? 0, tile.palette[o + 1] ?? 0, tile.palette[o + 2] ?? 0];
}

function makeTestIsland(setup: (terrain: Terrain) => void): Island {
  const island = makeNewIsland(defaultConfig, createSeededRng(1), {
    id: 1,
    name: "しま",
    ownerUserId: "u1",
  });
  // makeNewLand が作るランダムな地形ではなく、全面海の空の地形から組み立てる。
  island.terrain = createTerrain(defaultConfig.islandSize);
  setup(island.terrain);
  return island;
}

function mapOffset(): { offsetX: number; offsetY: number } {
  const size = defaultConfig.islandSize;
  const mapWidth = size * 32 + 16;
  const mapHeight = size * 32;
  return {
    offsetX: Math.floor((OGP_WIDTH - mapWidth) / 2),
    offsetY: Math.floor((OGP_HEIGHT - mapHeight) / 2),
  };
}

describe("renderIslandOgp", () => {
  it("800x420 の PNG (IHDR) を返す", async () => {
    const island = makeTestIsland(() => {});
    const png = await renderIslandOgp(island, 1);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdrData = png.subarray(16, 16 + 13);
    expect(readUint32BE(ihdrData, 0)).toBe(OGP_WIDTH);
    expect(readUint32BE(ihdrData, 4)).toBe(OGP_HEIGHT);
  });

  it("地図の外側は背景色 #EEFFFF で埋まる", async () => {
    const island = makeTestIsland(() => {});
    const png = await renderIslandOgp(island, 1);
    const rgb = await decodePngToRgb(png, OGP_WIDTH, OGP_HEIGHT);
    expect(pixelAt(rgb, OGP_WIDTH, 0, 0)).toEqual([0xee, 0xff, 0xff]);
    expect(pixelAt(rgb, OGP_WIDTH, OGP_WIDTH - 1, OGP_HEIGHT - 1)).toEqual([0xee, 0xff, 0xff]);
  });

  it("平地 (0,0) がタイル画像の色で描画される", async () => {
    const island = makeTestIsland((terrain) => {
      terrain.setKind(0, 0, LandKind.Plains, 0);
    });
    const png = await renderIslandOgp(island, 1);
    const rgb = await decodePngToRgb(png, OGP_WIDTH, OGP_HEIGHT);
    const { offsetX, offsetY } = mapOffset();
    const tile = tiles["land2.gif"];
    if (tile === undefined) {
      throw new Error("land2.gif missing from generated tiles");
    }
    // (0,0) は y が偶数なので x 方向のオフセットは付かない (tmp/17-ogp.md の (x*32+(y%2)*16, y*32))。
    expect(pixelAt(rgb, OGP_WIDTH, offsetX + 1, offsetY + 1)).toEqual(tilePixel(tile, 1, 1));
  });

  it("偽装ルール: ミサイル基地は観光者には森 (land6.gif) として描画される", async () => {
    const island = makeTestIsland((terrain) => {
      terrain.setKind(0, 0, LandKind.Base, 5);
    });
    const png = await renderIslandOgp(island, 1);
    const rgb = await decodePngToRgb(png, OGP_WIDTH, OGP_HEIGHT);
    const { offsetX, offsetY } = mapOffset();
    const forestTile = tiles["land6.gif"];
    const baseTile = tiles["land9.gif"];
    if (forestTile === undefined || baseTile === undefined) {
      throw new Error("land6.gif/land9.gif missing from generated tiles");
    }
    const actual = pixelAt(rgb, OGP_WIDTH, offsetX + 16, offsetY + 16);
    expect(actual).toEqual(tilePixel(forestTile, 16, 16));
    // 実際のミサイル基地画像 (owner モード用) の色とは異なることも確認する。
    expect(actual).not.toEqual(tilePixel(baseTile, 16, 16));
  });

  it("怪獣の硬化画像はターンにより切り替わる (special=3: 奇数ターンで硬化)", async () => {
    // monsters[2] (サンジラ) は special=3 (奇数ターン硬化、monster4.gif)。
    const island = makeTestIsland((terrain) => {
      terrain.setKind(0, 0, LandKind.Monster, 2 * 10 + 1);
    });
    const { offsetX, offsetY } = mapOffset();
    const normalTile = tiles["monster5.gif"];
    const hardenedTile = tiles["monster4.gif"];
    if (normalTile === undefined || hardenedTile === undefined) {
      throw new Error("monster4.gif/monster5.gif missing from generated tiles");
    }

    const pngEven = await renderIslandOgp(island, 2);
    const rgbEven = await decodePngToRgb(pngEven, OGP_WIDTH, OGP_HEIGHT);
    expect(pixelAt(rgbEven, OGP_WIDTH, offsetX + 1, offsetY + 1)).toEqual(
      tilePixel(normalTile, 1, 1),
    );

    const pngOdd = await renderIslandOgp(island, 3);
    const rgbOdd = await decodePngToRgb(pngOdd, OGP_WIDTH, OGP_HEIGHT);
    expect(pixelAt(rgbOdd, OGP_WIDTH, offsetX + 1, offsetY + 1)).toEqual(
      tilePixel(hardenedTile, 1, 1),
    );
  });
});

describe("blitTile", () => {
  it("透明インデックスのピクセルは背景を書き換えない", () => {
    // 実タイル画像には透明色を使うものが無いため、合成した GeneratedTile で検証する。
    const tile: GeneratedTile = {
      w: 2,
      h: 1,
      palette: [10, 20, 30, 0, 0, 0],
      transparent: 1,
      data: btoa(String.fromCharCode(0, 1)), // 左: 不透明 (パレット0), 右: 透明
    };
    const rgb = new Uint8Array(2 * 1 * 3).fill(0xff);
    blitTile(rgb, 2, 1, 0, 0, tile);
    expect(pixelAt(rgb, 2, 0, 0)).toEqual([10, 20, 30]);
    expect(pixelAt(rgb, 2, 1, 0)).toEqual([0xff, 0xff, 0xff]); // 背景のまま
  });
});
