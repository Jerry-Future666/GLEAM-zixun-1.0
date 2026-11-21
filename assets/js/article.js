export class ArticleView {
  constructor({ page, scroll, title, body, backButton, themeButton, onBack }) {
    this.page = page;
    this.scroll = scroll;
    this.titleEl = title;
    this.bodyEl = body;
    this.backButton = backButton;
    this.themeButton = themeButton;
    this.onBack = onBack;

    this.language = 'zh';
    this.theme = 'dark';
    this.isOpen = false;
    this.defaultTitle = document.title;
    this.returnFocus = null;

    this.page.dataset.theme = this.theme;
    this.backButton.addEventListener('click', () => this.onBack?.());
    this.themeButton.addEventListener('click', () => this.toggleTheme());
    this.updateThemeButton();
  }

  open(story, language) {
    this.language = language;
    this.setLanguage(language);
    this.returnFocus = document.activeElement;
    const title = story.title[language] || story.title.zh || story.title.en || '';
    const paragraphs =
      story.body[language] || story.body.zh || story.body.en || [];

    this.titleEl.textContent = title;
    this.bodyEl.replaceChildren();
    for (const text of paragraphs) {
      const p = document.createElement('p');
      p.textContent = text;
      this.bodyEl.appendChild(p);
    }

    this.page.classList.add('is-open');
    this.page.setAttribute('aria-hidden', 'false');
    this.scroll.scrollTop = 0;
    this.isOpen = true;
    this.setTheme(this.theme);
    document.title = `${title} · 恒熠聚声 GLEAM`;
    this.backButton.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.page.classList.remove('is-open');
    this.page.setAttribute('aria-hidden', 'true');
    document.title = this.defaultTitle;
    if (this.returnFocus && this.returnFocus.isConnected) {
      this.returnFocus.focus({ preventScroll: true });
    }
    this.returnFocus = null;
  }

  setLanguage(language) {
    this.language = language;
    if (this.backButton) {
      this.backButton.setAttribute(
        'aria-label',
        language === 'zh' ? '返回资讯列表' : 'Back to news'
      );
    }
    this.updateThemeButton();
  }

  toggleTheme() {
    this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
  }

  setTheme(theme) {
    this.theme = theme;
    this.page.dataset.theme = theme;
    this.updateThemeButton();
  }

  updateThemeButton() {
    const isLight = this.theme === 'light';
    const isZh = this.language === 'zh';
    this.themeButton.setAttribute('aria-pressed', String(isLight));
    this.themeButton.setAttribute(
      'aria-label',
      isZh
        ? isLight
          ? '切换到深色模式'
          : '切换到浅色模式'
        : isLight
          ? 'Switch to dark mode'
          : 'Switch to light mode'
    );
  }
}
