// board3d.js
// Owns the Three.js scene: board, pieces, lighting, camera controls, input
// raycasting and move animation. Knows nothing about chess rules — it is
// told what to display and reports which square was tapped.

import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createPiece, makePieceMaterials } from './pieceFactory.js';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const SQUARE_SIZE = 1;
const BOARD_Y = 0; // top surface of the board

function fileOf(square) { return FILES.indexOf(square[0]); }
function rankOf(square) { return parseInt(square[1], 10) - 1; }

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class Board3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.flipped = false;
    this.pieces = new Map(); // square -> THREE.Group
    this.squareMeshes = new Map(); // square -> mesh (for raycasting)
    this.markers = { selected: null, targets: [], check: null, lastFrom: null, lastTo: null };
    this.clickHandler = null;
    this.interactive = true;
    this._animating = false;

    this._initScene();
    this._buildBoard();
    this._buildMarkerPool();
    this.materials = makePieceMaterials();
    this._bindInput();
    this._loop();
    window.addEventListener('resize', () => this._onResize());
  }

  // ---------------------------------------------------------------- scene
  _initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x140d0a);
    scene.fog = new THREE.Fog(0x140d0a, 9, 22);

    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 100);
    camera.position.set(0, 12, 15);

    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const controls = new OrbitControls(camera, this.canvas);
    controls.target.set(0, 0.2, 0);
    controls.minDistance = 8;
    controls.maxDistance = 30;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minPolarAngle = Math.PI * 0.12;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.update();

    // lighting
    const hemi = new THREE.HemisphereLight(0xfff1d8, 0x231209, 0.55);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe8c2, 1.55);
    sun.position.set(5, 10, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 30;
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.bias = -0.0015;
    scene.add(sun);

    const fill = new THREE.PointLight(0xb23a46, 0.45, 18);
    fill.position.set(-4, 4, -3);
    scene.add(fill);

    const rim = new THREE.PointLight(0xc9a14a, 0.35, 18);
    rim.position.set(4, 3, -5);
    scene.add(rim);

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this._onResize();
  }

  _onResize() {
    const wrap = this.canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- board
  _buildBoard() {
    const group = new THREE.Group();

    // table underneath
    const tableGeo = new THREE.CylinderGeometry(11, 11.6, 0.5, 48);
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x241409, roughness: 0.78, metalness: 0.05 });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.position.y = -0.62;
    table.receiveShadow = true;
    group.add(table);

    // frame
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a2316, roughness: 0.55, metalness: 0.08 });
    const frameGeo = new THREE.BoxGeometry(9.2, 0.34, 9.2);
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = -0.21;
    frame.receiveShadow = true;
    frame.castShadow = true;
    group.add(frame);

    const lightMat = new THREE.MeshStandardMaterial({ color: 0xe4cda0, roughness: 0.5, metalness: 0.02 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x7a4a2c, roughness: 0.55, metalness: 0.02 });

    this.squareMeshes.clear();
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const isLight = (f + r) % 2 === 1;
        const geo = new THREE.BoxGeometry(SQUARE_SIZE * 0.985, 0.16, SQUARE_SIZE * 0.985);
        const mat = (isLight ? lightMat : darkMat).clone();
        // subtle per-tile tint variance for an organic, non-uniform wood feel
        const jitter = Math.abs(Math.sin(f * 12.9898 + r * 78.233) * 43758.5453) % 1;
        const tint = 1 + (jitter * 0.06 - 0.03);
        mat.color.multiplyScalar(tint);
        const mesh = new THREE.Mesh(geo, mat);
        const square = FILES[f] + (r + 1);
        const pos = this._squarePosUnflipped(square);
        mesh.position.set(pos.x, BOARD_Y, pos.z);
        mesh.receiveShadow = true;
        mesh.userData.square = square;
        group.add(mesh);
        this.squareMeshes.set(square, mesh);
      }
    }

    // coordinate labels
    this._fileLabels = [];
    this._rankLabels = [];
    for (let f = 0; f < 8; f++) {
      const sprite = this._makeLabelSprite(FILES[f]);
      sprite.position.set(f - 3.5, BOARD_Y + 0.02, 4.35);
      sprite.userData.kind = 'file-label';
      sprite.userData.index = f;
      group.add(sprite);
      this._fileLabels.push(sprite);
    }
    for (let r = 0; r < 8; r++) {
      const sprite = this._makeLabelSprite(String(r + 1));
      sprite.position.set(-4.35, BOARD_Y + 0.02, 3.5 - r);
      sprite.userData.kind = 'rank-label';
      sprite.userData.index = r;
      group.add(sprite);
      this._rankLabels.push(sprite);
    }

    this.scene.add(group);
    this.boardGroup = group;
  }

  _makeLabelSprite(text) {
    const size = 64;
    const cnv = document.createElement('canvas');
    cnv.width = cnv.height = size;
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, size, size);
    ctx.font = '600 38px Inter, sans-serif';
    ctx.fillStyle = '#e3c98a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + 2);
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.4, 0.4, 0.4);
    sprite.renderOrder = 5;
    return sprite;
  }

  // unflipped world position (white near +z, viewer's default side)
  _squarePosUnflipped(square) {
    const f = fileOf(square), r = rankOf(square);
    return { x: f - 3.5, z: 3.5 - r };
  }

  squareToWorld(square) {
    const p = this._squarePosUnflipped(square);
    if (this.flipped) return { x: -p.x, z: -p.z };
    return p;
  }

  setFlipped(flipped) {
    if (this.flipped === flipped) return;
    this.flipped = flipped;
    // reposition board tiles + pieces + labels to match new orientation
    for (const [square, mesh] of this.squareMeshes) {
      const pos = this.squareToWorld(square);
      mesh.position.set(pos.x, mesh.position.y, pos.z);
    }
    for (const [square, piece] of this.pieces) {
      const pos = this.squareToWorld(square);
      piece.position.set(pos.x, piece.position.y, pos.z);
    }
    this._fileLabels.forEach(s => {
      const f = s.userData.index;
      const x = flipped ? -(f - 3.5) : (f - 3.5);
      const z = flipped ? -4.35 : 4.35;
      s.position.set(x, s.position.y, z);
    });
    this._rankLabels.forEach(s => {
      const r = s.userData.index;
      const z = flipped ? -(3.5 - r) : (3.5 - r);
      const x = flipped ? 4.35 : -4.35;
      s.position.set(x, s.position.y, z);
    });
    this._renderMarkers();
  }

  // ---------------------------------------------------------------- markers
  _buildMarkerPool() {
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xc9a14a, transparent: true, opacity: 0.85 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xe3c98a, transparent: true, opacity: 0.95 });
    const checkMat = new THREE.MeshBasicMaterial({ color: 0xc1483f, transparent: true, opacity: 0.55 });
    const lastMoveMat = new THREE.MeshBasicMaterial({ color: 0xc9a14a, transparent: true, opacity: 0.22 });

    this._dotGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.04, 20);
    this._captureRingGeo = new THREE.RingGeometry(0.34, 0.43, 28);
    this._selectRingGeo = new THREE.RingGeometry(0.40, 0.46, 32);
    this._squareGlowGeo = new THREE.PlaneGeometry(0.97, 0.97);

    this._dotMat = dotMat;
    this._ringMat = ringMat;
    this._checkMat = checkMat;
    this._lastMoveMat = lastMoveMat;

    this.markerGroup = new THREE.Group();
    this.scene.add(this.markerGroup);
  }

  setSelection({ selected, targets, captureTargets, check, lastMove }) {
    this.markers.selected = selected || null;
    this.markers.targets = targets || [];
    this.markers.captureTargets = captureTargets || [];
    this.markers.check = check || null;
    this.markers.lastMove = lastMove || null;
    this._renderMarkers();
  }

  _renderMarkers() {
    this.markerGroup.clear();

    if (this.markers.lastMove) {
      for (const sq of this.markers.lastMove) {
        const p = this.squareToWorld(sq);
        const plane = new THREE.Mesh(this._squareGlowGeo, this._lastMoveMat);
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(p.x, BOARD_Y + 0.082, p.z);
        this.markerGroup.add(plane);
      }
    }

    if (this.markers.selected) {
      const p = this.squareToWorld(this.markers.selected);
      const ring = new THREE.Mesh(this._selectRingGeo, this._ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, BOARD_Y + 0.09, p.z);
      this.markerGroup.add(ring);
    }

    for (const sq of this.markers.targets) {
      const p = this.squareToWorld(sq);
      const dot = new THREE.Mesh(this._dotGeo, this._dotMat);
      dot.position.set(p.x, BOARD_Y + 0.11, p.z);
      this.markerGroup.add(dot);
    }

    for (const sq of (this.markers.captureTargets || [])) {
      const p = this.squareToWorld(sq);
      const ring = new THREE.Mesh(this._captureRingGeo, this._dotMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, BOARD_Y + 0.09, p.z);
      this.markerGroup.add(ring);
    }

    if (this.markers.check) {
      const p = this.squareToWorld(this.markers.check);
      const glow = new THREE.Mesh(this._squareGlowGeo, this._checkMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(p.x, BOARD_Y + 0.085, p.z);
      this.markerGroup.add(glow);
    }
  }

  // ---------------------------------------------------------------- pieces
  /** Fully (re)build the piece set from a chess.js board() 8x8 array. */
  loadPosition(boardArray) {
    for (const piece of this.pieces.values()) this.boardGroup.remove(piece);
    this.pieces.clear();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = boardArray[7 - r][f]; // chess.js row0 = rank8
        if (!cell) continue;
        const square = FILES[f] + (r + 1);
        this._spawnPiece(square, cell.type, cell.color);
      }
    }
  }

  _spawnPiece(square, type, color) {
    const mesh = createPiece(type, this.materials[color]);
    const pos = this.squareToWorld(square);
    mesh.position.set(pos.x, BOARD_Y + 0.08, pos.z);
    mesh.userData.square = square;
    mesh.userData.type = type;
    mesh.userData.color = color;
    this.boardGroup.add(mesh);
    this.pieces.set(square, mesh);
    return mesh;
  }

  removePiece(square) {
    const mesh = this.pieces.get(square);
    if (mesh) {
      this.boardGroup.remove(mesh);
      this.pieces.delete(square);
    }
  }

  /**
   * Animate a chess.js-style move object: { from, to, color, piece,
   * captured, promotion, flags }. Resolves once visuals settle.
   */
  async animateMove(move) {
    this._animating = true;
    const { from, to, color, piece, captured, promotion, flags } = move;

    // en-passant: captured pawn sits behind the destination square
    if (flags && flags.includes('e') && captured) {
      const epSquare = to[0] + from[1];
      this.removePiece(epSquare);
    } else if (captured) {
      this._poofPiece(to);
    }

    // castling: also slide the rook
    let rookAnim = null;
    if (flags && (flags.includes('k') || flags.includes('q'))) {
      const rank = from[1];
      const kingSide = flags.includes('k');
      const rookFrom = (kingSide ? 'h' : 'a') + rank;
      const rookTo = (kingSide ? 'f' : 'd') + rank;
      rookAnim = this._slidePiece(rookFrom, rookTo, false);
    }

    const mainAnim = this._slidePiece(from, to, piece === 'n');

    await Promise.all([mainAnim, rookAnim].filter(Boolean));

    // promotion: swap mesh for the promoted piece type
    if (promotion) {
      this.removePiece(to);
      this._spawnPiece(to, promotion, color);
    }

    this._animating = false;
  }

  _poofPiece(square) {
    const mesh = this.pieces.get(square);
    if (!mesh) return;
    this.pieces.delete(square);
    const start = performance.now();
    const dur = 220;
    const startY = mesh.position.y;
    const baseScale = mesh.scale.x;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = t * t;
      mesh.scale.setScalar(baseScale * (1 - e));
      mesh.position.y = startY + e * 0.6;
      mesh.rotation.y += 0.25;
      if (t < 1) requestAnimationFrame(tick);
      else this.boardGroup.remove(mesh);
    };
    requestAnimationFrame(tick);
  }

  _slidePiece(from, to, isKnight) {
    return new Promise(resolve => {
      const mesh = this.pieces.get(from);
      if (!mesh) { resolve(); return; }
      this.pieces.delete(from);
      this.pieces.set(to, mesh);
      mesh.userData.square = to;

      const startPos = this.squareToWorld(from);
      const endPos = this.squareToWorld(to);
      const startY = mesh.position.y;
      const dist = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z);
      const arcHeight = isKnight ? 0.85 : Math.min(0.55, 0.25 + dist * 0.06);
      const duration = 300 + dist * 55;
      const start = performance.now();

      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const e = easeInOutCubic(t);
        const x = startPos.x + (endPos.x - startPos.x) * e;
        const z = startPos.z + (endPos.z - startPos.z) * e;
        const arc = Math.sin(Math.PI * t) * arcHeight;
        mesh.position.set(x, startY + arc, z);
        mesh.rotation.y += isKnight ? 0.12 * (1 - t) : 0;
        if (t < 1) requestAnimationFrame(tick);
        else { mesh.position.set(endPos.x, startY, endPos.z); resolve(); }
      };
      requestAnimationFrame(tick);
    });
  }

  // ---------------------------------------------------------------- input
  setInteractive(flag) { this.interactive = flag; }
  onSquareClick(cb) { this.clickHandler = cb; }

  _bindInput() {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downPos = null;

    const getSquareAt = (clientX, clientY) => {
      const rect = this.canvas.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, this.camera);
      const targets = [...this.squareMeshes.values(), ...[...this.pieces.values()]];
      const hits = raycaster.intersectObjects(targets, true);
      for (const hit of hits) {
        let obj = hit.object;
        while (obj && !obj.userData.square) obj = obj.parent;
        if (obj && obj.userData.square) return obj.userData.square;
      }
      return null;
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      downPos = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      const dt = performance.now() - downPos.t;
      downPos = null;
      // treat as a tap only if the pointer didn't drag (i.e. not an orbit gesture)
      if (moved > 8 || dt > 600) return;
      if (!this.interactive || this._animating) return;
      const square = getSquareAt(e.clientX, e.clientY);
      if (square && this.clickHandler) this.clickHandler(square);
    });
  }
}
