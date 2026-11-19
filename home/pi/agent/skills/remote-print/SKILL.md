---
name: remote-print
description: >-
  Print documents (docx/doc like 签到表、报销单、明细表) on the shared HP LaserJet
  printer. Covers the visible-in-tmux-pane workflow on host `hasee`, docx→pdf
  conversion, copy counts, verifying a job actually reached the printer, and
  stopping a runaway job. Trigger: "打印", "打 N 份", "print 2 copies",
  "打印机", "打不出来", "别打了".
---

# Remote printing (HP_LaserJet_Pro_M329)

## The setup

| | |
|---|---|
| Printer | `HP_LaserJet_Pro_M329`, network, `192.168.104.149` |
| Queue name | `HP_LaserJet_Pro_M329` |
| Print host | `hasee` (reachable as `clares@hasee`, batch ssh works) |
| Other host | `mechrevo` (this box) also has a queue named the same — print from **one** of them, not both |
| Driver | `hp:/net/HP_LaserJet_Pro_M329?ip=192.168.104.149` (hplip backend) |
| Temp dir | `~/print-tmp/` for converted PDFs |

**Never print silently over plain ssh when the user is watching a pane.** Drive the
pane with `tmux send-keys` so they see every command and its output.

## Golden path

1. Get the file onto the print host (already there, or `scp`).
2. **Convert docx → PDF.** `lp` cannot render `.docx`; submitting it raw either fails
   or prints garbage. Always:
   ```bash
   soffice --headless --convert-to pdf --outdir ~/print-tmp ~/文件.docx
   ```
3. Print with an explicit queue, copy count and title:
   ```bash
   lp -d HP_LaserJet_Pro_M329 -n 2 -t 人工-签到表 ~/print-tmp/人工-签到表.pdf
   ```
   → `request id is HP_LaserJet_Pro_M329-32 (1 file(s))`
4. **Verify it actually printed** (see below). Do not report "打好了" off the
   `request id` alone — that only means CUPS *accepted* the job.

## Driving the pane

```bash
# the ssh'd hasee pane
tmux list-panes -a -F '#{session_name} #{window_index}.#{pane_index} #{pane_id} #{pane_current_command} #{pane_title}'
tmux send-keys -t %32 C-u          # ALWAYS first: clears leftover half-typed input
tmux send-keys -t %32 'lpstat -o' Enter
sleep 3
tmux capture-pane -p -J -t %32 -S -25 | grep -v '^$' | tail -12
```

- `C-u` before every `send-keys`. A stray partial command in the line buffer silently
  corrupts yours (`print-tmp/...pdtat -o;` → `fish: Unknown command`).
- `capture-pane` without `-J` wraps long CJK output into unreadable fragments; without
  `-S -N` you only see trailing blank lines.
- fish: escape parens — `劳务费发放明细表-最新\(1\).docx`.
- `lpstat -o` empty + `lpstat -p` → `is idle` is the success signal.

## Symptom → cause: "job 卡住，打不出来"

**Real 2026-11-07 incident.** Job sat in the queue for 10+ minutes; `lpstat -l -o`
said `Alerts: job-printing`; the printer said `idle`; cancel + resend changed nothing.

Diagnostic ladder (cheap → expensive, all as normal user):

```bash
lpstat -o                          # still queued? which job id
lpstat -l -o                       # 'Alerts: job-printing' + 'queued for ...'
lpstat -p                          # header line, e.g. 'is idle' — and the money line:
                                   #   File "/usr/lib/cups/filter/universal" not available
ps -eo pid,etime,cmd | grep -E 'backend|filter|hpcups|hp '   # ANY process? if none → nothing is being sent
lpstat -v                          # device URI, extract the IP
ping -c2 192.168.104.149           # printer reachable at all?
snmpget -v1 -c public -t2 192.168.104.149 \
  1.3.6.1.2.1.25.3.5.1.1.1 1.3.6.1.2.1.25.3.5.1.2.1  # hrPrinterStatus (idle(3)), error state
snmpget -v1 -c public -t2 192.168.104.149 1.3.6.1.2.1.43.16.5.1.2.1.1   # panel message, hex
```

**The tell:** `File "/usr/lib/cups/filter/<name>" not available`. The queue's PPD
references a filter binary that is not installed → cupsd accepts the job, marks it
`job-printing`, and then can never build the filter chain, so **no backend and no
filter process ever start** and the bytes never leave the box. Cancel/resend is
useless; only fixing the queue helps.

Confirmed by contraindication: printer idle via SNMP, ping 0% loss, page counter
ticking only for older jobs → problem is entirely local CUPS config.

**Fix (needs root — you cannot sudo without the user's password; type the commands
into the pane and let them enter it):**

```bash
cancel -a
sudo systemctl stop cups
sudo lpadmin -p HP_LaserJet_Pro_M329 -E \
     -v ipp://192.168.104.149/ipp/print -m everywhere   # driverless, replaces the broken PPD
sudo systemctl start cups
lpstat -p          # the 'filter ... not available' line must be GONE
```

Note: `lpadmin` while cups is stopped fails with `Unable to connect to server:
Bad file descriptor` — that means the driver swap did **not** happen; redo it after
cups is back up.

Cheaper probes worth one attempt before touching drivers:

```bash
printf 'hello\r\n\f' | lp -d HP_LaserJet_Pro_M329 -o raw -t rawtest   # bypasses filters
lpstat -a ; systemctl is-active cups
```

## Stop it now

User says 够了 / 别打了 / "叫它停下":

```bash
cancel -a                     # empties the queue
cupsdisable HP_LaserJet_Pro_M329   # Paused — nothing more can be sent
lpstat -p                     # verify: 'disabled ... Paused'
```

Then say: software side is cut. Paper still coming out = the printer's own buffer —
press ✕ on the panel or power-cycle. Re-enable afterwards with
`cupsenable HP_LaserJet_Pro_M329`.

## `-n` is squared on this queue — never use it for N>1

Measured on 2026-11-08 against `HP_LaserJet_Pro_M329` (hasee, `hp:/net/...` + hplip):

| request | expected | actual |
|---|---|---|
| `-n 1` of a 2-page PDF | 2 pages | **2 pages** ✅ (counter 80039 → 80041) |
| `-n 6` of the same 2-page PDF | 12 pages | far more — user reported "多打了很多" ❌ |

The `copies` attribute gets applied twice — `pdftopdf` bakes N copies into the stream **and**
the driver/printer is told `COPIES=N`. N×N pages. Invisible at N=1, explosive at N=6.

**Workaround: put the copies in the file, always print `-n 1`**

```bash
cd ~/print-tmp
pdfunite a.pdf a.pdf a.pdf a.pdf a.pdf a.pdf out6.pdf   # 6 copies
pdfinfo out6.pdf | grep Pages                            # 2×6 = 12 — must match expectation
lp -d HP_LaserJet_Pro_M329 -n 1 -t 政审函6份 out6.pdf
```

Then the page count is decided by the file and cannot multiply. Verify with the counter
(see below) before declaring success.

## Copy-count discipline (learned the hard way)

Paper cannot be un-printed, and `-n` multiplies silently.

- **Never `cancel` + resubmit a stuck job.** `cancel` only drops it from the host
  queue; the bytes cupsd already handed to the printer stay in the printer's buffer
  and come out anyway. Resending then prints a *second* set. A cancel/resend loop of
  `-n 2` three times = up to 6 copies of paper for a 2-copy request.
- The job id in the queue is the file; `-n` is an attribute. Spool size ≈ file size,
  so a 400 KB entry in `lpstat -o` is a big document, not a big file.
- **No shell command in `fish_history` for a job id ⇒ it did not come from the
  interactive shell** (GUI print dialog, another host submitting to the queue, a
  script). Say that instead of guessing.
- Cross-check paper actually consumed with the printer's lifetime page counter:
  ```bash
  snmpget -v1 -c public -t2 192.168.104.149 1.3.6.1.2.1.43.10.2.1.4.1.1  # Counter32 = pages
  ```
  (79677 → 79726 over one incident = 49 pages. Count them against pages-per-copy:
  `pdfinfo file.pdf | grep Pages`.)
- Never print a `.docx`/`.doc` with `lp` — it is binary, the filter renders garbage
  pages, and `-n 8` gives you garbage × 8. Convert first, always.

## Reporting rules

- Quote the real `request id`, the copy count and the file (`-n 8` of a 8-copy job is
  8 pages of paper, not 8 files).
- If the queue is not empty after ~30 s, it did not print. Say so.
- Never claim success from `request id` alone.
