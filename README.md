# Every 1000 blocks you mine your health doubles ❤

Leo's third Minecraft Bedrock add-on, and his name for it.

You start on **half a heart**, and mining doubles your health. Die, and you're
back to half a heart with nothing mined.

Each doubling costs more than the last — 100 blocks, then 200, then 300, up to
1000, which is as dear as it ever gets. Leo asked for that after playing: a flat
thousand made the first double far too long a wait when one hit kills you.

| Doubling | Costs | Total mined | Health |
|---|---|---|---|
| — | — | 0 | ½ heart |
| 1st | 100 | 100 | 1 heart |
| 2nd | 200 | 300 | 2 hearts |
| 3rd | 300 | 600 | 4 hearts |
| 4th | 400 | 1,000 | 8 hearts |
| 5th | 500 | 1,500 | 16 hearts |
| 6th | 600 | 2,100 | 32 hearts |
| 7th | 700 | 2,800 | 64 hearts |
| 8th | 800 | 3,600 | 128 hearts |
| 9th | 900 | 4,500 | 256 hearts |
| 10th | 1,000 | **5,500** | **512 hearts** — the most the game allows |

The tenth doubling is both the first to cost a full thousand and the last the
game can give, so the whole thing is done in 5,500 blocks.

It runs on **its own server, in Survival** — health and respawning are the whole
mod, and in Creative you can't die and a thousand blocks is no work at all.

| | Health World |
|---|---|
| Address | `100.68.103.100:19136` |
| Service | `bedrock-health` |
| Console | `tmux -L health attach -t health` |
| Files | `/opt/bedrock-health` |

Add it on the iPads as a new server entry — same address, port **19136**.

Leo's other mods each have their own world too: [Mod 01](../leo-mod-01) on
19132 and [More TNT](../leo-mod-more-tnt) on 19134. A behaviour pack applies to
everyone in its world, and this one changes the player, so it needs to be
somewhere on its own.

## Testing it

`/scriptevent health:check` prints everyone's blocks, health and maximum. A
fresh player should read:

```
BlahNebula92412: 0 blocks, health 1/1 (earned 1)
```

`health 1/1` is the proof that the player override took: current health 1, and
the **maximum** lowered from twenty to one. Without it you'd see `1/20` — half a
heart of health inside ten hearts of empty container.

Survival with half a heart means **anything kills you** — one zombie hit, a
two-block fall, a cactus. Mining stone is the safest way to climb the first
thousand blocks.

## The technical limit Leo asked about

There is one, and it's the game's rather than ours: **1024 health points, or 512
hearts**, reached at 5,500 blocks mined.

Two facts set it. Nothing in the script API can change a player's *maximum*
health — `effectiveMax` is read-only, Bedrock has no `/attribute` command, and
there's no such thing as a "less health" effect. The only lever is the
**health_boost** effect, which adds four points per level, and the game refuses
an amplifier above 255. So the highest reachable maximum is:

> 1 + (4 × 256) = **1025 points**, and the biggest doubling that fits is 1024.

The mod doesn't take that sum on trust. It asks the game what the maximum
actually is after applying the effect and uses whatever it's told, so if a
future version of Minecraft allows more, this will use it without being
changed. When you hit the ceiling it says so rather than promising a double that
will never come.

## How it's built

| File | Its job |
|---|---|
| `pack/entities/player.json` | starts you on half a heart |
| `src/main.ts` | counting, doubling, resetting on death |

**`player.json` is a copy of Mojang's own file** with one component added
(`minecraft:health`, max 1). It has to be a full copy: a behaviour pack's entity
file *replaces* the vanilla one rather than adding to it, so a stub would strip
everything else a player needs. That also means it should be re-copied from
`/opt/bedrock-server/behavior_packs/vanilla/entities/player.json` when Minecraft
updates, in case Mojang adds something to it.

Adding that component is the only way to start a player below the usual twenty
points — see the limit section above.

## Two things worth knowing

**The heart display can over-state what you have.** health_boost only comes in
steps of four points, so your maximum is often higher than you've earned — at
2 hearts earned, the game thinks you can hold 2.5. A check every second trims
anyone who has healed past their allowance, so food and regeneration can't
cheat the doubling, and the action bar always shows the true figure.

**Mined blocks are remembered when you log out**, so a session can be picked up
later. Dying still wipes it, which is the game Leo designed.

## Commands

```sh
npm run build                # typecheck + bundle
./tools/deploy-server.sh     # deploy and hot-reload the health server
```

`/scriptevent health:check` prints everyone's blocks, health and maximum — handy
for seeing the limit rather than believing it.

Script changes hot-reload in seconds. Changing `player.json` needs
`sudo systemctl restart bedrock-health`, because entity definitions are only
read at startup.
