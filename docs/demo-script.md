# Demo recording script

15–30 second terminal GIF that goes at the top of the README, the launch tweet, the Measure Slack post, the MCP directory entry.

Tool: [vhs](https://github.com/charmbracelet/vhs) or [asciinema](https://asciinema.org/) → convert to GIF with [agg](https://github.com/asciinema/agg).

---

## Script

```
$ export GOOGLE_APPLICATION_CREDENTIALS=~/service-account.json
$ tagops init --import \
    --account-id 123 --container-id 456 --workspace-id 1 \
    --monthly-conversions 1000 --avg-value 85
```

Then show the rendered output from the live run:

```
  ✔ Container imported

  What's inside
    71 tags · 32 triggers · 69 variables

  Consent Mode v2 compliance
    76% (71 tags audited)
    ⚠ 11 unconfigured tags

  EU data-loss exposure estimate
    ~$33,108 /yr permanent loss (estimate)
```

End frame: a blinking prompt on an empty line. No call-to-action in the GIF itself — the README/tweet supplies it.

---

## vhs tape file (save as `demo.tape`)

```vhs
Output docs/images/demo.gif

Set FontSize 16
Set FontFamily "JetBrains Mono"
Set Width 1100
Set Height 620
Set Padding 25
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms

Hide
Type "export PS1='\e[32;1m$\e[0m '"
Enter
Type "clear"
Enter
Show

Sleep 800ms

Type "tagops init --import \"
Sleep 150ms
Enter
Type "  --account-id 123 --container-id 456 --workspace-id 1 \"
Sleep 150ms
Enter
Type "  --monthly-conversions 1000 --avg-value 85"
Sleep 300ms
Enter

Sleep 4500ms

Sleep 1500ms
```

Record once, tune timings, commit the GIF to `docs/images/demo.gif`, reference from the README.

---

## Don't

- Narrate with voice-over. Everyone scrubs past it.
- Add a call-to-action card at the end. The surrounding text does that.
- Let it run longer than 25 seconds. Scrollers stop watching.
- Show real container IDs. Use `123 / 456 / 1` or a demo container.
- Record against a slow network. Pre-record the `init --import` against a real container, then re-run with fresh output.

## Do

- Use a dark terminal theme. Catppuccin Mocha or Tokyo Night.
- Pin the font to a ligature monospace (JetBrains Mono, Fira Code).
- Target <800KB GIF. Anything bigger lags on Twitter.
- Open with a clear prompt; no shell-startup noise.
- Close with a blank prompt — viewers read that as "the tool is done."
