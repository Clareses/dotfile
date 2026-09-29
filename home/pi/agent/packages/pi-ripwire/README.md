# pi-ripwire

A pi package wrapping [redhat-et/ripwire](https://github.com/redhat-et/ripwire) —
"the ripgrep of AI context".

## What it provides

- **`ripwire` tool** — lets the agent run the ripwire CLI (ranked call-graph map,
  `--for`, `--callers`, `--impact`, `--edit-check`, `--test-gate`, `--quality-delta`, …)
  without grepping or opening whole files.
- **17 ripwire agent skills** — `extensions/` + `skills/` bundled per the pi package
  conventions (`ripwire-orient`, `ripwire-navigate`, `ripwire-change-check`, …).
- **`/explore` command** — toggles the tool, in the same style as `/notify`:

  ```
  /explore            # toggle
  /explore on|off     # set explicitly
  /explore status     # show state
  ```

  Default is **OFF**, and it resets to OFF at the start of every session —
  like `/pi-web-access`. Run `/explore on` to expose the tool. When OFF the
  `ripwire` tool is removed from the active set and direct `ripwire` bash
  invocations are blocked.

## Binary discovery

`$RIPWIRE_BIN`, then `~/.local/bin/ripwire`, `/usr/local/bin/ripwire`,
`/opt/homebrew/bin/ripwire`, `/usr/bin/ripwire`, then `ripwire` on `PATH`.

Install ripwire itself with:

```bash
RIPWIRE_REPO=redhat-et/ripwire \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/redhat-et/ripwire/main/scripts/install.sh)"
```
