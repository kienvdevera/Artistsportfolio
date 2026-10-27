# Traditional Artist Portfolio

## Deploy to GitHub Pages

This is a static website; no build step is required. The included GitHub Actions workflow publishes the repository to GitHub Pages whenever a change is pushed to `main`.

1. Push this project to a GitHub repository. If its default branch is not `main`, update the branch name in `.github/workflows/deploy.yml`.
2. In the repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
3. Push a change to `main`, or start **Deploy to GitHub Pages** manually from the repository’s **Actions** tab.
4. When the workflow succeeds, open the Pages URL shown in the workflow run or in **Settings → Pages**.

## Configure secure artist and admin accounts

The login page at `portal.html` uses Supabase Auth. Artists are invitation-only, artwork images are stored in a private Supabase Storage bucket, and submissions stay unpublished until an administrator approves them. The public portfolio reads approved work from Supabase and uses short-lived signed image URLs; pending artwork images are not publicly readable. The Supabase URL and anon key are public browser configuration values; **never put a Supabase service-role key in this website**.

1. Create a Supabase project and open its **SQL Editor**.
2. Run the SQL in `supabase-setup.sql`. This creates artist profiles, the artwork table, Row Level Security policies, and the private image bucket.
3. In Supabase **Authentication → Users**, create your first administrator account. Then run the promotion SQL at the bottom of `supabase-setup.sql`, replacing the example email with the admin email. Do not make an admin by changing client-side data.
4. Copy the project URL and its anon/public (legacy anon or `sb_publishable_...`) key from **Project Settings → API** into `url` and `anonKey` in `supabase-config.js`. This config file is intentionally public.
5. Install and log in to the [Supabase CLI](https://supabase.com/docs/guides/cli), link your project, and deploy the invitation function from this repository root:

   ```text
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy invite-artist
   ```

   The invitation function verifies the signed-in admin and uses the project’s server-side service-role secret; that secret stays in Supabase and must not be added to a website file.
6. In Supabase **Authentication → URL Configuration**, set the site URL to `https://artist-portfolio-ebon.vercel.app` and allow both `https://artist-portfolio-ebon.vercel.app` and `https://artist-portfolio-ebon.vercel.app/**` as redirect URLs. Configure SMTP/email delivery in Supabase so password-reset and artist-invitation emails can be delivered.
7. Publish the site. Use **ARTIST / ADMIN LOGIN** on the portfolio to sign in. The admin workspace can invite artists, publish/reject submissions, delete artwork, and publish admin uploads. Artists sign in using the invitation email and can submit pending work.

For local testing, serve the repository over HTTP (for example, `python -m http.server`) and add that local URL to Supabase’s allowed redirect URLs. Opening `portal.html` directly as a `file://` URL is not supported by Supabase Auth.

## Before publishing

- Fonts and the Supabase JavaScript client are loaded from external services and require an internet connection. System font fallbacks are included.
- Until Supabase is configured, the original **Add artwork** controls continue to save only in the current browser. Once `supabase-config.js` is configured, those controls route to the authenticated portal instead.
