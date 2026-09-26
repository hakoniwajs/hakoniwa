// Perl 版 Map.pm islandMap の移植。
// 1 ヘックスの画像・説明文の決定 (観光者への偽装、怪獣の硬化画像) は core/tile.ts の tileFor が
// 行う (tmp/17-ogp.md。OGP 画像生成と表示で同じ画像選択ロジックを共用するため)。
import type { GameConfig } from "../../core/config.ts";
import { CommandKind, commandSpecs } from "../../core/constants.ts";
import { tileFor } from "../../core/tile.ts";
import type { Command, Terrain } from "../../core/types.ts";

export type IslandMapMode = "visitor" | "owner";

export interface IslandMapProps {
  terrain: Terrain;
  mode: IslandMapMode;
  /** isHardened (怪獣の硬化判定) に使う現在のターン。 */
  turn: number;
  config: GameConfig;
  /** owner モードのみ使用。座標付きの計画をヘックスの表示に重ねる (Perl 版 comStr)。 */
  commands?: readonly Command[];
}

/** 座標ごとの計画ラベル文字列 (例: " [1]整地 [3]伐採")。Perl 版 ownerMain の comStr 組み立て。 */
function buildCommandLabels(commands: readonly Command[] | undefined, size: number): string[][] {
  const labels: string[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ""),
  );
  if (commands === undefined) {
    return labels;
  }
  commands.forEach((command, index) => {
    // Perl 版: kind < 20 (座標付きの土地系計画) のみ地図に重ねる。
    if (command.kind >= 20) {
      return;
    }
    const spec = commandSpecs[command.kind as CommandKind];
    if (spec === undefined) {
      return;
    }
    const row = labels[command.y];
    if (row === undefined || command.x < 0 || command.x >= row.length) {
      return;
    }
    row[command.x] = `${row[command.x] ?? ""} [${index + 1}]${spec.name}`;
  });
  return labels;
}

/** 島の地図。Perl 版 islandMap。 */
export function IslandMap({ terrain, mode, turn, config, commands }: IslandMapProps) {
  const size = terrain.size;
  const labels = buildCommandLabels(mode === "owner" ? commands : undefined, size);
  const rows = Array.from({ length: size }, (_, y) => y);
  const cols = Array.from({ length: size }, (_, x) => x);

  return (
    <div class="map">
      <img src="/images/xbar.gif" class="xbar" width={400} height={16} />
      <br />
      {rows.map((y) => (
        <div class="map-row" key={y}>
          {y % 2 === 0 ? (
            <img src={`/images/space${y}.gif`} class="space" width={16} height={32} />
          ) : (
            ""
          )}
          {cols.map((x) => {
            const hex = terrain.get(x, y);
            const { image, alt } = tileFor(hex, mode, turn, config);
            const label = labels[y]?.[x] ?? "";
            const tooltip = `(${x},${y}) ${alt} ${label}`;
            const cell = (
              <img
                src={`/images/${image}`}
                alt={tooltip}
                title={tooltip}
                class="cell"
                width={32}
                height={32}
              />
            );
            return mode === "owner" ? (
              <a href="#" class="map-cell" data-x={x} data-y={y}>
                {cell}
              </a>
            ) : (
              cell
            );
          })}
          {y % 2 === 1 ? (
            <img src={`/images/space${y}.gif`} class="space" width={16} height={32} />
          ) : (
            ""
          )}
          <br />
        </div>
      ))}
    </div>
  );
}
