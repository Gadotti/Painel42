import json
import os
import zipfile
from pathlib import Path
from fnmatch import fnmatch

EXTRA_IGNORED_PATHS = {
    '.git',
    '.gitignore',
    '.gitattributes',
    'release.py',
    '.claude',
    'CLAUDE.md',
    'tests',
    'jest.setup.js',
    'imgs',
    '.github',       # CI/CD — não necessário no pacote de deploy
    '.dockerignore', # usado apenas no build da imagem
}

# Files that should be renamed with -SAMPLE suffix in the zip
# so production configs are not overwritten on deploy
SAMPLE_FILES = {
    'server-config.json',
    'websocket-config.json',
}

def load_gitignore_patterns(gitignore_path):
    patterns = []
    if gitignore_path.exists():
        with gitignore_path.open('r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                patterns.append(line)
    return patterns

def is_ignored(path, patterns, base_dir):
    rel_path = path.relative_to(base_dir).as_posix()

    # Ignorar explicitamente os arquivos/pastas extra
    if rel_path in EXTRA_IGNORED_PATHS or any(rel_path.startswith(p + '/') for p in EXTRA_IGNORED_PATHS):
        return True

    for pattern in patterns:
        if pattern.endswith('/'):
            if rel_path.startswith(pattern.rstrip('/')):
                return True
        elif fnmatch(rel_path, pattern):
            return True
    return False

def get_version(version_path):
    with version_path.open('r') as f:
        data = json.load(f)
        return data.get('version', '0.0.0')

def create_release_zip(base_dir):
    base_dir = Path(base_dir).resolve()
    version_path = base_dir / 'version.json'
    gitignore_path = base_dir / '.gitignore'
    deploy_dir = base_dir / '_deploys'

    version = get_version(version_path)
    zip_name = f'{version}.zip'
    zip_path = deploy_dir / zip_name

    deploy_dir.mkdir(exist_ok=True)

    patterns = load_gitignore_patterns(gitignore_path)

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for path in base_dir.rglob('*'):
            if path.is_dir():
                continue
            if path == zip_path:
                continue
            if is_ignored(path, patterns, base_dir):
                continue
            rel_path = path.relative_to(base_dir)

            # Rename config files to -SAMPLE so they don't overwrite production
            if rel_path.name in SAMPLE_FILES:
                stem = rel_path.stem
                suffix = rel_path.suffix
                arc_path = rel_path.with_name(f'{stem}-SAMPLE{suffix}')
            else:
                arc_path = rel_path

            zipf.write(path, arc_path)

    print(f"Release criado com sucesso: {zip_path}")

if __name__ == '__main__':
    create_release_zip('.')
