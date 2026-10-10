# Contest invite: image nahi ja raha — fix

## Kyon nahi ja raha
Phone app website ko live load karta hai, lekin photo attach karne ke liye phone ke andar ek naya hissa (file save karne wala) chahiye. Ye hissa sirf naye app build (APK/Play Store update) mein aata hai. Purane installed app mein wo nahi hai, isliye app chupchap sirf message bhej deta hai.

## Kya karenge
1. Share ko pakka banayenge: image download hone ka wait, sahi file type, aur fail hone par wajah record karna (taaki pata chale kahan atka).
2. Agar phone ke app mein image share ka hissa nahi hai, to message ke upar contest banner ka link bhi daal denge, jisse WhatsApp mein photo preview dikhe — kam se kam abhi ke app mein bhi kuch photo dikhe.
3. Naya app build banane ke steps likh denge (Android sync + build), taaki Play Store update ke baad asli photo + caption share ho.

## Aapko kya karna hoga
- Naya Android app build bana kar Play Store par update dalna (bina iske asli photo attach nahi hoga).

## Technical details
- `@capacitor/filesystem` native plugin installed APK mein registered nahi hai; `Filesystem.writeFile` throw karta hai aur code text-only fallback par jata hai. Fix: `npx cap sync android` + naya APK.
- `Capacitor.isPluginAvailable("Filesystem")` se check; unavailable hone par text mein banner URL prepend.
- Fetch errors / plugin errors `console.warn` se log.
