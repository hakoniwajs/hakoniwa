// tmp/17-ogp.md 「画像仕様」節。800x420 (OGP 推奨比率 1.91:1)、背景 #EEFFFF、
// 400x384 の地図を中央に等倍で配置する。地形の画像選択は core/tile.ts の tileFor
// (visitor モード。観光者への偽装、怪獣の硬化画像を含む) を表示画面と共用する。
import { defaultConfig } from "../core/config.ts";
import { tileFor } from "../core/tile.ts";
import type { Island } from "../core/types.ts";
import { encodePng } from "./png.ts";
import { tiles as generatedTiles } from "./tiles.generated.ts";
import type { GeneratedTile } from "./tiles.generated.ts";

export const OGP_WIDTH = 800;
export const OGP_HEIGHT = 420;

/** 画面の背景色 #EEFFFF。 */
const BACKGROUND_RGB: readonly [number, number, number] = [0xee, 0xff, 0xff];

const TILE_SIZE = 32;
const HALF_TILE = 16;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function fillBackground(rgb: Uint8Array): void {
  const [r, g, b] = BACKGROUND_RGB;
  for (let i = 0; i < rgb.length; i += 3) {
    rgb[i] = r;
    rgb[i + 1] = g;
    rgb[i + 2] = b;
  }
}

/**
 * 1 タイル (32x32) を `rgb` バッファへ転写する。透明インデックスのピクセルは背景を残す
 * (書き換えない)。テスト用に export する (実際のタイル画像は透明色を含まないため、
 * render.test.ts では合成した GeneratedTile を使ってこの関数を直接検証する)。
 */
export function blitTile(
  rgb: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  destX: number,
  destY: number,
  tile: GeneratedTile,
): void {
  const indices = base64ToBytes(tile.data);
  for (let ty = 0; ty < tile.h; ty++) {
    const py = destY + ty;
    if (py < 0 || py >= canvasHeight) {
      continue;
    }
    for (let tx = 0; tx < tile.w; tx++) {
      const px = destX + tx;
      if (px < 0 || px >= canvasWidth) {
        continue;
      }
      const index = indices[ty * tile.w + tx] ?? 0;
      if (index === tile.transparent) {
        continue;
      }
      const paletteOffset = index * 3;
      const r = tile.palette[paletteOffset] ?? 0;
      const g = tile.palette[paletteOffset + 1] ?? 0;
      const b = tile.palette[paletteOffset + 2] ?? 0;
      const canvasOffset = (py * canvasWidth + px) * 3;
      rgb[canvasOffset] = r;
      rgb[canvasOffset + 1] = g;
      rgb[canvasOffset + 2] = b;
    }
  }
}

/**
 * 島の地図を敷き詰めた OGP 画像 (PNG) を生成する。tmp/17-ogp.md 「画像仕様」節。
 *
 * tileFor は GameConfig を要求するが、visitor モードでの image (画像名) 選択には config の値は影響しない
 * (config は説明文 (alt) にのみ使われる。core/tile.ts のコメント参照) ため、ここでは
 * defaultConfig を渡す。
 */
export async function renderIslandOgp(island: Island, turn: number): Promise<Uint8Array> {
  const rgb = new Uint8Array(OGP_WIDTH * OGP_HEIGHT * 3);
  fillBackground(rgb);

  const terrain = island.terrain;
  const size = terrain.size;
  const mapWidth = size * TILE_SIZE + HALF_TILE;
  const mapHeight = size * TILE_SIZE;
  const offsetX = Math.floor((OGP_WIDTH - mapWidth) / 2);
  const offsetY = Math.floor((OGP_HEIGHT - mapHeight) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hex = terrain.get(x, y);
      const { image } = tileFor(hex, "visitor", turn, defaultConfig);
      const tile = generatedTiles[image];
      if (tile === undefined) {
        // 生成スクリプトが取りこぼした image 名。表示は乱れるが例外にはしない。
        continue;
      }
      const destX = offsetX + x * TILE_SIZE + (y % 2 === 1 ? HALF_TILE : 0);
      const destY = offsetY + y * TILE_SIZE;
      blitTile(rgb, OGP_WIDTH, OGP_HEIGHT, destX, destY, tile);
    }
  }

  return encodePng(OGP_WIDTH, OGP_HEIGHT, rgb);
}
