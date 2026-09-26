# Web Design References for Issues #1–#10

These 24 existing PNG mockups cover six Web screens in the four retained backgrounds. They were generated with Imagegen during the Niihon design exploration and copied without modification. The homepage follows the approved BH rounded-primary-button and separate-secondary-link layout. Other screens are matching design studies, not evidence of implemented functionality or individually approved final copy.

## Retained Backgrounds

| Code | Direction |
| --- | --- |
| AM | Sakura Milk — pale pink |
| AQ | Neon Sorbet — purple/fuchsia gradient |
| AH | Bloom Hour — light illustrated landscape |
| AL | Petal Afterglow — dark illustrated landscape |

These references do not add four appearance settings to the product scope. Keep responsive layout, readable contrast, Japanese typography, keyboard behavior, and reduced motion consistent with the chosen direction when implementing components.

## Screen Inventory

| Screen | Related issues | AM | AQ | AH | AL |
| --- | --- | --- | --- | --- | --- |
| Home — approved BH reference | #1, #5 | [AM](00-home/am.png) | [AQ](00-home/aq.png) | [AH](00-home/ah.png) | [AL](00-home/al.png) |
| Sign in | #7 | [AM](01-sign-in/am.png) | [AQ](01-sign-in/aq.png) | [AH](01-sign-in/ah.png) | [AL](01-sign-in/al.png) |
| Create account | #7 | [AM](02-create-account/am.png) | [AQ](02-create-account/aq.png) | [AH](02-create-account/ah.png) | [AL](02-create-account/al.png) |
| Profile and personal visuals | #9 | [AM](15-edit-profile/am.png) | [AQ](15-edit-profile/aq.png) | [AH](15-edit-profile/ah.png) | [AL](15-edit-profile/al.png) |
| Preferences | #10 | [AM](16-preferences/am.png) | [AQ](16-preferences/aq.png) | [AH](16-preferences/ah.png) | [AL](16-preferences/al.png) |
| Password and session security | #9 | [AM](17-account-security/am.png) | [AQ](17-account-security/aq.png) | [AH](17-account-security/ah.png) | [AL](17-account-security/al.png) |

## Interpretation and Known Differences

- Use these images as composition, hierarchy, and art-direction references. Acceptance criteria and the latest owner decisions determine functionality. Illustration, sample values, and incidental controls do not extend an issue.
- The product now targets local Windows, Linux, and macOS use with the server/Web/processing in Docker. SwiftUI and games remain native. References saying “on this Mac” are historical copy and must become platform-neutral in the Web implementation.
- Mockups use English example copy. Issue #10 currently specifies French/Japanese interface languages; translating GitHub issues does not change the product language requirements. Resolve the English-interface question separately before implementing localization.
- A displayed profile Administration entry represents an authorized administrator. It never grants role selection, promotion, or an administration page to ordinary users. Promotion in #8 remains outside the Web interface.
- Password screens must continue to require the current password and revoke other sessions according to their owning issue, regardless of sample visual detail.
- The preferences study does not show every required control: retain the kanji page-size requirement and existing ownership of time-zone/activity rules when implementing the full scope.
- The removed standalone service-unavailable screen is intentionally absent. When the container serving both HTML and API is stopped, only an already loaded interface can display a connection-loss state; fresh navigation cannot retrieve a custom page from it.
- These are Web references, not SwiftUI mockups. No images are assigned to server, persistence, API-contract, or command-line administration work merely for decoration.

## Integrity

Every PNG is an opaque 1536 × 1024 reference. `manifest.json` records the exact SHA-256, file size, theme, and issue mapping. The original local gallery remains intact. Issue references should use immutable commit URLs, allowing review before the documentation branch is merged.
