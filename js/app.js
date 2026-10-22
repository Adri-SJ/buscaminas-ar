import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const $ = (id) => document.getElementById(id);

const LEVELS = [
  { size: 5, mines: 4, label: "Nivel 1" },
  { size: 7, mines: 8, label: "Nivel 2" },
  { size: 9, mines: 14, label: "Nivel 3" }
];

let currentLevel = 0;
let SIZE = LEVELS[currentLevel].size;
let MINE_COUNT = LEVELS[currentLevel].mines;

let renderer, scene, camera, reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let boardGroup = null;
let boardPlaced = false;
let gameStarted = false;
let mode = "reveal";
let cells = [];
let startTime = 0;
let timerId = null;
let raycaster = new THREE.Raycaster();
let pointer = new THREE.Vector2();
let fallbackMode = false;
let suggestedIndex = 0;
let firstMovePending = true;

const colors = {
  hidden: 0x183445,
  hidden2: 0x21495e,
  revealed: 0xbdd1d8,
  mine: 0xe84848,
  flag: 0xffc93d,
  grid: 0x071019
};

function buildGame() {
  SIZE = LEVELS[currentLevel].size;
  MINE_COUNT = LEVELS[currentLevel].mines;

  cells = Array.from({ length: SIZE * SIZE }, (_, i) => ({
    index: i,
    mine: false,
    revealed: false,
    flagged: false,
    adjacent: 0,
    mesh: null,
    label: null
  }));

  suggestedIndex = Math.floor((SIZE * SIZE) / 2);
  firstMovePending = true;

  // La casilla sugerida y sus vecinas inmediatas quedan libres de minas
  // para que el primer movimiento sea útil y no dependa de suerte.
  const sr = Math.floor(suggestedIndex / SIZE);
  const sc = suggestedIndex % SIZE;
  const forbidden = new Set();

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = sr + dr;
      const cc = sc + dc;
      if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) {
        forbidden.add(rr * SIZE + cc);
      }
    }
  }

  const pool = [...Array(SIZE * SIZE).keys()].filter(i => !forbidden.has(i));

  for (let i = 0; i < MINE_COUNT; i++) {
    const pick = Math.floor(Math.random() * pool.length);
    cells[pool.splice(pick, 1)[0]].mine = true;
  }

  for (const cell of cells) {
    const r = Math.floor(cell.index / SIZE);
    const c = cell.index % SIZE;
    let count = 0;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && cells[rr * SIZE + cc].mine) {
          count++;
        }
      }
    }

    cell.adjacent = count;
  }
}
function makeNumberTexture(text, color = "#071019") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,256,256);
  ctx.font = "900 150px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text,128,138);
  return new THREE.CanvasTexture(canvas);
}

function createBoard() {
  if (boardGroup) scene.remove(boardGroup);

  boardGroup = new THREE.Group();
  boardGroup.visible = false;

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(SIZE >= 9 ? 0.90 : SIZE >= 7 ? 0.84 : 0.72,0.025,SIZE >= 9 ? 0.90 : SIZE >= 7 ? 0.84 : 0.72),
    new THREE.MeshStandardMaterial({ color: colors.grid, metalness:.35, roughness:.7 })
  );
  base.position.y = -0.018;
  boardGroup.add(base);

  const gap = SIZE >= 9 ? 0.006 : SIZE >= 7 ? 0.008 : 0.012;
  const boardSpan = SIZE >= 9 ? 0.82 : SIZE >= 7 ? 0.76 : 0.66;
  const cellSize = (boardSpan - gap*(SIZE-1))/SIZE;
  const offset = (cellSize*(SIZE-1)+gap*(SIZE-1))/2;

  cells.forEach((cell) => {
    const r = Math.floor(cell.index / SIZE);
    const c = cell.index % SIZE;

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(cellSize,0.025,cellSize),
      new THREE.MeshStandardMaterial({
        color: (r+c)%2 ? colors.hidden : colors.hidden2,
        metalness:.25,
        roughness:.55
      })
    );
    mesh.position.set(c*(cellSize+gap)-offset,0,r*(cellSize+gap)-offset);
    mesh.userData.cellIndex = cell.index;

    if (cell.index === suggestedIndex) {
      mesh.material.color.setHex(0x24d7f2);
      mesh.material.emissive = new THREE.Color(0x0b7890);
      mesh.material.emissiveIntensity = 0.55;
    }

    cell.mesh = mesh;
    boardGroup.add(mesh);
  });

  scene.add(boardGroup);
}

function revealCell(index) {
  const cell = cells[index];
  if (!cell || cell.revealed || cell.flagged) return;

  if (!gameStarted) startGameTimer();

  if (firstMovePending) {
    firstMovePending = false;
    cells.forEach((c) => {
      if (!c.revealed && !c.flagged && c.mesh?.material?.emissive) {
        c.mesh.material.emissiveIntensity = 0;
      }
    });
  }

  cell.revealed = true;

  if (cell.mine) {
    cell.mesh.material.color.setHex(colors.mine);
    addCellLabel(cell, "✹", "#ffffff");
    navigator.vibrate?.([120,50,180]);
    revealAllMines();
    endGame(false);
    return;
  }

  cell.mesh.material.color.setHex(colors.revealed);

  if (cell.adjacent > 0) {
    const palette = ["#071019","#1677ff","#1a9b54","#e84444","#6e42d3","#7a3500","#0696a7","#222","#555"];
    addCellLabel(cell, String(cell.adjacent), palette[cell.adjacent]);
  } else {
    revealNeighbors(index);
  }

  checkWin();
}
function revealNeighbors(index) {
  const r = Math.floor(index / SIZE);
  const c = index % SIZE;
  for (let dr=-1; dr<=1; dr++) {
    for (let dc=-1; dc<=1; dc++) {
      const rr=r+dr, cc=c+dc;
      if (rr<0||rr>=SIZE||cc<0||cc>=SIZE) continue;
      const n = cells[rr*SIZE+cc];
      if (!n.revealed && !n.flagged && !n.mine) {
        n.revealed = true;
        n.mesh.material.color.setHex(colors.revealed);
        if (n.adjacent > 0) {
          const palette=["#071019","#1677ff","#1a9b54","#e84444","#6e42d3","#7a3500","#0696a7","#222","#555"];
          addCellLabel(n,String(n.adjacent),palette[n.adjacent]);
        } else if (n.index !== index) {
          revealNeighbors(n.index);
        }
      }
    }
  }
}

function addCellLabel(cell, text, color) {
  if (cell.label) return;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeNumberTexture(text,color),
      transparent:true,
      depthTest:false
    })
  );
  sprite.scale.set(.07,.07,.07);
  sprite.position.copy(cell.mesh.position);
  sprite.position.y += .035;
  sprite.rotation.x = -Math.PI/2;
  cell.label = sprite;
  boardGroup.add(sprite);
}

function toggleFlag(index) {
  const cell = cells[index];
  if (!cell || cell.revealed) return;

  if (!gameStarted) startGameTimer();

  cell.flagged = !cell.flagged;
  cell.mesh.material.color.setHex(cell.flagged ? colors.flag : ((Math.floor(index/SIZE)+(index%SIZE))%2 ? colors.hidden : colors.hidden2));

  if (cell.flagged) {
    addCellLabel(cell,"⚑","#071019");
  } else if (cell.label) {
    boardGroup.remove(cell.label);
    cell.label.material.map?.dispose();
    cell.label.material.dispose();
    cell.label = null;
  }
  updateHud();
}

function revealAllMines() {
  cells.filter(c=>c.mine).forEach(c=>{
    c.mesh.material.color.setHex(colors.mine);
    addCellLabel(c,"✹","#ffffff");
  });
}

function checkWin() {
  const safe = cells.filter(c=>!c.mine);
  if (safe.every(c=>c.revealed)) endGame(true);
}

function startGameTimer() {
  gameStarted = true;
  startTime = Date.now();
  timerId = setInterval(updateTimer,250);
}

function updateTimer() {
  if (!startTime) return;
  const s = Math.floor((Date.now()-startTime)/1000);
  $("timer").textContent = String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
}

function updateHud() {
  $("mines-left").textContent = Math.max(0, MINE_COUNT - cells.filter(c=>c.flagged).length);
  $("level-label").textContent = LEVELS[currentLevel].label;
}

function endGame(win) {
  clearInterval(timerId);
  const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;

  if (win && currentLevel < LEVELS.length - 1) {
    $("message-kicker").textContent = "NIVEL SUPERADO";
    $("message-title").textContent = "¡Buen trabajo!";
    $("message-text").textContent =
      `Completaste ${LEVELS[currentLevel].label} en ${elapsed} segundos. Sigue con ${LEVELS[currentLevel + 1].label}: ${LEVELS[currentLevel + 1].size}×${LEVELS[currentLevel + 1].size}.`;
    $("play-again").textContent = "Siguiente nivel";
    $("message").classList.remove("hidden");
    return;
  }

  $("message-kicker").textContent = win ? "CAMPO DESPEJADO" : "MINA ACTIVADA";
  $("message-title").textContent = win ? "¡Completaste todos los niveles!" : "💥 Boom";
  $("message-text").textContent = win
    ? `Terminaste ${LEVELS.length} niveles. Último tiempo: ${elapsed} segundos.`
    : "Pisaste una mina. En Buscaminas una sola explosión termina la partida.";
  $("play-again").textContent = win ? "Jugar de nuevo" : "Reintentar nivel";
  $("message").classList.remove("hidden");
}
function resetGame() {
  clearInterval(timerId);
  gameStarted = false;
  startTime = 0;
  $("timer").textContent = "00:00";
  $("message").classList.add("hidden");
  $("play-again").textContent = "Jugar otra vez";
  buildGame();
  createBoard();
  updateHud();

  if (fallbackMode) {
    boardGroup.visible = true;
    boardGroup.position.set(0,-.45,-1.25);
    boardGroup.rotation.x = -Math.PI/2.65;
    boardPlaced = true;
    $("placement-help").innerHTML = "<strong>Empieza por la casilla azul</strong><span>Está garantizada como segura.</span>";
    setTimeout(() => $("placement-help").classList.add("hidden"), 2600);
  } else {
    boardPlaced = false;
    $("placement-help").classList.remove("hidden");
  }
}

function onSelect() {
  if (!boardPlaced && reticle?.visible) {
    boardGroup.position.setFromMatrixPosition(reticle.matrix);
    boardGroup.quaternion.setFromRotationMatrix(reticle.matrix);
    boardGroup.visible = true;
    boardPlaced = true;
    $("placement-help").classList.add("hidden");
  }
}

function onScreenTap(event) {
  if (!boardPlaced || !boardGroup?.visible) return;

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX-rect.left)/rect.width)*2-1;
  pointer.y = -((event.clientY-rect.top)/rect.height)*2+1;

  raycaster.setFromCamera(pointer,camera);
  const meshes = cells.map(c=>c.mesh).filter(Boolean);
  const hits = raycaster.intersectObjects(meshes,false);
  if (!hits.length) return;

  const idx = hits[0].object.userData.cellIndex;
  if (mode==="flag") toggleFlag(idx);
  else revealCell(idx);
}

function setMode(next) {
  mode = next;
  $("reveal-mode").classList.toggle("active",mode==="reveal");
  $("flag-mode").classList.toggle("active",mode==="flag");
}

async function init() {
  if (!("xr" in navigator)) {
    startFallback("WebXR no está disponible en este navegador.");
    return;
  }

  let supported = false;
  try {
    supported = await navigator.xr.isSessionSupported("immersive-ar");
  } catch {}

  if (!supported) {
    startFallback("Este navegador no soporta AR inmersiva.");
    return;
  }

  $("intro").classList.add("hidden");
  $("game").classList.remove("hidden");
  $("placement-help").classList.remove("hidden");
  $("fallback-btn").classList.add("hidden");

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 20);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: false
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  $("scene").appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.7));
  const light = new THREE.DirectionalLight(0xffffff, 1.4);
  light.position.set(1, 2, 1);
  scene.add(light);

  buildGame();
  createBoard();
  updateHud();

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.105, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0x57e7ff,
      transparent: true,
      opacity: 0.95
    })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const controller = renderer.xr.getController(0);
  controller.addEventListener("select", onSelect);
  scene.add(controller);

  // En AR el toque sirve tanto para colocar como para jugar.
  renderer.domElement.addEventListener("pointerup", onScreenTap);

  try {
    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay"],
      domOverlay: { root: document.body }
    });

    session.addEventListener("end", () => {
      hitTestSourceRequested = false;
      hitTestSource = null;
      boardPlaced = false;
    });

    await renderer.xr.setSession(session);
    renderer.setAnimationLoop(render);
  } catch (error) {
    console.error("No se pudo iniciar AR:", error);
    $("game").classList.add("hidden");
    $("intro").classList.remove("hidden");
    startFallback("No se pudo abrir la cámara AR. Puedes usar el modo de prueba.");
  }
}

function startFallback(reason = "") {
  fallbackMode = true;

  $("intro").classList.add("hidden");
  $("game").classList.remove("hidden");
  $("fallback-btn").classList.add("hidden");

  if (!renderer) {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 20);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.setClearColor(0x071019, 1);
    $("scene").appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.7));
    const light = new THREE.DirectionalLight(0xffffff, 1.4);
    light.position.set(1, 2, 1);
    scene.add(light);

    buildGame();
    createBoard();
    updateHud();

    renderer.domElement.addEventListener("pointerup", onScreenTap);
    renderer.setAnimationLoop(() => renderer.render(scene, camera));
  }

  boardGroup.visible = true;
  boardGroup.position.set(0, -0.42, -1.15);
  boardGroup.rotation.x = -Math.PI / 2.75;
  boardPlaced = true;

  $("placement-help").classList.remove("hidden");
  $("placement-help").innerHTML =
    "<strong>Modo de prueba</strong><span>" +
    (reason || "El tablero está listo para jugar.") +
    "</span>";

  setTimeout(() => $("placement-help").classList.add("hidden"), 3200);
}
function render(timestamp,frame) {
  if (frame && !boardPlaced) {
    const session = renderer.xr.getSession();
    const refSpace = renderer.xr.getReferenceSpace();

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace("viewer").then(space => {
        session.requestHitTestSource({space}).then(source => hitTestSource = source);
      });
      session.addEventListener("end",()=>{hitTestSourceRequested=false;hitTestSource=null});
      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length) {
        const pose = hits[0].getPose(refSpace);
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
      } else reticle.visible = false;
    }
  }

  renderer.render(scene,camera);
}

$("start-btn").addEventListener("click",init);
$("reveal-mode").addEventListener("click",()=>setMode("reveal"));
$("flag-mode").addEventListener("click",()=>setMode("flag"));
$("reset-btn").addEventListener("click",resetGame);
$("play-again").addEventListener("click", () => {
  const wonCurrent = cells.filter(c => !c.mine).every(c => c.revealed);

  if (wonCurrent && currentLevel < LEVELS.length - 1) {
    currentLevel++;
  } else if (wonCurrent && currentLevel === LEVELS.length - 1) {
    currentLevel = 0;
  }

  resetGame();
});
$("fallback-btn").addEventListener("click",()=>startFallback());

addEventListener("resize",()=>{
  if (!renderer||!camera) return;
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});