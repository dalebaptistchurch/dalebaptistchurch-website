# Dale Baptist Church CMS Setup

The repository controls the build through `netlify.toml`. Do not add a separate build command or publish directory in the Netlify dashboard.

## One-time Netlify setup

1. Deploy this repository and confirm the build succeeds.
2. In Netlify, open **Integrations → Identity → Netlify Identity** and enable Identity.
3. Set registration to **Invite only**.
4. Under Identity services, enable **Git Gateway** for the connected GitHub repository.
5. Invite the pastor and the website administrator by email.
6. Each invited user follows the email link, creates a password, and then uses `/admin/`.

Netlify Identity email login is available on the free credit-based plan. Git Gateway is deprecated by Netlify but remains operational and receives major security fixes.

## Publishing rules

- A Pastor Note with **Draft** enabled never appears on the public website.
- A published Pastor Note appears in the archive; the newest published note also appears on the homepage.
- An Event with **Draft** enabled never appears on the public website.
- A blank Announcement Date displays the event immediately.
- A future Announcement Date hides the event until that date.
- A blank Expiration Date removes the event after the event date; a custom Expiration Date overrides that default.
- **Feature on Homepage** controls whether an event is added to the homepage carousel.
- Deleting an entry, or turning Draft on, removes it after the resulting Netlify deployment.

Every CMS save commits content to GitHub. A published change therefore triggers a Netlify production deployment and uses the normal deployment credits for the plan.
