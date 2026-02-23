# Run ATLAS Locally (Windows)

## Option 1: Python (if installed)

1. **Open the project folder** in PowerShell or Command Prompt:
   ```powershell
   cd C:\Users\hrishikesh\TOOL-X
   ```
   *(Replace with the actual path where you cloned or downloaded the repo)*

2. **Start the server:**
   ```powershell
   python -m http.server 8080
   ```
   *(On Windows, use `python` not `python3`)*

3. Open: **http://localhost:8080/login.html**

---

## Option 2: Node.js (if Python not installed)

If you have Node.js installed:

```powershell
npx --yes serve -p 8080
```

Then open: **http://localhost:8080/login.html**

---

## Option 3: Download the project first

1. Go to **https://github.com/luciffer0770/TOOL-X**
2. Click **Code** → **Download ZIP**
3. Extract to e.g. `C:\Users\hrishikesh\TOOL-X`
4. Open PowerShell in that folder (right-click folder → "Open in Terminal" or "Open PowerShell window here")
5. Run: `python -m http.server 8080` or `npx --yes serve -p 8080`
6. Open **http://localhost:8080/login.html** in your browser

---

## Option 4: Use GitHub Pages (no local setup)

1. Enable GitHub Pages: **Settings** → **Pages** → Source: **GitHub Actions**
2. Go to **Actions** → **Deploy ATLAS to Pages** → **Run workflow**
3. After it completes: **https://luciffer0770.github.io/TOOL-X/login.html**
