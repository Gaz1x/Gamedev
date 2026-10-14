import Phaser from 'phaser';

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
/** Стартовый шанс ветки на новом сегменте. */
const BRANCH_CHANCE_START = 0.32;
/** Рост шанса ветки за каждого спасённого. */
const BRANCH_CHANCE_STEP = 0.04;
/** Максимальный шанс ветки. */
const BRANCH_CHANCE_MAX = 0.55;
/** Оглушение после удара веткой: рубить нельзя, мс. */
const STUN_MS = 900;
/** Ключ рекорда времени в localStorage. */
const BEST_TIME_KEY = 'lumberjack-best-time';
/** Через сколько мс бездействия появляется шкала «РУБИ!». */
const IDLE_WARN_MS = 3500;
/** Через сколько мс бездействия сгорает жизнь. */
const IDLE_LIMIT_MS = 9000;
/** Ширина шкалы бездействия в пикселях. */
const IDLE_BAR_WIDTH = 320;

const FONT = 'system-ui, sans-serif';
const COLOR_TEXT = '#f8fafc';
const COLOR_MUTED = '#cbd5e1';
const COLOR_GOOD = '#4ade80';
const COLOR_BAD = '#f87171';

type Side = 'left' | 'right';
type Branch = 'none' | Side;

/** Один кусок ствола. Лесник всегда сидит на ветке (branch != 'none'). */
interface Segment {
  branch: Branch;
  forester: boolean;
}

/**
 * «Дровосек-спасатель» (тайминг).
 *
 * Игрок рубит ствол слева/справа (←/→, A/D, клик по половине экрана).
 * Нельзя стоять под веткой на нижнем сегменте — иначе удар и −1 жизнь.
 * На некоторых ветках сидит лесник: сруби ствол до него и не попади
 * под его ветку — лесник спасён. Победа — 5 лесников, счёт — время.
 */
export class GameScene extends Phaser.Scene {
  private segments: Segment[] = [];
  private segmentObjs: Phaser.GameObjects.Container[] = [];
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
  private idleBox!: Phaser.GameObjects.Container;
  private idleFill!: Phaser.GameObjects.Rectangle;
  private idleLabel!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.chops = 0;
    this.rescued = 0;
    this.lives = MAX_LIVES;
    this.elapsed = 0;
    this.playing = true;
    this.stunnedUntil = 0;
    this.lastActionTime = this.time.now;
    this.foresterGap = this.randomForesterGap();
    this.bestTime = this.loadBestTime();
    this.playerSide = 'left';
    this.segments = [];
    this.segmentObjs = [];
    this.fallingLogs = [];
    this.segmentsSinceForester = 0;

    this.makeTextures();
    this.drawBackground();

    for (let i = 0; i < SEGMENT_COUNT; i += 1) {
      this.segments.push(this.randomSegment());
    }
    // Старт безопасный: внизу пусто, а лесник виден сразу near верхушки.
    this.segments[0] = { branch: 'none', forester: false };
    this.segments[1] = { branch: 'none', forester: false };
    this.segments[5] = { branch: 'right', forester: true };
    this.refreshTree();

    this.buildPlayer();
    this.buildHud();
    this.buildOverlay();
    this.buildIdleBar();
    this.bindInput();
  }

  update(_time: number, delta: number): void {
    if (this.playing) {
      this.elapsed += delta / 1000;
      this.timeText.setText(`⏱ ${this.elapsed.toFixed(1)}с`);
      this.tickIdle();
    }
    // Оглушение после удара: игрок полупрозрачный, рубить нельзя.
    if (this.playing) {
      this.player.setAlpha(this.time.now < this.stunnedUntil ? 0.55 : 1);
    }
  }

  // ---------- Текстуры (процедурные, без внешних файлов) ----------

  /** Генерирует простые «текстуры» коры, земли и рубахи через Graphics. */
  private makeTextures(): void {
    if (this.textures.exists('trunk')) return;

    const trunk = this.make.graphics({ x: 0, y: 0 }, false);
    trunk.fillStyle(0x8b5a2b, 1);
    trunk.fillRect(0, 0, TRUNK_WIDTH, SEGMENT_HEIGHT);
    trunk.fillStyle(0x6b421d, 1);
    trunk.fillRect(6, 0, 5, SEGMENT_HEIGHT);
    trunk.fillRect(TRUNK_WIDTH - 11, 0, 5, SEGMENT_HEIGHT);
    trunk.fillRect(TRUNK_WIDTH / 2 - 2, 0, 4, SEGMENT_HEIGHT);
    trunk.fillStyle(0xa06a35, 1);
    trunk.fillRect(16, 0, 6, SEGMENT_HEIGHT);
    trunk.fillRect(TRUNK_WIDTH - 26, 0, 6, SEGMENT_HEIGHT);
    // Сучок.
    trunk.fillStyle(0x5b3a18, 1);
    trunk.fillCircle(TRUNK_WIDTH / 2 + 12, SEGMENT_HEIGHT / 2, 5);
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
    // Солнце.
    this.add.circle(830, 90, 34, 0xfde68a);
    this.add.circle(830, 90, 44, 0xfde68a, 0.35);
    // Дальние ёлки.
    for (let i = 0; i < 10; i += 1) {
      const x = 40 + i * 96 + (i % 2 === 0 ? 12 : -10);
      const y = 430;
      const s = i % 2 === 0 ? 1 : 0.75;
      this.add.triangle(x, y - 60 * s, 0, 60 * s, 60 * s, 60 * s, 30 * s, 0, 0x2d6a4f);
      this.add.triangle(x, y - 95 * s, 0, 50 * s, 50 * s, 50 * s, 25 * s, 0, 0x35795b);
      this.add.rectangle(x, y - 8, 12, 20, 0x5b3a18);
    }
    // Земля из «текстуры».
    this.add.tileSprite(480, 570, 960, 140, 'ground');
    this.add.rectangle(480, 502, 960, 8, 0x4a7c59);
  }

  // ---------- Дерево ----------

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
      return { branch: Math.random() < 0.5 ? 'left' : 'right', forester: true };
    }
    const chance = Math.min(
      BRANCH_CHANCE_START + this.rescued * BRANCH_CHANCE_STEP,
      BRANCH_CHANCE_MAX,
    );
    const roll = Math.random();
    if (roll < chance / 2) return { branch: 'left', forester: false };
    if (roll < chance) return { branch: 'right', forester: false };
    return { branch: 'none', forester: false };
  }

  /** Маленькая фигурка лесника (тело, голова, каска). */
  private makeForesterFigure(scale: number): Phaser.GameObjects.Container {
    const f = this.add.container(0, 0);
    f.add(this.add.rectangle(0, -16, 20, 30, 0x15803d));
    f.add(this.add.rectangle(0, -16, 20, 8, 0xfb923c));
    f.add(this.add.circle(0, -40, 11, 0xf2c89b));
    f.add(this.add.rectangle(0, -50, 22, 7, 0xb91c1c));
    f.setScale(scale);
    return f;
  }

  /** Перерисовывает весь ствол по массиву segments (низ → верх). */
  private refreshTree(): void {
    for (const obj of this.segmentObjs) obj.destroy();
    this.segmentObjs = [];

    for (let i = 0; i < this.segments.length; i += 1) {
      const seg = this.segments[i];
      const y = BASE_Y - i * SEGMENT_HEIGHT - SEGMENT_HEIGHT / 2;
      const c = this.add.container(TREE_X, y);
      c.setDepth(1);
      c.add(this.add.image(0, 0, 'trunk'));

      if (seg.branch === 'left' || seg.branch === 'right') {
        const dir = seg.branch === 'left' ? -1 : 1;
        const branch = this.add.rectangle(dir * (TRUNK_WIDTH / 2 + 55), -6, 110, 20, 0x6b421d);
        branch.setStrokeStyle(2, 0x3f2810);
        c.add(branch);
        c.add(this.add.circle(dir * (TRUNK_WIDTH / 2 + 108), -14, 22, 0x2d6a4f));
        c.add(this.add.circle(dir * (TRUNK_WIDTH / 2 + 94), -4, 14, 0x40916c));
        if (seg.forester) {
          // Лесник сидит на ветке + кричит SOS.
          const sitter = this.makeForesterFigure(1);
          sitter.setPosition(dir * (TRUNK_WIDTH / 2 + 72), -18);
          c.add(sitter);
          const sos = this.add.text(dir * (TRUNK_WIDTH / 2 + 72), -78, 'SOS!', {
            fontFamily: FONT,
            fontSize: '18px',
            color: '#fef08a',
            backgroundColor: '#111827cc',
            padding: { x: 6, y: 2 },
          });
          sos.setOrigin(0.5, 0.5);
          c.add(sos);
        }
      }
      if (i === this.segments.length - 1) {
        // Крона на верхушке.
        c.add(this.add.circle(-30, -SEGMENT_HEIGHT / 2 - 22, 34, 0x2d6a4f));
        c.add(this.add.circle(30, -SEGMENT_HEIGHT / 2 - 22, 34, 0x2d6a4f));
        c.add(this.add.circle(0, -SEGMENT_HEIGHT / 2 - 44, 44, 0x35795b));
      }
      // Нижний сегмент с лесником подсвечиваем стрелкой-подсказкой.
      if (i === 0 && seg.forester) {
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

  // ---------- Игрок ----------

  private buildPlayer(): void {
    const x = TREE_X - PLAYER_OFFSET_X;
    this.player = this.add.container(x, BASE_Y);
    this.player.setDepth(2);
    // Ноги.
    this.player.add(this.add.rectangle(-10, 52, 16, 26, 0x1f2937));
    this.player.add(this.add.rectangle(10, 52, 16, 26, 0x1f2937));
    // Тело в клетчатой рубахе (текстура plaid).
    this.player.add(this.add.image(0, 12, 'plaid'));
    // Голова + борода + шапка.
    this.player.add(this.add.circle(0, -30, 20, 0xf2c89b));
    this.player.add(this.add.rectangle(0, -16, 28, 16, 0x5b3a18));
    this.player.add(this.add.rectangle(0, -46, 40, 12, 0x166534));
    this.player.add(this.add.rectangle(0, -54, 30, 12, 0x15803d));
    // Топор целиком (рукоять + головка) в одном контейнере — крутится вместе.
    this.axe = this.add.container(0, 0);
    this.axe.add(this.add.rectangle(34, -6, 10, 46, 0x92400e));
    this.axe.add(this.add.rectangle(34, -26, 34, 12, 0x9ca3af));
    this.axe.add(this.add.rectangle(34, -26, 34, 4, 0x6b7280));
    this.player.add(this.axe);
  }

  private movePlayer(): void {
    const x = this.playerSide === 'left' ? TREE_X - PLAYER_OFFSET_X : TREE_X + PLAYER_OFFSET_X;
    this.player.setX(x);
    this.player.scaleX = this.playerSide === 'left' ? 1 : -1;
  }

  // ---------- HUD ----------

  private buildHud(): void {
    this.add.rectangle(480, 34, 960, 68, 0x111827, 0.85).setDepth(19);
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
      color: COLOR_MUTED,
    });
    this.progressText.setOrigin(0.5, 0);
    this.hintText = this.add.text(
      480,
      604,
      '← / A — слева   |   → / D — справа   |   лесник сидит на ветке: руби и не стой под ней! 🪵',
      { fontFamily: FONT, fontSize: '16px', color: COLOR_TEXT, backgroundColor: '#111827aa', padding: { x: 10, y: 6 } },
    );
    this.hintText.setOrigin(0.5, 0.5);
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
    this.progressText.setText(`рубок: ${this.chops}   •   лесник через: ${dist}   •   рекорд: ${best} 🏆`);
  }

  // ---------- Шкала бездействия ----------

  /** Полоса «РУБИ!» под HUD: появляется при простое, пустеет к штрафу. */
  private buildIdleBar(): void {
    this.idleBox = this.add.container(480, 96).setDepth(20).setVisible(false);
    const bg = this.add.rectangle(0, 0, IDLE_BAR_WIDTH + 12, 40, 0x111827, 0.9);
    const frame = this.add.rectangle(0, 8, IDLE_BAR_WIDTH, 12, 0x334155);
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

  private buildOverlay(): void {
    this.overlay = this.add.container(480, 300).setVisible(false).setDepth(30);
    const bg = this.add.rectangle(0, 0, 640, 300, 0x111827, 0.95);
    bg.setStrokeStyle(3, 0x334155);
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
    const restartHint = this.add.text(0, 110, 'Нажми R или кликни, чтобы играть снова', {
      fontFamily: FONT,
      fontSize: '19px',
      color: COLOR_MUTED,
    });
    restartHint.setOrigin(0.5, 0.5);
    this.overlay.add([bg, this.overlayTitle, this.overlayStats, restartHint]);
  }

  // ---------- Ввод ----------

  private bindInput(): void {
    const kb = this.input.keyboard;
    if (!kb) throw new Error('Keyboard input is unavailable.');
    kb.on('keydown-LEFT', () => this.chop('left'));
    kb.on('keydown-A', () => this.chop('left'));
    kb.on('keydown-RIGHT', () => this.chop('right'));
    kb.on('keydown-D', () => this.chop('right'));
    kb.on('keydown-R', () => {
      if (!this.playing) this.scene.restart();
    });
    // Клик/тап: левая половина — рубить слева, правая — справа.
    // После конца игры клик = рестарт.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.playing) {
        this.scene.restart();
        return;
      }
      this.chop(pointer.x < TREE_X ? 'left' : 'right');
    });
  }

  // ---------- Главный удар ----------

  private chop(side: Side): void {
    if (!this.playing || this.time.now < this.stunnedUntil) return;
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
      const f = this.makeForesterFigure(0.9);
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
