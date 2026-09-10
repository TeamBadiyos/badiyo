# Move in-app notifications to the top

All in-app update messages (order updates, success/error popups) currently appear at the bottom-center of the screen. Move them to the top.

## Change

- `src/routes/__root.tsx` — change `<Toaster position="bottom-center" />` to `position="top-center"`.
- Add top safe-area offset so toasts don't sit under the phone's status bar / notch on Android (`richColors`/`offset` prop or toastOptions style, small value like `env(safe-area-inset-top)` + spacing).

## Technical details

- Single prop change on the sonner `<Toaster>` mounted in `src/routes/__root.tsx:124`; every `toast(...)` call across the app inherits the new position automatically.
- Use sonner's `offset` / `toastOptions` to add `calc(env(safe-area-inset-top, 0px) + 8px)` spacing so the toast clears the status bar in the Capacitor app.
- Verify with `bunx tsgo --noEmit` and visually trigger a toast in the preview.

## Note

Native push notifications (FCM) display position is controlled by Android itself and cannot be moved by the app — this change covers the in-app popups only.
