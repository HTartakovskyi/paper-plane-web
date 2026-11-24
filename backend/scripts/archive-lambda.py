"""Create and read back a portable ZIP; no dependencies beyond Python stdlib."""
import pathlib
import stat
import sys
import zipfile

source = pathlib.Path(sys.argv[1]).resolve()
target = pathlib.Path(sys.argv[2]).resolve()
assert not target.is_relative_to(source), 'ZIP must be outside source'
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(source.rglob('*')):
        assert not path.is_symlink(), f'Symlink: {path}'
        if path.is_file():
            info = zipfile.ZipInfo(path.relative_to(source).as_posix(), (2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            # Prisma's Linux schema engine must retain its executable permission.
            mode = 0o755 if path.stat().st_mode & 0o111 else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None, 'ZIP CRC failed'
    assert 'index.mjs' in archive.namelist(), 'Entrypoint must be at ZIP root'
    assert sum(item.file_size for item in archive.infolist()) < 250 * 1024**2
if '--s3-upload' not in sys.argv:
    assert target.stat().st_size < 50 * 1024**2, 'Exceeds direct Lambda ZIP upload limit'
print(f'ZIP verified: {target.stat().st_size} bytes')
