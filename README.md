# Tempbox

A disposable email inbox in the browser — the temp-mail.org idea, built as a static site.

Open it and you immediately have a working address. Paste it into a signup form, watch the
confirmation land in the inbox a few seconds later, take your link, walk away.

- **No build step.** Plain HTML, CSS and ES5-compatible JavaScript. No npm, no bundler, no framework.
- **No backend of its own.** Addresses come from the public [mail.tm](https://mail.tm) API, which runs
  the actual MX records and SMTP servers. Nothing is proxied through a server you have to operate.
- **Real mail.** These are genuine addresses that accept mail from anywhere on the internet.

## Run it

Any static file server works. A dependency-free one is included, since it only needs
Windows PowerShell — no Node, no Python:

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open <http://localhost:8080>. Use `-Port 3000` for a different port, `-NoBrowser` to
stop it launching your browser.

You can also just double-click `index.html`. Everything works from `file://` except the
one-click clipboard copy, which some browsers restrict to secure origins — the site falls
back to the legacy copy path, and worst case you can select the address and copy it manually.

## What it does

| | |
|---|---|
| **Address** | Generated on first load, then remembered. Copy with one click on the address itself. |
| **Custom names** | "Change" lets you pick your own local part, or switch domains. |
| **History** | The last 8 addresses are kept so you can jump back to an older inbox and its mail. |
| **Auto-refresh** | Polls every 5s, backs off exponentially when the network is unhappy, pauses entirely when the tab is hidden. |
| **Reading** | HTML mail renders in a locked-down sandboxed iframe; plain text renders inline, in your theme. |
| **Attachments** | Listed with size and downloadable (the API needs a bearer token, so downloads go through `fetch`, not a bare link). |
| **Delete** | Individual messages, or the whole inbox — which destroys the account server-side and issues a new address. |
| **Themes** | Dark and light, following your OS by default. |

### Privacy details worth knowing

Remote images are **blocked by default** — the message iframe ships a `Content-Security-Policy`
of `img-src data:`, so tracking pixels don't fire when you open a message. A "Load remote images"
button appears only when the message actually contains remote content, and only then does the
frame get `img-src https:`.

The iframe is `sandbox`ed without `allow-same-origin` and without `allow-scripts`, so message
HTML cannot run JavaScript, reach the parent page, or read anything of yours. Links open in a
new tab with `rel="noopener noreferrer nofollow"`.

**Temporary addresses are not secret.** Anyone who knows or guesses the address can read its
mail. Don't use one for banking, government services, or account recovery.

## How it fits together

```
index.html          markup and the two <dialog>s
css/styles.css      all styling; theming via CSS custom properties
js/util.js          formatting, escaping, linkify, clipboard, random names
js/store.js         localStorage: active session, address history, theme
js/providers/
  mailtm.js         real mail via the mail.tm API
  demo.js           offline stand-in with simulated messages
js/ui.js            every DOM write lives here
js/app.js           session lifecycle, polling, event wiring
serve.ps1           the local dev server
```

`ui.js` never talks to a mail provider and providers never touch the DOM; `app.js` is the only
thing that knows about both.

### The provider interface

Both providers implement the same async surface, so swapping backends means writing one file
and pointing `app.js` at it — useful if you'd rather run your own SMTP server than depend on
a third party:

```js
domains()                          -> Promise<string[]>
createAccount(localPart, domain)   -> Promise<session>
resume(session)                    -> Promise<session>
listMessages(session)              -> Promise<message[]>
getMessage(session, id)            -> Promise<message>   // adds text, html, attachments
markSeen(session, id)              -> Promise<void>
deleteMessage(session, id)         -> Promise<void>
deleteAccount(session)             -> Promise<void>
fetchAttachment(session, url)      -> Promise<Blob>
```

### Demo mode

Add `?demo=1` to the URL to force the offline provider, which fabricates an inbox locally —
handy for working on the UI without touching the network. The app also falls back to it
automatically if the live API can't be reached, so the page is never a dead screen.

## Things to know about the backend

- The account password is randomly generated per address and kept in `localStorage`, which is
  what lets you close the tab and come back to the same inbox. It is a throwaway credential for a
  throwaway mailbox — treat it as such.
- The API normalises addresses on creation: dots in the local part are silently dropped. The
  address returned by the server is treated as authoritative, since it's the only one that will
  authenticate.
- Requests are serialised and spaced ~160ms apart, with retry-after–aware backoff on HTTP 429,
  to stay comfortably inside the API's rate limit.
- Messages are retained by the backend for roughly a week.
- The service is receive-only. There is no way to send mail from a Tempbox address, which is
  rather the point.

## Status

Verified working: address creation, session restore across reloads, custom and random
addresses, address history, polling, message rendering (HTML and plain text), remote-image
blocking, inbox and message deletion, demo-mode fallback, light/dark themes, mobile layout.

Inbound SMTP delivery was not verified from the development machine, whose ISP blocks outbound
port 25 — the receiving side belongs to mail.tm and their MX (`in.mail.tm`) resolves and is
live. If mail doesn't arrive, check <https://mail.tm> is up before suspecting this code.

## Licence

MIT — see [LICENSE](LICENSE).
