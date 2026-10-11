# Project Book build

Source of the book: `../content/*.md` (structured Hebrew content) and `../figures/`.
Output: `../BetterCart_Project_Book.docx` (editable master) and `../BetterCart_Project_Book.pdf`.

```bash
npm install                    # once (docx, jszip)
../figures/render_figures.sh   # only after editing a diagram in ../figures/src (needs Google Chrome)
node build.cjs                 # content -> DOCX with real Word styles
./export_pdf.sh                # Word refreshes TOC / lists, saves the DOCX, exports the PDF
```

`export_pdf.sh` drives Microsoft Word, because the David font required by the college
guidelines ships only with Word on this machine. Visual QA helpers: `render_pages.py`,
`contact_sheet.py` (PyMuPDF).

**If the DOCX is edited by hand in Word, do not run `node build.cjs` again** — it rebuilds
the DOCX from `../content` and overwrites manual edits. Either edit the content files and
rebuild, or continue in Word only and export the PDF from Word.

## Content markup

| Markup | Result |
|---|---|
| `# פרק N — title`, `## N.M title`, `### N.M.K title` | Heading 1–3 (feed the table of contents) |
| `Table: N.M \| caption` + optional `Widths: a,b,c` before a pipe table | captioned table (feeds the list of tables) |
| `!fig[N.M\|file\|caption\|width%]` | figure with caption (feeds the list of figures) |
| `$$ ...` | numbered display equation (`\frac{}{}`, `\sum_{}{}`, `_`, `^`, `\cdot` …) |
| `$...$`, `` `...` ``, `**...**`, `*...*` | inline formula, code, bold, italic |
| ```` ```algo title="..." ```` | pseudocode box with line numbers |
| `::: decision / limit / note / insight / todo` … `:::` | callout box |
| `[[text]]` | highlighted placeholder "להשלמה" |
| `@@cover`, `@@toc`, `@@lof`, `@@lot`, `@@title` | front-matter elements (cover data in `content/meta.json`) |
