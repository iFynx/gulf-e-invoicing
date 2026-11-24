#!/usr/bin/env bash
# Validates every out/*.xml against the official Peppol PINT AE Schematron
# (as published in the phive-rules project) with Saxon HE. Used by the
# "UAE PINT AE validation" workflow.
set -euo pipefail
cd "$(dirname "$0")/.."
VER=2026.11   # PINT AE 1.0.5
RULES=https://raw.githubusercontent.com/phax/phive-rules/master/phive-rules-peppol-pint/src/main/resources/external/schematron/pint-ae/$VER/billing
mkdir -p .cache out
cd .cache
get() { [ -f "$1" ] || { echo "GET $2"; curl -fsSL --retry 3 -o "$1" "$2"; }; }
get saxon.jar https://repo1.maven.org/maven2/net/sf/saxon/Saxon-HE/12.5/Saxon-HE-12.5.jar
get xmlresolver.jar https://repo1.maven.org/maven2/org/xmlresolver/xmlresolver/5.2.2/xmlresolver-5.2.2.jar
for x in PINT-UBL-validation-preprocessed.xslt PINT-jurisdiction-aligned-rules.xslt; do
  get "$x" "$RULES/$x"
done
cd ..
status=0
for f in out/*.xml; do
  for x in PINT-UBL-validation-preprocessed.xslt PINT-jurisdiction-aligned-rules.xslt; do
    java -cp .cache/saxon.jar:.cache/xmlresolver.jar net.sf.saxon.Transform -s:"$f" -xsl:".cache/$x" -o:.cache/svrl.xml
    python3 validate/svrl.py "$f" "$x" .cache/svrl.xml || status=1
  done
done
# Negative controls must fail, or the validator is not really checking.
for f in out/negative/*.xml; do
  java -cp .cache/saxon.jar:.cache/xmlresolver.jar net.sf.saxon.Transform -s:"$f" -xsl:.cache/PINT-jurisdiction-aligned-rules.xslt -o:.cache/svrl.xml
  if python3 validate/svrl.py "$f" PINT-jurisdiction-aligned-rules.xslt .cache/svrl.xml; then
    echo "ERROR: negative control $f passed"; status=1
  else
    echo "ok: negative control $f was rejected as expected"
  fi
done
exit $status
