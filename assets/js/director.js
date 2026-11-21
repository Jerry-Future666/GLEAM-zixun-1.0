import { clamp, isVisible } from './globe.js';

const d3 = window.d3;
const DEG = Math.PI / 180;

// Duration multiplier → motion-time scale. Slow must actually be slower.
const SPEED_SCALE = {
  fast: 1,
  medium: 1 / 1.45,
  slow: 0.5,
};

const T = {
  firstDelay: 600,
  launchDelay: 130,
  launchGap: 1050,
  maxActive: 3,
  travelMin: 1500,
  travelMax: 2300,
  cardRoom: 140,
  cardEnter: 260,
  arrivalHold: 500,
  lineHold: 1600,
  lineRetract: 1000,
  dotFade: 700,
  wheel: 420,
  langPause: 260,
  langIn: 170,
};

const CAMERA = {
  stiffness: 16,
  damping: 8,
  maxSpeed: 1.3, // radians / motion-second
  maxAccel: 5.5,
  ambientOffset: 0.04,
  maxSubstep: 0.016,
};

function length3(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize3(vector) {
  const length = length3(vector);
  if (length < 1e-9) return [0, 0, 1];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function lonLatToUnit([lon, lat]) {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lambda), cosPhi * Math.sin(lambda), Math.sin(phi)];
}

function unitToLonLat(vector) {
  const unit = normalize3(vector);
  return [
    Math.atan2(unit[1], unit[0]) / DEG,
    Math.asin(clamp(unit[2], -1, 1)) / DEG,
  ];
}

function eastTangent(forward) {
  const lon = Math.atan2(forward[1], forward[0]);
  return [-Math.sin(lon), Math.cos(lon), 0];
}

function wrapLon(lon) {
  return ((lon + 540) % 360) - 180;
}

function variedCenter([lon, lat]) {
  return [
    wrapLon(lon + (Math.random() * 2 - 1) * 12),
    clamp(lat + (Math.random() * 2 - 1) * 8, -68, 68),
  ];
}

function ambientTarget(forward, velocity) {
  // Continue in the current direction of travel, gently. This preserves
  // inertia after an arrival instead of braking to a dead stop.
  const speed = length3(velocity);
  const direction =
    speed > 1e-5 ? normalize3(velocity) : eastTangent(forward);
  return normalize3([
    forward[0] + direction[0] * CAMERA.ambientOffset,
    forward[1] + direction[1] * CAMERA.ambientOffset,
    forward[2] + direction[2] * CAMERA.ambientOffset,
  ]);
}

function springSubstep(forward, velocity, target, dt) {
  const targetDot = dot3(target, forward);

  // Tangential error: the component of the target direction across the sphere.
  let error = [
    target[0] - forward[0] * targetDot,
    target[1] - forward[1] * targetDot,
    target[2] - forward[2] * targetDot,
  ];

  if (length3(error) < 1e-7) {
    if (targetDot < 0) {
      // Antipodal target: pick a stable tangent so the camera does not lock up.
      const east = eastTangent(forward);
      error = [east[0] * 0.05, east[1] * 0.05, east[2] * 0.05];
    } else {
      // Keep existing inertia; never kill the camera's motion.
      return [forward, velocity];
    }
  }

  let accel = [
    error[0] * CAMERA.stiffness - velocity[0] * CAMERA.damping,
    error[1] * CAMERA.stiffness - velocity[1] * CAMERA.damping,
    error[2] * CAMERA.stiffness - velocity[2] * CAMERA.damping,
  ];

  const accelLength = length3(accel);
  if (accelLength > CAMERA.maxAccel) {
    const scale = CAMERA.maxAccel / accelLength;
    accel = [accel[0] * scale, accel[1] * scale, accel[2] * scale];
  }

  let nextVelocity = [
    velocity[0] + accel[0] * dt,
    velocity[1] + accel[1] * dt,
    velocity[2] + accel[2] * dt,
  ];

  const speed = length3(nextVelocity);
  if (speed > CAMERA.maxSpeed) {
    const scale = CAMERA.maxSpeed / speed;
    nextVelocity = [
      nextVelocity[0] * scale,
      nextVelocity[1] * scale,
      nextVelocity[2] * scale,
    ];
  }

  let nextForward = normalize3([
    forward[0] + nextVelocity[0] * dt,
    forward[1] + nextVelocity[1] * dt,
    forward[2] + nextVelocity[2] * dt,
  ]);

  // Remove any radial velocity so the camera stays on the sphere.
  const radial = dot3(nextVelocity, nextForward);
  nextVelocity = [
    nextVelocity[0] - nextForward[0] * radial,
    nextVelocity[1] - nextForward[1] * radial,
    nextVelocity[2] - nextForward[2] * radial,
  ];

  return [nextForward, nextVelocity];
}

function stepCamera(forward, velocity, target, dtSeconds) {
  const steps = Math.max(1, Math.min(6, Math.ceil(dtSeconds / CAMERA.maxSubstep)));
  const dt = dtSeconds / steps;
  let currentForward = forward;
  let currentVelocity = velocity;
  for (let i = 0; i < steps; i += 1) {
    [currentForward, currentVelocity] = springSubstep(
      currentForward,
      currentVelocity,
      target,
      dt
    );
  }
  return [currentForward, currentVelocity];
}

export class Director {
  constructor({
    globe,
    feed,
    settings,
    stories,
    cities = [],
    land = null,
    onLanguageApplied,
  }) {
    this.globe = globe;
    this.feed = feed;
    this.settings = settings;
    this.stories = stories;
    this.land = land;
    this.onLanguageApplied = onLanguageApplied;

    this.language = 'zh';
    this.speed = 'fast';
    this.phase = 'boot';
    this.motionTime = 0;
    this.uiTime = 0;
    this.lastTs = null;
    this.raf = null;
    this.started = false;

    this.missions = [];
    this.missionSeq = 0;
    this.cycle = 0;
    this.storyBag = [];
    this.bagCycle = 0;
    this.cityPool = (cities || []).filter(
      (city) =>
        Number.isFinite(city.lon) &&
        Number.isFinite(city.lat) &&
        (!land || d3.geoContains(land, [city.lon, city.lat]))
    );
    if (this.cityPool.length === 0) {
      this.cityPool = stories.map((story) => ({
        lon: story.route.from[0],
        lat: story.route.from[1],
      }));
    }
    this.lastRouteKey = '';
    this.nextRoute = this.generateRoute();
    this.refillStoryBag();
    this.trackedId = null;
    this.reserved = null;
    this.reservedReadyAt = 0;
    this.nextLaunchAt = T.firstDelay;

    this.cameraCenter = variedCenter(this.nextRoute.from);
    this.cameraForward = lonLatToUnit(this.cameraCenter);
    this.cameraVelocity = [0, 0, 0];
    this.cameraMode = 'ambient';
    this.holdUntil = 0;

    this.lang = {
      from: null,
      to: null,
      wasRunning: true,
      clickAt: 0,
      entryDoneAt: 0,
      inAt: 0,
    };

    this.phaseBeforeArticle = null;
    this.loop = this.loop.bind(this);
  }

  prime() {
    this.settings.setState({
      language: this.language,
      running: true,
      speed: this.speed,
      count: this.stories.length,
    });
    this.feed.setLanguage(this.language);
    this.render();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.phase = 'running';
    this.nextLaunchAt = T.firstDelay;
    this.settings.setState({ running: true });
    this.lastTs = null;
    this.raf = requestAnimationFrame(this.loop);
  }

  loop(ts) {
    const dtMs = this.lastTs == null ? 16.67 : clamp(ts - this.lastTs, 0, 48);
    this.lastTs = ts;

    if (this.phase !== 'article') {
      this.uiTime += dtMs;
      const speedScale = SPEED_SCALE[this.speed] || 1;
      const motionDtMs = dtMs * speedScale;
      this.motionTime += motionDtMs;

      this.updateMissions();
      this.updateCamera(motionDtMs / 1000);
      this.updateCards();
      this.feed.tick({
        motionNow: this.motionTime,
        uiNow: this.uiTime,
        phase: this.phase,
      });
      this.settings.tick(this.uiTime);
      this.updateLanguage();
      this.render();
    }

    this.raf = requestAnimationFrame(this.loop);
  }

  updateMissions() {
    if (this.phase === 'running' && this.motionTime >= this.nextLaunchAt) {
      const inFlight = this.missions.filter((mission) => !mission.arrived).length;
      if (inFlight < T.maxActive) {
        this.spawnMission();
      } else {
        this.nextLaunchAt = this.motionTime + 180;
      }
    }

    for (const mission of this.missions) {
      mission.progress = clamp(
        (this.motionTime - mission.launchAt) / mission.travel,
        0,
        1
      );
      mission.tracked = mission.id === this.trackedId;

      if (!mission.arrived && this.motionTime >= mission.arriveAt) {
        mission.arrived = true;
        mission.arrivedAt = mission.arriveAt;
        mission.progress = 1;
        mission.arrivalPulseAt = isVisible(
          mission.to[0],
          mission.to[1],
          this.cameraCenter,
          0.01
        )
          ? mission.arriveAt
          : null;
        mission.arrivalPulseShown = mission.arrivalPulseAt != null;

        // Stop means: finish the line, but never publish its card.
        if (this.phase !== 'running') {
          mission.cardState = 3;
        }
      }

      if (
        !mission.originPulseShown &&
        this.motionTime >= mission.startAt &&
        isVisible(mission.from[0], mission.from[1], this.cameraCenter, 0.01)
      ) {
        mission.originPulseAt = this.motionTime;
        mission.originPulseShown = true;
      }

      if (
        mission.arrived &&
        !mission.arrivalPulseShown &&
        isVisible(mission.to[0], mission.to[1], this.cameraCenter, 0.01)
      ) {
        mission.arrivalPulseAt = this.motionTime;
        mission.arrivalPulseShown = true;
      }
    }

    for (let i = this.missions.length - 1; i >= 0; i -= 1) {
      const mission = this.missions[i];
      if (
        this.motionTime > mission.removeAt &&
        mission.id !== this.trackedId
      ) {
        this.missions.splice(i, 1);
      }
    }

    if (
      this.phase === 'draining' &&
      this.missions.every((mission) => mission.arrived)
    ) {
      this.phase = 'stopped';
      this.nextLaunchAt = Infinity;
    }
  }

  refillStoryBag() {
    const indices = this.stories.map((_, index) => index);
    for (let i = indices.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    this.storyBag = indices;
    this.bagCycle += 1;
  }

  randomEndpoint() {
    const city = this.cityPool[Math.floor(Math.random() * this.cityPool.length)];

    // B: mostly real city points. C: sometimes a nearby random land point.
    // Deliberately not a uniform global distribution: wild points stay close
    // to the curated city pool and must pass the land polygon test.
    if (Math.random() >= 0.3) {
      return [city.lon, city.lat];
    }

    for (let attempt = 0; attempt < 14; attempt += 1) {
      const lon = wrapLon(city.lon + (Math.random() * 2 - 1) * 7);
      const lat = clamp(city.lat + (Math.random() * 2 - 1) * 5, -70, 70);
      const point = [lon, lat];
      if (!this.land || d3.geoContains(this.land, point)) {
        return point;
      }
    }
    return [city.lon, city.lat];
  }

  generateRoute() {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      let from = this.randomEndpoint();
      let to = this.randomEndpoint();
      const distance = d3.geoDistance(from, to);
      if (distance < 20 * DEG || distance > 140 * DEG) continue;

      if (Math.random() < 0.5) {
        [from, to] = [to, from];
      }
      const key = `${from[0].toFixed(2)},${from[1].toFixed(2)}>${to[0].toFixed(2)},${to[1].toFixed(2)}`;
      if (key === this.lastRouteKey) continue;
      this.lastRouteKey = key;
      return { from, to };
    }

    const fallbackA = this.cityPool[0];
    const fallbackB = this.cityPool[Math.floor(this.cityPool.length / 2)];
    return {
      from: [fallbackA.lon, fallbackA.lat],
      to: [fallbackB.lon, fallbackB.lat],
    };
  }

  spawnMission() {
    if (this.storyBag.length === 0) {
      this.refillStoryBag();
    }

    const storyIndex = this.storyBag.pop();
    const story = this.stories[storyIndex];
    const cycle = this.bagCycle;
    const route = this.nextRoute || this.generateRoute();
    this.nextRoute = null;
    this.missionSeq += 1;
    this.cycle = cycle;

    const from = [...route.from];
    const to = [...route.to];
    const angle = d3.geoDistance(from, to);
    const baseTravel = T.travelMin + (angle / Math.PI) * (T.travelMax - T.travelMin);
    const travel = clamp(
      baseTravel * (0.88 + Math.random() * 0.24),
      T.travelMin * 0.9,
      T.travelMax * 1.1
    );

    const startAt = this.motionTime;
    const launchAt = startAt + T.launchDelay;
    const arriveAt = launchAt + travel;
    const id = `${story.id}__${cycle}__${this.missionSeq}`;

    const mission = {
      id,
      story,
      from,
      to,
      startAt,
      launchAt,
      travel,
      arriveAt,
      retractAt: arriveAt + T.lineHold,
      retractDuration: T.lineRetract,
      dotFadeStart: arriveAt + T.lineHold + T.lineRetract,
      dotFadeDuration: T.dotFade,
      removeAt:
        arriveAt + T.lineHold + T.lineRetract + T.dotFade + 120,
      progress: 0,
      arrived: false,
      arrivedAt: null,
      originPulseAt: isVisible(from[0], from[1], this.cameraCenter, 0.01)
        ? startAt
        : null,
      originPulseShown: false,
      arrivalPulseAt: null,
      arrivalPulseShown: false,
      cardState: 0,
      tracked: false,
    };
    mission.originPulseShown = mission.originPulseAt != null;

    this.missions.push(mission);
    this.nextLaunchAt =
      this.motionTime + T.launchGap * (0.86 + Math.random() * 0.28);

    if (!this.trackedId) {
      this.trackedId = mission.id;
      this.cameraMode = 'tracking';
    }
  }

  desiredCenter(mission, progress) {
    if (!mission.interp) {
      mission.interp = d3.geoInterpolate(mission.from, mission.to);
    }
    const head = mission.interp(clamp(progress, 0, 1));
    return d3.geoInterpolate(mission.from, head)(0.8);
  }

  updateCamera(dtSeconds) {
    if (this.phase === 'article' || this.phase === 'boot') return;

    let mission = this.missions.find((item) => item.id === this.trackedId);

    if (mission) {
      if (mission.arrived) {
        if (this.cameraMode !== 'arrival') {
          this.cameraMode = 'arrival';
          this.holdUntil = this.motionTime + T.arrivalHold;
        }
        if (this.motionTime >= this.holdUntil) {
          this.chooseNextTracked();
          mission = this.missions.find((item) => item.id === this.trackedId);
        }
      } else {
        this.cameraMode = 'tracking';
      }
    }

    if (!mission) {
      this.trackedId = null;
      this.cameraMode = 'ambient';
    }

    let target;
    if (mission && !mission.arrived) {
      target = lonLatToUnit(
        this.desiredCenter(mission, mission.progress)
      );
    } else {
      // Even after a line arrives, the camera keeps drifting. Never a dead stop.
      target = ambientTarget(this.cameraForward, this.cameraVelocity);
    }

    [this.cameraForward, this.cameraVelocity] = stepCamera(
      this.cameraForward,
      this.cameraVelocity,
      target,
      Math.max(0.001, Math.min(0.08, dtSeconds))
    );
    this.cameraCenter = unitToLonLat(this.cameraForward);
  }

  chooseNextTracked() {
    const currentId = this.trackedId;
    const candidates = this.missions.filter(
      (mission) =>
        mission.id !== currentId &&
        !mission.arrived &&
        mission.progress < 1
    );

    if (candidates.length === 0) {
      this.trackedId = null;
      this.cameraMode = 'ambient';
      return;
    }

    let best = null;
    let bestScore = Infinity;
    for (const mission of candidates) {
      const target = lonLatToUnit(
        this.desiredCenter(mission, mission.progress)
      );
      const angle = Math.acos(
        clamp(dot3(this.cameraForward, target), -1, 1)
      );
      const delay = Math.max(0, mission.arriveAt - this.motionTime) / 1000;

      // Prefer a nearby line; a line that is about to arrive gets a small bias.
      const score = angle + delay * 0.15;
      if (score < bestScore) {
        bestScore = score;
        best = mission;
      }
    }

    if (!best) {
      this.trackedId = null;
      this.cameraMode = 'ambient';
      return;
    }

    this.trackedId = best.id;
    this.cameraMode = 'tracking';
  }

  updateCards() {
    if (this.phase !== 'running') return;

    if (!this.reserved && !this.feed.isBusy()) {
      const candidate = this.missions
        .filter(
          (mission) =>
            mission.cardState === 0 &&
            this.motionTime >= mission.arriveAt - T.cardRoom &&
            this.motionTime <= mission.arriveAt + 4000
        )
        .sort((a, b) => a.arriveAt - b.arriveAt)[0];

      if (candidate && this.feed.reserve(candidate, this.motionTime)) {
        candidate.cardState = 1;
        this.reserved = candidate;
        this.reservedReadyAt = this.motionTime + T.cardRoom;
      }
    }

    if (
      this.reserved &&
      this.motionTime >= Math.max(this.reserved.arriveAt, this.reservedReadyAt)
    ) {
      const mission = this.reserved;
      const committed = this.feed.commit(mission, this.motionTime);
      if (committed) {
        mission.cardState = 2;
        this.reserved = null;
        this.reservedReadyAt = 0;
      }
    }
  }

  suppressCardsForStop() {
    if (this.reserved) {
      this.reserved.cardState = this.reserved.arrived ? 3 : 0;
      this.reserved = null;
      this.reservedReadyAt = 0;
    }
    this.feed.cancelReservation();
    for (const mission of this.missions) {
      if (mission.arrived && mission.cardState === 0) {
        mission.cardState = 3;
      }
    }
  }

  startLanguage(target) {
    if (
      !['running', 'draining', 'stopped'].includes(this.phase) ||
      target === this.language
    ) {
      return;
    }

    this.lang = {
      from: this.language,
      to: target,
      wasRunning: this.phase === 'running',
      clickAt: this.uiTime,
      entryDoneAt: 0,
      inAt: 0,
    };
    this.phase = 'langLock';
    this.settings.setLocked(true);
    this.settings.startLanguageSwitch(this.lang.from, this.lang.to, this.uiTime);

    if (this.reserved) {
      this.reserved.cardState = this.reserved.arrived ? 3 : 0;
      this.reserved = null;
      this.reservedReadyAt = 0;
    }
    this.feed.cancelReservation();

    if (!this.lang.wasRunning) {
      this.feed.finishEntry();
    }
  }

  beginLangOut() {
    if (this.phase !== 'langLock') return;
    this.phase = 'langOut';
    this.lang.outAt = this.uiTime;
    this.feed.startExit(this.uiTime);
  }

  swapLanguage() {
    this.feed.clear();
    this.feed.setLanguage(this.lang.to);
    this.language = this.lang.to;
    this.missionSeq = 0;
    this.cycle = 0;
    this.storyBag = [];
    this.bagCycle = 0;
    this.refillStoryBag();
    this.nextRoute = null;
    this.missions = [];
    this.trackedId = null;
    this.reserved = null;
    this.reservedReadyAt = 0;
    this.cameraMode = 'ambient';
    this.holdUntil = 0;
    this.nextLaunchAt = Infinity;

    // Deliberately keep cameraForward / cameraVelocity. A language switch must
    // not snap the globe to a new continent.
    this.settings.finishLanguageSwitch(this.lang.to);
    this.settings.setState({
      language: this.lang.to,
      running: this.lang.wasRunning,
      speed: this.speed,
      count: this.stories.length,
    });
    this.onLanguageApplied?.(this.language);

    this.phase = 'langIn';
    this.lang.inAt = this.uiTime;
  }

  updateLanguage() {
    if (this.phase === 'langLock') {
      if (this.feed.isEntering()) {
        this.lang.entryDoneAt = 0;
        return;
      }
      if (!this.lang.entryDoneAt) {
        this.lang.entryDoneAt = this.uiTime;
      }
      const wheelReadyAt = this.lang.clickAt + T.wheel;
      const pauseReadyAt =
        Math.max(wheelReadyAt, this.lang.entryDoneAt) + T.langPause;
      if (this.uiTime >= pauseReadyAt) {
        this.beginLangOut();
      }
      return;
    }

    if (this.phase === 'langOut') {
      const wheelDone =
        this.settings.wheel == null ||
        this.uiTime >= this.lang.clickAt + T.wheel;
      if (wheelDone && this.feed.isExitDone()) {
        this.swapLanguage();
      }
      return;
    }

    if (this.phase === 'langIn') {
      if (this.uiTime < this.lang.inAt + T.langIn) return;
      this.settings.setLocked(false);
      if (this.lang.wasRunning) {
        this.phase = 'running';
        this.nextLaunchAt = this.motionTime;
        this.settings.setState({ running: true });
      } else {
        this.phase = 'stopped';
        this.settings.setState({ running: false });
      }
    }
  }

  setRunning(running) {
    if (running) {
      if (!['draining', 'stopped'].includes(this.phase)) return;
      this.phase = 'running';
      this.nextLaunchAt = this.motionTime;
      this.settings.setState({ running: true });
      return;
    }

    if (this.phase !== 'running') return;

    // Stop is a drain, not a freeze: existing lines finish, no new lines,
    // and no card is published for anything that arrives from now on.
    this.phase = 'draining';
    this.nextLaunchAt = Infinity;
    this.suppressCardsForStop();
    this.settings.setState({ running: false });

    if (this.missions.every((mission) => mission.arrived)) {
      this.phase = 'stopped';
    }
  }

  setSpeed(speed) {
    if (
      !SPEED_SCALE[speed] ||
      this.phase === 'langLock' ||
      this.phase === 'langOut' ||
      this.phase === 'langSwap' ||
      this.phase === 'langIn' ||
      this.phase === 'article'
    ) {
      return;
    }
    this.speed = speed;
    this.settings.setState({ speed });
  }

  suspendForArticle() {
    if (
      this.phase === 'article' ||
      this.phase === 'langLock' ||
      this.phase === 'langOut' ||
      this.phase === 'langSwap' ||
      this.phase === 'langIn'
    ) {
      return false;
    }
    this.phaseBeforeArticle = this.phase;
    this.phase = 'article';
    return true;
  }

  resumeFromArticle() {
    if (this.phase !== 'article') return;
    this.phase = this.phaseBeforeArticle || 'stopped';
    this.phaseBeforeArticle = null;
  }

  render() {
    if (this.phase === 'article') return;
    for (const mission of this.missions) {
      mission.tracked = mission.id === this.trackedId;
    }
    this.globe.render({
      center: this.cameraCenter,
      missions: this.missions,
      trackedId: this.trackedId,
      now: this.motionTime,
      paused: false,
    });
  }
}
