"""Prints the failed asserts in an SVRL report; exits 1 if any is fatal."""
import sys
import xml.etree.ElementTree as ET

src, rules, path = sys.argv[1:4]
ns = {'svrl': 'http://purl.oclc.org/dsdl/svrl'}
fails = ET.parse(path).getroot().findall('.//svrl:failed-assert', ns)
fatal = [f for f in fails if f.get('flag') == 'fatal']
print(f'{src} [{rules}]: {len(fails)} failed assert(s), {len(fatal)} fatal')
for f in fails:
    text = ' '.join((f.findtext('svrl:text', '', ns) or '').split())
    print(f"  {f.get('flag')}: {text[:220]}")
sys.exit(1 if fatal else 0)
