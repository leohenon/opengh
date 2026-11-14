# Installation

Install opengh on macOS or Linux, then sign in with GitHub CLI.

## Install opengh

Choose one method:

```sh
# Curl
curl -fsSL https://github.com/leohenon/opengh/releases/latest/download/install.sh | sh

# Homebrew
brew install leohenon/tap/opengh

# npm
npm install --global @leohenon/opengh

# Nix
nix profile install github:leohenon/opengh#opengh nixpkgs#gh
```

The curl installer places the executable in `~/.local/bin`. If needed, add that directory to your shell's `PATH`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Add the same line to your shell startup file to keep it across sessions.

## Authenticate

Install [GitHub CLI](https://cli.github.com/) if `gh` is not available, then sign in:

```sh
gh auth login --hostname github.com
gh auth status
```

opengh uses your GitHub CLI credentials. Repository access and available actions depend on that account's permissions.

## First launch

```sh
opengh .               # Current directory's repository
opengh owner/repo      # Or an explicit repository
```

Continue with the [usage](usage.md).

## Update

```sh
opengh update
```

## Troubleshooting

- **Alpine binary does not start:** install runtime libraries with `apk add libstdc++ libgcc`.
