// Stamps the version from package.json into both manifests so the version is
// visible in Minecraft's pack list (name + description).
// package.json is the single source of truth for the version number.
import { readFileSync, writeFileSync } from "node:fs";

const BASE_NAME = "Every 1000 blocks you mine your health doubles";
const BASE_DESCRIPTION = "More TNT! Designed by Leo.";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const versionArray = version.split(".").map(Number);

// The behaviour pack (game logic) and the resource pack (how things look) are
// separate packs with their own manifests, but they share one version number.
// Minecraft matches a world's packs by uuid AND version, so these must move
// together or the world will quietly load a stale one.
const PACKS = [
  {
    manifest: "pack/manifest.json",
    name: `${BASE_NAME} v${version}`,
    description: `${BASE_DESCRIPTION} (v${version})`,
  },
  {
    manifest: "resource_pack/manifest.json",
    name: `${BASE_NAME} Textures v${version}`,
    description: `Looks for ${BASE_NAME}. (v${version})`,
  },
];

for (const pack of PACKS) {
  const manifest = JSON.parse(readFileSync(pack.manifest, "utf8"));
  manifest.header.name = pack.name;
  manifest.header.description = pack.description;
  manifest.header.version = versionArray;
  for (const module of manifest.modules) module.version = versionArray;

  writeFileSync(pack.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`✅ Manifest stamped: "${manifest.header.name}"`);
}
