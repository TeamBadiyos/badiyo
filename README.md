# Badiyos User App

Create a mobile-first web app called "badiyo" - a home cleaning services app.

Design system:

- Primary color: #00B97A (Badiyo Green)

- Secondary/text color: #222831 (Charcoal)

- Background: #F8FAFA

- Font: Nunito Sans (Google Fonts)

- Border radius: 14px buttons, 18px cards

- 8pt spacing grid

- Clean, minimal, generous whitespace, no clutter

Build these 2 screens only:

1. Splash screen - use the attached wordmark logo image, centered on a #00B97A (Badiyo Green) background. Add a simple fade-in and slight scale-up animation on the logo when it loads, then automatically transition to the Login screen after about 2 seconds with a smooth fade/slide transition (not an abrupt jump cut).

2. Login screen:

   - Show the attached wordmark logo at the top, smaller size

   - Primary field: Mobile Number input (10-digit, with +91 prefix shown), with a "Continue" button below it (full width, primary green button)

   - Below that, a thin horizontal divider with text "or" in the middle

   - Below the divider, a standard "Continue with Google" button (white background, subtle border, Google icon on the left, standard placement like most apps)

   - Keep it minimal - one primary action clearly emphasized (mobile number), Google as secondary option

Use React with Tailwind CSS. Keep code clean and componentized. Do not add any backend/database or real auth logic yet - just build the UI with a working screen transition from Splash to Login using dummy/placeholder behavior (no real OTP or Google auth call needed yet, just the UI and navigation).

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://badiyo.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/cd37bb1e-1ecb-479e-a809-98a8b8ac5de0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
