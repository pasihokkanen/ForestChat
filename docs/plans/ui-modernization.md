# UI Modernization Plan

**Goal:** Modernize ForestChat UI — round corners, consistent borders, visual depth, glass morphism.

---

## Phase 1 — Round corners (high impact, pure CSS)

| # | File | Change |
|---|---|---|
| 1a | `src/components/layout/MainTabBar.tsx` | Add `rounded-t-lg` to tab buttons |
| 1b | `src/components/charts/ChartTabBar.tsx` | Add `rounded-t-lg` to tab buttons |
| 1c | `src/components/forest/StandList.tsx` | Add `rounded-t-lg` to filter bar container (line 366) |
| 1d | `src/components/forest/OperationList.tsx` | Add `rounded-t-lg` to filter bar container (line 397) |

## Phase 2 — Line alignment in fullscreen

**Problem:** ChatHeader has `py-3` (~45px), but MainTabBar and ChartTabBar have no outer padding (~37px). The `border-b` lines land at different heights in fullscreen mode.

| # | File | Change |
|---|---|---|
| 2a | `src/components/layout/MainTabBar.tsx` | Add `py-1` to outer div → total height matches ChatHeader |
| 2b | `src/components/charts/ChartTabBar.tsx` | Add `py-1` to outer div → total height matches ChatHeader |

## Phase 3 — De-border: replace `border-r` with background contrast

Chrome/VSCode-style tabs — separation comes from rounded corners + background difference, not hard borders.

| # | File | Change |
|---|---|---|
| 3a | `src/components/layout/MainTabBar.tsx` | Remove `border-r` on tab buttons. Active: `bg-white dark:bg-gray-900`. Inactive: `bg-transparent`. |
| 3b | `src/components/charts/ChartTabBar.tsx` | Same — remove `border-r`, use background contrast |
| 3c | `src/components/charts/ChartsPanel.tsx` | Remove `border-r` on panel container (line 50). PanelResizer already provides separation. |

## Phase 4 — Subtle gradients (depth without clutter)

| # | File | Change |
|---|---|---|
| 4a | `MainTabBar.tsx` | `bg-gradient-to-b from-gray-100 to-gray-50` instead of flat `bg-gray-50` |
| 4b | `ChatHeader.tsx` | Same gradient (`from-gray-100 to-gray-50`) |
| 4c | Filter bars (StandList line 366, OperationList line 397) | Same gradient treatment |

## Phase 5 — Glass morphism + micro-interactions

| # | File | Change |
|---|---|---|
| 5a | `src/components/chat/ToolCallBar.tsx` | Enhance: `backdrop-blur-md bg-gray-100/60 dark:bg-gray-800/60` |
| 5b | `src/components/chat/ToolCallCard.tsx` | Add `hover:scale-[1.01] transition-transform` to card div |
| 5c | Tab buttons (MainTabBar + ChartTabBar) | Ensure `transition-all duration-200` for smooth active/inactive switches |

## Phase 6 — PanelResizer polish

| # | File | Change |
|---|---|---|
| 6 | `src/components/layout/PanelResizer.tsx` | Replace plain bar with 4px-wide hit area + subtle dot/line indicator on hover (VS Code-style). See [resizer spec](#panelresizer-redesign). |

---

## PanelResizer redesign

Current: plain `w-1.5 bg-gray-200` bar, blue on hover.

New: `w-1` container with `mx-1` invisible hit area (cursor zone). Center line `w-px bg-gray-300 dark:bg-gray-600`. On hover: center line turns blue + shows subtle dot pattern or grows to `w-[3px]`.

```tsx
// Target classes:
className="group relative w-4 shrink-0 cursor-col-resize flex items-center justify-center"
// Inner bar:
className="w-px h-full bg-gray-300 dark:bg-gray-600 group-hover:w-[3px] group-hover:bg-blue-400 dark:group-hover:bg-blue-500 transition-all duration-200"
```

---

## Execution order

1. **Phase 1+2 first** — the two things explicitly requested (round corners + line alignment). Pure CSS, no logic changes.
2. **Phase 3–6** — follow-up batch for additional polish. Review together before committing.

**Files touched:** ~10. All changes are CSS class additions/removals — zero logic changes.
