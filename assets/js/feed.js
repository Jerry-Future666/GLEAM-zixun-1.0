const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3);

export class FeedController {
  constructor({ viewport, list, onOpen }) {
    this.viewport = viewport;
    this.list = list;
    this.onOpen = onOpen;

    this.language = 'zh';
    this.cards = [];
    this.reservation = null;
    this.entry = null;
    this.exiting = false;
    this.exitStart = 0;
    this.exitDone = false;
    this.exitList = [];
    this.recentering = null;
    this.touching = false;
    this.mouseInside = false;
    this.lastInteraction = 0;
    this.uiNow = 0;
    this.motionNow = 0;
    this.maxCards = 42;
    this.programmaticScroll = false;
    this.programmaticUntil = 0;

    this.tick = this.tick.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.onPointerEnter = this.onPointerEnter.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.onScroll = this.onScroll.bind(this);

    this.bindScrollEvents();
  }

  setLanguage(language) {
    this.language = language;
  }

  cardHeight() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--card-h');
    return parseFloat(raw) || 64;
  }

  cardGap() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--card-gap');
    return parseFloat(raw) || 8;
  }

  atLatest() {
    return this.viewport.scrollTop <= 3;
  }

  markInteraction() {
    this.lastInteraction = this.uiNow;
    this.recentering = null;
  }

  bindScrollEvents() {
    this.viewport.addEventListener('wheel', this.onWheel, { passive: true });
    this.viewport.addEventListener('touchstart', this.onTouchStart, { passive: true });
    this.viewport.addEventListener('touchend', this.onTouchEnd, { passive: true });
    this.viewport.addEventListener('touchcancel', this.onTouchEnd, { passive: true });
    this.viewport.addEventListener('pointerenter', this.onPointerEnter, { passive: true });
    this.viewport.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    this.viewport.addEventListener('scroll', this.onScroll, { passive: true });
  }

  onWheel() {
    this.markInteraction();
  }

  onTouchStart() {
    this.touching = true;
    this.markInteraction();
  }

  onTouchEnd() {
    this.touching = false;
    this.markInteraction();
  }

  onPointerEnter() {
    this.mouseInside = true;
    this.markInteraction();
  }

  onPointerLeave() {
    this.mouseInside = false;
    this.markInteraction();
  }

  onScroll() {
    if (this.programmaticScroll || performance.now() < this.programmaticUntil) {
      return;
    }
    if (this.viewport.scrollTop > 3) {
      this.markInteraction();
    }
  }

  setProgrammaticScroll(value) {
    this.programmaticScroll = value;
    if (value) {
      this.programmaticUntil = performance.now() + 120;
    }
  }

  reserve(mission, motionNow) {
    if (this.reservation || this.entry || this.exiting) return false;
    const slot = document.createElement('div');
    slot.className = 'card-slot';
    slot.dataset.missionId = mission.id;
    slot.style.height = '0px';
    this.list.insertBefore(slot, this.list.firstChild);
    this.reservation = {
      mission,
      slot,
      start: motionNow,
      target: this.cardHeight() + this.cardGap(),
      lastHeight: 0,
    };
    return true;
  }

  cancelReservation() {
    if (!this.reservation) return;
    const { slot, lastHeight } = this.reservation;
    const wasScrolled = this.viewport.scrollTop > 3;
    slot.remove();
    if (wasScrolled && lastHeight > 0) {
      this.viewport.scrollTop = Math.max(0, this.viewport.scrollTop - lastHeight);
    }
    this.reservation = null;
  }

  commit(mission, motionNow) {
    if (!this.reservation || this.reservation.mission.id !== mission.id) {
      // The slot may have been cancelled; create a card directly at the top.
      if (this.entry || this.exiting) return false;
    }

    const card = this.createCard(mission);
    if (this.reservation && this.reservation.slot.isConnected) {
      this.reservation.slot.replaceWith(card);
    } else {
      this.list.insertBefore(card, this.list.firstChild);
    }
    this.reservation = null;
    this.cards.unshift(card);
    this.trimCards();

    this.entry = {
      mission,
      card,
      start: motionNow,
      duration: 260,
    };
    card.style.opacity = '0';
    card.style.transform = 'translate3d(112%, 0, 0)';
    return true;
  }

  createCard(mission) {
    const story = mission.story;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'news-card';
    card.dataset.storyId = story.id;
    card.dataset.missionId = mission.id;

    const bullet = document.createElement('span');
    bullet.className = 'card-bullet';
    bullet.setAttribute('aria-hidden', 'true');

    const title = document.createElement('span');
    title.className = 'card-title';
    const text = story.title[this.language] || story.title.zh || story.title.en;
    title.textContent = text;

    const arrow = document.createElement('span');
    arrow.className = 'card-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';

    card.append(bullet, title, arrow);
    card.setAttribute('aria-label', text);
    card.addEventListener('click', () => {
      if (this.entry && this.entry.card === card) return;
      if (this.exiting) return;
      this.onOpen(story.id);
    });
    return card;
  }

  trimCards() {
    while (this.cards.length > this.maxCards) {
      const oldest = this.cards.pop();
      if (oldest) oldest.remove();
    }
  }

  finishEntry() {
    if (!this.entry) return;
    const { card } = this.entry;
    card.style.transform = '';
    card.style.opacity = '';
    card.classList.add('is-settled');
    this.entry = null;
  }

  isEntering() {
    return this.entry != null;
  }

  isBusy() {
    return this.reservation != null || this.entry != null || this.exiting;
  }

  isExitDone() {
    return this.exitDone && !this.exiting;
  }

  getExitDuration() {
    const count = this.cards.length;
    if (count === 0) return 0;
    return (count - 1) * 70 + 260;
  }

  startExit(uiNow) {
    if (this.exiting) return;
    this.cancelReservation();
    this.finishEntry();
    this.exiting = true;
    this.exitDone = false;
    this.exitStart = uiNow;
    this.exitList = [...this.cards];
    if (this.exitList.length === 0) {
      this.exiting = false;
      this.exitDone = true;
      return;
    }
    for (const card of this.exitList) {
      card.classList.remove('is-settled');
      card.style.transition = 'none';
    }
  }

  clear() {
    this.list.replaceChildren();
    this.cards = [];
    this.reservation = null;
    this.entry = null;
    this.exiting = false;
    this.exitDone = false;
    this.exitList = [];
    this.recentering = null;
    this.touching = false;
    this.lastInteraction = this.uiNow;
    this.viewport.scrollTop = 0;
  }

  tick({ motionNow, uiNow, phase }) {
    this.motionNow = motionNow;
    this.uiNow = uiNow;

    if (this.reservation) {
      const reservation = this.reservation;
      const duration = 140;
      const p = clamp((motionNow - reservation.start) / duration, 0, 1);
      const eased = easeOutCubic(p);
      const height = reservation.target * eased;
      const delta = height - reservation.lastHeight;
      if (delta > 0.01 && this.viewport.scrollTop > 3) {
        this.setProgrammaticScroll(true);
        this.viewport.scrollTop += delta;
        this.setProgrammaticScroll(false);
      }
      reservation.slot.style.height = `${height}px`;
      reservation.lastHeight = height;
    }

    if (this.entry) {
      const p = clamp(
        (motionNow - this.entry.start) / this.entry.duration,
        0,
        1
      );
      const eased = easeOutCubic(p);
      const x = (1 - eased) * 112;
      this.entry.card.style.transform = `translate3d(${x}%, 0, 0)`;
      this.entry.card.style.opacity = String(clamp(p * 1.8, 0, 1));
      if (p >= 1) {
        this.finishEntry();
      }
    }

    if (this.exiting) {
      const direction = window.matchMedia('(min-width: 900px)').matches ? 1 : -1;
      let allDone = true;
      for (let i = 0; i < this.exitList.length; i += 1) {
        const card = this.exitList[i];
        if (!card.isConnected) continue;
        const p = clamp((uiNow - this.exitStart - i * 70) / 260, 0, 1);
        const eased = easeOutCubic(p);
        card.style.transform = `translate3d(${direction * 112 * eased}%, 0, 0)`;
        card.style.opacity = String(1 - p);
        if (p < 1) allDone = false;
      }
      if (allDone && uiNow >= this.exitStart + this.getExitDuration()) {
        this.exiting = false;
        this.exitDone = true;
      }
    }

    if (!this.exiting && !this.touching && this.viewport.scrollTop > 3) {
      if (this.recentering) {
        const p = clamp((uiNow - this.recentering.start) / 320, 0, 1);
        const eased = easeOutCubic(p);
        this.setProgrammaticScroll(true);
        this.viewport.scrollTop = this.recentering.from * (1 - eased);
        this.setProgrammaticScroll(false);
        if (p >= 1) {
          this.recentering = null;
          this.setProgrammaticScroll(true);
          this.viewport.scrollTop = 0;
          this.setProgrammaticScroll(false);
        }
      } else if (uiNow - this.lastInteraction > 1500) {
        this.recentering = {
          start: uiNow,
          from: this.viewport.scrollTop,
        };
      }
    }
  }
}
