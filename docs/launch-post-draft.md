# My client lost 90% of their Google Ads conversions overnight. Here's what GTM was hiding.

_Draft blog post for launch. Target: 700-900 words, confessional voice, not product pitch. Post to personal blog, cross-post to LinkedIn, link from the TagOps README and launch tweet._

---

Last July, a Google Ads account I manage dropped 90% of its measured conversions in 24 hours.

Nothing had changed on the site. The campaigns were still running. The CMP cookie banner still appeared, still logged user preferences, still looked compliant. The GTM container still showed every tag as "fired." If you opened the GA4 DebugView, events were flowing normally.

But in Google Ads, the conversion column collapsed from 1,100/day to around 100.

The thing Google didn't tell us — because Google doesn't tell you — is that on July 21, 2025, the final phase of Consent Mode v2 enforcement had gone live for EEA and UK traffic. Accounts that hadn't implemented the specific signal handshake between CMP and GTM were being silently downgraded. No email. No warning banner. No post in the Tag Manager UI. Just a quiet 90% haircut on the only metric that matters to a performance marketer.

We eventually diagnosed it. The CMP vendor's banner collected consent correctly, but the implementation — copy-pasted from a 2023 tutorial — was only setting `ad_storage` and `analytics_storage`. Consent Mode v2 additionally requires `ad_user_data` and `ad_personalization`. Without them, Google treated every impression as non-consented, even when the user had explicitly clicked "Accept all."

The fix took 20 minutes. Recovering the lost data was impossible. About 40% came back through Google's behavioral modeling. The rest is gone permanently.

I wrote this because I've since learned it isn't rare.

[Matomo reported](https://ppc.land/consent-mode-v2-enforcement-is-silently-breaking-google-ads-conversions/) 90–95% metric drops across affected EEA sites. The root cause is almost always the same: a CMP that collects consent perfectly at the UI layer, and a GTM setup that's missing one or two specific signal parameters at the wiring layer. Most GTM users — including experienced ones — cannot tell these apart by looking at the UI. The browser's DevTools network tab will show you the Meta Pixel firing. What it won't show you is whether Google has classified that fire as consented.

The deeper problem is that none of this is auditable in GTM's own interface. There's no "Consent Mode v2 Compliance" tab. There's no diagnostic that tells you "11 of your 40 tags are missing the signal parameters Google now requires." There is only the silent revenue drop, and a Reddit thread of other practitioners trying to figure out why their campaigns broke.

---

So I built TagOps.

It's a command-line tool that treats a GTM container like a production system. You install it, point it at your container, and get three things the GTM UI doesn't give you:

**1. A Consent Mode v2 audit that actually names the failures.**

```
$ tagops consent-audit
Meta – PageView       ❌  Missing: ad_user_data, ad_personalization
Meta – Purchase       ❌  Missing: ad_user_data, ad_personalization
GA4 – purchase        ✅  Compliant
Google Ads – Conv     ❌  Missing: ad_user_data
LinkedIn – Insight    ⚠  ad_storage set; recommended ad_user_data missing

Compliance score: 76%  (11 of 45 tags non-compliant)
Estimated EEA impact: significant — tags firing non-consented for affected users
```

And a `--fix` flag that writes the corrections back via the GTM API, with a snapshot taken first so you can undo it.

**2. Vendor templates that include the wiring, not just the tag.**

The Meta Pixel template doesn't just create tags. It creates all five trigger events (PageView, ViewContent, AddToCart, InitiateCheckout, Purchase), the data layer variables for content_ids/value/currency, the event-ID deduplication for CAPI, and the correct consent signals out of the box. One command.

**3. A snapshot/diff/promote flow.**

```
$ tagops snapshot --git-commit
$ tagops diff
$ tagops promote --source staging --target production --dry-run
```

Plus a GitHub Actions gate that blocks PRs if consent score drops or a policy is violated. No more "someone edited a tag and broke production" post-mortems.

---

It's open source under MIT. 24 vendor templates. MCP server for Claude/GPT/Gemini agents. No SaaS, no signup, no account.

If you've ever been on the wrong end of a conversion collapse you couldn't explain, try it on a real container:

```
npm install -g tagops
tagops init --import
tagops consent-audit --report
```

You will probably find something. I've yet to point it at a container older than 6 months that came back clean.

`github.com/ToroSachi/tagops`

---

_This is a draft — tighten the opener, verify the Matomo stat against its primary source before publishing, and add a real screenshot of the consent-audit output before posting._
