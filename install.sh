#!/bin/sh
# Installs the opengh executable for this machine.
#
#   curl -fsSL https://github.com/leohenon/opengh/releases/latest/download/install.sh | sh
#
# Environment:
#   OPENGH_VERSION      Release to install, such as 0.1.0. Default: the latest release.
#   OPENGH_INSTALL_DIR  Directory for the executable. Default: ~/.local/bin.
set -eu

repository="leohenon/opengh"

fail() {
  printf 'opengh install: %s\n' "$1" >&2
  exit 1
}

uses_musl() {
  # musl's ldd names itself; glibc's does not mention musl.
  ldd --version 2>&1 | grep -qi musl && return 0
  ls /lib/ld-musl-* >/dev/null 2>&1
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
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
  archive="opengh-$target.tar.gz"

  work=$(mktemp -d)
  staged=
  trap 'rm -rf "$work"; if [ -n "$staged" ]; then rm -f "$staged"; fi' EXIT
  trap 'exit 1' INT TERM

  download "$base/$archive" "$work/$archive" || fail "could not download $base/$archive."
  download "$base/SHA256SUMS" "$work/SHA256SUMS" || fail "could not download $base/SHA256SUMS."
  expected=$(awk -v name="$archive" '$2 == name { print $1 }' "$work/SHA256SUMS")
  [ -n "$expected" ] || fail "no checksum is published for $archive."
  [ "$(sha256 "$work/$archive")" = "$expected" ] || fail "checksum mismatch for $archive; nothing was installed."

  tar -xzf "$work/$archive" -C "$work"
  mkdir -p "$directory"
  [ ! -d "$directory/opengh" ] || fail "$directory/opengh is a directory; nothing was installed."
  # Test on the destination filesystem before replacing a working installation.
  staged=$(mktemp "$directory/.opengh.XXXXXX")
  cp "$work/opengh-$target/opengh" "$staged"
  chmod 755 "$staged"
  installed=$("$staged" --version 2>/dev/null) || {
    if [ "$target" != "${target%-musl}" ]; then
      fail "downloaded opengh does not start; nothing was installed. On Alpine, run: apk add libstdc++ libgcc"
    fi
    fail "downloaded opengh does not start; nothing was installed."
  }
  # Replace in one step, so an opengh that is running keeps its own copy.
  mv -f "$staged" "$directory/opengh"
  staged=
  printf 'Installed %s to %s\n' "$installed" "$directory/opengh"
  case ":$PATH:" in
    *":$directory:"*) ;;
    *) printf 'Add %s to your PATH to run it as "opengh".\n' "$directory" ;;
  esac
  command -v gh >/dev/null 2>&1 || printf 'opengh needs the GitHub CLI: https://cli.github.com\n'
}

main "$@"
