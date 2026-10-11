#!/bin/zsh
# Opens the built DOCX in Microsoft Word (the only local source of the David font),
# refreshes the table of contents / lists of figures and tables, saves the refreshed
# DOCX and exports the PDF.  Usage: ./export_pdf.sh [input.docx] [output-dir]
set -e
HERE="${0:A:h}"
IN="${1:-$HERE/../BetterCart_Project_Book.docx}"
OUTDIR="${2:-$HERE/..}"
NAME="${3:-BetterCart_Project_Book}"   # output base name; the master edition keeps the default
WORK="$HOME/Library/Group Containers/UBF8T346G9.Office/bcbook"   # Word's sandbox can read/write here
mkdir -p "$WORK"; rm -f "$WORK"/book.docx "$WORK"/book_out.docx "$WORK"/book.pdf
cp "$IN" "$WORK/book.docx"
osascript - "$WORK/book.docx" "$WORK/book.pdf" "$WORK/book_out.docx" <<'OSA'
on run argv
  set inPath to item 1 of argv
  set outPdf to item 2 of argv
  set outDocx to item 3 of argv
  tell application "Microsoft Word"
    launch
    set display alerts to none
    open file name inPath
    set d to active document
    repeat 2 times
      try
        repeat with t in (get tables of contents of d)
          update t
        end repeat
      end try
    end repeat
    save as d file name outDocx file format format document
    save as active document file name outPdf file format format PDF
  end tell
  -- Closing is best effort: after "save as" Word may hold the document under a new reference.
  try
    with timeout of 30 seconds
      tell application "Microsoft Word" to close every document saving no
    end timeout
  end try
  return "exported"
end run
OSA
cp "$WORK/book_out.docx" "$OUTDIR/$NAME.docx"
cp "$WORK/book.pdf" "$OUTDIR/$NAME.pdf"
echo "PDF: $OUTDIR/$NAME.pdf"
