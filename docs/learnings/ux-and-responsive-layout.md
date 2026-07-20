# UX and responsive layout

[Learning index](README.md)

## User job and information architecture

When connected in wired mode, the user wants to configure one hardware
capability, preview it, and apply it confidently. Connection is a prerequisite
and status—not the primary task occupying the page.

The interface therefore separates Lighting, Display, and Device into focused
workspaces. Only the active task is rendered. Connection health stays visible
in the header and links to Device recovery controls; time sync lives alongside
connection rather than competing as a top-level task.

## Control and feedback decisions

- Keep previews beside the controls they reflect.
- Use range inputs for brightness and speed to support rapid experimentation.
- Show one visually dominant apply action per task.
- Keep presets adjacent to lighting controls on wide screens.
- Use explicit live regions for operation feedback only.

HTML `output` has an implicit status role. Using it for visible range values
created competing live regions, so range values use ordinary text while native
sliders expose their values accessibly.

## Virtual-keyboard geometry

Every row uses a shared 16.75-unit width. Function-group spacers and the gap
before the navigation cluster are explicit layout units. Consequently a
one-unit key has the same width on every row, while Backspace, Enter, Shift,
modifiers, and Space preserve their relative sizes.

Normalizing rows independently with `flex-grow` does not work: rows have
different key totals, so identical keys acquire different widths. Resizing the
outer preview cannot fix that structural distortion.

On large screens the keyboard body is capped at 940 px and key depth increases.
This prevents the preview becoming a wide, shallow banner.

## Responsive contract

- Default desktop application ceiling: 1280 px.
- At 1280 px and above: restrained 1400 px application ceiling, stable editing
  and preset columns, and bounded keyboard preview.
- At 880 px and below: sidebar becomes three-item top navigation and
  multi-column workspaces stack.
- At 520 px and below: lighting controls use one column and navigation helper
  text is visually hidden while descriptive accessible names remain.
- On narrow screens: preserve readable keyboard geometry and scroll the
  preview internally rather than shrinking labels beyond legibility.

The first narrow render exposed a cascade issue: the desktop selector
`.lighting-editor .presets-section` was more specific than the mobile reset.
Responsive overrides that reset grid placement must match the desktop
selector's specificity.

## Large-screen lesson

Expanding the application to 1600 px and scaling key height fluidly made the
screen feel stretched. Fields became longer without becoming more usable, and
the keyboard lost believable proportions. Large screens need bounded content,
stable control widths, and intentional whitespace; available width is not a
target every component must fill.

## Accessibility contract

- All interactive elements are keyboard accessible with visible focus.
- Navigation exposes the current page with `aria-current` and descriptive
  names.
- Status, errors, and progress are announced without duplicate live regions.
- Meaning does not rely on color alone.
- Animation respects `prefers-reduced-motion`.
- Controls retain usable touch targets when the layout stacks.

Visual and automated evidence is recorded in [Validation](validation.md).
