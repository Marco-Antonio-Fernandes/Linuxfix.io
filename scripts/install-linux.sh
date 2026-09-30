#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

npm run build:linux

appimage="$(find "$project_root/src-tauri/target/release/bundle/appimage" -maxdepth 1 -type f -name '*.AppImage' -print -quit)"
if [[ -z "$appimage" ]]; then
  echo "AppImage não foi gerado." >&2
  exit 1
fi

install_dir="${XDG_BIN_HOME:-$HOME/.local/bin}"
mkdir -p "$install_dir"
install -Dm755 "$appimage" "$install_dir/fixio-shell"

mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/applications"
icon_dir="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps"
install -Dm644 "$project_root/src-tauri/icons/icon.png" "$icon_dir/fixio-shell.png"
sed "s#@EXEC@#$install_dir/fixio-shell#g" \
  "$project_root/packaging/fixio-shell.desktop.in" \
  > "${XDG_DATA_HOME:-$HOME/.local/share}/applications/fixio-shell.desktop"

echo "Fixio Shell instalado em $install_dir/fixio-shell"
echo "Abra pelo menu do KDE ou execute: $install_dir/fixio-shell"
