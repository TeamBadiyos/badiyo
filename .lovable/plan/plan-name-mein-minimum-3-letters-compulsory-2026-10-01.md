# Plan: Name mein minimum 3 letters compulsory

## Problem
Customer app mein naam sirf 1 letter (jaise "A") likh kar bhi save ho jata hai — Complete Profile popup aur Edit Profile, dono jagah.

## Kya change hoga
Naam kam se kam **3 letters** ka hona chahiye (spaces hata kar count). 1-2 letters par save nahi hoga aur error dikhega: "Naam kam se kam 3 letters ka hona chahiye."

### 1. Complete Profile popup (`src/components/CompleteProfileSheet.tsx`)
- `save()` mein check: `name.length < 3` → error, save nahi hoga.
- Popup ka completion check (`nameOk`) bhi update: agar saved naam 3 letters se chhota hai, toh profile incomplete maani jayegi aur popup wapas aayega jab tak sahi naam save na ho.

### 2. Edit Profile screen (`src/components/profile/EditProfileScreen.tsx`)
- `handleSave()` mein wahi check: 3 letters se kam → error "Naam kam se kam 3 letters ka hona chahiye.", save nahi hoga.

## Test
- 1 letter ("A") aur 2 letters ("Ab") → dono jagah error, save nahi hota.
- 3+ letters ("Abc") → dono jagah save hota hai.
- Existing user jiska naam 1-2 letters ka hai → popup wapas dikhta hai.

## Out of scope
- Koi database change nahi.
- Email, phone, photo, referral flow mein koi change nahi.
