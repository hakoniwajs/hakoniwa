// Perl 版 Map.pm tempOwner/tempCommand の移植。tmp/14-users-auth.md によりパスワード欄を撤去し、
// 名前変更フォーム (旧 POST /settings) をこの画面に統合した (GameService.changeName は
// actor 自身の島にしか効かないため、URL/フォームに islandId を含める必要がなくなったため)。
import type { GameConfig } from "../../core/config.ts";
import { commandList } from "../../core/constants.ts";
import type { FormattedCommand } from "../../core/commands/format.ts";
import { formatDateTime } from "../../app/timezone.ts";
import type { IslandSelectVM, OwnerPageVM } from "../../app/view-models.ts";
import { buildMoneyDisplay } from "../../app/view-models.ts";
import { IslandInfo } from "./island-info.tsx";
import { IslandMap } from "./island-map.tsx";
import { LbbsContents, LbbsDeleteForm, LbbsHead, LbbsInput } from "./lbbs.tsx";
import { LogList } from "./logs.tsx";
import { Notice } from "./messages.tsx";

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** 計画の費用表示。「無料」「n億円」「n00トン」。Perl 版 tempOwner のコスト表示部分。 */
function costLabel(cost: number, config: GameConfig): string {
  if (cost === 0) {
    return "無料";
  }
  if (cost < 0) {
    return `${-cost}${config.units.food}`;
  }
  return `${cost}${config.units.money}`;
}

/** 計画入力フォーム。Perl 版 tempOwner のフォーム部分。 */
function CommandForm({
  config,
  defaults,
  targets,
  gameId,
  csrfToken,
}: {
  config: GameConfig;
  defaults: OwnerPageVM["defaults"];
  targets: readonly IslandSelectVM[];
  gameId: number;
  csrfToken: string;
}) {
  return (
    <form action={`/games/${gameId}/my-island/commands`} method="post">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="submit" value="計画送信" />
      <hr />
      計画番号
      <br />
      <select name="number">
        {range(config.commandMax).map((i) => (
          <option value={i} key={i}>
            {i + 1}
          </option>
        ))}
      </select>
      <hr />
      開発計画
      <br />
      <select name="kind">
        {commandList.map((spec) => (
          <option value={spec.kind} key={spec.kind} selected={spec.kind === defaults.kind}>
            {spec.name}({costLabel(spec.cost, config)})
          </option>
        ))}
      </select>
      <hr />
      座標(
      <select name="x">
        {range(config.islandSize).map((i) => (
          <option value={i} key={i} selected={i === defaults.pointX}>
            {i}
          </option>
        ))}
      </select>
      、
      <select name="y">
        {range(config.islandSize).map((i) => (
          <option value={i} key={i} selected={i === defaults.pointY}>
            {i}
          </option>
        ))}
      </select>
      )
      <hr />
      数量
      <select name="amount">
        {range(100).map((i) => (
          <option value={i} key={i}>
            {i}
          </option>
        ))}
      </select>
      <hr />
      目標の島
      <br />
      <select name="target">
        {targets.map((island) => (
          <option
            value={island.id}
            key={island.id}
            selected={island.id === defaults.targetIslandId}
          >
            {island.name}島
          </option>
        ))}
      </select>
      <hr />
      動作
      <br />
      <input type="radio" name="mode" value="insert" checked />
      挿入
      <input type="radio" name="mode" value="write" />
      上書き
      <br />
      <input type="radio" name="mode" value="delete" />
      削除
      <hr />
      <input type="submit" value="計画送信" />
    </form>
  );
}

/**
 * 入力済み計画 1 件の表示。Perl 版 tempCommand。
 * `data-number` は 0 始まりの欄番号 (owner.js が `<select name="number">` を書き換えるのに使う。
 * Perl 版 ns(x) と同じく 0 始まり。表示用の `command.number` は "01：" 形式の文字列なので別物)。
 */
function CommandLine({ index, command }: { index: number; command: FormattedCommand }) {
  return (
    <div class="command-line">
      <a href="#" data-number={index} class="command-number">
        {command.number}
      </a>
      <span class="command-name">{command.text}</span>
      <br />
    </div>
  );
}

/**
 * 「島を放棄する」節。tmp/19-abandon.md「画面」節: 開発画面の最下部に置く。
 * 残り 0 回なら説明だけ表示しフォームは出さない。
 */
function AbandonSection({
  remaining,
  gameId,
  csrfToken,
}: {
  remaining: number;
  gameId: number;
  csrfToken: string;
}) {
  return (
    <>
      <hr />
      <h1>島を放棄する</h1>
      <p>
        島を放棄すると、住民が0人になり無人島として攻撃などの対象にならなくなります。放棄後は
        「新しい島を探す」からすぐに新しい島を発見できます。放棄は1ゲームにつき3回まで行えます (残り
        {remaining}回)。
      </p>
      {remaining > 0 ? (
        <form action={`/games/${gameId}/my-island/abandon`} method="post">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <label>
            <input type="checkbox" name="confirm" />
            本当に放棄する
          </label>
          <br />
          <input type="submit" value="島を放棄する" />
        </form>
      ) : (
        ""
      )}
    </>
  );
}

/** 名前変更フォーム。旧 POST /settings をこの画面に統合したもの。 */
function NameChangeForm({
  costChangeName,
  unit,
  gameId,
  csrfToken,
}: {
  costChangeName: number;
  unit: string;
  gameId: number;
  csrfToken: string;
}) {
  return (
    <form action={`/games/${gameId}/my-island/name`} method="post">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <p>
        (注意)名前の変更には{costChangeName}
        {unit}かかります。
      </p>
      どんな名前に変えますか？
      <br />
      <input type="text" name="name" size={32} maxlength={32} />島
      <br />
      <input type="submit" value="変更する" />
    </form>
  );
}

export interface MyIslandPageProps {
  vm: OwnerPageVM;
  config: GameConfig;
  /** 「目標の島」セレクト用の島一覧。 */
  targets: readonly IslandSelectVM[];
  csrfToken: string;
  notice?: string;
  timezone: string;
  /** ローカル掲示板を表示するか (サイト設定)。 */
  useLbbs: boolean;
}

/** 開発画面。Perl 版 tempOwner + tempLbbs* + tempRecent(1)。旧 web/views/owner.tsx。 */
export function MyIslandPage({
  vm,
  config,
  targets,
  csrfToken,
  notice,
  timezone,
  useLbbs,
}: MyIslandPageProps) {
  // tmp/18-games.md「表示」節: コメント・名前変更・計画登録は現在のゲームかつ終了していないときだけ
  // (tmp/16-season.md「開始前の状態 (追加要件)」節: 開始前でも許可する。計画登録も含む)。
  const writable = vm.game.isCurrent && vm.season.state !== "finished";
  // tmp/18-games.md「GameService」節: 記帳は現在のゲームであれば終了後も可、過去のゲームは不可。
  const lbbsWritable = vm.game.isCurrent;
  return (
    <div class="owner-page">
      {/* 座標選択の補助スクリプト (この画面だけで読み込む)。 */}
      <script src="/owner.js" defer></script>
      {notice !== undefined ? <Notice message={notice} /> : ""}
      <p class="big">
        <span class="island-name">{vm.name}島</span>開発計画
      </p>

      <div class="table-scroll">
        <IslandInfo detail={vm} money={buildMoneyDisplay(vm.money, config, true)} config={config} />
      </div>

      {!writable ? <Notice message="ゲームは終了しました。" /> : ""}

      <hr />
      <h1>開発計画</h1>
      <div class="owner-layout">
        <div class="owner-map-col">
          <IslandMap
            terrain={vm.terrain}
            mode="owner"
            turn={vm.turn}
            config={config}
            commands={vm.rawCommands}
          />
        </div>
        {writable ? (
          <div class="owner-form-col">
            {vm.season.state === "before" ? (
              <p class="small">
                ゲーム開始 ({formatDateTime(vm.season.startAt, timezone)}) 時に実行されます。
              </p>
            ) : (
              ""
            )}
            <CommandForm
              config={config}
              defaults={vm.defaults}
              targets={targets}
              gameId={vm.game.id}
              csrfToken={csrfToken}
            />
          </div>
        ) : (
          ""
        )}
        <div class="owner-commands-col">
          {vm.commands.map((command, index) => (
            <CommandLine index={index} command={command} key={index} />
          ))}
        </div>
      </div>

      {writable ? (
        <>
          <hr />
          <h1>コメント更新</h1>
          <form action={`/games/${vm.game.id}/my-island/comment`} method="post">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="text" name="message" size={80} placeholder="コメント" />
            <input type="submit" value="コメント更新" />
          </form>

          <hr />
          <h1>名前の変更</h1>
          <NameChangeForm
            costChangeName={config.costChangeName}
            unit={config.units.money}
            gameId={vm.game.id}
            csrfToken={csrfToken}
          />
        </>
      ) : (
        ""
      )}

      {useLbbs ? (
        <>
          <hr />
          <LbbsHead islandName={vm.name} />
          {lbbsWritable ? (
            <>
              <LbbsInput islandId={vm.id} gameId={vm.game.id} csrfToken={csrfToken} />
              <LbbsDeleteForm gameId={vm.game.id} lbbsMax={config.lbbsMax} csrfToken={csrfToken} />
            </>
          ) : (
            <p>過去のゲームのため記帳できません。</p>
          )}
          <div class="table-scroll">
            <LbbsContents posts={vm.lbbs} />
          </div>
        </>
      ) : (
        ""
      )}

      <hr />
      <p class="big">
        <span class="island-name">{vm.name}島</span>の近況
      </p>
      <LogList logs={vm.logs} />

      {writable ? (
        <AbandonSection
          remaining={vm.abandon.remaining}
          gameId={vm.game.id}
          csrfToken={csrfToken}
        />
      ) : (
        ""
      )}
    </div>
  );
}
