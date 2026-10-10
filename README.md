# ScrimDesk player form

Static pages players open from the poster QR code. Plain HTML, CSS and JavaScript: no framework,
no analytics, no cookies, nothing uploaded. About 25 KB in total.

| File | What it is |
|---|---|
| `r.html` + `r.js` | Registration form. Reads the tournament from `?d=`, builds the SCRIMDESK block and sends it on WhatsApp. |
| `privacy.html` | Privacy policy, the same text as Profile → Privacy in the apps (`PrivacyPolicy.kt`). |
| `index.html` | Short landing page. A link that arrives here with `?d=` is passed on to `r`. |
| `style.css` | Shared styles, light and dark. |

## How it fits with the apps

- The apps build the link as `https://{FORM_HOST}/r?d={payload}`.
  `FORM_HOST` lives in one place: `shared/src/commonMain/kotlin/com/scrimdesk/app/shared/AppConfig.kt`
  (`zeeshanhaider009.github.io/scrimdesk` today).
- `payload` is base64url JSON with the keys `c n g t f cur pm pn wa tt p` (`FormLink.kt`).
- The message the form sends must match `RegistrationParser.format` exactly:

  ```
  ----- SCRIMDESK -----
  Code: FZR11L
  Team: Team Phantom
  WhatsApp: +923012345678
  Captain: Ali Raza
  UIDs: 482019334, 519027761
  ---------------------
  ```

- Sending: if the browser can share files (`navigator.canShare({ files })`), the screenshot and the message go
  through the share sheet together. Otherwise WhatsApp opens on `wa.me` with the message and the page explains
  how to attach the screenshot.

## Deploy on GitHub Pages (current setup)

1. Push the repo to GitHub (`ZeeshanHaider009/scrimdesk`).
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow `.github/workflows/pages.yml` publishes this folder on every push to `main` that touches
   `webform/` (or run it from the Actions tab).
4. Open `https://zeeshanhaider009.github.io/scrimdesk/privacy.html` to check. GitHub Pages serves `r.html`
   at `/r`, which is the path the apps use.

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

Then open `http://localhost:8765/r.html?d=…` with a payload copied from a poster's "Copy link".
