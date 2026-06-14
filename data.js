/* ====================================================================
   KRMAS Roster — Data
   --------------------------------------------------------------------
   In the deployed app this file is replaced by a Supabase client.
   For the standalone build, all data is local + persisted to
   window.storage (and localStorage as fallback).
   ==================================================================== */

// ---------- KRMAS school network (HQ owned) ----------
const KRMAS_SCHOOLS = [
  { id: 'beecroft',     name: 'Beecroft',      state: 'NSW' },
  { id: 'cootamundra',  name: 'Cootamundra',   state: 'NSW' },
  { id: 'cowra',        name: 'Cowra',         state: 'NSW' },
  { id: 'dubbo',        name: 'Dubbo',         state: 'NSW' },
  { id: 'edgeworth',    name: 'Edgeworth',     state: 'NSW' },
  { id: 'harden',       name: 'Harden',        state: 'NSW' },
  { id: 'lithgow',      name: 'Lithgow',       state: 'NSW' },
  { id: 'orange',       name: 'Orange',        state: 'NSW' },
  { id: 'parkes',       name: 'Parkes',        state: 'NSW' },
  { id: 'port-mac',     name: 'Port Macquarie',state: 'NSW' },
  { id: 'rutherford',   name: 'Rutherford',    state: 'NSW' },
  { id: 'taree',        name: 'Taree',         state: 'NSW' },
  { id: 'weston',       name: 'Weston Creek',  state: 'ACT' },
  { id: 'gin-gin',      name: 'Gin Gin',       state: 'QLD' },
  { id: 'gympie',       name: 'Gympie',        state: 'QLD' },
  { id: 'maryborough',  name: 'Maryborough',   state: 'QLD' },
  { id: 'port-denison', name: 'Port Denison',  state: 'WA'  }
];

// Edgeworth dojo contact (for lesson-plan email submission)
const SCHOOL_CONTACTS = {
  'edgeworth': { adminEmail: 'newcastledojo@krmas.com.au', adminName: 'Sensei Alysia', locationLabel: 'Newcastle' }
};

// ---------- Class types (curriculum identifiers) ----------
const CLASS_TYPES = {
  'mini-ninjas':   { name: 'Mini Ninjas',          short: 'MLN',         colour: '--c-mln',      chart: 'mln' },
  'little-ninjas': { name: 'Little Ninjas',        short: 'LN',          colour: '--c-ln',       chart: 'ln' },
  'karate':        { name: 'Karate',               short: 'Karate',      colour: '--c-karate',   chart: 'karate' },
  'basics-kata':   { name: 'Basics & Kata',        short: 'B&K',         colour: '--c-karate',   chart: 'kata' },
  'kids-kata':     { name: 'Kids Kata',            short: 'Kids Kata',   colour: '--c-kata',     chart: 'kata' },
  'kata':          { name: 'Kata',                 short: 'Kata',        colour: '--c-kata',     chart: 'kata' },
  'kids-sparring': { name: 'Kids Sparring',        short: 'K-Spar',      colour: '--c-sparring', chart: 'kids-sparring' },
  'sparring':      { name: 'Sparring',             short: 'Sparring',    colour: '--c-sparring', chart: 'sparring' },
  'jr-muay-thai':  { name: 'Junior Muay Thai',     short: 'JMT',         colour: '--c-jmt',      chart: 'mt' },
  'muay-thai':     { name: 'Muay Thai',            short: 'MT',          colour: '--c-mt',       chart: 'mt' },
  'ladies-mt':     { name: 'Ladies Muay Thai',     short: 'LMT',         colour: '--c-lmt',      chart: 'mt' },
  'mt-finisher':   { name: 'Muay Thai Finisher',   short: 'MT-F',        colour: '--c-mtf',      chart: 'mt-finisher' },
  'mma-sanda':     { name: 'MMA Sanda',            short: 'Sanda',       colour: '--c-sanda',    chart: 'sanda' },
  'jiu-jitsu':     { name: 'Jiu Jitsu',            short: 'BJJ',         colour: '--c-bjj',      chart: 'bjj' },
  'kobudo':        { name: 'Kobudo (Weapons)',     short: 'Weapons',     colour: '--c-kata',     chart: null },
  'strength-cond': { name: 'Strength & Conditioning', short: 'S&C',      colour: '--c-sc',       chart: null },
  'plates':        { name: 'Plates',               short: 'Plates',      colour: '--c-plates',   chart: null }
};

// ---------- Topic charts (HQ-controlled curriculum) ----------
const TOPIC_CHARTS = {
  mln: {
    name: 'Mini & Little Ninjas',
    cycleLength: 6,
    topics: {
      1: { title: 'Stances & Strikes', fitness: 'Hold push-up, sit-up & squat positions 5–15 sec', basics: 'Forward stance\nUpper & lower strikes', etiquette: 'Osu' },
      2: { title: 'Jab, cross & snapkicks', fitness: 'Hold superman, horse & low squat 5–15 sec', basics: 'Fighting stance\nJab, cross\nSnap kicks', etiquette: 'Bowing on/off mats', other: 'Strike round pads' },
      3: { title: 'Punches & safety', fitness: 'Push-ups, sit-ups & squats', basics: 'Ready stance\nMake a fist\nStraight & reverse punches', etiquette: 'Safety & respect in the Dojo', selfDefence: 'Safe locations & people' },
      4: { title: 'Front kicks & round pads', fitness: 'Hold push-up, sit-up & squat positions 5–15 sec', basics: 'Attention & listening stance\nFront kicks', etiquette: 'Bowing — start of class', other: 'Strike round pads' },
      5: { title: 'Breakfalls & turning kicks', fitness: 'Hold superman, horse & low squat 5–15 sec', basics: 'Turning kicks — leg/body\nBreakfalls', selfDefence: 'Ground guard\nSafely get up to feet' },
      6: { title: 'Strikes & 4 golden rules', fitness: 'Push-ups, sit-ups & squats', basics: 'Inner & outer strikes', etiquette: 'Kun', selfDefence: '4 golden rules of KR self defence' }
    }
  },
  ln: {
    name: 'Little Ninjas',
    cycleLength: 12,
    topics: {
      1:  { title: 'Stances', fitness: 'Squats\nPlank + side plank', basics: 'Stances, turning & transitions', etiquette: 'Osu', selfDefence: 'Non-aggressive defensive position & back off', kata: true, other: 'Board breaks' },
      2:  { title: 'Self defence — standing', fitness: 'Push-ups\nSit-ups', basics: 'Leg checks & guard', etiquette: 'Bowing on/off mats', grappling: 'Break falls\nSingle & double wrist grab\nRear shoulder grab', selfDefence: 'BYOBG 4, 5, 6 (with takedowns or throws for H.G)\n4 golden rules' },
      3:  { title: 'Basics — hands', fitness: 'Squats + hold\nPlank', basics: 'Tiger paw, ridge hands, hammer fist, knife hands, palm heels, spear hands, side punches in shika dachi', etiquette: 'Safety & respect in the Dojo', kata: true, other: 'Belt tying (self & others)' },
      4:  { title: 'Sparring', fitness: 'Superman\nV-balance', basics: 'Jab, cross\nHook, rip & uppercut\nBack fists (horizontal & vertical)', etiquette: 'Bowing — start of class', grappling: 'Body positioning (tai sabaki)', selfDefence: 'Slips & parries vs punches & kicks', other: 'Sparring drills\nShadow sparring' },
      5:  { title: 'Basics — kicks', fitness: 'Burpees\nStretching (cool down)\nUp to 40 kicks', basics: 'Kicks — push, side, hook + spinning\nBack kick + spinning\nCross stance', selfDefence: 'Multiple attackers\nKicks in all directions', kata: true, other: 'Round pads' },
      6:  { title: 'Self defence — ground', fitness: 'Skipping\nFrog jumps', etiquette: 'Kun', grappling: 'Break falls', selfDefence: 'Take down standing attacker from ground & escape\nApply standing chokes & arm locks\nKyusho' },
      7:  { title: 'Throws', fitness: 'Push-ups\nSit-ups', grappling: 'Break falls + rolls\nBreaking balance (kuzushi)', selfDefence: 'Throws\nSweeps\nTakedowns' },
      8:  { title: 'Grappling', fitness: 'Squats\nPlank', grappling: 'Defence from mount, side control, guard\nGround flow drill', selfDefence: 'Locks & defences: arm, leg & head' },
      9:  { title: 'Basics — elbows & knees', fitness: 'Burpees\nStretching (cool down)', basics: 'Elbows & knees\nWrist strikes', other: 'Thai pads' },
      10: { title: 'Self defence — standing', fitness: 'Running\nSuperman', selfDefence: 'BYOBG 1, 2, 3 (with takedowns for H.G)\n4 golden rules\nSafe locations & people', other: 'Types of bullying\nWhat to do when someone is being bullied' },
      11: { title: 'Basics — hands', fitness: 'Skipping\nBear crawls', basics: 'Make a fist, half punch\nStraight & reverse punches\nStrikes (double inner for H.G)\nSpinning backfist', kata: true },
      12: { title: 'Basics — kicks', fitness: 'Interval running', basics: 'Kicks — snap, turning, axe\nFront kicks + jumping\nCrescent kicks + spinning', kata: true, other: 'Round pads\nXMA or team kata (KR or make own)' }
    }
  },
  karate: {
    name: 'Karate',
    cycleLength: 12,
    topics: {
      1:  { title: 'Stances', fitness: 'Squats\nPlank + side plank', basics: 'Stances, turning & transitions\nFighting stance direction change', etiquette: 'Osu', selfDefence: 'Non-aggressive defensive position & back off', kata: true, other: 'Board breaks' },
      2:  { title: 'Self defence — standing', fitness: 'Push-ups\nSit-ups', basics: 'Leg checks & guard', etiquette: 'Bowing on/off mats', grappling: 'Break falls\nSingle & double wrist grab\nRear shoulder grab', selfDefence: 'BYOBG 4, 5, 6 (with takedowns or throws for H.G)\n4 golden rules' },
      3:  { title: 'Basics — hands', fitness: 'Squats + hold\nPlank', basics: 'Tiger paw, ridge hands, hammer fist, knife hands, palm heels, spear hands, side punches in shika dachi', etiquette: 'Safety & respect in the Dojo', selfDefence: 'Weapon defence: stick & knife', kata: true, other: 'Belt tying (self & others)' },
      4:  { title: 'Sparring', fitness: 'Superman\nV-balance', basics: 'Jab, cross\nHook, rip & uppercut\nBack fists', etiquette: 'Bowing — start of class', grappling: 'Body positioning (tai sabaki)', selfDefence: 'Slips & parries vs punches & kicks', other: 'Sparring drills\nShadow sparring' },
      5:  { title: 'Basics — kicks', fitness: 'Burpees\nStretching (cool down)\nUp to 40 kicks', basics: 'Kicks — push, side, hook + spinning\nBack kick + spinning\nCross stance', selfDefence: 'Multiple attackers\nKicks in all directions', kata: true, other: 'Round pads' },
      6:  { title: 'Self defence — ground', fitness: 'Skipping\nFrog jumps', etiquette: 'Kun', grappling: 'Break falls', selfDefence: 'Take down standing attacker from ground & escape\nApply standing chokes & arm locks\nKyusho' },
      7:  { title: 'Throws', fitness: 'Push-ups\nSit-ups', grappling: 'Break falls + rolls\nBreaking balance (kuzushi)', selfDefence: 'Throws\nSweeps\nTakedowns' },
      8:  { title: 'Grappling', fitness: 'Squats\nPlank', grappling: 'Defence from mount, side control, guard\nGround flow drill', selfDefence: 'Locks & defences: arm, leg & head' },
      9:  { title: 'Basics — elbows & knees', fitness: 'Burpees\nStretching (cool down)', basics: 'Elbows + spinning & knees\nWrist strikes', grappling: 'Clinching, including elbows & knees', other: 'Thai pads' },
      10: { title: 'Self defence — standing', fitness: 'Running\nSuperman', selfDefence: 'BYOBG 1, 2, 3 (with takedowns for H.G)\n4 golden rules' },
      11: { title: 'Basics — hands', fitness: 'Skipping\nBear crawls', basics: 'Make a fist, half punch\nStraight & reverse punches\nStrikes (double inner for H.G)\nSpinning backfist', kata: true },
      12: { title: 'Basics — kicks', fitness: 'Interval running', basics: 'Kicks — snap, turning, axe\nFront kicks + jumping\nCrescent kicks + spinning\nSwitch kicks', kata: true, other: 'Round pads' }
    }
  },
  mt: {
    name: 'Muay Thai',
    cycleLength: 8,
    topics: {
      1: { title: 'Basics — hands + self defence', fitness: 'Skipping\nPush-ups\nSit-ups', basics: 'Jab, cross, hook, rip & uppercut\nSpinning back kick', etiquette: 'Osu', sparring: '4 golden rules\nBYOBG & MT responses\nMT response from takedown', equipment: 'Focus mitts (H.G)' },
      2: { title: 'Basics — kicks + evasion', fitness: 'Burpees\nSuperman', basics: 'Kicks — turning, teep, front\n15–90 kicks in a row, each leg (grade specific)', etiquette: 'Bowing on/off mats', sparring: 'Block, cover, slip & parry strikes', equipment: 'Thai pads' },
      3: { title: 'Throws & clinching', fitness: 'Squats\nPlank\nSide plank', basics: 'Back fist + spinning\nOverhand cross punch\nBreakfalls', etiquette: 'Safety & respect in the Dojo', grappling: 'Clinching — enter & exit', sparring: 'Throws & dumps from clinch', equipment: 'Round pads' },
      4: { title: 'Sparring drills', fitness: 'Burpees\nV-sit hold', basics: 'Breakfalls\nKumite Ichi', etiquette: 'Kun', grappling: 'Catch kicks & counter', sparring: 'Exchange drills using all personal safety gear + head gear for H.G', equipment: 'All personal safety gear' },
      5: { title: 'Stances & footwork', fitness: 'Interval running', basics: 'Stances & footwork + moving in all directions, switch stance, cut angles & evasion', etiquette: 'Bowing — start of class', sparring: 'Guard & leg checks\nRock back to evade', equipment: 'Thai pads' },
      6: { title: 'Elbows & knees', fitness: 'Skipping\nPush-ups\nSit-ups', basics: 'Elbows & knees\nSkip knees', grappling: 'Elbows & knees in clinch', sparring: 'Shadow sparring', equipment: 'Belly pads (H.G)' },
      7: { title: 'Sparring + rules', fitness: 'Squats + hold\nPlank + balance', basics: 'Hand wrapping\nRules of boxing, mod MT & full MT', etiquette: 'Wai kru', grappling: 'Clinching', sparring: 'Body boxing\nKick sparring (no catching)' },
      8: { title: 'Combos', fitness: 'Running', basics: 'Combos — just hands, high low, moving, hands & legs etc.', equipment: 'Thai pads' }
    }
  },
  'mt-finisher': {
    name: 'Muay Thai Finisher',
    cycleLength: 4,
    topics: {
      1: { title: 'Pad rounds' },
      2: { title: 'Hard sparring' },
      3: { title: 'S&C / tech sparring' },
      4: { title: 'Clinching / sweeps' }
    }
  },
  sanda: {
    name: 'MMA Sanda',
    cycleLength: 8,
    topics: {
      1: { title: 'Basics — hands + self defence', basics: 'Jab, cross, hook, rip & uppercut\nSpinning back kick', equipment: 'Focus mitts (H.G)' },
      2: { title: 'Basics — kicks + evasion', basics: 'Kicks — turning, teep, front', sparring: 'Block, cover, slip & parry strikes\nCatch kicks', equipment: 'Thai pads' },
      3: { title: 'Throws & clinching', basics: 'Back fist + spinning\nOverhand cross\nBreakfalls + rolls\nNage-No Kata', grappling: 'Clinching — enter & exit', sparring: 'Takedowns & throws from clinch', equipment: 'Round pads' },
      4: { title: 'Sparring drills', basics: 'Breakfalls + rolls', grappling: 'Catch kicks & counter', sparring: 'Exchange drills with all gear', equipment: 'All personal safety gear' },
      5: { title: 'Stances & footwork', basics: 'Stances & footwork\nKumite Ichi', sparring: 'Guard & leg checks\nRock back to evade', equipment: 'Thai pads' },
      6: { title: 'Ground grappling + locks', basics: 'All grappling positions', grappling: 'Common locks and defences', sparring: 'Rolling', equipment: 'Mouth guard' },
      7: { title: 'Sparring + rules', basics: 'Hand wrapping\nRules of non and head contact Sanda', etiquette: 'Wai kru', grappling: 'Dirty boxing', sparring: 'Sanda sparring', equipment: 'All personal safety gear' },
      8: { title: 'Combos', basics: 'Combos — just hands, high low, moving, hands & legs etc.', equipment: 'Thai pads' }
    }
  },
  sparring: {
    name: 'Adults Sparring',
    cycleLength: 5,
    topics: {
      1: { title: 'General Sparring',           round: 'Standard dojo sparring with no head contact', extra: 'Countering', format: 'Standard', drills: 'Shotgun rounds' },
      2: { title: 'Grappling',                  round: 'Grappling rounds for karateka', extra: 'Approved submissions', format: 'Standard', drills: 'Ground escapes/locks, general sparring' },
      3: { title: 'Muay Thai / Sanda Sparring', round: 'Muay Thai focussed sparring with touch head contact if agreed', extra: 'Leg catches, takedowns, clinching', format: 'Standard', drills: 'Sanda-style bouts' },
      4: { title: 'Point / Cont. Sparring',     round: 'Point sparring focussed', extra: 'Backfist, waist-up kicks', format: 'Tournament', drills: 'Competition bouts, general sparring' },
      5: { title: 'Exchange Sparring',          round: 'Exchange drills and sparring, focus on offence and defence', extra: 'Movement, cutting angles, evasion', format: 'Standard', drills: '3–8 move combos, general sparring' }
    }
  },
  'kids-sparring': {
    name: 'Kids Sparring',
    cycleLength: 5,
    topics: {
      1: { title: 'General Sparring',     round: 'Standard dojo sparring with no head contact', extra: 'Countering', format: 'Standard', drills: 'Shotgun rounds' },
      2: { title: 'Grappling',            round: 'Grappling rounds for karateka', extra: 'Approved submissions', format: 'Standard', drills: 'Ground escapes/locks' },
      3: { title: 'Sword Fights & Sumo',  round: 'Competition style noodle fights and sumo wrestling', extra: 'Mini tournament — sportsmanship', format: 'Tournament', drills: 'General sparring' },
      4: { title: 'Point / Cont. Sparring', round: 'Point sparring focussed', extra: 'Backfist, waist-up kicks', format: 'Tournament', drills: 'Competition bouts' },
      5: { title: 'Exchange Sparring',    round: 'Exchange drills and sparring', extra: 'Movement, cutting angles, evasion', format: 'Standard', drills: '3–8 move combos' }
    }
  },
  kata: {
    name: 'Kata',
    cycleLength: 12,
    topics: {
      1: { title: 'New kata practice', focus: 'Guided for L.G. Self learning H.G', weapons: true },
      2: { title: 'Stances', focus: 'Balance, power generation', bunkai: 'Throws & Takedowns' },
      3: { title: 'Power Generation / Kime' },
      4: { title: 'Presentation', focus: 'Pre-kata focus', bunkai: 'Strikes & Punches' },
      5: { title: 'All kata', weapons: true },
      6: { title: 'Kicks', focus: 'Balance, targeting, power generation. Accessory work', bunkai: 'Kicks' },
      7: { title: 'Throws', focus: 'Nage-no. How to interpret kata into throws' },
      8: { title: 'Presentation', focus: 'Present under fatigue', bunkai: 'Joint Locks' },
      9: { title: 'All kata', weapons: true },
      10: { title: 'Strikes', focus: 'Change hands or perform kata back to front', bunkai: 'Strikes — kyusho focus' },
      11: { title: 'Mirrored kata' },
      12: { title: 'Presentation', focus: 'Grading / comp preparation', bunkai: 'DIY — students to demo' }
    }
  },
  bjj: {
    name: 'Brazilian / Japanese Jiu Jitsu',
    cycleLength: 12,
    topics: {
      1:  { title: 'Mount', techniques: 'Ude garami (americana)\nAmericana defence — arm bar\nArm bar from mount', tachi: 'Yoko ukemi (side break fall)', teaching: 'Opposite leg hook top mount' },
      2:  { title: 'Mount', techniques: 'Kata juji jime (cross choke)\nSet up cross choke — hand in. Trap and roll\nEzekiel choke', tachi: 'Tsukkomi jime (thrust choke)', teaching: 'Look for the tag — high hands for cross grip' },
      3:  { title: 'Mount', techniques: 'Mount retention — hook and post\nElbow escape\nBottom half escape — bridge', teaching: 'Hip positioning, restrict hips on top' },
      4:  { title: 'Side control', techniques: 'Ude garami (americana)\nFar side arm bar\nKnee ride — cross choke + transition to mount', teaching: 'Take away space' },
      5:  { title: 'Side control — escapes + Half guard pass', techniques: 'Frames — reclaim guard\nSwitch base, clear the knee and cut over hips. Clear the trapped ankle\nBridging options', tachi: 'Kote gaeshi (Wrist turnover)', teaching: "Frames — push yourself away, not the opponent" },
      6:  { title: 'Closed Guard', techniques: 'Ude garami (kimura)\nHip bump sweep\nGuillotine', teaching: 'Guillotine grip' },
      7:  { title: 'Open Guard', techniques: 'Shrimping\nScissor sweep\nHook sweep — post leg from failed scissor', tachi: 'Waki gatame (Armpit lock)', teaching: 'Hip positioning, flat base leg' },
      8:  { title: 'Closed Guard', techniques: 'Arm bar\nSankaku jime (Triangle)\nPendulum sweep', teaching: 'Diamond, use base leg to pivot off armpit' },
      9:  { title: 'Guard pass', techniques: 'Guard break — knee slice\nGuard break — under leg pass\nToreando pass', tachi: 'Tawara gaeshi (rice bail turnover)', teaching: 'Pant grip basics. Guard pass principle — over, under or around' },
      10: { title: 'Back attacks', techniques: 'Hadaka jime (rear naked)\nUde hishigi juji gatame (cross arm lock)\nClear the bottom hook and escape', tachi: 'Uki waza (floating)', teaching: 'Seatbelt position, hooks, itchy back (defence)' },
      11: { title: 'Kesa gatame', techniques: 'Defence — Head frame to leg scissor\nTransition — kesa, side control, mount\nArm lock / wrist lock options from kesa', teaching: 'Stay tight' },
      12: { title: 'Same submission — Other position', techniques: 'Cross choke from guard\nKimura from top side control\nMount — giftwrap — s mount — chair sit — back take', teaching: 'If you can see the back you can take the back' }
    }
  }
};

// ---------- Mat chat topics (kids, monthly) ----------
const MAT_CHATS = [
  null, // 0-indexed offset
  'Goal Setting','Self-confidence','Optimism','Loyalty',
  'Sharing','Determination','Self-discipline','Respect',
  'Teamwork','Courage','Responsibility','Patience'
];

// ---------- BYOBG (Be Your Own Body Guard) reference ----------
const BYOBG = {
  1: 'King hit',
  2: 'Double handed choke',
  3: 'Bear hug',
  4: 'Grab & headbutt',
  5: 'Single arm choke',
  6: 'Grab & shove'
};

/* ====================================================================
   ROTATION PATTERN
   The 2026 rotation table. For each (class type, week number),
   gives the topic number assigned to each day of the week.
   Days indexed M T W Th Sa.
   ==================================================================== */
const ROTATION = {
  // Week 1 starts Monday 30/03/2026
  weekStart: '2026-03-30',
  // 12-week cycle; we encode weeks 1-12. After week 12 it repeats.
  // Each row: classChart -> array length 12 of [M, T, W, Th, Sa] topic numbers.
  // Null means class doesn't run that day.
  patterns: {
    // Mini & Little Ninjas chart (used by MLN class)
    mln: [
      [1,2,3,4,5],   [2,3,4,5,6],   [3,4,5,6,1],   [4,5,6,1,2],
      [5,6,1,2,3],   [6,1,2,3,4],   [1,2,3,4,5],   [2,3,4,5,6],
      [3,4,5,6,1],   [4,5,6,1,2],   [5,6,1,2,3],   [6,1,2,3,4]
    ],
    // Little Ninjas chart (separate from MLN — 12 topic cycle)
    ln: [
      [1,2,3,4,5],   [2,3,4,5,6],   [3,4,5,6,7],   [4,5,6,7,8],
      [5,6,7,8,9],   [6,7,8,9,10],  [7,8,9,10,11], [8,9,10,11,12],
      [9,10,11,12,1],[10,11,12,1,2],[11,12,1,2,3], [12,1,2,3,4]
    ],
    karate: [
      [null,1,null,2,5],   [null,2,null,3,6],   [null,3,null,4,7],   [null,4,null,5,8],
      [null,5,null,6,7],   [null,6,null,7,8],   [null,7,null,8,9],   [null,8,null,9,10],
      [null,9,null,10,11], [null,10,null,11,12],[null,11,null,12,1], [null,12,null,1,2]
    ],
    'jr-muay-thai': [
      [1,2,3,null,5], [2,3,4,null,6], [3,4,5,null,7], [4,5,6,null,8],
      [5,6,7,null,8], [6,7,8,null,1], [7,8,1,null,2], [8,1,2,null,3],
      [1,2,3,null,4], [2,3,4,null,5], [3,4,5,null,6], [4,5,6,null,7]
    ],
    'muay-thai': [
      [1,2,3,4,5], [2,3,4,5,6], [3,4,5,6,7], [4,5,6,7,8],
      [5,6,7,8,1], [6,7,8,1,2], [7,8,1,2,3], [8,1,2,3,4],
      [1,2,3,4,5], [2,3,4,5,6], [3,4,5,6,7], [4,5,6,7,8]
    ],
    'mt-finisher': [
      [1,null,2,null,null], [3,null,4,null,null], [1,null,2,null,null], [3,null,4,null,null],
      [1,null,2,null,null], [3,null,4,null,null], [1,null,2,null,null], [3,null,4,null,null],
      [1,null,2,null,null], [3,null,4,null,null], [1,null,2,null,null], [3,null,4,null,null]
    ],
    'ladies-mt': [
      [2,null,3,null,null], [3,null,4,null,null], [4,null,5,null,null], [5,null,6,null,null],
      [6,null,7,null,null], [7,null,8,null,null], [8,null,1,null,null], [1,null,2,null,null],
      [2,null,3,null,null], [3,null,4,null,null], [4,null,5,null,null], [5,null,6,null,null]
    ],
    sanda: [
      [null,1,null,null,null], [null,2,null,null,null], [null,3,null,null,null], [null,4,null,null,null],
      [null,5,null,null,null], [null,6,null,null,null], [null,7,null,null,null], [null,8,null,null,null],
      [null,1,null,null,null], [null,2,null,null,null], [null,3,null,null,null], [null,4,null,null,null]
    ],
    sparring: [
      [null,null,null,1,null], [null,null,null,2,null], [null,null,null,3,null], [null,null,null,4,null],
      [null,null,null,5,null], [null,null,null,1,null], [null,null,null,2,null], [null,null,null,3,null],
      [null,null,null,4,null], [null,null,null,5,null], [null,null,null,1,null], [null,null,null,2,null]
    ],
    kata: [
      [null,1,null,null,2], [null,2,null,null,3], [null,3,null,null,4], [null,4,null,null,5],
      [null,5,null,null,6], [null,6,null,null,6], [null,7,null,null,null], [null,8,null,null,null],
      [null,9,null,null,null], [null,10,null,null,null], [null,11,null,null,null], [null,12,null,null,null]
    ],
    bjj: [
      [null,null,null,null,1], [null,null,null,null,2], [null,null,null,null,3], [null,null,null,null,4],
      [null,null,null,null,5], [null,null,null,null,6], [null,null,null,null,7], [null,null,null,null,8],
      [null,null,null,null,9], [null,null,null,null,10],[null,null,null,null,11],[null,null,null,null,12]
    ]
  }
};

/* ====================================================================
   EDGEWORTH — instructors, class schedule, and current week roster
   This is what's pulled from the workbook for the seed data.
   ==================================================================== */

const EDGEWORTH_INSTRUCTORS = [
  // PIN is set to 0000 for all by default — to be changed by each instructor on first login.
  { id: 'alysia',    name: 'Shidoin Alysia',       short: 'Alysia',    pin: '0000', role: 'admin' },
  { id: 'andrew',    name: 'Sempai Andrew',        short: 'Andrew',    pin: '0000', role: 'instructor' },
  { id: 'david',     name: 'Sensei David',         short: 'David',     pin: '0000', role: 'instructor' },
  { id: 'gus',       name: 'Sensei Gus',           short: 'Gus',       pin: '0000', role: 'superadmin' },
  { id: 'jen',       name: 'Sensei Jen',           short: 'Jen',       pin: '0000', role: 'instructor' },
  { id: 'john',      name: 'Sempai John',          short: 'John',      pin: '0000', role: 'instructor' },
  { id: 'liam',      name: 'Kru Roi Liam',         short: 'Liam',      pin: '0000', role: 'instructor' },
  { id: 'abbie',     name: 'Sempai-Sho Abbie',     short: 'Abbie',     pin: '0000', role: 'instructor' },
  { id: 'charlotte', name: 'Sempai-Sho Charlotte', short: 'Charlotte', pin: '0000', role: 'instructor' },
  { id: 'aaustin',   name: 'Sempai Aaustin',       short: 'Aaustin',   pin: '0000', role: 'instructor' },
  { id: 'gavin',     name: 'Sensei Gavin',         short: 'Gavin',     pin: '0000', role: 'instructor' },
  { id: 'luke',      name: 'Chukyu Luke',          short: 'Luke',      pin: '0000', role: 'instructor' },
  { id: 'pete',      name: 'Sempai Pete',          short: 'Pete',      pin: '0000', role: 'instructor' },
  { id: 'brodie',    name: 'Nakmuay Brodie',       short: 'Brodie',    pin: '0000', role: 'instructor' },
  { id: 'bridget',   name: 'Sensei Bridget',       short: 'Bridget',   pin: '0000', role: 'instructor' },
  { id: 'seraphim',  name: 'Seraphim',             short: 'Seraphim',  pin: '0000', role: 'junior' },
  { id: 'ameera',    name: 'Ameera',               short: 'Ameera',    pin: '0000', role: 'junior' },
  { id: 'lara',      name: 'Lara',                 short: 'Lara',      pin: '0000', role: 'junior' },
  { id: 'josie',     name: 'Josie',                short: 'Josie',     pin: '0000', role: 'junior' },
  { id: 'caitlyn',   name: 'Caitlyn',              short: 'Caitlyn',   pin: '0000', role: 'junior' },
  { id: 'lylah',     name: 'Lylah',                short: 'Lylah',     pin: '0000', role: 'junior' }
];

/* The class schedule for Edgeworth. Recurring weekly. */
const EDGEWORTH_SCHEDULE = [
  // Monday
  { day: 1, start: '15:45', end: '16:15', type: 'mini-ninjas' },
  { day: 1, start: '16:20', end: '17:00', type: 'little-ninjas' },
  { day: 1, start: '17:00', end: '17:40', type: 'jr-muay-thai' },
  { day: 1, start: '17:40', end: '18:20', type: 'kids-sparring' },
  { day: 1, start: '17:40', end: '18:30', type: 'ladies-mt' },
  { day: 1, start: '18:30', end: '19:10', type: 'plates' },
  { day: 1, start: '19:10', end: '20:00', type: 'muay-thai' },
  { day: 1, start: '20:00', end: '20:30', type: 'mt-finisher' },
  // Tuesday
  { day: 2, start: '09:15', end: '10:00', type: 'muay-thai' },
  { day: 2, start: '10:00', end: '10:30', type: 'mini-ninjas' },
  { day: 2, start: '16:20', end: '17:00', type: 'little-ninjas' },
  { day: 2, start: '17:00', end: '17:40', type: 'kids-kata' },
  { day: 2, start: '17:00', end: '17:40', type: 'jr-muay-thai' },
  { day: 2, start: '17:40', end: '18:30', type: 'karate' },
  { day: 2, start: '18:30', end: '19:10', type: 'basics-kata' },
  { day: 2, start: '18:30', end: '19:10', type: 'sparring' },
  { day: 2, start: '19:10', end: '20:00', type: 'muay-thai' },
  { day: 2, start: '19:10', end: '20:00', type: 'mma-sanda' },
  // Wednesday
  { day: 3, start: '15:45', end: '16:15', type: 'mini-ninjas' },
  { day: 3, start: '16:20', end: '17:00', type: 'little-ninjas' },
  { day: 3, start: '17:00', end: '17:40', type: 'jr-muay-thai' },
  { day: 3, start: '17:40', end: '18:30', type: 'ladies-mt' },
  { day: 3, start: '18:30', end: '19:10', type: 'strength-cond' },
  { day: 3, start: '19:10', end: '20:00', type: 'muay-thai' },
  { day: 3, start: '20:00', end: '20:30', type: 'mt-finisher' },
  // Thursday
  { day: 4, start: '06:00', end: '06:45', type: 'muay-thai' },
  { day: 4, start: '15:45', end: '16:15', type: 'mini-ninjas' },
  { day: 4, start: '16:20', end: '17:00', type: 'little-ninjas' },
  { day: 4, start: '17:00', end: '17:40', type: 'kids-sparring' },
  { day: 4, start: '17:00', end: '17:40', type: 'kids-kata' },
  { day: 4, start: '17:40', end: '18:30', type: 'karate' },
  { day: 4, start: '18:30', end: '19:10', type: 'sparring' },
  { day: 4, start: '18:30', end: '19:10', type: 'kobudo' },
  { day: 4, start: '19:10', end: '20:00', type: 'muay-thai' },
  { day: 4, start: '20:00', end: '20:50', type: 'jiu-jitsu' },
  // Saturday
  { day: 6, start: '09:00', end: '09:30', type: 'mini-ninjas' },
  { day: 6, start: '09:30', end: '10:15', type: 'little-ninjas' },
  { day: 6, start: '09:30', end: '10:15', type: 'karate' },
  { day: 6, start: '10:15', end: '10:45', type: 'sparring' },
  { day: 6, start: '10:15', end: '10:45', type: 'kata' },
  { day: 6, start: '10:45', end: '11:30', type: 'jr-muay-thai' },
  { day: 6, start: '10:45', end: '11:30', type: 'muay-thai' },
  { day: 6, start: '11:30', end: '13:00', type: 'jiu-jitsu' }
];

/* Default instructor assignments per recurring class slot.
   Stored by "day-start-type" key. */
const EDGEWORTH_DEFAULTS = {
  // Monday
  '1-15:45-mini-ninjas':   { lead: 'abbie',   assist: 'aaustin',   junior: null,       backup: 'alysia' },
  '1-16:20-little-ninjas': { lead: 'aaustin', assist: 'abbie',     junior: null,       backup: 'alysia' },
  '1-17:00-jr-muay-thai':  { lead: 'aaustin', assist: null,        junior: 'josie',    backup: 'alysia' },
  '1-17:40-kids-sparring': { lead: 'aaustin', assist: null,        junior: null,       backup: 'alysia' },
  '1-17:40-ladies-mt':     { lead: 'bridget', assist: null,        junior: null,       backup: 'alysia' },
  '1-18:30-plates':        { lead: 'alysia',  assist: null,        junior: null,       backup: 'jen' },
  '1-19:10-muay-thai':     { lead: 'alysia',  assist: null,        junior: null,       backup: null },
  '1-20:00-mt-finisher':   { lead: 'aaustin', assist: null,        junior: null,       backup: 'alysia' },
  // Tuesday
  '2-09:15-muay-thai':     { lead: 'alysia',  assist: null,        junior: null,       backup: 'jen' },
  '2-10:00-mini-ninjas':   { lead: 'jen',     assist: null,        junior: null,       backup: 'jen' },
  '2-16:20-little-ninjas': { lead: 'john',    assist: null,        junior: 'lylah',    backup: 'gus' },
  '2-17:00-kids-kata':     { lead: 'john',    assist: null,        junior: 'lylah',    backup: 'gus' },
  '2-17:00-jr-muay-thai':  { lead: 'aaustin', assist: 'abbie',     junior: 'seraphim', backup: 'gus' },
  '2-17:40-karate':        { lead: 'gus',     assist: null,        junior: null,       backup: 'david' },
  '2-18:30-basics-kata':   { lead: 'gus',     assist: null,        junior: null,       backup: 'david' },
  '2-18:30-sparring':      { lead: 'aaustin', assist: null,        junior: null,       backup: null },
  '2-19:10-muay-thai':     { lead: 'aaustin', assist: null,        junior: null,       backup: null },
  '2-19:10-mma-sanda':     { lead: 'david',   assist: null,        junior: null,       backup: 'jen' },
  // Wednesday
  '3-15:45-mini-ninjas':   { lead: 'alysia',  assist: null,        junior: null,       backup: 'alysia' },
  '3-16:20-little-ninjas': { lead: 'alysia',  assist: null,        junior: 'lara',     backup: 'alysia' },
  '3-17:00-jr-muay-thai':  { lead: 'alysia',  assist: null,        junior: null,       backup: 'jen' },
  '3-17:40-ladies-mt':     { lead: 'jen',     assist: null,        junior: null,       backup: 'alysia' },
  '3-18:30-strength-cond': { lead: 'gus',     assist: null,        junior: null,       backup: 'david' },
  '3-19:10-muay-thai':     { lead: 'david',   assist: null,        junior: null,       backup: 'gus' },
  '3-20:00-mt-finisher':   { lead: 'david',   assist: null,        junior: null,       backup: 'gus' },
  // Thursday
  '4-06:00-muay-thai':     { lead: 'jen',     assist: 'abbie',     junior: null,       backup: 'gus' },
  '4-15:45-mini-ninjas':   { lead: 'bridget', assist: null,        junior: 'caitlyn',  backup: null },
  '4-16:20-little-ninjas': { lead: 'bridget', assist: 'charlotte', junior: null,       backup: null },
  '4-17:00-kids-sparring': { lead: 'jen',     assist: null,        junior: null,       backup: 'gus' },
  '4-17:00-kids-kata':     { lead: 'bridget', assist: 'charlotte', junior: null,       backup: 'gus' },
  '4-17:40-karate':        { lead: 'gavin',   assist: null,        junior: null,       backup: 'alysia' },
  '4-18:30-sparring':      { lead: 'liam',    assist: null,        junior: null,       backup: 'david' },
  '4-18:30-kobudo':        { lead: 'gavin',   assist: null,        junior: null,       backup: 'alysia' },
  '4-19:10-muay-thai':     { lead: 'liam',    assist: null,        junior: null,       backup: 'gus' },
  '4-20:00-jiu-jitsu':     { lead: 'gus',     assist: null,        junior: null,       backup: 'brodie' },
  // Saturday
  '6-09:00-mini-ninjas':   { lead: 'alysia',  assist: 'charlotte', junior: null,       backup: 'david' },
  '6-09:30-little-ninjas': { lead: 'alysia',  assist: 'charlotte', junior: null,       backup: 'david' },
  '6-09:30-karate':        { lead: null,      assist: 'pete',      junior: null,       backup: 'aaustin' },
  '6-10:15-sparring':      { lead: 'pete',    assist: null,        junior: null,       backup: 'pete' },
  '6-10:15-kata':          { lead: 'alysia',  assist: null,        junior: null,       backup: null },
  '6-10:45-jr-muay-thai':  { lead: 'alysia',  assist: null,        junior: null,       backup: 'david' },
  '6-10:45-muay-thai':     { lead: null,      assist: null,        junior: null,       backup: 'aaustin' },
  '6-11:30-jiu-jitsu':     { lead: 'gus',     assist: null,        junior: null,       backup: 'brodie' }
};

/* ====================================================================
   SCHOOL DATA REGISTRY
   Maps school_id → { instructors, schedule, defaults, contact }
   Edgeworth is seeded from the constants above.
   Other schools are populated via the onboarding wizard and persisted.
   ==================================================================== */
const SCHOOL_DATA_SEED = {
  edgeworth: {
    instructors: EDGEWORTH_INSTRUCTORS,
    schedule:    EDGEWORTH_SCHEDULE,
    defaults:    EDGEWORTH_DEFAULTS,
    contact:     SCHOOL_CONTACTS.edgeworth
  }
};

/* GRADING DATES — HQ-controlled, applies network-wide
   Used to flag classes in the 4 weeks leading up as "grading prep" */
const GRADING_DATES = [
  { date: '2026-06-26', label: 'Mid-year gradings — Friday', notes: 'Mini Ninjas, Little Ninjas, Junior Muay Thai' },
  { date: '2026-06-27', label: 'Mid-year gradings — Saturday', notes: 'Karate, Muay Thai (all grades)' },
  { date: '2026-12-12', label: 'End-of-year gradings — Friday', notes: '' },
  { date: '2026-12-13', label: 'End-of-year gradings — Saturday', notes: '' }
];

/* ====================================================================
   PROGRESSION SYSTEM
   KRMAS rank progression — Mini Ninjas through Black Belt levels
   for each of the six core programs, plus age-based transitions.
   Source: KRMAS Progression Planner standalone tool.
   ==================================================================== */
const PROGRESSION_TRANSITIONS = [
  { fromId: 'miniLittleNinjas', toId: 'littleNinjas', minAgeYears: 6,  label: 'Move to KR Little Ninjas (age 6)' },
  { fromId: 'littleNinjas',     toId: 'karate',       minAgeYears: 13, label: 'Move to KR Karate (age 13)' },
  { fromId: 'juniorMuayThai',   toId: 'muayThai',     minAgeYears: 13, label: 'Move to KR Muay Thai (age 13)' }
];

const PROGRESSION_PROGRAMS = [
  { id: 'miniLittleNinjas', name: 'KR Mini Little Ninjas', type: 'Karate (3–5)', colour: '#7C3AED', ranks: [
    { id: 'mln-l1', label: 'Level 1 Yellow', minAgeYears: 3.25, minDays: 90 },
    { id: 'mln-l2', label: 'Level 2 Orange', minAgeYears: 3.5,  minDays: 90 },
    { id: 'mln-l3', label: 'Level 3 Blue',   minAgeYears: 3.75, minDays: 90 },
    { id: 'mln-l4', label: 'Level 4 Purple', minAgeYears: 4,    minDays: 90 },
    { id: 'mln-l5', label: 'Level 5 Green',  minAgeYears: 4.5,  minDays: 180 },
    { id: 'mln-l6', label: 'Level 6 Brown',  minAgeYears: 5,    minDays: 180 },
    { id: 'mln-l7', label: 'Level 7 Red',    minAgeYears: 5.5,  minDays: 180 }
  ]},
  { id: 'littleNinjas', name: 'KR Little Ninjas', type: 'Karate (6–12)', colour: '#6D28D9', ranks: [
    { id: 'ln-yw',  label: 'Yellow/White',                  minAgeYears: 6,  minDays: 90 },
    { id: 'ln-y',   label: 'Yellow',                        minAgeYears: 6,  minDays: 90 },
    { id: 'ln-ow',  label: 'Orange/White',                  minAgeYears: 6,  minDays: 90 },
    { id: 'ln-o',   label: 'Orange',                        minAgeYears: 6,  minDays: 90 },
    { id: 'ln-bw',  label: 'Blue/White',                    minAgeYears: 6,  minDays: 90 },
    { id: 'ln-b',   label: 'Blue',                          minAgeYears: 6,  minDays: 90 },
    { id: 'ln-pw',  label: 'Purple/White',                  minAgeYears: 7,  minDays: 90 },
    { id: 'ln-p',   label: 'Purple',                        minAgeYears: 7,  minDays: 90 },
    { id: 'ln-gw',  label: 'Green/White',                   minAgeYears: 8,  minDays: 90 },
    { id: 'ln-g',   label: 'Green',                         minAgeYears: 8,  minDays: 90 },
    { id: 'ln-gb',  label: 'Green/Black',                   minAgeYears: 9,  minDays: 180 },
    { id: 'ln-rw',  label: 'Red/White',                     minAgeYears: 9,  minDays: 180 },
    { id: 'ln-r',   label: 'Red',                           minAgeYears: 10, minDays: 180 },
    { id: 'ln-rb',  label: 'Red/Black',                     minAgeYears: 11, minDays: 210 },
    { id: 'ln-grad',label: 'Graduation 1st Kyu Sempai',     minAgeYears: 12, minDays: 365 }
  ]},
  { id: 'juniorMuayThai', name: 'KR Junior Muay Thai', type: 'Muay Thai (7–13)', colour: '#0284C7', ranks: [
    { id: 'jmt-y1', label: 'Jnr Yellow 1', minAgeYears: 7,  minDays: 90 },
    { id: 'jmt-y2', label: 'Jnr Yellow 2', minAgeYears: 7,  minDays: 90 },
    { id: 'jmt-y3', label: 'Jnr Yellow 3', minAgeYears: 7,  minDays: 90 },
    { id: 'jmt-y4', label: 'Jnr Yellow 4', minAgeYears: 8,  minDays: 90 },
    { id: 'jmt-b1', label: 'Jnr Blue 1',   minAgeYears: 8,  minDays: 90 },
    { id: 'jmt-b2', label: 'Jnr Blue 2',   minAgeYears: 8,  minDays: 90 },
    { id: 'jmt-b3', label: 'Jnr Blue 3',   minAgeYears: 9,  minDays: 90 },
    { id: 'jmt-b4', label: 'Jnr Blue 4',   minAgeYears: 9,  minDays: 90 },
    { id: 'jmt-p1', label: 'Jnr Purple 1', minAgeYears: 10, minDays: 90 },
    { id: 'jmt-p2', label: 'Jnr Purple 2', minAgeYears: 10, minDays: 90 },
    { id: 'jmt-p3', label: 'Jnr Purple 3', minAgeYears: 11, minDays: 90 },
    { id: 'jmt-p4', label: 'Jnr Purple 4', minAgeYears: 11, minDays: 180 },
    { id: 'jmt-g1', label: 'Jnr Green 1',  minAgeYears: 12, minDays: 180 },
    { id: 'jmt-g2', label: 'Jnr Green 2',  minAgeYears: 12, minDays: 180 },
    { id: 'jmt-g3', label: 'Jnr Green 3',  minAgeYears: 13, minDays: 210 }
  ]},
  { id: 'karate', name: 'KR Karate', type: 'Karate (13+)', colour: '#c8102e', ranks: [
    { id: 'k-y',   label: 'Yellow 9th Kyu',      minAgeYears: 12, minDays: 90 },
    { id: 'k-o',   label: 'Orange 8th Kyu',      minAgeYears: 12, minDays: 90 },
    { id: 'k-b',   label: 'Blue 7th Kyu',        minAgeYears: 12, minDays: 90 },
    { id: 'k-p',   label: 'Purple 6th Kyu',      minAgeYears: 12, minDays: 90 },
    { id: 'k-g',   label: 'Green 5th Kyu',       minAgeYears: 12, minDays: 90 },
    { id: 'k-bw',  label: 'Brown/White 4th Kyu', minAgeYears: 12, minDays: 90 },
    { id: 'k-b3',  label: 'Brown 3rd Kyu',       minAgeYears: 12, minDays: 180 },
    { id: 'k-bb',  label: 'Brown/Black 2nd Kyu', minAgeYears: 12, minDays: 180 },
    { id: 'k-bw1', label: 'Black/White 1st Kyu', minAgeYears: 13, minDays: 210 },
    { id: 'k-1d',  label: 'Black 1st Degree',    minAgeYears: 14, minDays: 365 },
    { id: 'k-2d',  label: 'Black 2nd Degree',    minAgeYears: 16, minDays: 730 },
    { id: 'k-3d',  label: 'Black 3rd Degree',    minAgeYears: 20, minDays: 1095 },
    { id: 'k-4d',  label: 'Black 4th Degree',    minAgeYears: 25, minDays: 1460 },
    { id: 'k-5d',  label: 'Black 5th Degree',    minAgeYears: 30, minDays: 1825 },
    { id: 'k-6d',  label: 'Black 6th Degree',    minAgeYears: 35, minDays: 1825 },
    { id: 'k-7d',  label: 'Black 7th Degree',    minAgeYears: 40, minDays: 1825 },
    { id: 'k-8d',  label: 'Black 8th Degree',    minAgeYears: 45, minDays: 1825 },
    { id: 'k-9d',  label: 'Black 9th Degree',    minAgeYears: 50, minDays: 1825 },
    { id: 'k-10d', label: 'Black 10th Degree',   minAgeYears: 55, minDays: 1825 }
  ]},
  { id: 'muayThai', name: 'KR Muay Thai', type: 'Muay Thai (13+)', colour: '#0369A1', ranks: [
    { id: 'mt-y1', label: 'Yellow Level 1', minAgeYears: 13, minDays: 90 },
    { id: 'mt-y2', label: 'Yellow Level 2', minAgeYears: 13, minDays: 90 },
    { id: 'mt-b1', label: 'Blue Level 1',   minAgeYears: 13, minDays: 90 },
    { id: 'mt-b2', label: 'Blue Level 2',   minAgeYears: 13, minDays: 90 },
    { id: 'mt-p1', label: 'Purple Level 1', minAgeYears: 13, minDays: 90 },
    { id: 'mt-p2', label: 'Purple Level 2', minAgeYears: 13, minDays: 90 },
    { id: 'mt-g1', label: 'Green Level 1',  minAgeYears: 13, minDays: 180 },
    { id: 'mt-g2', label: 'Green Level 2',  minAgeYears: 14, minDays: 180 },
    { id: 'mt-r',  label: 'Red Kru Roi',    minAgeYears: 14, minDays: 210 },
    { id: 'mt-bk1',label: 'Black Level 1',  minAgeYears: 15, minDays: 1825 },
    { id: 'mt-bk2',label: 'Black Level 2',  minAgeYears: 20, minDays: 3650 },
    { id: 'mt-bk3',label: 'Black Level 3',  minAgeYears: 30, minDays: 3650 },
    { id: 'mt-bk4',label: 'Black Level 4',  minAgeYears: 40, minDays: 3650 },
    { id: 'mt-bk5',label: 'Black Level 5',  minAgeYears: 50, minDays: 3650 }
  ]},
  { id: 'mmaSanda', name: 'KR MMA Sanda', type: 'Combat Sports', colour: '#059669', ranks: [
    { id: 'mma-y1', label: 'Yellow Level 1',   minAgeYears: 13, minDays: 90 },
    { id: 'mma-y2', label: 'Yellow Level 2',   minAgeYears: 13, minDays: 90 },
    { id: 'mma-b1', label: 'Blue Level 1',     minAgeYears: 13, minDays: 90 },
    { id: 'mma-b2', label: 'Blue Level 2',     minAgeYears: 13, minDays: 90 },
    { id: 'mma-p1', label: 'Purple Level 1',   minAgeYears: 13, minDays: 90 },
    { id: 'mma-p2', label: 'Purple Level 2',   minAgeYears: 13, minDays: 90 },
    { id: 'mma-g1', label: 'Green Level 1',    minAgeYears: 13, minDays: 180 },
    { id: 'mma-g2', label: 'Green Level 2',    minAgeYears: 14, minDays: 180 },
    { id: 'mma-r',  label: 'Red Junior Coach', minAgeYears: 14, minDays: 210 },
    { id: 'mma-bk1',label: 'Black Level 1',    minAgeYears: 15, minDays: 1825 },
    { id: 'mma-bk2',label: 'Black Level 2',    minAgeYears: 20, minDays: 3650 },
    { id: 'mma-bk3',label: 'Black Level 3',    minAgeYears: 30, minDays: 3650 },
    { id: 'mma-bk4',label: 'Black Level 4',    minAgeYears: 40, minDays: 3650 },
    { id: 'mma-bk5',label: 'Black Level 5',    minAgeYears: 50, minDays: 3650 }
  ]}
];

function progressionProgramById(id) {
  return PROGRESSION_PROGRAMS.find(p => p.id === id) || null;
}

/* ====================================================================
   INSTRUCTOR PATHWAY
   Mirrors the KRMAS Instructor Tracker spreadsheet "Template" tab.
   Each candidate has goals (sign-off by stakeholder), monthly
   leadership meetings, milestones, and a weaknesses log.
   ==================================================================== */

const INSTRUCTOR_PATHWAY_RECOMMENDERS = [
  'Gus', 'Slim', 'Shidoin', 'Sensei David', 'Sensei Jen', 'Sensei Bridget',
  'Sensei Gavin', 'Kru Roi Liam', 'Sempai Aaustin', 'Sempai John', 'Sempai Pete'
];

// Instructing Goals: stakeholder sign-offs, each worth points when achieved
const INSTRUCTOR_GOALS = [
  { id: 'assistant',    label: 'Assistant',     points: 20 },
  { id: 'instructor',   label: 'Instructor',    points: 30 },
  { id: 'dojo-manager', label: 'Dojo Manager',  points: 0  }, // sign-off only
  { id: 'dojo-owner',   label: 'Dojo Owner',    points: 0  }  // sign-off only
];

// Monthly Leadership Meetings — 3 points per month attended, 12 months max
const INSTRUCTOR_MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];
const INSTRUCTOR_MEETING_POINTS = 3;

// Milestones — one-off achievements with date + reviewer
const INSTRUCTOR_MILESTONES = [
  { id: 'assistant-instructor', label: 'Assistant Instructor', points: 4  },
  { id: 'submitted-section',    label: 'Submitted section plan', points: 5  },
  { id: 'ran-section',          label: 'Ran section plan',     points: 10 },
  { id: 'submitted-class',      label: 'Submitted class plan', points: 10 },
  { id: 'ran-whole-class',      label: 'Ran whole class',      points: 15 }
];

// Helper: compute total points for an instructor pathway record
function instructorPathwayPoints(pathway) {
  if (!pathway) return 0;
  let total = 0;
  // Goals (only count if date set)
  for (const g of INSTRUCTOR_GOALS) {
    if (pathway.goals?.[g.id]?.date) total += g.points;
  }
  // Monthly meetings (year keyed). Sum across all years tracked.
  if (pathway.meetings) {
    for (const yearKey of Object.keys(pathway.meetings)) {
      for (const month of INSTRUCTOR_MONTHS) {
        if (pathway.meetings[yearKey]?.[month]?.date) total += INSTRUCTOR_MEETING_POINTS;
      }
    }
  }
  // Milestones
  for (const m of INSTRUCTOR_MILESTONES) {
    if (pathway.milestones?.[m.id]?.date) total += m.points;
  }
  return total;
}

// ====================================================================
// Grading — syllabi, grades, belt colours
// ====================================================================

const GRADING_SYLLABI = {

  'mln': {
    label: 'Mini Little Ninjas',
    short: 'Minis',
    colour: '#f59e0b',
    hasBeltSize: true,
    /* Minis is a presentation grading — all students pass */
    presentationGrading: true,
    grades: [
      { id: 'mln-0', label: 'White Belt' },
      { id: 'mln-1', label: 'White/Yellow Belt' },
      { id: 'mln-2', label: 'White/Orange Belt' },
      { id: 'mln-3', label: 'White/Blue Belt' },
      { id: 'mln-4', label: 'White/Purple Belt' },
      { id: 'mln-5', label: 'White/Green Belt' },
      { id: 'mln-6', label: 'White/Brown Belt' },
      { id: 'mln-7', label: 'White/Red Belt' },
    ]
  },

  'ln': {
    label: 'Little Ninjas',
    short: 'Little Ninjas',
    colour: '#10b981',
    hasBeltSize: true,
    presentationGrading: false,
    grades: [
      { id: 'ln-0',  label: 'White Belt' },
      { id: 'ln-1',  label: 'Yellow/White Belt' },
      { id: 'ln-2',  label: 'Yellow Belt' },
      { id: 'ln-3',  label: 'Orange/White Belt' },
      { id: 'ln-4',  label: 'Orange Belt' },
      { id: 'ln-5',  label: 'Blue/White Belt' },
      { id: 'ln-6',  label: 'Blue Belt' },
      { id: 'ln-7',  label: 'Purple/White Belt' },
      { id: 'ln-8',  label: 'Purple Belt' },
      { id: 'ln-9',  label: 'Green/White Belt' },
      { id: 'ln-10', label: 'Green Belt' },
      { id: 'ln-11', label: 'Green/Black Belt' },
      { id: 'ln-12', label: 'Red/White Belt' },
      { id: 'ln-13', label: 'Red Belt' },
      { id: 'ln-14', label: 'Red/Black Belt' },
    ]
  },

  'karate': {
    label: 'Karate',
    short: 'Karate',
    colour: '#3b82f6',
    hasBeltSize: true,
    presentationGrading: false,
    grades: [
      { id: 'k-0',  label: 'White Belt',        kyu: 'Ju Kyu' },
      { id: 'k-1',  label: 'Yellow Belt',        kyu: 'Ku Kyu' },
      { id: 'k-2',  label: 'Orange Belt',        kyu: 'Hachi Kyu' },
      { id: 'k-3',  label: 'Blue Belt',          kyu: 'Shichi Kyu' },
      { id: 'k-4',  label: 'Purple Belt',        kyu: 'Roku Kyu' },
      { id: 'k-5',  label: 'Green Belt',         kyu: 'Go Kyu' },
      { id: 'k-6',  label: 'Brown/White Belt',   kyu: 'Yon Kyu' },
      { id: 'k-7',  label: 'Brown Belt',         kyu: 'San Kyu' },
      { id: 'k-8',  label: 'Brown/Black Belt',   kyu: 'Ni Kyu' },
      { id: 'k-9',  label: 'Black/White Belt',   kyu: 'Ik Kyu' },
      { id: 'k-10', label: 'Black Belt',         kyu: 'Sho Dan' },
    ]
  },

  'jmt': {
    label: 'Junior Muay Thai',
    short: 'Jr Muay Thai',
    colour: '#8b5cf6',
    hasBeltSize: false,
    presentationGrading: false,
    grades: [
      { id: 'jmt-0',  label: 'No Badge' },
      { id: 'jmt-1',  label: 'Yellow Level 1' },
      { id: 'jmt-2',  label: 'Yellow Level 2' },
      { id: 'jmt-3',  label: 'Yellow Level 3' },
      { id: 'jmt-4',  label: 'Yellow Level 4' },
      { id: 'jmt-5',  label: 'Blue Level 1' },
      { id: 'jmt-6',  label: 'Blue Level 2' },
      { id: 'jmt-7',  label: 'Blue Level 3' },
      { id: 'jmt-8',  label: 'Blue Level 4' },
      { id: 'jmt-9',  label: 'Purple Level 1' },
      { id: 'jmt-10', label: 'Purple Level 2' },
      { id: 'jmt-11', label: 'Purple Level 3' },
      { id: 'jmt-12', label: 'Purple Level 4' },
      { id: 'jmt-13', label: 'Green Level 1' },
      { id: 'jmt-14', label: 'Green Level 2' },
      { id: 'jmt-15', label: 'Green Level 3' },
    ]
  },

  'mt': {
    label: 'Muay Thai',
    short: 'Muay Thai',
    colour: '#d62828',
    hasBeltSize: false,
    presentationGrading: false,
    grades: [
      { id: 'mt-0',  label: 'No Badge' },
      { id: 'mt-1',  label: 'Yellow Level 1' },
      { id: 'mt-2',  label: 'Yellow Level 2' },
      { id: 'mt-3',  label: 'Blue Level 1' },
      { id: 'mt-4',  label: 'Blue Level 2' },
      { id: 'mt-5',  label: 'Purple Level 1' },
      { id: 'mt-6',  label: 'Purple Level 2' },
      { id: 'mt-7',  label: 'Green Level 1' },
      { id: 'mt-8',  label: 'Green Level 2' },
      { id: 'mt-9',  label: 'Red' },
      { id: 'mt-10', label: 'Black' },
    ]
  },

  'ladies-mt': {
    label: "Ladies Muay Thai",
    short: 'Ladies MT',
    colour: '#ec4899',
    hasBeltSize: false,
    presentationGrading: false,
    /* Same grade structure as adult Muay Thai */
    grades: [
      { id: 'lmt-0',  label: 'No Badge' },
      { id: 'lmt-1',  label: 'Yellow Level 1' },
      { id: 'lmt-2',  label: 'Yellow Level 2' },
      { id: 'lmt-3',  label: 'Blue Level 1' },
      { id: 'lmt-4',  label: 'Blue Level 2' },
      { id: 'lmt-5',  label: 'Purple Level 1' },
      { id: 'lmt-6',  label: 'Purple Level 2' },
      { id: 'lmt-7',  label: 'Green Level 1' },
      { id: 'lmt-8',  label: 'Green Level 2' },
      { id: 'lmt-9',  label: 'Red' },
      { id: 'lmt-10', label: 'Black' },
    ]
  },

  'mma': {
    label: 'MMA Sanda',
    short: 'MMA Sanda',
    colour: '#64748b',
    hasBeltSize: false,
    presentationGrading: false,
    grades: [
      { id: 'mma-0', label: 'No Badge' },
      { id: 'mma-1', label: 'Yellow Level 1' },
      { id: 'mma-2', label: 'Yellow Level 2' },
      { id: 'mma-3', label: 'Blue Level 1' },
      { id: 'mma-4', label: 'Blue Level 2' },
      { id: 'mma-5', label: 'Purple Level 1' },
      { id: 'mma-6', label: 'Purple Level 2' },
      { id: 'mma-7', label: 'Green Level 1' },
      { id: 'mma-8', label: 'Green Level 2' },
      { id: 'mma-9', label: 'Red' },
    ]
  },

  'jiu-jitsu': {
    label: 'Jiu Jitsu',
    short: 'Jiu Jitsu',
    colour: '#0ea5e9',
    hasBeltSize: true,
    presentationGrading: false,
    grades: [
      { id: 'jj-0', label: 'White Belt' },
      { id: 'jj-1', label: 'Blue Belt' },
      { id: 'jj-2', label: 'Purple Belt' },
      { id: 'jj-3', label: 'Brown Belt' },
      { id: 'jj-4', label: 'Black Belt' },
    ]
  }
};

/* Helper: get grade labels array for a syllabus */
function sylGrades(sylKey) {
  return (GRADING_SYLLABI[sylKey]?.grades || []).map(g => g.label);
}

/* Helper: compute new grade from current grade + result */
function gradingNewGrade(sylKey, currentGradeLabel, result, doubleGrade) {
  if (!result || result === '') return null;
  if (result === 'pass-probationary' || result === 'incomplete') return null;
  const syl = GRADING_SYLLABI[sylKey];
  if (!syl) return null;
  const labels = syl.grades.map(g => g.label);
  const idx = labels.indexOf(currentGradeLabel);
  if (idx === -1) return null;
  const steps = (result === 'distinction' || doubleGrade === 'yes') ? 2 : 1;
  const newIdx = idx + steps;
  if (newIdx >= labels.length) return labels[labels.length - 1]; // already at top
  return labels[newIdx] !== labels[idx] ? labels[newIdx] : null;
}

/* Belt size range */
const BELT_SIZES = [1, 2, 3, 4, 5, 6, 7];

/* Grading result options */
const GRADING_RESULTS = [
  { value: '',                  label: '— Not yet graded —' },
  { value: 'pass',              label: 'Pass (Single Rank Promotion)' },
  { value: 'distinction',       label: 'Distinction (Double Rank Promotion)' },
  { value: 'pass-probationary', label: 'Pass Not Yet Complete (Probationary Period)' },
  { value: 'incomplete',        label: 'Pass Incomplete (Re-test required)' },
];

/* Belt colour swatch — split halves for transition belts */
const BELT_COLOURS = {
  'White Belt':        { solid: '#f0f0ee', border: '#ccc' },
  'White/Yellow Belt': { left: '#f0f0ee', right: '#fbbf24' },
  'White/Orange Belt': { left: '#f0f0ee', right: '#f97316' },
  'White/Blue Belt':   { left: '#f0f0ee', right: '#3b82f6' },
  'White/Purple Belt': { left: '#f0f0ee', right: '#8b5cf6' },
  'White/Green Belt':  { left: '#f0f0ee', right: '#10b981' },
  'White/Brown Belt':  { left: '#f0f0ee', right: '#92400e' },
  'White/Red Belt':    { left: '#f0f0ee', right: '#dc2626' },
  'Yellow/White Belt': { left: '#fbbf24', right: '#f0f0ee' },
  'Yellow Belt':       { solid: '#fbbf24' },
  'Orange/White Belt': { left: '#f97316', right: '#f0f0ee' },
  'Orange Belt':       { solid: '#f97316' },
  'Blue/White Belt':   { left: '#3b82f6', right: '#f0f0ee' },
  'Blue Belt':         { solid: '#3b82f6' },
  'Purple/White Belt': { left: '#8b5cf6', right: '#f0f0ee' },
  'Purple Belt':       { solid: '#8b5cf6' },
  'Green/White Belt':  { left: '#10b981', right: '#f0f0ee' },
  'Green Belt':        { solid: '#10b981' },
  'Green/Black Belt':  { left: '#10b981', right: '#1a1a1a' },
  'Red/White Belt':    { left: '#dc2626', right: '#f0f0ee' },
  'Red Belt':          { solid: '#dc2626' },
  'Red Belt':          { solid: '#dc2626' },
  'Red/Black Belt':    { left: '#dc2626', right: '#1a1a1a' },
  'Brown/White Belt':  { left: '#92400e', right: '#f0f0ee' },
  'Brown Belt':        { solid: '#92400e' },
  'Brown/Black Belt':  { left: '#92400e', right: '#1a1a1a' },
  'Black/White Belt':  { left: '#1a1a1a', right: '#f0f0ee' },
  'Black Belt':        { solid: '#1a1a1a' },
  'No Badge':          { solid: '#e5e7eb', border: '#ccc' },
  'Red':               { solid: '#dc2626' },
  'Black':             { solid: '#1a1a1a' },
};

function beltSwatch(grade, size) {
  size = size || 20;
  const c = BELT_COLOURS[grade];
  if (!c) return `<span style="display:inline-block;width:${size}px;height:${Math.round(size/2)}px;border-radius:2px;background:#e5e7eb;border:1px solid #ccc;vertical-align:middle;margin-right:4px;flex-shrink:0;"></span>`;
  let bg, border = '1px solid rgba(0,0,0,0.12)';
  if (c.solid) { bg = c.solid; if (c.border) border = `1px solid ${c.border}`; }
  else bg = `linear-gradient(90deg, ${c.left} 50%, ${c.right} 50%)`;
  return `<span style="display:inline-block;width:${size}px;height:${Math.round(size/2)}px;border-radius:2px;background:${bg};border:${border};vertical-align:middle;margin-right:4px;flex-shrink:0;"></span>`;
}

/* Text colour for a grade label — used on result pills */
function beltTextColour(grade) {
  const c = BELT_COLOURS[grade];
  if (!c) return '#1a1a1a';
  const dark = ['Blue Belt','Purple Belt','Green Belt','Brown Belt','Brown/Black Belt','Black/White Belt','Black Belt','Red Belt','Red/Black Belt','Red','Black','Green/Black Belt'];
  if (dark.includes(grade)) return '#ffffff';
  return '#1a1a1a';
}

// ====================================================================
// School timetables and metadata (17 schools)
// ====================================================================

function guessClassType(label) {
  const l = label.toLowerCase();
  if (l.includes('mini') && (l.includes('ninja') || l.includes('3-5') || l.includes('4-5') || l.includes('3 to 5'))) return 'mini-ninjas';
  if (l.includes('little ninja') || (l.includes('ninja') && (l.includes('6') || l.includes('8') || l.includes('9') || l.includes('10') || l.includes('11') || l.includes('5-')))) return 'little-ninjas';
  if (l.includes('colts') && l.includes('karate')) return 'karate';
  if (l.includes('hyper')) return 'karate'; // treat hyper as karate variant
  if (l.includes('karate') && (l.includes('adult') || l.includes('13') || l.includes('15') || l.includes('16') || l.includes('17') || l.includes('12+'))) return 'karate';
  if (l.includes('karate')) return 'little-ninjas'; // kids karate default
  if (l.includes('junior') && l.includes('muay') || l.includes('jnr') && l.includes('muay') || l.includes('muay') && (l.includes('7') || l.includes('8') || l.includes('junior') || l.includes('jnr') || l.includes('mod') || l.includes('teen') || l.includes('12-') || l.includes('13'))) return 'jr-muay-thai';
  if (l.includes('mini muay') || l.includes('muay') && l.includes('3-5')) return 'mini-ninjas';
  if (l.includes('ladies') && l.includes('muay') || l.includes('women') && l.includes('muay')) return 'ladies-mt';
  if (l.includes('muay') || l.includes('kickbox')) return 'muay-thai';
  if (l.includes('sanda') || l.includes('mma')) return 'mma-sanda';
  if (l.includes('jiu jitsu') || l.includes('jiujitsu') || l.includes('jujitsu')) return 'jiu-jitsu';
  if (l.includes('sparring') || l.includes('open mat') || l.includes('fight club')) return 'sparring';
  if (l.includes('kata') || l.includes('grading prep')) return 'kata';
  if (l.includes('kobudo') || l.includes('weapons') || l.includes('philippine')) return 'kobudo';
  if (l.includes('strength') || l.includes('s&c') || l.includes('conditioning') || l.includes('fitness') || l.includes('nrg') || l.includes('hiit') || l.includes('kr fit')) return 'strength-cond';
  if (l.includes('pilates') || l.includes('plates')) return 'plates';
  if (l.includes('basics')) return 'basics-kata';
  if (l.includes('leadership')) return 'karate'; // leadership as karate variant
  if (l.includes('basics') && l.includes('kata')) return 'basics-kata';
  if (l.includes('black belt') || l.includes('black badge')) return 'karate';
  return 'karate';
}

function t(day, start, end, label) {
  return { day, start, end, type: guessClassType(label), label };
}

/* ====================================================================
   SCHOOL SEED DATA
   ==================================================================== */
const SCHOOL_SEEDS = {

  beecroft: {
    name: 'Beecroft',
    state: 'NSW',
    address: 'Beecroft Community Hall, Beecroft Rd, Beecroft',
    phone: '0449 797 008',
    email: '',
    activeDays: [2, 3, 4],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Beecroft' },
    schedule: [
      t(1,'16:00','16:45','Little Ninjas Karate 5-12yrs'),
      t(2,'16:00','16:45','Little Ninjas Karate 5-12yrs'),
      t(2,'16:45','17:15','Jnr Kata & Makeup Class 5-12yrs'),
      t(2,'17:15','18:00','Little Ninjas Karate 5-12yrs'),
      t(2,'18:00','19:00','Adults Muay Thai'),
      t(2,'18:00','19:00','Adults Karate'),
      t(3,'16:00','16:45','Little Ninjas Karate 5-12yrs'),
      t(3,'16:45','17:15','Jnr Kata & Makeup 5-12yrs'),
      t(3,'17:15','18:00','Little Ninjas Karate 5-12yrs'),
      t(3,'18:00','19:00','Adults Muay Thai'),
      t(3,'19:00','19:30','Advanced Karate & Muay Thai'),
      t(3,'20:00','20:30','Advanced Karate & Muay Thai'),
      t(4,'16:00','16:45','Little Ninjas Karate 5-12yrs'),
      t(4,'16:45','17:15','Jnr Kata & Makeup 5-12yrs'),
      t(4,'17:15','18:00','Little Ninjas Karate 5-12yrs'),
      t(4,'18:00','19:00','Adults Muay Thai'),
      t(4,'18:00','19:00','Adults Karate'),
    ]
  },

  cootamundra: {
    name: 'Cootamundra',
    state: 'NSW',
    address: '88 Parker Street, Cootamundra NSW 2590',
    phone: '0431 373 658',
    email: '',
    activeDays: [1, 2, 3, 4],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Cootamundra' },
    schedule: [
      t(1,'17:30','18:10','Little Ninjas 5-13yrs'),
      t(1,'18:20','19:00','Sparring'),
      t(2,'17:30','18:10','Junior Muay Thai 5-13yrs'),
      t(2,'18:20','19:05','Adults Karate 13+'),
      t(2,'19:15','20:00','Muay Thai 13+yrs'),
      t(3,'17:30','18:10','Little Ninjas 5-13yrs'),
      t(3,'18:20','19:00','Martial Arts Fitness'),
      t(3,'19:15','20:00','Women\'s Only Muay Thai 13+'),
      t(4,'17:30','18:10','Junior Muay Thai 5-13yrs'),
      t(4,'18:20','19:05','Adults Karate 13+'),
      t(4,'19:15','20:00','Muay Thai 13+yrs'),
    ]
  },

  cowra: {
    name: 'Cowra',
    state: 'NSW',
    address: '17 Kollas Drive, Cowra NSW',
    phone: '0493 383 714',
    email: '',
    activeDays: [1, 2, 3, 4, 5],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Cowra' },
    schedule: [
      t(1,'16:00','16:30','Mini Little Ninjas 4-5yrs'),
      t(1,'16:30','17:15','Little Ninjas Karate 6-9yrs'),
      t(1,'17:20','18:05','Junior Muay Thai 7-13yrs'),
      t(1,'18:10','18:55','Ladies Only Muay Thai 11+'),
      t(1,'19:00','20:00','Muay Thai 14+yrs'),
      t(2,'16:30','17:15','Little Ninjas Karate 6-9yrs'),
      t(2,'17:15','17:40','Kata'),
      t(2,'17:40','18:25','Colts Karate 10-12yrs'),
      t(2,'18:30','18:55','Tournament'),
      t(2,'19:00','20:00','Karate 13+yrs'),
      t(3,'16:00','16:30','Mini Little Ninjas 4-5yrs'),
      t(3,'16:30','17:15','Little Ninjas Karate 6-9yrs'),
      t(3,'17:20','18:05','Junior Muay Thai 7-13yrs'),
      t(3,'18:10','18:55','Ladies Only Muay Thai 11+'),
      t(3,'19:00','20:00','Muay Thai 14+yrs'),
      t(4,'16:30','17:15','Little Ninjas Karate 6-9yrs'),
      t(4,'17:15','17:40','Tournament'),
      t(4,'17:40','18:25','Colts Karate 10-12yrs'),
      t(4,'18:30','18:55','Kata'),
      t(4,'19:00','20:00','Karate 13+yrs'),
      t(5,'17:20','18:05','Junior Muay Thai 7-13yrs'),
      t(5,'18:10','18:55','Ladies Only Muay Thai 11+'),
      t(5,'19:00','20:00','Muay Thai 14+yrs'),
    ]
  },

  dubbo: {
    name: 'Dubbo',
    state: 'NSW',
    address: 'Unit 1A 55 Wheelers Lane, Dubbo NSW 2830',
    phone: '0402 707 705',
    email: '',
    activeDays: [1, 2, 3, 4, 5, 6],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Dubbo' },
    schedule: [
      t(1,'16:00','16:40','Mini Little Ninjas 4-5yrs'),
      t(1,'16:45','17:25','Mini Little Ninjas 4-5yrs'),
      t(1,'16:00','16:45','Little Ninjas White to Orange'),
      t(1,'16:50','17:35','Little Ninjas Orange to Purple'),
      t(1,'17:40','18:40','Little Ninjas Purple Belt+'),
      t(1,'17:30','18:30','Colts Muay Thai 12-15yrs'),
      t(1,'17:30','18:30','Muay Thai 16+yrs'),
      t(1,'19:00','20:00','Colts Karate 12-15yrs'),
      t(1,'19:00','20:00','Karate 16+yrs'),
      t(2,'16:00','16:40','Mini Little Ninjas 4-5yrs'),
      t(2,'16:00','16:45','Little Ninjas White to Orange'),
      t(2,'16:45','17:25','Muay Thai 8-11yrs'),
      t(2,'16:50','17:35','Little Ninjas Orange to Purple'),
      t(2,'17:40','18:25','Hyper Little Ninjas 8-11yrs'),
      t(2,'18:30','19:30','Colts Karate 12-15yrs'),
      t(2,'19:00','20:00','Colts Muay Thai 12-15yrs'),
      t(2,'19:00','20:00','Muay Thai 16+yrs'),
      t(3,'16:00','16:40','Mini Little Ninjas 4-5yrs'),
      t(3,'16:45','17:25','Mini Little Ninjas 4-5yrs'),
      t(3,'16:00','16:45','Little Ninjas White to Orange'),
      t(3,'16:50','17:35','Little Ninjas Orange to Purple'),
      t(3,'17:40','18:40','Little Ninjas Purple Belt+'),
      t(3,'17:30','18:30','Colts Karate 12-15yrs'),
      t(3,'19:00','20:00','Karate 16+yrs'),
      t(4,'16:00','16:40','Mini Little Ninjas 4-5yrs'),
      t(4,'16:00','16:45','Little Ninjas White to Orange'),
      t(4,'16:45','17:25','Muay Thai 8-11yrs'),
      t(4,'16:50','17:35','Little Ninjas Orange to Purple'),
      t(4,'17:30','18:30','Colts Karate 12-15yrs'),
      t(4,'19:00','20:00','Colts Muay Thai 12-15yrs'),
      t(4,'19:00','20:00','Muay Thai 16+yrs'),
      t(5,'16:00','16:40','Mini Little Ninjas 4-5yrs'),
      t(5,'16:00','16:45','Little Ninjas White to Orange'),
      t(5,'16:50','17:35','Little Ninjas Orange to Purple'),
      t(5,'17:40','18:25','Hyper Little Ninjas 8-11yrs'),
      t(5,'18:30','19:30','Adults Hyper 16+'),
      t(5,'18:30','19:30','Colts Hyper 12-15yrs'),
      t(6,'09:00','09:45','Little Ninjas Karate 6-11yrs'),
      t(6,'09:50','10:35','Little Ninjas Orange to Purple'),
      t(6,'10:40','11:40','Little Ninjas Purple Belt+'),
    ]
  },

  harden: {
    name: 'Harden',
    state: 'NSW',
    address: "'Hard Rock Gym' Station Street, Harden NSW 2587",
    phone: '0409 788 415',
    email: '',
    activeDays: [1, 2, 3],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Harden' },
    schedule: [
      t(1,'17:00','17:45','Little Ninjas Karate 7-12yrs'),
      t(1,'17:50','18:35','Junior Muay Thai 7-12yrs'),
      t(1,'18:40','19:25','Karate Colts/Adults 13+'),
      t(1,'19:30','20:15','Muay Thai Colts/Adults 13+'),
      t(2,'18:00','18:30','Ladies Fitness/Technique'),
      t(2,'18:30','19:30','Ladies Muay Thai'),
      t(3,'17:00','17:45','Little Ninjas Karate 7-12yrs'),
      t(3,'17:50','18:35','Philippine Martial Arts'),
      t(3,'18:40','19:25','Karate Colts/Adults 13+'),
      t(3,'19:30','20:15','Muay Thai Colts/Adults 13+'),
    ]
  },

  lithgow: {
    name: 'Lithgow',
    state: 'NSW',
    address: 'L3 84 Main Street, Lithgow NSW',
    phone: '0418 481 153',
    email: '',
    activeDays: [1, 2, 3, 4, 5, 6],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Lithgow' },
    schedule: [
      t(1,'15:45','16:25','Little Ninjas 6-12yrs'),
      t(1,'16:30','17:00','Sparring Little Ninjas/JMT'),
      t(1,'17:00','17:40','Junior Muay Thai 7-13yrs'),
      t(1,'17:45','18:30','Colts Muay Thai 13-17yrs'),
      t(1,'18:30','19:20','Ladies Muay Thai'),
      t(1,'19:20','20:20','Muay Thai 14+yrs'),
      t(2,'16:00','16:30','Mini Ninjas 3-5yrs'),
      t(2,'16:30','17:10','Little Ninjas White to Orange'),
      t(2,'17:10','17:50','Little Ninjas Blue/White+'),
      t(2,'17:50','18:20','Weapons All Ages'),
      t(2,'18:30','19:30','Adults Karate 13+'),
      t(2,'19:30','20:00','Adults Kata'),
      t(3,'15:45','16:25','Little Ninjas 6-12yrs'),
      t(3,'16:30','17:10','Junior Muay Thai 7-13yrs'),
      t(3,'17:15','18:00','Colts Muay Thai 13-17yrs'),
      t(3,'18:00','18:50','Ladies Muay Thai'),
      t(3,'18:50','19:20','Adult Mixed Sparring 13+'),
      t(3,'19:20','20:20','Muay Thai 14+yrs'),
      t(4,'16:00','16:30','Mini Ninjas 3-5yrs'),
      t(4,'16:30','17:10','Little Ninjas White to Orange'),
      t(4,'17:10','17:40','Sparring Little Ninjas'),
      t(4,'17:40','18:20','Little Ninjas Blue/White+'),
      t(4,'18:30','19:30','Adults Karate 13+'),
      t(4,'19:30','20:00','Advanced Sparring Invitation'),
      t(5,'16:30','18:15','Leadership Invitation'),
      t(5,'17:30','18:30','Tournament Training Invitation'),
      t(6,'10:00','10:50','Mixed Family Karate/Muay Thai'),
    ]
  },

  orange: {
    name: 'Orange',
    state: 'NSW',
    address: '61 Lords Place, Orange NSW 2800',
    phone: '0429 348 901',
    email: '',
    activeDays: [1, 2, 3, 4, 6],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Orange' },
    schedule: [
      t(1,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(1,'16:45','17:15','Mini Little Ninjas 3-5yrs'),
      t(1,'16:00','16:30','Little Ninjas 5-6yrs'),
      t(1,'16:00','16:45','Little Ninjas 7-10yrs'),
      t(1,'17:15','18:00','Colts Karate 11-14yrs'),
      t(1,'16:45','17:30','Junior Muay Thai 7-10yrs'),
      t(1,'16:45','17:30','Colts Muay Thai 11-12yrs'),
      t(1,'17:30','18:00','Mini Little Ninjas 3-5yrs'),
      t(1,'17:30','18:00','Little Ninjas 5-6yrs'),
      t(1,'18:30','19:30','Karate 15+yrs'),
      t(2,'17:15','18:00','Junior Muay Thai 7-10yrs'),
      t(2,'17:15','18:00','Colts Muay Thai 11-14yrs'),
      t(2,'15:15','16:00','Little Ninjas 7-10yrs'),
      t(2,'18:30','19:30','Muay Thai 15+yrs'),
      t(3,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(3,'16:00','16:30','Little Ninjas 5-6yrs'),
      t(3,'16:00','16:45','Little Ninjas 7-10yrs'),
      t(3,'17:15','18:00','Colts Karate 11-14yrs'),
      t(3,'16:45','17:45','Ladies Only Muay Thai'),
      t(4,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(4,'16:00','16:30','Little Ninjas 5-6yrs'),
      t(4,'16:45','17:30','Little Ninjas 7-10yrs'),
      t(4,'17:30','18:15','Little Ninjas 7-10yrs'),
      t(4,'17:30','18:15','Colts Karate 11-14yrs'),
      t(4,'16:00','16:45','Junior Muay Thai 7-10yrs'),
      t(4,'17:15','18:00','Colts Muay Thai 11-14yrs'),
      t(4,'18:30','19:30','Karate 15+yrs'),
      t(4,'18:30','19:30','Muay Thai 15+yrs'),
      t(6,'09:00','09:30','Mini Little Ninjas 3-5yrs'),
      t(6,'09:45','10:15','Mini Little Ninjas 3-5yrs'),
      t(6,'09:00','09:30','Little Ninjas 5-6yrs'),
      t(6,'09:45','10:30','Little Ninjas 7-10yrs'),
    ]
  },

  parkes: {
    name: 'Parkes',
    state: 'NSW',
    address: 'Presbyterian Church Hall, Gap Street, Parkes NSW',
    phone: '0428 626 050',
    email: '',
    activeDays: [2, 4],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Parkes' },
    schedule: [
      // Weeks 1,3,5 and 2,4 have swapped slots — use weeks 1,3,5 as default
      t(2,'17:45','18:30','Little Ninjas Karate 5-11yrs'),
      t(2,'18:40','19:20','Muay Thai Kickboxing 11+'),
      t(2,'19:20','20:00','Weapons Class'),
      t(4,'17:45','18:30','Little Ninjas Karate 5-11yrs'),
      t(4,'18:40','19:20','Karate 12+yrs'),
      t(4,'19:20','20:00','Fight Club'),
    ]
  },

  'port-mac': {
    name: 'Port Macquarie',
    state: 'NSW',
    address: '4 Bellbowrie Street, Port Macquarie NSW 2444',
    phone: '0407 248 648',
    email: '',
    activeDays: [1, 2, 3, 4, 5, 6],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Port Macquarie' },
    schedule: [
      t(1,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(1,'16:10','17:00','Little Ninjas Karate 6-12yrs'),
      t(1,'17:00','17:50','Little Ninjas Karate 6-12yrs'),
      t(1,'17:00','17:50','Junior Muay Thai 7-13yrs'),
      t(1,'17:00','18:00','Colts Karate 12-16yrs'),
      t(1,'18:00','19:00','Muay Thai 13+yrs'),
      t(1,'18:00','19:00','Karate 13+yrs'),
      t(1,'19:00','20:00','MMA Sanda 14+yrs'),
      t(2,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(2,'16:10','17:00','Little Ninjas Karate 6-12yrs'),
      t(2,'17:00','17:50','Junior Muay Thai 7-13yrs'),
      t(2,'17:00','17:50','Leadership Invitation'),
      t(2,'09:10','10:10','Muay Thai 13+yrs'),
      t(2,'18:00','19:00','Muay Thai 13+yrs'),
      t(2,'18:00','19:00','Karate 13+yrs'),
      t(2,'19:00','20:00','Combat Class Invitation'),
      t(2,'19:00','19:30','General Sparring'),
      t(3,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(3,'16:10','17:00','Little Ninjas Karate 6-12yrs'),
      t(3,'17:00','17:50','Junior Muay Thai 7-13yrs'),
      t(3,'17:00','17:50','Kids Athlete Team'),
      t(3,'17:00','18:00','Colts Karate 12-16yrs'),
      t(3,'18:00','19:00','Muay Thai 13+yrs'),
      t(3,'18:00','19:00','Karate 13+yrs'),
      t(3,'19:00','20:00','MMA Sanda 14+yrs'),
      t(4,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(4,'16:10','17:00','Little Ninjas Karate 6-12yrs'),
      t(4,'17:00','17:50','Junior Muay Thai 7-13yrs'),
      t(4,'09:10','10:10','Muay Thai 13+yrs'),
      t(4,'18:00','19:00','Muay Thai 13+yrs'),
      t(4,'18:00','19:00','Karate 13+yrs'),
      t(4,'19:00','20:00','Combat Class Invitation'),
      t(4,'19:00','19:30','General Sparring'),
      t(5,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(5,'16:30','17:20','Kids KR NRG Strength & Fitness'),
      t(5,'17:30','18:30','Adults KR NRG S&C'),
      t(5,'18:30','19:30','Combat Class Invitation'),
      t(6,'09:00','10:00','Muay Thai 13+yrs'),
      t(6,'09:30','10:00','General Sparring'),
      t(6,'10:00','10:50','Little Ninjas / Junior Muay Thai Combined'),
    ]
  },

  rutherford: {
    name: 'Rutherford',
    state: 'NSW',
    address: '1/46 Spitfire Place, Rutherford NSW 2320',
    phone: '0437 538 928',
    email: 'rutherforddojo@krmas.com.au',
    activeDays: [1, 2, 3, 4, 5, 6],
    contact: { adminEmail: 'rutherforddojo@krmas.com.au', adminName: '', locationLabel: 'Rutherford' },
    schedule: [
      t(1,'09:30','10:20','Muay Thai 16+yrs'),
      t(1,'16:00','16:40','Junior Muay Thai 7-11yrs'),
      t(1,'16:40','17:20','Teens Muay Thai 12-16yrs'),
      t(1,'17:20','18:10','Strength & Conditioning'),
      t(1,'18:10','19:00','Muay Thai 16+yrs'),
      t(1,'19:00','20:00','Muay Thai High Intensity Adults'),
      t(2,'16:00','16:30','Mini Muay Thai 3-5yrs'),
      t(2,'16:40','17:20','Teens Muay Thai 12-16yrs'),
      t(2,'17:20','18:00','Junior Muay Thai 7-11yrs'),
      t(2,'18:00','18:50','Muay Thai 16+yrs'),
      t(2,'18:50','19:40','Muay Thai 16+yrs'),
      t(3,'09:30','10:20','Muay Thai 16+yrs'),
      t(3,'16:00','16:40','Junior Muay Thai 7-11yrs'),
      t(3,'17:00','17:40','Teens Muay Thai 12-16yrs'),
      t(3,'17:40','18:00','Sparring Juniors & Teens'),
      t(3,'18:30','19:20','Muay Thai 16+yrs'),
      t(3,'19:20','20:00','Muay Thai Sparring Adults'),
      t(3,'17:40','18:30','Strength & Conditioning'),
      t(4,'16:00','16:30','Mini Muay Thai 3-5yrs'),
      t(4,'16:40','17:20','Teens Muay Thai 12-16yrs'),
      t(4,'17:20','18:00','Junior Muay Thai 7-11yrs'),
      t(4,'18:00','18:50','Muay Thai 16+yrs'),
      t(4,'18:50','19:40','Muay Thai 16+yrs'),
      t(5,'16:00','16:30','Mini Muay Thai 3-5yrs'),
      t(5,'16:40','17:20','Teens Muay Thai 12-16yrs'),
      t(5,'17:20','18:00','Junior Muay Thai 7-11yrs'),
      t(5,'09:30','10:20','Muay Thai 16+yrs'),
      t(5,'18:00','18:50','Muay Thai 16+yrs'),
      t(5,'18:50','19:50','Muay Thai High Intensity Adults'),
      t(6,'10:20','11:00','Junior/Teens Mixed Muay Thai'),
      t(6,'11:10','12:00','Strength & Conditioning'),
      t(6,'12:10','13:00','Muay Thai 16+yrs All Grades'),
      t(6,'13:30','14:00','Sparring Adults'),
    ]
  },

  taree: {
    name: 'Taree',
    state: 'NSW',
    address: '10 Civic Centre (Upstairs), Cnr Pulteney & Albert St, Taree NSW 2430',
    phone: '0438 148 648',
    email: '',
    activeDays: [1, 2, 3, 4, 5, 6],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Taree' },
    schedule: [
      t(1,'16:25','17:05','Little Ninjas Karate 9-12yrs'),
      t(1,'17:15','17:55','Junior Muay Thai 7-13yrs'),
      t(1,'18:05','18:55','Ladies Only Muay Thai'),
      t(1,'19:00','20:00','Muay Thai 14+yrs'),
      t(1,'20:00','20:30','Sparring'),
      t(2,'15:45','16:15','Mini Little Ninjas 3-5yrs'),
      t(2,'16:25','17:05','Little Ninjas Karate 5-8yrs'),
      t(2,'17:15','17:55','Children\'s Kata & Grading Prep'),
      t(2,'18:05','18:45','Little Ninjas Karate 9-12yrs'),
      t(2,'18:55','19:55','Adults Karate 13+'),
      t(2,'20:00','20:40','Adults Kata & Kobudo'),
      t(3,'15:45','16:15','Mini Little Ninjas 3-5yrs'),
      t(3,'16:25','17:05','Little Ninjas Karate 5-8yrs'),
      t(3,'17:15','17:55','Junior Muay Thai 7-13yrs'),
      t(3,'18:05','18:55','Ladies Only Muay Thai'),
      t(3,'19:00','20:00','Muay Thai 14+yrs'),
      t(3,'20:00','20:30','Sparring'),
      t(4,'15:45','16:15','Mini Little Ninjas 3-5yrs'),
      t(4,'16:25','17:05','Little Ninjas Karate 5-8yrs'),
      t(4,'17:15','17:55','Junior Muay Thai 7-13yrs'),
      t(4,'18:05','18:45','Little Ninjas Karate 9-12yrs'),
      t(4,'18:55','19:55','Adults Karate 13+'),
      t(4,'20:00','20:40','Adults Kata & Kobudo'),
      t(5,'16:25','17:05','Little Ninjas Karate 5-8yrs'),
      t(5,'17:15','17:55','Junior Muay Thai 7-13yrs'),
      t(6,'09:20','10:00','KR Junior Combined'),
      t(6,'10:10','11:10','Muay Thai 14+yrs'),
      t(6,'11:20','12:20','Adults Karate 13+'),
      t(6,'12:20','13:00','Adults Kata & Kobudo & Grading Prep'),
    ]
  },

  wyong: {
    name: 'Wyong',
    state: 'NSW',
    address: '52 Cutler Drive, Wyong NSW 2259',
    phone: '0466 714 784',
    email: 'wyongdojo@krmas.com.au',
    activeDays: [],
    contact: { adminEmail: 'wyongdojo@krmas.com.au', adminName: '', locationLabel: 'Wyong' },
    note: 'Timetable page not currently available — please contact the dojo directly.',
    schedule: []
  },

  weston: {
    name: 'Weston Creek',
    state: 'ACT',
    address: '17 Trenerry Street, Weston ACT 2611',
    phone: '0418 758 342',
    email: '',
    activeDays: [1, 2, 3, 4, 6],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Weston' },
    schedule: [
      t(1,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(1,'16:00','16:40','Little Ninjas White to Orange'),
      t(1,'16:40','17:20','Little Ninjas Orange+'),
      t(1,'17:20','17:50','Advanced Little Ninjas Purple+'),
      t(1,'18:00','18:30','Kata 12+yrs'),
      t(1,'18:30','19:30','Adults Karate 12+'),
      t(1,'19:30','20:00','Black Belt Club Brown Belt+'),
      t(2,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(2,'16:00','16:40','Little Ninjas White to Orange'),
      t(2,'16:40','17:25','Junior Muay Thai No Badge to Yellow L3'),
      t(2,'16:40','17:25','Junior Muay Thai Yellow L4+'),
      t(2,'17:30','18:30','Ladies Only Muay Thai 12+'),
      t(2,'18:30','19:00','Adults Sparring 12+'),
      t(2,'19:00','20:00','Adults Muay Thai 12+'),
      t(2,'19:45','20:15','Black Badge Club Purple Badge+'),
      t(3,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(3,'16:00','16:40','Little Ninjas White to Orange'),
      t(3,'16:40','17:20','Little Ninjas Orange+'),
      t(3,'17:20','17:50','Junior Sparring Orange/Yellow L4+'),
      t(3,'18:00','18:30','Adults Sparring 12+'),
      t(3,'18:30','19:30','Adults Karate 12+'),
      t(4,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(4,'16:00','16:40','Little Ninjas White to Orange'),
      t(4,'16:40','17:25','Junior Muay Thai No Badge to Yellow L3'),
      t(4,'16:40','17:20','Junior Muay Thai Yellow L4+'),
      t(4,'17:30','18:30','Ladies Only Muay Thai 12+'),
      t(4,'18:30','19:00','Adults Sparring 12+'),
      t(4,'19:00','20:00','Adults Muay Thai 12+'),
      t(6,'08:10','08:40','KR Fit HIIT S&C'),
      t(6,'08:45','09:45','Mixed MMA 12+'),
      t(6,'10:00','10:40','Junior Muay Thai'),
      t(6,'10:45','11:15','Junior Sparring'),
      t(6,'11:20','12:00','Little Ninjas'),
    ]
  },

  'gin-gin': {
    name: 'Gin Gin',
    state: 'QLD',
    address: 'Kolan Shire National Fitness Hall, 83A Mulgrave St, Gin Gin QLD 4671',
    phone: '0438 484 833',
    email: '',
    activeDays: [3, 4],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Gin Gin' },
    schedule: [
      t(3,'17:00','18:00','Karate Ninjas 5+ / Karate Adults'),
      t(3,'18:00','19:00','Muay Thai Kickboxing 12+yrs'),
      t(4,'17:00','18:00','Karate Ninjas 5+ / Karate Adults'),
      t(4,'18:00','19:00','Muay Thai Kickboxing 12+yrs'),
    ]
  },

  gympie: {
    name: 'Gympie',
    state: 'QLD',
    address: '19A Hyne Street, Gympie QLD 4570',
    phone: '0402 628 460',
    email: '',
    activeDays: [1, 2, 3, 4],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Gympie' },
    schedule: [
      t(1,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(1,'16:40','17:20','Little Ninjas Karate 6-12yrs'),
      t(1,'17:25','17:55','Little Ninjas Basics & Kata Invitation'),
      t(1,'18:00','19:00','Senior Karate 13+yrs'),
      t(2,'16:15','16:55','Junior Muay Thai 7-13yrs'),
      t(2,'17:00','17:25','Mixed Sparring Juniors 7-13yrs'),
      t(2,'17:25','17:55','Mixed Sparring Seniors 14+yrs'),
      t(2,'18:00','19:00','Senior Muay Thai 14+yrs'),
      t(3,'16:00','16:30','Mini Little Ninjas 3-5yrs'),
      t(3,'16:40','17:20','Little Ninjas Karate 6-12yrs'),
      t(3,'17:25','17:55','Little Ninjas Basics & Kata Invitation'),
      t(3,'18:00','19:00','Senior Karate 13+yrs'),
      t(3,'19:00','19:30','Senior Grade Training'),
      t(4,'16:15','16:55','Junior Muay Thai 7-13yrs'),
      t(4,'17:00','17:25','Mixed Sparring Juniors 7-13yrs'),
      t(4,'17:25','17:55','Mixed Sparring Seniors 14+yrs'),
      t(4,'18:00','19:00','Senior Muay Thai 14+yrs'),
    ]
  },

  maryborough: {
    name: 'Maryborough',
    state: 'QLD',
    address: 'Corner Ariadne and Woodstock, Maryborough QLD',
    phone: '07 4129 3112',
    email: '',
    activeDays: [1, 2],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Maryborough' },
    schedule: [
      t(1,'16:30','16:55','Mini Little Ninjas 3-5yrs'),
      t(1,'17:15','18:00','Little Ninjas Karate 6-12yrs'),
      t(1,'18:05','18:50','Karate Teenagers & Adults'),
      t(1,'18:55','19:45','Muay Thai 8yrs+/Teens/Adults'),
      t(2,'17:15','18:00','Little Ninjas Karate 6-12yrs'),
      t(2,'18:10','19:10','Karate Teenagers & Adults'),
      t(2,'19:15','20:15','Muay Thai 8yrs+/Teens/Adults'),
    ]
  },

  'port-denison': {
    name: 'Port Denison',
    state: 'WA',
    address: 'Port Denison WA',
    phone: '',
    email: '',
    activeDays: [],
    contact: { adminEmail: '', adminName: '', locationLabel: 'Port Denison' },
    note: 'Contact KRMAS for current timetable.',
    schedule: []
  }
};

/* Merge school seeds into SCHOOL_DATA_SEED (Edgeworth already there) */
for (const [id, data] of Object.entries(SCHOOL_SEEDS)) {
  if (!SCHOOL_DATA_SEED[id]) {
    SCHOOL_DATA_SEED[id] = {
      instructors: [],
      schedule: data.schedule,
      defaults: {},
      contact: data.contact,
      address: data.address,
      phone: data.phone,
      email: data.email,
      activeDays: data.activeDays,
      note: data.note || null,
      timetableUrl: `https://www.krmas.com.au/${id}-timetable/`
    };
  }
}

/* Patch KRMAS_SCHOOLS with real addresses */
const SCHOOL_METADATA = {
  beecroft:     { address: 'Beecroft Community Hall, Beecroft Rd', phone: '0449 797 008' },
  cootamundra:  { address: '88 Parker Street',                     phone: '0431 373 658' },
  cowra:        { address: '17 Kollas Drive',                      phone: '0493 383 714' },
  dubbo:        { address: 'Unit 1A 55 Wheelers Lane',             phone: '0402 707 705' },
  edgeworth:    { address: 'Unit 1, 14 Superior Avenue',           phone: '0407 135 111' },
  harden:       { address: 'Hard Rock Gym, Station Street',        phone: '0409 788 415' },
  lithgow:      { address: 'L3 84 Main Street',                    phone: '0418 481 153' },
  orange:       { address: '61 Lords Place',                       phone: '0429 348 901' },
  parkes:       { address: 'Presbyterian Church Hall, Gap Street', phone: '0428 626 050' },
  'port-mac':   { address: '4 Bellbowrie Street',                  phone: '0407 248 648' },
  rutherford:   { address: '1/46 Spitfire Place',                  phone: '0437 538 928' },
  taree:        { address: '10 Civic Centre, Cnr Pulteney & Albert St', phone: '0438 148 648' },
  wyong:        { address: '52 Cutler Drive',                      phone: '0466 714 784' },
  weston:       { address: '17 Trenerry Street',                   phone: '0418 758 342' },
  'gin-gin':    { address: '83A Mulgrave St',                      phone: '0438 484 833' },
  gympie:       { address: '19A Hyne Street',                      phone: '0402 628 460' },
  maryborough:  { address: 'Cnr Ariadne & Woodstock',              phone: '07 4129 3112' },
  'port-denison': { address: 'Port Denison WA',                    phone: '' }
};
