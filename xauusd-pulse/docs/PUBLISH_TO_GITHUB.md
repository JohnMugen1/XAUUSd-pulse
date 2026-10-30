# Publishing XAUUSD Pulse to GitHub

You need a free GitHub account (github.com). Pick **Method A** (no extra software) or **Method B** (Git).

## Before you start (important)
- **Never upload your `.env` file.** It holds your Twelve Data key. The zip does not contain one, but if you have run the app from the folder you are uploading, it will now. Do not select `.env`, the `data` folder or `node_modules`.
- Method B is safer because `.gitignore` blocks those automatically. Method A relies on you not selecting them.

## Method A: upload in the browser
1. Go to **github.com/new**.
2. Repository name: `xauusd-pulse`. Choose **Public**. Leave "Add a README" **unticked**. Click **Create repository**.
3. On the empty repository page click **uploading an existing file**.
4. Extract the zip. Open the extracted folder and select everything **inside** it **except** `.env`, `data` and `node_modules` (drag the files and folders, not the outer folder).
5. GitHub accepts about 100 files per upload. If it complains, upload `src`, `public` and `tests` first, commit, then upload the rest.
6. Write the commit message `Initial commit: XAUUSD Pulse v2.0.0` and click **Commit changes**.

## Method B: Git
1. Install **Git for Windows** from git-scm.com.
2. Create the empty repository on GitHub as in Method A steps 1 and 2.
3. Open a terminal in the project folder (type `cmd` in the folder's address bar) and run:
```
git init
git add .
git commit -m "Initial commit: XAUUSD Pulse v2.0.0"
git branch -M main
git remote add origin https://github.com/JohnMugen1/xauusd-pulse.git
git push -u origin main
```
4. A browser window asks you to sign in to GitHub. Approve it.
5. Check `git status` shows no `.env` before you push (it should be ignored).

## After uploading
1. Open the repository and confirm **README.md** displays the screenshots and the diagram.
2. Click the gear next to **About** and add a description, the website field (leave empty) and topics: `xauusd`, `gold`, `trading`, `backtesting`, `nodejs`, `express`, `sqlite`, `dashboard`.
3. Open the **Actions** tab. The CI workflow runs `npm test` on every push; a green tick means the badge in the README works.
4. Create a release: **Releases > Draft a new release**, tag `v2.0.0`, title `XAUUSD Pulse 2.0.0`, and attach `docs/XAUUSD_Pulse_Documentation.pdf`.
5. Pin the repository on your GitHub profile (Customize your pins) and add it to your CV and LinkedIn Projects section.

If you choose a different repository name, replace `xauusd-pulse` in `README.md` and `package.json`.
