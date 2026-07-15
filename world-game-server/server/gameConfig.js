// =====================================================================
// W.O.R.L.D. 게임 밸런스 설정 파일
// 이 파일 하나만 수정하면 계급/스킬/아이템/뽑기확률/레벨업 보상을 전부 바꿀 수 있습니다.
// 서버 코드(다른 server/*.js 파일)는 건드릴 필요 없습니다.
// 이미지·이펙트 경로는 public/assets/icons, public/assets/effects 기준 상대경로입니다.
// =====================================================================

// ---- 레벨 / 계급 ----
const MAX_LEVEL = 99;

const RANK_THRESHOLDS = [
  { rank: "E",   min: 1,  max: 10 },
  { rank: "D",   min: 11, max: 25 },
  { rank: "C",   min: 26, max: 40 },
  { rank: "B",   min: 41, max: 55 },
  { rank: "A",   min: 56, max: 70 },
  { rank: "S",   min: 71, max: 85 },
  { rank: "SS",  min: 86, max: 95 },
  { rank: "SSS", min: 96, max: 99 },
];
// "THE GOD"은 여기 포함하지 않습니다 - 관리자 전용 고정 계급 (엔진이 자동으로 최상위에 추가)

const STARTING_MONEY = {
  E: 100, D: 200, C: 400, B: 800, A: 1500,
  S: 3000, SS: 6000, SSS: 12000, "THE GOD": 999999,
};

// ---- 뽑기(가챠) - 스킬만 대상, 숫자가 클수록 잘 나옴 ----
const GACHA_WEIGHTS = { E: 40, D: 25, C: 15, B: 9, A: 6, S: 3, SS: 1.5, SSS: 0.5 };
const GACHA_COST = 300;

// ---- 전투 승리 보상 (레벨업 / 계급승급) ----
const LEVEL_GAIN_PER_WIN = 3;        // 승리 시 기본 레벨 상승폭
const LEVEL_GAIN_RANK_BONUS = 2;     // 나보다 높은 계급을 이길 때, 계급 차이 1단계당 추가 레벨
const RANKUP_BONUS_MONEY_RATIO = 0.2; // 승급 축하금 = 새 계급 시작자금 * 이 비율

// ---- 발동 조건(condition) 종류 ----
// { type: "cooldown", ms }            → 재사용 대기시간
// { type: "hpFull" }                  → HP가 최대일 때만
// { type: "hpBelow", percent }        → HP가 최대치의 percent% 이하일 때만
// { type: "hpAtLeast", percent }      → HP가 최대치의 percent% 이상일 때만
// { type: "rankAtLeast", rank }       → 계급이 그 이상일 때만
// { type: "usesPerMatch", max }       → 한 전투에서 최대 max번만 (필살기용)

// ---- 이펙트(effect) - 생략 가능 ----
// { type: "spritesheet", src, frameWidth, frameHeight, frameCount, fps }
// { type: "video", src }

const SKILL_POOL = [
  { id: "e_jab", name: "잽", rankTier: "E", power: 5, element: "none",
    conditions: [{ type: "cooldown", ms: 1500 }],
    description: "가벼운 일격. 쿨타임 1.5초.", icon: "icons/skill_jab.png", effect: null },
  { id: "d_kick", name: "돌려차기", rankTier: "D", power: 9, element: "none",
    conditions: [{ type: "cooldown", ms: 2500 }],
    description: "쿨타임 2.5초의 발차기.", icon: "icons/skill_kick.png", effect: null },
  { id: "c_focus_strike", name: "집중 일격", rankTier: "C", power: 14, element: "none",
    conditions: [{ type: "cooldown", ms: 4000 }, { type: "hpFull" }],
    description: "HP 최대일 때만, 쿨타임 4초.", icon: "icons/skill_focus.png", effect: null },
  { id: "b_counter", name: "카운터", rankTier: "B", power: 18, element: "none",
    conditions: [{ type: "cooldown", ms: 5000 }, { type: "hpBelow", percent: 50 }],
    description: "HP 50% 이하일 때만. 쿨타임 5초.", icon: "icons/skill_counter.png", effect: null },
  { id: "a_burst", name: "버스트 슬래시", rankTier: "A", power: 24, element: "none",
    conditions: [{ type: "cooldown", ms: 4000 }, { type: "rankAtLeast", rank: "A" }],
    description: "계급 A 이상. 쿨타임 4초.", icon: "icons/skill_burst.png",
    effect: { type: "spritesheet", src: "effects/burst_slash.png", frameWidth: 128, frameHeight: 128, frameCount: 6, fps: 24 } },
  { id: "s_judgement", name: "심판의 일격", rankTier: "S", power: 32, element: "light",
    conditions: [{ type: "cooldown", ms: 6000 }, { type: "rankAtLeast", rank: "S" }],
    description: "계급 S 이상. 쿨타임 6초. 빛속성.", icon: "icons/skill_judgement.png",
    effect: { type: "spritesheet", src: "effects/judgement.png", frameWidth: 160, frameHeight: 160, frameCount: 8, fps: 24 } },
  { id: "ss_obliterate", name: "말살", rankTier: "SS", power: 42, element: "dark",
    conditions: [{ type: "cooldown", ms: 8000 }, { type: "hpFull" }, { type: "rankAtLeast", rank: "SS" }],
    description: "계급 SS 이상, HP 최대일 때만. 쿨타임 8초. 암속성.", icon: "icons/skill_obliterate.png",
    effect: { type: "spritesheet", src: "effects/obliterate.png", frameWidth: 192, frameHeight: 192, frameCount: 10, fps: 30 } },
  { id: "sss_apocalypse", name: "종언", rankTier: "SSS", power: 60, element: "none",
    conditions: [{ type: "cooldown", ms: 10000 }, { type: "rankAtLeast", rank: "SSS" }],
    description: "계급 SSS 전용. 쿨타임 10초.", icon: "icons/skill_apocalypse.png",
    effect: { type: "video", src: "effects/apocalypse.webm" } },
];

const ITEM_POOL = [
  { id: "e_wooden_sword", name: "낡은 목검", rankTier: "E", icon: "icons/item_wooden_sword.png",
    passive: { maxHpBonus: 10 },
    active: { id: "wooden_bash", name: "목검 내려찍기", power: 6, element: "none",
      conditions: [{ type: "cooldown", ms: 3000 }], description: "쿨타임 3초.",
      icon: "icons/skill_wooden_bash.png", effect: null } },
  { id: "c_iron_shield", name: "철제 방패", rankTier: "C", icon: "icons/item_iron_shield.png",
    passive: { damageReduction: 0.1 },
    active: { id: "shield_bash", name: "방패 밀치기", power: 10, element: "none",
      conditions: [{ type: "cooldown", ms: 3500 }], description: "쿨타임 3.5초.",
      icon: "icons/skill_shield_bash.png", effect: null } },
  { id: "a_flame_gauntlet", name: "화염 건틀렛", rankTier: "A", icon: "icons/item_flame_gauntlet.png",
    passive: { maxHpBonus: 30, immuneElements: ["ice"] },
    active: { id: "flame_punch", name: "화염 강타", power: 26, element: "fire",
      conditions: [{ type: "cooldown", ms: 5000 }, { type: "hpFull" }],
      description: "HP 최대일 때만. 쿨타임 5초. 화속성.", icon: "icons/skill_flame_punch.png",
      effect: { type: "spritesheet", src: "effects/flame_punch.png", frameWidth: 128, frameHeight: 128, frameCount: 8, fps: 24 } } },
  {
    id: "ss_poseidon_trident", name: "포세이돈의 삼지창", rankTier: "SS", icon: "icons/item_poseidon_trident.png",
    passive: { immuneElements: ["water"] },
    active: { id: "trident_stab", name: "찌르기", power: 20, element: "water",
      conditions: [{ type: "cooldown", ms: 1000 }], description: "쿨타임 1초의 기본 찌르기.",
      icon: "icons/skill_trident_stab.png",
      effect: { type: "spritesheet", src: "effects/trident_stab.png", frameWidth: 128, frameHeight: 128, frameCount: 6, fps: 30 } },
    activeExtra: [
      { id: "sea_dragon_finale", name: "해룡의 화룡점정", power: 55, element: "water",
        conditions: [{ type: "rankAtLeast", rank: "SS" }, { type: "usesPerMatch", max: 1 }],
        description: "계급 SS 이상, 한 전투에서 딱 한 번만 사용 가능.",
        icon: "icons/skill_sea_dragon_finale.png",
        effect: { type: "video", src: "effects/sea_dragon_finale.webm" } },
    ],
  },
  { id: "sss_world_ender", name: "세계종언자", rankTier: "SSS", icon: "icons/item_world_ender.png",
    passive: { maxHpBonus: 100, damageReduction: 0.15 },
    active: { id: "world_end", name: "세계의 끝", power: 80, element: "dark",
      conditions: [{ type: "cooldown", ms: 12000 }, { type: "rankAtLeast", rank: "SSS" }],
      description: "계급 SSS 전용. 쿨타임 12초.", icon: "icons/skill_world_end.png",
      effect: { type: "video", src: "effects/world_end.webm" } } },
];

module.exports = {
  MAX_LEVEL, RANK_THRESHOLDS, STARTING_MONEY, GACHA_WEIGHTS, GACHA_COST,
  LEVEL_GAIN_PER_WIN, LEVEL_GAIN_RANK_BONUS, RANKUP_BONUS_MONEY_RATIO,
  SKILL_POOL, ITEM_POOL,
};
