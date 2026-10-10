"""Refresh the offline cache version after changing the app or its assets."""
from pathlib import Path
import hashlib
import json
import re

root = Path(__file__).resolve().parent.parent
editor = (root / 'edit.html').read_text()
imports = json.loads(re.search(r'<script type="importmap">\s*(.*?)\s*</script>', editor, re.S)[1])['imports']
imports['ignore'] = 'https://esm.sh/ignore@7.0.5'
files = [root / name for name in ('index.html', 'edit.html', 'pwa.js', 'manifest.webmanifest')]
files += sorted((root / 'assets').glob('*'))
version = hashlib.sha256(b''.join(path.read_bytes() for path in files if path.is_file())).hexdigest()[:12]
path = root / 'sw.js'
source = path.read_text()
source = re.sub(r"const CACHE = '[^']+';", f"const CACHE = 'open-notes-{version}';", source, count=1)
source = re.sub(r'const MODULES = .*?;\n', lambda _: 'const MODULES = ' + json.dumps(imports) + ';\n', source, count=1)
path.write_text(source)
print(f'Offline cache: open-notes-{version}')
