---
name: Nocturne & Gold
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c7c5cd'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#919097'
  outline-variant: '#46464c'
  surface-tint: '#c4c5db'
  primary: '#c4c5db'
  on-primary: '#2d2f40'
  primary-container: '#1a1c2c'
  on-primary-container: '#828498'
  inverse-primary: '#5c5d70'
  secondary: '#e9c349'
  on-secondary: '#3c2f00'
  secondary-container: '#af8d11'
  on-secondary-container: '#342800'
  tertiary: '#c1c4e5'
  on-tertiary: '#2b2f48'
  tertiary-container: '#171b33'
  on-tertiary-container: '#7f83a1'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e1e1f7'
  primary-fixed-dim: '#c4c5db'
  on-primary-fixed: '#181a2a'
  on-primary-fixed-variant: '#444657'
  secondary-fixed: '#ffe088'
  secondary-fixed-dim: '#e9c349'
  on-secondary-fixed: '#241a00'
  on-secondary-fixed-variant: '#574500'
  tertiary-fixed: '#dee0ff'
  tertiary-fixed-dim: '#c1c4e5'
  on-tertiary-fixed: '#161a32'
  on-tertiary-fixed-variant: '#414560'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-lg:
    fontFamily: Libre Caslon Text
    fontSize: 64px
    fontWeight: '400'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Libre Caslon Text
    fontSize: 40px
    fontWeight: '400'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Libre Caslon Text
    fontSize: 32px
    fontWeight: '400'
    lineHeight: '1.3'
  headline-sm:
    fontFamily: Libre Caslon Text
    fontSize: 24px
    fontWeight: '400'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.8'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.1em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1140px
  gutter: 24px
  margin-mobile: 20px
  section-gap: 120px
---

## Brand & Style

This design system is crafted for the modern songwriter—an individual whose work sits at the intersection of raw emotion and disciplined craft. The brand personality is **poetic, sophisticated, and evocative**, aiming to mirror the quiet intensity of a late-night writing session.

The design style is a blend of **Minimalism** and **Modern Corporate**, focusing on high-end editorial layouts. It prioritizes generous whitespace to allow lyrics and compositions to "breathe" on the page, ensuring the user's attention is never diverted from the narrative. The emotional response should be one of quiet reverence and professional trust, positioning the songwriter as a serious literary figure.

## Colors

The palette is rooted in the "Midnight Studio" aesthetic. 

- **Primary (#1A1C2C):** A deep Indigo-Charcoal used for main backgrounds, representing the depth of thought and the night sky.
- **Secondary (#D4AF37):** A muted Metallic Gold used sparingly for accents, highlights, and primary calls to action, symbolizing the "spark" of inspiration and the quality of the craft.
- **Tertiary (#4A4E69):** A desaturated Slate-Purple for secondary UI elements, borders, and subtle depth.
- **Neutral (#121212):** A true deep black for the most recessed layers and foundational backgrounds.

Text should primarily be set in an off-white or light silver to maintain high legibility without the harshness of pure white against dark backgrounds.

## Typography

The typography strategy employs a **literary contrast**. 

**Libre Caslon Text** is used for all headlines and display text. Its classic, high-contrast serifs evoke the feeling of printed sheet music and poetry collections. It should be typeset with slightly tighter letter-spacing in larger sizes to emphasize its elegant curves.

**Inter** provides a functional, modern counterpoint for body text and metadata. By using a clean, systematic sans-serif for lyrics and descriptions, we ensure maximum readability across all devices. Body text uses a generous line-height (1.8) to facilitate a comfortable reading experience for long-form lyrical content.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy on desktop to maintain an editorial, "book-like" feel, centered on the screen. 

- **Desktop:** A 12-column grid with a maximum width of 1140px. Large 120px vertical gaps between sections create a sense of luxury and pacing.
- **Mobile:** A single-column flow with 20px side margins. 
- **Rhythm:** All spacing is derived from an 8px base unit. 

Lyrics should be presented in a centered or staggered narrow column (6 or 8 columns wide on desktop) to mimic the visual structure of a poem, surrounded by significant negative space.

## Elevation & Depth

This design system avoids heavy shadows, instead using **Tonal Layers** and **Subtle Outlines** to create depth.

1.  **Base Layer:** The deepest Indigo-Charcoal (#1A1C2C).
2.  **Surface Layer:** A slightly lighter tint of the primary color, used for cards or background sections.
3.  **Stroke:** Elements are defined by 1px solid borders in the Tertiary color (#4A4E69) at low opacity (20-30%).
4.  **Interactive Depth:** When an element is hovered, it may use a very soft, large-radius glow in the Secondary Gold color at 10% opacity to suggest a "backlit" effect rather than a physical shadow.

## Shapes

The shape language is **restrained and architectural**. 

A "Soft" (0.25rem) roundedness is applied to most UI components like input fields and small buttons, providing a hint of modern approachability without losing the formal structure. 

Large containers and image frames should remain **Sharp (0px)** to maintain the editorial, professional aesthetic of a physical portfolio or high-end magazine.

## Components

- **Buttons:** Primary buttons use a ghost style with a Gold (#D4AF37) border and Gold text. On hover, they fill with a subtle gold tint. Text is always uppercase `label-sm` for a structured look.
- **Lyrics Card:** A minimal container with no background, defined by a thin left-hand border in Gold to signify the "margin" of a notebook.
- **Audio Player:** A custom, ultra-minimalist bar. The progress line should be a thin 2px Gold thread. Controls are simple geometric icons with no enclosing circles.
- **Chips/Tags:** Used for genres or instruments. These use the `label-sm` typography with a subtle Indigo background and no border.
- **Input Fields:** Bottom-border only (underline style) to mimic the lines of a handwritten notebook, using the Tertiary color for the line and moving to Gold when focused.
- **Discography List:** A high-contrast list where the track number is in a small `label-sm` font and the song title is in `headline-sm`.