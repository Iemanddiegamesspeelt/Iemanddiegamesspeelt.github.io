# MacroHub

MacroHub is a dark, responsive Geometry Dash macro platform for finding, publishing, converting, collecting, and downloading replay files. The GitHub Pages build is a static React app; Supabase provides Google and email/password authentication, PostgreSQL, Row Level Security, and object storage.

The catalog starts empty. The database migration adds only real format/tool definitions—no demo levels, macros, likes, downloads, or invented totals.

## Architecture

```text
GitHub Pages (React + TypeScript + Tailwind)
  ├─ browser-side replay parsing and conversion
  ├─ Supabase Auth (Google + email/password)
  ├─ Supabase Postgres (catalog, likes, comments, collections, reports)
  └─ Supabase Storage (original + canonical replay files and avatars)
```

All replay conversions run locally in the browser:

```text
source file → detected parser → canonical replay → capability check → exporter → verified download
```

There is no source-to-target converter matrix. A target is offered only when its real exporter can preserve required gameplay and timing data. Generated files are parsed again for semantic round-trip verification. Optional metadata loss is disclosed; required data loss blocks the conversion.

## One-time Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor**, paste [`supabase/migrations/0001_macrohub.sql`](supabase/migrations/0001_macrohub.sql), and run it once.
3. In **Authentication → Providers**, enable Email. Enable Google after completing the Google setup below.
4. In **Authentication → URL Configuration**, set the Site URL to the final GitHub Pages address and add its callback URL:
   - project site: `https://YOUR-NAME.github.io/REPOSITORY/auth/callback`
   - account site: `https://YOUR-NAME.github.io/auth/callback`
5. Copy the project URL and publishable key from **Project Settings → API**. Never put the service-role key in GitHub Pages.

The SQL migration creates all tables, constraints, indexes, activity counters, download de-duplication, RLS policies, and the public `macrohub-files` bucket. Upload/update/delete access remains restricted to each signed-in user's own storage folder.

After your first sign-in, promote your own account in the Supabase SQL Editor if you need the moderation screen:

```sql
update public.profiles set role = 'admin' where username = 'your_username';
```

## Google login setup

1. In Google Cloud Console, create an OAuth 2.0 Web application.
2. Add Supabase's callback URL as an authorized redirect URI. Supabase shows the exact URL in the Google provider settings; it normally looks like `https://PROJECT-REF.supabase.co/auth/v1/callback`.
3. Paste the Google Client ID and Client Secret into **Supabase → Authentication → Providers → Google** and enable it.
4. Keep the GitHub Pages `/auth/callback` URL in Supabase's redirect allow list as described above.

## GitHub Pages deployment

1. Create a GitHub repository and push this project to its `main` branch.
2. In **Settings → Secrets and variables → Actions → Secrets**, add:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
3. In **Settings → Pages**, choose **GitHub Actions** as the source.
4. For a normal project repository, no base-path variable is needed; the workflow uses `/REPOSITORY/` automatically.
5. For a custom domain or `YOUR-NAME.github.io` repository, add an Actions variable named `PAGES_BASE_PATH` with the value `/`.
6. Push to `main`, or open **Actions → Deploy MacroHub to GitHub Pages → Run workflow**.

The workflow in [`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds the static app, adds GitHub Pages deep-link fallback, and deploys the artifact.

This repository includes the existing `macrohub.me` CNAME in the static artifact. For this deployment, use `https://macrohub.me` as the Supabase Site URL and `https://macrohub.me/auth/callback` as an allowed redirect URL.

## Local development

Requirements: Node.js 22.13 or newer.

```bash
npm install
copy .env.pages.example .env.local
npm run dev:pages
```

Edit `.env.local` with the Supabase project URL and publishable key. The converter works without Supabase; browsing, accounts, uploads, likes, comments, and collections require it.

Build and preview the exact static artifact:

```bash
npm run build:pages
npm run preview:pages
```

## Replay formats and tools

The format registry currently has verified parsers and version-pinned exporters for 23 format families, including GDR2, GDR, GDR JSON, MHR, MHR JSON, CML, SLC, XBOT, XD, Echo, ReplayBot, yBot, OmegaBot, TASBot JSON, Rush, KD-Bot, zBot, Fembot, TCM, Amethyst, GDMO, ReplayEngine 3, and MacroHub Canonical JSON.

Formats and replay tools are separate registries. Compatibility is an explicit many-to-many relationship, so a format is never presented as belonging exclusively to one replay tool. Eclipse, Mega Hack, xdBot, Echo, ReplayBot, and other tools can each expose multiple compatible formats when supported.

## Security

- Supabase PKCE authentication with Google or email/password
- RLS enabled on every public application table
- storage ownership policies based on the authenticated user's folder
- 10 MiB replay limit and 2 MiB avatar limit
- file extension, signature, executable, script, HTML, and SVG rejection
- strict canonical replay validation with a 250,000-event limit
- unique likes and collection membership
- 10-minute rapid duplicate download suppression
- ownership checks for profile, macro, comment, and collection writes
- moderator/admin roles and immutable moderation audit records

The publishable Supabase key is intentionally public. Security comes from RLS and database/storage policies. Never expose a service-role key in this app or in a GitHub Actions build variable beginning with `VITE_`.

## Verification

```bash
npm run build:pages
npm run typecheck
npm run lint
npm test
```

The older Next/Vinext application remains in the repository for the existing Sites deployment. The GitHub Pages entry point is isolated in `pages-app/` and does not require a Next.js server.
