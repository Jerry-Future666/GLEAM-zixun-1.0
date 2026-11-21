const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const d3 = window.d3;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3);

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function isVisible(lon, lat, center, threshold = 0.015) {
  const lambda = (lon - center[0]) * DEG;
  const phi = lat * DEG;
  const phi0 = center[1] * DEG;
  const cosPhi = Math.cos(phi);
  const z =
    Math.sin(phi0) * Math.sin(phi) +
    Math.cos(phi0) * cosPhi * Math.cos(lambda);
  return z > threshold;
}

function project3D(lon, lat, center) {
  const lambda = (lon - center[0]) * DEG;
  const phi = lat * DEG;
  const phi0 = center[1] * DEG;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const cosLambda = Math.cos(lambda);
  const sinLambda = Math.sin(lambda);
  return {
    x: cosPhi * sinLambda,
    y: Math.cos(phi0) * sinPhi - Math.sin(phi0) * cosPhi * cosLambda,
    z: Math.sin(phi0) * sinPhi + Math.cos(phi0) * cosPhi * cosLambda,
  };
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export class GlobeRenderer {
  constructor(canvas) {
    if (!d3) {
      throw new Error('D3 未加载');
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.land = null;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.cx = 0;
    this.cy = 0;
    this.radius = 0;
    this.stars = [];
    this.projection = d3
      .geoOrthographic()
      .clipAngle(90 + 1e-6)
      .precision(0.45);
    this.path = d3.geoPath(this.projection, this.ctx);
    this.graticule = d3.geoGraticule10();
    this.resize = this.resize.bind(this);

    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas.parentElement);
    }
    window.addEventListener('resize', this.resize, { passive: true });
  }

  setLand(land) {
    this.land = land;
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    if (width === this.width && height === this.height && dpr === this.dpr) {
      return;
    }

    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.cx = width / 2;
    this.cy = height / 2;
    this.radius = Math.min(width * 0.44, height * 0.43, 342);

    const random = seededRandom(0x1a2b3c4d);
    const count = Math.round(clamp((width * height) / 9000, 42, 104));
    this.stars = Array.from({ length: count }, () => ({
      x: random() * width,
      y: random() * height,
      r: 0.45 + random() * 1.15,
      a: 0.06 + random() * 0.25,
      phase: random() * TAU,
      speed: 0.35 + random() * 0.9,
    }));
  }

  render(state) {
    if (!this.land || this.width === 0) return;

    const {
      center = [0, 0],
      missions = [],
      trackedId = null,
      now = 0,
      paused = false,
    } = state;

    const ctx = this.ctx;
    const { width, height, cx, cy, radius: R } = this;

    ctx.clearRect(0, 0, width, height);

    this.drawStars(now, paused);
    this.drawAtmosphere(R);

    // Ocean disc.
    const ocean = ctx.createRadialGradient(
      cx - R * 0.32,
      cy - R * 0.36,
      R * 0.08,
      cx,
      cy,
      R * 1.02
    );
    ocean.addColorStop(0, '#10100d');
    ocean.addColorStop(0.58, '#090907');
    ocean.addColorStop(0.9, '#040404');
    ocean.addColorStop(1, '#020202');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = ocean;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();

    this.projection
      .scale(R)
      .translate([cx, cy])
      .rotate([-center[0], -center[1], 0]);

    // Graticule.
    ctx.beginPath();
    this.path(this.graticule);
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.105)';
    ctx.lineWidth = 0.55;
    ctx.stroke();

    // Land.
    this.drawLand(R);

    // Sphere shading, applied only inside the globe.
    const shade = ctx.createRadialGradient(
      cx - R * 0.34,
      cy - R * 0.4,
      R * 0.08,
      cx,
      cy,
      R * 1.03
    );
    shade.addColorStop(0, 'rgba(255, 244, 208, 0.045)');
    shade.addColorStop(0.38, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(0.72, 'rgba(0, 0, 0, 0.16)');
    shade.addColorStop(0.92, 'rgba(0, 0, 0, 0.55)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();

    // Faint inner rim.
    const rim = ctx.createRadialGradient(
      cx,
      cy,
      R * 0.86,
      cx,
      cy,
      R
    );
    rim.addColorStop(0, 'rgba(212, 175, 55, 0)');
    rim.addColorStop(0.82, 'rgba(212, 175, 55, 0.035)');
    rim.addColorStop(1, 'rgba(240, 201, 106, 0.18)');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();

    this.drawMissions(missions, trackedId, now, center, R);
    this.drawEndpointPulses(missions, now, center, R, trackedId);

    ctx.restore();

    // Crisp rim and orbital tick ring sit outside the clipped sphere.
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.strokeStyle = 'rgba(240, 201, 106, 0.2)';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    this.drawOrbitRing(R);
  }

  drawStars(now, paused) {
    const ctx = this.ctx;
    for (const star of this.stars) {
      const twinkle = paused
        ? 0.72
        : 0.55 + 0.45 * Math.sin(now * 0.00022 * star.speed + star.phase);
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, TAU);
      ctx.fillStyle = `rgba(240, 225, 188, ${star.a * twinkle})`;
      ctx.fill();
    }
  }

  drawAtmosphere(R) {
    const ctx = this.ctx;
    const { cx, cy } = this;
    const glow = ctx.createRadialGradient(
      cx,
      cy,
      R * 0.88,
      cx,
      cy,
      R * 1.16
    );
    glow.addColorStop(0, 'rgba(212, 175, 55, 0.055)');
    glow.addColorStop(0.45, 'rgba(212, 175, 55, 0.075)');
    glow.addColorStop(0.74, 'rgba(212, 175, 55, 0.024)');
    glow.addColorStop(1, 'rgba(212, 175, 55, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.18, 0, TAU);
    ctx.fillStyle = glow;
    ctx.fill();
  }

  drawLand(R) {
    const ctx = this.ctx;
    const { cx, cy } = this;
    const landGradient = ctx.createRadialGradient(
      cx - R * 0.38,
      cy - R * 0.4,
      R * 0.04,
      cx,
      cy,
      R * 1.02
    );
    landGradient.addColorStop(0, '#f2d486');
    landGradient.addColorStop(0.24, '#d6b05b');
    landGradient.addColorStop(0.56, '#ac8235');
    landGradient.addColorStop(0.82, '#7d5b1e');
    landGradient.addColorStop(1, '#573e13');

    ctx.beginPath();
    this.path(this.land);
    ctx.fillStyle = landGradient;
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(245, 215, 142, 0.34)';
    ctx.lineWidth = 0.62;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  drawOrbitRing(R) {
    const ctx = this.ctx;
    const { cx, cy } = this;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.11)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.arc(0, 0, R + 11, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(212, 175, 55, 0.2)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * TAU - Math.PI / 2;
      const inner = R + (i % 6 === 0 ? 7 : 9);
      const outer = R + (i % 6 === 0 ? 16 : 13);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
  }

  missionPoint(mission, t, center, lift = 0) {
    if (!mission.interp) {
      mission.interp = d3.geoInterpolate(mission.from, mission.to);
    }
    const [lon, lat] = mission.interp(clamp(t, 0, 1));
    const p = project3D(lon, lat, center);
    const scale = this.radius * (1 + lift);
    return {
      x: this.cx + p.x * scale,
      y: this.cy - p.y * scale,
      z: p.z,
      lon,
      lat,
    };
  }

  drawMissions(missions, trackedId, now, center, R) {
    const ordered = [...missions].sort((a, b) => {
      if (a.tracked !== b.tracked) return a.tracked ? 1 : -1;
      return a.startAt - b.startAt;
    });

    for (const mission of ordered) {
      if (mission.progress <= 0.001) continue;
      this.drawMissionLine(mission, mission.id === trackedId, now, center, R);
    }
  }

  drawMissionLine(mission, tracked, now, center, R) {
    const ctx = this.ctx;
    const arrived = mission.arrived;
    let retractProgress = 0;

    if (arrived) {
      retractProgress = clamp(
        (now - mission.retractAt) / mission.retractDuration,
        0,
        1
      );
      if (retractProgress >= 1) return;
    }

    const startT = arrived ? retractProgress : 0;
    const endT = arrived ? 1 : clamp(mission.progress, 0, 1);
    if (endT - startT <= 0.001) return;

    const samples = Math.max(26, Math.round(72 * (endT - startT)));
    const runs = [];
    let current = [];

    for (let i = 0; i <= samples; i += 1) {
      const t = startT + (i / samples) * (endT - startT);
      const lift = 0.018 + 0.024 * Math.sin(Math.PI * t);
      const point = this.missionPoint(mission, t, center, lift);
      if (point.z > 0.004) {
        current.push(point);
      } else if (current.length > 0) {
        runs.push(current);
        current = [];
      }
    }
    if (current.length > 0) runs.push(current);
    if (runs.length === 0) return;

    const baseAlpha = arrived ? (tracked ? 0.72 : 0.38) : tracked ? 0.98 : 0.52;
    const lineWidth = tracked ? 1.8 : 1.16;

    for (const run of runs) {
      if (run.length < 2) continue;
      const first = run[0];
      const last = run[run.length - 1];

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const trail = (color, solidAlpha) => {
        const gradient = ctx.createLinearGradient(
          first.x,
          first.y,
          last.x,
          last.y
        );
        if (arrived && startT > 0.001) {
          gradient.addColorStop(0, `rgba(${color}, 0)`);
          gradient.addColorStop(0.14, `rgba(${color}, ${solidAlpha})`);
          gradient.addColorStop(1, `rgba(${color}, ${solidAlpha})`);
        } else {
          gradient.addColorStop(0, `rgba(${color}, ${solidAlpha * 0.55})`);
          gradient.addColorStop(0.55, `rgba(${color}, ${solidAlpha * 0.84})`);
          gradient.addColorStop(1, `rgba(${color}, ${solidAlpha})`);
        }
        return gradient;
      };

      // Dark separation keeps the signal readable over gold land.
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < run.length; i += 1) {
        ctx.lineTo(run[i].x, run[i].y);
      }
      ctx.strokeStyle = trail(
        '4, 4, 3',
        tracked ? 0.38 : 0.24
      );
      ctx.lineWidth = lineWidth + 2.6;
      ctx.stroke();

      // Soft gold halo.
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < run.length; i += 1) {
        ctx.lineTo(run[i].x, run[i].y);
      }
      ctx.strokeStyle = trail(
        '212, 175, 55',
        baseAlpha * 0.16
      );
      ctx.lineWidth = tracked ? 7 : 4.6;
      ctx.stroke();

      // Main signal line.
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < run.length; i += 1) {
        ctx.lineTo(run[i].x, run[i].y);
      }
      ctx.strokeStyle = trail('255, 246, 218', baseAlpha);
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      ctx.restore();
    }

    if (!arrived) {
      const head = this.missionPoint(
        mission,
        endT,
        center,
        0.018 + 0.024 * Math.sin(Math.PI * endT)
      );
      if (head.z > 0.004) {
        this.drawGlowDot(
          head.x,
          head.y,
          tracked ? 3.2 : 2.05,
          tracked ? 1 : 0.62
        );
      }

      if (tracked && endT > 0.08) {
        const packets = 3;
        for (let i = 0; i < packets; i += 1) {
          const phase = (now * 0.00055 + i / packets) % 1;
          const t = phase * endT;
          const lift = 0.018 + 0.024 * Math.sin(Math.PI * t);
          const packet = this.missionPoint(mission, t, center, lift);
          if (packet.z > 0.02) {
            ctx.beginPath();
            ctx.arc(packet.x, packet.y, 1.3, 0, TAU);
            ctx.fillStyle = `rgba(255, 240, 196, ${0.28 + 0.38 * (i / packets)})`;
            ctx.fill();
          }
        }
      }
    }
  }

  drawEndpointPulses(missions, now, center, R, trackedId) {
    const ringMax = clamp(R * 0.115, 15, 30);

    for (const mission of missions) {
      const origin = this.missionPoint(mission, 0, center, 0);
      const originVisible = origin.z > 0.01;
      const arrivalVisible = isVisible(mission.to[0], mission.to[1], center, 0.01);

      let retractProgress = 0;
      let originFade = 1;
      let arrivalFade = 1;

      if (mission.arrived) {
        retractProgress = clamp(
          (now - mission.retractAt) / mission.retractDuration,
          0,
          1
        );
        originFade = 1 - smoothstep(0, 0.35, retractProgress);

        if (now > mission.dotFadeStart) {
          arrivalFade =
            1 -
            smoothstep(
              0,
              1,
              clamp(
                (now - mission.dotFadeStart) / mission.dotFadeDuration,
                0,
                1
              )
            );
        }
      }

      if (originVisible && mission.startAt <= now && originFade > 0.01) {
        const spent =
          mission.originPulseAt != null &&
          now >= mission.originPulseAt + 1000;
        this.drawCoreDot(
          origin.x,
          origin.y,
          spent ? 1.95 : 2.9,
          (spent ? 0.42 : 0.72) * originFade,
          false
        );
      }

      if (mission.originPulseAt != null && originVisible) {
        this.drawPulseRings(
          origin.x,
          origin.y,
          mission.originPulseAt,
          now,
          ringMax,
          'origin',
          originFade
        );
      }

      if (mission.arrived && arrivalVisible && arrivalFade > 0.01) {
        const arrival = this.missionPoint(mission, 1, center, 0);
        this.drawCoreDot(
          arrival.x,
          arrival.y,
          3.25,
          0.95 * arrivalFade,
          mission.id === trackedId
        );
        if (mission.arrivalPulseAt != null) {
          this.drawPulseRings(
            arrival.x,
            arrival.y,
            mission.arrivalPulseAt,
            now,
            ringMax,
            'arrival',
            arrivalFade
          );
        }
      }

    }
  }

  drawCoreDot(x, y, radius, alpha, bright) {
    const ctx = this.ctx;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 5.5);
    glow.addColorStop(0, `rgba(255, 244, 205, ${alpha})`);
    glow.addColorStop(0.28, `rgba(240, 201, 106, ${alpha * 0.45})`);
    glow.addColorStop(1, 'rgba(212, 175, 55, 0)');
    ctx.beginPath();
    ctx.arc(x, y, radius * 5.5, 0, TAU);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fillStyle = bright
      ? `rgba(255, 242, 200, ${Math.min(1, alpha * 1.1 + 0.015)})`
      : `rgba(244, 217, 141, ${Math.min(1, alpha * 1.15 + 0.015)})`;
    ctx.fill();

    if (bright) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 3.2, 0, TAU);
      ctx.strokeStyle = `rgba(255, 238, 184, ${0.36 * alpha})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  drawGlowDot(x, y, radius, alpha) {
    const ctx = this.ctx;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 6.5);
    glow.addColorStop(0, `rgba(255, 248, 218, ${alpha})`);
    glow.addColorStop(0.2, `rgba(240, 201, 106, ${alpha * 0.5})`);
    glow.addColorStop(1, 'rgba(212, 175, 55, 0)');
    ctx.beginPath();
    ctx.arc(x, y, radius * 6.5, 0, TAU);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fillStyle = '#fff4cf';
    ctx.fill();
  }

  drawPulseRings(x, y, startedAt, now, maxRadius, kind, fade = 1) {
    const ctx = this.ctx;
    const cycle = 500;
    const color = kind === 'arrival' ? '255, 240, 196' : '240, 201, 106';

    for (let i = 0; i < 2; i += 1) {
      const p = (now - startedAt - i * cycle) / cycle;
      if (p < 0 || p > 1) continue;
      const eased = easeOutCubic(p);
      const radius = 4 + (maxRadius - 4) * eased;
      const alpha =
        Math.pow(1 - p, 1.5) *
        (kind === 'arrival' ? 0.58 : 0.42) *
        fade;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.strokeStyle = `rgba(${color}, ${alpha})`;
      ctx.lineWidth = kind === 'arrival' ? 1.15 : 0.95;
      ctx.stroke();

      if (p < 0.7) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, TAU);
        ctx.strokeStyle = `rgba(${color}, ${alpha * 0.16})`;
        ctx.lineWidth = 3.4;
        ctx.stroke();
      }
    }
  }
}

export { isVisible, project3D, smoothstep, clamp, easeOutCubic, TAU };
