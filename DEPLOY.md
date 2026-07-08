# Put this online (about 10 minutes, all free)

No coding tools needed — everything happens in your browser.

## Step 1 — Put the code on GitHub

1. Go to [github.com](https://github.com) and sign up (free) if you don't have an account.
2. Click **+** (top right) → **New repository**. Name it `mission-control-demo`, leave it Public, click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Drag in everything from the `mission-control-demo` folder **except `node_modules`**
   (that folder is huge and gets rebuilt automatically). Note: drag the files and
   the `public` folder contents — GitHub's uploader keeps folder structure if you
   drag the whole folder from Finder.
5. Click **Commit changes**.

## Step 2 — Deploy on Render

1. Go to [render.com](https://render.com) and sign up free — choose "Sign up with GitHub" to make step 2 easy.
2. Click **New → Web Service**.
3. Pick your `mission-control-demo` repository.
4. Render reads `render.yaml` and fills everything in (free plan, `npm install`, `npm start`). Click **Deploy**.
5. Wait ~2 minutes. You'll get a URL like `https://mission-control-demo.onrender.com`.

Open that URL on any device — phone, laptop, anywhere — and Drone Alpha is flying.

## Things to know about the free tier

- The app **goes to sleep after 15 minutes** with no visitors and takes ~1 minute
  to wake up on the next visit. Fine for a demo; a paid tier ($7/mo) stays awake.
- History is stored in memory, so it resets whenever the app restarts or sleeps.
  That's the first thing you'd fix on the road to a real product (add a database).
- Every visitor sees the same drone. Accounts and per-customer isolation are the
  next milestone after that.
