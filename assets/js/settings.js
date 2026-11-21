const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export class SettingsUI {
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.language = 'zh';
    this.running = true;
    this.speed = 'fast';
    this.locked = false;
    this.wheel = null;

    root.dataset.lang = 'zh';
    this.rows = [...root.querySelectorAll('.wheel-row')];
    this.langButtons = [...root.querySelectorAll('.lang-opt')];
    this.runButtons = [...root.querySelectorAll('[data-run]')];
    this.speedButtons = [...root.querySelectorAll('[data-speed]')];
    this.count = root.querySelector('#news-count');

    this.onClick = this.onClick.bind(this);
    root.addEventListener('click', this.onClick);

    this.applyRows('zh');
    this.setState({ language: 'zh', running: true, speed: 'fast' });
  }

  onClick(event) {
    if (this.locked) return;
    const button = event.target.closest('button');
    if (!button || !this.root.contains(button)) return;

    if (button.dataset.lang) {
      if (button.dataset.lang === this.language) return;
      this.callbacks.onLanguage?.(button.dataset.lang);
      return;
    }
    if (button.dataset.run != null) {
      this.callbacks.onRun?.(button.dataset.run === '1');
      return;
    }
    if (button.dataset.speed) {
      this.callbacks.onSpeed?.(button.dataset.speed);
    }
  }

  setState({ language, running, speed, count }) {
    if (language) this.language = language;
    if (typeof running === 'boolean') this.running = running;
    if (speed) this.speed = speed;

    if (typeof count === 'number') {
      this.count.textContent = String(count);
    }

    this.langButtons.forEach((button) => {
      const isOn = button.dataset.lang === this.language;
      button.classList.toggle('is-on', isOn);
      button.setAttribute('aria-pressed', String(isOn));
    });

    this.runButtons.forEach((button) => {
      const isOn = (button.dataset.run === '1') === this.running;
      button.classList.toggle('is-on', isOn);
      button.setAttribute('aria-pressed', String(isOn));
    });

    this.speedButtons.forEach((button) => {
      const isOn = button.dataset.speed === this.speed;
      button.classList.toggle('is-on', isOn);
      button.setAttribute('aria-pressed', String(isOn));
    });
  }

  setLanguageVisual(language) {
    this.langButtons.forEach((button) => {
      const isOn = button.dataset.lang === language;
      button.classList.toggle('is-on', isOn);
      button.setAttribute('aria-pressed', String(isOn));
    });
  }

  setCount(count) {
    this.count.textContent = String(count);
  }

  setLocked(locked) {
    this.locked = locked;
    this.root.classList.toggle('is-locked', locked);
    this.root.setAttribute('aria-busy', String(locked));
    this.root.inert = locked;
  }

  startLanguageSwitch(from, to, uiNow) {
    this.wheel = {
      from,
      to,
      start: uiNow,
      duration: 420,
    };
    this.setLanguageVisual(to);
    this.applyRows(from, 0);
  }

  tick(uiNow) {
    if (!this.wheel) return;
    const { from, to, start, duration } = this.wheel;
    const p = clamp((uiNow - start) / duration, 0, 1);
    const eased = smoothstep(0, 1, p);

    for (const row of this.rows) {
      const rowLang = row.dataset.rowLang;
      if (rowLang === from) {
        const opacity = 1 - smoothstep(0, 0.55, p);
        row.style.transform = `translateY(${eased * 0.4}em) rotateX(${-90 * eased}deg)`;
        row.style.opacity = String(opacity);
      } else if (rowLang === to) {
        const enter = smoothstep(0.32, 1, p);
        row.style.transform = `translateY(${(1 - eased) * -0.4}em) rotateX(${90 * (1 - eased)}deg)`;
        row.style.opacity = String(enter);
      }
    }

    if (p >= 1) {
      this.finishLanguageSwitch(to);
    }
  }

  finishLanguageSwitch(language) {
    this.wheel = null;
    this.language = language;
    this.root.dataset.lang = language;
    this.applyRows(language);
    this.setLanguageVisual(language);
  }

  applyRows(language, p = 1) {
    for (const row of this.rows) {
      const isActive = row.dataset.rowLang === language;
      row.classList.toggle('is-active-row', isActive);
      row.inert = !isActive;
      row.setAttribute('aria-hidden', String(!isActive));
      if (isActive) {
        row.style.transform = 'translateY(0) rotateX(0deg)';
        row.style.opacity = '1';
      } else {
        row.style.transform = `translateY(${-0.4 * (1 - p)}em) rotateX(90deg)`;
        row.style.opacity = '0';
      }
    }
  }
}
