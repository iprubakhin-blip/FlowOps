# Publish FlowOps Lite to GitHub from Windows

## 1. Create GitHub and install tools

- Create or sign in to a GitHub account: https://github.com/
- Install Git for Windows: https://git-scm.com/downloads/win
- Install Node.js LTS and Docker Desktop.
- Open the ZIP folder in VS Code or Cursor and launch its terminal (PowerShell).

## 2. Verify the application locally before publishing

```powershell
node --version
npm --version
docker --version
npm install
docker compose up -d
```

Start the API and web in separate PowerShell terminals:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Then visit `http://localhost:4200`, add a task, change its status, and refresh. Confirm the new data persists. Run:

```powershell
npm run test
npm run build
```

**The starter has not been dependency-installed or end-to-end tested inside the AI execution environment.** If you encounter build errors, fix them before presenting the repository to clients.

## 3. Publish as a Git repository

Create an **empty public repository** at https://github.com/new named `flowops-lite` (do not auto-add a README or .gitignore: both are provided here).

From the unzipped `flowops-lite` folder:

```powershell
git init
git add .
git commit -m "feat: initial Angular and NestJS task dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/flowops-lite.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your own GitHub username. Authenticate using the browser prompt, Git Credential Manager or another supported method — **not** a password pasted into the terminal. You may need to configure Git identity before the first commit:

```powershell
git config --global user.name "Your display name"
git config --global user.email "your-public-or-noreply-github-email"
```

**Commit the generated `package-lock.json`** after a successful `npm install` so GitHub Actions can use reproducible dependency installs. Check that `.env` remains ignored.

## 4. Improve your repo presentation

1. Add a screenshot captured from your own running app to `docs/screenshot.png` and reference it near the top of `README.md`.
2. GitHub description: `Angular + NestJS + PostgreSQL task dashboard | TypeScript full-stack portfolio project`.
3. Suggested topics: `angular`, `typescript`, `nestjs`, `postgresql`, `fullstack`, `portfolio`.
4. Pin the repo on your GitHub profile.
5. Do not claim the demo was delivered to a real customer. The `README` explicitly states its origin and limitations.

## 5. Next portfolio items

Create two **additional projects** later, with their own repository READMEs:
- React client workspace (connecting to the FlowOps API)
- AI operations assistant (real LLM API, safety checks, evals)

Commercial experience should be represented with case studies when no public source code may be disclosed.
