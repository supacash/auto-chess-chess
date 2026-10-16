import { clearTips } from '../game/storage';
import { $ } from './dom';
import { settings, updateSettings } from './settings';
import { setSoundOn, sfx, soundOn, volumeChanged } from './sound';

/** The Settings screen, from the main menu: sound, battle speed, reduced motion, piece explanations, tips and About. */
export class SettingsScreen {
  private readonly section = $('#settings');
  private readonly sound = $<HTMLInputElement>('#set-sound');
  private readonly volume = $<HTMLInputElement>('#set-volume');
  private readonly motion = $<HTMLInputElement>('#set-motion');
  private readonly pieceInfo = $<HTMLInputElement>('#set-piece-info');

  constructor(onBack: () => void) {
    this.sound.addEventListener('change', () => {
      setSoundOn(this.sound.checked);
      sfx('select');
      this.render();
    });
    // While dragging the volume shows; letting go plays a sound at the new level.
    this.volume.addEventListener('input', () => {
      updateSettings({ volume: Number(this.volume.value) });
      volumeChanged();
      this.render();
    });
    this.volume.addEventListener('change', () => sfx('place'));
    $('#set-speed').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-speed]');
      if (!btn) return;
      updateSettings({ speed: Number(btn.dataset.speed) });
      sfx('select');
      this.render();
    });
    this.motion.addEventListener('change', () => {
      updateSettings({ reduceMotion: this.motion.checked });
      this.render();
    });
    this.pieceInfo.addEventListener('change', () => {
      updateSettings({ pieceInfo: this.pieceInfo.checked });
      this.render();
    });
    $('#set-tips').addEventListener('click', () => {
      clearTips();
      sfx('select');
      $<HTMLButtonElement>('#set-tips').disabled = true;
      $('#set-tips-note').textContent = 'Tips will show again as you play.';
    });
    $('#settings-back').addEventListener('click', onBack);
  }

  show(): void {
    this.section.hidden = false;
    $<HTMLButtonElement>('#set-tips').disabled = false;
    $('#set-tips-note').textContent = 'Show the first-game tips again.';
    this.render();
  }

  hide(): void {
    this.section.hidden = true;
  }

  private render(): void {
    const s = settings();
    this.sound.checked = soundOn();
    this.volume.value = String(s.volume);
    this.volume.disabled = !soundOn();
    $('#set-volume-value').textContent = `${s.volume}%`;
    for (const btn of document.querySelectorAll<HTMLButtonElement>('#set-speed button')) {
      const active = Number(btn.dataset.speed) === s.speed;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
    }
    this.motion.checked = s.reduceMotion;
    this.pieceInfo.checked = s.pieceInfo;
  }
}
