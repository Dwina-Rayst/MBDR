const {
  MAX_LEVEL, RANK_THRESHOLDS, STARTING_MONEY, GACHA_WEIGHTS, SELL_PRICE_BY_RANK,
  SKILL_POOL, ITEM_POOL,
} = require("./gameConfig");

const RANK_ORDER = [...RANK_THRESHOLDS.map((r) => r.rank), "THE GOD"];

function levelToRank(level) {
  if (level > MAX_LEVEL) return "THE GOD";
  const found = RANK_THRESHOLDS.find((r) => level >= r.min && level <= r.max);
  return found ? found.rank : RANK_THRESHOLDS[0].rank;
}

function randomLevel() {
  return Math.floor(Math.random() * MAX_LEVEL) + 1;
}

function allActivesOfItem(item) {
  const list = [];
  if (item.active) list.push(item.active);
  if (Array.isArray(item.activeExtra)) list.push(...item.activeExtra);
  return list;
}

function getSkillDefinition(skillId) {
  const fromSkills = SKILL_POOL.find((s) => s.id === skillId);
  if (fromSkills) return fromSkills;
  for (const item of ITEM_POOL) {
    const found = allActivesOfItem(item).find((a) => a.id === skillId);
    if (found) return found;
  }
  return null;
}

function getItemPassives(itemIds) {
  const result = { maxHpBonus: 0, damageReduction: 0, immuneElements: new Set() };
  (itemIds || []).forEach((id) => {
    const item = ITEM_POOL.find((i) => i.id === id);
    if (!item || !item.passive) return;
    if (item.passive.maxHpBonus) result.maxHpBonus += item.passive.maxHpBonus;
    if (item.passive.damageReduction) result.damageReduction += item.passive.damageReduction;
    if (item.passive.immuneElements) item.passive.immuneElements.forEach((e) => result.immuneElements.add(e));
  });
  result.damageReduction = Math.min(result.damageReduction, 0.999999999);
  result.immuneElements = [...result.immuneElements];
  return result;
}

function ownsSkill(playerSkills, playerItems, skillId) {
  if (playerSkills.includes(skillId)) return true;
  return playerItems.some((itemId) => {
    const item = ITEM_POOL.find((i) => i.id === itemId);
    return item && allActivesOfItem(item).some((a) => a.id === skillId);
  });
}

function startingLoadout(rank) {
  if (rank === "THE GOD") {
    return { skills: SKILL_POOL.map((s) => s.id), items: ITEM_POOL.map((i) => i.id) };
  }
  const idx = RANK_ORDER.indexOf(rank);
  const availSkills = SKILL_POOL.filter((s) => RANK_ORDER.indexOf(s.rankTier) <= idx);
  const availItems = ITEM_POOL.filter((i) => RANK_ORDER.indexOf(i.rankTier) <= idx);
  const skill = availSkills[availSkills.length - 1] || SKILL_POOL[0];
  const item = availItems.length ? availItems[availItems.length - 1] : null;
  return { skills: [skill.id], items: item ? [item.id] : [] };
}

function rollGachaSkill() {
  const total = Object.values(GACHA_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = Math.random() * total, tier = Object.keys(GACHA_WEIGHTS)[0];
  for (const [t, w] of Object.entries(GACHA_WEIGHTS)) {
    if (r < w) { tier = t; break; }
    r -= w;
  }
  const pool = SKILL_POOL.filter((s) => s.rankTier === tier);
  const fallback = SKILL_POOL.filter((s) => s.rankTier === RANK_THRESHOLDS[0].rank);
  const finalPool = pool.length ? pool : fallback;
  return finalPool[Math.floor(Math.random() * finalPool.length)];
}

// kind: "skill" | "item", id: 해당 스킬/아이템의 id
function getSellPrice(kind, id) {
  const pool = kind === "item" ? ITEM_POOL : SKILL_POOL;
  const def = pool.find((d) => d.id === id);
  if (!def) return 0;
  if (typeof def.sellPrice === "number") return def.sellPrice;
  return SELL_PRICE_BY_RANK[def.rankTier] || 0;
}

module.exports = {
  RANK_ORDER, MAX_LEVEL, STARTING_MONEY,
  levelToRank, randomLevel, allActivesOfItem, getSkillDefinition,
  getItemPassives, ownsSkill, startingLoadout, rollGachaSkill, getSellPrice,
};
