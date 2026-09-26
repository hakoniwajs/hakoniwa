// tmp/17-ogp.md 「テスト」節: png.ts の PNG シグネチャ・チャンク構成・CRC・画素を検証する。
// packages/core は node:* を import できない (root vite.config.ts の lint 制約) ため、
// `node:zlib` ではなく `DecompressionStream` で展開して検証する。
import { describe, expect, it } from "vitest";
import { encodePng } from "./png.ts";

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  );
}

interface Chunk {
  type: string;
  data: Uint8Array;
}

/** PNG バイト列からチャンク一覧を読み出す (シグネチャの直後から IEND まで)。 */
function readChunks(png: Uint8Array): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = 8; // シグネチャ (8 バイト) の後
  while (offset < png.length) {
    const length = readUint32BE(png, offset) >>> 0;
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 8 + length + 4; // length + type + data + crc
  }
  return chunks;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const writeDone = writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close());
  const [buffer] = await Promise.all([new Response(stream.readable).arrayBuffer(), writeDone]);
  return new Uint8Array(buffer);
}

describe("encodePng", () => {
  it("PNG シグネチャで始まる", async () => {
    const png = await encodePng(1, 1, new Uint8Array([255, 0, 0]));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("IHDR/IDAT/IEND の順でチャンクが並ぶ", async () => {
    const width = 3;
    const height = 2;
    const png = await encodePng(width, height, new Uint8Array(width * height * 3));
    const chunks = readChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);

    const ihdr = chunks[0];
    if (ihdr === undefined) {
      throw new Error("IHDR chunk missing");
    }
    expect(readUint32BE(ihdr.data, 0)).toBe(width);
    expect(readUint32BE(ihdr.data, 4)).toBe(height);
    expect(ihdr.data[8]).toBe(8); // bit depth
    expect(ihdr.data[9]).toBe(2); // color type: RGB
    expect(ihdr.data[10]).toBe(0);
    expect(ihdr.data[11]).toBe(0);
    expect(ihdr.data[12]).toBe(0);

    expect(chunks[2]?.data.length).toBe(0); // IEND は空データ
  });

  it("画素を復元できる (DecompressionStream で inflate)", async () => {
    const width = 2;
    const height = 2;
    // 赤, 緑 / 青, 白 の 2x2。
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const png = await encodePng(width, height, rgb);
    const chunks = readChunks(png);
    const idat = chunks.find((c) => c.type === "IDAT");
    if (idat === undefined) {
      throw new Error("IDAT chunk missing");
    }
    const raw = await inflate(idat.data);
    // 各行: フィルタ種別 (0) + width*3 バイト。
    const rowBytes = width * 3 + 1;
    expect(raw.length).toBe(rowBytes * height);
    expect(raw[0]).toBe(0); // フィルタなし
    expect([...raw.subarray(1, 1 + 3)]).toEqual([255, 0, 0]); // (0,0) 赤
    expect([...raw.subarray(4, 4 + 3)]).toEqual([0, 255, 0]); // (1,0) 緑
    expect(raw[rowBytes]).toBe(0);
    expect([...raw.subarray(rowBytes + 1, rowBytes + 4)]).toEqual([0, 0, 255]); // (0,1) 青
    expect([...raw.subarray(rowBytes + 4, rowBytes + 7)]).toEqual([255, 255, 255]); // (1,1) 白
  });

  it("チャンクの CRC32 が正しい (DecompressionStream の解凍が成功する = deflate が正しいことの間接検証も兼ねる)", async () => {
    const png = await encodePng(1, 1, new Uint8Array([1, 2, 3]));
    const chunks = readChunks(png);
    // 簡易な自前 CRC32 再計算で検証する (png.ts の実装と同じ多項式)。
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    const crc32 = (bytes: Uint8Array): number => {
      let crc = 0xffffffff;
      for (const byte of bytes) {
        crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
      }
      return (crc ^ 0xffffffff) >>> 0;
    };

    let offset = 8;
    for (let i = 0; i < chunks.length; i++) {
      const length = readUint32BE(png, offset);
      const typeAndData = png.subarray(offset + 4, offset + 8 + length);
      const expectedCrc = crc32(typeAndData);
      const actualCrc = readUint32BE(png, offset + 8 + length) >>> 0;
      expect(actualCrc).toBe(expectedCrc);
      offset += 8 + length + 4;
    }
    expect(chunks.length).toBeGreaterThan(0);
  });
});
