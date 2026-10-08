/* ============================================================
   PAC-MAN 3D — First Person
   ============================================================ */
'use strict';

/* ---------------- Maze definition ----------------
   Authentic arcade layout, first level (28 x 31).                        */
const MAZE = [
  '############################',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#o####.#####.##.#####.####o#',
  '#.####.#####.##.#####.####.#',
  '#..........................#',
  '#.####.##.########.##.####.#',
  '#.####.##.########.##.####.#',
  '#......##....##....##......#',
  '######.#####.##.#####.######',
  '     #.#####.##.#####.#     ',
  '     #.##          ##.#     ',
  '     #.## ###--### ##.#     ',
  '######.## #      # ##.######',
  '      .   #      #   .      ',
  '######.## #      # ##.######',
  '     #.## ######## ##.#     ',
  '     #.##          ##.#     ',
  '     #.## ######## ##.#     ',
  '######.## ######## ##.######',
  '#............##............#',
  '#.####.#####.##.#####.####.#',
  '#.####.#####.##.#####.####.#',
  '#o..##.......P .......##..o#',
  '###.##.##.########.##.##.###',
  '###.##.##.########.##.##.###',
  '#......##....##....##......#',
  '#.##########.##.##########.#',
  '#.##########.##.##########.#',
  '#..........................#',
  '############################',
];
const ROWS = MAZE.length;
const COLS = MAZE[0].length;
const TILE = 2;
const WALL_H = 1.15;
const EYE_H = 0.62;
const TUNNEL_ROW = 14;
const DOOR = { x: 13, y: 12 };
const HOUSE = { x: 13.5, y: 13.5 };
const PLAYER_START = { x: 13, y: 23 };
const FRUIT_TILE = { x: 14, y: 17 };

/* ---------------- Grid helpers ---------------- */
function tileAt(gx, gy) {
  gx = Math.round(gx); gy = Math.round(gy);
  if (gy === TUNNEL_ROW && (gx < 0 || gx >= COLS)) return '.';
  if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return '#';
  return MAZE[gy][gx];
}
function isWallTile(gx, gy) { return tileAt(gx, gy) === '#'; }
function isWallForGhost(gx, gy, ghost) {
  const t = tileAt(gx, gy);
  if (t === '#') return true;
  if (t === '-' && ghost && ghost.state !== 'eaten' && ghost.state !== 'exiting') return true;
  return false;
}
function isRedZone(gx, gy) {
  return gx >= 11 && gx <= 16 && (gy === 11 || gy === 23);
}
function gridToWorld(gx, gy) {
  return {
    x: (gx - (COLS - 1) / 2) * TILE,
    z: (gy - (ROWS - 1) / 2) * TILE,
  };
}
function worldToGrid(wx, wz) {
  return {
    x: Math.round(wx / TILE + (COLS - 1) / 2),
    y: Math.round(wz / TILE + (ROWS - 1) / 2),
  };
}

/* ---------------- Audio ---------------- */
const AudioEngine = {
  ctx: null, master: null, muted: false, vol: 0.5,
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.vol;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    const conv = this.ctx.createConvolver();
    conv.buffer = this.impulse(1.4, 2.5);
    this.verbGain = this.ctx.createGain();
    this.verbGain.gain.value = 0.22;
    comp.connect(conv);
    conv.connect(this.verbGain);
    this.verbGain.connect(this.ctx.destination);
    WSG.init();
  },
  impulse(dur, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * dur);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  },
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.vol;
    try { localStorage.setItem('pacman3d_muted', this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
    return this.muted;
  },
  setVolume(v) {
    this.vol = Math.min(1, Math.max(0, v));
    if (this.master && !this.muted) this.master.gain.value = this.vol;
    try { localStorage.setItem('pacman3d_vol', String(this.vol)); } catch (e) { /* ignore */ }
    const s = document.getElementById('volume-slider');
    if (s) s.value = Math.round(this.vol * 100);
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  tone(freq, dur, type, vol, delay, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(vol || 0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) { /* already gone */ } };
  },
  positional(freq, dur, type, vol, pan, delay, slideTo) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(vol || 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    let out = g, p = null;
    if (typeof this.ctx.createStereoPanner === 'function') {
      p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      g.connect(p);
      out = p;
    }
    out.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
    o.onended = () => { try { o.disconnect(); g.disconnect(); if (p) p.disconnect(); } catch (e) { /* already gone */ } };
  },
  levelClear() {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.14, 'square', 0.1, i * 0.12));
  },
  closeCall() { this.tone(1200, 0.08, 'sine', 0.08, 0, 1600); },
  thump(vol) {
    this.tone(70, 0.1, 'sine', vol || 0.08);
    this.tone(65, 0.1, 'sine', vol || 0.08, 0.12);
  },
  dangerSting() {
    this.tone(1244, 0.15, 'sawtooth', 0.05);
    this.tone(1318, 0.15, 'sawtooth', 0.05, 0.02);
  },
  riser() {
    this.tone(250, 0.35, 'sawtooth', 0.09, 0, 1000);
  },
  swarm() {
    this.tone(55, 0.15, 'sine', 0.1);
    this.tone(82, 0.12, 'sine', 0.07, 0.05);
  },
  ghostExit() {
    this.tone(520, 0.08, 'square', 0.06);
    this.tone(780, 0.1, 'square', 0.06, 0.07);
  },
  click() { this.tone(880, 0.05, 'square', 0.06); },
  gameOver() {
    [392, 370, 349, 311].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.1, i * 0.2));
  },
};
try {
  AudioEngine.muted = localStorage.getItem('pacman3d_muted') === '1';
  const v = parseFloat(localStorage.getItem('pacman3d_vol'));
  if (!isNaN(v)) AudioEngine.vol = Math.min(1, Math.max(0, v));
} catch (e) { /* ignore */ }

/* ---------------- Namco WSG (3-voice wavetable, 1980) ----------------
   Faithful model of the Pac-Man sound hardware (MAME-verified):
   - 3 voices, 96kHz counter, 20-bit freq (v0) / 16-bit (v1, v2)
   - 8 PROM waveforms x 32 4-bit nibbles (wsg_data.js, 82s126 dump)
   - 4-bit volume; a voice is silent when freq or volume is 0
   - register writes applied at 60Hz, like the vblank ISR
   Voices render through PeriodicWaves built by DFT from the nibbles
   (DC offset kept); a 16-step WaveShaper reproduces the 4-bit DAC
   crunch. Arcade voice map: slot0 = intro (v0+v1), slot1 = siren /
   fright (v1), slot2 = one-shots (v2), slot3 = extra life (v0). */
const WSG_RATE = 96000 / 1048576; // Hz per frequency-register unit
const WSG_CAL = 0.3; // bus calibration vs the synth layer
const WSG = {
  ready: false, acc: 0, odd: false,
  mix: null, v: null, waves: [],
  slots: [null, null, null, null],
  eyesLeft: 0, eyesT: 0,
  init() {
    const ctx = AudioEngine.ctx;
    if (!ctx || this.ready) return;
    for (let w = 0; w < 8; w++) {
      const N = 32, real = new Float32Array(17), imag = new Float32Array(17);
      for (let k = 0; k <= 16; k++) {
        let r = 0, im = 0;
        for (let n = 0; n < N; n++) {
          const x = (WSG_WAVES[w * 32 + n] - 8) / 8;
          r += x * Math.cos(2 * Math.PI * k * n / N);
          im -= x * Math.sin(2 * Math.PI * k * n / N);
        }
        const s = (k === 0 || k === 16) ? 1 / N : 2 / N;
        real[k] = r * s; imag[k] = im * s;
      }
      this.waves.push(ctx.createPeriodicWave(real, imag, { disableNormalization: true }));
    }
    this.mix = ctx.createGain();
    this.mix.gain.value = 1;
    const sh = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = i / 511.5 - 1;
      curve[i] = Math.max(-1, Math.min(7 / 8, Math.round(x * 8) / 8));
    }
    sh.curve = curve;
    sh.oversample = 'none';
    const cal = ctx.createGain();
    cal.gain.value = WSG_CAL;
    this.mix.connect(sh);
    sh.connect(cal);
    cal.connect(AudioEngine.master);
    this.v = [];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(this.waves[0]);
      osc.frequency.value = 0;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this.mix);
      osc.start();
      this.v.push({ osc, gain: g, wave: -1 });
    }
    this.ready = true;
  },
  write(i, F, wave, vol) {
    if (!this.ready) return;
    const v = this.v[i], t = AudioEngine.ctx.currentTime;
    F |= 0;
    if (wave !== v.wave) { v.wave = wave; v.osc.setPeriodicWave(this.waves[wave & 7]); }
    v.osc.frequency.setValueAtTime(F > 0 ? F * WSG_RATE : 0, t);
    v.gain.gain.setValueAtTime((F > 0 && vol > 0) ? (vol / 15) / 3 : 0, t);
  },
  reg(i, val) {
    this.write(i, val & 0xFFFFF, (val >> 24) & 7, (val >> 28) & 15);
  },
  silence(i) { this.write(i, 0, 0, 0); },
  stopAll() {
    this.slots = [null, null, null, null];
    this.eyesLeft = 0;
    if (!this.ready) return;
    this.silence(0); this.silence(1); this.silence(2);
  },
  suspend() {
    // Zero voice gains without touching effect state; the next
    // tick() rewrites regs and sound resumes seamlessly.
    if (!this.ready) return;
    const t = AudioEngine.ctx.currentTime;
    for (const v of this.v) v.gain.gain.setValueAtTime(0, t);
  },
  prelude() { this.stopAll(); this.slots[0] = { tick: 0 }; },
  siren(variant) {
    const s = this.slots[1];
    if (s && s.kind === 'siren' && s.variant === variant) return;
    this.slots[1] = { kind: 'siren', tick: 0, variant, inc: variant * 0x80 };
  },
  fright() {
    const s = this.slots[1];
    if (s && s.kind === 'fright') return;
    this.slots[1] = { kind: 'fright', tick: 0 };
  },
  waka() {
    const s = this.slots[2];
    if (s && s.kind === 'dead') return;
    this.odd = !this.odd;
    this.slots[2] = { kind: this.odd ? 'waka1' : 'waka2', tick: 0 };
  },
  fruit() {
    const s = this.slots[2];
    if (s && s.kind === 'dead') return;
    this.slots[2] = { kind: 'fruit', tick: 0 };
  },
  ghost(combo) {
    const s = this.slots[2];
    if (s && s.kind === 'dead') return;
    const steps = Math.min(6, Math.max(0, (combo || 1) - 1));
    this.slots[2] = { kind: 'ghost', tick: 0, mul: 1 + steps * 0.06 };
  },
  eyes() { this.eyesLeft = 20; this.eyesT = 0; },
  extralife() { this.slots[3] = { tick: 0 }; },
  dead() { this.stopAll(); this.slots[2] = { kind: 'dead', tick: 0 }; },
  tick(dt) {
    if (!this.ready) return;
    this.acc += dt;
    let n = 0;
    while (this.acc >= 1 / 60 && n++ < 5) {
      this.acc -= 1 / 60;
      this.step();
    }
    if (n >= 5) this.acc = 0;
  },
  step() {
    const s0 = this.slots[0];
    if (s0) {
      if (s0.tick >= 245) {
        this.slots[0] = null;
        this.silence(0); this.silence(1);
      } else {
        this.reg(0, WSG_PRELUDE[s0.tick * 2]);
        this.reg(1, WSG_PRELUDE[s0.tick * 2 + 1]);
        s0.tick++;
      }
    }
    if (this.eyesLeft > 0) {
      this.eyesLeft--;
      this.write(1, 0x400 + (this.eyesT++) * 0x40, 0, 12);
      if (this.eyesLeft <= 0) this.silence(1);
    } else {
      const s1 = this.slots[1];
      if (s1) {
        const t = s1.tick++;
        if (s1.kind === 'siren') {
          const ph = t % 24;
          this.write(1, 0x1000 + (ph < 12 ? ph : 24 - ph) * s1.inc, 6, 6);
        } else {
          this.write(1, 0x180 * (1 + (t % 8)), 4, 10);
        }
      }
    }
    const s2 = this.slots[2];
    if (s2) {
      const t = s2.tick++;
      if (s2.kind === 'waka1') {
        if (t >= 5) { this.slots[2] = null; this.silence(2); }
        else this.write(2, 0x1500 - t * 0x300, 2, 12);
      } else if (s2.kind === 'waka2') {
        if (t >= 5) { this.slots[2] = null; this.silence(2); }
        else this.write(2, 0x700 + t * 0x300, 2, 12);
      } else if (s2.kind === 'fruit') {
        if (t >= 23) { this.slots[2] = null; this.silence(2); }
        else this.write(2, 0x1600 - 0x200 * Math.min(t, 10) + 0x200 * Math.max(0, t - 10), 6, 15);
      } else if (s2.kind === 'ghost') {
        if (t >= 32) { this.slots[2] = null; this.silence(2); }
        else this.write(2, Math.round(t * 0x20 * s2.mul), 5, 12);
      } else if (s2.kind === 'dead') {
        if (t >= 90) { this.slots[2] = null; this.silence(2); }
        else this.reg(2, WSG_DEAD[t]);
      }
    }
    const s3 = this.slots[3];
    if (s3) {
      const t = s3.tick++;
      if (t >= 80) { this.slots[3] = null; this.silence(0); }
      else if (t % 8 < 4) this.write(0, 0x258C, 6, 12);
      else this.write(0, 0, 6, 0);
    }
  },
};
function updateMuteIndicator() {
  document.getElementById('mute-indicator').style.display = AudioEngine.muted ? 'block' : 'none';
}
function buzz(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) { /* unsupported */ }
}

/* ---------------- Renderer / Scene ---------------- */
const QS = new URLSearchParams(location.search);
const LOWFX = QS.get('fx') === 'low' || ((('ontouchstart' in window) || (navigator.maxTouchPoints > 0)) && Math.min(window.innerWidth, window.innerHeight) < 500);
const SHOWFPS = QS.get('fps') === '1';
const REDUCED_MOTION = (typeof window.matchMedia === 'function') && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const container = document.getElementById('game-container');
const renderer = new THREE.WebGLRenderer({ antialias: !LOWFX });
renderer.setPixelRatio(LOWFX ? Math.min(window.devicePixelRatio, 1.25) : Math.min(window.devicePixelRatio, 2));
const fpsMeter = document.createElement('div');
fpsMeter.id = 'fps-meter';
fpsMeter.style.cssText = 'position:fixed;top:4px;left:4px;z-index:99;font:12px monospace;color:#0f0;display:none;pointer-events:none;';
document.body.appendChild(fpsMeter);
if (SHOWFPS) fpsMeter.style.display = 'block';
let fpsN = 0, fpsT = performance.now();
function tickFps(now) {
  fpsN++;
  if (now - fpsT >= 500) {
    fpsMeter.textContent = Math.round(fpsN * 1000 / (now - fpsT)) + 'fps' + (LOWFX ? ' lowfx' : '');
    fpsN = 0; fpsT = now;
  }
}
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000005);
scene.fog = new THREE.FogExp2(0x000005, 0.055);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 100);
camera.rotation.order = 'YXZ';

scene.add(new THREE.AmbientLight(0x334466, 0.6));
const playerLight = new THREE.PointLight(0xffeeaa, 1.3, 18, 1.6);
scene.add(playerLight);
const fillLight = new THREE.PointLight(0x2244aa, 0.5, 30, 2);
fillLight.position.set(0, 6, 0);
scene.add(fillLight);
const houseLight = new THREE.PointLight(0xff2244, 0.8, 12, 2);
{
  const w = gridToWorld(DOOR.x + 0.5, DOOR.y);
  houseLight.position.set(w.x, TILE * 1.2, w.z);
}
scene.add(houseLight);
const tunnelLights = [];
if (!LOWFX) for (const gx of [1, COLS - 2]) {
  const w = gridToWorld(gx, TUNNEL_ROW);
  const tl = new THREE.PointLight(0x22ddaa, 0.7, 10, 2);
  tl.position.set(w.x, TILE * 0.9, w.z);
  scene.add(tl);
  tunnelLights.push(tl);
}
let moodFright = 0;
function updateMoodLighting(dt, now) {
  moodFright += ((game.frightTimer > 0 ? 1 : 0) - moodFright) * Math.min(1, 3 * dt);
  fillLight.intensity = 0.45 + Math.sin(now * 0.002) * 0.1 + moodFright * 0.35;
  scene.fog.density = 0.055 - moodFright * 0.012;
}
const ghostLights = [];
const shadowGeo = new THREE.CircleGeometry(0.42 * TILE, 20);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
const ghostShadows = [];
function updateGhostLights() {
  for (let i = 0; i < ghosts.length; i++) {
    const g = ghosts[i];
    let light = ghostLights[i];
    if (!light && !LOWFX) {
      light = new THREE.PointLight(g.def.color, 0.9, 7, 2);
      scene.add(light);
      ghostLights[i] = light;
    }
    const w = gridToWorld(g.gx, g.gy);
    if (light) {
      light.position.set(w.x, TILE * 0.7, w.z);
      light.color.set(g.state === 'frightened' ? 0x3344ff : g.def.color);
      light.intensity = g.state === 'eaten' ? 0.2 : 0.6;
    }
    let shadow = ghostShadows[i];
    if (!shadow) {
      shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      scene.add(shadow);
      ghostShadows[i] = shadow;
    }
    shadow.position.set(w.x, 0.02, w.z);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------- Maze geometry ---------------- */
function makeWallTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1440';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#060a28';
  g.fillRect(14, 14, 100, 100);
  g.strokeStyle = '#2424ff';
  g.lineWidth = 5;
  g.strokeRect(7, 7, 114, 114);
  g.strokeStyle = '#1a2fa0';
  g.lineWidth = 2;
  g.strokeRect(18, 18, 92, 92);
  return new THREE.CanvasTexture(c);
}
function makeFloorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#050510';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(50,70,200,0.4)';
  g.lineWidth = 3;
  g.strokeRect(1, 1, 126, 126);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(Math.ceil(COLS * TILE / 2), Math.ceil(ROWS * TILE / 2));
  return tex;
}
const wallTex = makeWallTexture();
const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: wallTex, emissive: 0x2424ff, emissiveMap: wallTex, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.1 });
const wallGeo = new THREE.BoxGeometry(TILE, WALL_H * TILE, TILE);

let wallCount = 0;
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (MAZE[y][x] === '#') wallCount++;
const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
{
  const m = new THREE.Matrix4();
  let i = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (MAZE[y][x] !== '#') continue;
    const w = gridToWorld(x, y);
    m.makeTranslation(w.x, (WALL_H * TILE) / 2, w.z);
    wallMesh.setMatrixAt(i++, m);
  }
}
scene.add(wallMesh);

const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: makeFloorTexture(), roughness: 0.9 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(COLS * TILE + 8, ROWS * TILE + 8), floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

function makeCeilingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#04040c';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(70,90,220,0.5)';
  g.lineWidth = 3;
  g.strokeRect(1, 1, 126, 126);
  g.fillStyle = 'rgba(120,140,255,0.5)';
  g.beginPath();
  g.arc(64, 64, 4, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(Math.ceil(COLS * TILE / 2), Math.ceil(ROWS * TILE / 2));
  return tex;
}
const ceilTex = makeCeilingTexture();
const ceilMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: ceilTex, emissive: 0x2233aa, emissiveMap: ceilTex, emissiveIntensity: 0.35, roughness: 1 });
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(COLS * TILE + 8, ROWS * TILE + 8), ceilMat);
ceil.rotation.x = Math.PI / 2;
ceil.position.y = WALL_H * TILE;
scene.add(ceil);

const doorMat = new THREE.MeshStandardMaterial({ color: 0xffccee, emissive: 0xff88bb, emissiveIntensity: 0.8 });
const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(TILE * 0.9, TILE * 0.25, TILE * 0.25), doorMat);
const DOOR_CLOSED_Y = TILE * 0.35;
const DOOR_OPEN_Y = TILE * 0.85;
{
  const w = gridToWorld(DOOR.x, DOOR.y);
  doorMesh.position.set(w.x, DOOR_CLOSED_Y, w.z);
}
scene.add(doorMesh);
function updateDoor(dt) {
  let open = false;
  for (const g of ghosts) {
    if (g.state === 'exiting') { open = true; break; }
    if (g.state === 'eaten' && Math.abs(g.gx - DOOR.x) + Math.abs(g.gy - DOOR.y) < 2.5) { open = true; break; }
  }
  const target = open ? DOOR_OPEN_Y : DOOR_CLOSED_Y;
  const y = doorMesh.position.y;
  const step = TILE * 2.5 * dt;
  doorMesh.position.y = y + Math.sign(target - y) * Math.min(Math.abs(target - y), step);
}

/* ---------------- Eat burst particles ---------------- */
const BURST_N = 10;
const burstPool = [];
function buildBursts() {
  const geo = new THREE.SphereGeometry(0.09 * TILE, 6, 6);
  for (let i = 0; i < BURST_N; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    m.visible = false;
    scene.add(m);
    burstPool.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0 });
  }
}
function spawnBurst(x, y, z, color) {
  let n = 0;
  for (const b of burstPool) {
    if (b.life > 0) continue;
    b.life = 0.5;
    b.mesh.visible = true;
    b.mesh.material.color.set(color);
    b.mesh.material.opacity = 1;
    b.mesh.position.set(x, y, z);
    const a = Math.random() * Math.PI * 2;
    b.vx = Math.cos(a) * 3; b.vz = Math.sin(a) * 3; b.vy = 1 + Math.random() * 2;
    if (++n >= 6) break;
  }
}
function updateBursts(dt) {
  for (const b of burstPool) {
    if (b.life <= 0) continue;
    b.life -= dt;
    if (b.life <= 0) { b.mesh.visible = false; continue; }
    b.mesh.position.x += b.vx * dt;
    b.mesh.position.y += b.vy * dt;
    b.mesh.position.z += b.vz * dt;
    b.vy -= 6 * dt;
    b.mesh.material.opacity = b.life * 2;
    const s = 0.5 + b.life;
    b.mesh.scale.set(s, s, s);
  }
}

/* ---------------- Pellets ---------------- */
const pelletGeo = new THREE.SphereGeometry(0.09 * TILE, 16, 12);
const pelletMat = new THREE.MeshStandardMaterial({ color: 0xd89055, emissive: 0xd89055, emissiveIntensity: 0.9 });
const powerGeo = new THREE.SphereGeometry(0.26 * TILE, 20, 14);
const powerMat = new THREE.MeshStandardMaterial({ color: 0xfff0cc, emissive: 0xffdd66, emissiveIntensity: 2.0 });

let pellets = [];
let pelletMesh = null;
let powerMesh = null;
const _pm = new THREE.Matrix4();
const _pq = new THREE.Quaternion();
const _ps = new THREE.Vector3();
const _pp = new THREE.Vector3();
function pelletMatrix(p, s) {
  const w = gridToWorld(p.gx, p.gy);
  _pp.set(w.x, TILE * 0.45, w.z);
  _ps.set(s, s, s);
  _pq.identity();
  return _pm.compose(_pp, _pq, _ps);
}
function buildPellets() {
  if (pelletMesh) { scene.remove(pelletMesh); pelletMesh = null; }
  if (powerMesh) { scene.remove(powerMesh); powerMesh = null; }
  pellets = [];
  let nDot = 0, nPow = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const c = MAZE[y][x];
    if (c !== '.' && c !== 'o') continue;
    const power = c === 'o';
    pellets.push({ mesh: null, idx: power ? nPow++ : nDot++, gx: x, gy: y, power, eaten: false });
  }
  pelletMesh = new THREE.InstancedMesh(pelletGeo, pelletMat, nDot);
  powerMesh = new THREE.InstancedMesh(powerGeo, powerMat, nPow);
  pelletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  powerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pelletMesh.frustumCulled = false;
  powerMesh.frustumCulled = false;
  for (const p of pellets) {
    p.mesh = p.power ? powerMesh : pelletMesh;
    p.mesh.setMatrixAt(p.idx, pelletMatrix(p, 1));
  }
  pelletMesh.instanceMatrix.needsUpdate = true;
  powerMesh.instanceMatrix.needsUpdate = true;
  scene.add(pelletMesh);
  scene.add(powerMesh);
  pelletCount = pellets.length;
  levelTotal = pellets.length;
}
function hidePellet(p) {
  _pm.makeScale(0, 0, 0);
  p.mesh.setMatrixAt(p.idx, _pm);
  p.mesh.instanceMatrix.needsUpdate = true;
}
function pulsePowerPellets(now) {
  let dirty = false;
  for (const p of pellets) {
    if (p.power && !p.eaten) {
      const s = 1 + Math.sin(now * 0.006 + p.gx) * 0.25;
      const w = gridToWorld(p.gx, p.gy);
      _pp.set(w.x, TILE * 0.45 + Math.sin(now * 0.006 + p.gx * 2) * 0.06 * TILE, w.z);
      _ps.set(s, s, s);
      _pq.identity();
      p.mesh.setMatrixAt(p.idx, _pm.compose(_pp, _pq, _ps));
      dirty = true;
    }
  }
  if (dirty && powerMesh) powerMesh.instanceMatrix.needsUpdate = true;
}
function resetPellets() {
  for (const p of pellets) {
    p.eaten = false;
    p.mesh.setMatrixAt(p.idx, pelletMatrix(p, 1));
  }
  if (pelletMesh) pelletMesh.instanceMatrix.needsUpdate = true;
  if (powerMesh) powerMesh.instanceMatrix.needsUpdate = true;
  pelletCount = pellets.length;
}

/* ---------------- Fruit bonus ---------------- */
const FRUIT_SPAWNS = [10, 70, 140, 200];
const FRUIT_LIFE = 14;
let fruit = null;
function buildFruit() {
  const grp = new THREE.Group();
  const cherry = new THREE.Mesh(
    new THREE.SphereGeometry(0.22 * TILE, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff2244 }));
  grp.add(cherry);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03 * TILE, 0.03 * TILE, 0.3 * TILE, 6),
    new THREE.MeshStandardMaterial({ color: 0x33cc44, emissive: 0x11aa22, emissiveIntensity: 0.8 }));
  stem.position.y = 0.28 * TILE;
  stem.rotation.z = 0.3;
  grp.add(stem);
  const fshadow = new THREE.Mesh(shadowGeo, shadowMat);
  fshadow.rotation.x = -Math.PI / 2;
  fshadow.position.y = 0.02 - TILE * 0.45;
  grp.add(fshadow);
  const w = gridToWorld(FRUIT_TILE.x, FRUIT_TILE.y);
  grp.position.set(w.x, TILE * 0.45, w.z);
  grp.visible = false;
  scene.add(grp);
  fruit = { mesh: grp, cherry, active: false, timer: 0, spawnIdx: 0 };
}
const FRUIT_TABLE = [
  { score: 100, color: 0xff2244 },
  { score: 300, color: 0xff88cc },
  { score: 500, color: 0xffaa22 },
  { score: 700, color: 0xff3333 },
  { score: 1000, color: 0x66ff66 },
  { score: 2000, color: 0x4466ff },
  { score: 3000, color: 0xffcc33 },
  { score: 5000, color: 0x99eeff },
];
function fruitDef() {
  return FRUIT_TABLE[Math.min(game.level - 1, FRUIT_TABLE.length - 1)];
}
function snapFruitHome() {
  if (!fruit) return;
  const w = gridToWorld(FRUIT_TILE.x, FRUIT_TILE.y);
  fruit.mesh.position.set(w.x, TILE * 0.45, w.z);
}
function resetFruit() {
  if (!fruit) return;
  fruit.active = false; fruit.timer = 0; fruit.spawnIdx = 0;
  fruit.mesh.visible = false;
  snapFruitHome();
}
function hideFruit() {
  if (!fruit || !fruit.active) return;
  fruit.active = false;
  fruit.mesh.visible = false;
  snapFruitHome();
}
function updateFruit(dt) {
  if (!fruit) return;
  if (!fruit.active) {
    const eaten = levelTotal - pelletCount;
    if (fruit.spawnIdx < FRUIT_SPAWNS.length && eaten >= FRUIT_SPAWNS[fruit.spawnIdx]) {
      fruit.active = true; fruit.timer = FRUIT_LIFE;
      snapFruitHome();
      fruit.mesh.visible = true;
      fruit.cherry.material.color.set(fruitDef().color);
      fruit.spawnIdx++;
      showCenterMsg('FRUIT!', 900);
    }
    return;
  }
  fruit.timer -= dt;
  const s = 1 + Math.sin(performance.now() * 0.008) * 0.15;
  fruit.mesh.scale.set(s, s, s);
  if (fruit.timer <= 0) hideFruit();
}
function checkFruitPickup() {
  if (!fruit || !fruit.active) return;
  const g = worldToGrid(player.x, player.z);
  if (g.x === FRUIT_TILE.x && g.y === FRUIT_TILE.y) {
    hideFruit();
    const pts = fruitDef().score;
    game.score += pts;
    showCenterMsg('FRUIT +' + pts, 900);
    WSG.fruit();
    const w = gridToWorld(FRUIT_TILE.x, FRUIT_TILE.y);
    spawnBurst(w.x, TILE * 0.45, w.z, 0xff2244);
    game.hitstop = Math.max(game.hitstop, 0.06);
    updateHUD();
  }
}
function updateFruitMagnetism(dt) {
  if (!fruit || !fruit.active) return;
  const w = gridToWorld(FRUIT_TILE.x, FRUIT_TILE.y);
  const dx = player.x - w.x, dz = player.z - w.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1.5 * TILE && dist > 0.01) {
    const pull = 2.0 * dt;
    fruit.mesh.position.x += dx / dist * pull;
    fruit.mesh.position.z += dz / dist * pull;
    const ox = fruit.mesh.position.x - w.x, oz = fruit.mesh.position.z - w.z;
    const od = Math.hypot(ox, oz), maxD = 0.4 * TILE;
    if (od > maxD) {
      fruit.mesh.position.x = w.x + ox / od * maxD;
      fruit.mesh.position.z = w.z + oz / od * maxD;
    }
    game.magnetTimer -= dt;
    if (game.magnetTimer <= 0) {
      AudioEngine.tone(1500, 0.04, 'sine', 0.03);
      game.magnetTimer = 0.18;
    }
  } else {
    game.magnetTimer = 0;
  }
}
let pelletCount = 0;
let levelTotal = 0;
function remainingPellets() { return pelletCount; }

/* ---------------- Player ---------------- */
const player = {
  x: 0, z: 0, yaw: -Math.PI / 2, pitch: 0,
  speed: 4.9, radius: 0.32 * TILE,
  moving: false, chomp: 0, invuln: 0, bob: 0, vx: 0, vz: 0,
  stamina: 100, sens: 1, exhausted: false,
};
try {
  player.sens = Math.min(3, Math.max(0.3, parseFloat(localStorage.getItem('pacman3d_sens')) || 1));
} catch (e) { player.sens = 1; }
function adjustSens(d) {
  player.sens = Math.min(3, Math.max(0.3, Math.round((player.sens + d) * 100) / 100));
  try { localStorage.setItem('pacman3d_sens', String(player.sens)); } catch (e) { /* ignore */ }
  flashSens();
}
function flashSens() {
  const el = document.getElementById('sens-flash');
  setPixelText(el, 'SENSITIVITY ' + player.sens.toFixed(2), '#8af', 16);
  el.style.opacity = 1;
  clearTimeout(flashSens._t);
  flashSens._t = setTimeout(() => { el.style.opacity = 0; }, 1200);
}
let lastStamPct = -1;
function updateStaminaBar() {
  const pct = Math.round(player.stamina);
  if (pct === lastStamPct) return;
  lastStamPct = pct;
  const bar = document.getElementById('stamina-bar');
  bar.style.width = pct + '%';
  bar.style.background = pct < 30 ? '#f66' : '#fcfc00';
}
function resetPlayer() {
  const w = gridToWorld(PLAYER_START.x, PLAYER_START.y);
  player.x = w.x; player.z = w.z;
  player.yaw = Math.PI / 2; player.pitch = 0;
  player.invuln = 3.0;
  player.vx = 0; player.vz = 0;
  player.stamina = 100; player.exhausted = false;
  camera.rotation.z = 0;
}

const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyM') { AudioEngine.toggleMute(); updateMuteIndicator(); }
  if (e.code === 'Minus' || e.code === 'Equal') {
    AudioEngine.init();
    AudioEngine.setVolume(AudioEngine.vol + (e.code === 'Equal' ? 0.05 : -0.05));
  }
  if (e.code === 'BracketLeft') adjustSens(-0.15);
  if (e.code === 'BracketRight') adjustSens(0.15);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (game.state !== 'playing') return;
  player.yaw -= e.movementX * 0.0022 * player.sens;
  player.pitch -= e.movementY * 0.0022 * player.sens;
  player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch));
});

/* ---------------- Touch controls ---------------- */
const TOUCH_MODE = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const touchMove = { x: 0, y: 0 };
let stickId = null, stickCX = 0, stickCY = 0;
let lookId = null, lookLX = 0, lookLY = 0;
const STICK_R = 48;
const LOOK_R = 48;
const lookStick = { x: 0, y: 0 };
function moveLookStick(t) {
  let dx = t.clientX - lookLX, dy = t.clientY - lookLY;
  const len = Math.hypot(dx, dy);
  if (len > LOOK_R) { dx = dx / len * LOOK_R; dy = dy / len * LOOK_R; }
  if (Math.hypot(dx, dy) < LOOK_R * 0.18) { dx = 0; dy = 0; }
  document.getElementById('look-knob').style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  lookStick.x = dx / LOOK_R; lookStick.y = dy / LOOK_R;
}
function showLookBase(x, y) {
  const base = document.getElementById('look-zone');
  base.style.left = (x - 64) + 'px';
  base.style.top = (y - 64) + 'px';
  base.style.display = 'block';
  document.getElementById('look-knob').style.transform = '';
}
function hideLookBase() {
  document.getElementById('look-zone').style.display = 'none';
  lookStick.x = 0; lookStick.y = 0;
}
function moveStick(t) {
  let dx = t.clientX - stickCX, dy = t.clientY - stickCY;
  const len = Math.hypot(dx, dy);
  if (len > STICK_R) { dx = dx / len * STICK_R; dy = dy / len * STICK_R; }
  if (Math.hypot(dx, dy) < STICK_R * 0.18) { dx = 0; dy = 0; }
  document.getElementById('stick-knob').style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  touchMove.x = dx / STICK_R; touchMove.y = dy / STICK_R;
}
let touchSprint = false;
let gyroOn = false, gyroBaseYaw = 0, gyroBaseGamma = 0, gyroGamma = 0;
function setGyro(on) {
  gyroOn = on;
  const b = document.getElementById('touch-gyro');
  if (b) b.classList.toggle('active', on);
  if (on) { gyroBaseYaw = player.yaw; gyroBaseGamma = gyroGamma; }
}
function gyroHandler(e) {
  if (e.gamma == null) return;
  gyroGamma = e.gamma;
  if (gyroOn && game.state === 'playing') player.yaw = gyroBaseYaw - (gyroGamma - gyroBaseGamma) * 0.012;
}
function resetStick() {
  stickId = null;
  touchMove.x = 0; touchMove.y = 0;
  document.getElementById('stick-knob').style.transform = '';
  document.getElementById('stick-zone').style.display = 'none';
}
function showStickBase(x, y) {
  const zone = document.getElementById('stick-zone');
  zone.style.left = (x - 64) + 'px';
  zone.style.top = (y - 64) + 'px';
  zone.style.display = 'block';
  document.getElementById('stick-knob').style.transform = '';
}
if (TOUCH_MODE) {
  document.body.classList.add('touch');
  renderer.domElement.addEventListener('touchstart', e => {
    if (game.state !== 'playing') return;
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth / 2) {
        if (stickId !== null) continue;
        stickId = t.identifier;
        stickCX = t.clientX; stickCY = t.clientY;
        showStickBase(t.clientX, t.clientY);
        moveStick(t);
      } else if (!gyroOn) {
        if (lookId === null) {
          lookId = t.identifier; lookLX = t.clientX; lookLY = t.clientY;
          showLookBase(t.clientX, t.clientY);
          moveLookStick(t);
        }
      }
    }
  }, { passive: true });
  renderer.domElement.addEventListener('touchmove', e => {
    if (game.state !== 'playing') return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) moveStick(t);
      else if (t.identifier === lookId && !gyroOn) moveLookStick(t);
    }
  }, { passive: false });
  const touchEnd = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) resetStick();
      if (t.identifier === lookId) { lookId = null; hideLookBase(); }
    }
  };
  renderer.domElement.addEventListener('touchend', touchEnd);
  renderer.domElement.addEventListener('touchcancel', touchEnd);
  document.getElementById('touch-pause').addEventListener('click', () => pauseGame());
  const sprintBtn = document.getElementById('touch-sprint');
  sprintBtn.addEventListener('touchstart', e => {
    e.preventDefault();
    touchSprint = !touchSprint;
    sprintBtn.classList.toggle('active', touchSprint);
  }, { passive: false });
  const gyroBtn = document.getElementById('touch-gyro');
  gyroBtn.addEventListener('click', () => {
    if (gyroOn) { setGyro(false); return; }
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        DeviceOrientationEvent.requestPermission().catch(() => {});
      }
    } catch (e) { /* ignore */ }
    window.addEventListener('deviceorientation', gyroHandler);
    setGyro(true);
  });
}

function canStand(wx, wz) {
  const r = player.radius;
  for (const [ox, oz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
    const g = worldToGrid(wx + ox, wz + oz);
    const t = tileAt(g.x, g.y);
    if (t === '#' || t === '-') return false;
  }
  return true;
}

function updatePlayer(dt) {
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz += 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz -= 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  iz += -touchMove.y;
  ix += touchMove.x;
  if (TOUCH_MODE && (ix !== 0 || iz !== 0)) {
    if (Math.abs(ix) > Math.abs(iz)) iz = 0;
    else if (Math.abs(iz) > Math.abs(ix)) ix = 0;
    else if (Math.abs(player.vx) >= Math.abs(player.vz)) iz = 0;
    else ix = 0;
  }
  player.moving = (ix !== 0 || iz !== 0);

  const wantSprint = (keys['ShiftLeft'] || keys['ShiftRight'] || touchSprint) && player.moving;
  let sprinting = false;
  if (wantSprint && !player.exhausted && player.stamina > 1) {
    sprinting = true;
    player.stamina = Math.max(0, player.stamina - 35 * dt);
    if (player.stamina <= 0) player.exhausted = true;
  } else {
    player.stamina = Math.min(100, player.stamina + (player.moving ? 14 : 22) * dt);
    if (player.stamina >= 25) player.exhausted = false;
  }
  if (lookStick.x !== 0 || lookStick.y !== 0) {
    player.yaw -= lookStick.x * 3.2 * dt * player.sens;
    player.pitch -= lookStick.y * 2.4 * dt * player.sens;
    player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch));
  }
  const inTunnel = Math.round(worldToGrid(player.x, player.z).y) === TUNNEL_ROW;
  const spd = player.speed * (sprinting ? 1.35 : 1) * (inTunnel ? 1.15 : 1) * TILE;
  if (inTunnel && player.moving) {
    game.windTimer -= dt;
    if (game.windTimer <= 0) {
      const panX = Math.max(-0.8, Math.min(0.8, player.x / ((COLS * TILE) / 2)));
      AudioEngine.positional(280, 0.25, 'sine', 0.03, panX, 0, 520);
      game.windTimer = 0.4;
    }
  } else {
    game.windTimer = 0;
  }
  if (sprinting) {
    game.sprintTimer -= dt;
    if (game.sprintTimer <= 0) {
      const e = player.stamina / 100;
      AudioEngine.tone(700 + e * 500, 0.08, 'sine', 0.02 + (1 - e) * 0.015);
      game.sprintTimer = 0.22;
    }
  } else {
    game.sprintTimer = 0;
  }
  const len = (ix !== 0 || iz !== 0) ? Math.hypot(ix, iz) : 1;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const tx = (-sin * iz / len + cos * ix / len) * spd;
  const tz = (-cos * iz / len - sin * ix / len) * spd;
  const accel = player.moving ? 14 : 18;
  player.vx += (tx - player.vx) * Math.min(1, accel * dt);
  player.vz += (tz - player.vz) * Math.min(1, accel * dt);
  if (canStand(player.x + player.vx * dt, player.z)) player.x += player.vx * dt;
  else player.vx = 0;
  if (canStand(player.x, player.z + player.vz * dt)) player.z += player.vz * dt;
  else player.vz = 0;
  if (player.moving && Math.abs(ix) < 0.35) {
    const lane = worldToGrid(player.x, player.z);
    const center = gridToWorld(lane.x, lane.y);
    const k = Math.min(1, 5 * dt);
    if (Math.abs(player.vx) > Math.abs(player.vz) * 1.5 &&
        isWallTile(lane.x, lane.y - 1) && isWallTile(lane.x, lane.y + 1)) {
      const nz = player.z + (center.z - player.z) * k;
      if (canStand(player.x, nz)) player.z = nz;
    } else if (Math.abs(player.vz) > Math.abs(player.vx) * 1.5 &&
        isWallTile(lane.x - 1, lane.y) && isWallTile(lane.x + 1, lane.y)) {
      const nx = player.x + (center.x - player.x) * k;
      if (canStand(nx, player.z)) player.x = nx;
    }
  }
  const rate = sprinting ? 12 : 9;
  if (player.moving) {
    player.chomp += dt * rate;
    player.bob += dt * rate;
  } else {
    player.chomp *= 0.8;
  }
  updateStaminaBar();

  const halfW = (COLS * TILE) / 2;
  if (player.x < -halfW) player.x += COLS * TILE;
  if (player.x > halfW) player.x -= COLS * TILE;

  if (player.invuln > 0) player.invuln -= dt;

  const bobY = (!REDUCED_MOTION && player.moving) ? Math.sin(player.bob) * 0.03 * TILE : 0;
  camera.position.set(player.x, EYE_H * TILE + bobY, player.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  if (game.frightPunch > 0) game.frightPunch = Math.max(0, game.frightPunch - dt * 2.5);
  const targetFov = REDUCED_MOTION ? 72 : (sprinting ? 82 : 72) + game.frightPunch * 8;
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, 8 * dt);
    camera.updateProjectionMatrix();
  }
  playerLight.position.set(player.x, TILE * 0.9, player.z);
  const flick = 1 + 0.03 * Math.sin(performance.now() * 0.0137) * Math.sin(performance.now() * 0.0073 + 1.7);
  playerLight.intensity = (game.frightTimer > 0 ? 1.6 : 1.3) * flick;

  const g = worldToGrid(player.x, player.z);
  for (const p of pellets) {
    if (p.eaten || p.gx !== g.x || p.gy !== g.y) continue;
    p.eaten = true; hidePellet(p); pelletCount--;
    if (p.power) {
      game.score += 50;
      if (game.frightTimer > 0) {
        game.frightTimer = Math.min(game.frightTimer + 3.0, 10.0);
      } else {
        game.frightTimer = Math.max(4.0, 8.0 - (game.level - 1) * 0.7);
      }
      game.ghostCombo = 0;
      game.frightPunch = 1.0;
      buzz([30, 30, 60]);
      game.frightTick = 0;
      spawnBurst(player.x, TILE * 0.6, player.z, 0xffdd66);
      game.hitstop = Math.max(game.hitstop, 0.05);
      for (const gh of ghosts) {
        if (gh.state === 'normal') {
          gh.state = 'frightened';
          gh.nmArmed = false;
          gh.setVisual('frightened');
          gh.reverse();
        }
      }
    } else {
      game.score += 10;
      WSG.waka();
    }
    updateHUD();
    if (remainingPellets() === 0) levelComplete();
  }
  checkFruitPickup();
}

/* ---------------- Ghosts ---------------- */
const GHOST_DEFS = [
  { name: 'blinky', color: 0xfc0000, corner: { x: COLS - 2, y: 1 }, release: 0 },
  { name: 'pinky', color: 0xfcb4ff, corner: { x: 1, y: 1 }, release: 1.5 },
  { name: 'inky', color: 0x00fcff, corner: { x: COLS - 2, y: ROWS - 2 }, release: 4 },
  { name: 'clyde', color: 0xfcb455, corner: { x: 1, y: ROWS - 2 }, release: 9 },
];

function buildGhostMesh(color) {
  const grp = new THREE.Group();
  const bodyMat = new THREE.MeshBasicMaterial({ color });
  const R = 0.45 * TILE;
  const profile = [new THREE.Vector2(R, -0.45 * TILE), new THREE.Vector2(R, 0.05 * TILE)];
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * Math.PI / 2;
    profile.push(new THREE.Vector2(Math.max(0.001, R * Math.cos(a)), 0.05 * TILE + R * Math.sin(a)));
  }
  const bodyGeo = new THREE.LatheGeometry(profile, 24);
  const hemIdx = [], hemBase = [], hemAngle = [];
  {
    const pos = bodyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < -0.44 * TILE) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i));
        const tri = Math.abs(((a * 4 / Math.PI) % 2 + 2) % 2 - 1);
        pos.setY(i, pos.getY(i) + tri * 0.14 * TILE);
        hemIdx.push(i);
        hemBase.push(pos.getY(i));
        hemAngle.push(a);
      }
    }
  }
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.05 * TILE;
  grp.add(body);
  const innerCap = new THREE.Mesh(
    new THREE.CircleGeometry(R, 24),
    new THREE.MeshBasicMaterial({ color: 0x050510 }));
  innerCap.rotation.x = Math.PI / 2;
  innerCap.position.y = -0.38 * TILE;
  grp.add(innerCap);
  const eyeW = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 });
  const eyeB = new THREE.MeshStandardMaterial({ color: 0x2233ff, emissive: 0x1122cc, emissiveIntensity: 0.6 });
  const eyes = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.16 * TILE, 14, 12), eyeW);
    w.scale.set(1, 1.25, 0.8);
    w.position.set(s * 0.16 * TILE, 0.32 * TILE, 0.36 * TILE);
    grp.add(w);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.08 * TILE, 10, 8), eyeB);
    b.position.set(s * 0.16 * TILE, 0.32 * TILE, 0.46 * TILE);
    grp.add(b);
    eyes.push({ w, b });
  }
  const frightMouth = new THREE.Group();
  [-0.12, -0.06, 0, 0.06, 0.12].forEach((fx, i) => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.032 * TILE, 8, 6), eyeW);
    dot.position.set(fx * TILE, (i % 2 === 0 ? 0.035 : 0.005) * TILE, 0.42 * TILE);
    frightMouth.add(dot);
  });
  frightMouth.visible = false;
  grp.add(frightMouth);
  grp.userData = { bodyMat, eyeW, eyeB, eyes, bodyParts: [body, innerCap], frightMouth, hemGeo: bodyGeo, hemIdx, hemBase, hemAngle };
  return grp;
}

class Ghost {
  constructor(def) {
    this.def = def;
    this.mesh = buildGhostMesh(def.color);
    scene.add(this.mesh);
    this.reset();
  }
  reset() {
    this.gx = HOUSE.x; this.gy = HOUSE.y;
    this.dir = { x: 0, y: 0 };
    this.targetX = HOUSE.x; this.targetY = HOUSE.y;
    this.state = 'inHouse';
    this.releaseTimer = this.def.release;
    this.bob = Math.random() * Math.PI * 2;
    this.wailTimer = Math.random() * 0.3;
    this.nmArmed = false;
    this.nmCool = 0;
    this.chaseTime = 0;
    this.nmSlow = 0;
    this.setVisual('normal');
  }
  get speed() {
    const base = Math.min(5.5, 4.1 + (game.level - 1) * 0.3);
    if (this.state === 'eaten') return base * 2.0;
    if (this.state === 'frightened') return base * 0.6;
    if (this.def.name === 'blinky') {
      if (pelletCount <= 10) return base * 1.15;
      if (pelletCount <= 20) return base * 1.1;
    }
    if (this.state === 'normal' && Math.round(this.gy) === TUNNEL_ROW) {
      const gx = Math.round(this.gx);
      if (gx <= 4 || gx >= COLS - 5) return base * 0.6;
    }
    if (this.state === 'normal' && this.chaseTime > 8) return base * 0.5;
    if (this.state === 'normal' && this.nmSlow > 0) return base * 0.5;
    if (this.state === 'normal' && game.graceTimer > 0) return base * 0.85;
    return base;
  }
  setVisual(mode) {
    const u = this.mesh.userData;
    if (mode === 'frightened' || mode === 'frightFlash') {
      const flash = mode === 'frightFlash';
      u.bodyMat.color.set(flash ? 0xeeeeff : 0x2233dd);
      u.eyeW.color.set(0xffffff); u.eyeW.emissive.set(0xffffff);
      u.eyeB.color.set(0xffccaa); u.eyeB.emissive.set(0xffaa88);
      u.bodyParts.forEach(p => p.visible = true);
      u.frightMouth.visible = true;
    } else if (mode === 'eaten') {
      u.bodyParts.forEach(p => p.visible = false);
      u.frightMouth.visible = false;
    } else {
      u.bodyMat.color.set(this.def.color);
      u.eyeW.color.set(0xffffff); u.eyeW.emissive.set(0xffffff);
      u.eyeB.color.set(0x2233ff); u.eyeB.emissive.set(0x1122cc);
      u.bodyParts.forEach(p => p.visible = true);
      u.frightMouth.visible = false;
    }
  }
  targetTile() {
    const pg = worldToGrid(player.x, player.z);
    if (this.state === 'eaten') return { x: DOOR.x, y: DOOR.y };
    if (game.mode === 'scatter' && !(this.def.name === 'blinky' && pelletCount <= 10)) return this.def.corner;
    switch (this.def.name) {
      case 'blinky': return pg;
      case 'pinky': {
        const d = playerDir();
        const overflow = (d.x === 0 && d.y === -1) ? -4 : 0;
        return { x: pg.x + d.x * 4 + overflow, y: pg.y + d.y * 4 };
      }
      case 'inky': {
        const d = playerDir();
        const overflow = (d.x === 0 && d.y === -1) ? -2 : 0;
        const a = { x: pg.x + d.x * 2 + overflow, y: pg.y + d.y * 2 };
        const b = ghosts[0];
        return { x: 2 * a.x - b.gx, y: 2 * a.y - b.gy };
      }
      case 'clyde': {
        const d = Math.hypot(this.gx - pg.x, this.gy - pg.y);
        return d > 8 ? pg : this.def.corner;
      }
    }
    return pg;
  }
  decide() {
    const cx = Math.round(this.gx), cy = Math.round(this.gy);
    const opts = [];
    const dirs = [{ x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }];
    for (const d of dirs) {
      if (d.x === -this.dir.x && d.y === -this.dir.y && (this.dir.x || this.dir.y)) continue;
      const nx = cx + d.x, ny = cy + d.y;
      if (isWallForGhost(nx, ny, this)) continue;
      if (d.y === -1 && this.state !== 'eaten' && isRedZone(cx, cy)) continue;
      if (ny === TUNNEL_ROW && (nx < 0 || nx >= COLS)) {
        if (!(cx === 0 && d.x === -1) && !(cx === COLS - 1 && d.x === 1)) continue;
      }
      opts.push(d);
    }
    if (opts.length === 0) {
      this.dir = { x: -this.dir.x, y: -this.dir.y };
      this.targetX = cx + this.dir.x;
      this.targetY = cy + this.dir.y;
      return;
    }
    if (this.state === 'frightened') {
      const pg = worldToGrid(player.x, player.z);
      let total = 0;
      const weights = opts.map(d => {
        const dist = Math.hypot(cx + d.x - pg.x, cy + d.y - pg.y);
        const wgt = game.frightTimer > 0 ? Math.pow(2, 8 - Math.min(8, dist)) : 1 + dist * dist;
        total += wgt;
        return wgt;
      });
      let roll = Math.random() * total;
      this.dir = opts[opts.length - 1];
      for (let i = 0; i < opts.length; i++) {
        roll -= weights[i];
        if (roll <= 0) { this.dir = opts[i]; break; }
      }
    } else {
      const t = this.targetTile();
      let best = opts[0], bestD = Infinity;
      for (const d of opts) {
        const dist = Math.hypot(cx + d.x - t.x, cy + d.y - t.y);
        if (dist < bestD) { bestD = dist; best = d; }
      }
      this.dir = best;
    }
    this.targetX = cx + this.dir.x;
    this.targetY = cy + this.dir.y;
  }
  reverse() {
    this.dir.x *= -1; this.dir.y *= -1;
    this.targetX = 2 * this.gx - this.targetX;
    this.targetY = 2 * this.gy - this.targetY;
  }
  update(dt) {
    this.bob += dt * 6;
    const hu = this.mesh.userData;
    if (hu.hemGeo && hu.hemIdx.length) {
      const pos = hu.hemGeo.attributes.position;
      for (let k = 0; k < hu.hemIdx.length; k++) {
        const i = hu.hemIdx[k];
        pos.setY(i, hu.hemBase[k] + Math.sin(this.bob * 1.5 + hu.hemAngle[k] * 2) * 0.04 * TILE);
      }
      pos.needsUpdate = true;
    }
    if (this.state === 'normal') {
      const pg = worldToGrid(player.x, player.z);
      const dist = Math.hypot(this.gx - pg.x, this.gy - pg.y);
      if (game.mode === 'chase' && dist < 6) {
        this.chaseTime += dt;
      } else {
        this.chaseTime = Math.max(0, this.chaseTime - dt * 2);
      }
      this.nmSlow = Math.max(0, this.nmSlow - dt);
    }
    if (this.state === 'inHouse') {
      this.releaseTimer -= dt;
      this.gx = HOUSE.x; this.gy = HOUSE.y + Math.sin(this.bob) * 0.15;
      if (this.releaseTimer <= 0) this.state = 'exiting';
    } else if (this.state === 'exiting') {
      const sp = this.speed * TILE * dt;
      const px = (this.gx - (COLS - 1) / 2) * TILE;
      const pz = (this.gy - (ROWS - 1) / 2) * TILE;
      const doorX = gridToWorld(DOOR.x, DOOR.y).x;
      if (Math.abs(px - doorX) > 0.05) {
        const d = doorX - px;
        this.gx += Math.sign(d) * Math.min(Math.abs(d), sp) / TILE;
      } else {
        this.gx = DOOR.x;
        const aboveZ = gridToWorld(DOOR.x, DOOR.y - 1).z;
        const dz = aboveZ - pz;
        if (Math.abs(dz) <= sp) {
          this.gy = DOOR.y - 1;
          this.dir = { x: -1, y: 0 };
          this.targetX = this.gx + this.dir.x;
          this.targetY = this.gy + this.dir.y;
          this.state = 'normal';
          this.setVisual('normal');
          const w = gridToWorld(this.gx, this.gy);
          spawnBurst(w.x, TILE * 0.6, w.z, this.def.color);
          AudioEngine.ghostExit();
        } else {
          this.gy -= sp / TILE;
        }
      }
    } else {
      const sp = this.speed * dt;
      const dx = this.targetX - this.gx;
      const dy = this.targetY - this.gy;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-9) {
        const step = Math.min(sp, dist);
        this.gx += (dx / dist) * step;
        this.gy += (dy / dist) * step;
        if (dist - step < 1e-9) {
          this.gx = this.targetX; this.gy = this.targetY;
          if (this.gx < 0) this.gx += COLS;
          if (this.gx > COLS - 1) this.gx -= COLS;
          if (this.state === 'eaten' && Math.round(this.gy) === DOOR.y &&
              (Math.round(this.gx) === DOOR.x || Math.round(this.gx) === DOOR.x + 1)) {
            this.gx = HOUSE.x; this.gy = HOUSE.y;
            this.state = 'exiting';
            WSG.eyes();
          } else {
            this.decide();
          }
        }
      } else {
        this.decide();
      }
    }

    const w = gridToWorld(this.gx, this.gy);
    const bobY = this.state === 'inHouse' ? 0 : Math.abs(Math.sin(this.bob)) * 0.06 * TILE;
    this.mesh.position.set(w.x, TILE * 0.6 + bobY, w.z);
    this.mesh.visible = game.state !== 'dying';
    if (this.dir.x || this.dir.y) {
      this.mesh.rotation.y = Math.atan2(this.dir.x, this.dir.y);
    }
    this.mesh.rotation.z = Math.sin(this.bob * 0.5) * 0.04;
    const look = this.state === 'eaten' || this.state === 'frightened' ? 0 : 0.05 * TILE;
    for (const e of this.mesh.userData.eyes) {
      e.b.position.x = e.w.position.x + this.dir.x * look;
      e.b.position.y = e.w.position.y + this.dir.y * look * 0.5;
    }
  }
}

function playerDir() {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  if (Math.abs(fx) > Math.abs(fz)) return { x: Math.sign(fx), y: 0 };
  return { x: 0, y: Math.sign(fz) };
}

const ghosts = GHOST_DEFS.map(d => new Ghost(d));

/* ---------------- Game state ---------------- */
const game = {
  state: 'menu', score: 0, lives: 3, level: 1,
  mode: 'scatter', modeTimer: 7, modeWave: 0, frightTimer: 0,
  ghostCombo: 0, deathTimer: 0, levelTimer: 0, readyTimer: 0,
  nextExtra: 10000, high: 0,
  resumeState: null, lockWatch: 0, highBeaten: false, lastKiller: null,
  hitstop: 0, heartTimer: 0, graceTimer: 0, riserTimer: 0,
  frightPunch: 0, stingTimer: 0, jingleTimer: 0, windTimer: 0, magnetTimer: 0,
  sprintTimer: 0, frightTick: 0,
};
function updateDangerAudio(dt) {
  if (player.invuln > 0 || game.frightTimer > 0) return;
  let minD = Infinity, swarm = 0;
  for (const g of ghosts) {
    if (g.state === 'inHouse' || g.state === 'exiting' || g.state === 'eaten' || g.state === 'frightened') continue;
    const w = gridToWorld(g.gx, g.gy);
    const d = Math.hypot(w.x - player.x, w.z - player.z) / TILE;
    if (d < minD) minD = d;
    if (d <= 3) swarm++;
  }
  if (minD > 7) return;
  game.heartTimer -= dt;
  if (game.heartTimer > 0) return;
  const urgency = 1 - minD / 7;
  AudioEngine.thump(0.08 + urgency * 0.16);
  if (swarm >= 2) AudioEngine.swarm();
  game.stingTimer -= dt;
  if (minD < 2.0 && game.stingTimer <= 0) {
    AudioEngine.dangerSting();
    game.stingTimer = 0.9;
  }
  if (minD < 1.5) {
    game.riserTimer -= dt;
    if (game.riserTimer <= 0) {
      AudioEngine.riser();
      game.riserTimer = 1.2;
    }
  }
  game.heartTimer = 0.1 + (minD / 7) * 0.6;
}
const MODE_WAVES = [7, 20, 7, 20, 5, 20, 5, Infinity];
function waveLength() {
  const w = game.modeWave;
  if (w >= MODE_WAVES.length - 1) return Infinity;
  if (game.mode === 'scatter') {
    return Math.max(2, MODE_WAVES[w] - (game.level - 1) * 2);
  }
  return 20;
}
function updateSiren(dt) {
  if (game.frightTimer > 0) { WSG.fright(); return; }
  const frac = levelTotal > 0 ? pelletCount / levelTotal : 1;
  WSG.siren(4 + Math.min(4, Math.floor((1 - frac) * 5)));
}
function requestLock() {
  if (TOUCH_MODE) return;
  try {
    const p = renderer.domElement.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) { /* pointer lock unavailable */ }
}
let wakeLock = null;
async function lockWake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* unsupported or denied */ }
}
function releaseWake() {
  if (wakeLock) { try { wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (game.state === 'playing' || game.state === 'dying')) lockWake();
  else releaseWake();
});
function pauseGame() {
  if (game.state === 'playing' || game.state === 'dying' || game.state === 'levelComplete') {
    game.resumeState = game.state;
    game.state = 'paused';
    releaseWake();
    WSG.suspend();
    updateMuteBtn();
    pauseScreen.classList.remove('hidden');
  }
}
function resumeGame() {
  pauseScreen.classList.add('hidden');
  game.state = game.resumeState || 'playing';
  game.resumeState = null;
  game.lockWatch = 1.5;
  requestLock();
  lockWake();
}
try { game.high = parseInt(localStorage.getItem('pacman3d_high') || '0', 10) || 0; } catch (e) { game.high = 0; }

const startScreen = document.getElementById('start-screen');
const pauseScreen = document.getElementById('pause-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const centerMsg = document.getElementById('center-msg');
const scoreVal = document.getElementById('score-val');
const levelVal = document.getElementById('level-val');
const livesIcons = document.getElementById('lives-icons');
const damageFlash = document.getElementById('damage-flash');
const powerTint = document.getElementById('power-tint');
const dangerVignette = document.getElementById('danger-vignette');
let lastPowerOpacity = -1;
function updatePowerTint() {
  let opacity = 0;
  if (game.frightTimer > 0) opacity = game.frightTimer < 2 ? 0.45 : 0.9;
  if (opacity !== lastPowerOpacity) {
    powerTint.style.opacity = opacity;
    lastPowerOpacity = opacity;
  }
}
let lastDangerOpacity = -1;
function updateDanger() {
  let minD = Infinity;
  for (const g of ghosts) {
    if (g.state === 'inHouse' || g.state === 'exiting' || g.state === 'eaten') continue;
    if (game.frightTimer > 0 && g.state === 'frightened') continue;
    const w = gridToWorld(g.gx, g.gy);
    const d = Math.hypot(w.x - player.x, w.z - player.z) / TILE;
    if (d < minD) minD = d;
  }
  let opacity = 0;
  if (minD <= 5 && player.invuln <= 0) {
    opacity = Math.max(0, Math.min(0.65, (5 - minD) / 5 * 0.65));
  }
  if (opacity !== lastDangerOpacity) {
    dangerVignette.style.opacity = opacity;
    lastDangerOpacity = opacity;
  }
}

function setPixelText(el, str, color, h, maxW) {
  str = String(str).toUpperCase();
  let cv = el._px;
  if (!cv) { cv = document.createElement('canvas'); el._px = cv; }
  el.textContent = '';
  el.appendChild(cv);
  el.setAttribute('data-text', str);
  const sc = Math.max(1, Math.round(h / 8));
  drawPixelRun(cv, str, color, sc, 0);
  if (maxW && cv.width * sc > maxW) {
    cv.style.width = maxW + 'px';
    cv.style.height = Math.max(4, Math.round(8 * maxW / cv.width)) + 'px';
  }
  cv.dataset.romPixel = '1';
}

function drawPixelRun(cv, str, color, sc, tracking) {
  str = String(str).toUpperCase().replace(/[\u00a0\u2013\u2014]/g, ch => ch === '\u00a0' ? ' ' : '-');
  const advances = Array.from(str, ch => ch === ' ' ? 4 : 8);
  const width = Math.max(1, advances.reduce((a, b) => a + b, 0) + Math.max(0, str.length - 1) * tracking);
  cv.width = width;
  cv.height = 8;
  cv.style.height = (8 * sc) + 'px';
  cv.style.width = (width * sc) + 'px';
  cv.style.imageRendering = 'pixelated';
  cv.style.verticalAlign = 'middle';
  const g = cv.getContext('2d');
  g.clearRect(0, 0, width, 8);
  g.fillStyle = color;
  let left = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i], glyph = PIXEL_FONT[ch] || PIXEL_FONT[' '];
    if (ch !== ' ') {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if ((glyph[y] >> (7 - x)) & 1) g.fillRect(left + x, y, 1, 1);
        }
      }
    }
    left += advances[i] + tracking;
  }
}

function pixelizeInstructionLines(root) {
  if (!root) return;
  root.querySelectorAll('.pixel-line').forEach(line => {
    const runs = [];
    for (const node of line.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.ELEMENT_NODE) continue;
      const text = (node.textContent || '').replace(/[\u00a0\u2013\u2014]/g, ch => ch === '\u00a0' ? ' ' : '-').replace(/\s+/g, ' ');
      if (!text) continue;
      const color = getComputedStyle(node.nodeType === Node.TEXT_NODE ? line : node).color || '#ccd';
      runs.push({ text, color });
    }
    while (runs.length && !runs[0].text.trim()) runs.shift();
    while (runs.length && !runs[runs.length - 1].text.trim()) runs.pop();
    if (!runs.length) return;
    runs[0].text = runs[0].text.replace(/^\s+/, '');
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
    const chars = [];
    for (const run of runs) for (const ch of run.text.toUpperCase()) chars.push({ ch, color: run.color });
    const advances = chars.map(({ ch }) => ch === ' ' ? 4 : 8);
    const width = advances.reduce((a, b) => a + b, 0);
    const scale = Math.max(1, Math.min(2, Math.floor((window.innerWidth - 48) / Math.max(1, width))));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, width); cv.height = 8;
    cv.style.width = (width * scale) + 'px'; cv.style.height = (8 * scale) + 'px';
    const maxW = window.innerWidth - 48;
    if (width * scale > maxW) {
      cv.style.width = maxW + 'px';
      cv.style.height = Math.max(6, Math.round(8 * maxW / width)) + 'px';
    }
    cv.style.display = 'block'; cv.style.imageRendering = 'pixelated';
    cv.dataset.romPixel = '1';
    cv.setAttribute('aria-label', chars.map(c => c.ch).join(''));
    const g = cv.getContext('2d');
    let x0 = 0;
    for (let i = 0; i < chars.length; i++) {
      const { ch, color } = chars[i], glyph = PIXEL_FONT[ch] || PIXEL_FONT[' '];
      if (ch !== ' ') {
        g.fillStyle = color;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          if ((glyph[y] >> (7 - x)) & 1) g.fillRect(x0 + x, y, 1, 1);
        }
      }
      x0 += advances[i];
    }
    line.replaceChildren(cv);
  });
}

function pixelizeStartScreen() {
  setPixelText(document.querySelector('#start-screen h1'), 'PAC-MAN 3D', '#fcfc00', 48, window.innerWidth - 32);
  setPixelText(document.querySelector('#start-screen h2'), 'FIRST PERSON MAZE', '#8af', 16);
  setPixelText(document.getElementById('menu-high-score'), 'HIGH SCORE ' + game.high, '#ffffff', 16);
  pixelizeInstructionLines(document.getElementById('desktop-instructions'));
  pixelizeInstructionLines(document.getElementById('touch-instructions'));
  setPixelText(document.querySelector('#start-screen .blink'), 'CLICK TO START', '#ffffff', 18);
}

function showCenterMsg(text, dur) {
  setPixelText(centerMsg, text, '#fcfc00', 40, window.innerWidth - 32);
  centerMsg.style.opacity = 1;
  clearTimeout(showCenterMsg._t);
  if (dur) showCenterMsg._t = setTimeout(() => { centerMsg.style.opacity = 0; }, dur);
}
function hideCenterMsg() { centerMsg.style.opacity = 0; clearTimeout(showCenterMsg._t); }

function updateRadar() {
  const el = document.getElementById('radar-arrow');
  if (game.state !== 'playing' || game.readyTimer > 0) { el.style.opacity = 0; return; }
  const pg = worldToGrid(player.x, player.z);
  let tx, tz;
  if (fruit && fruit.active) {
    const w = gridToWorld(FRUIT_TILE.x, FRUIT_TILE.y);
    tx = w.x; tz = w.z;
  } else {
    let best = null, bestD = Infinity;
    let fallback = null, fallbackD = Infinity;
    let bestPower = null, bestPowerD = Infinity;
    let nearestHunter = Infinity;
    for (const g of ghosts) {
      if (g.state !== 'normal') continue;
      const d = Math.hypot(g.gx - pg.x, g.gy - pg.y);
      if (d < nearestHunter) nearestHunter = d;
    }
    for (const p of pellets) {
      if (p.eaten) continue;
      const d = Math.hypot(p.gx - pg.x, p.gy - pg.y);
      if (d < fallbackD) { fallbackD = d; fallback = p; }
      let guarded = false;
      for (const g of ghosts) {
        if (g.state !== 'normal') continue;
        if (Math.hypot(g.gx - p.gx, g.gy - p.gy) < 3) { guarded = true; break; }
      }
      if (!guarded && d < bestD) { bestD = d; best = p; }
      if (p.power && d < bestPowerD) { bestPowerD = d; bestPower = p; }
    }
    if (nearestHunter < 3 && bestPower && bestPowerD < 6) { best = bestPower; bestD = bestPowerD; }
    else if (!best) { best = fallback; bestD = fallbackD; }
    if (!best || bestD < 1.5) { el.style.opacity = 0; return; }
    const w = gridToWorld(best.gx, best.gy);
    tx = w.x; tz = w.z;
  }
  const dx = tx - player.x, dz = tz - player.z;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  el.style.opacity = 0.85;
  el.style.transform = 'rotate(' + Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) + 'rad)';
}
function updateDangerSides() {
  let left = null, right = null;
  if (player.invuln <= 0) {
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    for (const g of ghosts) {
      if (g.state === 'inHouse' || g.state === 'exiting' || g.state === 'eaten') continue;
      if (game.frightTimer > 0 && g.state === 'frightened') continue;
      const w = gridToWorld(g.gx, g.gy);
      const dx = w.x - player.x, dz = w.z - player.z;
      const dist = Math.hypot(dx, dz) / TILE;
      if (dist > 5 || dist < 0.001) continue;
      const side = (dx * rx + dz * rz) / (dist * TILE);
      const urgency = (5 - dist) / 5;
      const color = g.def.color;
      const lateral = Math.abs(side) < 0.22 ? 0.48 : Math.abs(side);
      const cue = { strength: urgency * lateral, dist, color };
      const sides = Math.abs(side) < 0.22 ? ['left', 'right'] : [side < 0 ? 'left' : 'right'];
      for (const s of sides) {
        if (s === 'left' && (!left || cue.strength > left.strength)) left = cue;
        if (s === 'right' && (!right || cue.strength > right.strength)) right = cue;
      }
    }
  }
  const now = performance.now();
  const paint = (id, cue, flip) => {
    const el = document.getElementById(id);
    if (!cue) { el.style.opacity = 0; return; }
    const urgent = 5 - cue.dist;
    const pulse = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(now * (0.004 + urgent * 0.002)));
    el.style.opacity = Math.min(0.82, cue.strength * pulse * 1.35);
    const hex = cue.color.toString(16).padStart(6, '0');
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    el.style.background = 'linear-gradient(to ' + (flip ? 'left' : 'right') + ', rgba(' + r + ',' + g + ',' + b + ',0.62), transparent)';
  };
  paint('danger-left', left, false);
  paint('danger-right', right, true);
}
const LEVEL_THEMES = [
  { color: 0xffffff, emissive: 0x2424ff },
  { color: 0xffc0ff, emissive: 0xaa33ff },
  { color: 0xc0ffe0, emissive: 0x22cc88 },
  { color: 0xffe0b0, emissive: 0xcc6622 },
];
function applyLevelTheme() {
  const t = LEVEL_THEMES[(game.level - 1) % LEVEL_THEMES.length];
  wallMat.color.set(t.color);
  wallMat.emissive.set(t.emissive);
}
function updateHUD() {
  if (game.score > game.high) {
    if (!game.highBeaten && game.score > 0) {
      game.highBeaten = true;
      showCenterMsg('NEW HIGH SCORE!', 1500);
    }
    game.high = game.score;
    try { localStorage.setItem('pacman3d_high', String(game.high)); } catch (e) { /* ignore */ }
  }
  setPixelText(scoreVal, game.score, '#fcfc00', 32);
  setPixelText(document.getElementById('high-val'), game.high, '#8af', 16);
  setPixelText(document.getElementById('left-val'), pelletCount, '#fcfc00', 16);
  setPixelText(levelVal, game.level, '#fcfc00', 24);
  drawLifeIcons();
}
let lastLifeCount = -1;
function drawLifeIcons() {
  if (game.lives === lastLifeCount) return;
  lastLifeCount = game.lives;
  livesIcons.innerHTML = '';
  for (let i = 0; i < game.lives; i++) {
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 16;
    const g = cv.getContext('2d');
    g.fillStyle = '#fcfc00';
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if ((LIFE_SPRITE[y] >> (15 - x)) & 1) g.fillRect(x, y, 1, 1);
      }
    }
    livesIcons.appendChild(cv);
  }
}

function startGame() {
  game.state = 'playing';
  game.score = 0; game.lives = 3; game.level = 1;
  game.nextExtra = 8000; game.highBeaten = false; game.lastKiller = null;
  resetPellets();
  resetPlayer();
  for (const g of ghosts) g.reset();
  game.mode = 'scatter'; game.modeTimer = 7; game.modeWave = 0; game.frightTimer = 0; game.ghostCombo = 0; game.heartTimer = 0; game.riserTimer = 0;
  game.readyTimer = 1.5; game.graceTimer = 8;
  game.resumeState = null; game.lockWatch = 1.5; game.hitstop = 0;
  touchSprint = false;
  { const sb = document.getElementById('touch-sprint'); if (sb) sb.classList.remove('active'); }
  game.stingTimer = 0; game.windTimer = 0; game.magnetTimer = 0; game.sprintTimer = 0; game.frightTick = 0; game.jingleTimer = 4.1;
  resetFruit();
  applyLevelTheme();
  startScreen.classList.add('hidden');
  gameoverScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  updateHUD();
  showCenterMsg('READY!', 1500);
  WSG.stopAll();
  WSG.prelude();
  requestLock();
  lockWake();
}

function levelComplete() {
  game.state = 'levelComplete';
  WSG.stopAll();
  game.levelTimer = 2.0;
  game.score += 100 * game.level;
  AudioEngine.levelClear();
  showCenterMsg('LEVEL CLEAR!', 2000);
  updateHUD();
  const colors = [0xff2244, 0xffee00, 0x22ff66, 0x22ddff, 0xff99dd];
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 3;
    spawnBurst(player.x + Math.cos(a) * r, TILE * 0.6, player.z + Math.sin(a) * r, colors[i]);
  }
}

function nextLevel() {
  game.level++;
  resetPellets();
  resetPlayer();
  for (const g of ghosts) g.reset();
  game.mode = 'scatter'; game.modeTimer = 7; game.modeWave = 0; game.frightTimer = 0; game.ghostCombo = 0; game.heartTimer = 0; game.riserTimer = 0;
  game.readyTimer = 1.5; game.graceTimer = 8;
  game.resumeState = null; game.lockWatch = 1.5;
  game.stingTimer = 0; game.windTimer = 0; game.magnetTimer = 0; game.sprintTimer = 0; game.frightTick = 0; game.jingleTimer = 4.1;
  resetFruit();
  applyLevelTheme();
  game.state = 'playing';
  showCenterMsg('LEVEL ' + game.level, 1500);
  WSG.stopAll();
  WSG.prelude();
  updateHUD();
}

const KILLER_TIPS = {
  blinky: 'HE NEVER STOPS',
  pinky: 'DONT RUN STRAIGHT',
  inky: 'WATCH THE CORNERS',
  clyde: 'HES UNPREDICTABLE',
};
function playerDied() {
  game.state = 'dying';
  game.deathTimer = 2.5;
  game.lives--;
  const tip = KILLER_TIPS[game.lastKiller] || 'KEEP MOVING';
  showCenterMsg((game.lastKiller ? game.lastKiller.toUpperCase() + ' GOT YOU!' : 'OUCH!') + ' ' + tip, 1400);
  hideFruit();
  WSG.dead();
  buzz(150);
  damageFlash.style.background = 'rgba(255,0,0,0.35)';
  setTimeout(() => { damageFlash.style.background = 'rgba(255,0,0,0)'; }, 200);
  updateHUD();
}

function afterDeath() {
  WSG.stopAll();
  if (game.lives <= 0) {
    game.state = 'gameOver';
    document.exitPointerLock();
    releaseWake();
    AudioEngine.gameOver();
    setPixelText(document.getElementById('gameover-title'), 'GAME OVER', '#fc0000', 64, window.innerWidth - 32);
    setPixelText(document.getElementById('gameover-score'), 'SCORE ' + game.score + ' HIGH ' + game.high, '#fcfc00', 24, window.innerWidth - 32);
    setPixelText(document.getElementById('gameover-prompt'), 'CLICK TO PLAY AGAIN', '#ffffff', 20, window.innerWidth - 32);
    gameoverScreen.classList.remove('hidden');
  } else {
    resetPlayer();
    for (const g of ghosts) g.reset();
    game.mode = 'scatter'; game.modeTimer = 7; game.modeWave = 0; game.frightTimer = 0; game.ghostCombo = 0; game.heartTimer = 0; game.riserTimer = 0;
    game.readyTimer = 1.5; game.graceTimer = 8;
    game.resumeState = null; game.lockWatch = 1.5;
    game.stingTimer = 0; game.windTimer = 0; game.magnetTimer = 0; game.sprintTimer = 0; game.frightTick = 0;
    game.state = 'playing';
    camera.position.set(player.x, EYE_H * TILE, player.z);
    camera.rotation.set(0, player.yaw, 0);
    showCenterMsg('READY!', 1500);
  }
}

const WAIL_PITCH = { blinky: 220, pinky: 180, inky: 140, clyde: 100 };
const WAIL_HEAR_TILES = 14;
function updateGhostAudio(dt) {
  if (player.invuln > 0) return;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  for (const g of ghosts) {
    if (g.state !== 'normal') continue;
    const w = gridToWorld(g.gx, g.gy);
    const dx = w.x - player.x, dz = w.z - player.z;
    const distWorld = Math.hypot(dx, dz);
    const dist = distWorld / TILE;
    if (dist > WAIL_HEAR_TILES) continue;
    g.wailTimer = (g.wailTimer || 0) - dt;
    if (g.wailTimer > 0) continue;
    g.wailTimer = 0.25 + dist * 0.03;
    const pan = distWorld > 0.01 ? (dx * rx + dz * rz) / distWorld : 0;
    const targetVol = 0.05 + (1 - dist / WAIL_HEAR_TILES) * 0.1;
    g.wailVol = (g.wailVol == null) ? targetVol : g.wailVol + (targetVol - g.wailVol) * 0.5;
    const base = WAIL_PITCH[g.def.name] || 160;
    ghostWail(base, 0.18, g.wailVol, pan, g, dist);
    ghostWail(base * 1.07, 0.18, g.wailVol * 0.5, pan, g, dist);
  }
}
function ghostWail(freq, dur, vol, pan, ghost, dist) {
  const ctx = AudioEngine.ctx;
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const gn = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t);
  gn.gain.setValueAtTime(Math.max(0.001, vol), t);
  gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(gn);
  const fx = ghost._wailFx || (ghost._wailFx = {});
  if (typeof ctx.createBiquadFilter === 'function') {
    if (!fx.filter) {
      fx.filter = ctx.createBiquadFilter();
      fx.filter.type = 'lowpass';
      fx.filter.frequency.value = 8000;
    }
    const cutoff = 800 + (1 - Math.min(1, dist / WAIL_HEAR_TILES)) * 7200;
    fx.filter.frequency.setTargetAtTime(cutoff, t, 0.05);
    gn.connect(fx.filter);
    if (fx.pan) {
      if (!fx.fpWired) { fx.filter.connect(fx.pan); fx.fpWired = true; }
    } else if (typeof ctx.createStereoPanner === 'function') {
      fx.pan = ctx.createStereoPanner();
      fx.pan.connect(AudioEngine.master);
      fx.filter.connect(fx.pan);
      fx.fpWired = true;
    } else if (!fx.fmWired) {
      fx.filter.connect(AudioEngine.master);
      fx.fmWired = true;
    }
    if (!fx.pan && !fx.fmWired) { fx.filter.connect(AudioEngine.master); fx.fmWired = true; }
  } else if (typeof ctx.createStereoPanner === 'function') {
    if (!fx.pan) {
      fx.pan = ctx.createStereoPanner();
      fx.pan.connect(AudioEngine.master);
    }
    gn.connect(fx.pan);
  } else {
    gn.connect(AudioEngine.master);
  }
  if (fx.pan) fx.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan || 0)), t, 0.03);
  o.start(t); o.stop(t + dur + 0.02);
  o.onended = () => { try { o.disconnect(); gn.disconnect(); } catch (e) { /* already gone */ } };
}

function checkGhostCollisions(dt) {
  if (player.invuln > 0) return;
  dt = dt || 0;
  for (const g of ghosts) {
    if (g.state === 'inHouse' || g.state === 'exiting') continue;
    const w = gridToWorld(g.gx, g.gy);
    const d = Math.hypot(w.x - player.x, w.z - player.z);
    if (d > 0.42 * TILE) {
      if (g.state === 'normal' && dt > 0) {
        g.nmCool = Math.max(0, g.nmCool - dt);
        const dTiles = d / TILE;
        if (dTiles < 1.3 && g.nmCool <= 0) {
          g.nmArmed = true;
        } else if (g.nmArmed && dTiles > 1.6) {
          g.nmArmed = false;
          g.nmCool = 3;
          g.nmSlow = 0.6;
          game.score += 25;
          game.hitstop = Math.max(game.hitstop, 0.15);
          showCenterMsg('CLOSE CALL! +25', 800);
          AudioEngine.closeCall();
          buzz(40);
          updateHUD();
        }
      }
      continue;
    }
    if (g.state === 'frightened') {
      g.state = 'eaten';
      g.setVisual('eaten');
      g.nmArmed = false;
      game.ghostCombo++;
      const pts = 200 * Math.pow(2, game.ghostCombo - 1);
      game.score += pts;
      showCenterMsg(String(pts) + (game.ghostCombo >= 4 ? ' RAMPAGE!' : game.ghostCombo >= 3 ? ' TRIPLE!' : ''), 700);
      WSG.ghost(game.ghostCombo);
      spawnBurst(w.x, TILE * 0.6, w.z, 0x3344ff);
      game.hitstop = Math.max(game.hitstop, 0.12 + game.ghostCombo * 0.04);
      updateHUD();
    } else if (g.state === 'normal') {
      game.lastKiller = g.def.name;
      playerDied();
      return;
    }
  }
}

function updateGameMode(dt) {
  if (game.frightTimer > 0) {
    game.frightTimer -= dt;
    if (game.frightTimer <= 0) {
      game.frightTimer = 0;
      game.ghostCombo = 0;
      for (const g of ghosts) {
        if (g.state === 'frightened') { g.state = 'normal'; g.setVisual('normal'); }
      }
    } else if (game.frightTimer < 2) {
      const flash = Math.floor(performance.now() * 0.012) % 2 === 0;
      for (const g of ghosts) {
        if (g.state === 'frightened') g.setVisual(flash ? 'frightFlash' : 'frightened');
      }
      game.frightTick -= dt;
      if (game.frightTick <= 0) {
        AudioEngine.tone(2000, 0.05, 'square', 0.05);
        game.frightTick = 0.5;
      }
    }
    return;
  }
  game.modeTimer -= dt;
  if (game.modeTimer <= 0) {
    game.modeWave++;
    game.mode = (game.modeWave % 2 === 0) ? 'scatter' : 'chase';
    game.modeTimer = waveLength();
    for (const g of ghosts) {
      if (g.state === 'normal') g.reverse();
    }
  }
}

let lastBehindOpacity = -1;
function updateBehindWarn() {
  let danger = 0;
  if (game.state === 'playing' && player.invuln <= 0 && game.frightTimer <= 0) {
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    for (const g of ghosts) {
      if (g.state !== 'normal') continue;
      const w = gridToWorld(g.gx, g.gy);
      const dx = w.x - player.x, dz = w.z - player.z;
      const dist = Math.hypot(dx, dz) / TILE;
      if (dist > 3 || dist < 0.001) continue;
      if (dx * fx + dz * fz < 0) danger = Math.max(danger, 1 - dist / 3);
    }
  }
  const op = danger > 0 ? 0.4 + danger * 0.6 : 0;
  if (op !== lastBehindOpacity) {
    document.getElementById('behind-warn').style.opacity = op;
    lastBehindOpacity = op;
  }
}

/* ---------------- Minimap ---------------- */
const minimap = document.getElementById('minimap');
const mmCtx = minimap.getContext('2d');
const mmWallCanvas = document.createElement('canvas');
mmWallCanvas.width = minimap.width;
mmWallCanvas.height = minimap.height;
{
  const wctx = mmWallCanvas.getContext('2d');
  const cw = mmWallCanvas.width / COLS, ch = mmWallCanvas.height / ROWS;
  wctx.fillStyle = 'rgba(0,0,8,0.9)';
  wctx.fillRect(0, 0, mmWallCanvas.width, mmWallCanvas.height);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const c = MAZE[y][x];
    if (c === '#') {
      wctx.fillStyle = '#2244cc';
      wctx.fillRect(x * cw + 0.5, y * ch + 0.5, cw - 1, ch - 1);
    } else if (c === '-') {
      wctx.fillStyle = '#ff88bb';
      wctx.fillRect(x * cw + 0.5, y * ch + 0.5, cw - 1, ch - 1);
    }
  }
}
function drawMinimap() {
  const cw = minimap.width / COLS, ch = minimap.height / ROWS;
  mmCtx.drawImage(mmWallCanvas, 0, 0);
  const mmPulse = 2.5 + Math.sin(performance.now() * 0.008) * 1;
  for (const p of pellets) {
    if (p.eaten) continue;
    mmCtx.fillStyle = p.power ? '#ffee88' : '#d89055';
    mmCtx.beginPath();
    mmCtx.arc((p.gx + 0.5) * cw, (p.gy + 0.5) * ch, p.power ? mmPulse : 1.2, 0, Math.PI * 2);
    mmCtx.fill();
  }
  if (fruit && fruit.active) {
    mmCtx.fillStyle = '#ff2244';
    mmCtx.beginPath();
    mmCtx.arc((FRUIT_TILE.x + 0.5) * cw, (FRUIT_TILE.y + 0.5) * ch, 3 + Math.sin(performance.now() * 0.01) * 1.2, 0, Math.PI * 2);
    mmCtx.fill();
  }
  for (const g of ghosts) {
    if (g.state === 'inHouse' || g.state === 'exiting') continue;
    mmCtx.fillStyle = g.state === 'frightened' ? (Math.floor(performance.now() / 200) % 2 ? '#ffffff' : '#3344ff')
      : g.state === 'eaten' ? '#8899ff' : '#' + g.def.color.toString(16).padStart(6, '0');
    mmCtx.beginPath();
    mmCtx.arc((g.gx + 0.5) * cw, (g.gy + 0.5) * ch, 3, 0, Math.PI * 2);
    mmCtx.fill();
  }
  const pg = worldToGrid(player.x, player.z);
  mmCtx.fillStyle = '#fcfc00';
  mmCtx.beginPath();
  mmCtx.arc((pg.x + 0.5) * cw, (pg.y + 0.5) * ch, 3.2, 0, Math.PI * 2);
  mmCtx.fill();
  mmCtx.strokeStyle = '#fcfc00';
  mmCtx.beginPath();
  mmCtx.moveTo((pg.x + 0.5) * cw, (pg.y + 0.5) * ch);
  mmCtx.lineTo((pg.x + 0.5) * cw - Math.sin(player.yaw) * 6, (pg.y + 0.5) * ch - Math.cos(player.yaw) * 6);
  mmCtx.stroke();
}

/* ---------------- Chomp overlay ---------------- */
const chompCanvas = document.getElementById('chomp');
const chompCtx = chompCanvas.getContext('2d');
function drawChomp() {
  const w = chompCanvas.width, h = chompCanvas.height;
  chompCtx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h - 8, r = 46;
  const mouth = (Math.sin(player.chomp) * 0.5 + 0.5) * 0.9 + 0.08;
  chompCtx.fillStyle = '#fcfc00';
  chompCtx.beginPath();
  chompCtx.moveTo(cx, cy);
  chompCtx.arc(cx, cy, r, -Math.PI / 2 + mouth, -Math.PI / 2 - mouth + Math.PI * 2);
  chompCtx.closePath();
  chompCtx.fill();
}

/* ---------------- 3D Pac-Man death mesh ---------------- */
let pacmanMesh = null;
let pacmanMouth = null;
function buildPacmanMesh() {
  const grp = new THREE.Group();
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0xfcfc00, fog: false });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5 * TILE, 24, 16), bodyMat);
  body.position.y = 0.5 * TILE;
  grp.add(body);
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  const mouth = new THREE.Mesh(new THREE.ConeGeometry(0.5 * TILE, 1.0 * TILE, 3, 1, true), mouthMat);
  mouth.rotation.z = Math.PI / 2;
  mouth.rotation.y = Math.PI / 2;
  mouth.position.set(0, 0.5 * TILE, 0.4 * TILE);
  grp.add(mouth);
  grp.visible = false;
  scene.add(grp);
  pacmanMesh = grp;
  pacmanMouth = mouth;
}
function updatePacmanDeath(dt) {
  if (!pacmanMesh) return;
  if (game.state !== 'dying') {
    pacmanMesh.visible = false;
    return;
  }
  pacmanMesh.visible = true;
  pacmanMesh.position.set(player.x, 0, player.z);
  const t = 2.5 - game.deathTimer;
  const open = Math.min(1, t * 1.2);
  const mouthAngle = 0.1 + open * Math.PI * 0.9;
  const shrink = t > 1.8 ? Math.max(0, 1 - (t - 1.8) / 0.7) : 1;
  pacmanMesh.scale.set(shrink, shrink, shrink);
  pacmanMouth.scale.set(1, mouthAngle / Math.PI, 1);
  pacmanMouth.position.z = 0.3 * TILE * (1 - open * 0.5);
  pacmanMesh.rotation.y = player.yaw;
}

/* ---------------- Main loop ---------------- */
  buildPellets();
  buildFruit();
  buildBursts();
  buildPacmanMesh();
  resetPlayer();
updateHUD();
updateMuteIndicator();
pixelizeStartScreen();
const volSlider = document.getElementById('volume-slider');
if (volSlider) {
  volSlider.value = Math.round(AudioEngine.vol * 100);
  volSlider.addEventListener('input', e => { AudioEngine.init(); AudioEngine.setVolume(e.target.value / 100); });
}
for (const lb of document.querySelectorAll('#hud .label')) {
  setPixelText(lb, lb.textContent, '#8af', 13);
}
setPixelText(document.getElementById('behind-warn'), 'BEHIND YOU!', '#f44', 24);
setPixelText(document.getElementById('mute-indicator'), 'MUTED', '#f66', 16);

let lastTime = performance.now();
let mmTick = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  tickFps(now);
  let dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (game.hitstop > 0) {
    game.hitstop -= dt;
    dt = 0;
  }

  if (game.state === 'playing') {
    if (game.readyTimer > 0) {
      game.readyTimer -= dt;
      if (game.jingleTimer > 0) game.jingleTimer -= dt;
      if (game.readyTimer <= 0) hideCenterMsg();
    } else if (!TOUCH_MODE && document.pointerLockElement !== renderer.domElement && game.lockWatch <= 0) {
      pauseGame();
    } else {
      if (!TOUCH_MODE && document.pointerLockElement !== renderer.domElement) game.lockWatch -= dt;
      else game.lockWatch = 0;
      updatePlayer(dt);
      for (const g of ghosts) g.update(dt);
      checkGhostCollisions(dt);
      updateGameMode(dt);
      if (game.graceTimer > 0) game.graceTimer -= dt;
      if (game.jingleTimer > 0) game.jingleTimer -= dt;
      else {
        updateGhostAudio(dt);
        updateSiren(dt);
      }
      updateDangerAudio(dt);
      updateFruit(dt);
      updateFruitMagnetism(dt);
      updateRadar();
    }
    pulsePowerPellets(now);
    if (game.score >= game.nextExtra) {
      game.lives++;
      game.nextExtra += 10000;
      WSG.extralife();
      showCenterMsg('EXTRA LIFE!', 1500);
      updateHUD();
    }
  } else if (game.state === 'dying') {
    game.deathTimer -= dt;
    const t = 2.5 - game.deathTimer;
    const rise = Math.min(1, t * 3);
    const camH = EYE_H * TILE + rise * rise * 22;
    camera.position.set(player.x, camH, player.z);
    camera.rotation.set(-Math.PI / 2, 0, 0);
    if (game.deathTimer <= 0) {
      camera.rotation.set(0, player.yaw, 0);
      camera.position.set(player.x, EYE_H * TILE, player.z);
      afterDeath();
    }
  } else if (game.state === 'levelComplete') {
    game.levelTimer -= dt;
    if (!REDUCED_MOTION) camera.rotation.y += dt * 1.2;
    const theme = LEVEL_THEMES[(game.level - 1) % LEVEL_THEMES.length];
    wallMat.emissive.set(Math.floor(game.levelTimer * 6) % 2 === 0 ? 0xffffff : theme.emissive);
    if (game.levelTimer <= 0) nextLevel();
  } else if (game.state === 'menu' || game.state === 'gameOver') {
    const t = now * 0.0002;
    camera.position.set(Math.sin(t) * 6, 4, Math.cos(t) * 6);
    camera.lookAt(0, 0, 0);
  }

  if (game.state === 'playing' || game.state === 'dying' || game.state === 'levelComplete') {
    updateDoor(dt);
    updatePowerTint();
    updateDanger();
    updateDangerSides();
    updateBehindWarn();
    const ff = document.getElementById('fright-flash');
    if (ff) ff.style.opacity = (game.frightPunch || 0) * 0.6;
  }
  if ((mmTick++ & 1) === 0) drawMinimap();
  if (game.state === 'playing' || game.state === 'dying') WSG.tick(dt);
  if (player.moving || player.chomp > 0.05) drawChomp();
  updatePacmanDeath(dt);
  updateBursts(dt);
  updateGhostLights();
  updateMoodLighting(dt, now);
  renderer.render(scene, camera);
}
loop();

/* ---------------- UI events ---------------- */
startScreen.addEventListener('click', () => { AudioEngine.init(); AudioEngine.resume(); AudioEngine.click(); startGame(); });
gameoverScreen.addEventListener('click', () => { AudioEngine.resume(); AudioEngine.click(); startGame(); });
pauseScreen.addEventListener('click', () => {
  AudioEngine.resume();
  AudioEngine.click();
  resumeGame();
});
document.getElementById('restart-btn').addEventListener('click', e => {
  e.stopPropagation();
  AudioEngine.resume();
  AudioEngine.click();
  startGame();
});
function updateMuteBtn() {
  document.getElementById('mute-btn').textContent = AudioEngine.muted ? 'SOUND: OFF' : 'SOUND: ON';
}
document.getElementById('mute-btn').addEventListener('click', e => {
  e.stopPropagation();
  AudioEngine.init();
  AudioEngine.resume();
  AudioEngine.toggleMute();
  updateMuteIndicator();
  updateMuteBtn();
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== renderer.domElement) pauseGame();
});
window.addEventListener('blur', () => {
  WSG.suspend();
  for (const k in keys) keys[k] = false;
  touchMove.x = 0; touchMove.y = 0;
  touchSprint = false;
  setGyro(false);
  const sb = document.getElementById('touch-sprint');
  if (sb) sb.classList.remove('active');
  if (stickId !== null) resetStick();
  lookId = null;
  hideLookBase();
});
