# Deploying to Cloudflare

The whole game is one Cloudflare Worker named `verve`:
- **The page:** served from `dist/`.
- **The game server:** the Durable Objects `Room` and `Lobby`.
- **The database:** D1, named `verve`.
- **A scheduled job:** runs every minute and closes the day at midnight Eastern.

Its address is whatever Cloudflare gives it: `https://verve.<your-subdomain>.workers.dev`, or a custom domain if you add one.

There are three ways to deploy. All read the same `wrangler.jsonc`, so the Worker, its bindings, the Durable Objects and the schedule come out the same either way:

- **A. From your machine**, with `npm run deploy`. You decide when it goes out.
- **B. From Cloudflare's dashboard**, by linking the GitHub repository. Cloudflare builds and deploys on every push to `main`.
- **C. From GitHub Actions**, with `.github/workflows/deploy.yml` in this repository. It deploys on every push to `main`, and from the Actions tab when you run it by hand.

Use one of B and C, not both: each would deploy every push. All of them need the database first.

## 1. Create the database (once)

`wrangler.jsonc` names Sicheng Li's Cloudflare account and the `verve` database in it, which already exists. To deploy to a different account, create the database there either way:

- **Dashboard:** go to **Storage & Databases → D1 SQL Database → Create**, name it `verve`, then copy its **Database ID**.
- **Command line:** run `npx wrangler login`, then `npx wrangler d1 create verve`, and copy the `database_id` it prints.

Put that id in the `d1_databases` entry of `wrangler.jsonc` and commit it.

`wrangler.jsonc` also names an `account_id`. It must be the Cloudflare account you deploy to. Change it if you use a different account. You can see your account id in the dashboard URL, or by running `npx wrangler whoami`.

## A. Deploy from your machine

You need Node.js 22.

```bash
npm install            # installs wrangler, the Cloudflare CLI
npx wrangler login     # opens the browser; sign in to your Cloudflare account
npm run db:migrate     # creates the tables (migrations/0001 … 0004); later, only new migrations run
npm run deploy         # lint + tests, build dist/, upload the Worker
```

`npm run deploy` stops without uploading anything if lint or a test fails. When it succeeds, wrangler prints the Worker's address.

On a machine without a browser, skip the login. Instead, create an API token under **My Profile → API Tokens**, with **Workers Scripts: Edit** and **D1: Edit**, and set it in the environment:

```bash
export CLOUDFLARE_API_TOKEN=…
```

Every later deploy:

```bash
npm run stamp          # if you changed js or css: refresh the version numbers in index.html
npm run db:migrate     # if migrations/ has a new file: apply it BEFORE the new code goes live
npm run deploy
```

## B. Deploy from the Cloudflare dashboard (link the GitHub repo)

Cloudflare builds the project from GitHub and deploys it on each push. First, push the repo with the real `database_id` (and the right `account_id`) committed.

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Workers → Import a repository**.
2. Choose **GitHub** and authorise the Cloudflare app. Give it access to this repository.
3. Pick the repository. Set the **project name** to `verve`. It must match `"name"` in `wrangler.jsonc`, or the build stops with an error.
4. Under build settings, enter:

   | Setting | Value |
   | --- | --- |
   | Root directory | `/` |
   | Build command | `npm run check && npm run build` |
   | Deploy command | `npx wrangler d1 migrations apply verve --remote && npx wrangler deploy` |
   | Non-production branch deploy command | `npx wrangler versions upload` (the default) |
   | Build variables | `NODE_VERSION` = `22` |
   | Production branch | `main` |

   - **Build command:** runs lint and the tests, then copies the site into `dist/`. A failing test stops the deploy. Cloudflare runs `npm install` before it by itself.
   - **Deploy command:** applies any new migration first, then uploads the Worker. Migrations that have already run are skipped.
5. Select **Save and Deploy**, then follow the build log until it finishes.

From then on, every push to `main` builds and deploys automatically. A push to another branch uploads a preview version that doesn't replace the live one.

**Things to know about the dashboard route:**
- **Bindings come from `wrangler.jsonc`.** That covers D1 `DB`, the Durable Objects `ROOM` and `LOBBY`, the schedule and the static files. Don't add them in the dashboard, because each deploy replaces dashboard-only settings with what `wrangler.jsonc` says.
- **Migration permissions.** If the migration step fails with an authentication error, the build's API token lacks D1 access. Open the Worker's **Settings → Build**, and edit its API token to include **D1: Edit**, or pick a token that has it.
- **Mixing the two routes.** You can still use route A with the repo linked. Whatever deploys last is what's live.

## C. Deploy from GitHub Actions

`.github/workflows/deploy.yml` runs on every push to `main`: eslint, the tests, `npm run build`, then `wrangler d1 migrations apply verve --remote` and `wrangler deploy`. A failing check stops it before anything is uploaded, and a newer push waits for the deploy before it rather than cutting a migration short.

It needs one repository secret, **Settings → Secrets and variables → Actions → `CLOUDFLARE_API_TOKEN`**: an API token from the account in `wrangler.jsonc` (**My Profile → API Tokens**) with **Workers Scripts: Edit** and **D1: Edit**. A token from any other account fails at the migration step with an authentication error.

To deploy without a push, open **Actions → Deploy to Cloudflare → Run workflow**.

## Check it is live

Open the Worker's address and play a hand on a regular table. Then:

| Check | Expected |
| --- | --- |
| `/health` | `ok` |
| `/leaderboard` | `{"ok":true,"board":{…}}` |
| `/d1` and `/audit` | `404`: they only work on your machine (they need `LOCAL_DEV=1` from `.dev.vars`, which is never uploaded) |
| Dashboard → Workers → verve → Settings → Triggers | the cron `* * * * *` is listed |

To watch the live logs, including money and database warnings and the midnight job's `day` lines, run `npx wrangler tail`. In the dashboard, it's **Workers → verve → Logs**.

## If something goes wrong

**Bad code:** go back to the previous version. This doesn't touch the database.
- **Command line:** `npx wrangler deployments list`, then `npx wrangler rollback`.
- **Dashboard:** **Workers → verve → Deployments**, then roll back to an earlier version.

**Bad data:** D1 can restore the database to any minute in the last 30 days (Time Travel). This replaces everything written since then, including players' money and hands:

```bash
npx wrangler d1 time-travel info verve
npx wrangler d1 time-travel restore verve --timestamp=2026-10-16T12:00:00Z
```

**Checking the books:** `/audit` only runs locally. To look at the live data, query it:

```bash
npx wrangler d1 execute verve --remote --command "SELECT id, balance FROM players WHERE is_bot = 0"
```

The dashboard's D1 console (**Storage & Databases → D1 → verve → Console**) runs the same queries.

## Things to know

- **Avoid 23:50–00:10 Eastern.** The day closes then (see "The day" in DATABASE.md). A deploy restarts the Worker. The tables wake again on their own alarms, but there's no reason to deploy into the close.
- **Tables survive a deploy.** Each room keeps its table in Durable Object storage. A hand in progress carries on, and the browsers reconnect by themselves.
- **Durable Object migrations** are the `migrations` entries in `wrangler.jsonc`, tags `v1` and `v2`. The deploy applies them itself. Only change them when adding or renaming a Durable Object class.
- **The schedule runs in UTC.** It fires every minute and works out Eastern time in code, so daylight saving needs nothing from you.
- **Local development uses its own database.** `npm run dev` never touches the live one. A wrangler command meant for the live database needs `--remote`; without it, wrangler uses the local one.
