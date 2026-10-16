# Move in-app popups to the top (10% down)

All in-app popups (success, error, order updates) currently show at the bottom. Move them to the top, sitting about 10% of the screen height down from the top edge.

## Change
- `src/routes/__root.tsx` line 162: change the Toaster to `position="top-center"` with `offset="calc(10vh + var(--app-safe-top, 0px))"` so it stays clear of the phone's status bar/camera.
- Every existing popup inherits this automatically; message wording and style unchanged.

## Note
Phone system notifications (shown by Android in the notification shade) can't be moved by the app; this covers in-app popups only.
