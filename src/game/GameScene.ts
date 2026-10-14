import Phaser from 'phaser';
import { branchChanceForPhase, PHASE_SECONDS } from './phases';

/** Ширина ствола в пикселях. */
const TRUNK_WIDTH = 84;
/** Высота одного сегмента ствола. */
const SEGMENT_HEIGHT = 62;
/** Сколько сегментов ствола видно на экране. */
const SEGMENT_COUNT = 7;
/** X-координата центра ствола. */
const TREE_X = 480;
/** Y-координата низа ствола (уровень игрока). */
const BASE_Y = 512;
/** Смещение игрока от центра ствола. */
const PLAYER_OFFSET_X = 118;

/** Сколько жизней у игрока. Удар ствола = −1. */
const MAX_LIVES = 3;
/** Сколько лесников нужно спасти для победы. */
const FORESTERS_TO_WIN = 30;
/** Минимум рубок до ветки с лесником. */
const FORESTER_MIN_GAP = 5;
/** Максимум рубок до ветки с лесником. */
const FORESTER_MAX_GAP = 12;
/** Рост шанса ветки за каждого спасённого. */
const BRANCH_CHANCE_STEP = 0.04;
/** Потолок шанса ветки с учётом бонуса за спасённых. */
const BRANCH_CHANCE_MAX = 0.9;
/** Сколько мс надо зажать физическую клавишу R, чтобы перезапустить игру. */
const RESTART_HOLD_MS = 900;
/** Оглушение после удара веткой: рубить нельзя, мс. */
const STUN_MS = 900;
/** Латинские двойники букв пула: раскладка клавиатуры не важна (С ≡ C). */
const LETTER_TWINS: Record<string, string> = {
  Q: 'Й',
  W: 'Ц',
  E: 'У',
  R: 'К',
  T: 'Е',
  Y: 'Н',
  U: 'Г',
  I: 'Ш',
  O: 'Щ',
  P: 'З',
  '[': 'Х',
  ']': 'Ъ',
  A: 'Ф',
  S: 'Ы',
  D: 'В',
  F: 'А',
  G: 'П',
  H: 'Р',
  J: 'О',
  K: 'Л',
  L: 'Д',
  ';': 'Ж',
  "'": 'Э',
  Z: 'Я',
  X: 'Ч',
  C: 'С',
  V: 'М',
  B: 'И',
  N: 'Т',
  M: 'Ь',
  ',': 'Б',
  '.': 'Ю',
  '`': 'Ё',
};
/** Масштаб фигурки лесника на ветке. */
const FORESTER_SCALE = 1.15;
/** X-центр рубильника режима (правый верхний угол). */
const SWITCH_X = 880;
/** Y-центр рубильника режима. */
const SWITCH_Y = 120;
/** Размер клик-зоны рубильника (включает подписи). */
const SWITCH_ZONE_WIDTH = 150;
/** Высота клик-зоны рубильника (включает подписи). */
const SWITCH_ZONE_HEIGHT = 104;
/** X-центр кнопки подсказок (правый край, под рубильником). */
const HINTS_X = 880;
/** Y-центр кнопки подсказок. */
const HINTS_Y = 226;
/** Размер клик-зоны кнопки подсказок. */
const HINTS_ZONE_WIDTH = 120;
const HINTS_ZONE_HEIGHT = 56;
/** Центр оверлея паузы на экране. */
const PAUSE_OVERLAY_X = 480;
const PAUSE_OVERLAY_Y = 300;
/** Локальный X-центр кнопки «Продолжить» внутри оверлея паузы. */
const PAUSE_BUTTON_LOCAL_X = 0;
/** Локальный Y-центр кнопки «Продолжить» внутри оверлея паузы. */
const PAUSE_BUTTON_LOCAL_Y = 56;
/** Ширина клик-зоны кнопки «Продолжить». */
const PAUSE_BUTTON_WIDTH = 300;
/** Высота клик-зоны кнопки «Продолжить». */
const PAUSE_BUTTON_HEIGHT = 62;
/** Ключ рекорда времени в localStorage. */
const BEST_TIME_KEY = 'lumberjack-best-time';
/** Через сколько мс бездействия появляется шкала «РУБИ!». */
const IDLE_WARN_MS = 3500;
/** Через сколько мс бездействия сгорает жизнь. */
const IDLE_LIMIT_MS = 9000;
/** Ширина шкалы бездействия в пикселях. */
const IDLE_BAR_WIDTH = 320;
/** Символы для режима букв: весь алфавит + цифры (любая клавиша в деле). */
const LETTER_POOL = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789';

const FONT = 'system-ui, sans-serif';
const COLOR_TEXT = '#f8fafc';
const COLOR_MUTED = '#cbd5e1';
const COLOR_GOOD = '#4ade80';
const COLOR_BAD = '#f87171';
/** Кремовый текст на деревянных панелях. */
const COLOR_CREAM = '#fde9c8';
/** Дерево панелей меню и светлая кромка. */
const WOOD_FILL = 0x7c4a21;
const WOOD_DARK = 0x3f2810;
const WOOD_LIGHT = 0xa06a35;

type Side = 'left' | 'right';
type Branch = 'none' | Side;
type ControlMode = 'classic' | 'letters';

/** Приводит нажатую клавишу к кириллице пула: С и C — одна и та же буква. */
function normalizeLetter(key: string): string {
  return LETTER_TWINS[key] ?? key;
}

/** Один кусок ствола. Лесник всегда сидит на ветке (branch != 'none'). */
interface Segment {
  branch: Branch;
  forester: boolean;
  /** Буква для режима букв: её надо нажать, чтобы срубить этот сегмент. */
  key: string;
}

/**
 * «Дровосек-спасатель» (тайминг).
 *
 * Два режима (переключаются рубильником в правом верхнем углу до первой рубки):
 * классика (←/→, A/D, клик) и буквы (жать символ с нижнего бревна;
 * раскладка не важна, неверная буква — шаг под ветку и удар).
 * В режиме букв ветка есть на каждом бревне.
 * Нельзя стоять под веткой на нижнем сегменте — иначе удар и −1 жизнь.
 * На некоторых ветках сидит лесник: сруби ствол до него и не попади
 * под его ветку — лесник спасён. Победа — 30 лесников.
 * Счёт — время с первой рубки.
 */
export class GameScene extends Phaser.Scene {
  private segments: Segment[] = [];
  private segmentObjs: Phaser.GameObjects.Container[] = [];
  private foresterObjs: Phaser.GameObjects.GameObject[] = [];
  private fallingLogs: Phaser.GameObjects.Container[] = [];
  private segmentsSinceForester = 0;
  private foresterGap = FORESTER_MAX_GAP;

  private playerSide: Side = 'left';
  private player!: Phaser.GameObjects.Container;
  private axe!: Phaser.GameObjects.Container;

  private chops = 0;
  private rescued = 0;
  private lives = MAX_LIVES;
  private elapsed = 0;
  private playing = true;
  /** Стоит ли сейчас пауза: таймер, оглушение и рубки заморожены. */
  private paused = false;
  /** this.time.now в момент постановки паузы — чтобы сдвинуть дедлайны. */
  private pausedAt = 0;
  private mode: ControlMode = 'classic';
  private hintsOn = false;
  private timerStarted = false;
  /** Текущая фаза сложности в классике: 1 + сколько минут прошло. */
  private phase = 1;
  /** this.time.now в момент нажатия R для перезапуска: 0 — клавиша не зажата. */
  private restartHoldStart = 0;
  private stunnedUntil = 0;
  private lastActionTime = 0;
  private bestTime: number | null = null;

  private livesText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private rescuedText!: Phaser.GameObjects.Text;
  private progressText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private overlay!: Phaser.GameObjects.Container;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlayStats!: Phaser.GameObjects.Text;
  private pauseOverlay!: Phaser.GameObjects.Container;
  private idleBox!: Phaser.GameObjects.Container;
  private idleFill!: Phaser.GameObjects.Rectangle;
  private idleLabel!: Phaser.GameObjects.Text;
  private modeSwitchLever!: Phaser.GameObjects.Rectangle;
  private modeSwitchLabel!: Phaser.GameObjects.Text;
  private hintsButton!: Phaser.GameObjects.Container;
  private hintsButtonBox!: Phaser.GameObjects.Rectangle;
  private hintsButtonLabel!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.chops = 0;
    this.rescued = 0;
    this.lives = MAX_LIVES;
    this.elapsed = 0;
    this.playing = true;
    this.paused = false;
    this.mode = 'classic';
    this.hintsOn = false;
    this.timerStarted = false;
    this.phase = 1;
    this.restartHoldStart = 0;
    this.stunnedUntil = 0;
    this.lastActionTime = this.time.now;
    this.foresterGap = this.randomForesterGap();
    this.bestTime = this.loadBestTime();
    this.playerSide = 'left';
    this.segments = [];
    this.segmentObjs = [];
    this.foresterObjs = [];
    this.fallingLogs = [];
    this.segmentsSinceForester = 0;

    this.makeTextures();
    this.drawBackground();

    for (let i = 0; i < SEGMENT_COUNT; i += 1) {
      this.segments.push(this.randomSegment());
    }
    // Старт безопасный: внизу пусто, а лесник виден сразу near верхушки.
    this.segments[0] = { branch: 'none', forester: false, key: this.randomLetter() };
    this.segments[1] = { branch: 'none', forester: false, key: this.randomLetter() };
    this.segments[5] = { branch: 'right', forester: true, key: this.randomLetter() };
    this.refreshTree();

    this.buildPlayer();
    this.buildHud();
    this.buildOverlay();
    this.buildPauseOverlay();
    this.buildIdleBar();
    this.buildModeSwitch();
    this.buildHintsButton();
    this.bindInput();
  }

  update(_time: number, delta: number): void {
    // Перезапуск по зажатой R доступен всегда, даже на паузе.
    if (this.checkRestartHold()) return;
    // Пауза: игровой цикл просто ждёт — таймер и простой не идут.
    if (this.paused) return;
    // Таймер и полоска простоя живут только после первой рубки.
    if (this.playing && this.timerStarted) {
      this.elapsed += delta / 1000;
      this.timeText.setText(`⏱ ${this.elapsed.toFixed(1)}с`);
      this.tickIdle();
      // Фазы сложности действуют только в классике (в буквах ветка на каждом бревне).
      if (this.mode === 'classic') this.checkPhase();
    }
    // Оглушение после удара: игрок полупрозрачный, рубить нельзя.
    if (this.playing) {
      this.player.setAlpha(this.time.now < this.stunnedUntil ? 0.55 : 1);
    }
  }

  // ---------- Фазы сложности ----------

  /**
   * Классика становится жёстче со временем: каждые PHASE_SECONDS секунд —
   * новая фаза, шанс ветки берётся из таблицы PHASE_BRANCH_CHANCES (phases.ts).
   */
  private checkPhase(): void {
    const phase = Math.floor(this.elapsed / PHASE_SECONDS) + 1;
    if (phase <= this.phase) return;
    this.phase = phase;
    this.announcePhase();
  }

  /** Уведомление о новой фазе: вспышка, тряска и всплывающая надпись. */
  private announcePhase(): void {
    this.cameras.main.flash(220, 251, 191, 36);
    this.cameras.main.shake(220, 0.008);
    this.floatText(TREE_X, 220, `ФАЗА ${this.phase}: веток больше! 🌿`, '#fbbf24');
    this.updateHud();
  }

  // ---------- Перезапуск ----------

  /**
   * Зажатие физической клавиши R дольше RESTART_HOLD_MS — перезапуск игры.
   * Зажатие нужно, чтобы не конфликтовать с режимом букв (R = буква К).
   * @returns true, если игра перезапущена в этом кадре.
   */
  private checkRestartHold(): boolean {
    if (this.restartHoldStart === 0) return false;
    if (this.time.now - this.restartHoldStart < RESTART_HOLD_MS) return false;
    this.scene.restart();
    return true;
  }

  // ---------- Текстуры (процедурные, без внешних файлов) ----------

  /** Генерирует простые «текстуры» коры, земли и рубахи через Graphics. */
  private makeTextures(): void {
    if (this.textures.exists('trunk')) return;

    const trunk = this.make.graphics({ x: 0, y: 0 }, false);
    trunk.fillStyle(0x8b5a2b, 1);
    trunk.fillRect(0, 0, TRUNK_WIDTH, SEGMENT_HEIGHT);
    // Тёмные борозды коры.
    trunk.fillStyle(0x6b421d, 1);
    trunk.fillRect(6, 0, 5, SEGMENT_HEIGHT);
    trunk.fillRect(TRUNK_WIDTH - 11, 0, 5, SEGMENT_HEIGHT);
    trunk.fillRect(TRUNK_WIDTH / 2 - 2, 0, 4, SEGMENT_HEIGHT);
    trunk.fillRect(26, 0, 3, SEGMENT_HEIGHT);
    trunk.fillRect(TRUNK_WIDTH - 34, 0, 3, SEGMENT_HEIGHT);
    // Светлый блик слева.
    trunk.fillStyle(0xa06a35, 1);
    trunk.fillRect(14, 0, 7, SEGMENT_HEIGHT);
    trunk.fillRect(TRUNK_WIDTH - 26, 0, 5, SEGMENT_HEIGHT);
    // Сучки.
    trunk.fillStyle(0x5b3a18, 1);
    trunk.fillCircle(TRUNK_WIDTH / 2 + 12, SEGMENT_HEIGHT / 2 - 8, 5);
    trunk.fillCircle(TRUNK_WIDTH / 2 - 18, SEGMENT_HEIGHT / 2 + 12, 3);
    // Мох у нижнего края.
    trunk.fillStyle(0x4d7c0f, 1);
    trunk.fillCircle(12, SEGMENT_HEIGHT - 4, 5);
    trunk.fillCircle(30, SEGMENT_HEIGHT - 2, 4);
    trunk.fillCircle(TRUNK_WIDTH - 16, SEGMENT_HEIGHT - 3, 4);
    trunk.lineStyle(2, 0x3f2810, 1);
    trunk.strokeRect(0, 0, TRUNK_WIDTH, SEGMENT_HEIGHT);
    trunk.generateTexture('trunk', TRUNK_WIDTH, SEGMENT_HEIGHT);
    trunk.destroy();

    const ground = this.make.graphics({ x: 0, y: 0 }, false);
    ground.fillStyle(0x2f5d33, 1);
    ground.fillRect(0, 0, 64, 64);
    ground.fillStyle(0x3a7040, 1);
    for (let i = 0; i < 12; i += 1) {
      const x = (i * 37) % 60;
      const y = (i * 23) % 60;
      ground.fillCircle(x, y, 2);
    }
    ground.fillStyle(0x24492a, 1);
    for (let i = 0; i < 8; i += 1) {
      const x = (i * 53 + 9) % 60;
      const y = (i * 31 + 5) % 60;
      ground.fillRect(x, y, 5, 2);
    }
    ground.generateTexture('ground', 64, 64);
    ground.destroy();

    const plaid = this.make.graphics({ x: 0, y: 0 }, false);
    plaid.fillStyle(0xb91c1c, 1);
    plaid.fillRect(0, 0, 48, 56);
    plaid.fillStyle(0x7f1d1d, 1);
    plaid.fillRect(0, 12, 48, 6);
    plaid.fillRect(0, 36, 48, 6);
    plaid.fillRect(12, 0, 6, 56);
    plaid.fillRect(34, 0, 6, 56);
    plaid.generateTexture('plaid', 48, 56);
    plaid.destroy();
  }

  // ---------- Фон ----------

  private drawBackground(): void {
    // Небо.
    this.add.rectangle(480, 200, 960, 420, 0x87b5d6);
    this.add.rectangle(480, 470, 960, 140, 0x6a9cc4);
    // Солнце с лучами.
    this.add.circle(830, 90, 44, 0xfde68a, 0.35);
    for (let i = 0; i < 8; i += 1) {
      const a = (Math.PI * 2 * i) / 8;
      this.add.rectangle(830 + Math.cos(a) * 58, 90 + Math.sin(a) * 58, 16, 5, 0xfde68a, 0.8).setAngle((a * 180) / Math.PI);
    }
    this.add.circle(830, 90, 34, 0xfde68a);
    // Облака (медленно плывут).
    this.driftingCloud(200, 120, 1);
    this.driftingCloud(620, 70, 0.7);
    // Дальние холмы.
    this.add.ellipse(180, 470, 420, 150, 0x5b8c5a);
    this.add.ellipse(760, 480, 520, 170, 0x4e7f52);
    // Дальние ёлки.
    for (let i = 0; i < 10; i += 1) {
      const x = 40 + i * 96 + (i % 2 === 0 ? 12 : -10);
      const y = 430;
      const s = i % 2 === 0 ? 1 : 0.75;
      this.add.rectangle(x, y - 8, 12, 20, 0x5b3a18);
      this.add.triangle(x, y - 60 * s, 0, 60 * s, 60 * s, 60 * s, 30 * s, 0, 0x2d6a4f);
      this.add.triangle(x, y - 95 * s, 0, 50 * s, 50 * s, 50 * s, 25 * s, 0, 0x35795b);
      this.add.triangle(x, y - 122 * s, 0, 38 * s, 38 * s, 38 * s, 19 * s, 0, 0x40916c);
    }
    // Земля из «текстуры».
    this.add.tileSprite(480, 570, 960, 140, 'ground');
    this.add.rectangle(480, 502, 960, 8, 0x4a7c59);
    // Цветы и трава на земле.
    const flowerColors = [0xf472b6, 0xfde047, 0xffffff, 0xfb923c];
    for (let i = 0; i < 14; i += 1) {
      const x = 30 + ((i * 173) % 900);
      const y = 530 + ((i * 67) % 70);
      this.add.rectangle(x, y - 6, 3, 12, 0x166534);
      this.add.circle(x, y - 14, 4, flowerColors[i % flowerColors.length]);
      this.add.circle(x, y - 14, 2, 0xfef08a);
    }
  }

  /** Пушистое облако, которое медленно плывёт по небу. */
  private driftingCloud(x: number, y: number, s: number): void {
    const cloud = this.add.container(x, y);
    cloud.add(this.add.ellipse(0, 0, 120 * s, 44 * s, 0xffffff, 0.9));
    cloud.add(this.add.ellipse(-34 * s, 8 * s, 70 * s, 32 * s, 0xffffff, 0.9));
    cloud.add(this.add.ellipse(34 * s, 8 * s, 70 * s, 32 * s, 0xffffff, 0.9));
    this.tweens.add({
      targets: cloud,
      x: x + 60,
      duration: 26000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // ---------- Дерево ----------

  /** Случайная буква для бревна. */
  private randomLetter(): string {
    return LETTER_POOL[Math.floor(Math.random() * LETTER_POOL.length)];
  }

  /** Случайный разрыв до следующего лесника: от 5 до 12 рубок. */
  private randomForesterGap(): number {
    return Phaser.Math.Between(FORESTER_MIN_GAP, FORESTER_MAX_GAP);
  }

  /** Новый верхний сегмент. Ветка с лесником — через случайные 5–12 сегментов. */
  private randomSegment(): Segment {
    this.segmentsSinceForester += 1;
    if (this.segmentsSinceForester >= this.foresterGap) {
      this.segmentsSinceForester = 0;
      this.foresterGap = this.randomForesterGap();
      return { branch: Math.random() < 0.5 ? 'left' : 'right', forester: true, key: this.randomLetter() };
    }
    // В режиме букв каждое бревно с веткой: ошибка всегда стоит жизни.
    if (this.mode === 'letters') {
      return {
        branch: Math.random() < 0.5 ? 'left' : 'right',
        forester: false,
        key: this.randomLetter(),
      };
    }
    // Шанс ветки берётся из таблицы фаз (phases.ts) плюс бонус за спасённых.
    const chance = Math.min(
      branchChanceForPhase(this.phase) + this.rescued * BRANCH_CHANCE_STEP,
      BRANCH_CHANCE_MAX,
    );
    const roll = Math.random();
    if (roll < chance / 2) return { branch: 'left', forester: false, key: this.randomLetter() };
    if (roll < chance) return { branch: 'right', forester: false, key: this.randomLetter() };
    return { branch: 'none', forester: false, key: this.randomLetter() };
  }

  /**
   * Фигурка лесника: сапоги, джинсы, жилетка, поднятые руки, каска и лицо.
   * Точка (0,0) — ноги: так его удобно ставить на верхнюю кромку ветки.
   */
  private makeForesterFigure(scale: number): Phaser.GameObjects.Container {
    const f = this.add.container(0, 0);
    // Сапоги и джинсы.
    f.add(this.add.rectangle(-7, -5, 11, 10, 0x3f2f1e));
    f.add(this.add.rectangle(7, -5, 11, 10, 0x3f2f1e));
    f.add(this.add.rectangle(-7, -16, 11, 14, 0x1e3a8a));
    f.add(this.add.rectangle(7, -16, 11, 14, 0x1e3a8a));
    // Руки подняты вверх — машет о помощи.
    const armLeft = this.add.rectangle(-14, -36, 8, 22, 0x15803d);
    armLeft.setAngle(-40);
    const armRight = this.add.rectangle(14, -36, 8, 22, 0x15803d);
    armRight.setAngle(40);
    f.add(armLeft);
    f.add(armRight);
    f.add(this.add.circle(-22, -46, 5, 0xf2c89b));
    f.add(this.add.circle(22, -46, 5, 0xf2c89b));
    // Тело: зелёная рубаха + оранжевая жилетка с полосами.
    f.add(this.add.rectangle(0, -32, 26, 24, 0x15803d));
    f.add(this.add.rectangle(0, -32, 16, 24, 0xf97316));
    f.add(this.add.rectangle(0, -37, 16, 4, 0xfde047));
    f.add(this.add.rectangle(0, -27, 16, 4, 0xfde047));
    // Голова: глаза и рот.
    f.add(this.add.circle(0, -52, 14, 0xf2c89b));
    f.add(this.add.circle(-5, -50, 2, 0x1f2937));
    f.add(this.add.circle(5, -50, 2, 0x1f2937));
    f.add(this.add.rectangle(0, -44, 8, 3, 0x92400e));
    // Каска: купол + поля.
    f.add(this.add.ellipse(0, -61, 32, 20, 0xfacc15));
    f.add(this.add.rectangle(0, -52, 38, 5, 0xeab308));
    f.setScale(scale);
    return f;
  }

  /** Перерисовывает весь ствол по массиву segments (низ → верх). */
  private refreshTree(): void {
    for (const obj of this.segmentObjs) obj.destroy();
    this.segmentObjs = [];
    this.tweens.killTweensOf(this.foresterObjs);
    for (const obj of this.foresterObjs) obj.destroy();
    this.foresterObjs = [];

    for (let i = 0; i < this.segments.length; i += 1) {
      const seg = this.segments[i];
      const y = BASE_Y - i * SEGMENT_HEIGHT - SEGMENT_HEIGHT / 2;
      const c = this.add.container(TREE_X, y);
      c.setDepth(1);
      c.add(this.add.image(0, 0, 'trunk'));

      if (seg.branch === 'left' || seg.branch === 'right') {
        const dir = seg.branch === 'left' ? -1 : 1;
        // Ветка потолще, с корой и лиственным кустом на конце.
        const branch = this.add.rectangle(dir * (TRUNK_WIDTH / 2 + 55), -6, 110, 24, 0x6b421d);
        branch.setStrokeStyle(2, 0x3f2810);
        c.add(branch);
        c.add(this.add.rectangle(dir * (TRUNK_WIDTH / 2 + 30), -12, 60, 5, 0x8b5a2b));
        c.add(this.add.circle(dir * (TRUNK_WIDTH / 2 + 112), -16, 24, 0x2d6a4f));
        c.add(this.add.circle(dir * (TRUNK_WIDTH / 2 + 92), -2, 16, 0x40916c));
        c.add(this.add.circle(dir * (TRUNK_WIDTH / 2 + 104), -26, 12, 0x52b788));
        // Ягоды для заметности.
        c.add(this.add.circle(dir * (TRUNK_WIDTH / 2 + 100), -14, 3, 0xef4444));
        c.add(this.add.circle(dir * (TRUNK_WIDTH / 2 + 112), -22, 3, 0xef4444));
        c.add(this.add.circle(dir * (TRUNK_WIDTH / 2 + 90), -8, 3, 0xef4444));
        if (seg.forester) {
          // Лесник сидит на ветке и кричит SOS (рисуется поверх веток).
          this.drawForester(dir, y);
        }
      }
      // В режиме букв на нижнем бревне показана нужная буква.
      if (i === 0 && this.mode === 'letters') {
        const badge = this.add.rectangle(0, 0, 52, 52, WOOD_DARK, 0.95);
        badge.setStrokeStyle(3, 0xfbbf24);
        c.add(badge);
        const letter = this.add.text(0, 0, seg.key, {
          fontFamily: FONT,
          fontSize: '34px',
          color: COLOR_CREAM,
        });
        letter.setOrigin(0.5, 0.5);
        c.add(letter);
      }
      if (i === this.segments.length - 1) {
        // Крона на верхушке + светлые блики.
        c.add(this.add.circle(-30, -SEGMENT_HEIGHT / 2 - 22, 34, 0x2d6a4f));
        c.add(this.add.circle(30, -SEGMENT_HEIGHT / 2 - 22, 34, 0x2d6a4f));
        c.add(this.add.circle(0, -SEGMENT_HEIGHT / 2 - 44, 44, 0x35795b));
        c.add(this.add.circle(-14, -SEGMENT_HEIGHT / 2 - 56, 16, 0x52b788));
        c.add(this.add.circle(16, -SEGMENT_HEIGHT / 2 - 40, 12, 0x52b788));
      }
      // Нижний сегмент с лесником подсвечиваем стрелкой-подсказкой (классика).
      if (i === 0 && seg.forester && this.mode === 'classic') {
        const hint = this.add.text(0, 44, '⬇ РУБИТЕ С ПРОТИВОПОЛОЖНОЙ СТОРОНЫ ⬇', {
          fontFamily: FONT,
          fontSize: '15px',
          color: '#fef08a',
        });
        hint.setOrigin(0.5, 0.5);
        c.add(hint);
      }
      this.segmentObjs.push(c);
    }
  }

  /**
   * Лесник на ветке: крупная фигурка + белый «пузырь» SOS с красными буквами.
   * Рисуется отдельным слоем над ветками, чтобы те его не перекрывали.
   */
  private drawForester(dir: number, segmentY: number): void {
    const x = TREE_X + dir * (TRUNK_WIDTH / 2 + 52);
    // Ноги ставим на верхнюю кромку ветки (у ветки центр −6, высота 20 → кромка −16).
    const fig = this.makeForesterFigure(FORESTER_SCALE);
    fig.setPosition(x, segmentY - 16);
    fig.setDepth(1.5);
    // Лесник слегка качается и машет.
    this.tweens.add({
      targets: fig,
      angle: dir * 4,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Пузырь реплики: белая «подложка», красная кайма и хвост в сторону лесника.
    const bubble = this.add.container(x - dir * 66, segmentY - 76);
    bubble.setDepth(1.5);
    const shape = this.add.graphics();
    shape.fillStyle(0xffffff, 0.95);
    shape.fillTriangle(dir * 22, -11, dir * 22, 11, dir * 50, 0);
    shape.lineStyle(3, 0xdc2626, 1);
    shape.strokeLineShape(new Phaser.Geom.Line(dir * 22, -11, dir * 50, 0));
    shape.strokeLineShape(new Phaser.Geom.Line(dir * 50, 0, dir * 22, 11));
    shape.fillStyle(0xffffff, 0.95);
    shape.fillRoundedRect(-44, -17, 88, 34, 10);
    shape.lineStyle(3, 0xdc2626, 1);
    shape.strokeRoundedRect(-44, -17, 88, 34, 10);
    bubble.add(shape);
    const sos = this.add.text(0, 0, 'SOS!', {
      fontFamily: FONT,
      fontSize: '22px',
      color: '#dc2626',
      fontStyle: 'bold',
    });
    sos.setOrigin(0.5, 0.5);
    bubble.add(sos);
    this.tweens.add({
      targets: bubble,
      scale: { from: 1, to: 1.07 },
      duration: 450,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.foresterObjs.push(fig, bubble);
  }

  // ---------- Игрок ----------

  private buildPlayer(): void {
    const x = TREE_X - PLAYER_OFFSET_X;
    this.player = this.add.container(x, BASE_Y);
    this.player.setDepth(2);
    // Ноги: штаны + сапоги.
    this.player.add(this.add.rectangle(-10, 46, 16, 22, 0x374151));
    this.player.add(this.add.rectangle(10, 46, 16, 22, 0x374151));
    this.player.add(this.add.rectangle(-10, 60, 20, 10, 0x3f2f1e));
    this.player.add(this.add.rectangle(10, 60, 20, 10, 0x3f2f1e));
    // Тело в клетчатой рубахе (текстура plaid) + ремень.
    this.player.add(this.add.image(0, 12, 'plaid'));
    this.player.add(this.add.rectangle(0, 36, 48, 8, 0x3f2f1e));
    this.player.add(this.add.rectangle(0, 36, 10, 12, 0xfbbf24));
    // Левая рука опущена, правая тянется к топору.
    const armLeft = this.add.rectangle(-30, 14, 12, 34, 0xb91c1c);
    armLeft.setAngle(8);
    const armRight = this.add.rectangle(28, 2, 12, 34, 0xb91c1c);
    armRight.setAngle(-50);
    this.player.add(armLeft);
    this.player.add(armRight);
    this.player.add(this.add.circle(-30, 32, 7, 0xf2c89b));
    this.player.add(this.add.circle(38, -12, 7, 0xf2c89b));
    // Голова: глаза, нос, борода, шапка.
    this.player.add(this.add.circle(0, -30, 20, 0xf2c89b));
    this.player.add(this.add.circle(-7, -34, 3, 0x1f2937));
    this.player.add(this.add.circle(7, -34, 3, 0x1f2937));
    this.player.add(this.add.circle(0, -28, 3, 0xe0a06e));
    this.player.add(this.add.rectangle(0, -16, 28, 16, 0x5b3a18));
    this.player.add(this.add.rectangle(0, -46, 40, 12, 0x166534));
    this.player.add(this.add.rectangle(0, -54, 30, 12, 0x15803d));
    // Топор целиком (рукоять + головка) в одном контейнере — крутится вместе.
    this.axe = this.add.container(0, 0);
    this.axe.add(this.add.rectangle(40, -8, 10, 52, 0x92400e));
    this.axe.add(this.add.rectangle(40, -32, 12, 8, 0x5b3a18));
    this.axe.add(this.add.rectangle(42, -30, 38, 13, 0x9ca3af));
    this.axe.add(this.add.rectangle(56, -30, 8, 13, 0xe5e7eb));
    this.player.add(this.axe);
  }

  private movePlayer(): void {
    const x = this.playerSide === 'left' ? TREE_X - PLAYER_OFFSET_X : TREE_X + PLAYER_OFFSET_X;
    this.player.setX(x);
    this.player.scaleX = this.playerSide === 'left' ? 1 : -1;
  }

  // ---------- HUD ----------

  private buildHud(): void {
    // Верхняя балка — деревянная, с тёмной кромкой снизу.
    this.add.rectangle(480, 34, 960, 68, WOOD_FILL, 0.96).setDepth(19);
    this.add.rectangle(480, 66, 960, 5, WOOD_DARK, 0.96).setDepth(19);
    this.livesText = this.add.text(20, 16, '', {
      fontFamily: FONT,
      fontSize: '26px',
      color: COLOR_TEXT,
    });
    this.timeText = this.add.text(480, 16, '⏱ 0.0с', {
      fontFamily: FONT,
      fontSize: '26px',
      color: COLOR_TEXT,
    });
    this.timeText.setOrigin(0.5, 0);
    this.rescuedText = this.add.text(940, 16, '', {
      fontFamily: FONT,
      fontSize: '26px',
      color: COLOR_TEXT,
    });
    this.rescuedText.setOrigin(1, 0);
    this.progressText = this.add.text(480, 44, '', {
      fontFamily: FONT,
      fontSize: '16px',
      color: COLOR_CREAM,
    });
    this.progressText.setOrigin(0.5, 0);
    this.hintText = this.add.text(
      480,
      604,
      '← / A — слева   |   → / D — справа   |   лесник сидит на ветке: руби и не стой под ней! 🪵',
      { fontFamily: FONT, fontSize: '16px', color: COLOR_TEXT, backgroundColor: '#111827aa', padding: { x: 10, y: 6 } },
    );
    this.hintText.setOrigin(0.5, 0.5);
    this.hintText.setVisible(false);
    this.livesText.setDepth(20);
    this.timeText.setDepth(20);
    this.rescuedText.setDepth(20);
    this.progressText.setDepth(20);
    this.hintText.setDepth(20);
    this.updateHud();
  }

  private updateHud(): void {
    const hearts = '❤'.repeat(this.lives) + '🖤'.repeat(Math.max(0, MAX_LIVES - this.lives));
    this.livesText.setText(hearts);
    this.rescuedText.setText(`🧑‍🌾 ${this.rescued}/${FORESTERS_TO_WIN}`);
    const idx = this.segments.findIndex((s) => s.forester);
    const dist = idx < 0 ? '—' : `${idx}`;
    const best = this.bestTime === null ? '—' : `${this.bestTime.toFixed(1)}с`;
    // Фаза действует только в классике — в HUD показываем её там.
    const phasePart = this.mode === 'classic' ? `   •   фаза: ${this.phase}` : '';
    this.progressText.setText(
      `рубок: ${this.chops}   •   лесник через: ${dist}${phasePart}   •   рекорд: ${best} 🏆`,
    );
  }

  // ---------- Шкала бездействия ----------

  /** Полоса «РУБИ!» под HUD: появляется при простое, пустеет к штрафу. */
  private buildIdleBar(): void {
    this.idleBox = this.add.container(480, 96).setDepth(20).setVisible(false);
    const bg = this.add.rectangle(0, 0, IDLE_BAR_WIDTH + 12, 40, WOOD_FILL, 0.95);
    bg.setStrokeStyle(2, WOOD_DARK);
    const frame = this.add.rectangle(0, 8, IDLE_BAR_WIDTH, 12, WOOD_DARK);
    this.idleFill = this.add.rectangle(-IDLE_BAR_WIDTH / 2, 8, IDLE_BAR_WIDTH, 12, 0x4ade80);
    this.idleFill.setOrigin(0, 0.5);
    this.idleLabel = this.add.text(0, -8, '⏳ РУБИ! А ТО ЗАСНЁШЬ!', {
      fontFamily: FONT,
      fontSize: '16px',
      color: '#fef08a',
    });
    this.idleLabel.setOrigin(0.5, 0.5);
    this.idleBox.add([bg, frame, this.idleFill, this.idleLabel]);
  }

  private hideIdleBar(): void {
    this.idleBox.setVisible(false);
  }

  /** Проверяет простой: показывает шкалу, при истечении — минус жизнь. */
  private tickIdle(): void {
    const idleFor = this.time.now - this.lastActionTime;
    if (idleFor < IDLE_WARN_MS) {
      this.hideIdleBar();
      return;
    }
    const left = Phaser.Math.Clamp(
      1 - (idleFor - IDLE_WARN_MS) / (IDLE_LIMIT_MS - IDLE_WARN_MS),
      0,
      1,
    );
    this.idleBox.setVisible(true);
    this.idleFill.setScale(Math.max(left, 0.001), 1);
    this.idleFill.setFillStyle(left > 0.5 ? 0x4ade80 : left > 0.25 ? 0xfbbf24 : 0xf87171);
    this.idleLabel.setAlpha(0.6 + 0.4 * Math.sin(this.time.now / 150));
    if (left <= 0) {
      this.applyIdlePenalty();
    }
  }

  /** Штраф за сон: −1 жизнь и отсчёт простоя заново. */
  private applyIdlePenalty(): void {
    this.lives -= 1;
    this.lastActionTime = this.time.now;
    this.hideIdleBar();
    this.cameras.main.shake(180, 0.012);
    this.cameras.main.flash(120, 220, 60, 60);
    this.floatText(TREE_X, BASE_Y - 140, 'Не спи! −1 ❤', COLOR_BAD);
    this.updateHud();
    if (this.lives <= 0) {
      this.endGame(false);
    }
  }

  // ---------- Кнопка подсказок ----------

  /** Кнопка ❓ под рубильником: показывает/прячет подсказку управления. */
  private buildHintsButton(): void {
    this.hintsButtonBox = this.add.rectangle(0, 0, 100, 38, WOOD_FILL, 0.96);
    this.hintsButtonBox.setStrokeStyle(2, WOOD_DARK);
    this.hintsButtonBox.setInteractive({ useHandCursor: true });
    this.hintsButtonBox.on('pointerdown', () => this.toggleHints());
    this.hintsButtonLabel = this.add.text(0, 0, '', {
      fontFamily: FONT,
      fontSize: '15px',
      color: '#fde9c8',
    });
    this.hintsButtonLabel.setOrigin(0.5, 0.5);
    this.hintsButton = this.add.container(HINTS_X, HINTS_Y, [
      this.hintsButtonBox,
      this.hintsButtonLabel,
    ]);
    this.hintsButton.setDepth(21);
    this.updateHintsButton();
  }

  /** Переключает подсказки и обновляет кнопку. */
  private toggleHints(): void {
    if (this.paused) return;
    this.hintsOn = !this.hintsOn;
    this.applyModeHint();
    this.updateHintsButton();
  }

  /** Подпись кнопки ❓ по состоянию подсказок. */
  private updateHintsButton(): void {
    this.hintsButtonLabel.setText(this.hintsOn ? '❓ ВКЛ' : '❓ ВЫКЛ');
    this.hintsButtonBox.setStrokeStyle(2, this.hintsOn ? 0x4ade80 : WOOD_DARK);
  }

  /** Попал ли клик в зону кнопки подсказок (чтобы не рубить и не рестартовать). */
  private isOverHintsButton(x: number, y: number): boolean {
    return (
      Math.abs(x - HINTS_X) <= HINTS_ZONE_WIDTH / 2 &&
      Math.abs(y - HINTS_Y) <= HINTS_ZONE_HEIGHT / 2
    );
  }

  /** Подсказка управления внизу экрана — по текущему режиму и кнопке ❓. */
  private applyModeHint(): void {
    this.hintText.setText(
      this.mode === 'letters'
        ? 'Жми букву с нижнего бревна! Верная — безопасная рубка, неверная — рубка на месте ⌨️'
        : '← / A — слева   |   → / D — справа   |   лесник сидит на ветке: руби и не стой под ней! 🪵',
    );
    this.hintText.setVisible(this.hintsOn);
  }

  private buildOverlay(): void {
    this.overlay = this.add.container(480, 300).setVisible(false).setDepth(30);
    const bg = this.add.rectangle(0, 0, 640, 300, WOOD_FILL, 0.98);
    bg.setStrokeStyle(4, WOOD_DARK);
    const inner = this.add.rectangle(0, 0, 616, 276, 0x000000, 0);
    inner.setStrokeStyle(2, WOOD_LIGHT);
    this.overlayTitle = this.add.text(0, -100, '', {
      fontFamily: FONT,
      fontSize: '36px',
      color: COLOR_TEXT,
    });
    this.overlayTitle.setOrigin(0.5, 0.5);
    this.overlayStats = this.add.text(0, 10, '', {
      fontFamily: FONT,
      fontSize: '22px',
      color: COLOR_TEXT,
      align: 'center',
    });
    this.overlayStats.setOrigin(0.5, 0.5);
    const restartHint = this.add.text(0, 110, 'Зажми R или кликни, чтобы играть снова', {
      fontFamily: FONT,
      fontSize: '19px',
      color: COLOR_CREAM,
    });
    restartHint.setOrigin(0.5, 0.5);
    this.overlay.add([bg, inner, this.overlayTitle, this.overlayStats, restartHint]);
  }

  // ---------- Пауза ----------

  /**
   * Оверлей паузы: затемнение, надпись «ПАУЗА» и кнопка «Продолжить».
   * Виден только пока paused === true; клик по кнопке обрабатывается
   * в bindInput(), чтобы игра продолжилась ровно с момента остановки.
   */
  private buildPauseOverlay(): void {
    const dim = this.add.rectangle(0, 0, 960, 640, 0x000000, 0.55);
    const title = this.add.text(0, -76, 'ПАУЗА', {
      fontFamily: FONT,
      fontSize: '52px',
      fontStyle: 'bold',
      color: COLOR_TEXT,
    });
    title.setOrigin(0.5, 0.5);
    const hint = this.add.text(0, -22, 'Таймер остановлен — жми ESC или кнопку', {
      fontFamily: FONT,
      fontSize: '18px',
      color: COLOR_MUTED,
    });
    hint.setOrigin(0.5, 0.5);
    const buttonBox = this.add.rectangle(
      PAUSE_BUTTON_LOCAL_X,
      PAUSE_BUTTON_LOCAL_Y,
      PAUSE_BUTTON_WIDTH,
      PAUSE_BUTTON_HEIGHT,
      0x15803d,
    );
    buttonBox.setStrokeStyle(3, WOOD_DARK);
    // Курсор «рука»; сам клик ловит bindInput, чтобы не рубить после резюма.
    buttonBox.setInteractive({ useHandCursor: true });
    const buttonLabel = this.add.text(PAUSE_BUTTON_LOCAL_X, PAUSE_BUTTON_LOCAL_Y, '▶ Продолжить', {
      fontFamily: FONT,
      fontSize: '24px',
      color: COLOR_CREAM,
    });
    buttonLabel.setOrigin(0.5, 0.5);
    this.pauseOverlay = this.add
      .container(PAUSE_OVERLAY_X, PAUSE_OVERLAY_Y, [dim, title, hint, buttonBox, buttonLabel])
      .setVisible(false)
      .setDepth(40);
  }

  /**
   * ESC: ставит/снимает паузу. До первой рубки пауза недоступна.
   */
  private togglePause(): void {
    if (!this.playing) return;
    if (this.paused) {
      this.resumeGame();
      return;
    }
    if (!this.timerStarted) {
      this.floatText(TREE_X, BASE_Y - 140, 'Пауза — после первой рубки 🔨', '#fbbf24');
      return;
    }
    this.paused = true;
    this.pausedAt = this.time.now;
    this.hideIdleBar();
    this.tweens.pauseAll();
    this.pauseOverlay.setVisible(true);
  }

  /** Снимает паузу: твины продолжаются, оглушение и простой «продлеваются». */
  private resumeGame(): void {
    const pausedFor = this.time.now - this.pausedAt;
    this.paused = false;
    this.pauseOverlay.setVisible(false);
    this.tweens.resumeAll();
    this.stunnedUntil += pausedFor;
    this.lastActionTime += pausedFor;
  }

  /** Попал ли клик в кнопку «Продолжить» на оверлее паузы. */
  private isOverPauseButton(x: number, y: number): boolean {
    return (
      Math.abs(x - (PAUSE_OVERLAY_X + PAUSE_BUTTON_LOCAL_X)) <= PAUSE_BUTTON_WIDTH / 2 &&
      Math.abs(y - (PAUSE_OVERLAY_Y + PAUSE_BUTTON_LOCAL_Y)) <= PAUSE_BUTTON_HEIGHT / 2
    );
  }

  // ---------- Рубильник режима ----------

  /** Рубильник в правом верхнем углу: деревянный щиток, ручка, значки и подпись. */
  private buildModeSwitch(): void {
    const plate = this.add.rectangle(0, 0, 132, 66, WOOD_FILL, 0.96);
    plate.setStrokeStyle(2, WOOD_DARK);
    plate.setInteractive({ useHandCursor: true });
    plate.on('pointerdown', () => this.toggleMode());
    const title = this.add.text(0, -40, 'РЕЖИМ ИГРЫ', {
      fontFamily: FONT,
      fontSize: '13px',
      color: COLOR_CREAM,
    });
    title.setOrigin(0.5, 0.5);
    const slot = this.add.rectangle(0, 0, 84, 12, 0x334155);
    const iconLetters = this.add.text(-52, 0, '🔤', { fontFamily: FONT, fontSize: '18px' });
    iconLetters.setOrigin(0.5, 0.5);
    const iconClassic = this.add.text(52, 0, '🪓', { fontFamily: FONT, fontSize: '18px' });
    iconClassic.setOrigin(0.5, 0.5);
    // Ручка рубильника: влево — буквы, вправо — классика.
    this.modeSwitchLever = this.add.rectangle(0, 12, 14, 34, 0xf59e0b);
    this.modeSwitchLever.setOrigin(0.5, 1);
    const pivot = this.add.circle(0, 12, 7, 0x94a3b8);
    this.modeSwitchLabel = this.add.text(0, 46, '', {
      fontFamily: FONT,
      fontSize: '15px',
      color: COLOR_CREAM,
    });
    this.modeSwitchLabel.setOrigin(0.5, 0.5);
    const sw = this.add.container(SWITCH_X, SWITCH_Y, [
      plate,
      title,
      slot,
      iconLetters,
      iconClassic,
      this.modeSwitchLever,
      pivot,
      this.modeSwitchLabel,
    ]);
    sw.setDepth(21);
    this.updateModeSwitch(false);
  }

  /** Положение ручки и подпись рубильника по текущему режиму. */
  private updateModeSwitch(animate: boolean): void {
    const letters = this.mode === 'letters';
    this.modeSwitchLabel.setText(letters ? '🔤 БУКВЫ' : '🪓 КЛАССИКА');
    const targetAngle = letters ? -32 : 32;
    if (animate) {
      this.tweens.add({
        targets: this.modeSwitchLever,
        angle: targetAngle,
        duration: 160,
        ease: 'Back.easeOut',
      });
    } else {
      this.modeSwitchLever.setAngle(targetAngle);
    }
  }

  /** Клик по рубильнику: переключает режим, но только до первой рубки. */
  private toggleMode(): void {
    if (!this.playing || this.paused) return;
    if (this.timerStarted) {
      this.floatText(SWITCH_X, SWITCH_Y + 70, '🔒 Закрыт после первой рубки', '#fbbf24');
      return;
    }
    this.mode = this.mode === 'classic' ? 'letters' : 'classic';
    this.updateModeSwitch(true);
    this.applyModeHint();
    this.updateHud();
    this.refreshTree();
  }

  /** Попал ли клик в зону рубильника (чтобы не рубить и не рестартовать). */
  private isOverModeSwitch(x: number, y: number): boolean {
    return (
      Math.abs(x - SWITCH_X) <= SWITCH_ZONE_WIDTH / 2 &&
      Math.abs(y - SWITCH_Y) <= SWITCH_ZONE_HEIGHT / 2
    );
  }

  // ---------- Ввод ----------

  private bindInput(): void {
    const kb = this.input.keyboard;
    if (!kb) throw new Error('Keyboard input is unavailable.');
    // Классика: стрелки / WASD.
    kb.on('keydown-LEFT', () => this.classicChop('left'));
    kb.on('keydown-A', () => this.classicChop('left'));
    kb.on('keydown-RIGHT', () => this.classicChop('right'));
    kb.on('keydown-D', () => this.classicChop('right'));
    // Перезапуск: зажать R (в режиме букв R = буква К, поэтому только зажатие).
    kb.on('keydown-R', (event: KeyboardEvent) => {
      if (event.repeat) return;
      this.restartHoldStart = this.time.now;
      this.floatText(TREE_X, 220, `Зажми R ещё ${(RESTART_HOLD_MS / 1000).toFixed(1)}с — заново 🔄`, COLOR_MUTED);
    });
    kb.on('keyup-R', () => {
      this.restartHoldStart = 0;
    });
    // Пауза: ESC ставит и снимает паузу.
    kb.on('keydown-ESC', () => this.togglePause());
    // Режим букв: любая буквенная клавиша.
    kb.on('keydown', (event: KeyboardEvent) => this.onLetterKey(event));
    // Клик/тап в классике: левая половина — слева, правая — справа.
    // После конца игры клик = рестарт.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // На паузе клик снимает паузу только по кнопке «Продолжить», рубить нельзя.
      if (this.paused) {
        if (this.isOverPauseButton(pointer.x, pointer.y)) this.resumeGame();
        return;
      }
      // Клики по рубильнику и кнопке подсказок — не рубка и не рестарт.
      if (this.isOverModeSwitch(pointer.x, pointer.y)) return;
      if (this.isOverHintsButton(pointer.x, pointer.y)) return;
      if (!this.playing) {
        this.scene.restart();
        return;
      }
      this.classicChop(pointer.x < TREE_X ? 'left' : 'right');
    });
  }

  /** Рубка для классического режима (в режиме букв стрелки и клики не работают). */
  private classicChop(side: Side): void {
    if (this.mode !== 'classic') return;
    this.chop(side);
  }

  /**
   * Нажатие буквы в режиме букв.
   * Верная — безопасная рубка (всегда со стороны, противоположной ветке).
   * Неверная — шаг под ветку: удар и −1 жизнь (в режиме букв ветка
   * есть на каждом бревне, так что ошибка всегда стоит жизни).
   */
  private onLetterKey(event: KeyboardEvent): void {
    if (!this.playing || this.mode !== 'letters') return;
    if (event.repeat) return;
    // Во время оглушения рубить нельзя.
    if (this.time.now < this.stunnedUntil) return;
    // Любая одиночная клавиша в деле (буквы, цифры, знаки).
    // Раскладка не важна: латинские двойники приводятся к кириллице пула.
    if (event.key.length !== 1) return;
    const pressed = normalizeLetter(event.key.toUpperCase());

    const bottom = this.segments[0];
    if (pressed === bottom.key) {
      // Верная буква: рубим с безопасной стороны.
      const safe: Side =
        bottom.branch === 'none' ? this.playerSide : bottom.branch === 'left' ? 'right' : 'left';
      this.chop(safe);
    } else {
      // Неверная буква: встаём под ветку — удар гарантирован.
      this.chop(bottom.branch === 'none' ? this.playerSide : bottom.branch);
    }
  }

  // ---------- Главный удар ----------

  private chop(side: Side): void {
    if (this.paused || !this.playing || this.time.now < this.stunnedUntil) return;
    this.playerSide = side;
    this.movePlayer();
    this.swingAxe();
    this.lastActionTime = this.time.now;
    this.hideIdleBar();

    const bottom = this.segments[0];
    let gotHit = false;

    if (bottom.branch === side) {
      // 🪵 Ствол ударяет: минус жизнь + оглушение (рубить нельзя).
      // Лесник с этой ветки тоже падает.
      gotHit = true;
      this.lives -= 1;
      this.stunnedUntil = this.time.now + STUN_MS;
      this.cameras.main.shake(180, 0.012);
      this.cameras.main.flash(120, 220, 60, 60);
      this.floatText(TREE_X, BASE_Y - 140, 'Оглушён!', '#fef08a');
      this.floatText(TREE_X, BASE_Y - 100, bottom.forester ? '−1 ❤ лесник упал!' : '−1 ❤', COLOR_BAD);
      this.updateHud();
      if (this.lives <= 0) {
        this.endGame(false);
        return;
      }
    }

    // Первая рубка (даже с ударом) запускает таймер и блокирует рубильник.
    if (!this.timerStarted) {
      this.timerStarted = true;
      this.timeText.setText(`⏱ ${this.elapsed.toFixed(1)}с`);
    }

    // Срубили нижний сегмент: ствол «оседает», сверху новый.
    const chopped = this.segments.shift();
    this.segments.push(this.randomSegment());
    this.chops += 1;
    this.spawnFallingLog(side, chopped?.forester ?? false);
    this.spawnChips(side);
    this.refreshTree();
    this.updateHud();

    // Лесник спасён, только если срубили его ветку и не получили удар.
    if (chopped?.forester === true && !gotHit) {
      this.rescueForester();
    }
  }

  private swingAxe(): void {
    this.tweens.killTweensOf(this.axe);
    this.axe.setAngle(-35);
    this.tweens.add({
      targets: this.axe,
      angle: 45,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  private rescueForester(): void {
    this.rescued += 1;
    this.updateHud();
    // Спасённый лесник подпрыгивает у ствола и убегает.
    const side = this.playerSide === 'left' ? 1 : -1;
    const fx = TREE_X + side * 220;
    const forester = this.makeForesterFigure(1.4);
    forester.setPosition(fx, BASE_Y - 10);
    forester.setAlpha(0);
    this.tweens.add({
      targets: forester,
      alpha: 1,
      y: BASE_Y - 80,
      duration: 350,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.tweens.add({
          targets: forester,
          alpha: 0,
          y: BASE_Y - 150,
          duration: 600,
          delay: 500,
          onComplete: () => forester.destroy(),
        });
      },
    });
    this.floatText(TREE_X, 200, `Лесник спасён с ветки! ${this.rescued}/${FORESTERS_TO_WIN} 🧑‍🌾`, COLOR_GOOD);
    this.cameras.main.flash(80, 74, 222, 128);

    if (this.rescued >= FORESTERS_TO_WIN) {
      this.endGame(true);
    }
  }

  // ---------- Эффекты ----------

  /** Улетающий срубленный кусок ствола в сторону удара. */
  private spawnFallingLog(side: Side, withForester: boolean): void {
    const dir = side === 'left' ? -1 : 1;
    const log = this.add.container(TREE_X, BASE_Y - SEGMENT_HEIGHT / 2);
    log.add(this.add.image(0, 0, 'trunk'));
    if (withForester) {
      // Лесник кувыркается вместе с бревном (если его не спасли — удар).
      const f = this.makeForesterFigure(0.7);
      f.setPosition(dir * 20, -30);
      log.add(f);
    }
    log.setDepth(5);
    this.fallingLogs.push(log);
    this.tweens.add({
      targets: log,
      x: TREE_X + dir * 320,
      y: BASE_Y - 120,
      angle: dir * 120,
      alpha: 0,
      duration: 450,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        log.destroy();
        this.fallingLogs = this.fallingLogs.filter((l) => l !== log);
      },
    });
  }

  /** Щепки от удара топором. */
  private spawnChips(side: Side): void {
    const dir = side === 'left' ? -1 : 1;
    for (let i = 0; i < 6; i += 1) {
      const chip = this.add.rectangle(
        TREE_X + dir * -30,
        BASE_Y - 40 + Phaser.Math.Between(-20, 20),
        Phaser.Math.Between(4, 9),
        Phaser.Math.Between(4, 9),
        0xfbbf24,
      );
      chip.setDepth(6);
      this.tweens.add({
        targets: chip,
        x: chip.x + dir * -Phaser.Math.Between(40, 120),
        y: chip.y - Phaser.Math.Between(20, 90),
        angle: Phaser.Math.Between(-180, 180),
        alpha: 0,
        duration: Phaser.Math.Between(250, 450),
        onComplete: () => chip.destroy(),
      });
    }
  }

  private floatText(x: number, y: number, message: string, color: string): void {
    const t = this.add
      .text(x, y, message, { fontFamily: FONT, fontSize: '28px', color })
      .setOrigin(0.5, 0.5)
      .setDepth(9);
    this.tweens.add({
      targets: t,
      y: y - 60,
      alpha: 0,
      duration: 900,
      onComplete: () => t.destroy(),
    });
  }

  // ---------- Финал ----------

  private loadBestTime(): number | null {
    try {
      const raw = localStorage.getItem(BEST_TIME_KEY);
      const value = raw === null ? NaN : Number(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }

  private saveBestTime(): void {
    try {
      if (this.bestTime !== null) localStorage.setItem(BEST_TIME_KEY, String(this.bestTime));
    } catch {
      // Приватный режим и т.п. — рекорд просто не сохранится.
    }
  }

  private endGame(won: boolean): void {
    this.playing = false;
    this.player.setAlpha(1);
    let recordLine = '';
    if (won && (this.bestTime === null || this.elapsed < this.bestTime)) {
      this.bestTime = this.elapsed;
      this.saveBestTime();
      recordLine = '\n🎉 Новый рекорд времени!';
    }
    const bestLine = this.bestTime === null ? '' : `\nРекорд: ${this.bestTime.toFixed(1)}с 🏆`;
    const title = won ? 'ЛЕС СПАСЁН! 🌲' : 'ДРОВОСЕК ПОВЕРЖЕН 🪵';
    const detail = won
      ? `${FORESTERS_TO_WIN} лесников сняты с веток за ${this.elapsed.toFixed(1)}с!\nРубок сделано: ${this.chops}${recordLine}${bestLine}`
      : `Лесников спасено: ${this.rescued} из ${FORESTERS_TO_WIN}\nРубок сделано: ${this.chops}\nВремя: ${this.elapsed.toFixed(1)}с${bestLine}`;
    this.overlayTitle.setText(title).setColor(won ? COLOR_GOOD : COLOR_BAD);
    this.overlayStats.setText(detail);
    this.overlay.setVisible(true);
    this.overlay.setScale(0.7);
    this.tweens.add({ targets: this.overlay, scale: 1, duration: 250, ease: 'Back.easeOut' });
  }
}
