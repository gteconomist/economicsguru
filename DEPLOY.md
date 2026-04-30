# Deploying economicsguru.com

A click-by-click walkthrough. Allow ~30 minutes the first time. You don't need to use a terminal.

---

## Step 1 &mdash; Create the GitHub repo

1. Go to [github.com/new](https://github.com/new) (you should be signed in as `gteconomist`).
2. **Repository name:** `economicsguru`
3. **Description:** `Live US economic data site at economicsguru.com`
4. Set it to **Private**.
5. Leave "Initialize this repository" boxes unchecked.
6. Click **Create repository**.

You'll land on an empty repo with setup instructions. Ignore those — we have a different way to upload.

---

## Step 2 &mdash; Upload these files

The simplest path: drag and drop.

1. On the empty repo page, click the link **"uploading an existing file"** (it's in the gray instructions box).
2. Open Finder to the folder containing this site (the one with `index.html`, `inflation/`, `assets/`, etc.).
3. **Select all the contents of the folder** (not the folder itself — its contents). On macOS: `Cmd-A` inside the folder.
4. Drag everything into the GitHub upload area.
5. Wait for the upload to finish (the file list will appear below the drop zone).
6. **Important:** GitHub's web upload doesn't include hidden folders by default. Specifically, the `.github/` folder (containing the workflow) and `.gitignore` will be missing. We'll add them in the next step.
7. Scroll down. In **"Commit changes"**, leave the default message and click **Commit changes**.

### Adding the workflow file (the important hidden one)

The `.github/workflows/refresh.yml` file is what makes the site auto-refresh. GitHub's web uploader skips it because it starts with a dot. Add it manually:

1. In the repo, click **Add file → Create new file**.
2. In the filename box, type exactly: `.github/workflows/refresh.yml` &nbsp;&nbsp; (the slashes create the folders)
3. Open the local file `.github/workflows/refresh.yml` in any text editor (TextEdit is fine).
4. Copy the entire contents and paste into the GitHub editor.
5. Scroll down, click **Commit changes**.

Repeat for `.gitignore` (filename: `.gitignore`).

---

## Step 3 &mdash; Add your BLS API key as a secret

This makes your key available to the nightly script without ever putting it in the code.

1. In the repo, go to **Settings** (top nav, far right).
2. In the left sidebar: **Secrets and variables → Actions**.
3. Click **New repository secret**.
4. **Name:** `BLS_API_KEY` &nbsp;&nbsp; (exactly this, all caps)
5. **Secret:** paste your BLS API key (it's in `API keys.docx` in the project folder).
6. Click **Add secret**.

You don't need keys for FRED, BEA, etc. yet — the inflation page uses BLS only.

---

## Step 4 &mdash; Turn on GitHub Pages

1. Still in **Settings**, sidebar: **Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Save. (Sometimes there's no save button — selecting it is enough.)

That's it. The first deploy will start immediately. Watch it:

1. Go to the **Actions** tab (top nav).
2. You should see a workflow run called "Refresh data and deploy" with a yellow circle (in progress) or green check (done).
3. Click into it to watch logs. The first run takes ~1 minute.
4. When the **deploy** job finishes, the page URL appears at the top: `https://gteconomist.github.io/economicsguru/`.

**Open that URL** &mdash; the site is now live, just at GitHub's URL. Next step puts your real domain on it.

---

## Step 5 &mdash; Point economicsguru.com at GitHub Pages

This is the only step that touches DNS. You'll do it at whichever company sells you the domain (GoDaddy, Namecheap, Bluehost, etc.). Find the **DNS** or **DNS Management** section.

You're going to add 5 records:

### A records (4 of them, all for the apex domain)

| Type | Name / Host | Value | TTL |
|---|---|---|---|
| A | `@` | `185.199.108.153` | Default |
| A | `@` | `185.199.109.153` | Default |
| A | `@` | `185.199.110.153` | Default |
| A | `@` | `185.199.111.153` | Default |

(Some registrars use blank for "@" — both mean "the bare domain economicsguru.com".)

### CNAME record (for www)

| Type | Name / Host | Value | TTL |
|---|---|---|---|
| CNAME | `www` | `gteconomist.github.io.` | Default |

(Note the trailing dot if your registrar shows one. If it complains, omit it.)

### Remove the old forwarding

If your domain is currently set to **Forward** to another URL, **delete or disable the forwarding rule**. The new DNS records replace it.

### Wait

DNS changes take anywhere from 2 minutes to 24 hours. Most propagate in under 30 minutes. You can check progress at [dnschecker.org](https://dnschecker.org).

### Tell GitHub about the domain

1. Back in GitHub, **Settings → Pages**.
2. Under **Custom domain**, enter: `economicsguru.com`
3. Save.
4. GitHub will verify the DNS and then offer to enable **"Enforce HTTPS"** &mdash; tick it once it's available (it appears after the SSL cert is issued, usually within an hour).

You're done. The site now lives at `https://economicsguru.com`.

---

## What happens from now on

- Every day at ~9:30am ET, GitHub Actions runs the fetch script, updates `data/inflation.json`, and redeploys.
- If you push any change to the repo (e.g., a copy edit), it deploys immediately.
- You can manually trigger a refresh anytime: **Actions → Refresh data and deploy → Run workflow**.

---

## Troubleshooting

**The site loads but charts are blank.**
Open the browser's developer console (Cmd-Option-I on Mac, F12 on Windows) and look at the Console tab. The most common cause is `data/inflation.json` not being found &mdash; check that the file is in the repo and the path is right.

**The Action failed.**
Click into the failed run from the Actions tab. The error is usually visible in the "Refresh inflation data from BLS" step. Most common: missing or invalid `BLS_API_KEY` secret.

**The custom domain isn't working.**
Wait. DNS is slow. If it's been more than 24 hours, double-check the records at your registrar match the table above exactly.

**I want to make a change.**
For text edits, the easiest path is to edit files directly in GitHub's web UI (click the pencil icon on any file, edit, commit). The site redeploys automatically.

If you get stuck on any step, paste the error or screenshot back to me and I'll walk you through it.
