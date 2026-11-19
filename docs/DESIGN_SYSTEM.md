# Next Play design system

## Design philosophy

Use a light canvas, white surfaces and a clear typographic hierarchy. Indigo marks the primary action, selection and keyboard focus. Keep task information prominent and use thin dividers to separate surfaces.

## Color palette

The CSS-first Tailwind theme in `src/index.css` exposes the palette through semantic utilities such as `bg-canvas`, `text-ink` and `border-control`.

| Role | Color | Use |
| --- | --- | --- |
| Canvas | `#F8FAFC` | App background |
| Surface | `#FFFFFF` | Cards, panels and dialogs |
| Ink | `#0F172A` | Headings and main text |
| Muted | `#475569` | Descriptions, metadata and helper text |
| Divider | `#E2E8F0` | Decorative separators and card borders |
| Control | `#64748B` | Boundaries of inputs and other controls |
| Accent | `#4F46E5` | Primary fill, interactive text and focus outline |
| Accent hover and active | `#4338CA` / `#3730A3` | Hover and pressed fills with white text |
| Accent tint | `#EEF2FF` | Selected surfaces and normal priority |

| Meaning | Text | Background |
| --- | --- | --- |
| To Do or Low priority | `#334155` | `#F1F5F9` |
| In Progress | `#1E40AF` | `#DBEAFE` |
| In Review or Due soon | `#92400E` | `#FEF3C7` |
| Done or Success | `#166534` | `#DCFCE7` |
| Normal priority | `#4338CA` | `#EEF2FF` |
| High priority, Overdue or Error | `#B91C1C` | `#FEF2F2` |

Keep the full status or priority label visible. Use “Due soon” and “Overdue” beside the date when urgency matters.

## Typography

Use the platform system sans-serif stack. Sizes below are given as font size and line height at the default browser text size. Use rem-based Tailwind utilities so text scales with user preferences.

| Role | Size / line height | Weight |
| --- | --- | --- |
| Page heading | 28/35px on mobile, 32/40px from `sm` | 600 |
| Section heading | 18/28px | 600 |
| Card title | 16/24px | 600 |
| Body and supporting descriptions | 14/20px, 16/24px for introductory copy | 400 |
| Metadata | 12/16px | 400 |
| Button label | 14/20px | 600 |

## Spacing and layout

Use Tailwind’s 4px spacing increments. Start with 16px page padding on mobile, 24px on tablet and 32px on desktop. Separate sections by 24–32px. Use 16px card padding, 16–20px column gaps, 16px between form fields and 8px between a label and its field. Give buttons 16px horizontal padding and a 40px minimum height on desktop, increasing the target to 44px for touch. Plan a 240px desktop sidebar with 16px inner padding and 4–8px between items. Plan a 64px desktop header.

## Radii and elevation

Use Tailwind’s `rounded-lg` (8px) for buttons and inputs, `rounded-xl` (12px) for cards and panels, and `rounded-2xl` (16px) for dialogs. Use a 1px border on static surfaces. Reserve a subtle shadow for dialogs or a lifted drag preview.

## Interaction states

| State | Treatment |
| --- | --- |
| Default | Use the control’s base fill, label and boundary. |
| Hover | Darken a filled action one step or add the accent tint to a ghost control. |
| Keyboard focus | Use the global 2px indigo outline with a 3px offset and keep it clear of clipping. |
| Active or selected | Use the pressed accent fill during activation. Use tint and a visible selection marker for persistent selection. |
| Disabled | Use a native disabled state where possible, with muted text on a neutral fill. |
| Loading | Keep the action’s width stable and change its label to describe the operation, such as “Saving…”. Pair motion with readable text. |
| Error | Pair danger colors with an explanation and a recovery action. |
| Success | Pair green with a short confirmation when the result needs explicit feedback. |

Limit transitions to brief color changes where they help. Apply them with `motion-safe` and use static loading indicators for reduced motion.

## Component guidelines

- **Buttons.** Use white text on indigo for primary actions, a white fill and visible boundary for secondary actions, and an accent tint on hover for ghost buttons. Use white on danger red for destructive actions.
- **Inputs.** Use white fills and a control border for text fields, textareas, selects and search. Put labels above fields and helper or error text below. Use a search icon only as a visual cue alongside an accessible name.
- **Cards.** Lead task cards with the title and show supporting metadata below it. Lead summary cards with the value and give it a descriptive label. Use a brief empty-state message with a relevant action when available.
- **Badges.** Use compact text on its matching semantic tint. Preserve distinct labels for status, priority and due date, even where colors overlap.
- **Dialogs.** If task creation or details use a dialog, use a rounded white surface, a visible title and clear footer actions. Move focus inside on open, support Escape and restore focus to the trigger on close.

## Responsive layout

- **Desktop.** Show the sidebar, full header and four board columns when the content width can support readable cards.
- **Tablet.** Use compact navigation and 24px gutters. Allow board-only horizontal scrolling when four comfortable columns exceed the available width.
- **Mobile.** Use simplified navigation, a compact header and 16px gutters. Keep columns at a readable width inside the board scroller. Allow card titles to wrap and keep the rest of the page within the viewport.

## Accessibility

Target WCAG AA’s 4.5:1 minimum for normal text. Use landmarks and ordered headings, accessible names for icon controls, and visible labels for forms and task states. Associate field errors with their fields and announce asynchronous updates where needed. Preserve a keyboard path for moving tasks. The divider is decorative. Use the stronger control color where a boundary is needed to identify an interactive field. [WCAG contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

## Decisions and trade-offs

System typography avoids an external font request. Semantic names let future components reuse the same colors by purpose. Shared semantic pairs keep the palette small, with explicit labels distinguishing concepts that share a color. Tailwind’s existing spacing and radius scales cover the planned layout.
