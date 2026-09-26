// Perl 版 Map.pm landString の移植。
// web/views/island-map.tsx の cellView をここに移し、視覚表現 (観光者への偽装、怪獣の硬化画像)
// を view と OGP 画像生成 (ogp/render.ts) の両方で共用する。tmp/17-ogp.md 「実装の置き場所」節。
import type { GameConfig } from "./config.ts";
import { LandKind, monsters, monuments } from "./constants.ts";
import { expToLevel, isHardened, monsterSpec } from "./terrain.ts";
import type { Hex } from "./types.ts";

export type TileMode = "visitor" | "owner";

export interface TileView {
  image: string;
  alt: string;
}

/**
 * 1 ヘックスの画像・説明文を決める。Perl 版 landString。
 *
 * 森の本数・町の人口・基地の経験値など説明文 (alt) の一部は config.units に依存するため、
 * config を 4 番目の引数として受け取る。
 */
export function tileFor(hex: Hex, mode: TileMode, turn: number, config: GameConfig): TileView {
  const { kind, value } = hex;
  switch (kind) {
    case LandKind.Sea:
      return value === 1
        ? { image: "land14.gif", alt: "海(浅瀬)" }
        : { image: "land0.gif", alt: "海" };
    case LandKind.Waste:
      return value === 1
        ? { image: "land13.gif", alt: "荒地" }
        : { image: "land1.gif", alt: "荒地" };
    case LandKind.Plains:
      return { image: "land2.gif", alt: "平地" };
    case LandKind.Forest:
      return mode === "owner"
        ? { image: "land6.gif", alt: `森(${value}${config.units.tree})` }
        : { image: "land6.gif", alt: "森" };
    case LandKind.Town: {
      let p: number;
      let n: string;
      if (value < 30) {
        p = 3;
        n = "村";
      } else if (value < 100) {
        p = 4;
        n = "町";
      } else {
        p = 5;
        n = "都市";
      }
      return { image: `land${p}.gif`, alt: `${n}(${value}${config.units.pop})` };
    }
    case LandKind.Farm:
      return { image: "land7.gif", alt: `農場(${value}0${config.units.pop}規模)` };
    case LandKind.Factory:
      return { image: "land8.gif", alt: `工場(${value}0${config.units.pop}規模)` };
    case LandKind.Base:
      if (mode === "visitor") {
        // 観光者の場合は森のふり。
        return { image: "land6.gif", alt: "森" };
      }
      return {
        image: "land9.gif",
        alt: `ミサイル基地 (レベル ${expToLevel(LandKind.Base, value, config)}/経験値 ${value})`,
      };
    case LandKind.Sbase:
      if (mode === "visitor") {
        // 観光者の場合は海のふり。
        return { image: "land0.gif", alt: "海" };
      }
      return {
        image: "land12.gif",
        alt: `海底基地 (レベル ${expToLevel(LandKind.Sbase, value, config)}/経験値 ${value})`,
      };
    case LandKind.Defence:
      return { image: "land10.gif", alt: "防衛施設" };
    case LandKind.Haribote:
      // 観光者の場合は防衛施設のふり。
      return { image: "land10.gif", alt: mode === "visitor" ? "防衛施設" : "ハリボテ" };
    case LandKind.Oil:
      return { image: "land16.gif", alt: "海底油田" };
    case LandKind.Mountain:
      return value > 0
        ? { image: "land15.gif", alt: `山(採掘場${value}0${config.units.pop}規模)` }
        : { image: "land11.gif", alt: "山" };
    case LandKind.Monument: {
      const monument = monuments[value];
      return { image: monument?.image ?? "monument0.gif", alt: monument?.name ?? "" };
    }
    case LandKind.Monster: {
      const { kind: monsterKind, name, hp } = monsterSpec(value);
      const spec = monsters[monsterKind];
      const hardened = isHardened(monsterKind, turn);
      const image = (hardened ? spec?.hardenedImage : undefined) ?? spec?.image ?? "land0.gif";
      return { image, alt: `怪獣${name}(体力${hp})` };
    }
    default:
      return { image: "land0.gif", alt: "" };
  }
}
