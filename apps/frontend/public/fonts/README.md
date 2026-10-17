# Font Assets

V1 ships local webfonts so the frontend does not depend on Google Fonts at build or runtime.

## Included

- MiSans basic webfont files from `misans-webfont@4.3.1` (`Apache-2.0`)
- Manrope Latin files from `@fontsource/manrope@5.2.8` (`OFL-1.1`)

## Debt

The current MiSans files are the V1 bootstrap subset used to remove the Google Fonts dependency. A later font-performance change should replace them with complete Simplified Chinese unicode-range subsets and measure first-load impact.
