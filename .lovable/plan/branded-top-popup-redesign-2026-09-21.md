# Branded top popup redesign

Current plain, oversized top messages will become compact Badiyos notification pills, following the selected **Modern glass pill** direction.

## Changes

- Redesign the shared in-app popup once so all existing success, error, warning, information, and normal messages inherit the new look.
- Use a compact floating pill with:
  - translucent white surface and subtle blur
  - thin status-colored border and soft branded glow/shadow
  - circular status icon on the left
  - concise message area that stays one line when possible and wraps cleanly to two lines
  - small dismiss control only where useful
- Keep the app’s existing Nunito Sans typography.
- Use Badiyos green for normal/success, red for errors, amber for warnings, and a restrained branded treatment for information.
- Preserve top-center placement and Android camera/status-bar safe spacing.
- Replace the current large empty notification box; do not change the underlying home screen or message wording.
- Add a quick soft slide-down/fade-in and restrained exit, with reduced-motion support.

## Verification

- Trigger normal, success, error, warning, and informational messages.
- Check narrow Android sizing so long English and Marathi messages do not overflow or cover key controls.
- Confirm safe-area clearance and visual consistency on the current home screen.
- Run the project’s automatic checks and verify the popup in the mobile preview.
