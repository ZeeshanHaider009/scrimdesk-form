# ScrimDesk player form

Static pages players open from the registration link organizers share with their poster. Plain HTML, CSS and JavaScript: no framework,
no analytics, no cookies. About 30 KB in total.

| File | What it is |
|---|---|
| `r.html` + `r.js` | Registration form. Reads the tournament from `?d=` and sends the registration to Firebase (see `firebase/README.md`). |
| `privacy.html` | Privacy policy for the store listings. |
| `index.html` | Short landing page. A link that arrives here with `?d=` is passed on to `r`. |
| `style.css` | Shared styles, light and dark. |

The pages load `r.js?v=2` and `style.css?v=2`. Bump the number whenever those files change, so players who
opened the form before get the new version instead of a cached one.

## How it fits with the apps

- The apps build the link as `https://{FORM_HOST}/r?d={payload}`.
  `FORM_HOST` lives in one place: `shared/src/commonMain/kotlin/com/scrimdesk/app/shared/AppConfig.kt`
  (`scrimdesk.web.app` today).
- `payload` is base64url JSON with the keys `i c n g t f cur pm pn wa tt p dc` (`FormLink.kt`). `i` is the
  tournament id the registration is filed under; links made before it existed show "ask the organizer to share
  the tournament again". `dc` is the organizer's dial code; older links fall back to the currency.
- Sending: the form shrinks the payment screenshot (and optional logo) to a JPEG in the browser, then one
  Firestore `commit` creates the document in `tournaments/{i}/registrations` and adds 1 to the tournament's
  `registered` count, which the form shows as "3 / 16 registered". `r.js` holds the same `projectId`
  and `apiKey` as `AppConfig.kt`; with them empty the form says online registration isn't set up.
- Field names and limits match `FirestoreDocuments` in the app and `firebase/firestore.rules`. Change all three
  together.

## Deploy on Firebase Hosting (current setup)

The form is served at **https://scrimdesk.web.app** by the Firebase Hosting site `scrimdesk` in the same
Firebase project as the registrations (`firebase.json` and `.firebaserc` in the repo root). `cleanUrls` serves
`r.html` at `/r`, the path the apps use.

1. Firebase CLI (installed on drive D: here): `D:\tools\firebase\node_modules\.bin\firebase.cmd login` once.
2. Deploy after every change to this folder:

   ```bash
   firebase deploy --only hosting
   ```

3. Open `https://scrimdesk.web.app/privacy.html` to check.

## GitHub Pages copy (older links)

Links shared before the move point at `zeeshanhaider009.github.io/scrimdesk-form`, so that copy stays up.

The app repo is private, and GitHub Pages is free only for public repos. So this folder (and only this folder)
is published from a separate public repo, **`ZeeshanHaider009/scrimdesk-form`**, and the source of truth stays
here.

One-time setup:

1. On GitHub, create the empty public repo `scrimdesk-form` (no README, license or .gitignore).
2. In this repo: `git remote add form https://github.com/ZeeshanHaider009/scrimdesk-form.git`
3. Publish (also after every change to this folder, once it is committed):

   ```bash
   git subtree push --prefix=webform form main
   ```

4. In `scrimdesk-form`: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch **`main`**, folder **`/ (root)`**. `.nojekyll` makes Pages serve the files as they are.
5. Open `https://zeeshanhaider009.github.io/scrimdesk-form/privacy.html` to check. GitHub Pages serves
   `r.html` at `/r`, which is the path the apps use.

## Deploy on Cloudflare Pages (alternative)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
2. Framework preset **None**, build command empty, build output directory **`webform`**.
3. Deploy. Cloudflare also serves `r.html` at `/r`.
4. Update `FORM_HOST` in `AppConfig.kt` to the new host (for example `scrimdesk.pages.dev`), rebuild both apps,
   and update the online privacy link the stores show.

Changing the host changes every new poster's QR code. Posters already shared keep pointing at the old host,
so keep the old site up for a while.

## Test locally

```bash
python -m http.server 8765 --directory webform
```

Then open `http://localhost:8765/r.html?d=…` with a link shared from the app (Home → ⋮ → Share poster & link).
