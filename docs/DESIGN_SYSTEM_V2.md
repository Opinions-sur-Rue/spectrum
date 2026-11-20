# V2 control design system

Source: `frontend/src/lib/canvas/design-system.css`. Scope: `.v2-shell` only;
v1 stays unchanged. This first pass covers controls, not a full redesign of
editor prose, opinion pellets, headings or data visualisation.

## Shared contract

- UI family: Tailwind's local system sans stack, inherited by controls and labels.
  No new font download or platform-dependent emoji as toolbar icons.
- Controls: `--v2-control-text` (12 px at default root), weight 600, line-height
  1.25. Labels inherit through `.toolbar-label`; do not add font-size utilities
  to label spans. Body text and headings keep their own hierarchy.
- Targets: 36 px minimum desktop, 44 px below 640 px, expressed in rem so browser
  font preferences scale them. Guidance triggers may keep larger targets.
  Compact note commands retain their established sizing and mobile inspector.
- Icons: bundled Iconoir, 18 px / 1.125rem by default via `Icon`; explicit sizes
  remain available for dense note metadata. Actual reaction choices stay emoji.
- Shape: shared medium radius, common gap, theme-aware border/hover/focus tokens.
  Primary/danger button colours remain DaisyUI variants; do not erase semantics.
- States: visible keyboard outline with offset; open menu/pressed trigger has a
  border as well as a background; disabled controls retain native `disabled` and
  shared opacity. Labels and accessible names remain present on icon-only mobile.

## Usage

- Use `.btn` / `.btn-sm` with existing primary, ghost or danger variants for
  actions. Shared v2 typography applies automatically.
- Use `.toolbar-summary` for a native `<summary>` with `toolbarMenu`; never
  replace native keyboard/menu behaviour with a clickable div.
- Use `.v2-control` for non-DaisyUI toolbar/guidance buttons.
- Use `IconButton` for icon-only actions and `Icon` for icons with a label.
  Keep `aria-label` / `title`; icon graphics themselves are decorative.
- Timer trigger and readout use the same typography contract as adjacent
  controls. Tabular numerals apply only to the readout, not the menu label.

## Secondary components

- Native `.input`, `.select` and `.textarea` fields share the UI family, readable
  body size and control radius. Inputs/selects share the minimum control height.
  Small screens use at least 16 px text to avoid iOS focus zoom.
- Inputs, selects, textareas, checkboxes and ranges share the visible focus
  outline; native disabled semantics and editing behaviour remain intact.
- Dialogs stay within the viewport and scroll internally on short screens.
- Member volume uses the bundled speaker icon, not a platform-dependent emoji.
- Rich-text contenteditable prose, headings and semantic reactions remain outside
  these control overrides. Existing role/channel rules do not change.

## Regression checks

`frontend/e2e/v2.test.ts` checks the actual timer **label**, trigger, readout and
adjacent controls across lofi/light/dark, desktop/tablet/mobile, native keyboard
opening, icon assets, overflow and larger root text. Existing note, panel, voice
and v1 tests remain required. Review screenshots too: matching computed sizes
alone is not visual acceptance or a WCAG audit.
