// Zips the packs into dist/leo-mod-health-doubler.mcaddon
// A .mcaddon is just a zip file containing one or more pack folders — here the
// behaviour pack (game logic) and the resource pack (how the diamond animals
// look). Importing the one file installs both.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const STAGING = "dist/.staging";
const OUTPUT = "dist/leo-mod-health-doubler.mcaddon";

// source folder -> folder name Minecraft sees inside the zip
const PACKS = [
  { from: "pack", as: "LeoHealth_BP" },
  { from: "resource_pack", as: "LeoHealth_RP" },
];

rmSync("dist", { recursive: true, force: true });
for (const pack of PACKS) {
  mkdirSync(`${STAGING}/${pack.as}`, { recursive: true });
  cpSync(pack.from, `${STAGING}/${pack.as}`, { recursive: true });
}

const folders = PACKS.map((pack) => pack.as).join(" ");
// No shell pinned: the default works on both the Mac and the Linux server.
execSync(`cd ${STAGING} && zip -r -q ../../${OUTPUT} ${folders}`, {
  stdio: "inherit",
});
rmSync(STAGING, { recursive: true, force: true });

console.log(`✅ Packaged ${OUTPUT} — AirDrop this file to the iPad!`);
