# Aangan Bar POS — deployment guide

Follow these in order. About 20 minutes total, all free tiers.

## 1. Supabase (database)

1. Go to supabase.com → sign up → **New Project**
2. Name: `aangan-bar`. Set a database password (save it). Region: Singapore (closest to Goa).
3. Once the project is ready, open **SQL Editor** → **New query**.
4. Open `supabase-setup.sql` from this folder, copy all of it, paste into the query box, click **Run**.
   This creates the `menu`, `tabs`, and `history` tables the app needs.
5. Go to **Settings → API**. Copy two values:
   - **Project URL**
   - **anon public** key

## 2. Add your keys to the code

Open `src/storage.js` and replace:
```js
const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
```
with the two values you copied.

## 3. Put the code on GitHub

1. Go to github.com → **New repository** → name it `aangan-pos` → Create (keep it Private if you prefer).
2. Upload this whole folder's contents to that repo (GitHub's web upload works fine, or `git push` if you're comfortable with it).

## 4. Deploy on Vercel

1. Go to vercel.com → sign up with GitHub (one click).
2. **Add New → Project** → select your `aangan-pos` repo → **Deploy**.
   Vercel auto-detects Vite, no settings need to change.
3. In a minute you'll get a live URL like `aangan-pos.vercel.app` — that's your real app, usable from any phone or laptop.

## Day to day after this

- To change the menu, prices, or fix a typo: use the **Menu** tab inside the app itself — no redeploy needed, it writes straight to Supabase.
- To change how the app *behaves* (add a feature, wire up Razorpay): edit the code, push to GitHub, Vercel redeploys automatically within a minute.

## Adding a new staff member (Regular or Manager)

Staff log in with a real email + password now — no more shared PINs.

1. In Supabase, go to **Authentication → Users → Add user**. Enter their email and a password (share it with them separately — not over the same channel as anything else sensitive).
2. Go to **Table Editor → staff_profiles → Insert row**. Set:
   - `id`: paste the user's ID from the Authentication page (copy icon next to their row)
   - `name`: how their name should show in the app, e.g. "Priya"
   - `role`: `regular` or `manager`
3. They can now log in on the app with that email + password. Managers additionally see the ability to edit/delete orders in Order History.

To change someone's role later, edit their row in `staff_profiles` directly.

## Recording purchases (cost tracking)

Use the **Purchases** tab to log each delivery — supplier, date, and per-item cost. This feeds the "Actual purchase spend" and net profit figures in Reports, which are based on what you really paid rather than the built-in cost estimate.

## Adding Razorpay later

When you're ready:
1. Get your Razorpay API keys (Test mode first, then Live once verified).
2. In `PaymentModal` inside `src/App.jsx`, the "Card" button is currently disabled (`live: false`). That's the only spot that needs new code — replace its handler with a Razorpay Checkout call, verify the payment signature (ideally via a small serverless function, e.g. a Vercel API route, so your Razorpay secret key never sits in the browser code), then call `onComplete("Card")` exactly like the other methods do.

Happy to write that integration when you're at this step — just come back with your Razorpay test keys.
