---
name: arxiv-translate
description: Download an arXiv paper's LaTeX source, translate all content to Chinese (keeping terminology/figures/names in English), and compile a Chinese PDF using xelatex. Use when user wants to "translate this arXiv paper", "生成中文版", or provides an arXiv URL for translation.
license: MIT
compatibility: Requires xelatex, ctex LaTeX package, and Chinese fonts (e.g., Noto Serif CJK SC) installed.
metadata:
  author: user
  version: "1.0"
  generatedBy: "manual"
disable-model-invocation: true
---

# arXiv Paper Translation Skill

Download an arXiv paper's LaTeX source, translate the body prose and headings to Chinese (keeping figures, tables, code, pseudocode, terminology, and names in English), then compile a PDF.

## Workflow

### Phase 1: Download & Extract

1. Fetch the arXiv landing page to get the paper title, then create a working directory under the current workspace using a sanitized version of the title (e.g., `A-Novel-Network-Architecture-cn`). The arXiv ID is `<ID>`.
2. Download the source tarball: `curl -L -o source.tar.gz "https://arxiv.org/e-print/<ID>"`
3. Extract: `tar xzf source.tar.gz`
4. Read the main `.tex` file to understand structure — identify which `.tex` files are `\input{}` or `\include{}`d

### Phase 2: Chinese Setup

1. Add Chinese support to the main `.tex` file by inserting **before** the first `\begin{document}`:

```latex
\usepackage[UTF8]{ctex}
\setCJKmainfont{Noto Serif CJK SC}[
  Scale=0.92,
  BoldFont=Noto Serif CJK SC Bold
]
\setCJKsansfont{Noto Sans CJK SC}[
  Scale=0.92,
  BoldFont=Noto Sans CJK SC Bold
]
```

`Scale=0.92` makes CJK glyphs slightly smaller than Latin text at the same point size, producing visually balanced mixed Chinese–English typography typical of academic papers. Adjust to 0.90–0.95 depending on the Latin font used in the paper.

2. If the `.bbl` file exists but `.bib` files don't, replace `\bibliography{...}` with `\input{main.bbl}` (adjust filename as needed).
3. Copy all non-tex assets (figures/, .bib, .bbl, .cls, .sty, .bst, etc.) into the `-cn` directory.

### Phase 3: Classify Files

Categorize every `.tex` file:

| Category | Action |
|---|---|
| **Content files** (abstract, intro, design, eval, discussion, conclusion, etc.) | Translate — prose body text and headings only. Do NOT translate anything inside figure/table environments (including their captions), code blocks, pseudocode, or code tokens |
| **Figure/table files** (fig-*.tex, tab-*.tex) | **Skip** — figure/table files contain figures/tables only; they stay 100% in English, including their `\caption{...}` content |
| **Preamble/header files** (header.tex, macros.tex) | **Skip** — only LaTeX setup |
| **Term/command files** (terms.tex, defs.tex) | **Skip** — only `\newcommand` definitions |
| **Commented-out files** (files that are `% \input{...}`) | **Skip** |
| **Comment-only files** (challenges.tex that's not actually included) | **Skip** |

### Phase 4: Parallel Translation

For each content file, fire a **parallel `worker` subagent** using pi's `subagent` tool with `agent: "worker"`. Spawn one subagent per file and issue all `subagent` calls in the same turn so they run concurrently. Pi runs subagents asynchronously and automatically delivers each result back when it finishes — do not poll.

**Critical constraint**: The `\sys{}` macro (or similar paper-name macros) must be preserved as-is in the translated output. Check `terms.tex` or preambles for such macros.

**Translation rules** (include in every agent prompt):

1. Translate ALL active English prose text (non-commented) to Chinese — body paragraphs and headings only
2. Translate section/subsection headings
3. **KEEP UNCHANGED (never translate)**:
   - **All figures and tables** — content inside `figure` / `table` / `wraptable` / `wrapfigure` / `subfigure` environments stays 100% English, **including their `\caption{...}` content** and any tabular cell text. Only the algorithm `\caption{...}` (in `algorithm` environments, which are text content) IS translated
   - All LaTeX commands, environments, and macros
   - **All code blocks** — content inside `lstlisting` / `verbatim` / `minted` environments is CODE, NEVER translate it (including escaped code fragments via `\%...\%` and `\wrongtok{...}` / `\righttok{...}` markers)
   - **All pseudocode** — content inside `algorithm` / `algorithmic` / `algpseudocode` environments is PSEUDOCODE, NEVER translate it. This includes `\Require` / `\Ensure` / `\State` / `\Comment{...}` / `\ForEach{...}` / `\Procedure{...}` / `\If` / `\While` lines and their arguments — keep the whole `algorithmic` block verbatim in English
   - **All code tokens** — content of `\texttt{...}` / `\ttt{...}` is code (e.g., `\ttt{number}`, `\ttt{split()}`), NEVER translate it
   - All technical acronyms: CXL, PCIe, DMA, MMIO, NIC, SSD, GPU, CPU, OS, USB, etc.
   - All person names, institution names, product names
   - All citation keys (`\cite{...}`) and cross-references (`\ref{...}`, `\S`)
   - All comments (lines starting with `%`)
   - **Verbatim tool/compiler output quoted in text** (e.g., error messages inside prompt figures) — these are literal outputs, keep in English
4. Always insert `{}` after custom macros when followed by Chinese characters (e.g., `\sys的` → `\sys{}的`). See Post-Translation Macro Fix below for rationale.
5. Write back to **the same file**

**Agent prompt structure** (6-section delegation):

```
1. TASK: Translate FILE from English to Chinese (body prose and headings only).
2. EXPECTED OUTCOME: All active prose text and headings translated; figures/tables/captions/LaTeX/terms/comments untouched.
3. REQUIRED TOOLS: Read, Write
4. MUST DO: Translate headings and body prose; keep acronyms/names in English; preserve comments.
5. MUST NOT DO: Modify LaTeX markup; translate comments; translate FIGURES/TABLES (including their \caption content and tabular cells); translate CODE BLOCKS (lstlisting/verbatim/minted); translate PSEUDOCODE (algorithm/algorithmic environments — \Require/\State/\Comment lines stay verbatim English); translate code tokens (\texttt/\ttt).
6. CONTEXT: This is a [domain] paper about [topic].
```

**⚠️ Figures/tables rule (CRITICAL)**: Figures and tables — including their `\caption{...}` and all tabular cell text — stay 100% in English. Agents frequently over-translate captions and table contents. Only body prose and headings get translated. Only the `\caption{...}` of an `algorithm` environment (pseudocode block) gets translated. After all agents complete, verify with:

```bash
# Check for translated figure/table leaks (should print nothing)
python3 << 'PYEOF'
import re, glob
cjk = re.compile(r'[\u4e00-\u9fff]')
for f in glob.glob('*.tex') + glob.glob('sections/*.tex') + glob.glob('sections/appendix/*.tex') + glob.glob('figures/**/*.tex', recursive=True):
    content = open(f).read()
    for m in re.finditer(r'\\begin\{(figure|table|wraptable|wrapfigure|subfigure)\}.*?\\end\{\1\}', content, re.S):
        if cjk.search(m.group(0)): print(f'FIG-TABLE-LEAK: {f}')
    for m in re.finditer(r'\\begin\{algorithmic\}.*?\\end\{algorithmic\}', content, re.S):
        if cjk.search(m.group(0)): print(f'PSEUDOCODE-LEAK: {f}')
    for m in re.finditer(r'\\begin\{lstlisting\}.*?\\end\{lstlisting\}', content, re.S):
        if cjk.search(m.group(0)): print(f'CODEBLOCK-LEAK: {f}')
PYEOF
```

**File split strategy**: One agent per file. Group tiny files (conclusions + appendix + acknowledgments) together.

#### ⚠️ Post-Translation Macro Fix (MUST RUN after Phase 4)

**CRITICAL**: After all translations complete and BEFORE compilation, you MUST fix custom macros followed by Chinese characters. The `ctex` package assigns `catcode 11` (letter) to CJK characters, which means LaTeX parses `\sys的` as a SINGLE control sequence name `\sys的` instead of `\sys` followed by `的`. This causes "Undefined control sequence" errors and silently eats surrounding text.

**Fix**: Insert `{}` between every custom macro and any immediately following CJK character.

```bash
python3 << 'PYEOF'
import re, glob
cjk = '[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]'
for fname in glob.glob('*.tex'):
    with open(fname) as f: content = f.read()
    original = content
    for macro in ['sys', 'agentfs', 'agentcr', 'agentstate', 'statemgr']:
        content = re.sub(r'\\' + macro + '(' + cjk + ')', r'\\' + macro + r'{}\1', content)
    if content != original:
        print(f'Fixed: {fname}')
        with open(fname, 'w') as f: f.write(content)
PYEOF
```

**⚠️ Anti-bug note**: The `<< 'PYEOF'` heredoc is IMPORTANT. Do NOT use double-quoted `python3 -c "..."` — bash will eat one layer of backslashes, turning `r'\\'` into `r'\'` (broken regex). Always use single-quoted heredoc (`<< 'MARKER'`) for Python inline scripts containing backslashes.

**IMPORTANT**: Expand the `macro` list in the Python script to include ALL custom macros defined in the paper's header/command files (e.g., `\TODO`, `\FIXME`, `\myparagraph`, and any other `\newcommand` defined macros used in the content). Read the paper's `myCommands.tex` or equivalent to get the full list.

**How to know you hit this bug**: If you see 30+ "Undefined control sequence" errors in the xelatex log for macros you know are defined, and text is missing from sections (e.g., "本节介绍\sys的详细设计。" renders as just "本节介绍。"), this is the cause.

### Phase 5: Compile

Check the bibliography situation first:
- **If `.bbl` file exists with actual `\bibitem` entries**: precompiled bibliography, no bibtex needed. Just xelatex passes.
- **If `.bib` file exists but no `.bbl` (or `.bbl` is empty — 0 `\bibitem` entries)**: must run bibtex between xelatex passes. Do NOT blindly replace `\bibliography{...}` with `\input{...bbl}` — always verify the `.bbl` has real content first.
- **If neither**: skip bibtex.

**Verify `.bbl` before using it**: `grep -c 'bibitem' paper.bbl` should return > 0. If it returns 0, the `.bbl` is a stub and you must use bibtex instead.

**Sequence when `.bbl` has real `\bibitem` entries:**
```bash
cd <paper-cn-dir> && xelatex -interaction=nonstopmode main.tex
xelatex -interaction=nonstopmode main.tex
xelatex -interaction=nonstopmode main.tex
```

**Sequence when `.bib` exists (no `.bbl` or empty `.bbl`):**
```bash
cd <paper-cn-dir> && xelatex -interaction=nonstopmode main.tex
bibtex main
xelatex -interaction=nonstopmode main.tex
xelatex -interaction=nonstopmode main.tex
```

The full 4-step sequence (xelatex → bibtex → xelatex → xelatex) is required to resolve all citations and cross-references. Skipping bibtex when `.bib` exists will result in `??` placeholders for all `\cite{}` and `\ref{}`.

**Detecting unresolved refs**: Before finalizing, run `pdftotext main.pdf | grep -c "??"`. If the count is > 0, rerun the full bibtex sequence.

### Phase 6: Verify

1. Check `pdffonts main.pdf | grep CJK` confirms Chinese fonts are embedded
2. Check `grep "^!" main.log | grep -v "fontspec Error\|rerunfilecheck"` for actual fatal errors
3. **Check `pdftotext main.pdf - 2>/dev/null | grep -c "??"` — must be 0** (no unresolved references)
4. **Verify no translated figure/table/code/pseudocode leaks** — run the leak check from Phase 4 (figure/table envs, `algorithmic` blocks, and `lstlisting` blocks must contain zero CJK characters)
5. Verify page count matches expectations (~same as original)
6. Report PDF path and page count to user

## Directory Cleanup (Only When Explicitly Requested)

Do NOT clean up or delete working directories automatically after translation. The `-cn` directory and intermediate files are preserved by default.

Only when the user explicitly asks ("整理目录", "移动到外层", "清理一下", "只保留 PDF" or similar), perform cleanup:

### ⛔ CRITICAL: Preserve User's Pre-existing Files

The target directory (e.g., `./kvcache/`) may contain files the user placed there BEFORE the translation session. **You MUST NEVER delete or touch any file that you did NOT create during the current translation workflow.**

Before any cleanup:
1. **First, list what's already in the target directory** (`ls <target-dir>`) to know what was there before.
2. **Only operate on files/directories with `-cn` suffix** that were created by the current translation session.
3. **NEVER use wildcard deletions** like `rm -f *.pdf`, `rm -rf *` or `find ... | xargs rm`. Always target specific filenames.

### Safe Cleanup Procedure

1. **Copy only the translated PDFs** (those ending in `-cn.pdf`) from their `-cn` subdirectories to the target location:
   ```bash
   # Safe: only touch -cn directories
   for d in <target-dir>/*-cn/; do
       pdf=$(find "$d" -maxdepth 1 -name "*.pdf" -not -name "*book*" | head -1)
       [ -n "$pdf" ] && cp "$pdf" "<target-dir>/$(basename "$d").pdf"
   done
   ```
2. **Remove only the `-cn` subdirectories** that were created during this session (never other directories):
   ```bash
   rm -rf <target-dir>/*-cn/
   ```
3. **Do NOT remove any non-PDF files from the target directory** — the user may have source files, notes, or other documents there.
4. **Do NOT rename any files that were already present** before the translation session.

**⚠️ Never initiate cleanup as part of the translation workflow.** Only do it when the user explicitly commands it.

**⚠️ If you accidentally delete user files, stop immediately and ask the user for help recovering them.**

## Pre-compilation Checklist

Before running xelatex, verify:
- [ ] `ctex` package added to main `.tex`
- [ ] Chinese fonts available (`fc-list :lang=zh`)
- [ ] `xelatex` binary available (`which xelatex`)
- [ ] All `\input{}`d files exist in the `-cn` directory
- [ ] Figure files (`figs/`) copied to `-cn` directory
- [ ] Bibliography resolved (`.bbl` present or `.bib` + bibtex working)
- [ ] **Post-Translation Macro Fix applied** — run the Python script to insert `{}` after macros followed by CJK characters

## Anti-patterns (DO NOT DO)

- Do NOT translate content files yourself — always delegate to parallel subagents
- Do NOT delegate to any agent other than `worker` — always use pi's `subagent` tool with `agent: "worker"`
- Do NOT poll or sleep to wait for subagents — pi delivers each result automatically when it finishes
- Do NOT skip abstract translation — abstract is content and must be translated like any other section
- Do NOT translate comments (`% ...`) in tex files
- **Do NOT translate figures/tables** — content inside `figure` / `table` / `wraptable` / `wrapfigure` / `subfigure` environments stays 100% English, **including their `\caption{...}` and all tabular cell text**
- **Do NOT translate code blocks** — `lstlisting` / `verbatim` / `minted` content (including escaped `\%` fragments) stays verbatim English
- **Do NOT translate pseudocode** — `algorithm` / `algorithmic` environments (`\Require`, `\Ensure`, `\State`, `\Comment{...}`, `\ForEach{...}`, `\Procedure{...}` lines) stay verbatim English; only the algorithm `\caption{...}` is translated (algorithm captions ARE text content)
- **Do NOT translate code tokens** — `\texttt{...}` / `\ttt{...}` content stays English
- Do NOT leave body prose untranslated — all active paragraphs and headings must be translated
- Do NOT modify LaTeX structure or macros
- **Do NOT forget the Post-Translation Macro Fix** — failing to insert `{}` after macros followed by CJK characters will cause all such macros to be "undefined" and silently drop surrounding text
- Do NOT clean up working directories after translation — preserve all intermediate files unless the user explicitly asks otherwise
- **Do NOT use wildcard/find deletions (`rm -f *.pdf`, `find ... | xargs rm`) during cleanup** — always target specific `-cn` files/directories by name
- **Do NOT delete or touch any user files that were in the target directory BEFORE the translation session** — list the directory first, only remove what you created

## Example Session

```
User: https://arxiv.org/abs/2503.23611 翻译成中文

Assistant:
  → Phase 1: Download, extract, identify files
  → Phase 2: Add ctex to paper.tex, modify bibliography
  → Phase 3: Classify — 6 content files (translate), 4 figure/table files (skip — stay English), 2 preamble files (skip)
  → Phase 4: Fire parallel `worker` subagents via pi's `subagent` tool (content files only)
  → Wait for all completions
  → Phase 5: xelatex ×3 → main.pdf
  → Phase 6: Verify fonts, report "PDF <title>-cn/main.pdf (10 pages)"
```
