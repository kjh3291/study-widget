"""Verify the packaged app and catch immediate startup crashes (run on macOS)."""
import pathlib
import plistlib
import subprocess
import sys

app = pathlib.Path(sys.argv[1]).resolve()
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
with (app / 'Contents/Info.plist').open('rb') as f:
    info = plistlib.load(f)
process = subprocess.Popen([str(app / 'Contents/MacOS' / info['CFBundleExecutable'])])
try:
    try:
        code = process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        print('PASS: signature valid; app stayed running for 15 seconds')
    else:
        raise SystemExit(f'FAIL: app exited during startup (code {code})')
finally:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
