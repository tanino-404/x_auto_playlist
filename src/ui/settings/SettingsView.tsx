// Settings screen shown inside the side panel (F-15, requirements §5 S-01..S-21).
// Labels come from the i18n dictionary (F-60); the language row (S-21) is first.
// Reads and writes store.settings directly; persistence is handled by the store.
// Every row carries data-setting="<Settings key>" for the audit.
import type { ComponentChildren } from "preact";
import { type MessageKey, t } from "@/lib/i18n";
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

/**
 * Values offered per choice setting, in display order. Labels come from the dictionary as
 * "settings.<key>.<value>" (F-60), so they follow the UI language.
 */
const CHOICES: { [K in ChoiceKey]: ReadonlyArray<Settings[K]> } = {
  language: ["auto", "ja", "en"],
  mode: ["auto", "manual"],
  theme: ["light", "dark", "system"],
  defaultQuality: ["auto", "highest", "lowest"],
  prefetch: ["off", "next", "both"],
  scrollPace: ["slow", "normal", "fast"],
  defaultLoop: ["all", "one", "off"],
  playedHandling: ["keep", "dim", "remove"],
};

function choiceLabel(key: ChoiceKey, value: string): string {
  return t(`settings.${key}.${value}` as MessageKey);
}

function settingLabel(key: keyof Settings): string {
  return t(`settings.${key}.label` as MessageKey);
}

const HOTKEYS: ReadonlyArray<readonly [string, MessageKey]> = [
  ["Space", "settings.hotkeys.playPause"],
  ["← →", "settings.hotkeys.seek"],
  ["Shift + ← →", "settings.hotkeys.prevNext"],
  ["↑ ↓", "settings.hotkeys.volume"],
  ["F", "settings.hotkeys.fullscreen"],
  ["M", "settings.hotkeys.mute"],
  ["L", "settings.hotkeys.loop"],
  ["S", "settings.hotkeys.shuffle"],
  ["P", "settings.hotkeys.pip"],
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

  const select = <K extends ChoiceKey>(key: K, disabled?: boolean) => {
    const label = settingLabel(key);
    return (
      <Row setting={key} label={label} htmlFor={id(key)} disabled={disabled}>
        <select
          id={id(key)}
          class="xap-settings__select"
          aria-label={label}
          disabled={disabled}
          value={settings[key]}
          onChange={(event) => {
            const value = (event.currentTarget as HTMLSelectElement).value;
            const choice = CHOICES[key].find((candidate) => candidate === value);
            if (choice !== undefined) {
              update({ [key]: choice } as Partial<Settings>);
            }
          }}
        >
          {CHOICES[key].map((choice) => (
            <option key={choice} value={choice}>
              {choiceLabel(key, choice)}
            </option>
          ))}
        </select>
      </Row>
    );
  };

  const toggle = (
    key: ToggleKey,
    note?: ComponentChildren,
    label: string = settingLabel(key),
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
    opts: { min: number; max: number; step: number; unit: string; disabled?: boolean },
  ) => {
    // defaultVolume is stored as 0..1 but edited as 0..100 %.
    const label = settingLabel(key);
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
          aria-label={t("settings.numberInput", { label })}
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
          aria-label={t("settings.back.label")}
          title={t("settings.back.label")}
          onClick={onBack}
        >
          <ChevronLeftIcon size={16} />
          {t("settings.back")}
        </button>
        <span class="xap-settings__title">{t("settings.title")}</span>
      </div>
      <div class="xap-settings__list">
        {select("language")}
        {select("mode")}
        {select("theme")}
        {toggle("includeImages")}
        {range("imageDurationSec", {
          min: 1,
          max: 20,
          step: 1,
          unit: t("settings.unit.seconds"),
          disabled: !settings.includeImages,
        })}
        {select("defaultQuality")}
        {toggle("hoverPreview")}
        {select("prefetch")}
        {toggle("autoScroll")}
        {select("scrollPace", !settings.autoScroll)}
        {range("defaultVolume", { min: 0, max: 100, step: 5, unit: "%" })}
        {select("defaultLoop")}
        {toggle("pauseSiteVideos")}
        {toggle("dedupe")}
        {toggle(
          "hotkeys",
          <dl class="xap-settings__keys" aria-label={t("settings.hotkeys.list")}>
            {HOTKEYS.map(([key, action]) => (
              <div key={key} class="xap-settings__key-row">
                <dt>
                  <kbd>{key}</kbd>
                </dt>
                <dd>{t(action)}</dd>
              </div>
            ))}
          </dl>,
        )}
        {select("playedHandling")}
        {toggle(
          "postActions",
          t("settings.postActions.note"),
          t("settings.postActions.label"),
          t("settings.postActions.aria"),
        )}
      </div>
    </div>
  );
}
