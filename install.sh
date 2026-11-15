#!/bin/sh
# Installs the opengh executable for this machine.
#
#   curl -fsSL https://github.com/leohenon/opengh/releases/latest/download/install.sh | sh
#
# Environment:
#   OPENGH_VERSION      Release to install, such as 0.1.0. Default: the latest release.
#   OPENGH_INSTALL_DIR  Directory for the executable. Default: ~/.local/bin.
#   OPENGH_INSTALL_NAME Executable filename. Default: opengh.
set -eu

repository="leohenon/opengh"

fail() {
  printf '%sopengh install:%s %s\n' "${red-}" "${reset-}" "$1" >&2
  exit 1
}

setup_output() {
  fancy='' progress='' updating='' bold='' dim='' green='' orange='' red='' reset='' hide_cursor='' show_cursor=''
  if [ -n "${OPENGH_UPDATE_FROM:-}" ]; then updating=1; fi
  if [ -t 1 ]; then progress=1; fi
  if [ -n "$progress" ] && [ -z "$updating" ]; then fancy=1; fi
  esc=$(printf '\033')
  if [ -n "$fancy" ] && [ "${TERM:-}" != dumb ]; then
    hide_cursor="${esc}[?25l" show_cursor="${esc}[?25h"
  fi
  if [ -n "$progress" ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != dumb ]; then
    bold="${esc}[1m" dim="${esc}[2m" green="${esc}[32m" orange="${esc}[38;5;208m" reset="${esc}[0m"
    if [ -n "$fancy" ] && [ -t 2 ]; then red="${esc}[31m"; fi
  fi
}

utf8() {
  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in *[Uu][Tt][Ff]-8* | *[Uu][Tt][Ff]8*) return 0 ;; esac
  return 1
}

columns() {
  size=$({ stty size </dev/tty; } 2>/dev/null || true)
  width=${size#* }
  case "$width" in '' | 0 | *[!0-9]*) width=$(tput cols 2>/dev/null || echo 80) ;; esac
  printf '%s\n' "$width"
}

logo() {
  b=$reset$bold o=$orange r=$reset
  printf '\n'
  if ! utf8 || [ "$(columns)" -lt 60 ]; then
    printf '  %s>_%s %sopengh%s\n\n' "$o" "$r" "$b" "$r"
    return
  fi
  printf '%s\n' "    ${b}▄▄██████▄▄${r}"
  printf '%s\n' "  ${b}▄████████████▄${r}"
  printf '%s\n' " ${b}▟██ ▝▀▀▀▀▀▀▘ ██▙                                  █${r}"
  printf '%s\n' "${b}▟██▛  ${o}▀▄      ${b}▜██▙   █▀▀█  █▀▀█  █▀▀█  █▀▀█  █▀▀█  █▀▀█${r}"
  printf '%s\n' "${b}███    ${o}▄▀      ${b}███   █  █  █  █  █▀▀▀  █  █  █  █  █  █${r}"
  printf '%s\n' "${b}▜██▖  ${o}▀  ▀▀▀▘ ${b}▗██▛   █▄▄█  █▄▄█  █▄▄▄  █  █  █▄▄█  █  █${r}"
  printf '%s\n' "${b}▝██▀▙▄▄    ▄▄▟███▘         █                 ▄▄▄█${r}"
  printf '%s\n' "  ${b}▜▙▖▀▀    ▜███▛${r}"
  printf '%s\n' "   ${b}▝▀▜▌    ▐▛▀▘${r}"
  printf '\n'
}

step() {
  if [ -n "$fancy" ]; then printf '  %s\n' "$1"; fi
}

tilde() {
  case "$1" in "$HOME"/*) printf '~%s\n' "${1#"$HOME"}" ;; *) printf '%s\n' "$1" ;; esac
}

path_command() {
  case "$1" in *[\'\"\\\$\`]*) return 0 ;; esac
  case "$1" in "$HOME"/*) value="\$HOME${1#"$HOME"}" ;; *) value=$1 ;; esac
  shell=${SHELL:-}
  case "${shell##*/}" in
    zsh) printf "echo 'export PATH=\"%s:\$PATH\"' >> ~/.zshrc\n" "$value" ;;
    bash)
      if [ "$os" = darwin ]; then rc=~/.bash_profile; else rc=~/.bashrc; fi
      printf "echo 'export PATH=\"%s:\$PATH\"' >> %s\n" "$value" "$(tilde "$rc")" ;;
    fish) printf 'fish_add_path "%s"\n' "$value" ;;
    *) printf "export PATH=\"%s:\$PATH\"\n" "$value" ;;
  esac
}

finish() {
  if [ -n "$updating" ]; then return; fi
  case ":$PATH:" in *":$2:"*) on_path=1 ;; *) on_path= ;; esac
  if [ -z "$fancy" ]; then
    printf 'Installed %s to %s\n' "$1" "$2/$3"
    if [ -z "$on_path" ]; then printf 'Add %s to your PATH to run it as "%s".\n' "$2" "$3"; fi
    command -v gh >/dev/null 2>&1 || printf 'opengh needs the GitHub CLI: https://cli.github.com\n'
    return
  fi
  if utf8; then check='✓'; else check='+'; fi
  printf '%s%s%s Installed %s%s%s to %s\n' "$green" "$check" "$reset" "$bold" "$1" "$reset" "$(tilde "$2/$3")"
  if [ -z "$on_path" ]; then
    add_path=$(path_command "$2")
    if [ -n "$add_path" ]; then
      printf '\n  %s is not on your PATH. Add it, then open a new terminal:\n    %s\n' "$(tilde "$2")" "$add_path"
    else
      printf '\n  Add %s to your PATH, then open a new terminal.\n' "$2"
    fi
  fi
  if ! command -v gh >/dev/null 2>&1; then
    printf '\n  opengh uses the GitHub CLI. Install it, then sign in:\n'
    if [ "$os" = darwin ] && command -v brew >/dev/null 2>&1; then
      printf '    brew install gh\n'
    else
      printf '    https://cli.github.com\n'
    fi
    printf '    gh auth login --hostname github.com\n'
  elif ! signed_in; then
    printf '\n  The GitHub CLI is not signed in. Sign in with:\n    gh auth login --hostname github.com\n'
  fi
  printf '\n  Get started:\n    %s%s%s\n\n' "$bold" "$3" "$reset"
}

signed_in() {
  if gh auth token --hostname github.com >/dev/null 2>"$work/gh-error"; then return 0; fi
  # gh before 2.17 has no auth token command.
  grep -qi 'unknown' "$work/gh-error"
}


uses_musl() {
  # musl's ldd names itself; glibc's does not mention musl.
  ldd --version 2>&1 | grep -qi musl && return 0
  ls /lib/ld-musl-* >/dev/null 2>&1
}

repeat() {
  count=0 repeated=''
  while [ "$count" -lt "$2" ]; do repeated="$repeated$1" count=$((count + 1)); done
  printf '%s' "$repeated"
}

megabytes() {
  tenths=$(($1 * 10 / 1048576))
  printf '%d.%d' $((tenths / 10)) $((tenths % 10))
}

draw_progress() {
  got=0
  if [ -f "$1" ]; then got=$(($(wc -c <"$1"))); fi
  total=$(awk 'tolower($1) == "content-length:" { size = $2 } END { print size + 0 }' "$1.headers" 2>/dev/null || echo 0)
  if [ "$total" -gt 0 ]; then
    if [ "$got" -gt "$total" ]; then got=$total; fi
    filled=$((got * 32 / total))
    printf '\r  %s%s%s%s%s  %3d%%  %5s / %s MB' "$orange" "$(repeat ━ "$filled")" "$dim" "$(repeat ─ $((32 - filled)))" "$reset" \
      $((got * 100 / total)) "$(megabytes "$got")" "$(megabytes "$total")"
  elif [ "$got" -eq 0 ]; then
    printf '\r  %s%s%s' "$dim" "$(repeat ─ 32)" "$reset"
  else
    printf '\r  %5s MB' "$(megabytes "$got")"
  fi
}

download_with_progress() {
  curl -fsSL "$1" -o "$2" -D "$2.headers" --connect-timeout 15 --max-time 120 2>"$2.error" &
  download_pid=$!
  printf '%s' "$hide_cursor"
  while kill -0 "$download_pid" 2>/dev/null; do
    draw_progress "$2"
    sleep 0.1 2>/dev/null || sleep 1
  done
  if wait "$download_pid"; then status=0; else status=$?; fi
  download_pid=''
  if [ "$status" -eq 0 ]; then draw_progress "$2"; fi
  printf '\n%s' "$show_cursor"
  if [ "$status" -ne 0 ]; then cat "$2.error" >&2; fi
  return "$status"
}

download() {
  if command -v curl >/dev/null 2>&1; then
    if [ -n "${3:-}" ] && [ -n "$progress" ]; then
      if utf8 && [ "${TERM:-}" != dumb ]; then
        download_with_progress "$1" "$2"
        return
      fi
      if [ -t 2 ]; then
        curl -fSL --progress-bar "$1" -o "$2" --connect-timeout 15 --max-time 120
        return
      fi
    fi
    curl -fsSL "$1" -o "$2" --connect-timeout 15 --max-time 120
  elif command -v wget >/dev/null 2>&1; then
    wget -T 120 -qO "$2" "$1"
  else
    fail "curl or wget is required."
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    fail "sha256sum or shasum is required to verify the download."
  fi
}

# Everything runs from main, called on the last line, so a truncated download executes nothing.
main() {
  setup_output
  if [ -n "$fancy" ]; then logo; fi
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) fail "unsupported operating system: $(uname -s). opengh runs on macOS and Linux." ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) cpu=arm64 ;;
    x86_64 | amd64) cpu=x64 ;;
    *) fail "unsupported architecture: $(uname -m)." ;;
  esac
  # A translated shell on Apple silicon reports x86_64; install the native executable.
  if [ "$os" = darwin ] && [ "$cpu" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    cpu=arm64
  fi
  target="$os-$cpu"
  if [ "$os" = linux ] && uses_musl; then
    target="$target-musl"
  fi

  version="${OPENGH_VERSION:-}"
  version="${version#v}"
  if [ -n "${OPENGH_DOWNLOAD_BASE_URL:-}" ]; then
    base="$OPENGH_DOWNLOAD_BASE_URL" # Another copy of a release's files, for testing.
  elif [ -n "$version" ]; then
    base="https://github.com/$repository/releases/download/v$version"
  else
    base="https://github.com/$repository/releases/latest/download"
  fi
  directory="${OPENGH_INSTALL_DIR:-$HOME/.local/bin}"
  name="${OPENGH_INSTALL_NAME:-opengh}"
  case "$name" in . | .. | */*) fail "OPENGH_INSTALL_NAME must be a filename, not a path." ;; esac
  archive="opengh-$target.tar.gz"

  work=$(mktemp -d)
  staged=
  download_pid=''
  trap 'if [ -n "$download_pid" ]; then kill "$download_pid" 2>/dev/null || true; printf "\n%s" "$show_cursor"; fi
    rm -rf "$work"; if [ -n "$staged" ]; then rm -f "$staged"; fi' EXIT
  trap 'exit 1' INT TERM

  case "$os" in darwin) platform=macOS ;; *) platform=Linux ;; esac
  case "$target" in *-musl) platform="$platform ($cpu, musl)" ;; *) platform="$platform ($cpu)" ;; esac
  step "Downloading opengh ${version:-(latest release)} for $platform"
  download "$base/$archive" "$work/$archive" progress || fail "could not download $base/$archive."
  step "Verifying the download"
  download "$base/SHA256SUMS" "$work/SHA256SUMS" || fail "could not download $base/SHA256SUMS."
  expected=$(awk -v name="$archive" '$2 == name { print $1 }' "$work/SHA256SUMS")
  [ -n "$expected" ] || fail "no checksum is published for $archive."
  [ "$(sha256 "$work/$archive")" = "$expected" ] || fail "checksum mismatch for $archive; nothing was installed."

  tar -xzf "$work/$archive" -C "$work"
  mkdir -p "$directory"
  [ ! -d "$directory/$name" ] || fail "$directory/$name is a directory; nothing was installed."
  # Test on the destination filesystem before replacing a working installation.
  staged=$(mktemp "${OPENGH_UPDATE_STAGE_DIR:-$directory}/.opengh.XXXXXX")
  cp "$work/opengh-$target/opengh" "$staged"
  chmod 755 "$staged"
  installed=$("$staged" --version 2>/dev/null) || {
    if [ "$target" != "${target%-musl}" ]; then
      fail "downloaded opengh does not start; nothing was installed. On Alpine, run: apk add libstdc++ libgcc"
    fi
    fail "downloaded opengh does not start; nothing was installed."
  }
  [ -z "$version" ] || [ "$installed" = "opengh $version" ] || fail "downloaded executable has the wrong version; nothing was installed."
  # The self-updater pins the version it started from. Do not overwrite another completed update.
  if [ -n "${OPENGH_UPDATE_FROM:-}" ]; then
    current=$("$directory/$name" --version 2>/dev/null) || fail "the installed executable changed or cannot start; nothing was installed."
    [ "$current" = "opengh $OPENGH_UPDATE_FROM" ] || fail "the installed version changed during the update; nothing was installed."
  fi
  # Replace in one step, so an opengh that is running keeps its own copy.
  mv -f "$staged" "$directory/$name"
  staged=
  finish "$installed" "$directory" "$name"
}

main "$@"
