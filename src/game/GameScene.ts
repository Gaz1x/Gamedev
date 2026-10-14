import Phaser from 'phaser';
import { DIALOGUE } from './dialogue';

/** Сколько терпения у лорда: ответы с минусом тратят его. */
const MAX_PATIENCE = 6;
/** Сколько заложников нужно выкупить для победы. */
const HOSTAGES_TOTAL = 5;
/** Сколько миллисекунд показывается ответ лорда перед следующим ходом. */
const FEEDBACK_DELAY_MS = 1400;

const TEXT_COLOR = '#f8fafc';
const MUTED_COLOR = '#94a3b8';
const GOOD_COLOR = '#4ade80';
const BAD_COLOR = '#f87171';

const FONT = 'system-ui, sans-serif';

/**
 * Игра «Переговорщик».
 *
 * Игрок читает реплику лорда и выбирает ответ (мышью или клавишами 1/2/3).
 * Хорошие ответы повышают терпение лорда и освобождают заложников,
 * грубые тратят терпение. Цель — освободить всех, пока терпение не кончилось.
 */
export class GameScene extends Phaser.Scene {
  private turnIndex = 0;
  private patience = MAX_PATIENCE;
  private freed = 0;

  private patienceText!: Phaser.GameObjects.Text;
  private freedText!: Phaser.GameObjects.Text;
  private lordText!: Phaser.GameObjects.Text;
  private feedbackText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private choiceBoxes: Phaser.GameObjects.Rectangle[] = [];
  private choiceLabels: Phaser.GameObjects.Text[] = [];
  private keys!: Record<'one' | 'two' | 'three' | 'restart', Phaser.Input.Keyboard.Key>;
  private locked = false;
  private gameOver = false;

  constructor() {
    super('GameScene');
  }

  create(): void {
    const { width } = this.scale;

    // При рестарте (R) Phaser вызывает create() на том же экземпляре сцены,
    // поэтому состояние сбрасываем руками, а не полагаемся на инициализаторы полей.
    this.turnIndex = 0;
    this.patience = MAX_PATIENCE;
    this.freed = 0;
    this.locked = false;
    this.gameOver = false;
    this.choiceBoxes = [];
    this.choiceLabels = [];

    this.add
      .text(width / 2, 20, 'ПЕРЕГОВОРЩИК', {
        fontFamily: FONT,
        fontSize: '30px',
        color: TEXT_COLOR,
      })
      .setOrigin(0.5, 0);

    this.patienceText = this.add.text(24, 66, '', {
      fontFamily: FONT,
      fontSize: '22px',
      color: TEXT_COLOR,
    });
    this.freedText = this.add.text(width - 24, 66, '', {
      fontFamily: FONT,
      fontSize: '22px',
      color: TEXT_COLOR,
    });
    this.freedText.setOrigin(1, 0);

    this.lordText = this.add.text(width / 2, 130, '', {
      fontFamily: FONT,
      fontSize: '24px',
      color: TEXT_COLOR,
      align: 'center',
      wordWrap: { width: width - 120 },
    });
    this.lordText.setOrigin(0.5, 0);

    this.buildChoices();

    this.feedbackText = this.add.text(width / 2, 480, '', {
      fontFamily: FONT,
      fontSize: '22px',
      color: TEXT_COLOR,
      align: 'center',
      wordWrap: { width: width - 120 },
    });
    this.feedbackText.setOrigin(0.5, 0);

    this.hintText = this.add.text(width / 2, 576, 'Клик мышью или клавиши 1 / 2 / 3 — ответить', {
      fontFamily: FONT,
      fontSize: '18px',
      color: MUTED_COLOR,
    });
    this.hintText.setOrigin(0.5, 0);

    if (!this.input.keyboard) {
      throw new Error('Keyboard input is unavailable.');
    }

    this.keys = {
      one: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      two: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      three: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      restart: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R),
    };

    this.keys.one.on('down', () => this.choose(0));
    this.keys.two.on('down', () => this.choose(1));
    this.keys.three.on('down', () => this.choose(2));
    this.keys.restart.on('down', () => {
      if (this.gameOver) this.scene.restart();
    });

    this.showTurn();
  }

  /** Создаёт три одинаковых блока вариантов ответа. */
  private buildChoices(): void {
    const { width } = this.scale;
    const boxWidth = width - 120;
    const boxHeight = 74;
    const startY = 250;
    const gap = 12;

    for (let i = 0; i < 3; i += 1) {
      const y = startY + i * (boxHeight + gap);
      const box = this.add
        .rectangle(width / 2, y, boxWidth, boxHeight, 0x1e293b)
        .setStrokeStyle(2, 0x334155)
        .setInteractive({ useHandCursor: true });

      const label = this.add
        .text(width / 2, y, '', {
          fontFamily: FONT,
          fontSize: '19px',
          color: TEXT_COLOR,
          align: 'center',
          wordWrap: { width: boxWidth - 60 },
        })
        .setOrigin(0.5, 0.5);

      box.on('pointerdown', () => this.choose(i));
      box.on('pointerover', () => {
        if (!this.locked && !this.gameOver) box.setFillStyle(0x334155);
      });
      box.on('pointerout', () => box.setFillStyle(0x1e293b));

      this.choiceBoxes.push(box);
      this.choiceLabels.push(label);
    }
  }

  /** Показывает текущий ход диалога и обновляет счётчики. */
  private showTurn(): void {
    const turn = DIALOGUE[this.turnIndex];

    this.locked = false;
    this.feedbackText.setText('');
    this.lordText.setText(turn.lord);
    this.setChoicesVisible(true);

    turn.choices.forEach((choice, i) => {
      this.choiceLabels[i].setText(`${i + 1}. ${choice.text}`);
    });

    this.updateCounters();
  }

  /** Обрабатывает ответ игрока: применяет эффект и показывает реакцию лорда. */
  private choose(index: number): void {
    if (this.locked || this.gameOver) return;

    const turn = DIALOGUE[this.turnIndex];
    const choice = turn.choices[index];

    this.locked = true;
    this.setChoicesVisible(false);

    this.patience = Phaser.Math.Clamp(this.patience + choice.patience, 0, MAX_PATIENCE);
    this.freed = Phaser.Math.Clamp(this.freed + choice.freed, 0, HOSTAGES_TOTAL);
    this.updateCounters();

    const effect = choice.freed > 0 ? ` +${choice.freed} заложник(ов)` : '';
    const mood = choice.patience >= 0 ? GOOD_COLOR : BAD_COLOR;
    this.feedbackText.setColor(mood).setText(`${choice.reply}${effect}`);

    this.time.delayedCall(FEEDBACK_DELAY_MS, () => this.advance());
  }

  /** Переход к следующему ходу или завершение игры. */
  private advance(): void {
    if (this.freed >= HOSTAGES_TOTAL) {
      this.endGame(true);
      return;
    }
    if (this.patience <= 0) {
      this.endGame(false);
      return;
    }

    this.turnIndex += 1;
    if (this.turnIndex >= DIALOGUE.length) {
      this.endGame(false);
      return;
    }

    this.showTurn();
  }

  /** Завершает игру: победа при освобождённых заложниках, иначе поражение. */
  private endGame(won: boolean): void {
    this.gameOver = true;
    this.setChoicesVisible(false);

    const headline = won ? 'СДЕЛКА ЗАКЛЮЧЕНА' : 'ПЕРЕГОВОРЫ СОРВАЛИСЬ';
    const color = won ? GOOD_COLOR : BAD_COLOR;

    this.lordText.setColor(color).setText(headline);
    this.feedbackText
      .setColor(TEXT_COLOR)
      .setText(`Выкуплено заложников: ${this.freed} из ${HOSTAGES_TOTAL}\nОстаток терпения лорда: ${this.patience}`);
    this.hintText.setText('Нажми R, чтобы начать переговоры заново');
  }

  private setChoicesVisible(visible: boolean): void {
    this.choiceBoxes.forEach((box) => box.setVisible(visible));
    this.choiceLabels.forEach((label) => label.setVisible(visible));
  }

  private updateCounters(): void {
    this.patienceText.setText(`Терпение лорда: ${this.patience} / ${MAX_PATIENCE}`);
    this.freedText.setText(`Свобождено: ${this.freed} / ${HOSTAGES_TOTAL}`);
  }
}
