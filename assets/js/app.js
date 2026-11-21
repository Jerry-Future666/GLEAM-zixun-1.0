import { GlobeRenderer } from './globe.js';
import { FeedController } from './feed.js';
import { SettingsUI } from './settings.js';
import { ArticleView } from './article.js';
import { Director } from './director.js';

const $ = (selector) => document.querySelector(selector);

const home = $('#home');
const canvas = $('#globe-canvas');
const settingsEl = $('#settings');
const brandSub = $('#brand-sub');
const feedPanel = $('#feed-panel');
const feedTitle = $('#feed-title');
const feedViewport = $('#feed-viewport');
const feedList = $('#feed-list');
const loadError = $('#load-error');
const countGroup = $('#news-count')?.closest('.count-group');

const articlePage = $('#article-page');
const articleScroll = $('#article-scroll');
const articleTitle = $('#article-title');
const articleBody = $('#article-body');
const backButton = $('#back-btn');
const themeButton = $('#theme-btn');

const appRoot = $('#app');
const app = {
  stories: [],
  cities: [],
  director: null,
  article: null,
  currentArticleId: null,
};

function parseArticleId() {
  const match = window.location.hash.match(/^#\/article\/([^/?#]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function getStory(id) {
  return app.stories.find((story) => story.id === id) || null;
}

function setDocumentLanguage(language) {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
}

function applyLanguage(language) {
  const isZh = language === 'zh';
  setDocumentLanguage(language);
  appRoot.dataset.lang = language;
  brandSub.textContent = isZh ? '恒熠聚声 · 资讯' : 'GLEAM · DISPATCHES';
  feedTitle.textContent = isZh ? '资讯' : 'NEWS';
  feedPanel.setAttribute('aria-label', isZh ? '资讯列表' : 'News list');
  settingsEl.setAttribute('aria-label', isZh ? '显示设置' : 'Display settings');
  countGroup?.setAttribute('aria-label', isZh ? '资讯总数' : 'Total stories');
  canvas.setAttribute(
    'aria-label',
    isZh
      ? '旋转中的金色地球，信息线连接不同大陆'
      : 'A rotating gold globe with signal lines connecting continents'
  );
  if (!app.article?.isOpen) {
    document.title = isZh ? '资讯 · 恒熠聚声 GLEAM' : 'News · GLEAM';
    if (app.article) app.article.defaultTitle = document.title;
  }
  app.article?.setLanguage?.(language);
}

function openArticle(id, { push = true } = {}) {
  const story = getStory(id);
  if (!story || !app.director) return false;
  if (app.currentArticleId === id) return true;
  if (!app.director.suspendForArticle()) return false;

  if (push) {
    window.history.pushState({ gleamArticle: id }, '', `#/article/${encodeURIComponent(id)}`);
  }
  app.currentArticleId = id;
  home.inert = true;
  app.article.open(story, app.director.language);
  return true;
}

function closeArticleView() {
  if (!app.article || !app.article.isOpen) return;
  home.inert = false;
  app.article.close();
  app.currentArticleId = null;
  app.director.resumeFromArticle();
}

function backFromArticle() {
  if (window.history.state && window.history.state.gleamArticle) {
    window.history.back();
    return;
  }
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  closeArticleView();
}

function syncRoute() {
  const id = parseArticleId();
  if (!id) {
    if (app.article && app.article.isOpen) {
      closeArticleView();
    }
    return;
  }

  if (app.article && app.article.isOpen && app.currentArticleId === id) {
    return;
  }
  if (app.article && app.article.isOpen) {
    app.article.close();
    app.currentArticleId = null;
    app.director.resumeFromArticle();
  }
  openArticle(id, { push: false });
}

async function loadJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`${path} 加载失败（${response.status}）`);
  }
  return response.json();
}

async function bootApp() {
  try {
    const [land, news, cityData] = await Promise.all([
      loadJson('assets/data/natural-earth-110m.geojson'),
      loadJson('assets/data/news.json'),
      loadJson('assets/data/cities.json'),
    ]);

    if (!news || !Array.isArray(news.stories) || news.stories.length === 0) {
      throw new Error('资讯数据为空');
    }
    if (!cityData || !Array.isArray(cityData.cities) || cityData.cities.length === 0) {
      throw new Error('城市数据为空');
    }
    app.stories = news.stories;
    app.cities = cityData.cities;

    const globe = new GlobeRenderer(canvas);
    globe.setLand(land);
    globe.resize();

    const feed = new FeedController({
      viewport: feedViewport,
      list: feedList,
      onOpen: (id) => openArticle(id),
    });

    const settings = new SettingsUI(settingsEl, {
      onLanguage: (language) => {
        app.director.startLanguage(language);
      },
      onRun: (running) => app.director.setRunning(running),
      onSpeed: (speed) => app.director.setSpeed(speed),
    });

    app.article = new ArticleView({
      page: articlePage,
      scroll: articleScroll,
      title: articleTitle,
      body: articleBody,
      backButton,
      themeButton,
      onBack: backFromArticle,
    });

    app.director = new Director({
      globe,
      feed,
      settings,
      stories: app.stories,
      cities: app.cities,
      land,
      onLanguageApplied: applyLanguage,
    });
    app.director.prime();
    applyLanguage('zh');

    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && app.article?.isOpen) {
        backFromArticle();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && app.director) {
        app.director.lastTs = null;
      }
    });

    requestAnimationFrame(() => {
      app.director.start();
      syncRoute();
    });
  } catch (error) {
    console.error(error);
    if (loadError) {
      loadError.hidden = false;
      loadError.textContent =
        window.location.protocol === 'file:'
          ? '请通过本地服务器或 GitHub Pages 打开'
          : '数据加载失败，请刷新页面';
    }
  }
}

bootApp();
