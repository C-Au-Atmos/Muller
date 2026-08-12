# React Bits source and license record

Muller Stage 7 adapts selected React Bits components as part of the application.
The upstream source revision is pinned to:

`DavidHDev/react-bits@8d1c5fa9ebee6e077e70c9e5c63b44e87dbeaecc`

Repository: <https://github.com/DavidHDev/react-bits>

The supplied GradientText, SpecularButton, OptionWheel, and LineSidebar source
attachments are retained as the authoritative behavior/visual references. The
remaining component references use the TypeScript + CSS registry entries from
the pinned revision.

## Muller adaptations

| Component | Local implementation | Adaptation |
|---|---|---|
| ColorBends | `src/visual/ColorBendsBackground.tsx` | Retains the upstream Three.js fragment model. Adds Muller palette profiles, bounded DPR/FPS, hidden suspension, reduced-motion static rendering, and renderer disposal. |
| GradientText | `src/ui/react-bits/GradientText/GradientText.tsx` | Retains Motion-driven yoyo progress and exact brand colors. Adds hidden/reduced-motion suspension and limits use to the wordmark. |
| SpecularButton | `src/ui/react-bits/SpecularButton/SpecularButton.tsx` | Retains rounded-rectangle, symmetric pointer-directed laser behavior. Uses one CSS/software contract instead of one OGL context and RAF per button. |
| OptionWheel | `src/ui/react-bits/OptionWheel/OptionWheel.tsx` | Retains curved vertical geometry, drag/wheel/key input, exponential smoothing, blur/fade, and non-looping bounds. Tick callbacks are limited to one per 70ms. |
| LineSidebar | `src/ui/react-bits/LineSidebar/LineSidebar.tsx` | Retains indexes, marker/tick geometry, proximity falloff, smoothing, and click-only navigation. |
| PillNav | `src/features/shell/WorkspaceTabs.tsx` | Adapts the visual behavior to real workspace tabs with close/add/reorder/overflow and keyboard movement. |
| StaggeredMenu | `src/features/filter/WorkspaceFilterMenu.tsx` | Adapts staggered entry to a conditional filesystem filter surface that takes zero layout width while closed. |
| Counter | `src/features/filter/WorkspaceFilterMenu.tsx` | Composes three bounded counters into a validated local calendar date with Before/After semantics. |
| Cubes and Folder | `src/features/explorer/VirtualDirectoryGrid.tsx` | Applies the presentation only to the virtualized visible directory window and retains file-manager selection/open/context-menu behavior. |
| Masonry | `src/features/explorer/VirtualDirectoryGrid.tsx` | Replaces the demo complete-array loader with paged visible-window thumbnails, cancellation, stable cells, and the existing bounded native preview cache. |
| MagicBento and SpotlightCard | `src/features/home/HomeDashboard.tsx` | Replaces demo content with operational paths, task state, mode actions, and semantic buttons. |

## License

MIT + Commons Clause License Condition v1.0

Copyright (c) 2026 David Haz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, and distribute the Software **as part of
an application, website, or product**, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

### Commons Clause Restriction

You may use this Software, including for any commercial purpose, **so long as
you do not sell, sublicense, or redistribute the components themselves, whether
alone, in a bundle, or as a ported version.**

### No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
