// Settings screen shown inside the side panel (F-15, requirements §5 S-01..S-20).
// Reads and writes store.settings directly; persistence is handled by the store.
// Every row carries data-setting="<Settings key>" for the audit.
import type { ComponentChildren } from "preact";
import type { Store } from "@/lib/store";
import type { Settings } from "@/shared/types";
import { ChevronLeftIcon } from "@/ui/components/icons";
import "@/ui/settings/settings.css";

export interface SettingsViewProps {
  store: Store;
  onBack: () => void;
}

type ChoiceKey = {
  [K in keyof Settings]: Settings[K] extends string ? K : never;
}[keyof Settings];
type ToggleKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

interface Choice<V extends string> {
  value: V;
  label: string;
}

const CHOICES: { [K in ChoiceKey]: ReadonlyArray<Choice<Settings[K]>> } = {
  mode: [
    { value: "auto", label: "自動" },
    { value: "manual", label: "手動" },
  ],
  theme: [
    { value: "light", label: "ライト" },
    { value: "dark", label: "ダーク" },
    { value: "system", label: "システムに従う" },
  ],
  defaultQuality: [
    { value: "auto", label: "自動" },
    { value: "highest", label: "最高" },
    { value: "lowest", label: "最低" },
  ],
  prefetch: [
    { value: "off", label: "オフ" },
    { value: "next", label: "次の 1 件" },
    { value: "both", label: "前後 1 件" },
  ],
  scrollPace: [
    { value: "slow", label: "ゆっくり" },
    { value: "normal", label: "普通" },
  ],
  defaultLoop: [
    { value: "all", label: "すべて" },
    { value: "one", label: "1 件" },
    { value: "off", label: "なし" },
  ],
  playedHandling: [
    { value: "keep", label: "残す" },
    { value: "dim", label: "薄く表示" },
    { value: "remove", label: "自動で消す" },
  ],
};

const HOTKEYS: ReadonlyArray<readonly [string, string]> = [
  ["Space", "再生／停止"],
  ["← →", "5 秒戻る／進む"],
  ["Shift + ← →", "前／次"],
  ["↑ ↓", "音量"],
  ["F", "全画面"],
  ["M", "ミュート"],
  ["L", "ループ"],
  ["S", "シャッフル"],
  ["P", "ピクチャ・イン・ピクチャ"],
];

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

interface RowProps {
  setting: keyof Settings;
  label: string;
  htmlFor: string;
  disabled?: boolean;
  children: ComponentChildren;
  note?: ComponentChildren;
}

function Row({ setting, label, htmlFor, disabled, children, note }: RowProps) {
  return (
    <div
      class="xap-settings__row"
      data-setting={setting}
      data-disabled={disabled ? "true" : undefined}
    >
      <label class="xap-settings__label" for={htmlFor}>
        {label}
      </label>
      <div class="xap-settings__control">{children}</div>
      {note && <div class="xap-settings__note">{note}</div>}
    </div>
  );
}

export function SettingsView({ store, onBack }: SettingsViewProps) {
  const settings = store.settings.value;
  const update = (patch: Partial<Settings>) => store.updateSettings(patch);
  const id = (key: keyof Settings) => `xap-setting-${key}`;

  const select = <K extends ChoiceKey>(key: K, label: string, disabled?: boolean) => (
    <Row setting={key} label={label} htmlFor={id(key)} disabled={disabled}>
      <select
        id={id(key)}
        class="xap-settings__select"
        aria-label={label}
        disabled={disabled}
        value={settings[key]}
        onChange={(event) => {
          const value = (event.currentTarget as HTMLSelectElement).value;
          const choice = CHOICES[key].find((candidate) => candidate.value === value);
          if (choice !== undefined) {
            update({ [key]: choice.value } as Partial<Settings>);
          }
        }}
      >
        {CHOICES[key].map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </Row>
  );

  const toggle = (
    key: ToggleKey,
    label: string,
    note?: ComponentChildren,
    ariaLabel: string = label,
  ) => (
    <Row setting={key} label={label} htmlFor={id(key)} note={note}>
      <input
        id={id(key)}
        type="checkbox"
        role="switch"
        class="xap-settings__switch"
        aria-label={ariaLabel}
        aria-checked={settings[key]}
        checked={settings[key]}
        onChange={(event) =>
          update({ [key]: (event.currentTarget as HTMLInputElement).checked } as Partial<Settings>)
        }
      />
    </Row>
  );

  const range = (
    key: "imageDurationSec" | "defaultVolume",
    label: string,
    opts: { min: number; max: number; step: number; unit: string; disabled?: boolean },
  ) => {
    // defaultVolume is stored as 0..1 but edited as 0..100 %.
    const scale = key === "defaultVolume" ? 100 : 1;
    const shown = Math.round(settings[key] * scale);
    const commit = (raw: number) => {
      if (Number.isNaN(raw)) {
        return;
      }
      update({ [key]: clampInt(raw, opts.min, opts.max) / scale } as Partial<Settings>);
    };
    return (
      <Row setting={key} label={label} htmlFor={id(key)} disabled={opts.disabled}>
        <input
          id={id(key)}
          type="range"
          class="xap-settings__range"
          aria-label={label}
          min={opts.min}
          max={opts.max}
          step={opts.step}
          value={shown}
          disabled={opts.disabled}
          onInput={(event) => commit((event.currentTarget as HTMLInputElement).valueAsNumber)}
        />
        <input
          type="number"
          class="xap-settings__number"
          aria-label={`${label}（数値）`}
          min={opts.min}
          max={opts.max}
          step={opts.step}
          value={shown}
          disabled={opts.disabled}
          onChange={(event) => {
            const input = event.currentTarget as HTMLInputElement;
            commit(input.valueAsNumber);
            // Re-sync the text when the value was clamped (or invalid).
            input.value = String(Math.round(store.settings.peek()[key] * scale));
          }}
        />
        <span class="xap-settings__unit">{opts.unit}</span>
      </Row>
    );
  };

  return (
    <div class="xap-settings" data-xap-settings="true">
      <div class="xap-settings__head">
        <button
          type="button"
          class="xap-settings__back"
          aria-label="一覧に戻る"
          title="一覧に戻る"
          onClick={onBack}
        >
          <ChevronLeftIcon size={16} />
          戻る
        </button>
        <span class="xap-settings__title">設定</span>
      </div>
      <div class="xap-settings__list">
        {select("mode", "プレイリストモード")}
        {select("theme", "テーマ")}
        {toggle("includeImages", "画像を含める")}
        {range("imageDurationSec", "画像の表示時間", {
          min: 1,
          max: 20,
          step: 1,
          unit: "秒",
          disabled: !settings.includeImages,
        })}
        {select("defaultQuality", "標準の画質")}
        {toggle("hoverPreview", "サムネイルのホバー再生")}
        {select("prefetch", "先読み")}
        {toggle("autoScroll", "自動スクロール")}
        {select("scrollPace", "自動スクロールの速さ", !settings.autoScroll)}
        {range("defaultVolume", "既定の音量", { min: 0, max: 100, step: 5, unit: "%" })}
        {select("defaultLoop", "既定のループ")}
        {toggle("pauseSiteVideos", "再生中は X の動画を止める")}
        {toggle("dedupe", "重複メディアを除外")}
        {toggle(
          "hotkeys",
          "キーボードショートカット",
          <dl class="xap-settings__keys" aria-label="ショートカットの割り当て">
            {HOTKEYS.map(([key, action]) => (
              <div key={key} class="xap-settings__key-row">
                <dt>
                  <kbd>{key}</kbd>
                </dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>,
        )}
        {select("playedHandling", "再生済み項目の扱い")}
        {toggle(
          "postActions",
          "再生ウィンドウからの投稿操作（いいね／リポスト）",
          "いいね・リポストのボタンを出します。押したときだけ X に送信します。",
          "再生ウィンドウからの投稿操作",
        )}
      </div>
    </div>
  );
}
