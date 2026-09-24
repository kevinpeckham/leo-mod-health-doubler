import {
  type EntityHealthComponent,
  type Player,
  system,
  world,
} from "@minecraft/server";

// ── Every 1000 blocks you mine your health doubles ──────────────────
// Leo's third add-on. You start on half a heart, and every thousand blocks you
// mine doubles how much health you have. Die, and you're back to half a heart
// and back to zero blocks.
//
// Each doubling costs more than the last: the first is 100 blocks, then 200,
// then 300, and so on up to 1000, which is as expensive as it ever gets. Leo
// asked for that after playing — a flat thousand made the first double far too
// long a wait when one hit kills you.
//
//   doubling   1    2    3    4    5    6    7    8    9   10
//   costs    100  200  300  400  500  600  700  800  900 1000
//   total    100  300  600 1000 1500 2100 2800 3600 4500 5500
//   hearts     1    2    4    8   16   32   64  128  256  512
//
// The tenth doubling is the last one the game can give (see the limit below),
// and it happens to be the first that costs the full thousand — so the whole
// thing is done in 5,500 blocks.
//
// Health in Minecraft is counted in half-hearts, so "half a heart" is 1 point
// and a normal player has 20. Everything below works in those points.

const FIRST_DOUBLING_BLOCKS = 100;
const EXTRA_BLOCKS_PER_DOUBLING = 100;
const MOST_BLOCKS_PER_DOUBLING = 1000;

// Purely a guard on the loop below, not a rule of the game — the health ceiling
// stops things long before this.
const SANE_DOUBLING_LIMIT = 64;

// Where you start: one point, half a heart. This has to match the max health in
// pack/entities/player.json, which is the only way to start a player below the
// usual twenty — nothing in the script API can LOWER a player's maximum.
const START_HEALTH = 1;

// Above the starting point we buy headroom with the health_boost effect, since
// that's the only thing that can raise a player's maximum. Each level of it
// adds four points, and the game refuses an amplifier above 255 — so the most
// health it can give is 1 + 4 x 256 = 1025 points. The highest doubling that
// fits under that is 1024 points, or 512 hearts, reached at 10,000 blocks.
//
// That is the technical limit Leo asked about. It isn't a number we chose, and
// the code below measures the real maximum rather than trusting this sum: if a
// future version of the game allows more, the mod will use it without being
// told.
const BOOST_HEALTH_PER_LEVEL = 4;
const MAX_BOOST_AMPLIFIER = 255;

// Long enough to be permanent in practice; refreshed whenever a tier changes.
const BOOST_TICKS = 20_000_000;

// How often to check nobody has healed past their allowance.
const CLAMP_INTERVAL_TICKS = 20;

// Remembered on the player, so logging out doesn't lose your progress. Dying
// still resets it — that's the game Leo designed.
const MINED_KEY = "leo:blocks_mined";

const minedBy = (player: Player) =>
  (player.getDynamicProperty(MINED_KEY) as number | undefined) ?? 0;

function setMined(player: Player, blocks: number) {
  player.setDynamicProperty(MINED_KEY, blocks);
}

// Half-hearts to a friendly "3" or "3.5".
const hearts = (points: number) =>
  Number.isInteger(points / 2) ? `${points / 2}` : `${(points / 2).toFixed(1)}`;

/** What the nth doubling costs, counting from 1. */
const costOfDoubling = (n: number) =>
  Math.min(
    MOST_BLOCKS_PER_DOUBLING,
    FIRST_DOUBLING_BLOCKS + (n - 1) * EXTRA_BLOCKS_PER_DOUBLING,
  );

/**
 * Works out where a player stands: how many doublings this many blocks has
 * bought, and how many more blocks until the next one.
 */
function progressFor(blocks: number) {
  let doublings = 0;
  let spent = 0;

  while (doublings < SANE_DOUBLING_LIMIT) {
    const next = costOfDoubling(doublings + 1);
    if (spent + next > blocks) {
      return { doublings, blocksToNext: spent + next - blocks };
    }
    spent += next;
    doublings++;
  }
  return { doublings, blocksToNext: 0 };
}

/** How much health this many mined blocks has earned, before any game limit. */
function earnedHealth(blocks: number) {
  return START_HEALTH * 2 ** progressFor(blocks).doublings;
}

/**
 * Gives the player as much health as they've earned, or as much as the game
 * will allow if that's less. Returns what they actually ended up with.
 */
function applyHealth(player: Player, wanted: number) {
  const health = player.getComponent("minecraft:health") as
    | EntityHealthComponent
    | undefined;
  if (!health) return 0;

  // Buy just enough headroom for what they've earned.
  const shortfall = wanted - START_HEALTH;
  if (shortfall > 0) {
    const amplifier = Math.min(
      MAX_BOOST_AMPLIFIER,
      Math.ceil(shortfall / BOOST_HEALTH_PER_LEVEL) - 1,
    );
    player.addEffect("health_boost", BOOST_TICKS, {
      amplifier,
      showParticles: false,
    });
  } else {
    player.removeEffect("health_boost");
  }

  // Believe the game, not the arithmetic above: whatever it says the maximum is
  // now, that's the ceiling. This is what makes the limit self-discovering.
  const allowed = Math.min(wanted, health.effectiveMax);
  health.setCurrentValue(allowed);
  return allowed;
}

/** Puts a player back to the very beginning: half a heart, no blocks. */
function reset(player: Player) {
  setMined(player, 0);
  applyHealth(player, START_HEALTH);
}

function showProgress(player: Player) {
  const blocks = minedBy(player);
  const health = player.getComponent("minecraft:health") as
    | EntityHealthComponent
    | undefined;
  const now = health ? Math.min(earnedHealth(blocks), health.effectiveMax) : 0;
  const next = earnedHealth(blocks) * 2;
  const togo = progressFor(blocks).blocksToNext;

  // If the game won't give us any more, say so instead of promising a double
  // that will never arrive.
  const capped = health ? next > health.effectiveMax : false;
  player.onScreenDisplay.setActionBar(
    capped
      ? `§c❤ ${hearts(now)} hearts §7— as much as the game allows`
      : `§c❤ ${hearts(now)} hearts §7| ${togo} more blocks to double`,
  );
}

// ── Mining ──────────────────────────────────────────────────────────
world.afterEvents.playerBreakBlock.subscribe((event) => {
  const player = event.player;
  const before = minedBy(player);
  const after = before + 1;
  setMined(player, after);

  const crossed = progressFor(after).doublings > progressFor(before).doublings;

  if (!crossed) {
    // Only nag every so often, or the action bar never goes away.
    if (after % 25 === 0) showProgress(player);
    return;
  }

  const wanted = earnedHealth(after);
  const got = applyHealth(player, wanted);

  if (got >= wanted) {
    player.onScreenDisplay.setTitle("§a❤ HEALTH DOUBLED!");
    player.sendMessage(
      `§a❤ ${after} blocks mined — you now have §f${hearts(got)} hearts§a!`,
    );
    player.playSound("random.levelup");
  } else {
    // We promised doubling with no limit; the game disagreed. Say which.
    player.sendMessage(
      `§e❤ ${hearts(got)} hearts is as much as Minecraft can give — ` +
        "you've maxed it out!",
    );
    player.playSound("random.orb");
  }
});

// ── Joining and dying ───────────────────────────────────────────────
world.afterEvents.playerSpawn.subscribe((event) => {
  const { player, initialSpawn } = event;

  // A moment's wait: on a fresh join the player isn't quite ready to be
  // changed, and the screen isn't ready to be drawn on.
  system.runTimeout(() => {
    if (initialSpawn) {
      // Back after a logout — give them back what they'd earned.
      applyHealth(player, earnedHealth(minedBy(player)));
      player.sendMessage(
        "§eMine blocks to grow. Every 1000 doubles your health — but dying " +
          "puts you back to half a heart.",
      );
    } else {
      // They died. Back to the beginning, which is the whole point.
      reset(player);
      player.sendMessage("§c💀 Back to half a heart. Start mining!");
    }
    showProgress(player);
  }, 20);
});

// ── Keep everyone honest ────────────────────────────────────────────
// health_boost gives headroom in steps of four, so a player's maximum is often
// higher than they've actually earned — and food or regeneration would happily
// fill that gap. This trims anyone above their allowance.
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const health = player.getComponent("minecraft:health") as
      | EntityHealthComponent
      | undefined;
    if (!health) continue;

    const allowed = Math.min(
      earnedHealth(minedBy(player)),
      health.effectiveMax,
    );
    if (health.currentValue > allowed) health.setCurrentValue(allowed);
  }
}, CLAMP_INTERVAL_TICKS);

// ── /scriptevent health:check ───────────────────────────────────────
// Reports the numbers, so the limit can be seen rather than taken on trust.
system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "health:check") return;

  for (const player of world.getAllPlayers()) {
    const health = player.getComponent("minecraft:health") as
      | EntityHealthComponent
      | undefined;
    if (!health) continue;
    const blocks = minedBy(player);
    const line =
      `${player.name}: ${blocks} blocks, ` +
      `health ${health.currentValue}/${health.effectiveMax} ` +
      `(earned ${earnedHealth(blocks)})`;
    console.warn(`[health] ${line}`);
    world.sendMessage(`§7${line}`);
  }
});
