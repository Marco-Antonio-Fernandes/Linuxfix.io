#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Este script deve ser executado no Arch Linux." >&2
  exit 1
fi

if ! command -v pacman >/dev/null 2>&1; then
  echo "pacman não foi encontrado. Este projeto exige Arch Linux." >&2
  exit 1
fi

sudo pacman -Syu --needed \
  base-devel curl wget file openssl \
  webkit2gtk-4.1 appmenu-gtk-module libappindicator-gtk3 librsvg \
  nodejs npm rustup

if ! rustup toolchain list | grep -q '^stable'; then
  rustup default stable
fi

echo
echo "Dependências do Fixio Shell instaladas."
echo "Wine é opcional para atalhos .exe: sudo pacman -S --needed wine winetricks"
