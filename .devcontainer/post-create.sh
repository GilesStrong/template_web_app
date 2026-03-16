#!/usr/bin/env bash
set -euo pipefail

# --- bun install (user-local) ---
if [ ! -x "$HOME/.bun/bin/bun" ]; then
  curl -fsSL https://bun.com/install | bash
fi

# Ensure bun available in *this* script run
export PATH="$HOME/.bun/bin:$PATH"

# --- Persist bun for fish (correct way) ---
mkdir -p "$HOME/.config/fish/conf.d"
cat > "$HOME/.config/fish/conf.d/10-bun.fish" <<'EOF'
# Added by devcontainer post-create: bun
if test -d "$HOME/.bun/bin"
    fish_add_path "$HOME/.bun/bin"
end
EOF

# --- python deps + hooks ---
uv sync --frozen --dev
uv tool install pre-commit --with pre-commit-uv --force-reinstall
uvx pre-commit install
