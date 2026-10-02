from pathlib import Path
import sys, os, subprocess, json, base64, shutil
from urllib.parse import urlparse, parse_qs

qa = Path('.netlify/stage7-qa')
sys.path.insert(0, str(qa / 'pydeps'))
from PIL import Image
import zxingcpp

renderer = os.environ.get('QA_PDFTOPPM') or shutil.which('pdftoppm')
if not renderer:
    raise RuntimeError('Definir QA_PDFTOPPM con Poppler antes de renderizar')
proof = []
for pdf in sorted(qa.glob('pdf-mock-*-*.pdf')):
    prefix = pdf.with_suffix('')
    subprocess.run([renderer, '-png', '-singlefile', '-r', '150', str(pdf), str(prefix)], check=True, capture_output=True)
    symbols = zxingcpp.read_barcodes(Image.open(prefix.with_suffix('.png')))
    assert len(symbols) == 1, pdf.name
    url = urlparse(symbols[0].text)
    assert url.scheme == 'https' and url.netloc == 'www.arca.gob.ar' and url.path == '/fe/qr/'
    payload = json.loads(base64.b64decode(parse_qs(url.query)['p'][0], validate=True))
    kind = pdf.stem.rsplit('-', 1)[1]
    assert payload['importe'] == 1000 and payload['tipoCmp'] == (1 if kind == 'A' else 6)
    assert payload['ptoVta'] == 8 and payload['nroCmp'] == 320
    assert payload['cuit'] == 20123456786 and payload['codAut'] == 12345678901234
    assert payload['tipoDocRec'] == (80 if kind == 'A' else 99)
    assert payload['nroDocRec'] == (20164755100 if kind == 'A' else 0)
    proof.append({'file': pdf.name, 'decoder': 'zxing-cpp', 'decoded': True, 'fixture': 'MOCK LOCAL - SIN EMISION', 'payload': payload})
assert len(proof) == 6
(qa / 'qr-proof.json').write_text(json.dumps(proof, indent=2), encoding='utf-8')
print('PDF/QR mock: 6 verificados, 0 fallos, 0 emisiones reales.')
