default:
    @just --list

check: fmt md-fmt lint compile test

compile:
    tsc --noEmit

fmt:
    npx @biomejs/biome format --write .

lint:
    npx @biomejs/biome lint .

md-fmt:
    dprint fmt --staged --allow-no-files

remove-hooks:
    rm -f .git/hooks/pre-commit
    echo "✓ Pre-commit hook removed"

setup: && setup-hooks
    npm install

setup-hooks:
    #!/usr/bin/env sh
    echo '#!/bin/sh' > .git/hooks/pre-commit
    echo 'just check || exit 1' >> .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
    echo "✓ Pre-commit hook installed"

test:
    npm test
