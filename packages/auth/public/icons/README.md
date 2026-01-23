# FedCM Branding Icons

This directory contains the branding icons used by the FedCM (Federated Credential Management) API.

## Required Icon Sizes

The following icon files are referenced in `/fedcm.json`:

- **icon-25.png** (25×25px) - Used for widget mode minimum size
- **icon-40.png** (40×40px) - Used for button mode minimum size
- **icon-512.png** (512×512px) - High-resolution icon for larger displays

## Design Guidelines

- Use PNG format with transparency
- Icons should be square (1:1 aspect ratio)
- Use your brand logo or a simplified version
- Ensure good contrast against the purple background (#7C3AED)
- Icons will be displayed on both light and dark browser UIs

## Current Color Scheme

The FedCM configuration uses:
- Background: `#7C3AED` (vibrant purple)
- Text: `#ffffff` (white)

## Creating Icons

You can create these icons from an SVG or existing logo using:

```bash
# Using ImageMagick (if installed)
convert logo.svg -resize 25x25 icon-25.png
convert logo.svg -resize 40x40 icon-40.png
convert logo.svg -resize 512x512 icon-512.png
```

Or use online tools like:
- [Favicon Generator](https://realfavicongenerator.net/)
- [IconKitchen](https://icon.kitchen/)
