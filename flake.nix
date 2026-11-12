{
  description = "opengh: a familiar terminal interface for GitHub";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # aarch64-darwin, aarch64-linux and x86_64-linux.
    systems.url = "github:nix-systems/triplet";
    bun2nix.url = "github:nix-community/bun2nix?ref=2.1.2";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
    bun2nix.inputs.systems.follows = "systems";
  };

  # Prebuilt bun2nix, so installing opengh does not compile it first.
  nixConfig = {
    extra-substituters = [ "https://nix-community.cachix.org" ];
    extra-trusted-public-keys = [ "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs=" ];
  };

  outputs =
    {
      nixpkgs,
      systems,
      bun2nix,
      ...
    }:
    {
      packages = nixpkgs.lib.genAttrs (import systems) (
        system:
        let
          opengh = nixpkgs.legacyPackages.${system}.callPackage ./nix/package.nix {
            bun2nix = bun2nix.packages.${system}.default;
          };
        in
        {
          inherit opengh;
          default = opengh;
        }
      );
    };
}
