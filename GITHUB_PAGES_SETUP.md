# Enable GitHub Pages for ATLAS

You're seeing **404 – There isn't a GitHub Pages site here** because GitHub Pages must be enabled in your repository settings.

## Steps to fix

### 1. Open repository settings

1. Go to **https://github.com/luciffer0770/TOOL-X**
2. Click **Settings**
3. In the left sidebar, click **Pages** (under "Code and automation")

### 2. Configure the source

1. Under **Build and deployment**
2. Set **Source** to **GitHub Actions**
3. Save (no other changes needed)

### 3. Trigger a deploy

The workflow runs automatically on push to `main`. To deploy manually:

1. Go to **Actions**
2. Select **Deploy ATLAS to Pages**
3. Click **Run workflow** → **Run workflow**
4. Wait for the workflow to finish (green checkmark)

### 4. Your site URL

After deployment completes, your tool will be at:

**https://luciffer0770.github.io/TOOL-X/**

Login page: **https://luciffer0770.github.io/TOOL-X/login.html**

---

## Run locally (no GitHub Pages needed)

```bash
cd /workspace
python3 -m http.server 8080
```

Then open: **http://localhost:8080/login.html**
