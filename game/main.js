import * as THREE from './vendor/three.module.min.js';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';

/* ---------- constants ---------- */
const WORLD_HALF = 220;
const SPAWN_SAFE_RADIUS = 18;
const EYE_HEIGHT = 1.7;
const GRAVITY = -22;
const JUMP_SPEED = 8.2;
const WALK_SPEED = 6.2;
const SPRINT_MULT = 1.7;
const CAMERA_DIST = 6.5;
const CAMERA_HEIGHT = 2.4;
const FIRE_RATE = 0.16;
const MAX_AMMO = 24;
const RELOAD_TIME = 1.1;
const BOLT_SPEED = 60;
const BOLT_RANGE = 90;
const BOLT_DAMAGE = 22;
const ENEMY_TOUCH_DAMAGE = 9;
const ENEMY_TOUCH_COOLDOWN = 0.9;
const ENEMY_DETECT_RADIUS = 26;
const ENEMY_CHASE_SPEED = 3.6;
const ENEMY_MAX_HP = 60;
const MAX_ALIVE_ENEMIES = 9;
const SAVE_KEY = 'losPelletos.rpg.save.v1';

/* ---------- terrain height field (deterministic, no textures needed) ---------- */
function terrainHeight(x, z) {
  return (
    Math.sin(x * 0.02) * 3.2 +
    Math.cos(z * 0.017) * 2.6 +
    Math.sin((x + z) * 0.008) * 4.5 +
    Math.sin(x * 0.05 + z * 0.03) * 0.8
  );
}

/* ---------- persistence ---------- */
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}
function writeSave(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    /* storage unavailable, ignore */
  }
}

/* ---------- HUD ---------- */
const hud = {
  root: document.getElementById('hud'),
  hpFill: document.getElementById('hpFill'),
  hpText: document.getElementById('hpText'),
  level: document.getElementById('levelBadge'),
  xpFill: document.getElementById('xpFill'),
  quest: document.getElementById('questText'),
  ammo: document.getElementById('ammoText'),
  reload: document.getElementById('reloadText'),
  toast: document.getElementById('toast'),
  vignette: document.getElementById('vignette'),
  minimap: document.getElementById('minimap'),
  start: document.getElementById('startScreen'),
  pause: document.getElementById('pauseScreen'),
  gameover: document.getElementById('gameoverScreen'),
  goStats: document.getElementById('goStats'),
  playBtn: document.getElementById('playBtn'),
  resumeBtn: document.getElementById('resumeBtn'),
  restartBtn: document.getElementById('restartBtn'),
  continueLabel: document.getElementById('continueLabel'),
  lockHint: document.getElementById('lockHint'),
};

let toastTimer = null;
function showToast(text) {
  hud.toast.textContent = text;
  hud.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hud.toast.classList.remove('show'), 2200);
}

/* ---------- three.js scene ---------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e18);
scene.fog = new THREE.FogExp2(0x0a0e1c, 0.0075);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 600);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.34, 0.28, 0.42);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

/* lighting */
scene.add(new THREE.AmbientLight(0x3d4d70, 1.7));
const moon = new THREE.DirectionalLight(0x9fc4ff, 1.6);
moon.position.set(-60, 90, -40);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -120;
moon.shadow.camera.right = 120;
moon.shadow.camera.top = 120;
moon.shadow.camera.bottom = -120;
moon.shadow.camera.far = 300;
scene.add(moon);
const rim = new THREE.HemisphereLight(0x6fb8ff, 0x14141c, 0.85);
scene.add(rim);

const obstacles = []; // {pos:Vector3, radius}

/* sky dome (gradient) */
const skyMat = new THREE.ShaderMaterial({
  uniforms: {
    topColor: { value: new THREE.Color(0x040509) },
    bottomColor: { value: new THREE.Color(0x1c3155) },
    offset: { value: 24 },
    exponent: { value: 0.7 },
  },
  vertexShader: `varying vec3 vWorldPosition;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }`,
  fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent;
    varying vec3 vWorldPosition;
    void main() {
      float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
      gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
    }`,
  side: THREE.BackSide,
  depthWrite: false,
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 20, 14), skyMat));

/* starfield */
{
  const starCount = 900;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 420 + Math.random() * 60;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.85);
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 20;
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xdfefff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.85 });
  scene.add(new THREE.Points(starGeo, starMat));
}

/* distant capital ships (silhouettes) */
function makeShip(x, y, z, scale, rotY) {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshBasicMaterial({ color: 0x060810 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0x6fd4ff });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(14, 2.2, 4.5), hullMat);
  g.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(2.4, 6, 4), hullMat);
  bow.rotation.z = Math.PI / 2;
  bow.position.x = 9.5;
  g.add(bow);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(4, 3.2, 0.6), hullMat);
  fin.position.set(-4, 2.4, 0);
  g.add(fin);
  for (let i = 0; i < 5; i++) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.16), lightMat);
    light.position.set(-6 + i * 3, 1.15, 2.3);
    g.add(light);
  }
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  g.scale.setScalar(scale);
  scene.add(g);
}
makeShip(-140, 95, -230, 2.2, 0.4);
makeShip(170, 130, -260, 3.1, -0.6);
makeShip(60, 70, -300, 1.6, 0.15);

/* landmark portal arch */
{
  const archMat = new THREE.MeshStandardMaterial({ color: 0x0d1420, emissive: 0x3fc7ff, emissiveIntensity: 1.1, roughness: 0.25, metalness: 0.8 });
  const archX = 34;
  const archZ = -95;
  const arch = new THREE.Mesh(new THREE.TorusGeometry(10, 0.7, 10, 28), archMat);
  const ay = terrainHeight(archX, archZ) + 10;
  arch.position.set(archX, ay, archZ);
  arch.rotation.y = 0.5;
  scene.add(arch);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.6, metalness: 0.6 });
  [-9.5, 9.5].forEach((lx) => {
    const px = archX + lx * Math.cos(0.5);
    const pz = archZ - lx * Math.sin(0.5);
    const legY = terrainHeight(px, pz);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, ay - legY, 8), legMat);
    leg.position.set(px, legY + (ay - legY) / 2, pz);
    leg.castShadow = true;
    scene.add(leg);
    obstacles.push({ pos: new THREE.Vector3(px, legY, pz), radius: 1.2 });
  });
}

/* terrain */
function buildGroundTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#11141b';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5000; i++) {
    const shade = 14 + Math.floor(Math.random() * 14);
    ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 6})`;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  const cell = 64;
  for (let i = 0; i <= size; i += cell) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(79,208,255,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    ctx.beginPath();
    let px = Math.random() * size;
    let py = Math.random() * size;
    ctx.moveTo(px, py);
    for (let s = 0; s < 4; s++) {
      px += (Math.random() - 0.5) * 60;
      py += (Math.random() - 0.5) * 60;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(46, 46);
  return tex;
}

const groundGeo = new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, 140, 140);
groundGeo.rotateX(-Math.PI / 2);
{
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
  }
  groundGeo.computeVertexNormals();
}
const groundTex = buildGroundTexture();
const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, color: 0x9aa4b8, roughness: 0.92, metalness: 0.2 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.receiveShadow = true;
scene.add(ground);

/* scattered sci-fi props (crystal spires + ruined pylons + rocks) */
const propsGroup = new THREE.Group();
scene.add(propsGroup);

function addProp(mesh, x, z, radius) {
  const y = terrainHeight(x, z);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  propsGroup.add(mesh);
  obstacles.push({ pos: new THREE.Vector3(x, y, z), radius });
}

function randomOutsideSpawn() {
  let x, z;
  do {
    x = (Math.random() * 2 - 1) * (WORLD_HALF - 10);
    z = (Math.random() * 2 - 1) * (WORLD_HALF - 10);
  } while (Math.hypot(x, z) < SPAWN_SAFE_RADIUS);
  return { x, z };
}

function randomNearSpawn(minR, maxR) {
  const angle = Math.random() * Math.PI * 2;
  const dist = minR + Math.random() * (maxR - minR);
  return { x: Math.cos(angle) * dist, z: Math.sin(angle) * dist };
}

const crystalMat = new THREE.MeshStandardMaterial({
  color: 0x0d1a2e,
  emissive: 0x2fa3ff,
  emissiveIntensity: 1.4,
  roughness: 0.3,
  metalness: 0.6,
});
const rockMat = new THREE.MeshStandardMaterial({ color: 0x21242c, roughness: 1, metalness: 0.1 });
const pylonMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a22,
  emissive: 0xd4a843,
  emissiveIntensity: 0.5,
  roughness: 0.5,
  metalness: 0.7,
});

for (let i = 0; i < 42; i++) {
  const { x, z } = randomOutsideSpawn();
  const h = 3 + Math.random() * 6;
  const geo = new THREE.ConeGeometry(0.6 + Math.random() * 0.6, h, 5);
  addProp(new THREE.Mesh(geo, crystalMat), x, z, 1.1);
}
for (let i = 0; i < 36; i++) {
  const { x, z } = randomOutsideSpawn();
  const s = 1 + Math.random() * 2.4;
  const geo = new THREE.IcosahedronGeometry(s, 0);
  addProp(new THREE.Mesh(geo, rockMat), x, z, s * 0.9);
}
for (let i = 0; i < 14; i++) {
  const { x, z } = randomOutsideSpawn();
  const geo = new THREE.CylinderGeometry(1.1, 1.4, 6 + Math.random() * 4, 8);
  addProp(new THREE.Mesh(geo, pylonMat), x, z, 1.4);
}

function collideObstacles(pos, radius) {
  for (const o of obstacles) {
    const dx = pos.x - o.pos.x;
    const dz = pos.z - o.pos.z;
    const minDist = radius + o.radius;
    const d = Math.hypot(dx, dz);
    if (d < minDist && d > 0.0001) {
      const push = (minDist - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
    }
  }
}

/* ---------- player ---------- */
const player = {
  pos: new THREE.Vector3(0, 0, 6),
  vel: new THREE.Vector3(),
  yaw: Math.PI,
  pitch: -0.12,
  grounded: true,
  hp: 100,
  maxHp: 100,
  level: 1,
  xp: 0,
  xpToNext: 40,
  ammo: MAX_AMMO,
  reloading: false,
  reloadT: 0,
  fireCd: 0,
  touchCd: 0,
  kills: 0,
  alive: true,
};

const playerGroup = new THREE.Group();
scene.add(playerGroup);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.5, metalness: 0.6 });
const armorMat = new THREE.MeshStandardMaterial({ color: 0x272f42, roughness: 0.4, metalness: 0.7 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x4fd0ff, emissiveIntensity: 1.3 });
const accentMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x4fd0ff, emissiveIntensity: 0.8 });
const gunBodyMat = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.35, metalness: 0.85 });

function addMesh(group, geo, mat, x, y, z, rx, ry, rz) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  if (ry) m.rotation.y = ry;
  if (rz) m.rotation.z = rz;
  m.castShadow = true;
  group.add(m);
  return m;
}

// legs
addMesh(playerGroup, new THREE.CylinderGeometry(0.15, 0.13, 0.9, 8), bodyMat, -0.19, 0.5, 0);
addMesh(playerGroup, new THREE.CylinderGeometry(0.15, 0.13, 0.9, 8), bodyMat, 0.19, 0.5, 0);
addMesh(playerGroup, new THREE.BoxGeometry(0.22, 0.16, 0.32), armorMat, -0.19, 0.09, 0.05);
addMesh(playerGroup, new THREE.BoxGeometry(0.22, 0.16, 0.32), armorMat, 0.19, 0.09, 0.05);
// pelvis + torso
addMesh(playerGroup, new THREE.BoxGeometry(0.5, 0.32, 0.34), armorMat, 0, 0.9, 0);
addMesh(playerGroup, new THREE.BoxGeometry(0.58, 0.68, 0.38), armorMat, 0, 1.34, 0);
addMesh(playerGroup, new THREE.BoxGeometry(0.42, 0.16, 0.4), trimMat, 0, 1.02, 0);
// shoulder pads
addMesh(playerGroup, new THREE.SphereGeometry(0.18, 8, 6), armorMat, -0.42, 1.62, 0).scale.set(1, 0.75, 1);
addMesh(playerGroup, new THREE.SphereGeometry(0.18, 8, 6), armorMat, 0.42, 1.62, 0).scale.set(1, 0.75, 1);
// arms
addMesh(playerGroup, new THREE.CylinderGeometry(0.1, 0.09, 0.65, 8), bodyMat, -0.44, 1.28, 0);
addMesh(playerGroup, new THREE.CylinderGeometry(0.1, 0.09, 0.65, 8), bodyMat, 0.44, 1.28, 0);
// backpack
addMesh(playerGroup, new THREE.BoxGeometry(0.4, 0.5, 0.2), armorMat, 0, 1.36, -0.28);
addMesh(playerGroup, new THREE.BoxGeometry(0.08, 0.4, 0.06), trimMat, 0, 1.36, -0.39);
// helmet
addMesh(playerGroup, new THREE.SphereGeometry(0.24, 12, 10), armorMat, 0, 1.9, 0);
addMesh(playerGroup, new THREE.BoxGeometry(0.32, 0.1, 0.08), trimMat, 0, 1.9, 0.22);
addMesh(playerGroup, new THREE.CylinderGeometry(0.02, 0.02, 0.22, 4), accentMat, 0.2, 2.08, 0, 0, 0, 0.4);

// gun
const gunGroup = new THREE.Group();
addMesh(gunGroup, new THREE.BoxGeometry(0.16, 0.18, 0.55), gunBodyMat, 0, 0, 0);
addMesh(gunGroup, new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8), gunBodyMat, 0, 0.01, -0.5, Math.PI / 2, 0, 0);
addMesh(gunGroup, new THREE.CylinderGeometry(0.03, 0.03, 0.16, 6), trimMat, 0, 0.13, -0.15, Math.PI / 2, 0, 0);
addMesh(gunGroup, new THREE.BoxGeometry(0.1, 0.22, 0.12), gunBodyMat, 0, -0.14, 0.22);
gunGroup.position.set(0.4, 1.32, 0.25);
gunGroup.rotation.y = -0.15;
playerGroup.add(gunGroup);
const muzzleTip = new THREE.Vector3(0.4, 1.32, -0.5);

/* ---------- quests ---------- */
let quest = { target: 8, tier: 1 };
let killsThisQuest = 0;
function updateQuestHud() {
  hud.quest.textContent = `Vague ${quest.tier} — Xenites éliminés : ${killsThisQuest} / ${quest.target}`;
}

function advanceQuestIfDone() {
  if (killsThisQuest >= quest.target) {
    quest.tier += 1;
    quest.target = Math.round(quest.target * 1.4) + 2;
    killsThisQuest = 0;
    showToast(`Secteur purgé ! Nouvelle vague : ${quest.tier}`);
  }
  updateQuestHud();
}

/* ---------- enemies ---------- */
const enemies = [];
const enemyBodyMat = new THREE.MeshStandardMaterial({ color: 0x1c0f22, roughness: 0.55, metalness: 0.45 });
const enemyPlateMat = new THREE.MeshStandardMaterial({ color: 0x2a1530, roughness: 0.4, metalness: 0.6 });
const enemyBladeMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x9fe8ff, emissiveIntensity: 1.3 });

function buildEnemyModel() {
  const group = new THREE.Group();
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x1a0510, emissive: 0xff3d5e, emissiveIntensity: 1.3 });

  // hunched torso, tilted forward
  const torsoGroup = new THREE.Group();
  torsoGroup.rotation.x = 0.28;
  addMesh(torsoGroup, new THREE.CapsuleGeometry(0.34, 0.85, 4, 8), enemyBodyMat, 0, 0.75, 0);
  addMesh(torsoGroup, new THREE.ConeGeometry(0.3, 0.55, 6), enemyPlateMat, 0, 1.25, -0.05, Math.PI, 0, 0);
  // spinal spikes
  for (let i = 0; i < 4; i++) {
    addMesh(torsoGroup, new THREE.ConeGeometry(0.05, 0.24, 4), glowMat, 0, 0.55 + i * 0.24, -0.28 - i * 0.02, -0.5, 0, 0);
  }
  // head/neck extending forward
  addMesh(torsoGroup, new THREE.CylinderGeometry(0.09, 0.13, 0.42, 6), enemyBodyMat, 0, 1.42, 0.22, 0.9, 0, 0);
  const head = addMesh(torsoGroup, new THREE.ConeGeometry(0.16, 0.5, 6), enemyPlateMat, 0, 1.62, 0.5, 1.15, 0, 0);
  head.scale.set(1, 1, 1.3);
  addMesh(torsoGroup, new THREE.SphereGeometry(0.07, 8, 8), glowMat, -0.09, 1.66, 0.55);
  addMesh(torsoGroup, new THREE.SphereGeometry(0.07, 8, 8), glowMat, 0.09, 1.66, 0.55);
  group.add(torsoGroup);

  // legs (digitigrade)
  [-0.22, 0.22].forEach((lx) => {
    addMesh(group, new THREE.CylinderGeometry(0.1, 0.08, 0.5, 6), enemyBodyMat, lx, 0.62, -0.05, -0.35, 0, 0);
    addMesh(group, new THREE.CylinderGeometry(0.08, 0.06, 0.5, 6), enemyBodyMat, lx, 0.24, 0.14, 0.5, 0, 0);
  });

  // arms + energy blade in right hand
  addMesh(group, new THREE.CylinderGeometry(0.08, 0.07, 0.55, 6), enemyBodyMat, -0.36, 0.95, 0.15, 0, 0, 0.4);
  const rightArm = addMesh(group, new THREE.CylinderGeometry(0.08, 0.07, 0.55, 6), enemyBodyMat, 0.36, 0.95, 0.15, 0, 0, -0.4);
  const blade = addMesh(group, new THREE.BoxGeometry(0.05, 0.7, 0.14), enemyBladeMat, 0.58, 0.68, 0.15, 0, 0, -0.5);

  return { group, glowMat, parts: { rightArm, blade } };
}

function spawnEnemy(near) {
  if (enemies.length >= MAX_ALIVE_ENEMIES) return;
  const { x, z } = near ? randomNearSpawn(25, 55) : randomOutsideSpawn();
  const { group, glowMat } = buildEnemyModel();
  const y = terrainHeight(x, z);
  group.position.set(x, y, z);
  scene.add(group);

  const e = {
    group,
    glowMat,
    pos: new THREE.Vector3(x, y, z),
    hp: ENEMY_MAX_HP,
    maxHp: ENEMY_MAX_HP,
    state: 'wander',
    wanderTarget: new THREE.Vector3(x, y, z),
    wanderT: 0,
    alive: true,
  };
  enemies.push(e);
}

function pickWanderTarget(e) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 6 + Math.random() * 10;
  const nx = THREE.MathUtils.clamp(e.pos.x + Math.cos(angle) * dist, -WORLD_HALF, WORLD_HALF);
  const nz = THREE.MathUtils.clamp(e.pos.z + Math.sin(angle) * dist, -WORLD_HALF, WORLD_HALF);
  e.wanderTarget.set(nx, terrainHeight(nx, nz), nz);
  e.wanderT = 2 + Math.random() * 3;
}

function damageEnemy(e, amount) {
  e.hp -= amount;
  e.glowMat.emissiveIntensity = 5;
  setTimeout(() => {
    e.glowMat.emissiveIntensity = 1.3;
  }, 90);
  spawnSparks(e.group.position.clone().add(new THREE.Vector3(0, 1.1, 0)), 0xff3d5e, 10);
  if (e.hp <= 0 && e.alive) {
    e.alive = false;
    scene.remove(e.group);
    spawnSparks(e.group.position.clone().add(new THREE.Vector3(0, 1.1, 0)), 0xffb070, 22);
    player.kills += 1;
    killsThisQuest += 1;
    grantXp(14 + quest.tier * 2);
    advanceQuestIfDone();
  }
}

function grantXp(amount) {
  player.xp += amount;
  while (player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    player.level += 1;
    player.maxHp += 15;
    player.hp = player.maxHp;
    player.xpToNext = Math.round(player.xpToNext * 1.25);
    showToast(`Niveau ${player.level} atteint !`);
  }
}

/* ---------- bolts (projectiles) ---------- */
const bolts = [];
const boltGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.55, 6);
const boltMat = new THREE.MeshBasicMaterial({ color: 0x8fe6ff });
const UP = new THREE.Vector3(0, 1, 0);

function fireBolt() {
  const dir = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)).normalize();
  const tip = muzzleTip.clone();
  tip.applyAxisAngle(UP, player.yaw);
  const origin = player.pos.clone().add(tip);
  const mesh = new THREE.Mesh(boltGeo, boltMat);
  mesh.position.copy(origin);
  mesh.quaternion.setFromUnitVectors(UP, dir);
  scene.add(mesh);
  bolts.push({ mesh, dir, dist: 0 });
  spawnMuzzleFlash(origin);
}

/* ---------- particles (sparks / muzzle flash) ---------- */
const sparks = [];
const sparkGeo = new THREE.SphereGeometry(0.05, 4, 4);

function spawnSparks(pos, color, count) {
  const mat = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(sparkGeo, mat);
    mesh.position.copy(pos);
    scene.add(mesh);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3.5, (Math.random() - 0.5) * 4);
    sparks.push({ mesh, vel, life: 0.4 + Math.random() * 0.2, maxLife: 0.6 });
  }
}

function spawnMuzzleFlash(pos) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xcdefff });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), mat);
  mesh.position.copy(pos);
  scene.add(mesh);
  sparks.push({ mesh, vel: new THREE.Vector3(), life: 0.06, maxLife: 0.06 });
}

function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt;
    s.mesh.position.addScaledVector(s.vel, dt);
    s.vel.y -= 9 * dt;
    s.mesh.material.opacity = Math.max(0, s.life / s.maxLife);
    s.mesh.material.transparent = true;
    if (s.life <= 0) {
      scene.remove(s.mesh);
      s.mesh.material.dispose();
      sparks.splice(i, 1);
    }
  }
}

/* ---------- input ---------- */
const keys = new Set();
let pointerLocked = false;
let pointerLockAvailable = true; // flips off if the host (e.g. a sandboxed embed) refuses lock
let pointerLockAttempted = false;
let gameState = 'menu'; // menu | playing | paused | dead

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR') tryReload();
  if (e.code === 'Escape' && gameState === 'playing') requestPause();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function requestLock() {
  pointerLockAttempted = true;
  try {
    const result = canvas.requestPointerLock();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        pointerLockAvailable = false;
      });
    }
  } catch (e) {
    pointerLockAvailable = false;
  }
  setTimeout(() => {
    if (!pointerLocked && gameState === 'playing') {
      pointerLockAvailable = false;
      hud.lockHint.classList.add('show');
    }
  }, 700);
}

canvas.addEventListener('click', () => {
  if (gameState !== 'playing') return;
  if (!pointerLockAvailable) {
    fireIfPossible();
    return;
  }
  if (pointerLocked) fireIfPossible();
});

// pointer-locked look: relative deltas
document.addEventListener('mousemove', (e) => {
  if (gameState !== 'playing') return;
  if (pointerLocked) {
    player.yaw -= e.movementX * 0.0026;
    player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0022, -0.9, 0.55);
  } else if (!pointerLockAvailable) {
    // fallback: steer by mouse position relative to canvas center (no lock needed)
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
    const dy = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
    player.yaw -= THREE.MathUtils.clamp(dx, -1, 1) * 0.045;
    player.pitch = THREE.MathUtils.clamp(player.pitch - THREE.MathUtils.clamp(dy, -1, 1) * 0.02, -0.9, 0.55);
  }
});
document.addEventListener('pointerlockerror', () => {
  pointerLockAvailable = false;
  hud.lockHint.classList.toggle('show', gameState === 'playing');
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  hud.lockHint.classList.toggle('show', !pointerLocked && !pointerLockAvailable && gameState === 'playing');
  if (!pointerLocked && pointerLockAvailable && pointerLockAttempted && gameState === 'playing') requestPause();
});

function tryReload() {
  if (player.reloading || player.ammo === MAX_AMMO || gameState !== 'playing') return;
  player.reloading = true;
  player.reloadT = RELOAD_TIME;
  hud.reload.classList.add('show');
}
function fireIfPossible() {
  if (player.reloading || player.fireCd > 0 || player.ammo <= 0) {
    if (player.ammo <= 0) tryReload();
    return;
  }
  player.ammo -= 1;
  player.fireCd = FIRE_RATE;
  fireBolt();
}

/* ---------- screen management ---------- */
function setScreen(name) {
  hud.start.classList.toggle('show', name === 'menu');
  hud.pause.classList.toggle('show', name === 'paused');
  hud.gameover.classList.toggle('show', name === 'dead');
}

function requestPause() {
  gameState = 'paused';
  setScreen('paused');
  if (document.pointerLockElement) document.exitPointerLock();
}

function startRun(fresh) {
  const saved = fresh ? null : loadSave();
  if (saved) {
    player.level = saved.level;
    player.xp = saved.xp;
    player.xpToNext = saved.xpToNext;
    player.maxHp = saved.maxHp;
    player.kills = saved.kills || 0;
    quest.tier = saved.questTier || 1;
    quest.target = saved.questTarget || 8;
  } else {
    player.level = 1;
    player.xp = 0;
    player.xpToNext = 40;
    player.maxHp = 100;
    player.kills = 0;
    quest.tier = 1;
    quest.target = 8;
  }
  player.hp = player.maxHp;
  player.ammo = MAX_AMMO;
  player.reloading = false;
  player.pos.set(0, 0, 6);
  player.vel.set(0, 0, 0);
  player.yaw = Math.PI;
  player.alive = true;
  killsThisQuest = 0;
  updateQuestHud();

  enemies.forEach((e) => scene.remove(e.group));
  enemies.length = 0;
  for (let i = 0; i < 6; i++) spawnEnemy(true);

  gameState = 'playing';
  setScreen('playing');
  requestLock();
}

function persistProgress() {
  writeSave({
    level: player.level,
    xp: player.xp,
    xpToNext: player.xpToNext,
    maxHp: player.maxHp,
    kills: player.kills,
    questTier: quest.tier,
    questTarget: quest.target,
  });
}

function endRun() {
  gameState = 'dead';
  player.alive = false;
  persistProgress();
  hud.goStats.textContent = `Niveau atteint : ${player.level}  •  Éliminations : ${player.kills}`;
  setScreen('dead');
  if (document.pointerLockElement) document.exitPointerLock();
}

hud.playBtn.addEventListener('click', () => startRun(!loadSave()));
hud.resumeBtn.addEventListener('click', () => {
  gameState = 'playing';
  setScreen('playing');
  requestLock();
});
hud.restartBtn.addEventListener('click', () => startRun(false));

(function initMenu() {
  const saved = loadSave();
  hud.continueLabel.textContent = saved
    ? `Continuer (Niveau ${saved.level}, ${saved.kills} éliminations)`
    : 'Nouvelle partie';
  setScreen('menu');
})();

/* ---------- minimap ---------- */
const mmCtx = hud.minimap.getContext('2d');
function drawMinimap() {
  const size = hud.minimap.width;
  mmCtx.clearRect(0, 0, size, size);
  mmCtx.fillStyle = 'rgba(10,12,20,0.55)';
  mmCtx.beginPath();
  mmCtx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  mmCtx.fill();
  const scale = (size / 2) / 70;
  mmCtx.save();
  mmCtx.beginPath();
  mmCtx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  mmCtx.clip();
  for (const e of enemies) {
    const dx = (e.pos.x - player.pos.x) * scale;
    const dz = (e.pos.z - player.pos.z) * scale;
    mmCtx.fillStyle = '#ff4d67';
    mmCtx.beginPath();
    mmCtx.arc(size / 2 + dx, size / 2 + dz, 4, 0, Math.PI * 2);
    mmCtx.fill();
  }
  mmCtx.restore();
  mmCtx.fillStyle = '#f0d078';
  mmCtx.save();
  mmCtx.translate(size / 2, size / 2);
  mmCtx.rotate(player.yaw);
  mmCtx.beginPath();
  mmCtx.moveTo(0, -7);
  mmCtx.lineTo(5, 6);
  mmCtx.lineTo(-5, 6);
  mmCtx.closePath();
  mmCtx.fill();
  mmCtx.restore();
}

/* ---------- HUD refresh ---------- */
function refreshHud() {
  const hpPct = Math.max(0, player.hp / player.maxHp) * 100;
  hud.hpFill.style.width = hpPct + '%';
  hud.hpText.textContent = `${Math.max(0, Math.round(player.hp))} / ${player.maxHp}`;
  hud.level.textContent = `Niveau ${player.level}`;
  hud.xpFill.style.width = (player.xp / player.xpToNext) * 100 + '%';
  hud.ammo.textContent = player.reloading ? '...' : `${player.ammo} / ${MAX_AMMO}`;
  hud.reload.classList.toggle('show', player.reloading);
  drawMinimap();
}

/* ---------- game loop ---------- */
const clock = new THREE.Clock();
let respawnTimer = 0;

function updatePlayer(dt) {
  const forward = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.sin(player.yaw + Math.PI / 2), 0, Math.cos(player.yaw + Math.PI / 2));
  let move = new THREE.Vector3();
  if (keys.has('KeyW')) move.add(forward);
  if (keys.has('KeyS')) move.sub(forward);
  if (keys.has('KeyD')) move.add(right);
  if (keys.has('KeyA')) move.sub(right);
  const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(WALK_SPEED * (sprinting ? SPRINT_MULT : 1) * dt);
    player.pos.x += move.x;
    player.pos.z += move.z;
  }
  collideObstacles(player.pos, 0.55);
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, -WORLD_HALF + 2, WORLD_HALF - 2);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, -WORLD_HALF + 2, WORLD_HALF - 2);

  const groundY = terrainHeight(player.pos.x, player.pos.z);
  if (keys.has('Space') && player.grounded) {
    player.vel.y = JUMP_SPEED;
    player.grounded = false;
  }
  player.vel.y += GRAVITY * dt;
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= groundY) {
    player.pos.y = groundY;
    player.vel.y = 0;
    player.grounded = true;
  }

  playerGroup.position.copy(player.pos);
  playerGroup.rotation.y = player.yaw;

  const camOffset = new THREE.Vector3(
    -Math.sin(player.yaw) * CAMERA_DIST,
    CAMERA_HEIGHT + Math.sin(player.pitch) * 3,
    -Math.cos(player.yaw) * CAMERA_DIST
  );
  const desiredCamPos = player.pos.clone().add(camOffset);
  camera.position.lerp(desiredCamPos, 1 - Math.pow(0.001, dt));
  const lookTarget = player.pos.clone().add(new THREE.Vector3(0, EYE_HEIGHT, 0));
  camera.lookAt(lookTarget);

  if (player.fireCd > 0) player.fireCd -= dt;
  if (player.reloading) {
    player.reloadT -= dt;
    if (player.reloadT <= 0) {
      player.reloading = false;
      player.ammo = MAX_AMMO;
      hud.reload.classList.remove('show');
    }
  }
  if (player.touchCd > 0) player.touchCd -= dt;
}

function updateBolts(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    const step = BOLT_SPEED * dt;
    b.mesh.position.addScaledVector(b.dir, step);
    b.dist += step;
    let hit = false;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (b.mesh.position.distanceTo(e.group.position.clone().add(new THREE.Vector3(0, 1.1, 0))) < 0.8) {
        damageEnemy(e, BOLT_DAMAGE);
        hit = true;
        break;
      }
    }
    if (hit || b.dist > BOLT_RANGE) {
      scene.remove(b.mesh);
      bolts.splice(i, 1);
    }
  }
}

function flashDamage() {
  hud.vignette.classList.add('hit');
  setTimeout(() => hud.vignette.classList.remove('hit'), 220);
}

function updateEnemies(dt) {
  for (const e of enemies) {
    if (!e.alive) continue;
    const distToPlayer = e.pos.distanceTo(player.pos);
    if (distToPlayer < ENEMY_DETECT_RADIUS) e.state = 'chase';

    if (e.state === 'chase') {
      const dir = new THREE.Vector3().subVectors(player.pos, e.pos);
      dir.y = 0;
      if (dir.length() > 1.3) {
        dir.normalize().multiplyScalar(ENEMY_CHASE_SPEED * dt);
        e.pos.add(dir);
        collideObstacles(e.pos, 0.6);
        e.group.rotation.y = Math.atan2(dir.x, dir.z);
      } else if (player.touchCd <= 0) {
        player.hp -= ENEMY_TOUCH_DAMAGE;
        player.touchCd = ENEMY_TOUCH_COOLDOWN;
        flashDamage();
        if (player.hp <= 0) endRun();
      }
    } else {
      e.wanderT -= dt;
      if (e.wanderT <= 0) pickWanderTarget(e);
      const dir = new THREE.Vector3().subVectors(e.wanderTarget, e.pos);
      dir.y = 0;
      if (dir.length() > 0.5) {
        dir.normalize().multiplyScalar(1.1 * dt);
        e.pos.add(dir);
        e.group.rotation.y = Math.atan2(dir.x, dir.z);
      }
    }
    e.pos.y = terrainHeight(e.pos.x, e.pos.z);
    e.group.position.copy(e.pos);
  }
  respawnTimer -= dt;
  if (respawnTimer <= 0) {
    respawnTimer = 3.5;
    if (enemies.filter((e) => e.alive).length < Math.min(MAX_ALIVE_ENEMIES, 4 + quest.tier)) spawnEnemy();
  }
}

let lastPersist = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (gameState === 'playing') {
    updatePlayer(dt);
    updateBolts(dt);
    updateEnemies(dt);
    refreshHud();
    lastPersist += dt;
    if (lastPersist > 8) {
      lastPersist = 0;
      persistProgress();
    }
  }
  updateSparks(dt);
  composer.render(dt);
}
animate();
