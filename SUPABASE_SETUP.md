# Supabase setup

Everything in the codebase is wired. These are the steps only you can do
(they need your account). Should take ~10 minutes.

## 1. Create the project
1. Go to https://supabase.com → sign in → **New project**.
2. Pick a name, a strong database password, and a region close to you.
3. Wait for it to finish provisioning.

## 2. Create the table
1. Left sidebar → **SQL Editor** → **New query**.
2. Paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. This creates the `workspaces` table and the row-level security policies that
   keep each user's data private.

## 3. Get your keys
1. Left sidebar → **Project Settings** → **API**.
2. Copy the **Project URL** and the **anon / public** key.
3. In the project root, copy `.env.example` to `.env.local` and fill them in:
   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
   `.env.local` is gitignored — it never goes to GitHub. The anon key is safe to
   expose anyway (RLS protects the data); never use the **service_role** key here.

## 4. Configure auth redirect URLs
1. Left sidebar → **Authentication** → **URL Configuration**.
2. Set **Site URL** to your dev URL: `http://localhost:5173`.
3. Add any deployed URL (e.g. your Vercel/Netlify URL) under **Redirect URLs**.
   The magic link only sends users back to URLs listed here.

Email is on by default with Supabase's built-in mailer (fine for dev — a few
emails/hour). For real volume, add an SMTP provider later under Authentication →
Emails.

## 5. Run it
```
npm install
npm run dev
```
Open the app → enter your email → click the magic link → you're in. Do the same
in the other browser and the same workspace loads.

---

## GitHub / deploy
- Nothing secret is committed: `.env.local` is gitignored, only `.env.example`
  ships. Safe for a public repo.
- When you deploy (Vercel, Netlify, GitHub Pages via an action, etc.), set
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in
  that host's dashboard — Vite inlines them at build time.
- Add the deployed URL to Supabase's **Redirect URLs** (step 4) or magic links
  from production won't work.
