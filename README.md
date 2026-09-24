# Every 1000 blocks you mine your health doubles ❤

Leo's third Minecraft Bedrock add-on, and his name for it.

You start on **half a heart**. Every **1000 blocks** you mine, your health
**doubles**. Die, and you're back to half a heart with nothing mined.

| Blocks mined | Health |
|---|---|
| 0 | ½ heart |
| 1,000 | 1 heart |
| 2,000 | 2 hearts |
| 3,000 | 4 hearts |
| 5,000 | 16 hearts |
| 10,000 | **512 hearts** — the most the game allows |

It runs on **its own server, in Survival** — health and respawning are the whole
mod, and in Creative you can't die and a thousand blocks is no work at all.

| | Health World |
|---|---|
| Address | `100.68.103.100:19136` |
| Service | `bedrock-health` |
| Console | `tmux -L health attach -t health` |
| Files | `/opt/bedrock-health` |

Add it on the iPads as a new server entry — same address, port **19136**.

## The technical limit Leo asked about

There is one, and it's the game's rather than ours: **1024 health points, or 512
hearts**, reached at 10,000 blocks mined.

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
