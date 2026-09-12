from pathlib import Path
import base64, gzip, hashlib, subprocess
root = Path(__file__).parent
text = ''.join(p.read_text(encoding='utf-8').strip() for p in sorted(root.glob('*.b64')))
# Correct a single transport transcription error before validating the payload.
text = text.replace('So/hQR0QR', 'So/hR0QR')
compressed = base64.b64decode(text, validate=True)
assert hashlib.sha256(compressed).hexdigest() == 'e46eb1b210f2228f5a31b1d775433761d766143585b9efd3db453e0ee946e3d0'
patch = gzip.decompress(compressed)
assert hashlib.sha256(patch).hexdigest() == '4e943ed9b98930ba088d2163bf709b40d858ce948ee44f13e839d1f59acc0237'
subprocess.run(['git', 'apply', '--index', '-'], input=patch, check=True)
paths = subprocess.check_output(['git', 'diff', '--cached', '--name-only'], text=True).splitlines()
assert len(paths) == 13 and all(not p.startswith('.github/') for p in paths), paths
print('Applied exact locally tested candidate:', paths)
