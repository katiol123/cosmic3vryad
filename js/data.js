'use strict';
// ============================================================
//  Игровые данные: типы урона, блоки, производители, корпуса,
//  оборудование (генерируется из шаблонов × производитель × техуровень)
// ============================================================

const DMG = {
  energy:    { name: 'Энергетический', short: 'Энерг.', color: '#ff4d6d', shield: 1.0, hull: 1.0,
               desc: 'Универсальный урон. Без особых модификаторов.' },
  plasma:    { name: 'Плазменный', short: 'Плазма', color: '#ff9f1c', shield: 0.8, hull: 1.3,
               desc: 'Слабее по щитам (×0.8), но прожигает корпус (×1.3).' },
  ion:       { name: 'Ионный', short: 'Ион', color: '#4cc9f0', shield: 2.2, hull: 0.35,
               desc: 'Сносит щиты (×2.2), почти не вредит корпусу (×0.35).' },
  kinetic:   { name: 'Кинетический', short: 'Кинет.', color: '#e9eef5', shield: 0.75, hull: 1.15,
               desc: 'Щиты гасят часть урона (×0.75), по корпусу ×1.15.' },
  explosive: { name: 'Взрывной', short: 'Взрыв', color: '#ffd166', shield: 0.9, hull: 1.25,
               desc: 'Ракеты и торпеды: мощно по корпусу (×1.25).' },
  gravity:   { name: 'Гравитационный', short: 'Грав.', color: '#b388ff', shield: 0.5, hull: 1.0, bypass: 0.5,
               desc: '50% урона проходит сквозь щиты.' },
  nano:      { name: 'Нанитный', short: 'Нано', color: '#80ffdb', shield: 0.6, hull: 1.0, armorIgnore: 0.6,
               desc: 'Наниты игнорируют 60% брони корпуса.' },
};
const DMG_KEYS = Object.keys(DMG);

// Шесть типов блоков игрового поля
const BLOCKS = [
  { key: 'energy', name: 'Энергия', color: '#ff3b5c', glow: '#ff8fa3',
    desc: 'Заряжает энергетическое оружие (лазеры, плазма, ионные, гравитационные). Излишек идёт в накопитель реактора.' },
  { key: 'ammo', name: 'Боеприпасы', color: '#ff9e2c', glow: '#ffd29a',
    desc: 'Пополняет боекомплект пушек, рельсотронов и ракет. Излишек — в арсенал.' },
  { key: 'shield', name: 'Щит', color: '#3a86ff', glow: '#9cc3ff',
    desc: 'Восстанавливает щит. Сила зависит от генератора защиты.' },
  { key: 'repair', name: 'Ремонт', color: '#2ee66b', glow: '#a6ffc4',
    desc: 'Ремонтирует корпус. Хороший дроид также очищает поле от вредоносных блоков.' },
  { key: 'thrust', name: 'Манёвр', color: '#b14aff', glow: '#dcaaff',
    desc: 'Даёт очки манёвра (сближение/отход по тактике) и уклонение до следующего хода.' },
  { key: 'data', name: 'Данные', color: '#00f0d0', glow: '#a0fff0',
    desc: 'Тактические данные: +точность и крит. Питают модуль РЭБ (взлом поля врага) и нанитное оружие.' },
];
const T_JUNK = 6, T_NOVA = 7;

const RES = {
  energy: { name: 'Энергия', color: '#ff3b5c', block: 0 },
  ammo: { name: 'Боеприпасы', color: '#ff9e2c', block: 1 },
  data: { name: 'Данные', color: '#00f0d0', block: 5 },
};

// Эффекты при попадании
const EFFECTS = {
  burn:     { name: 'Возгорание', icon: '🔥', d: e => `${e.v} урона корпусу ${e.t} хода` },
  emp:      { name: 'ЭМИ', icon: '⚡', d: e => `сжигает ${e.v} энергии и заряда оружия` },
  freeze:   { name: 'Ионная заморозка', icon: '❄', d: e => `замораживает ${e.v} блок(а) на поле цели` },
  jam:      { name: 'Помехи', icon: '▦', d: e => `засыпает поле цели ${e.v} обломками` },
  virus:    { name: 'Вирус', icon: '☣', d: e => `заражает ${e.v} блок(а) поля цели` },
  mine:     { name: 'Мина', icon: '✹', d: e => `подкладывает мину (${e.v}) на поле цели` },
  corrode:  { name: 'Коррозия', icon: '◬', d: e => `−${Math.round(e.v * 100)}% брони на ${e.t} хода` },
  pull:     { name: 'Гравизахват', icon: '⤓', d: e => `притягивает цель на ${e.v} ед.` },
  push:     { name: 'Отброс', icon: '⤒', d: e => `отбрасывает цель на ${e.v} ед.` },
  stun:     { name: 'Перегрузка', icon: '✖', d: () => 'цель пропускает ход' },
  leech:    { name: 'Вампиризм', icon: '♥', d: e => `${Math.round(e.v * 100)}% урона чинит корпус` },
  shred:    { name: 'Разрыв щита', icon: '⛬', d: e => `+${Math.round(e.v * 100)}% урона по щитам` },
  slow:     { name: 'Замедление', icon: '⌛', d: e => `−${e.v}% уклонения цели на ${e.t} хода` },
  scramble: { name: 'Дезориентация', icon: '↻', d: () => 'перемешивает поле цели' },
  drain:    { name: 'Перехват', icon: '⇋', d: e => `крадёт ${e.v} данных` },
  hacked:   { name: 'Сбой систем', icon: '⌁', d: e => `−${e.v}% точности и уклонения до конца следующего хода` },
};

// Производители — у каждого свой стиль
const MAKERS = [
  { id: 'terra', name: 'Терра-Тек', code: 'ТТ', color: '#8ecae6',
    desc: 'Надёжная классика. Сбалансированные характеристики.',
    w: { dmg: 1, acc: 0, crit: 0, range: 0, cap: 1, eff: 0, mass: 1, price: 1 },
    hull: { hp: 1, armor: 0, cap: 1, ev: 0, init: 0, turn: 0, price: 1, bias: [1, 1, 1.2, 1.2, 1, 1] } },
  { id: 'kron', name: 'Кронская Кузня', code: 'КК', color: '#e76f51',
    desc: 'Тяжёлое и грубое. Больше урона и прочности, но массивнее и менее точно.',
    w: { dmg: 1.2, acc: -6, crit: 0, range: 0, cap: 1, eff: 0, mass: 1.2, price: 1.05 },
    hull: { hp: 1.22, armor: 0.04, cap: 1.05, ev: -3, init: -1, turn: -4, price: 1.1, bias: [1, 1.45, 1, 1.1, 0.8, 0.9] } },
  { id: 'veil', name: 'Вейл Оптикс', code: 'ВО', color: '#90e0ef',
    desc: 'Прецизионная оптика. Точность, криты и дальность.',
    w: { dmg: 0.93, acc: 8, crit: 5, range: 2, cap: 1, eff: 0, mass: 0.9, price: 1.2 },
    hull: { hp: 0.9, armor: -0.01, cap: 0.95, ev: 3, init: 2, turn: 6, price: 1.15, bias: [1.1, 0.85, 1, 0.9, 1.1, 1.5] } },
  { id: 'zot', name: 'Зот-Рой', code: 'ЗР', color: '#b5e48c',
    desc: 'Дёшево и массово. Большая вместимость и шанс эффектов, слабее урон.',
    w: { dmg: 0.87, acc: 0, crit: 0, range: 0, cap: 1.4, eff: 0.12, mass: 0.88, price: 0.75 },
    hull: { hp: 0.95, armor: 0, cap: 1.15, ev: 1, init: 1, turn: 4, price: 0.8, bias: [0.9, 1.1, 0.9, 1, 1.5, 0.9] } },
  { id: 'aether', name: 'Эфирий', code: 'ЭФ', color: '#c77dff',
    desc: 'Экзотические технологии древних. Мощно, легко и очень дорого.',
    w: { dmg: 1.1, acc: 2, crit: 4, range: 0, cap: 1.1, eff: 0.08, mass: 0.82, price: 1.6 },
    hull: { hp: 0.95, armor: 0, cap: 1, ev: 1, init: 1, turn: 3, price: 1.5, shield: 30, bias: [1.5, 0.8, 1.3, 1, 1, 1.1] } },
];
const MAKER = Object.fromEntries(MAKERS.map(m => [m.id, m]));

const SLOT_TYPES = {
  weapon:   { name: 'Оружие', plural: 'Оружие', icon: '✦' },
  shield:   { name: 'Генератор щита', plural: 'Генераторы щита', icon: '⬡' },
  engine:   { name: 'Двигатель', plural: 'Двигатели', icon: '➤' },
  reactor:  { name: 'Реактор', plural: 'Реакторы', icon: '☢' },
  arsenal:  { name: 'Арсенал', plural: 'Арсеналы', icon: '▤' },
  droid:    { name: 'Ремонтный дроид', plural: 'Ремонтные дроиды', icon: '✚' },
  computer: { name: 'Боевой компьютер', plural: 'Боевые компьютеры', icon: '◎' },
  radar:    { name: 'Радар', plural: 'Радары', icon: '◠' },
  ew:       { name: 'Модуль РЭБ', plural: 'Модули РЭБ', icon: '⌁' },
  armor:    { name: 'Бронеплита', plural: 'Бронеплиты', icon: '▣' },
  artifact: { name: 'Артефакт', plural: 'Артефакты', icon: '✧' },
};
const SLOT_ORDER = Object.keys(SLOT_TYPES);

// ------------------------------------------------------------
//  Шаблоны оружия
//  res — ресурс питания, cost — заряд на залп, cap — вместимость заряда,
//  rof — залпов за ход, shots — снарядов в залпе
// ------------------------------------------------------------
const WEAPON_T = [
  { sub: 'laser', name: 'Импульсный лазер', arc: 70, fx: 'beam', dt: 'energy', res: 'energy', d: [9, 13], shots: 1, range: 12, acc: 84, crit: 6, cost: 5, cap: 10, rof: 2, mass: 7, p: 1 },
  { sub: 'hlaser', name: 'Лучевая пушка', arc: 30, fx: 'bigbeam', dt: 'energy', res: 'energy', d: [22, 30], shots: 1, range: 14, acc: 80, crit: 8, cost: 10, cap: 20, rof: 1, mass: 13, p: 1.4, eff: [{ k: 'shred', ch: 1, v: 0.25 }] },
  { sub: 'blaster', name: 'Бластер', arc: 70, fx: 'bolt', dt: 'energy', res: 'energy', d: [5, 7], shots: 3, range: 8, acc: 74, crit: 5, cost: 6, cap: 12, rof: 2, mass: 6, p: 0.9 },
  { sub: 'plasma', name: 'Плазменная пушка', arc: 70, fx: 'plasma', dt: 'plasma', res: 'energy', d: [18, 26], shots: 1, range: 9, acc: 72, crit: 8, cost: 9, cap: 18, rof: 1, mass: 12, p: 1.3, eff: [{ k: 'burn', ch: 0.35, v: 4, t: 3 }] },
  { sub: 'torch', name: 'Плазменный факел', arc: 30, fx: 'flame', dt: 'plasma', res: 'energy', d: [30, 40], shots: 1, range: 6, acc: 88, crit: 5, cost: 10, cap: 20, rof: 1, mass: 14, p: 1.3, eff: [{ k: 'burn', ch: 0.6, v: 6, t: 3 }] },
  { sub: 'ion', name: 'Ионный излучатель', arc: 70, fx: 'arc', dt: 'ion', res: 'energy', d: [11, 15], shots: 1, range: 10, acc: 82, crit: 4, cost: 7, cap: 14, rof: 1, mass: 9, p: 1.1, eff: [{ k: 'freeze', ch: 0.45, v: 2 }] },
  { sub: 'emp', name: 'ЭМИ-проектор', arc: 70, fx: 'wave', dt: 'ion', res: 'energy', d: [7, 10], shots: 1, range: 8, acc: 90, crit: 2, cost: 6, cap: 12, rof: 1, mass: 8, p: 1.1, eff: [{ k: 'emp', ch: 0.7, v: 6 }, { k: 'stun', ch: 0.07 }] },
  { sub: 'autocannon', name: 'Автопушка', arc: 70, fx: 'tracer', dt: 'kinetic', res: 'ammo', d: [4, 6], shots: 4, range: 10, acc: 72, crit: 5, cost: 4, cap: 12, rof: 2, mass: 8, p: 1 },
  { sub: 'rail', name: 'Рельсотрон', arc: 30, fx: 'rail', dt: 'kinetic', res: 'ammo', d: [26, 34], shots: 1, range: 20, acc: 86, crit: 12, cost: 8, cap: 16, rof: 1, mass: 15, p: 1.5, pierce: 0.4, minT: 2 },
  { sub: 'flak', name: 'Осколочная пушка', arc: 70, fx: 'flak', dt: 'kinetic', res: 'ammo', d: [3, 5], shots: 7, range: 7, acc: 68, crit: 3, cost: 5, cap: 10, rof: 1, mass: 9, p: 1, eff: [{ k: 'jam', ch: 0.3, v: 2 }] },
  { sub: 'massdriver', name: 'Масс-драйвер', arc: 30, fx: 'slug', dt: 'kinetic', res: 'ammo', d: [16, 22], shots: 1, range: 16, acc: 78, crit: 7, cost: 6, cap: 12, rof: 1, mass: 12, p: 1.2, armorPen: 0.1, eff: [{ k: 'push', ch: 0.5, v: 2 }] },
  { sub: 'missile', name: 'Ракетная установка', arc: 180, fx: 'missile', dt: 'explosive', res: 'ammo', d: [13, 17], shots: 2, range: 20, acc: 90, crit: 6, cost: 7, cap: 14, rof: 1, mass: 11, p: 1.3, homing: true },
  { sub: 'torpedo', name: 'Торпедный аппарат', arc: 180, fx: 'torpedo', dt: 'explosive', res: 'ammo', d: [44, 58], shots: 1, range: 15, acc: 64, crit: 10, cost: 12, cap: 24, rof: 1, mass: 18, p: 1.6, minT: 2, eff: [{ k: 'mine', ch: 0.35, v: 1 }] },
  { sub: 'swarm', name: 'Рой микроракет', arc: 180, fx: 'swarm', dt: 'explosive', res: 'ammo', d: [3, 5], shots: 6, range: 14, acc: 82, crit: 4, cost: 6, cap: 12, rof: 1, mass: 10, p: 1.2, homing: true, eff: [{ k: 'scramble', ch: 0.06 }] },
  { sub: 'grav', name: 'Гравитационный резак', arc: 70, fx: 'grav', dt: 'gravity', res: 'energy', d: [15, 21], shots: 1, range: 7, acc: 82, crit: 6, cost: 9, cap: 18, rof: 1, mass: 14, p: 1.4, minT: 2, eff: [{ k: 'pull', ch: 0.6, v: 2 }, { k: 'slow', ch: 0.4, v: 10, t: 2 }] },
  { sub: 'nano', name: 'Нанитовый проектор', arc: 70, fx: 'nano', dt: 'nano', res: 'data', d: [9, 13], shots: 1, range: 11, acc: 86, crit: 5, cost: 4, cap: 12, rof: 2, mass: 8, p: 1.3, minT: 2, eff: [{ k: 'corrode', ch: 0.5, v: 0.1, t: 3 }, { k: 'virus', ch: 0.35, v: 1 }] },
  { sub: 'drain', name: 'Вампирический луч', arc: 70, fx: 'drain', dt: 'energy', res: 'energy', d: [10, 14], shots: 1, range: 9, acc: 84, crit: 5, cost: 7, cap: 14, rof: 1, mass: 10, p: 1.4, minT: 3, eff: [{ k: 'leech', ch: 1, v: 0.4 }] },
  { sub: 'quake', name: 'Деструктор поля', arc: 70, fx: 'quake', dt: 'gravity', res: 'data', d: [7, 9], shots: 1, range: 12, acc: 84, crit: 3, cost: 5, cap: 10, rof: 1, mass: 9, p: 1.4, minT: 3, eff: [{ k: 'jam', ch: 0.55, v: 3 }, { k: 'scramble', ch: 0.25 }, { k: 'drain', ch: 0.5, v: 3 }] },
  { sub: 'anti', name: 'Аннигилятор', arc: 30, fx: 'anti', dt: 'plasma', res: 'energy', d: [44, 62], shots: 1, range: 12, acc: 78, crit: 14, cost: 16, cap: 32, rof: 1, mass: 20, p: 2.2, minT: 4, pierce: 0.3, eff: [{ k: 'burn', ch: 0.5, v: 8, t: 2 }] },
];

const SHIELD_T = [
  { sub: 'std', name: 'Генератор защиты', max: 60, regen: 10, passive: 3, resist: {}, mass: 9, p: 1 },
  { sub: 'reflect', name: 'Отражающий экран', max: 55, regen: 9, passive: 2, resist: { energy: 0.3, plasma: 0.25 }, mass: 10, p: 1.1 },
  { sub: 'kinetic', name: 'Кинетический барьер', max: 55, regen: 9, passive: 2, resist: { kinetic: 0.3, explosive: 0.25 }, mass: 10, p: 1.1 },
  { sub: 'phase', name: 'Фазовый щит', max: 38, regen: 16, passive: 6, resist: {}, mass: 8, p: 1.1 },
  { sub: 'insul', name: 'Изолирующий щит', max: 52, regen: 10, passive: 3, resist: { ion: 0.5, gravity: 0.3 }, mass: 10, p: 1.15, minT: 2 },
  { sub: 'bastion', name: 'Щит «Бастион»', max: 105, regen: 8, passive: 0, resist: {}, mass: 16, p: 1.4, minT: 2 },
  { sub: 'adapt', name: 'Адаптивный щит', max: 62, regen: 11, passive: 3, resist: { energy: 0.12, plasma: 0.12, ion: 0.12, kinetic: 0.12, explosive: 0.12, gravity: 0.12, nano: 0.12 }, mass: 12, p: 1.5, minT: 3 },
];

const ENGINE_T = [
  { sub: 'chem', name: 'Химический двигатель', turn: 3, thrust: 1.0, evade: 2, init: 0, ev: 0, mass: 8, p: 0.8 },
  { sub: 'ion', name: 'Ионный двигатель', turn: 6, thrust: 1.15, evade: 3, init: 2, ev: 2, mass: 10, p: 1 },
  { sub: 'plasma', name: 'Плазменный двигатель', turn: 5, thrust: 1.5, evade: 2.5, init: 1, ev: 1, mass: 12, p: 1.1 },
  { sub: 'warp', name: 'Варп-ускоритель', turn: 9, thrust: 1.3, evade: 4, init: 4, ev: 3, mass: 14, p: 1.3, minT: 2 },
  { sub: 'grav', name: 'Гравитационный привод', turn: 12, thrust: 2.0, evade: 3.5, init: 3, ev: 4, mass: 16, p: 1.5, minT: 3 },
];

const REACTOR_T = [
  { sub: 'solar', name: 'Солнечная батарея', ePer: 2.5, eCap: 14, ePass: 3, over: 0, mass: 5, p: 0.8 },
  { sub: 'fusion', name: 'Термоядерный реактор', ePer: 3.5, eCap: 22, ePass: 1, over: 0.03, mass: 9, p: 1 },
  { sub: 'surge', name: 'Разгонный реактор', ePer: 3.2, eCap: 16, ePass: 0, over: 0.09, mass: 10, p: 1.2, minT: 2 },
  { sub: 'anti', name: 'Антиматериевый реактор', ePer: 4.5, eCap: 30, ePass: 0, over: 0.04, mass: 13, p: 1.35, minT: 2 },
  { sub: 'quark', name: 'Кварковое ядро', ePer: 5.5, eCap: 40, ePass: 2, over: 0.05, mass: 16, p: 1.7, minT: 4 },
];

const ARSENAL_T = [
  { sub: 'mag', name: 'Оружейный склад', aPer: 3.2, aCap: 22, aPass: 0, critStar: 0, mass: 8, p: 1 },
  { sub: 'auto', name: 'Автозагрузчик', aPer: 4.2, aCap: 14, aPass: 0, critStar: 0, mass: 10, p: 1.1 },
  { sub: 'fab', name: 'Нанофабрика боеприпасов', aPer: 3, aCap: 16, aPass: 3, critStar: 0, mass: 11, p: 1.25, minT: 2 },
  { sub: 'ap', name: 'Бронебойный арсенал', aPer: 3.2, aCap: 18, aPass: 0, critStar: 0.04, mass: 10, p: 1.25, minT: 2 },
];

const DROID_T = [
  { sub: 'basic', name: 'Ремонтный дроид', rPer: 15, rPass: 9, cleanse: 0, mass: 5, p: 1 },
  { sub: 'field', name: 'Полевая мастерская', rPer: 25, rPass: 3, cleanse: 0, mass: 10, p: 1.2 },
  { sub: 'swarm', name: 'Нанитовый рой', rPer: 12, rPass: 15, cleanse: 1, mass: 7, p: 1.3, minT: 2 },
  { sub: 'purge', name: 'Дроид-чистильщик', rPer: 11, rPass: 7, cleanse: 2, mass: 6, p: 1.15, minT: 2 },
];

const COMPUTER_T = [
  { sub: 'tgt', name: 'Прицельный компьютер', acc: 6, crit: 3, dPer: 1.5, mass: 6, p: 1 },
  { sub: 'tac', name: 'Тактический ИИ', acc: 4, crit: 4, dPer: 2.5, mass: 8, p: 1.1 },
  { sub: 'ball', name: 'Баллистический вычислитель', acc: 11, crit: 6, dPer: 1.2, mass: 9, p: 1.25, minT: 2 },
  { sub: 'quant', name: 'Квантовый процессор', acc: 7, crit: 9, dPer: 3, mass: 10, p: 1.6, minT: 3 },
];

const RADAR_T = [
  { sub: 'std', name: 'Радар', range: 2, acc: 4, ev: 0, mass: 4, p: 1 },
  { sub: 'long', name: 'Радар дальнего обзора', range: 5, acc: 2, ev: 0, mass: 8, p: 1.2 },
  { sub: 'pulse', name: 'Импульсный сканер', range: 3, acc: 6, ev: 3, mass: 7, p: 1.3, minT: 2 },
];

const EW_T = [
  { sub: 'jam', name: 'Постановщик помех', kind: 'jam', cost: 6, power: 5, ewRes: 0.1, mass: 6, p: 1 },
  { sub: 'cryo', name: 'Ионный глушитель', kind: 'freeze', cost: 7, power: 4, ewRes: 0.1, mass: 7, p: 1.1 },
  { sub: 'siphon', name: 'Сифон ресурсов', kind: 'siphon', cost: 5, power: 8, ewRes: 0.05, mass: 6, p: 1.05 },
  { sub: 'virus', name: 'Вирусная платформа', kind: 'virus', cost: 8, power: 3, ewRes: 0.1, mass: 7, p: 1.25, minT: 2 },
  { sub: 'mine', name: 'Минный проектор', kind: 'mine', cost: 9, power: 2, ewRes: 0.05, mass: 8, p: 1.3, minT: 2 },
  { sub: 'wall', name: 'Брандмауэр', kind: null, cost: 0, power: 0, ewRes: 0.55, dPass: 2, mass: 4, p: 1.1 },
];

const ARMOR_T = [
  { sub: 'steel', name: 'Стальная бронеплита', hp: 105, armor: 0.045, resist: {}, ev: -1, mass: 9, p: 0.8 },
  { sub: 'comp', name: 'Композитная броня', hp: 80, armor: 0.075, resist: {}, ev: -0.5, mass: 7, p: 1 },
  { sub: 'ablat', name: 'Абляционная броня', hp: 72, armor: 0.03, resist: { energy: 0.15, plasma: 0.2 }, ev: 0, mass: 6, p: 1.1 },
  { sub: 'react', name: 'Реактивная броня', hp: 72, armor: 0.03, resist: { explosive: 0.25, kinetic: 0.15 }, ev: 0, mass: 7, p: 1.1 },
  { sub: 'neutr', name: 'Нейтрониевая плита', hp: 185, armor: 0.09, resist: {}, ev: -2, mass: 14, p: 1.4, minT: 3 },
];

const ARTIFACTS = [
  { sub: 'quantum', name: 'Квантовый стабилизатор', desc: '15% шанс получить дополнительный ход', mods: { extraTurn: 0.15 }, mass: 3, p: 3 },
  { sub: 'nova', name: 'Сердце сверхновой', desc: 'Новые блоки на 6% чаще сверхзаряжены (×2)', mods: { over: 0.06 }, mass: 3, p: 2.6 },
  { sub: 'phase', name: 'Фазовый сдвиг', desc: '10% шанс полностью избежать попадания', mods: { phase: 0.1 }, mass: 4, p: 3 },
  { sub: 'mirror', name: 'Зеркальная матрица', desc: 'Отражает 15% полученного урона во врага', mods: { reflect: 0.15 }, mass: 4, p: 2.8 },
  { sub: 'eye', name: 'Око Пророка', desc: '+10% к шансу критического удара', mods: { crit: 10 }, mass: 2, p: 2.4 },
  { sub: 'metal', name: 'Живой металл', desc: 'Корпус сам чинится на 4 в начале хода', mods: { rPass: 4 }, mass: 3, p: 2.2 },
  { sub: 'hcap', name: 'Гиперконденсатор', desc: '+50% вместимости заряда всего оружия', mods: { wcap: 0.5 }, mass: 3, p: 2.2 },
  { sub: 'tachyon', name: 'Тахионный ускоритель', desc: '+5 инициативы, +1 ед. манёвра каждый ход', mods: { init: 5, freeMove: 1 }, mass: 3, p: 2.2 },
  { sub: 'star', name: 'Звёздная карта', desc: '+2 к дальности всего оружия', mods: { range: 2 }, mass: 2, p: 2.4 },
  { sub: 'seer', name: 'Предсказатель', desc: '+2 данных в начале каждого хода', mods: { dPass: 2 }, mass: 2, p: 2 },
  { sub: 'ward', name: 'Печать Хранителя', desc: '+30% защиты от вредоносных блоков', mods: { ewRes: 0.3 }, mass: 2, p: 2 },
  { sub: 'rage', name: 'Ярость берсерка', desc: '+30% урона, пока корпус ниже 40%', mods: { rage: 0.3 }, mass: 2, p: 2.2 },
  { sub: 'void', name: 'Батарея пустоты', desc: '+3 энергии и +2 боеприпаса в начале хода', mods: { ePass: 3, aPass: 2 }, mass: 4, p: 2.4 },
  { sub: 'aegis', name: 'Эгида', desc: '+40 к максимальному щиту', mods: { maxShield: 40 }, mass: 4, p: 2.4 },
  { sub: 'chain', name: 'Цепная реакция', desc: 'Каждый уровень каскада даёт ещё +15% ресурсов', mods: { cascade: 0.15 }, mass: 2, p: 2.6 },
  { sub: 'reson', name: 'Резонатор жизни', desc: 'Блоки щита и ремонта выпадают на 35% чаще', mods: { biasAdd: [0, 0, 0.35, 0.35, 0, 0] }, mass: 2, p: 2 },
  { sub: 'hunter', name: 'Метка охотника', desc: '+20% урона ракет и торпед', mods: { explDmg: 0.2 }, mass: 2, p: 2 },
  { sub: 'ghost', name: 'Призрачная обшивка', desc: '+8% к уклонению', mods: { evasion: 8 }, mass: 3, p: 2.6 },
  { sub: 'forge', name: 'Кузня войны', desc: 'Блоки энергии и боеприпасов выпадают на 30% чаще', mods: { biasAdd: [0.3, 0.3, 0, 0, 0, 0] }, mass: 2, p: 2.2 },
  { sub: 'oracle', name: 'Сфера оракула', desc: 'Звёзды крита появляются втрое чаще', mods: { critStar: 0.03 }, mass: 2, p: 2.2 },
];

// ------------------------------------------------------------
//  Корпуса
// ------------------------------------------------------------
const HULL_CLASSES = [
  { cls: 'scout', turn: 22, name: 'Разведчик', hp: 125, armor: 0.04, cap: 50, ev: 18, init: 14, size: 0.62, minT: 1, p: 0.6,
    slots: { weapon: 2, shield: 1, engine: 1, reactor: 1, arsenal: 1, droid: 0, computer: 1, radar: 1, ew: 1, armor: 0, artifact: 1 } },
  { cls: 'fighter', turn: 19, name: 'Истребитель', hp: 165, armor: 0.06, cap: 64, ev: 15, init: 13, size: 0.7, minT: 1, p: 0.75,
    slots: { weapon: 3, shield: 1, engine: 1, reactor: 1, arsenal: 1, droid: 0, computer: 1, radar: 0, ew: 0, armor: 1, artifact: 1 } },
  { cls: 'corvette', turn: 15, name: 'Корвет', hp: 230, armor: 0.08, cap: 84, ev: 11, init: 11, size: 0.8, minT: 1, p: 1,
    slots: { weapon: 3, shield: 1, engine: 1, reactor: 1, arsenal: 1, droid: 1, computer: 1, radar: 1, ew: 0, armor: 1, artifact: 1 } },
  { cls: 'raider', turn: 17, name: 'Рейдер', hp: 205, armor: 0.06, cap: 90, ev: 13, init: 12, size: 0.82, minT: 2, p: 1.25,
    slots: { weapon: 3, shield: 1, engine: 1, reactor: 1, arsenal: 1, droid: 0, computer: 1, radar: 1, ew: 1, armor: 0, artifact: 3 } },
  { cls: 'frigate', turn: 12, name: 'Фрегат', hp: 300, armor: 0.1, cap: 108, ev: 8, init: 9, size: 0.95, minT: 2, p: 1.4,
    slots: { weapon: 4, shield: 1, engine: 1, reactor: 1, arsenal: 1, droid: 1, computer: 1, radar: 1, ew: 1, armor: 1, artifact: 1 } },
  { cls: 'destroyer', turn: 9, name: 'Эсминец', hp: 390, armor: 0.12, cap: 135, ev: 6, init: 8, size: 1.05, minT: 3, p: 1.8,
    slots: { weapon: 4, shield: 1, engine: 1, reactor: 1, arsenal: 1, droid: 1, computer: 1, radar: 1, ew: 1, armor: 2, artifact: 2 } },
  { cls: 'cruiser', turn: 7, name: 'Крейсер', hp: 500, armor: 0.15, cap: 170, ev: 4, init: 7, size: 1.18, minT: 3, p: 2.3,
    slots: { weapon: 5, shield: 1, engine: 1, reactor: 1, arsenal: 1, droid: 1, computer: 1, radar: 1, ew: 1, armor: 2, artifact: 2 } },
  { cls: 'battleship', turn: 5, name: 'Линкор', hp: 660, armor: 0.18, cap: 215, ev: 2, init: 5, size: 1.32, minT: 4, p: 3,
    slots: { weapon: 6, shield: 1, engine: 1, reactor: 1, arsenal: 1, droid: 1, computer: 1, radar: 1, ew: 1, armor: 3, artifact: 2 } },
  { cls: 'dreadnought', turn: 4, name: 'Дредноут', hp: 860, armor: 0.22, cap: 270, ev: 0, init: 4, size: 1.48, minT: 5, p: 4,
    slots: { weapon: 7, shield: 1, engine: 1, reactor: 1, arsenal: 1, droid: 1, computer: 1, radar: 1, ew: 1, armor: 3, artifact: 3 } },
];
const HULL_CLASS = Object.fromEntries(HULL_CLASSES.map((c, i) => [c.cls, Object.assign(c, { idx: i })]));

const HULL_MODELS = {
  terra:  ['Пионер', 'Страж', 'Аврора', 'Странник', 'Горизонт', 'Вектор', 'Легион', 'Цитадель', 'Атлант'],
  kron:   ['Кистень', 'Секира', 'Молот', 'Таран', 'Кулак', 'Наковальня', 'Бастион', 'Колосс', 'Левиафан'],
  veil:   ['Игла', 'Шёпот', 'Призрак', 'Мираж', 'Сирена', 'Луч', 'Призма', 'Ореол', 'Сияние'],
  zot:    ['Жало', 'Оса', 'Шершень', 'Скарабей', 'Рой', 'Богомол', 'Улей', 'Матка', 'Колония'],
  aether: ['Искра', 'Эфир', 'Сфера', 'Комета', 'Пульсар', 'Квазар', 'Туманность', 'Сверхновая', 'Пустота'],
};

const SHIP_NAMES = ['Неукротимый', 'Возмездие', 'Буревестник', 'Гордость Сириуса', 'Чёрная Звезда', 'Стремительный',
  'Немезида', 'Вега', 'Альтаир', 'Беспощадный', 'Полярная Звезда', 'Кассиопея', 'Гром', 'Ураган', 'Отважный',
  'Фантом', 'Кракен', 'Феникс', 'Валькирия', 'Сокол', 'Ястреб', 'Цербер', 'Гидра', 'Медуза', 'Орион', 'Персей',
  'Андромеда', 'Тень', 'Ангел Смерти', 'Морена', 'Перун', 'Святогор', 'Гамаюн', 'Сирин', 'Алконост', 'Вихрь',
  'Звездопад', 'Пламя Ригеля', 'Ледокол', 'Гарпия', 'Мститель', 'Безмолвный', 'Апостол', 'Хронос', 'Титания',
  'Карающий', 'Сварог', 'Велес', 'Стрибог', 'Буран', 'Шторм', 'Неистовый', 'Рассвет', 'Затмение', 'Эклипс'];

// ------------------------------------------------------------
//  Генерация каталога
// ------------------------------------------------------------
const ITEMS = {};
const ITEMS_BY_CAT = {};
const HULLS = {};
const HULL_LIST = [];

(function buildCatalog() {
  const tierPrice = t => Math.pow(1.75, t - 1);
  const add = it => {
    ITEMS[it.id] = it;
    (ITEMS_BY_CAT[it.cat] = ITEMS_BY_CAT[it.cat] || []).push(it);
  };
  const code = (m, tIdx, tier, letter) => `${m.code}-${tier}${String(tIdx + 1).padStart(2, '0')}${letter || ''}`;

  // Оружие
  WEAPON_T.forEach((T, ti) => {
    for (let t = T.minT || 1; t <= 5; t++) {
      for (const m of MAKERS) {
        const k = 1 + 0.3 * (t - 1);
        const mw = m.w;
        const it = {
          id: `weapon_${T.sub}_${m.id}_${t}`, cat: 'weapon', sub: T.sub, tpl: T, maker: m.id, tier: t,
          name: `${T.name} ${code(m, ti, t)}`, base: T.name,
          fx: T.fx, dt: T.dt, res: T.res, arc: T.arc,
          dmin: Math.round(T.d[0] * k * mw.dmg), dmax: Math.round(T.d[1] * k * mw.dmg),
          shots: T.shots, range: T.range + mw.range + (t >= 4 ? 1 : 0),
          acc: T.acc + mw.acc + 2 * (t - 1), crit: T.crit + mw.crit + (t - 1),
          cost: T.cost, cap: Math.round(T.cap * mw.cap * (1 + 0.12 * (t - 1))), rof: T.rof + (t === 5 && T.rof === 1 && T.cost <= 8 ? 1 : 0),
          pierce: T.pierce || 0, armorPen: (T.armorPen || 0) + 0.02 * (t - 1), homing: !!T.homing,
          eff: (T.eff || []).map(e => {
            const ne = Object.assign({}, e);
            if (ne.ch < 1) ne.ch = Math.min(0.95, ne.ch + mw.eff + 0.03 * (t - 1));
            if (ne.k === 'burn') ne.v = Math.round(e.v * k);
            if (['freeze', 'jam', 'virus', 'drain'].includes(ne.k) && t >= 4) ne.v = e.v + 1;
            return ne;
          }),
          mass: Math.max(3, Math.round(T.mass * mw.mass * (1 - 0.04 * (t - 1)))),
          price: Math.round(110 * T.p * tierPrice(t) * mw.price / 5) * 5,
        };
        add(it);
      }
    }
  });

  const genGeneric = (cat, list, build) => {
    list.forEach((T, ti) => {
      for (let t = T.minT || 1; t <= 5; t++) {
        for (const m of MAKERS) {
          const it = Object.assign({
            id: `${cat}_${T.sub}_${m.id}_${t}`, cat, sub: T.sub, tpl: T, maker: m.id, tier: t,
            name: `${T.name} ${code(m, ti, t)}`, base: T.name,
            price: Math.round(90 * T.p * tierPrice(t) * m.w.price / 5) * 5,
          }, build(T, t, m));
          add(it);
        }
      }
    });
  };
  const mm = (m, base) => base * (m.id === 'kron' ? 1.15 : m.id === 'aether' ? 0.85 : m.id === 'zot' ? 0.9 : m.id === 'veil' ? 0.92 : 1);
  const mk = (m, a, b, c, d, e) => ({ terra: a, kron: b, veil: c, zot: d, aether: e })[m.id];

  genGeneric('shield', SHIELD_T, (T, t, m) => ({
    max: Math.round(T.max * (1 + 0.3 * (t - 1)) * mk(m, 1, 1.2, 0.95, 0.9, 1.1)),
    regen: U.r1(T.regen * (1 + 0.22 * (t - 1)) * mk(m, 1, 0.9, 1.05, 1.1, 1.15)),
    passive: Math.round(T.passive * (1 + 0.25 * (t - 1))),
    resist: Object.fromEntries(Object.entries(T.resist).map(([k, v]) => [k, Math.min(0.75, v + 0.03 * (t - 1))])),
    mass: Math.max(3, Math.round(mm(m, T.mass) * (1 - 0.04 * (t - 1)))),
  }));
  genGeneric('engine', ENGINE_T, (T, t, m) => ({
    thrust: U.r1(T.thrust * (1 + 0.12 * (t - 1)) * mk(m, 1, 0.95, 1.05, 1.15, 1.05)),
    evade: U.r1(T.evade + 0.5 * (t - 1) + mk(m, 0, -0.5, 0.5, 0.5, 0.5)),
    init: T.init + (t - 1) + mk(m, 0, -1, 2, 1, 1),
    turn: T.turn + 2 * (t - 1) + mk(m, 0, -2, 3, 2, 3),
    ev: T.ev + Math.floor((t - 1) / 2) + mk(m, 0, -1, 1, 0, 1),
    mass: Math.max(3, Math.round(mm(m, T.mass) * (1 - 0.04 * (t - 1)))),
  }));
  genGeneric('reactor', REACTOR_T, (T, t, m) => ({
    ePer: U.r1(T.ePer * (1 + 0.14 * (t - 1)) * mk(m, 1, 1.05, 1, 0.92, 1.12)),
    eCap: Math.round(T.eCap * (1 + 0.15 * (t - 1)) * mk(m, 1, 1.15, 1, 1.25, 1)),
    ePass: T.ePass + Math.floor((t - 1) / 2),
    over: U.r1((T.over + (m.id === 'aether' ? 0.02 : 0) + 0.005 * (t - 1)) * 100) / 100,
    mass: Math.max(3, Math.round(mm(m, T.mass) * (1 - 0.04 * (t - 1)))),
  }));
  genGeneric('arsenal', ARSENAL_T, (T, t, m) => ({
    aPer: U.r1(T.aPer * (1 + 0.14 * (t - 1)) * mk(m, 1, 1.1, 0.95, 1.05, 1.05)),
    aCap: Math.round(T.aCap * (1 + 0.15 * (t - 1)) * mk(m, 1, 1.15, 1, 1.3, 1)),
    aPass: T.aPass + Math.floor((t - 1) / 2),
    critStar: T.critStar ? U.r1((T.critStar + 0.005 * (t - 1)) * 100) / 100 : 0,
    mass: Math.max(3, Math.round(mm(m, T.mass) * (1 - 0.04 * (t - 1)))),
  }));
  genGeneric('droid', DROID_T, (T, t, m) => ({
    rPer: U.r1(T.rPer * (1 + 0.22 * (t - 1)) * mk(m, 1, 1.1, 0.95, 0.95, 1.1)),
    rPass: Math.round(T.rPass * (1 + 0.25 * (t - 1))),
    cleanse: T.cleanse + (t >= 4 ? 1 : 0),
    mass: Math.max(3, Math.round(mm(m, T.mass) * (1 - 0.04 * (t - 1)))),
  }));
  genGeneric('computer', COMPUTER_T, (T, t, m) => ({
    acc: T.acc + (t - 1) * 1.5 + mk(m, 0, -1, 3, 0, 1),
    crit: T.crit + (t - 1) + mk(m, 0, 1, 2, 0, 2),
    dPer: U.r1(T.dPer * (1 + 0.12 * (t - 1))),
    mass: Math.max(2, Math.round(mm(m, T.mass) * (1 - 0.04 * (t - 1)))),
  }));
  genGeneric('radar', RADAR_T, (T, t, m) => ({
    range: T.range + Math.floor((t - 1) / 2) + (m.id === 'veil' ? 1 : 0),
    acc: T.acc + (t - 1),
    ev: T.ev + (t >= 4 ? 1 : 0),
    mass: Math.max(2, Math.round(mm(m, T.mass) * (1 - 0.04 * (t - 1)))),
  }));
  genGeneric('ew', EW_T, (T, t, m) => ({
    kind: T.kind,
    cost: T.cost ? Math.max(4, T.cost - Math.floor((t - 1) / 2) - (m.id === 'aether' ? 1 : 0)) : 0,
    power: T.power ? T.power + Math.floor((t - 1) / 2) + (m.id === 'zot' ? 1 : 0) : 0,
    ewRes: U.r1((T.ewRes + 0.03 * (t - 1)) * 100) / 100,
    dPass: T.dPass ? T.dPass + Math.floor((t - 1) / 2) : 0,
    mass: Math.max(2, Math.round(mm(m, T.mass) * (1 - 0.04 * (t - 1)))),
  }));
  genGeneric('armor', ARMOR_T, (T, t, m) => ({
    hp: Math.round(T.hp * (1 + 0.3 * (t - 1)) * mk(m, 1, 1.25, 0.9, 0.95, 1.05)),
    armor: U.r1((T.armor + 0.01 * (t - 1) + mk(m, 0, 0.01, 0, 0, 0.005)) * 100) / 100,
    resist: Object.fromEntries(Object.entries(T.resist).map(([k, v]) => [k, Math.min(0.6, v + 0.03 * (t - 1))])),
    ev: T.ev,
    mass: Math.max(4, Math.round(mm(m, T.mass) * (1 - 0.04 * (t - 1)))),
  }));
  // Артефакты — уникальны, без производителя
  ARTIFACTS.forEach(A => {
    add({ id: `artifact_${A.sub}`, cat: 'artifact', sub: A.sub, tpl: A, maker: null, tier: 4,
      name: A.name, base: A.name, desc: A.desc, mods: A.mods, mass: A.mass, price: Math.round(400 * A.p / 5) * 5 });
  });

  // Корпуса
  for (const C of HULL_CLASSES) {
    for (const m of MAKERS) {
      const mh = m.hull;
      const h = {
        id: `hull_${C.cls}_${m.id}`, cls: C.cls, clsName: C.name, maker: m.id, tier: C.minT,
        name: `${C.name} «${HULL_MODELS[m.id][C.idx]}»`, model: HULL_MODELS[m.id][C.idx],
        hp: Math.round(C.hp * mh.hp * 0.85 / 5) * 5, armor: Math.max(0, U.r1((C.armor + mh.armor) * 100) / 100),
        cap: Math.round(C.cap * mh.cap), ev: Math.max(0, C.ev + mh.ev), init: C.init + mh.init, turn: C.turn + mh.turn,
        shield: mh.shield || 0, size: C.size, slots: Object.assign({}, C.slots),
        bias: mh.bias.slice(), resist: m.id === 'kron' ? { kinetic: 0.08 } : m.id === 'aether' ? { energy: 0.1 } : {},
        price: Math.round(400 * C.p * mh.price / 10) * 10,
      };
      if (m.id === 'zot') h.slots.artifact += 1;
      if (m.id === 'veil' && !h.slots.ew) h.slots.ew = 1;
      if (m.id === 'kron') h.slots.armor += 1;
      if (m.id === 'aether') h.slots.artifact += 1;
      HULLS[h.id] = h;
      HULL_LIST.push(h);
    }
  }
})();

function itemsFor(cat) { return ITEMS_BY_CAT[cat] || []; }
