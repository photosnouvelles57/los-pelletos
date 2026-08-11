import * as THREE from './vendor/three.module.min.js';

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

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 500);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
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

/* terrain */
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
const groundMat = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.95, metalness: 0.15 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.receiveShadow = true;
scene.add(ground);

/* scattered sci-fi props (crystal spires + ruined pylons + rocks) */
const propsGroup = new THREE.Group();
scene.add(propsGroup);
const obstacles = []; // {pos:Vector3, radius}

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
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.55, metalness: 0.5 });
const visorMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x4fd0ff, emissiveIntensity: 2 });
const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.05, 4, 8), bodyMat);
torso.position.y = 1.05;
torso.castShadow = true;
playerGroup.add(torso);
const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.08), visorMat);
visor.position.set(0, 1.55, 0.38);
playerGroup.add(visor);
const gunMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.14, 0.14, 0.75),
  new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.4, metalness: 0.8 })
);
gunMesh.position.set(0.36, 1.05, 0.35);
playerGroup.add(gunMesh);

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
const enemyBodyMat = new THREE.MeshStandardMaterial({ color: 0x241021, roughness: 0.5, metalness: 0.4 });
const enemyEmissiveMat = new THREE.MeshStandardMaterial({ color: 0x1a0510, emissive: 0xff3d5e, emissiveIntensity: 2.2 });

function spawnEnemy(near) {
  if (enemies.length >= MAX_ALIVE_ENEMIES) return;
  const { x, z } = near ? randomNearSpawn(25, 55) : randomOutsideSpawn();
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 1.15, 4, 8), enemyBodyMat);
  body.position.y = 1.1;
  body.castShadow = true;
  group.add(body);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), enemyEmissiveMat);
  eye.position.set(0, 1.65, 0.32);
  group.add(eye);
  const y = terrainHeight(x, z);
  group.position.set(x, y, z);
  scene.add(group);

  const e = {
    group,
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
  e.group.children.forEach((c) => {
    if (c.material && c.material.emissiveIntensity !== undefined) {
      c.material.emissiveIntensity = 5;
    }
  });
  setTimeout(() => {
    e.group.children.forEach((c) => {
      if (c.material && c.material === enemyEmissiveMat) c.material.emissiveIntensity = 2.2;
    });
  }, 90);
  if (e.hp <= 0 && e.alive) {
    e.alive = false;
    scene.remove(e.group);
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
const boltGeo = new THREE.SphereGeometry(0.09, 6, 6);
const boltMat = new THREE.MeshBasicMaterial({ color: 0x7fe0ff });

function fireBolt() {
  const dir = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)).normalize();
  const origin = player.pos.clone().add(new THREE.Vector3(0, EYE_HEIGHT - 0.1, 0)).add(dir.clone().multiplyScalar(0.9));
  const mesh = new THREE.Mesh(boltGeo, boltMat);
  mesh.position.copy(origin);
  scene.add(mesh);
  bolts.push({ mesh, dir, dist: 0 });
}

/* ---------- input ---------- */
const keys = new Set();
let pointerLocked = false;
let gameState = 'menu'; // menu | playing | paused | dead

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR') tryReload();
  if (e.code === 'Escape' && gameState === 'playing') requestPause();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

canvas.addEventListener('click', () => {
  if (gameState === 'playing' && pointerLocked) fireIfPossible();
});
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked || gameState !== 'playing') return;
  player.yaw -= e.movementX * 0.0026;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0022, -0.9, 0.55);
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked && gameState === 'playing') requestPause();
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
  canvas.requestPointerLock();
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
  canvas.requestPointerLock();
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
  renderer.render(scene, camera);
}
animate();
