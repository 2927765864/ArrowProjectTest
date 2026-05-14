import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AudioManager } from './audio/AudioManager.js';
import { CONFIG } from './config.js';
import { Globals, updateShake, triggerShake, triggerHaptic, getClosestEnemy, showFloatingText, updateFloatingTexts } from './utils.js';
import { keys, joystick, initInput, refreshInputLayout } from './Input.js';
import { TargetIndicator } from './effects/TargetIndicator.js';
import { ParticleManager } from './effects/ParticleManager.js';
import { SpawnBeamEffect, SpawnTelegraphEffect } from './effects/EnemySpawnEffects.js';
import { HitSparkEffect } from './effects/HitSparkEffect.js';
import { PlayerCharacter } from './entities/Player.js';
import { Enemy } from './entities/Enemy.js';
import { PillarEnemy } from './entities/PillarEnemy.js';
import { WoodenStake } from './entities/WoodenStake.js';
import { Feather } from './entities/Feather.js';
import { setupControlPanel } from './ui/ControlPanel.js';
import { Telemetry } from './ui/Charts.js';

let isMoving = false;
let lastShootTime = 0;
let isWindupActive = false;
let windupTarget = null;
let windupTimer = 0;
// Active after the visual windup has ended but before the weapon entity is
// actually spawned and launched. The throw-recover (backswing) animation has
// already started — this delay only postpones the moment the feather pops
// into existence and starts flying. Movement during this window is treated
// as a plain cancel: the attack is fully aborted and no feather is ever
// spawned. Once the delay elapses, the feather is spawned and the remaining
// recover animation can be interrupted normally by movement (the weapon is
// already in flight at that point — the so-called "effective interrupt").
let isThrowSpawnDelayActive = false;
let throwSpawnDelayTimer = 0;
// True while the player is rotating out of the frozen attack facing into the
// movement facing (i.e. attack was interrupted by movement). While active,
// updatePlayerFacing slerps with CONFIG.attackBreakTurnSpeed instead of
// CONFIG.turnSpeed so this transition can be tuned separately. Reset once
// the body has aligned with the movement direction, or when the player
// stops moving.
let attackBreakTurnActive = false;
// True while the player is rotating from the movement facing into the
// attack facing (the reverse of attackBreakTurnActive: player has just
// stopped moving to begin a new attack, so the body needs to snap from the
// last travel direction toward the enemy / frozen aim). While active,
// updatePlayerFacing slerps with CONFIG.moveToAttackTurnSpeed. Reset once
// the body has aligned with the attack direction, when the attack ends,
// or when the player resumes movement.
let moveToAttackTurnActive = false;
// Throws are no longer capped. `throwCounter` is a monotonically-increasing
// GLOBAL counter of how many weapons the player has launched so far.
// By default, every 4th throw is a special; when
// CONFIG.disableSpecialAttackCycle is enabled, the cycle collapses to the
// three normal throws only and no launch is treated as special.
const SPECIAL_THROW_CYCLE = 4;
const NORMAL_THROW_CYCLE = 3;
let throwCounter = 0;
let recallTimers = [];
let recallMoveDistanceSinceStop = 0;
const currentVelocity = new THREE.Vector3();
const animVelocity = new THREE.Vector3();
const previousPlayerPosition = new THREE.Vector3();
const ARENA_HEIGHT = 48;
const ARENA_WIDTH = ARENA_HEIGHT * 9 / 20;
// 注意：与 Globals.visibleGroundBounds 是同一对象引用，写入这里会自动同步给所有模块（如 Enemy 的位置 clamp）。
const visibleGroundBounds = Globals.visibleGroundBounds;
visibleGroundBounds.minX = -ARENA_WIDTH * 0.5;
visibleGroundBounds.maxX =  ARENA_WIDTH * 0.5;
visibleGroundBounds.minZ = -ARENA_HEIGHT * 0.5;
visibleGroundBounds.maxZ =  ARENA_HEIGHT * 0.5;
const pendingEnemySpawns = [];

// ===== 模块级 scratch（main.js 热路径复用）=====
const _scratchInputVelocity = new THREE.Vector3();
const _scratchTargetQuat = new THREE.Quaternion();
const _scratchAxisY = new THREE.Vector3(0, 1, 0);
const _scratchHudVec = new THREE.Vector3();

let boundaryGroup = null;
let arenaFloor = null;
let solidFloorMat = null;
let checkerboardFloorMat = null;
let brickFloorMat = null;
let brickBaseLayer = null; // 砖块下方的纯色衬底（仅 brick 模式可见）
let brickBaseMat = null;
let obstacleGroup = null;

function createRenderer() {
    // antialias: true → 主 framebuffer 启用原生 MSAA，配合 DPR≤2 给角色/几何体边缘抗锯齿。
    //   注：后处理链使用独立 RT，主 framebuffer 的 MSAA 不会作用到 composer 的中间 RT，
    //   但最终 OutputPass 之后的呈现仍受益；如果后续仍需进一步抗锯齿，可考虑给 composer
    //   开 samples:4（注意 X-Ray stencil 兼容）。
    // powerPreference: 'high-performance' → 双显卡笔记本强制使用独显，避免跑核显爆 GPU。
    return new THREE.WebGLRenderer({
        antialias: true,
        stencil: true,
        powerPreference: 'high-performance'
    });
}

// 全局统一的渲染分辨率倍率：clamp 到最多 2，避免 iPhone (DPR=3) 下像素填充量爆炸，
// 同时保留 Retina (DPR=2) 屏幕的原生分辨率，避免角色/画面出现马赛克感。
function getEffectivePixelRatio() {
    return Math.min(window.devicePixelRatio || 1, 2);
}

const BLOOM_SCENE = 1;
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_SCENE);

const darkMaterial = new THREE.MeshBasicMaterial({ color: 'black' });
const materials = {};

function darkenNonBloomed(obj) {
    if (obj.userData?.isXray) {
        obj.userData.wasVisible = obj.visible;
        obj.visible = false;
        return;
    }
    if (obj.isMesh && bloomLayer.test(obj.layers) === false) {
        materials[obj.uuid] = obj.material;
        obj.material = darkMaterial;
    }
}

function restoreMaterial(obj) {
    if (obj.userData?.isXray) {
        if (obj.userData.wasVisible !== undefined) {
            obj.visible = obj.userData.wasVisible;
        }
        return;
    }
    if (materials[obj.uuid]) {
        obj.material = materials[obj.uuid];
        delete materials[obj.uuid];
    }
}

// ============================================================================
// Player crease pass
//
// Goal: 在玩家模型内部（不同部位互相遮挡 / 折角）处画出一条深色"线稿线"，
//       让纯白角色也能通过线条看清手、耳朵、四肢等结构。
//
// 做法：
//   1. 把玩家以"视图空间法线"材质渲染到一张独立纹理 (RGB=view-space normal, A=1 mask)。
//      这一步会先把主 scene 里除玩家之外的对象临时隐藏，然后给玩家替换成自定义
//      shader 材质，渲染完立刻全部恢复。
//   2. 在最终 composer 里插入一个 ShaderPass，基于这张纹理做 3x3 邻域法线差，
//      法线变化超过阈值 → 该像素判为"折角/遮挡线"，把当前画面颜色压成黑色。
//   3. shader 在比较邻居时要求邻居同样属于玩家（alpha=1），否则跳过比较。
//      这样"轮廓外"永远不会触发描边，只会在玩家模型内部各部位相接处出现。
// ============================================================================
// PlayerCreasePass 内部会再次 renderer.render(scene, camera)，是 GPU 大头之一。
// 之前为了省 GPU 把 normal RT 缩到 0.5x + NearestFilter，但会让玩家身体内部接缝处的描边
// 线条出现明显锯齿/像素感。这里恢复到 1.0x DPR 并改用 LinearFilter，使描边更细腻。
const PLAYER_CREASE_RT_SCALE = 1.0;

function createPlayerCreasePass(cssWidth, cssHeight) {
    const pr = Globals.renderer.getPixelRatio() * PLAYER_CREASE_RT_SCALE;
    const w = Math.max(1, Math.floor(cssWidth * pr));
    const h = Math.max(1, Math.floor(cssHeight * pr));

    const normalScene = new THREE.Scene();
    // 自己写一个 material：RGB=视图空间法线(0..1映射), A=mask + partId 复合编码
    //
    // A 通道编码（8bit unsigned byte，取值 0..1）：
    //   非玩家像素           → A = 0       （renderer 清屏写入）
    //   玩家像素 partId = N  → A = (N + 1) / 255   （N ∈ [0, 254]）
    // 提取：mask = A > 0.5/255.0 ; partId = round(A * 255 - 1)
    //
    // 这样用一张 RGBA8 RT 就同时承载了视图空间法线 + 部位 ID + mask，
    // 不增加纹理通道数 / 不引入 MRT，对性能零额外开销。
    //
    // 注意：每个部位的 partId 通过 mesh.userData.partId 传入；运行时为每个不同的 partId
    //       缓存一份 ShaderMaterial 实例，避免每帧改 uniform 触发 shader 切换。
    const _normalMaterialCache = new Map();   // partId → ShaderMaterial
    const _normalMatBaseUniforms = {
        uCameraNear: { value: 0.1 },
        uCameraFar:  { value: 200.0 },
    };
    const _normalVertexShader = `
        varying vec3 vViewNormal;
        varying float vViewZ;
        void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vViewZ = -mv.z;
            vViewNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * mv;
        }
    `;
    const _normalFragmentShader = `
        uniform float uCameraNear;
        uniform float uCameraFar;
        uniform float uPartId;
        varying vec3 vViewNormal;
        varying float vViewZ;
        void main() {
            // RGB: 视图空间法线映射到 0..1
            vec3 n = normalize(vViewNormal) * 0.5 + 0.5;
            // A: (partId + 1) / 255，作为玩家 mask + 部位 ID 双用途
            float a = clamp((uPartId + 1.0) / 255.0, 1.0/255.0, 1.0);
            gl_FragColor = vec4(n, a);
        }
    `;
    const getNormalMaterial = (partId) => {
        const key = partId | 0;
        let mat = _normalMaterialCache.get(key);
        if (mat) return mat;
        mat = new THREE.ShaderMaterial({
            uniforms: {
                uCameraNear: _normalMatBaseUniforms.uCameraNear,   // 共享引用，外部统一更新
                uCameraFar:  _normalMatBaseUniforms.uCameraFar,
                uPartId:     { value: key },
            },
            vertexShader: _normalVertexShader,
            fragmentShader: _normalFragmentShader,
            side: THREE.DoubleSide,
            // 关键：关闭混合，让 (RGB, A) 原样写入 RT。
            // 否则在 NormalBlending 下，partId=0 时 srcAlpha=1/255 ≈ 0.004，
            // 会把源色按 ~0% 权重与黑色背景混合 → 法线信息几乎全部丢失。
            transparent: false,
            blending: THREE.NoBlending,
            depthTest: true,
            depthWrite: true,
        });
        _normalMaterialCache.set(key, mat);
        return mat;
    };

    const renderTarget = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false,
    });

    const creaseMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse:   { value: null },                   // 当前画面
            tPlayerN:   { value: renderTarget.texture },   // 玩家视图空间法线 (RGB) + mask+partId (A)
            uTexel:     { value: new THREE.Vector2(1 / w, 1 / h) },
            uThickness: { value: 1.2 },
            uNormalThreshold: { value: 0.25 },             // 法线差超过这个阈值就算折角 / 遮挡边
            uLineColor: { value: new THREE.Color(0x000000) },
            uLineOpacity: { value: 1.0 },
            uInnerOnly: { value: 1.0 },                    // 1 = 只在内部画；0 = 连同轮廓也画
            uPartSeamsEnabled: { value: 1.0 },             // 1 = 启用部位 ID 接缝线；0 = 退化为纯法线判据
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform sampler2D tPlayerN;
            uniform vec2 uTexel;
            uniform float uThickness;
            uniform float uNormalThreshold;
            uniform vec3 uLineColor;
            uniform float uLineOpacity;
            uniform float uInnerOnly;
            uniform float uPartSeamsEnabled;
            varying vec2 vUv;

            vec4 sampleN(vec2 uv) {
                return texture2D(tPlayerN, uv);
            }

            // A 通道编码: A = (partId + 1) / 255 ; 非玩家像素 A = 0
            // mask: A > 0.5/255 ≈ 0.00196
            // partId: round(A * 255 - 1)，非玩家时取 -1
            //
            // 为了避免分支，下面统一用 step / mix，并在 ID 比较时
            // 用 abs(idA - idB) > 0.5 (容忍量化误差) 判断"部位不同"。

            void main() {
                vec4 baseCol = texture2D(tDiffuse, vUv);
                vec4 center = sampleN(vUv);

                float maskThr = 0.5 / 255.0;
                // 不是玩家像素 → 直接输出原画面
                if (center.a < maskThr) {
                    gl_FragColor = baseCol;
                    return;
                }

                vec2 o = uTexel * max(uThickness, 0.0);
                vec4 nN = sampleN(vUv + vec2(0.0,  o.y));
                vec4 nS = sampleN(vUv + vec2(0.0, -o.y));
                vec4 nE = sampleN(vUv + vec2( o.x, 0.0));
                vec4 nW = sampleN(vUv + vec2(-o.x, 0.0));

                // ---- 已编号部位 mask：partId ≥ 1 ⇒ A > 1.5/255 ----
                //   未标号的 mesh（关节球 / detail / 武器等）partId=0 → A=1/255 ≈ 0.00392
                //   已标号部位 partId∈[1,11] → A ∈ [2/255, 12/255]
                //   关节球 (partId=0) 作为"完全缓冲带"——既不参与法线判据，也不参与 ID 判据：
                //   1. 球面自身曲率剧烈，若纳入法线判据会让整个关节球被一圈描边圈住；
                //   2. 关节球处于肢体接缝处，作为视觉缓冲，画面应"穿过"它而无任何线条。
                float partThr = 1.5 / 255.0;
                float cHas = step(partThr, center.a);
                float nHas = step(partThr, nN.a);
                float sHas = step(partThr, nS.a);
                float eHas = step(partThr, nE.a);
                float wHas = step(partThr, nW.a);

                // ---- 法线判据：双方都必须是"已编号部位"才比较 ----
                // 这样关节球内部 / 关节球与相邻部位的接触面都不会出线。
                float dN = (cHas * nHas > 0.5) ? distance(center.rgb, nN.rgb) : 0.0;
                float dS = (cHas * sHas > 0.5) ? distance(center.rgb, nS.rgb) : 0.0;
                float dE = (cHas * eHas > 0.5) ? distance(center.rgb, nE.rgb) : 0.0;
                float dW = (cHas * wHas > 0.5) ? distance(center.rgb, nW.rgb) : 0.0;
                float normalEdge = max(max(dN, dS), max(dE, dW));
                float normalSeam = smoothstep(uNormalThreshold, uNormalThreshold * 1.6, normalEdge);

                // ---- ID 判据：同样要求双方已编号 ----
                float idTol = 0.5 / 255.0;
                float idDiffN = step(idTol, abs(center.a - nN.a)) * cHas * nHas;
                float idDiffS = step(idTol, abs(center.a - nS.a)) * cHas * sHas;
                float idDiffE = step(idTol, abs(center.a - nE.a)) * cHas * eHas;
                float idDiffW = step(idTol, abs(center.a - nW.a)) * cHas * wHas;
                float partSeam = max(max(idDiffN, idDiffS), max(idDiffE, idDiffW));
                partSeam *= uPartSeamsEnabled;

                // 合并两种判据：取 max → 任一触发即画线
                float seam = max(normalSeam, partSeam);

                // 如果显式要求画轮廓：把非玩家邻居变成强边
                if (uInnerOnly < 0.5) {
                    float outside = 0.0;
                    outside = max(outside, 1.0 - step(maskThr, nN.a));
                    outside = max(outside, 1.0 - step(maskThr, nS.a));
                    outside = max(outside, 1.0 - step(maskThr, nE.a));
                    outside = max(outside, 1.0 - step(maskThr, nW.a));
                    seam = max(seam, outside);
                }

                float edge = seam * uLineOpacity;
                gl_FragColor = vec4(mix(baseCol.rgb, uLineColor, edge), baseCol.a);
            }
        `,
    });

    const pass = new ShaderPass(creaseMaterial, 'tDiffuse');
    pass.needsSwap = true;

    // 让 pass 自己负责在 render 前渲染玩家 normal 纹理
    const baseRender = pass.render.bind(pass);
    // 复用一个 Color 实例，避免每帧 new
    const _scratchClearColor = new THREE.Color();
    pass.render = function(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
        const player = Globals.player;
        const enabled = !!CONFIG.playerOutlineEnabled && player && player.mesh;
        pass.uniforms.uLineOpacity.value = enabled ? 1.0 : 0.0;
        pass.uniforms.uThickness.value = Math.max(0, CONFIG.playerOutlineThickness ?? 0);
        pass.uniforms.uPartSeamsEnabled.value = (CONFIG.playerOutlinePartSeams !== false) ? 1.0 : 0.0;

        if (enabled) {
            // ---- 渲染玩家 view-space normal 到 renderTarget ----
            // 思路：不 detach 玩家。改为临时给整个主场景里非 player 的子树 visible=false，
            // 再把 player 子树的材质换成 normalMaterial，渲染一次。随后全部恢复。
            const scene = Globals.scene;
            const playerMesh = player.mesh;

            const tailGroup = player.tailWorldGroup || null;
            const hiddenNodes = [];
            for (const child of scene.children) {
                if (child === playerMesh) continue;
                if (child === tailGroup) continue;
                if (child.visible) {
                    hiddenNodes.push(child);
                    child.visible = false;
                }
            }
            // 玩家内部隐藏：xray / 血环 / 脚底环 等不参与法线计算
            const swappedMats = [];
            const swapMaterials = (root) => {
                root.traverse((c) => {
                    if (!c.isMesh) return;
                    if (c.userData && c.userData.isXray) {
                        if (c.visible) {
                            swappedMats.push({ obj: c, mat: null, vis: c.visible });
                            c.visible = false;
                        }
                        return;
                    }
                    // 按部位 ID 选取对应材质：partId 决定 A 通道写入值
                    // 未标 partId 的 mesh（关节球 / 武器 / detail / 眼鼻胡须等）
                    // 视为 partId=0 → A 仍 > 0 (=1/255) 起 mask 作用，但 ID 比较时
                    // 因为 bothHavePart=0 不会触发 ID 边判定，效果上充当"缓冲带"。
                    const pid = (c.userData && typeof c.userData.partId === 'number')
                        ? c.userData.partId : 0;
                    swappedMats.push({ obj: c, mat: c.material, vis: c.visible });
                    c.material = getNormalMaterial(pid);
                });
            };
            swapMaterials(playerMesh);
            if (tailGroup) swapMaterials(tailGroup);

            const prevRT = renderer.getRenderTarget();
            renderer.getClearColor(_scratchClearColor);
            const prevClearAlpha = renderer.getClearAlpha();
            const prevAutoClear = renderer.autoClear;

            renderer.autoClear = true;
            renderer.setClearColor(0x000000, 0);
            renderer.setRenderTarget(renderTarget);
            renderer.render(scene, Globals.camera);
            renderer.setRenderTarget(prevRT);
            renderer.setClearColor(_scratchClearColor, prevClearAlpha);
            renderer.autoClear = prevAutoClear;

            // 恢复
            for (const { obj, mat, vis } of swappedMats) {
                if (mat) obj.material = mat;
                obj.visible = vis;
            }
            for (const node of hiddenNodes) node.visible = true;
        }

        baseRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    };

    const baseSetSize = pass.setSize ? pass.setSize.bind(pass) : null;
    pass.setSize = (cssW, cssH) => {
        if (baseSetSize) baseSetSize(cssW, cssH);
        const pr2 = Globals.renderer.getPixelRatio() * PLAYER_CREASE_RT_SCALE;
        const nw = Math.max(1, Math.floor(cssW * pr2));
        const nh = Math.max(1, Math.floor(cssH * pr2));
        renderTarget.setSize(nw, nh);
        creaseMaterial.uniforms.uTexel.value.set(1 / nw, 1 / nh);
    };

    pass.update = () => {
        if (Globals.camera) {
            // uCameraNear/uCameraFar 在所有 per-partId 材质间通过共享 uniform 引用同步
            _normalMatBaseUniforms.uCameraNear.value = Globals.camera.near;
            _normalMatBaseUniforms.uCameraFar.value  = Globals.camera.far;
        }
    };

    return pass;
}

function wrapOutlinePassForPlayerXray(outlinePass) {
    const originalOutlineRender = outlinePass.render.bind(outlinePass);
    outlinePass.render = function(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
        if (Globals.player && Globals.player.xrayMeshes) {
            Globals.player.xrayMeshes.forEach((mesh) => {
                mesh.visible = false;
            });
        }
        originalOutlineRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
        if (Globals.player && Globals.player.xrayMeshes) {
            Globals.player.xrayMeshes.forEach((mesh) => {
                mesh.visible = !!CONFIG.xrayEnabled;
            });
        }
    };
    return outlinePass;
}

// ==================== 砖块地面：整张地图 CanvasTexture 实现 ====================
// 把整张地面画成一张 canvas（不重复），每块砖按其 (col, row) 位置在
// 渐变方向上插值得到自己的颜色。参数或地面尺寸变化时整张重绘。

const BRICK_PIXELS_PER_BRICK = 32; // 每块砖在 canvas 中的像素宽度（高=W*aspectY）
const BRICK_CANVAS_MAX_SIZE = 4096; // 单边像素上限，防止超大地图爆显存

function _hexFromInt(n, fallback) {
    if (typeof n !== 'number') return fallback;
    return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

function _hexToRgb(hex) {
    // hex 形如 "#rrggbb"
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function _rgbToCss([r, g, b]) {
    return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function _lerpColor(c0, c1, t) {
    return [
        c0[0] + (c1[0] - c0[0]) * t,
        c0[1] + (c1[1] - c0[1]) * t,
        c0[2] + (c1[2] - c0[2]) * t,
    ];
}

// 三段渐变：t∈[0,1]，midPos∈(0,1)
//  t in [0, midPos]   -> lerp(c0, cmid, t / midPos)
//  t in [midPos, 1]   -> lerp(cmid, c1, (t - midPos) / (1 - midPos))
function _lerpColor3(c0, cmid, c1, t, midPos) {
    const m = Math.max(0.001, Math.min(0.999, midPos));
    if (t <= m) {
        return _lerpColor(c0, cmid, t / m);
    }
    return _lerpColor(cmid, c1, (t - m) / (1 - m));
}

// 把整张地图画到 canvas 上。
// floorW / floorH 是地面在世界坐标里的实际尺寸（用于决定砖块 Y 数量）。
function drawBrickFloorFull(canvas, params) {
    const {
        floorW = 20, floorH = 20,
        countX = 6,
        aspectY = 1.0,
        gapWidth = 0.02,
        staggerOffset = 0.5,
        colorStart = '#312c5c',
        colorMid = '#6f5fa0',
        colorMidPos = 0.5,
        colorEnd = '#91c53a',
        angleDeg = 135,
        cycles = 1.0,
        gapColor = '#110f22',
    } = params;

    // 1) 决定砖网格规模
    // 横向：恰好 countX 块砖（向上取整）
    const cx = Math.max(1, Math.round(countX));
    // 砖块宽度（世界单位） = floorW / cx
    // 砖块高度（世界单位） = brickW * aspectY
    // 纵向砖块数 = floorH / brickH（向上取整，让最后一行可能被裁掉）
    const brickWworld = floorW / cx;
    const brickHworld = brickWworld * Math.max(0.05, aspectY);
    const cy = Math.max(1, Math.ceil(floorH / brickHworld));

    // 2) 决定 canvas 像素尺寸（用统一像素密度，避免超大）
    let pxPerBrick = BRICK_PIXELS_PER_BRICK;
    let W = cx * pxPerBrick;
    let H = Math.round(cy * pxPerBrick * Math.max(0.05, aspectY));
    // 缩放到上限
    const maxSide = Math.max(W, H);
    if (maxSide > BRICK_CANVAS_MAX_SIZE) {
        const k = BRICK_CANVAS_MAX_SIZE / maxSide;
        pxPerBrick = Math.max(4, Math.floor(pxPerBrick * k));
        W = cx * pxPerBrick;
        H = Math.round(cy * pxPerBrick * Math.max(0.05, aspectY));
    }
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 3) 缝隙底色铺满
    ctx.fillStyle = gapColor;
    ctx.fillRect(0, 0, W, H);

    // 4) 计算渐变方向（单位向量）
    // 角度定义：0°=从左到右；90°=从上到下；135°=从左上到右下
    // 注意 canvas 的 y 轴向下，故 sin 也对应向下
    const ang = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);

    // 投影到 [0,1] 所需归一化：把整张图四个顶点投到方向上，取 min/max
    const proj = (x, y) => x * dx + y * dy;
    const projMin = Math.min(proj(0, 0), proj(W, 0), proj(0, H), proj(W, H));
    const projMax = Math.max(proj(0, 0), proj(W, 0), proj(0, H), proj(W, H));
    const projRange = Math.max(1e-6, projMax - projMin);

    const c0 = _hexToRgb(colorStart);
    const cm = _hexToRgb(colorMid);
    const c1 = _hexToRgb(colorEnd);

    // 5) 砖块像素尺寸
    const brickPxW = pxPerBrick;
    const brickPxH = Math.max(2, Math.round(pxPerBrick * Math.max(0.05, aspectY)));
    // gapWidth = 0 时缝隙宽度为 0；其余情况至少 1 像素，避免反走样让缝隙若隐若现
    const gapPxX = gapWidth > 0 ? Math.max(1, Math.round(gapWidth * brickPxW * 0.5)) : 0;
    const gapPxY = gapWidth > 0 ? Math.max(1, Math.round(gapWidth * brickPxH * 0.5)) : 0;

    // 6) 逐块画砖
    // 为了在边缘也能看到连续的错位，col 范围拓展 -1..cx
    for (let row = 0; row < cy; row++) {
        const y0 = row * brickPxH;
        const offsetPx = (row % 2) * staggerOffset * brickPxW;

        for (let col = -1; col <= cx; col++) {
            const x0 = col * brickPxW + offsetPx;
            const bx = x0 + gapPxX;
            const by = y0 + gapPxY;
            const bw = brickPxW - gapPxX * 2;
            const bh = brickPxH - gapPxY * 2;
            if (bw <= 0 || bh <= 0) continue;
            // 裁剪到 canvas 内
            const drawX = Math.max(0, bx);
            const drawY = Math.max(0, by);
            const drawW = Math.min(W, bx + bw) - drawX;
            const drawH = Math.min(H, by + bh) - drawY;
            if (drawW <= 0 || drawH <= 0) continue;

            // 取砖块中心投影
            const cxPx = bx + bw / 2;
            const cyPx = by + bh / 2;
            // 原始 t ∈ [0,1]
            const tRaw = Math.max(0, Math.min(1, (proj(cxPx, cyPx) - projMin) / projRange));
            // 周期化：t' = (tRaw * cycles) mod 1（锁差，最后一格对齐到 1）
            const cyc = Math.max(0.0001, cycles);
            const scaled = tRaw * cyc;
            // 处理终点：tRaw=1 时让 t=1（避免 fract 让最后一砖回到 0），其他用 fract
            let t = scaled - Math.floor(scaled);
            if (tRaw >= 1 - 1e-6) t = 1;
            ctx.fillStyle = _rgbToCss(_lerpColor3(c0, cm, c1, t, colorMidPos));
            ctx.fillRect(drawX, drawY, drawW, drawH);
        }
    }
}

function _gatherBrickFloorParams(floorW, floorH) {
    return {
        floorW, floorH,
        countX: CONFIG.mapBrickCountX,
        aspectY: CONFIG.mapBrickAspectY,
        gapWidth: CONFIG.mapGapWidth,
        staggerOffset: CONFIG.mapStaggerOffset,
        colorStart:  _hexFromInt(CONFIG.mapBrickColorStart, '#312c5c'),
        colorMid:    _hexFromInt(CONFIG.mapBrickColorMid,   '#6f5fa0'),
        colorMidPos: CONFIG.mapBrickColorMidPos ?? 0.5,
        colorEnd:    _hexFromInt(CONFIG.mapBrickColorEnd,   '#91c53a'),
        angleDeg:    CONFIG.mapBrickGradientAngle ?? 135,
        cycles:      CONFIG.mapBrickGradientCycles ?? 1.0,
        gapColor:    _hexFromInt(CONFIG.mapBrickGapColor,   '#110f22'),
    };
}

function _applyBrickOpacity(mat) {
    if (!mat) return;
    const op = CONFIG.mapBrickOpacity;
    const opacity = (op === undefined || op === null) ? 1 : Math.max(0, Math.min(1, op));
    mat.opacity = opacity;
    mat.transparent = opacity < 1;
    mat.depthWrite = opacity >= 0.999;
    mat.needsUpdate = true;
}

// 用当前 arenaFloor 的尺寸重画砖块纹理。如果 arenaFloor 还没尺寸就用占位值。
function _redrawBrickFloorWithCurrentFloorSize() {
    if (!brickFloorMat || !brickFloorMat.userData.brickCanvas) return;
    let w = 20, h = 20;
    if (arenaFloor && arenaFloor.geometry && arenaFloor.geometry.parameters) {
        w = arenaFloor.geometry.parameters.width || w;
        h = arenaFloor.geometry.parameters.height || h;
    }
    drawBrickFloorFull(brickFloorMat.userData.brickCanvas, _gatherBrickFloorParams(w, h));
    if (brickFloorMat.map) {
        brickFloorMat.map.needsUpdate = true;
        brickFloorMat.map.source.needsUpdate = true;
    }
    _applyBrickOpacity(brickFloorMat);
}

function createBrickFloorMaterial() {
    const canvas = document.createElement('canvas');
    drawBrickFloorFull(canvas, _gatherBrickFloorParams(20, 20));
    const tex = new THREE.CanvasTexture(canvas);
    // 整张图 1:1 贴到地面，不重复
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;

    const mat = new THREE.MeshBasicMaterial({ map: tex });
    mat.userData.brickCanvas = canvas;
    _applyBrickOpacity(mat);
    return mat;
}

// 参数面板/外部触发：用当前地面尺寸重画
export function redrawBrickFloorTexture() {
    _redrawBrickFloorWithCurrentFloorSize();
}

// 同步衬底材质的颜色和透明度（仅在 brick 模式有意义）
export function refreshBrickBaseLayer() {
    if (!brickBaseMat) return;
    const color = (typeof CONFIG.mapBrickBaseColor === 'number')
        ? CONFIG.mapBrickBaseColor : 0x2d2952;
    brickBaseMat.color.setHex(color);
    const op = CONFIG.mapBrickBaseOpacity;
    const opacity = (op === undefined || op === null) ? 1 : Math.max(0, Math.min(1, op));
    brickBaseMat.opacity = opacity;
    brickBaseMat.transparent = opacity < 1;
    brickBaseMat.depthWrite = opacity >= 0.999;
    brickBaseMat.needsUpdate = true;

    if (brickBaseLayer) brickBaseLayer.visible = (CONFIG.floorStyle === 'brick');
}

function init() {
    Globals.uiLayer = document.getElementById('ui-layer');
    Globals.scene = new THREE.Scene();
    Globals.scene.background = new THREE.Color(0x1a1532);
    // // Globals.scene.fog = new THREE.Fog(0x8a8e94, 18, 56);
    
    const wrapper = document.getElementById('game-wrapper');
    Globals.camera = createGameCamera(wrapper.clientWidth / wrapper.clientHeight);
    Globals.baseCamTarget.set(0, 0, 0);
    updateCameraPosition();
    Globals.camera.lookAt(Globals.baseCamTarget);
    
    Globals.renderer = createRenderer();
    Globals.renderer.setPixelRatio(getEffectivePixelRatio());
    Globals.renderer.setSize(wrapper.clientWidth, wrapper.clientHeight);
    // 阴影完全关闭：项目已有 blob 阴影 (Player.js shadowMesh)，省下整套 shadow pass 开销。
    Globals.renderer.shadowMap.enabled = false;
    document.getElementById('canvas-container').appendChild(Globals.renderer.domElement);

    const pixelRatio = getEffectivePixelRatio();
    const width = Math.floor(wrapper.clientWidth * pixelRatio);
    const height = Math.floor(wrapper.clientHeight * pixelRatio);
    
    const renderTargetParameters = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: true,
        stencilBuffer: true
    };
    const renderTarget = new THREE.WebGLRenderTarget(width, height, renderTargetParameters);

    Globals.composer = new EffectComposer(Globals.renderer, renderTarget);
    Globals.composer.setPixelRatio(pixelRatio);
    Globals.composer.setSize(wrapper.clientWidth, wrapper.clientHeight);
    Globals.renderPass = new RenderPass(Globals.scene, Globals.camera);
    Globals.composer.addPass(Globals.renderPass);

    Globals.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(wrapper.clientWidth, wrapper.clientHeight),
        CONFIG.bloomStrength, 
        CONFIG.bloomRadius, 
        CONFIG.bloomThreshold
    );
    Globals.composer.addPass(Globals.bloomPass);
    Globals.composer.renderToScreen = false;

    const mixPass = new ShaderPass(
        new THREE.ShaderMaterial({
            uniforms: {
                baseTexture: { value: null },
                bloomTexture: { value: Globals.composer.renderTarget2.texture }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D baseTexture;
                uniform sampler2D bloomTexture;
                varying vec2 vUv;
                void main() {
                    gl_FragColor = (texture2D(baseTexture, vUv) + vec4(1.0) * texture2D(bloomTexture, vUv));
                }
            `,
            defines: {}
        }), 'baseTexture'
    );
    mixPass.needsSwap = true;

    const outputPass = new OutputPass();

    const finalRenderTarget = new THREE.WebGLRenderTarget(width, height, renderTargetParameters);
    Globals.finalComposer = new EffectComposer(Globals.renderer, finalRenderTarget);
    Globals.finalComposer.setPixelRatio(pixelRatio);
    Globals.finalComposer.setSize(wrapper.clientWidth, wrapper.clientHeight);
    Globals.finalComposer.addPass(Globals.renderPass);
    Globals.finalComposer.addPass(mixPass);

    Globals.outlinePass = wrapOutlinePassForPlayerXray(new OutlinePass(
        new THREE.Vector2(wrapper.clientWidth, wrapper.clientHeight),
        Globals.scene,
        Globals.camera
    ));
    Globals.outlinePass.edgeStrength = 4.0;
    Globals.outlinePass.edgeGlow = 0.0;
    Globals.outlinePass.edgeThickness = 1.0;
    Globals.outlinePass.pulsePeriod = 0;
    // 保留现有怪物/环境轮廓；玩家使用独立的 OutlinePass 做浅灰描边。
    Globals.outlinePass.visibleEdgeColor.setHex(0x1a1532);
    Globals.outlinePass.hiddenEdgeColor.setHex(0x1a1532);
    Globals.finalComposer.addPass(Globals.outlinePass);

    Globals.playerCreasePass = createPlayerCreasePass(wrapper.clientWidth, wrapper.clientHeight);
    Globals.finalComposer.addPass(Globals.playerCreasePass);

    Globals.finalComposer.addPass(outputPass);
    
    const ambientLight = new THREE.AmbientLight(0x5e55a2, 1.2);
    Globals.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0x91c53a, 1.8);
    dirLight.position.set(10, 20, 10);
    // 真实阴影已禁用 (renderer.shadowMap.enabled = false)，相关 shadow camera 配置不再生效。
    Globals.scene.add(dirLight);
    
    const backdropGeo = new THREE.PlaneGeometry(160, 160);
    const backdropMat = new THREE.MeshBasicMaterial({ color: 0x1a1532, depthWrite: false });
    const backdropPlane = new THREE.Mesh(backdropGeo, backdropMat);
    backdropPlane.rotation.x = -Math.PI / 2;
    backdropPlane.position.y = -0.02;
    Globals.scene.add(backdropPlane);

    solidFloorMat = new THREE.MeshBasicMaterial({ color: 0x2d2952 });
    
    // Create a generated checkerboard texture
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#555555';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillRect(256, 256, 256, 256);
    
    const checkerTexture = new THREE.CanvasTexture(canvas);
    checkerTexture.wrapS = THREE.RepeatWrapping;
    checkerTexture.wrapT = THREE.RepeatWrapping;
    // Repeat density: adjust so squares look proportional to the arena size
    checkerTexture.repeat.set(ARENA_WIDTH / 4, ARENA_HEIGHT / 4);
    checkerTexture.colorSpace = THREE.SRGBColorSpace;
    
    checkerboardFloorMat = new THREE.MeshBasicMaterial({ map: checkerTexture });

    brickFloorMat = createBrickFloorMaterial();

    const arenaFloorGeo = new THREE.PlaneGeometry(1, 1);
    const initialFloorMat = CONFIG.floorStyle === 'checkerboard' ? checkerboardFloorMat : (CONFIG.floorStyle === 'brick' ? brickFloorMat : solidFloorMat);
    arenaFloor = new THREE.Mesh(arenaFloorGeo, initialFloorMat);
    arenaFloor.rotation.x = -Math.PI / 2;
    arenaFloor.position.y = 0;
    arenaFloor.renderOrder = -1; // 确保地板优先于其他场景物体渲染
    // shadowMap 已禁用，无需 receiveShadow
    Globals.scene.add(arenaFloor);

    // 砖块衬底：放在 arenaFloor 下方一点（避免 z-fight），仅 brick 模式显示。
    // 尺寸跟随 arenaFloor，在 updateBoundaryVisual 里同步。
    brickBaseMat = new THREE.MeshBasicMaterial({ color: CONFIG.mapBrickBaseColor || 0x2d2952 });
    brickBaseLayer = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), brickBaseMat);
    brickBaseLayer.rotation.x = -Math.PI / 2;
    brickBaseLayer.position.y = -0.005; // 略低于 arenaFloor (y=0)
    brickBaseLayer.renderOrder = -2;     // 比 arenaFloor 更早画
    Globals.scene.add(brickBaseLayer);
    refreshBrickBaseLayer();
    
    Globals.particleManager = new ParticleManager();
    Globals.audioManager = new AudioManager();
    Globals.targetIndicator = new TargetIndicator();
    
    Globals.player = new PlayerCharacter();
    Globals.player.mesh.scale.setScalar(CONFIG.playerScale);
    Globals.scene.add(Globals.player.mesh);
    Globals.scene.add(Globals.player.moveIndicator);
    // The inner (yellow) recall-progress ring is parented to the scene
    // (NOT to player.mesh) so its orientation stays world-aligned even as
    // the player rotates to face the move/attack direction. Player updates
    // its position/scale every frame in _updateAnimation_shared.
    if (Globals.player.innerRingGroup) {
        Globals.scene.add(Globals.player.innerRingGroup);
    }
    updateCameraFollow();
    setupObstacles();
    setupDummy();
    
    initInput(wrapper);
    setupControlPanel();
    Telemetry.init();
    setupAudioUnlock();
    
    window.addEventListener('resize', onWindowResize);
    Globals.renderer.setAnimationLoop(animate);
    updateVisibleGroundBounds();
    
    setInterval(() => {
        if (CONFIG.sceneMode === 'endless' && Globals.enemies.length + pendingEnemySpawns.length < 15) {
            queueEnemySpawn();
        }
    }, 1500);

    setupModeSwitchButton();
}

// --- 右上角场景模式切换按钮 ---
// 四种模式循环：obstacles → dummy → slimeDummy → wave4 → obstacles
// slimeDummy = 站桩史莱姆：外观与普通史莱姆一致，但不会朝玩家移动且 HP 无限
const MODE_SWITCH_MAP = {
    obstacles:  { next: 'dummy',      label: '进入木桩模式' },
    dummy:      { next: 'slimeDummy', label: '进入史莱姆木桩' },
    slimeDummy: { next: 'wave4',      label: '进入战斗关卡' },
    wave4:      { next: 'obstacles',  label: '进入障碍模式' },
};

function setupModeSwitchButton() {
    const btn = document.getElementById('btn-mode-switch');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        Globals.audioManager?.playUIClick();
        const entry = MODE_SWITCH_MAP[CONFIG.sceneMode];
        if (!entry) return;
        setActiveSceneMode(entry.next);
    });
    // 阻止按钮上的指针事件传到游戏 canvas（避免触发攻击/摇杆）
    ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup'].forEach(ev => {
        btn.addEventListener(ev, e => e.stopPropagation(), { passive: true });
    });
    refreshModeSwitchButton();
}

function refreshModeSwitchButton() {
    const btn = document.getElementById('btn-mode-switch');
    if (!btn) return;
    const entry = MODE_SWITCH_MAP[CONFIG.sceneMode];
    if (entry) {
        btn.textContent = entry.label;
        btn.style.display = '';
    } else {
        btn.style.display = 'none';
    }
}

export function setActiveSceneMode(mode) {
    if (CONFIG.sceneMode === mode) {
        refreshModeSwitchButton();
        return;
    }
    CONFIG.sceneMode = mode;
    clearSceneEntities();
    refreshBoundaryVisual();
    refreshModeSwitchButton();
    // 同步调节面板中的场景模式 UI
    syncScenePanelUI();
}

function syncScenePanelUI() {
    const valScm = document.getElementById('val-scm');
    const btnScm = document.getElementById('btn-scm');
    if (!valScm || !btnScm) return;
    switch (CONFIG.sceneMode) {
        case 'empty':      valScm.innerText = '空旷';       btnScm.innerText = '切换为无尽'; break;
        case 'obstacles':  valScm.innerText = '障碍测试';   btnScm.innerText = '切换为木桩'; break;
        case 'dummy':      valScm.innerText = '木桩';       btnScm.innerText = '切换为史莱姆木桩'; break;
        case 'slimeDummy': valScm.innerText = '史莱姆木桩'; btnScm.innerText = '切换为四人小队'; break;
        case 'wave4':      valScm.innerText = '四人小队';   btnScm.innerText = '切换为空旷'; break;
        case 'endless':
        default:           valScm.innerText = '无尽';       btnScm.innerText = '切换为障碍测试'; break;
    }
}

// --- Wave4 mode state ---
let wave4RespawnTimer = 0;
let wave4WaveIndex = 0; // 用于两种布局轮换：偶数=矩形布局，奇数=上方一字布局

// Wave4 布局A：矩形四角。下方两角（+Z，靠近玩家）放柱状怪，上方两角（-Z）放普通怪。
// 位置不贴角落，连线为长方形。
function computeWave4LayoutRect() {
    const marginX = 1.4 * CONFIG.enemyScale;
    const marginZ = 1.4 * CONFIG.enemyScale;
    const halfX = Math.max(0, Math.min(5.5, (visibleGroundBounds.maxX - marginX)));
    const halfZ = Math.max(0, Math.min(13.0, (visibleGroundBounds.maxZ - marginZ)));
    return [
        { position: new THREE.Vector3(-halfX,  0,  halfZ), type: 'pillar' }, // 左下：柱状
        { position: new THREE.Vector3( halfX,  0,  halfZ), type: 'pillar' }, // 右下：柱状
        { position: new THREE.Vector3(-halfX,  0, -halfZ), type: 'normal' }, // 左上：普通
        { position: new THREE.Vector3( halfX,  0, -halfZ), type: 'normal' }, // 右上：普通
    ];
}

// Wave4 布局B：上方一条直线四只怪。最左/最右是柱状，中间两个是普通。
function computeWave4LayoutLine() {
    const marginX = 1.4 * CONFIG.enemyScale;
    const marginZ = 1.4 * CONFIG.enemyScale;
    const lineZ = -Math.max(0, Math.min(13.0, (visibleGroundBounds.maxZ - marginZ)));
    const outerX = Math.max(0, Math.min(6.0, (visibleGroundBounds.maxX - marginX)));
    const innerX = Math.max(0, Math.min(2.0, outerX * (2 / 6)));
    return [
        { position: new THREE.Vector3(-outerX, 0, lineZ), type: 'pillar' }, // 最左：柱状
        { position: new THREE.Vector3(-innerX, 0, lineZ), type: 'normal' }, // 中左：普通
        { position: new THREE.Vector3( innerX, 0, lineZ), type: 'normal' }, // 中右：普通
        { position: new THREE.Vector3( outerX, 0, lineZ), type: 'pillar' }, // 最右：柱状
    ];
}

function updateWave4Mode(delta) {
    if (CONFIG.sceneMode !== 'wave4') {
        wave4RespawnTimer = 0;
        wave4WaveIndex = 0;
        return;
    }
    const aliveOrPending = Globals.enemies.length + pendingEnemySpawns.length;
    if (aliveOrPending > 0) {
        wave4RespawnTimer = 0;
        return;
    }
    // All enemies dead and no pending spawns: count down respawn delay then spawn next wave.
    wave4RespawnTimer -= delta;
    if (wave4RespawnTimer <= 0) {
        // 两种布局轮换：偶数波次=矩形，奇数波次=上方一字。
        const layout = (wave4WaveIndex % 2 === 0)
            ? computeWave4LayoutRect()
            : computeWave4LayoutLine();
        for (const slot of layout) {
            queueEnemySpawnAt(slot.position, slot.type);
        }
        wave4WaveIndex++;
        wave4RespawnTimer = CONFIG.wave4RespawnDelay ?? 0.6;
    }
}

function setupObstacles() {
    if (obstacleGroup) {
        Globals.scene.remove(obstacleGroup);
        obstacleGroup.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
        obstacleGroup = null;
    }
    Globals.obstacles = [];
    if (CONFIG.sceneMode !== 'obstacles') return;

    obstacleGroup = new THREE.Group();
    Globals.scene.add(obstacleGroup);

    const baseColor = new THREE.Color(0x5e55a2);
    const topMat = new THREE.MeshBasicMaterial({ color: baseColor });
    const sideMat1 = new THREE.MeshBasicMaterial({ color: baseColor.clone().multiplyScalar(0.85) });
    const sideMat2 = new THREE.MeshBasicMaterial({ color: baseColor.clone().multiplyScalar(0.7) });
    const boxMaterials = [
        sideMat1, // right
        sideMat1, // left
        topMat,   // top
        topMat,   // bottom
        sideMat2, // front
        sideMat2  // back
    ];
    
    const createBox = (x, z, w, d) => {
        const h = 2.0; // Box height
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), boxMaterials);
        mesh.position.set(x, h / 2, z);
        // shadowMap 已禁用，无需 cast/receive shadow
        // Make sure obstacles use default renderOrder (0) so they render BEFORE the player
        mesh.renderOrder = 0; 
        obstacleGroup.add(mesh);
        
        Globals.obstacles.push({
            minX: x - w / 2,
            maxX: x + w / 2,
            minZ: z - d / 2,
            maxZ: z + d / 2
        });
    };

    // Generate a maze-like or tight corner layout
    createBox(-6, -6, 4, 2);
    createBox(6, -6, 4, 2);
    createBox(0, 2, 8, 2);
    createBox(-8, 6, 2, 6);
    createBox(8, 6, 2, 6);
    createBox(0, 10, 2, 4);
}

export function clearSceneEntities() {
    _clearPendingThrowState();
    attackBreakTurnActive = false;
    moveToAttackTurnActive = false;

    if (Globals.player) {
        Globals.player.mesh.position.set(0, 0, 0);
        if (Globals.player.moveIndicator) Globals.player.moveIndicator.position.set(0, 0.05, 0);
        if (Globals.player.moveIndicatorOffset) Globals.player.moveIndicatorOffset.set(0, 0, 0);
        Globals.player.trajectoryPoints = [];
        Globals.player.trajectoryTime = 0;
    }

    for (let i = Globals.enemies.length - 1; i >= 0; i--) {
        const enemy = Globals.enemies[i];
        enemy.hp = 0;
        enemy.die(new THREE.Vector3(0, 0, 1));
    }
    
    for (let i = Globals.feathers.length - 1; i >= 0; i--) {
        Globals.feathers[i].destroy();
    }
    
    pendingEnemySpawns.length = 0;
    for (let i = Globals.spawnEffects.length - 1; i >= 0; i--) {
        Globals.spawnEffects[i].life = 0;
    }

    // 清理所有尚未飞完的柱状敌人子弹，避免场景切换残留
    if (Globals.pillarBullets && Globals.pillarBullets.length > 0) {
        for (let i = Globals.pillarBullets.length - 1; i >= 0; i--) {
            Globals.pillarBullets[i].destroy();
        }
        Globals.pillarBullets.length = 0;
    }
    
    for (let i = Globals.floatingTexts.length - 1; i >= 0; i--) {
        const txt = Globals.floatingTexts[i];
        if (txt.element.parentNode) txt.element.parentNode.removeChild(txt.element);
    }
    Globals.floatingTexts.length = 0;
}

function setupAudioUnlock() {
    const unlock = () => Globals.audioManager?.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock, { passive: true });
}

function createGameCamera(aspect) {
    if (CONFIG.cameraMode === 'perspective') {
        return new THREE.PerspectiveCamera(CONFIG.cameraFov || 45, aspect, 0.1, 1000);
    } else {
        const targetWidth = ARENA_WIDTH * 1.05 * CONFIG.cameraViewScale; 
        const halfWidth = targetWidth * 0.5;
        const halfHeight = halfWidth / aspect;
        return new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 1000);
    }
}

function updateCameraFrustum() {
    const wrapper = document.getElementById('game-wrapper');
    const aspect = wrapper.clientWidth / wrapper.clientHeight;
    
    if (Globals.camera.isPerspectiveCamera) {
        Globals.camera.aspect = aspect;
        Globals.camera.fov = CONFIG.cameraFov || 45;
        Globals.camera.updateProjectionMatrix();
    } else {
        const targetWidth = ARENA_WIDTH * 1.05 * CONFIG.cameraViewScale; 
        const halfWidth = targetWidth * 0.5;
        const halfHeight = halfWidth / aspect;
        Globals.camera.left = -halfWidth;
        Globals.camera.right = halfWidth;
        Globals.camera.top = halfHeight;
        Globals.camera.bottom = -halfHeight;
        Globals.camera.updateProjectionMatrix();
    }
}

export function updateCameraPosition() {
    const camDist = CONFIG.cameraDist !== undefined ? CONFIG.cameraDist : 60;
    const angleX = THREE.MathUtils.degToRad(CONFIG.cameraAngleX !== undefined ? CONFIG.cameraAngleX : 55);
    const angleY = THREE.MathUtils.degToRad(CONFIG.cameraAngleY !== undefined ? CONFIG.cameraAngleY : 0);
    Globals.baseCamPos.set(
        Math.sin(angleY) * Math.cos(angleX) * camDist,
        Math.sin(angleX) * camDist,
        Math.cos(angleY) * Math.cos(angleX) * camDist
    );
    Globals.cameraOffset.copy(Globals.baseCamPos);
    
    updateCameraFrustum();
    updateCameraFollow();
}

export function refreshCameraMode() {
    const wrapper = document.getElementById('game-wrapper');
    Globals.camera = createGameCamera(wrapper.clientWidth / wrapper.clientHeight);
    if (Globals.renderPass) Globals.renderPass.camera = Globals.camera;
    if (Globals.outlinePass) Globals.outlinePass.renderCamera = Globals.camera;
    
    updateCameraPosition();
    Globals.camera.lookAt(Globals.baseCamTarget);
}

function updateVisibleGroundBounds() {
    visibleGroundBounds.minX = -ARENA_WIDTH * 0.5;
    visibleGroundBounds.maxX = ARENA_WIDTH * 0.5;
    visibleGroundBounds.minZ = -ARENA_HEIGHT * 0.5;
    visibleGroundBounds.maxZ = ARENA_HEIGHT * 0.5;
    updateBoundaryVisual();
}

// 镜头跟随平滑用的内部状态：当前镜头焦点 Z 与其速度。
// 这两个值不放进 CONFIG，避免被参数预设覆写；只暴露调参旋钮。
let _camFollowFocusZ = 0;
let _camFollowVelZ = 0;

// 强制把镜头焦点重置到给定值（瞬切，不缓动）。
// 用于"关闭跟随后重新打开""场景重置"等需要立刻就位的场合。
function resetCameraFollowSmoothing(focusZ = 0) {
    _camFollowFocusZ = focusZ;
    _camFollowVelZ = 0;
}

function updateCameraFollow(delta = 0) {
    if (!Globals.player) return;

    if (!CONFIG.cameraFollowEnabled) {
        Globals.baseCamTarget.set(0, 0, 0);
        Globals.baseCamPos.copy(Globals.cameraOffset);
        // 关闭期间持续把内部状态拽回 0，重新开启时不会从老位置突然弹回。
        resetCameraFollowSmoothing(0);
        return;
    }

    const marginZ = 0.8 * CONFIG.playerScale;
    const playerMinZ = visibleGroundBounds.minZ + marginZ;
    const playerMaxZ = visibleGroundBounds.maxZ - marginZ;
    // 上下两端玩家可达的极限（各自的绝对值），相机焦点最远只会跟到这里。
    const maxOffsetTop    = Math.max(0, playerMaxZ);  // +Z 方向
    const maxOffsetBottom = Math.max(0, -playerMinZ); // -Z 方向

    // 死区：相机离场地极限多少世界单位时停止跟随。
    // 优先使用上下独立的新字段；为兼容旧预设 (arrow_preset______v1.json
    // 等) 仅有 cameraVerticalDeadZone 的情况，未定义时回退到旧字段。
    const legacyDead = (typeof CONFIG.cameraVerticalDeadZone === 'number')
        ? CONFIG.cameraVerticalDeadZone : 6;
    const deadTop = (typeof CONFIG.cameraDeadZoneTop === 'number')
        ? CONFIG.cameraDeadZoneTop : legacyDead;
    const deadBottom = (typeof CONFIG.cameraDeadZoneBottom === 'number')
        ? CONFIG.cameraDeadZoneBottom : legacyDead;

    const followLimitTop    = Math.max(0, maxOffsetTop    - deadTop);    // +Z 方向跟到这里为止
    const followLimitBottom = Math.max(0, maxOffsetBottom - deadBottom); // -Z 方向跟到这里为止
    // 期望焦点：玩家 Z 分别按上下两侧的 follow limit 夹紧。
    const desiredZ = THREE.MathUtils.clamp(
        Globals.player.mesh.position.z,
        -followLimitBottom,
         followLimitTop
    );

    let focusZ;
    const smoothing = CONFIG.cameraFollowSmoothing;
    const smoothTime = CONFIG.cameraFollowSmoothTime;
    const maxSpeed = CONFIG.cameraFollowMaxSpeed;

    if (!smoothing || smoothTime <= 1e-4 || delta <= 0) {
        // 平滑被禁用 / smoothTime 太小 / 首帧 delta 为 0：直接锁定焦点（旧行为）。
        focusZ = desiredZ;
        _camFollowFocusZ = desiredZ;
        _camFollowVelZ = 0;
    } else {
        // 临界阻尼弹簧（Game Programming Gems 4 的 SmoothDamp 公式）：
        //   omega = 2 / smoothTime
        //   exp = 1 / (1 + x + 0.48 x^2 + 0.235 x^3)，x = omega * delta
        // 它给出 frame-rate 无关、无超调、可解析求解的缓动；
        // 同时支持把每一步位移限制在 maxSpeed * delta 内来设速度上限。
        const omega = 2 / smoothTime;
        const x = omega * delta;
        const expFactor = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

        // 先按 maxSpeed 限制目标点能"拉走"焦点的最大位移，
        // 再让弹簧解算去逼近这个被夹住的目标。
        let change = _camFollowFocusZ - desiredZ;
        const maxChange = (maxSpeed > 0 ? maxSpeed : Infinity) * smoothTime;
        change = THREE.MathUtils.clamp(change, -maxChange, maxChange);
        const clampedTarget = _camFollowFocusZ - change;

        const temp = (_camFollowVelZ + omega * change) * delta;
        _camFollowVelZ = (_camFollowVelZ - omega * temp) * expFactor;
        let newFocusZ = clampedTarget + (change + temp) * expFactor;

        // 防过冲：当本帧弹簧已经越过 desired 时，直接吸附到 desired，
        // 同时把速度对齐到 (newFocusZ - desiredZ) / delta，避免微小抖动。
        if ((desiredZ - _camFollowFocusZ) > 0 === (newFocusZ > desiredZ)) {
            newFocusZ = desiredZ;
            _camFollowVelZ = (newFocusZ - _camFollowFocusZ) / delta;
        }

        // 速度上限：弹簧解算后的有效速度本身也夹一下，
        // 对玩家从远处瞬移 / 装备改变出生点等突变情况兜底。
        if (maxSpeed > 0 && Math.abs(_camFollowVelZ) > maxSpeed) {
            _camFollowVelZ = Math.sign(_camFollowVelZ) * maxSpeed;
        }

        _camFollowFocusZ = newFocusZ;
        focusZ = newFocusZ;
    }

    Globals.baseCamTarget.set(0, 0, focusZ);
    Globals.baseCamPos.copy(Globals.cameraOffset).add(Globals.baseCamTarget);
}

function updateBoundaryVisual() {
    const marginX = 0.6 * CONFIG.playerScale;
    const marginZ = 0.8 * CONFIG.playerScale;
    const minX = visibleGroundBounds.minX + marginX;
    const maxX = visibleGroundBounds.maxX - marginX;
    const minZ = visibleGroundBounds.minZ + marginZ;
    const maxZ = visibleGroundBounds.maxZ - marginZ;
    const horizontalLength = maxX - minX;
    const verticalLength = maxZ - minZ;

    if (arenaFloor) {
        arenaFloor.geometry.dispose();
        arenaFloor.geometry = new THREE.PlaneGeometry(horizontalLength, verticalLength);
        arenaFloor.position.set((minX + maxX) * 0.5, 0, (minZ + maxZ) * 0.5);
        
        if (CONFIG.floorStyle === 'checkerboard' && checkerboardFloorMat && checkerboardFloorMat.map) {
            checkerboardFloorMat.map.repeat.set(horizontalLength / 4, verticalLength / 4);
            checkerboardFloorMat.map.needsUpdate = true;
        } else if (CONFIG.floorStyle === 'brick' && brickFloorMat) {
            // 整张地图 1:1 重画（地面尺寸已变）
            _redrawBrickFloorWithCurrentFloorSize();
        }
        arenaFloor.material = CONFIG.floorStyle === 'checkerboard' ? checkerboardFloorMat : (CONFIG.floorStyle === 'brick' ? brickFloorMat : solidFloorMat);
    }

    // 砖块衬底跟随 arenaFloor 的尺寸/位置；可见性按 floorStyle 决定
    if (brickBaseLayer) {
        brickBaseLayer.geometry.dispose();
        brickBaseLayer.geometry = new THREE.PlaneGeometry(horizontalLength, verticalLength);
        brickBaseLayer.position.set((minX + maxX) * 0.5, -0.005, (minZ + maxZ) * 0.5);
        brickBaseLayer.visible = (CONFIG.floorStyle === 'brick');
    }

    if (boundaryGroup) {
        Globals.scene.remove(boundaryGroup);
        boundaryGroup.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        boundaryGroup = null;
    }

    boundaryGroup = new THREE.Group();

    const linePoints = [
        new THREE.Vector3(minX, 0.06, minZ),
        new THREE.Vector3(maxX, 0.06, minZ),
        new THREE.Vector3(maxX, 0.06, maxZ),
        new THREE.Vector3(minX, 0.06, maxZ)
    ];
    const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(linePoints),
        new THREE.LineBasicMaterial({ color: 0x91c53a, transparent: true, opacity: 0.9 })
    );
    boundaryGroup.add(outline);

    const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0x91c53a, transparent: true, opacity: 0.18 });
    const horizontalEdgeGeo = new THREE.BoxGeometry(horizontalLength, 0.08, 0.16);
    const verticalEdgeGeo = new THREE.BoxGeometry(0.16, 0.08, verticalLength);

    const topEdge = new THREE.Mesh(horizontalEdgeGeo, edgeMaterial.clone());
    topEdge.position.set((minX + maxX) * 0.5, 0.04, minZ);
    boundaryGroup.add(topEdge);

    const bottomEdge = new THREE.Mesh(horizontalEdgeGeo.clone(), edgeMaterial.clone());
    bottomEdge.position.set((minX + maxX) * 0.5, 0.04, maxZ);
    boundaryGroup.add(bottomEdge);

    const leftEdge = new THREE.Mesh(verticalEdgeGeo, edgeMaterial.clone());
    leftEdge.position.set(minX, 0.04, (minZ + maxZ) * 0.5);
    boundaryGroup.add(leftEdge);

    const rightEdge = new THREE.Mesh(verticalEdgeGeo.clone(), edgeMaterial.clone());
    rightEdge.position.set(maxX, 0.04, (minZ + maxZ) * 0.5);
    boundaryGroup.add(rightEdge);

    Globals.scene.add(boundaryGroup);
}

export function refreshBoundaryVisual() {
    updateCameraFrustum();
    updateBoundaryVisual();
    updateCameraFollow();
    setupObstacles();
    setupDummy();
    setupSlimeDummy();
}

function setupDummy() {
    if (CONFIG.sceneMode === 'dummy') {
        const dummyPos = new THREE.Vector3(0, 0, -4);
        new WoodenStake(dummyPos);
    }
}

// 史莱姆木桩模式：spawn 一只站桩史莱姆（外观与普通史莱姆一致，但不追玩家，HP 无限）。
// 与 dummy 模式（WoodenStake）的区别：这是 Enemy 实体，受击形变/击退/眩晕/bounce 都走
// 普通史莱姆的 hitS* 参数，因此击中手感与战斗中的普通史莱姆完全一致。
function setupSlimeDummy() {
    if (CONFIG.sceneMode === 'slimeDummy') {
        const pos = new THREE.Vector3(0, 0, -4);
        new Enemy(pos, false, { stationary: true });
    }
}

export function refreshCameraFollow() {
    updateCameraFollow();
}

function getSpawnPositionInView() {
    const marginX = 1.4 * CONFIG.enemyScale;
    const marginZ = 1.4 * CONFIG.enemyScale;
    const minX = visibleGroundBounds.minX + marginX;
    const maxX = visibleGroundBounds.maxX - marginX;
    const minZ = visibleGroundBounds.minZ + marginZ;
    const maxZ = visibleGroundBounds.maxZ - marginZ;

    return new THREE.Vector3(
        THREE.MathUtils.randFloat(minX, maxX),
        0,
        THREE.MathUtils.randFloat(minZ, maxZ)
    );
}

function queueEnemySpawnAt(position, type = 'normal') {
    Globals.spawnEffects.push(new SpawnTelegraphEffect(position, CONFIG.enemyScale));
    pendingEnemySpawns.push({ position, timeLeft: 3, type });
}

function queueEnemySpawn(type = 'normal') {
    queueEnemySpawnAt(getSpawnPositionInView(), type);
}

function updatePendingEnemySpawns(delta) {
    for (let i = pendingEnemySpawns.length - 1; i >= 0; i--) {
        const pending = pendingEnemySpawns[i];
        pending.timeLeft -= delta;
        if (pending.timeLeft <= 0) {
            if (pending.type === 'pillar') {
                new PillarEnemy(pending.position);
            } else {
                new Enemy(pending.position);
            }
            Globals.spawnEffects.push(new SpawnBeamEffect(pending.position, CONFIG.enemyScale));
            pendingEnemySpawns.splice(i, 1);
        }
    }
}

// Helpers for the configurable field-weapon limit.
function getMaxFeathersOnField() {
    const limit = Math.round(CONFIG.maxFeathersOnField ?? 50);
    return Math.max(1, Math.min(50, limit));
}

function getFeathersOnFieldCount() {
    return Globals.feathers ? Globals.feathers.length : 0;
}

function isSpecialAttackCycleEnabled() {
    return CONFIG.disableSpecialAttackCycle !== true;
}

function getThrowCycleLength() {
    return isSpecialAttackCycleEnabled() ? SPECIAL_THROW_CYCLE : NORMAL_THROW_CYCLE;
}

function getThrowCyclePos() {
    return throwCounter % getThrowCycleLength();
}

function isNextThrowSpecial() {
    return isSpecialAttackCycleEnabled() && getThrowCyclePos() === (SPECIAL_THROW_CYCLE - 1);
}

// Resolved spawn delay for the current attack. The configured value is
// clamped to the recover duration so we never delay the feather past the
// end of the backswing animation (which would leave the player with a
// pending spawn after they've already returned to idle).
function getAttackThrowSpawnDelay() {
    const rawDelay = Math.max(0, CONFIG.attackThrowSpawnDelay ?? 0);
    const recoverDur = Math.max(0, Globals.player?.recoverDuration ?? rawDelay);
    return Math.min(rawDelay, recoverDur);
}

function _clearPendingThrowState() {
    isWindupActive = false;
    windupTarget = null;
    windupTimer = 0;
    isThrowSpawnDelayActive = false;
    throwSpawnDelayTimer = 0;
}

// Entry point: picks a target, begins windup, schedules executeThrow().
function shootFeather() {
    if (CONFIG.playerAttackDisabled) return false;
    if (getFeathersOnFieldCount() >= getMaxFeathersOnField()) return false;

    const target = getClosestEnemy();
    if (!target) return false;

    // The field count is capped by CONFIG.maxFeathersOnField, but the
    // normal/special attack rhythm is still global. We preview the cycle
    // position here (without advancing the counter) so shootFeather and
    // executeThrow agree on the same `isSpecial` value; the counter is
    // advanced only once, inside executeThrow.
    const isSpecial = isNextThrowSpecial();
    const pPos = Globals.player.mesh.position;
    const tPos = target.mesh.position;
    Globals.player.attackFacingAngle = Math.atan2(tPos.x - pPos.x, tPos.z - pPos.z);

    const windupDur = isSpecial
        ? (CONFIG.attackWindupDurSpecial ?? 0.34)
        : (CONFIG.attackWindupDur ?? 0.22);
    const recoverDur = isSpecial
        ? (CONFIG.attackRecoverDurSpecial ?? 0.25)
        : (CONFIG.attackRecoverDur ?? 0.2);

    isWindupActive = true;
    isThrowSpawnDelayActive = false;
    windupTarget = target;
    windupTimer = windupDur;
    throwSpawnDelayTimer = 0;
    // Resolve the spawn-delay value for THIS attack the same way the
    // main loop will (it's clamped against recoverDur). Hand it to the
    // player so the held-weapon pose animation can use
    // (windupDur + spawnDelay) as its unified timeline; this keeps
    // "stayRatio" honest with respect to the spawn-delay window the
    // user configured under "攻击与回收".
    const resolvedSpawnDelay = Math.min(
        Math.max(0, CONFIG.attackThrowSpawnDelay ?? 0),
        Math.max(0, recoverDur)
    );
    Globals.player.playAttack(windupTimer, recoverDur, isSpecial, resolvedSpawnDelay);
    // The actual feather spawn / physics happens in executeThrow() when the
    // windup timer runs out.
    return true;
}

function getIndicatorCycleCount() {
    if (throwCounter <= 0) return 0;
    const cycleLength = getThrowCycleLength();
    // Indicator state intentionally lags the visual reset by one throw:
    //   throw 1 -> 1 used
    //   throw 2 -> 2 used
    //   throw 3 -> 3 used
    //   throw 4 -> 4 used (special ring also dims) [only when special cycle is enabled]
    //   throw 5 -> reset + first pip used = 1 used
    return ((throwCounter - 1) % cycleLength) + 1;
}

function executeThrow() {
    const target = windupTarget && windupTarget.mesh && windupTarget.health > 0 ? windupTarget : getClosestEnemy();
    _clearPendingThrowState();
    // The actual feather is about to spawn — collapse the held-weapon
    // pose-animation window back to its non-extended form so the held
    // weapon hides immediately (the airborne feather takes over visually).
    Globals.player?.clearThrowSpawnDelay();
    if (getFeathersOnFieldCount() >= getMaxFeathersOnField()) return;
    if (!target) return; // target might have died during windup

    // Advance the cycle counter for this launch. When the special cycle is
    // enabled, indices 0,1,2 are normals and index 3 is the special. When
    // disabled, the cycle stays on indices 0,1,2 so every launch remains a
    // normal throw.
    const cyclePos = getThrowCyclePos();
    const isSpecial = isSpecialAttackCycleEnabled() && cyclePos === (SPECIAL_THROW_CYCLE - 1);
    throwCounter++;
    const ptPos = Globals.player.mesh.position.clone();
    const etPos = target.mesh.position.clone();
        const lookDir = new THREE.Vector3().subVectors(etPos, ptPos).normalize();
        const facingDir = new THREE.Vector3(etPos.x - ptPos.x, 0, etPos.z - ptPos.z);
        if (facingDir.lengthSq() < 0.0001) facingDir.set(0, 0, 1);
        facingDir.normalize();
        const backDir = facingDir.clone().multiplyScalar(-1);
        const rightDir = facingDir.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
        
        const launchPos = ptPos.clone();
        launchPos.y += 1.0;
        launchPos.addScaledVector(facingDir, 0.55);
        launchPos.addScaledVector(rightDir, 0.35); // 统一右手出手点

        const newFeather = new Feather(target, isSpecial, launchPos);
        // Each weapon's slot index is its cycle position: 0..2 = the three
        // outer arcs, 3 = the inner special ring. Because the field limit
        // can exceed 4, multiple in-flight weapons can share the same slot
        // index. We therefore track each
        // slot as a reference count (ammoSlotsInFlight[s] = how many
        // not-yet-returned weapons currently map to slot s) rather than a
        // boolean. The foot-ring indicator logic treats any nonzero count
        // as "in flight".
        newFeather.slotIndex = cyclePos;
        const player = Globals.player;
        if (player && player.ammoSlotsInFlight) {
            player.ammoSlotsInFlight[newFeather.slotIndex] =
                (player.ammoSlotsInFlight[newFeather.slotIndex] || 0) + 1;
        }
        Globals.feathers.push(newFeather);
        // Drive the foot-ring cycle indicator. We keep the 4th throw visible
        // as a consumed special-ring state, and only visually reset on the
        // NEXT throw (which is also the first normal throw of the next cycle).
        if (player) {
            player.indicatorCyclePos = getIndicatorCycleCount();
        }
        Globals.audioManager?.playShoot(isSpecial);

        // ✨ 玩家出手瞬间 · 流星火花特效（复用 HitSparkEffect，参数从 attackSpark* 读取）
        // 在出手点（launchPos）生成。direction = facingDir（朝敌人方向）：
        //   attackSparkReverseDir=false（默认）→ outDir = -facingDir → 火花朝玩家身后飞溅
        //   attackSparkReverseDir=true         → outDir = +facingDir → 火花朝敌人方向飞溅
        if (CONFIG.attackSparkEnabled !== false) {
            Globals.hitSparkEffects.push(new HitSparkEffect(
                launchPos,
                facingDir,
                {
                    scale: isSpecial ? (CONFIG.attackSparkScaleSpecial ?? 1.25) : (CONFIG.attackSparkScale ?? 1.0),
                    reverseDir: !!CONFIG.attackSparkReverseDir,
                    // 把 attackSpark* 参数映射成 hitSpark* 键给 HitSparkEffect 的 params 通道使用，
                    // 这样可与"敌人受击流星火花"完全独立调节。
                    params: {
                        hitSparkSpeedMin:     CONFIG.attackSparkSpeedMin,
                        hitSparkSpeedMax:     CONFIG.attackSparkSpeedMax,
                        hitSparkDrag:         CONFIG.attackSparkDrag,
                        hitSparkGravity:      CONFIG.attackSparkGravity,
                        hitSparkConeAngle:    CONFIG.attackSparkConeAngle,
                        hitSparkVerticalDamp: CONFIG.attackSparkVerticalDamp,
                        hitSparkUpwardBias:   CONFIG.attackSparkUpwardBias,
                        hitSparkLifetime:     CONFIG.attackSparkLifetime,
                        hitSparkStreakCount:  CONFIG.attackSparkStreakCount,
                        hitSparkEmberCount:   CONFIG.attackSparkEmberCount,
                        hitSparkThickness:    CONFIG.attackSparkThickness,
                        hitSparkLength:       CONFIG.attackSparkLength,
                        hitSparkVanishStart:  CONFIG.attackSparkVanishStart
                    }
                }
            ));
        }
        // 注：穿刺震动在 Feather.checkCollision 里按 'low'/'high'/'special' 分支处理，
        // 由 CONFIG.shakeIntensityThrow / shakeIntensityThrowSpecial 等参数控制。
}

// Cancel a not-yet-spawned throw (either still in windup, or already in the
// post-windup spawn-delay window where the recover animation is playing but
// the weapon entity hasn't been spawned yet). No feather is created, no
// shoot SFX plays, and the player's attack animation state is fully cleared
// so the running gait can blend in immediately.
//
// In practice, by the time we get here, _handleAttackTrigger's
// wasStopped→!stopped branch has already called snapOutOfAttackPose() and
// the attack pose has long since been hard-cut. This call is the safety
// net (e.g. single-frame quirks or presets that reroute this path)
// ensuring windup state in main.js is cleared in lockstep with the
// player's logical attack state.
function _cancelPendingThrow() {
    _clearPendingThrowState();
    const player = Globals.player;
    if (player) {
        player.snapOutOfAttackPose();
    }
}

function triggerRecallSequence() {
    // Recall in strict launch order: Globals.feathers is appended to in
    // executeThrow(), so filtering it in array order already gives us the
    // "first thrown -> last thrown" sequence the design asks for.
    // All recalls use a uniform stagger (CONFIG.recallInterval) so the
    // special weapon no longer gets an extra pause after it returns.
    const deployed = Globals.feathers.filter(f => f.phase === 'deployed' && !f.recallPending);
    if (deployed.length === 0) return;
    Globals.audioManager?.playRecallStart();

    let delay = 0;
    deployed.forEach((feather, index) => {
        feather.recallPending = true;
        const timerId = setTimeout(() => {
            recallTimers = recallTimers.filter(id => id !== timerId);
            if (!Globals.feathers.includes(feather)) return;
            feather.recallPending = false;
            feather.startRecall(index);
        }, delay);
        recallTimers.push(timerId);
        delay += CONFIG.recallInterval;
    });
}

function shouldTriggerRecallWhileMoving() {
    if (!isMoving) return false;
    const threshold = Math.max(0, CONFIG.recallMoveDistanceAfterStop ?? 0);
    return threshold === 0 || recallMoveDistanceSinceStop >= threshold;
}

function updatePlayerMovement(delta) {
    previousPlayerPosition.copy(Globals.player.mesh.position);
    const inputVelocity = _scratchInputVelocity.set(0, 0, 0);
    if (keys.w || keys.ArrowUp) inputVelocity.z -= 1; 
    if (keys.s || keys.ArrowDown) inputVelocity.z += 1; 
    if (keys.a || keys.ArrowLeft) inputVelocity.x -= 1; 
    if (keys.d || keys.ArrowRight) inputVelocity.x += 1;
    inputVelocity.x += joystick.x;
    inputVelocity.z += joystick.y;
    const indicatorInputX = THREE.MathUtils.clamp(inputVelocity.x, -2, 2);
    const indicatorInputZ = THREE.MathUtils.clamp(inputVelocity.z, -2, 2);
    
    const wasMoving = isMoving; 
    
    // 判断是否有输入意图 (按下摇杆或键盘)，只要有意图就进入isMoving状态，触发动画和走A逻辑
    const hasInputIntent = keys.w || keys.ArrowUp || keys.s || keys.ArrowDown || keys.a || keys.ArrowLeft || keys.d || keys.ArrowRight || joystick.isActive;

    animVelocity.copy(currentVelocity);

    if (hasInputIntent) {
        if (inputVelocity.lengthSq() > 0) {
            inputVelocity.normalize();
            // 复用 player 上的固定 Vector3，避免每帧 clone（首次时新建）
            if (!Globals.player.lastMoveDirection) {
                Globals.player.lastMoveDirection = new THREE.Vector3();
            }
            Globals.player.lastMoveDirection.copy(inputVelocity);
        }
        
        const targetVelocityX = inputVelocity.x * CONFIG.maxMoveSpeedX;
        const targetVelocityZ = inputVelocity.z * CONFIG.maxMoveSpeedZ;
        animVelocity.set(targetVelocityX, 0, targetVelocityZ);
        
        const currentSpeed = Math.hypot(currentVelocity.x, currentVelocity.z);
        const targetSpeed = Math.hypot(targetVelocityX, targetVelocityZ);
        
        currentVelocity.x = THREE.MathUtils.lerp(currentVelocity.x, targetVelocityX, delta * CONFIG.moveAcceleration);
        currentVelocity.z = THREE.MathUtils.lerp(currentVelocity.z, targetVelocityZ, delta * CONFIG.moveAcceleration);
        
        const lerpedSpeed = Math.hypot(currentVelocity.x, currentVelocity.z);
        
        // Compensate for "chord cutting" speed dip during direction changes
        if (currentSpeed > 0.1 && targetSpeed > 0.1 && lerpedSpeed > 0.01) {
            const expectedSpeed = THREE.MathUtils.lerp(currentSpeed, targetSpeed, delta * CONFIG.moveAcceleration);
            const factor = expectedSpeed / lerpedSpeed;
            // Apply compensation to maintain momentum, avoiding massive inflations on direct 180-turns near origin
            if (factor > 1.0) {
                const appliedFactor = Math.min(factor, 3.0);
                currentVelocity.x *= appliedFactor;
                currentVelocity.z *= appliedFactor;
            }
        }
        
        isMoving = true;
    } else {
        // No input intent: the player has released keys/joystick. We keep
        // applying friction so currentVelocity smoothly decays (this is
        // what produces the post-release slide visual), but isMoving is
        // considered FALSE the instant input ends. This way the attack
        // trigger can fire immediately on stop — the body slides to a
        // halt while the attack animation kicks off in parallel,
        // matching the "stop-instantly-and-attack" feel from rapid taps.
        currentVelocity.x = THREE.MathUtils.lerp(currentVelocity.x, 0, delta * CONFIG.moveFriction);
        currentVelocity.z = THREE.MathUtils.lerp(currentVelocity.z, 0, delta * CONFIG.moveFriction);

        if (currentVelocity.lengthSq() < 0.1) {
            currentVelocity.set(0, 0, 0);
        }
        isMoving = false;
    }
    
    if (currentVelocity.lengthSq() > 0) {
        const nextX = Globals.player.mesh.position.x + currentVelocity.x * delta;
        const nextZ = Globals.player.mesh.position.z + currentVelocity.z * delta;
        
        // Use a strictly small footprint radius to represent ONLY the player's feet.
        // This prevents the large visual head from colliding with obstacles.
        
        let colMinX, colMaxX, colMinZ, colMaxZ;

        if (CONFIG.useCustomCollision) {
            const r = CONFIG.customCollisionRadius;
            colMinX = -r; colMaxX = r;
            colMinZ = -r; colMaxZ = r;
        } else {
            const rx = 0.08 * CONFIG.playerScale;
            const rz = 0.05 * CONFIG.playerScale;
            colMinX = -rx; colMaxX = rx;
            colMinZ = 0; colMaxZ = rz;
        }

        let hitX = false;
        let hitZ = false;
        let hitObsX = null;
        let hitObsZ = null;

        // AABB Collision with obstacles
        if (Globals.obstacles && Globals.obstacles.length > 0) {
            for (const obs of Globals.obstacles) {
                // Check X movement
                // Z logic: Check the collision volume matching player pos
                if (nextX + colMaxX > obs.minX && nextX + colMinX < obs.maxX &&
                    Globals.player.mesh.position.z + colMaxZ > obs.minZ && Globals.player.mesh.position.z + colMinZ < obs.maxZ) {
                    hitX = true;
                    hitObsX = obs;
                }
                // Check Z movement
                if (Globals.player.mesh.position.x + colMaxX > obs.minX && Globals.player.mesh.position.x + colMinX < obs.maxX &&
                    nextZ + colMaxZ > obs.minZ && nextZ + colMinZ < obs.maxZ) {
                    hitZ = true;
                    hitObsZ = obs;
                }
            }
        }

        // ── Wall-slide logic ──
        // When the player hits a wall, we don't just zero out the blocked axis.
        // We also inject an extra "slide boost" along the wall (the unblocked axis),
        // derived from how hard the player is pushing INTO the wall.
        //
        // Formula for the boost:
        //   slideBoost = |blocked velocity component| * slideMultiplier
        //   slideMultiplier = wallSlideBaseMultiplier + perpRatio * wallSlideAngleMultiplier
        //
        // Where perpRatio = how much of the player's input is perpendicular to the wall (0..1).
        // The boost is added ON TOP of whatever parallel velocity the player already has.

        const wsBase = CONFIG.wallSlideBaseMultiplier !== undefined ? CONFIG.wallSlideBaseMultiplier : 0.3;
        const wsAngle = CONFIG.wallSlideAngleMultiplier !== undefined ? CONFIG.wallSlideAngleMultiplier : 0.7;

        if (hitX) {
            // Wall is perpendicular to X axis. Player's X velocity is blocked.
            // The "perpendicular ratio" is how much of the input points into the wall (X component).
            const inputLen = inputVelocity.length();
            const perpRatio = inputLen > 0 ? Math.abs(inputVelocity.x) / inputLen : 0;
            const slideMultiplier = wsBase + perpRatio * wsAngle;

            // The blocked speed that we want to partially redirect along Z
            const blockedSpeed = Math.abs(currentVelocity.x);
            const slideBoost = blockedSpeed * slideMultiplier;

            // Determine slide direction: use the Z component of input intent
            if (inputVelocity.z !== 0) {
                currentVelocity.z += Math.sign(inputVelocity.z) * slideBoost;
            } else if (currentVelocity.z !== 0) {
                currentVelocity.z += Math.sign(currentVelocity.z) * slideBoost;
            }

            // Clamp so sliding never exceeds normal max speed on that axis
            currentVelocity.z = THREE.MathUtils.clamp(currentVelocity.z, -CONFIG.maxMoveSpeedZ, CONFIG.maxMoveSpeedZ);

            // Zero out the blocked axis
            currentVelocity.x = 0;
        }

        if (hitZ) {
            const inputLen = inputVelocity.length();
            const perpRatio = inputLen > 0 ? Math.abs(inputVelocity.z) / inputLen : 0;
            const slideMultiplier = wsBase + perpRatio * wsAngle;

            const blockedSpeed = Math.abs(currentVelocity.z);
            const slideBoost = blockedSpeed * slideMultiplier;

            if (inputVelocity.x !== 0) {
                currentVelocity.x += Math.sign(inputVelocity.x) * slideBoost;
            } else if (currentVelocity.x !== 0) {
                currentVelocity.x += Math.sign(currentVelocity.x) * slideBoost;
            }

            // Clamp so sliding never exceeds normal max speed on that axis
            currentVelocity.x = THREE.MathUtils.clamp(currentVelocity.x, -CONFIG.maxMoveSpeedX, CONFIG.maxMoveSpeedX);

            currentVelocity.z = 0;
        }

        Globals.player.mesh.position.addScaledVector(currentVelocity, delta);
    }

    const marginX = 0.6 * CONFIG.playerScale;
    const marginZ = 0.8 * CONFIG.playerScale;
    Globals.player.mesh.position.x = THREE.MathUtils.clamp(Globals.player.mesh.position.x, visibleGroundBounds.minX + marginX, visibleGroundBounds.maxX - marginX);
    Globals.player.mesh.position.z = THREE.MathUtils.clamp(Globals.player.mesh.position.z, visibleGroundBounds.minZ + marginZ, visibleGroundBounds.maxZ - marginZ);
    Globals.player.updateMoveIndicator(Globals.player.mesh.position, indicatorInputX, indicatorInputZ, delta);

    const movedDistanceThisFrame = previousPlayerPosition.distanceTo(Globals.player.mesh.position);
    if (isMoving) {
        recallMoveDistanceSinceStop = wasMoving
            ? recallMoveDistanceSinceStop + movedDistanceThisFrame
            : movedDistanceThisFrame;
    } else {
        recallMoveDistanceSinceStop = 0;
    }
    
    let startedThrowSpawnDelayThisFrame = false;

    if (isWindupActive) {
        windupTimer -= delta;
        if (windupTimer <= 0) {
            isWindupActive = false;
            // Windup just completed. The recover (backswing) animation will
            // start automatically on the player side this frame. We may hold
            // the actual weapon spawn for a short configurable delay so the
            // player visually sees the swinging arm BEFORE the feather pops
            // out — this aligns "weapon appears" with "you can now interrupt"
            // and avoids the unintuitive "I see the swing but no weapon yet"
            // window. Movement during the delay still cancels the whole
            // attack (no feather spawned). Once the delay has elapsed, the
            // feather is spawned and the remaining recover plays out as
            // normal (interruptible by movement).
            if (isMoving) {
                if (wasMoving) {
                    _cancelPendingThrow();
                } else {
                    _clearPendingThrowState();
                }
            } else {
                const spawnDelay = getAttackThrowSpawnDelay();
                if (spawnDelay > 0) {
                    isThrowSpawnDelayActive = true;
                    throwSpawnDelayTimer = spawnDelay;
                    startedThrowSpawnDelayThisFrame = true;
                    // Tell the player the spawn-delay window has begun so
                    // the held-weapon pose animation can keep advancing
                    // across windup-end (instead of snapping to invisible
                    // and freezing at whatever stayRatio cut it off at).
                    Globals.player?.beginThrowSpawnDelay();
                } else {
                    executeThrow();
                }
            }
        }
    }

    if (isThrowSpawnDelayActive && !startedThrowSpawnDelayThisFrame && !isMoving) {
        throwSpawnDelayTimer -= delta;
        if (throwSpawnDelayTimer <= 0) {
            isThrowSpawnDelayActive = false;
            executeThrow();
        }
    }

    // Single attack path: player attacks when stopped, recalls when moving.
    _handleAttackTrigger(wasMoving);
}

// ---------------------------------------------------------------------------
// Attack trigger: fire a new attack as long as the player is stopped; when
// the player starts moving again, defer recalls until they have covered the
// configured post-stop distance. Attacking and moving are mutually exclusive
// by design — so the animation stack can cleanly transition between the
// running gait and the stationary attack gesture without having to blend them.
// ---------------------------------------------------------------------------
function _handleAttackTrigger(wasMoving) {
    const stopped = !isMoving;
    const wasStopped = !wasMoving;
    if (stopped) {
        if (!wasStopped) {
            // Just became stationary -> begin new attack sequence.
            Globals.player.resetAttackSequence();
            // Reset the shoot cooldown on every stop edge so the windup
            // (抬手侧倾 / 蓄力) starts on the SAME FRAME the player stops.
            // Without this, a kite-style "walk A" loop — where the player
            // may release keys before shootCooldown has elapsed since the
            // last throw — would wait out the remainder of that cooldown
            // before beginning the next attack, producing the "occasional
            // hitch before windup" the user observed. By contract, moving
            // is our only cooldown between attacks, so clearing it on
            // stop makes every stop feel instant.
            lastShootTime = -Infinity;
            // Also finalize any leftover recover (backswing) state so it
            // doesn't block the fresh windup. Previously we only reset
            // lastShootTime when interruptRecover() actually interrupted
            // something; now the reset is unconditional and this call is
            // just best-effort cleanup.
            Globals.player.interruptRecover();
            // Note: we deliberately do NOT interrupt in-flight recalls here.
            // By design, once a weapon has been thrown it will always land
            // and always be recalled back to the player's hand. Any pending
            // / mid-air recall is allowed to finish naturally, even if the
            // player stops to attack again; the new attack fires in parallel
            // with the ongoing recall.
            // Arm the move→attack turn: body was facing the last travel
            // direction; it now needs to pivot toward the attack aim. The
            // rotation uses CONFIG.moveToAttackTurnSpeed (tunable from the
            // control panel) instead of the general turnSpeed. Any pending
            // attack-break turn is cleared since the player is no longer
            // in that transition.
            attackBreakTurnActive = false;
            moveToAttackTurnActive = true;
        }
        const now = Globals.clock.getElapsedTime();
        const cooldown = CONFIG.shootCooldown ?? 0.35;
        if (!isWindupActive && !isThrowSpawnDelayActive && now - lastShootTime > cooldown) {
            const startedWindup = shootFeather();
            if (startedWindup) lastShootTime = now;
        }
    } else if (wasStopped && !stopped) {
        // Started moving again. The player's design contract:
        //   * recover (backswing) can always be cancelled by movement
        //   * windup (前摇) is ALSO fully cancelled by movement — both
        //     visually AND logically. No feather is ever spawned for an
        //     attack whose windup got interrupted, no matter how briefly.
        //   * during the post-windup spawn-delay window (weapon hasn't
        //     materialized yet), movement is still a plain cancel — no
        //     feather is ever spawned for this attack either.
        // Either way we want a HARD cut from attack pose to running pose,
        // with zero blended "running while winding up" frames. So we snap
        // every attack-driven joint back to neutral right now; the running
        // branch will take over on the next animation tick from a clean
        // T-pose.
        //
        // Historical bug: previously this branch only cleared the spawn-
        // delay timer, NOT the windup timer. That meant a rapid tap during
        // windup would visually reset the attack pose but leave windupTimer
        // ticking down silently in updatePlayerMovement(). By the time it
        // hit zero, isMoving was usually false again (taps are short), so
        // executeThrow() would fire a feather anyway — i.e. fast taps
        // produced ghost throws faster than shootCooldown allowed. Clearing
        // pending throw state unconditionally here fixes that: ANY input
        // edge during the entire pre-spawn window kills the attack.
        const p = Globals.player;
        if (p.isAttacking || p.attackFacingAngle !== null) {
            // Only arm the attack-break facing turn if we actually had an
            // attack facing to rotate out of. Checked BEFORE the snap
            // because snapOutOfAttackPose() clears attackFacingAngle.
            attackBreakTurnActive = true;
        }
        if (isWindupActive || isThrowSpawnDelayActive) {
            _clearPendingThrowState();
        }
        p.snapOutOfAttackPose();
        // Recall itself is distance-gated in animate(); movement still
        // cancels the attack pose immediately.
    }
    // No "still moving" branch needed: snapOutOfAttackPose() above already
    // cleared isAttacking on the wasStopped→!stopped edge, so _updateAnimation_main
    // will never re-enter the attack branch to advance attackTimer into a
    // recover phase. Both the windup timer and the post-windup throw-spawn
    // delay are cleared on the movement-start edge above, so no pending
    // throw can survive a movement interruption.
}

// Update the player's world-space facing. Upper and lower body share one
// orientation (they are no longer decoupled): when attacking, the whole
// body faces the locked target; when moving, the whole body faces the
// joystick intent direction. The turn is smoothly slerped at
// CONFIG.turnSpeed per second.
function updatePlayerFacing(delta, hasTargetLock, target) {
    const player = Globals.player;
    let desiredAngle = null;
    let indicatorTargetPos = null;

    // Priority order:
    //   1. Player has movement input → always face the movement direction,
    //      even mid-attack. This lets the body smoothly slerp toward the
    //      joystick direction while windup is still resolving (the throw
    //      direction itself is captured in executeThrow() from the live
    //      target, independent of player.mesh orientation), and guarantees
    //      no hard snap when an attack ends while the player is moving.
    //   2. Attacking with live target lock and standing still → face enemy.
    //   3. Attacking but target gone and standing still → frozen aim angle.
    const hasMoveIntent = isMoving && player.lastMoveDirection && player.lastMoveDirection.lengthSq() > 0.0001;

    if (hasMoveIntent) {
        const md = player.lastMoveDirection;
        desiredAngle = Math.atan2(md.x, md.z);
        // Don't show the target indicator while moving; moving is "not
        // attacking" from the UI's perspective.
        indicatorTargetPos = null;
    } else if (hasTargetLock && target) {
        // Attacking with a live target lock: face the enemy.
        const pPos = player.mesh.position;
        const tPos = target.mesh.position;
        desiredAngle = Math.atan2(tPos.x - pPos.x, tPos.z - pPos.z);
        indicatorTargetPos = tPos.clone();
        indicatorTargetPos.y = pPos.y;

        // Keep attackFacingAngle fresh so that if the enemy dies mid-windup
        // we still throw in the direction we were aiming when windup began.
        if (player.isAttacking) {
            player.attackFacingAngle = desiredAngle;
        }
    } else if (player.isAttacking && player.attackFacingAngle !== null) {
        // Attacking but target disappeared mid-gesture: honor the frozen
        // facing angle captured at windup start, so the throw still lands
        // roughly where it was aimed.
        desiredAngle = player.attackFacingAngle;
    } else if (player.lastMoveDirection && player.lastMoveDirection.lengthSq() > 0.0001) {
        // Lingering movement direction after input released: keep facing it
        // until slerp settles (prevents the indicator jitter one frame after
        // releasing the joystick).
        const md = player.lastMoveDirection;
        desiredAngle = Math.atan2(md.x, md.z);
    }

    // Cancel the attack-break transition when not moving — it only makes
    // sense while rotating toward a movement direction.
    if (!hasMoveIntent) {
        attackBreakTurnActive = false;
    }
    // Cancel the move→attack transition when the player starts moving
    // again, or when there is no attack facing to rotate into (no target
    // lock and no frozen aim).
    if (hasMoveIntent) {
        moveToAttackTurnActive = false;
    }
    const rotatingIntoAttack = (hasTargetLock && target) ||
                               (player.isAttacking && player.attackFacingAngle !== null);
    if (!rotatingIntoAttack) {
        moveToAttackTurnActive = false;
    }

    if (desiredAngle === null) {
        Globals.targetIndicator.update(null, delta);
        return;
    }

    // Choose angular velocity. Priority: the two transitional rates take
    // precedence over the general turnSpeed; they are mutually exclusive by
    // construction (one requires movement, the other requires stillness).
    //   * attackBreakTurnActive  → CONFIG.attackBreakTurnSpeed
    //     ("snap out of attack pose into movement")
    //   * moveToAttackTurnActive → CONFIG.moveToAttackTurnSpeed
    //     ("snap from movement into attack pose")
    //   * else                   → CONFIG.turnSpeed
    let turnRate = CONFIG.turnSpeed;
    if (attackBreakTurnActive) {
        turnRate = CONFIG.attackBreakTurnSpeed;
    } else if (moveToAttackTurnActive) {
        turnRate = CONFIG.moveToAttackTurnSpeed;
    }
    const targetQuat = _scratchTargetQuat.setFromAxisAngle(_scratchAxisY, desiredAngle);
    player.mesh.quaternion.slerp(targetQuat, delta * turnRate);

    // Once the body has effectively aligned with the target direction,
    // drop whichever transitional flag is active so subsequent turns use
    // the normal turnSpeed. ~0.05 rad ≈ 3°: close enough to consider
    // "aligned".
    if (attackBreakTurnActive || moveToAttackTurnActive) {
        if (player.mesh.quaternion.angleTo(targetQuat) < 0.05) {
            attackBreakTurnActive = false;
            moveToAttackTurnActive = false;
        }
    }

    Globals.targetIndicator.update(indicatorTargetPos, delta);
}

function updatePlayerHUD() {
    const v = _scratchHudVec.copy(Globals.player.mesh.position);
    v.y += 1.6; 
    v.project(Globals.camera);
    
    const w = document.getElementById('game-wrapper'); 
    const hud = document.getElementById('player-hud');
    hud.style.left = `${(v.x * .5 + .5) * w.clientWidth}px`; 
    hud.style.top = `${(v.y * -.5 + .5) * w.clientHeight}px`;
    
    // The HUD is currently hidden via CSS, but we keep the logic working so
    // it renders correctly if re-enabled. The 4 icons track the global throw
    // cycle, not the configurable field-count limit. When special attacks are
    // disabled, the 4th icon simply stays lit.
    const cyclePos = getIndicatorCycleCount(); // 0..4 when specials are enabled; otherwise 0..3
    const icons = hud.children;

    for (let i = 0; i < 4; i++) {
        const isUsed = i < cyclePos;
        icons[i].style.opacity = isUsed ? '0.15' : '1';
        icons[i].style.transform = isUsed ? 'scale(0.7)' : 'scale(1)';
    }
}

// FPS 累计器：每帧累加 delta + 帧数，每 ~0.25s 写一次 #fps-display 的文本。
// 仅在 CONFIG.showFps 为真时才更新文本，DOM 显隐由 ControlPanel 切换 .is-visible。
const _fpsState = { acc: 0, frames: 0, el: null };

// 屏幕正上方"持续移动以回收武器"提示控制：
// - 场上存在已扔出的武器（任何 phase：shooting / deployed / recalling）时显示
// - 全部回收后（Globals.feathers.length === 0）隐藏
// - DOM 缓存避免每帧 getElementById；用 visible 缓存只在状态变化时操作 classList
//
// ★ 新手引导限次：
//   - 每完成一次"出现 → 消失"的完整循环算 1 次触发（在 visible: true → false 的下降沿 +1）
//   - 达到 RECALL_HINT_MAX_TRIGGERS 次后，本次启动游戏不再显示这条提示
//   - 计数仅存在内存里，不写入 localStorage —— 每次重新启动游戏会重置（用户当前需求即是
//     "每次启动游戏后…3 次"，意味着这是按会话计数，不跨会话持久化）
const RECALL_HINT_MAX_TRIGGERS = 3;
const _recallHintState = {
    el: null,
    visible: false,
    /** 已完成的"出现→消失"次数。达到 RECALL_HINT_MAX_TRIGGERS 后永久禁用本次会话的提示。 */
    triggeredCount: 0,
    /** 计数器是否已封顶（封顶后即使有武器在场也不会再亮起）。 */
    locked: false,
};

function updateRecallHint() {
    if (!_recallHintState.el) {
        _recallHintState.el = document.getElementById('recall-hint');
        if (!_recallHintState.el) return;
    }
    // Globals.feathers 在 Feather.destroy() 完成回收返回后会 splice 出去，
    // 因此 length > 0 等价于"场上还有未回收的武器"。
    // locked 之后 shouldShow 永远为 false，等同于"这条提示彻底退出本次会话"。
    const shouldShow = !_recallHintState.locked && Globals.feathers.length > 0;
    if (shouldShow !== _recallHintState.visible) {
        // ★ 下降沿（true → false）= 一次完整的"出现-消失"循环完成，计数 +1。
        //   注意要在更新 visible 之前判断旧值。
        if (_recallHintState.visible && !shouldShow) {
            _recallHintState.triggeredCount++;
            if (_recallHintState.triggeredCount >= RECALL_HINT_MAX_TRIGGERS) {
                _recallHintState.locked = true;
            }
        }
        _recallHintState.visible = shouldShow;
        _recallHintState.el.classList.toggle('is-visible', shouldShow);
    }
}

function animate() {
    const delta = Globals.clock.getDelta(), time = Globals.clock.getElapsedTime();

    if (CONFIG.showFps) {
        _fpsState.acc += delta;
        _fpsState.frames++;
        if (_fpsState.acc >= 0.25) {
            if (!_fpsState.el) _fpsState.el = document.getElementById('fps-display');
            if (_fpsState.el) {
                const fps = _fpsState.frames / _fpsState.acc;
                _fpsState.el.textContent = `FPS ${fps.toFixed(0)}`;
            }
            _fpsState.acc = 0;
            _fpsState.frames = 0;
        }
    } else if (_fpsState.frames !== 0 || _fpsState.acc !== 0) {
        // 关闭后清空累计，避免下次开启时第一刷读到陈旧的窗口
        _fpsState.acc = 0;
        _fpsState.frames = 0;
    }

    const target = getClosestEnemy();
    // Target-lock facing is independent of the configurable field-weapon
    // limit, so it still only depends on (stopped && target exists).

    updatePlayerMovement(delta);
    // Target-lock facing only engages while the player is stopped AND
    // there is a valid target (i.e. they are in the "attacking" half of
    // the stop/move duality).
    const playerAttacking = !isMoving;
    updatePlayerFacing(delta, playerAttacking && !!target, target);

    updateCameraFollow(delta);
    updateShake(delta);
    Globals.player.updateAnimation(delta, time, isMoving, animVelocity);
    Globals.player.updateTrajectory(delta);
    Telemetry.update(currentVelocity.length(), Globals.player.mesh.position.x, Globals.player.mesh.position.y, Globals.player.mesh.position.z);
    updatePlayerHUD(); 
    updateRecallHint();
    updatePendingEnemySpawns(delta);
    updateFloatingTexts(delta);
    
    if(Globals.particleManager) Globals.particleManager.update(delta);
    
    for (let i = Globals.recallEffects.length - 1; i >= 0; i--) {
        if (!Globals.recallEffects[i].update(delta)) Globals.recallEffects.splice(i, 1);
    }
    for (let i = Globals.interruptEffects.length - 1; i >= 0; i--) {
        if (!Globals.interruptEffects[i].update(delta)) Globals.interruptEffects.splice(i, 1);
    }
    for (let i = Globals.spawnEffects.length - 1; i >= 0; i--) {
        if (!Globals.spawnEffects[i].update(delta)) Globals.spawnEffects.splice(i, 1);
    }
    for (let i = Globals.slashEffects.length - 1; i >= 0; i--) {
        if (!Globals.slashEffects[i].update(delta)) Globals.slashEffects.splice(i, 1);
    }
    for (let i = Globals.hitSparkEffects.length - 1; i >= 0; i--) {
        if (!Globals.hitSparkEffects[i].update(delta)) {
            Globals.hitSparkEffects[i].destroy();
            Globals.hitSparkEffects.splice(i, 1);
        }
    }
    for (let i = Globals.javelinVfxEffects.length - 1; i >= 0; i--) {
        if (!Globals.javelinVfxEffects[i].update(delta)) {
            Globals.javelinVfxEffects[i].destroy();
            Globals.javelinVfxEffects.splice(i, 1);
        }
    }
    for (let i = Globals.enemyHitBurstEffects.length - 1; i >= 0; i--) {
        if (!Globals.enemyHitBurstEffects[i].update(delta)) {
            Globals.enemyHitBurstEffects[i].destroy();
            Globals.enemyHitBurstEffects.splice(i, 1);
        }
    }
    for (let i = Globals.bloodStains.length - 1; i >= 0; i--) {
        if (!Globals.bloodStains[i].update(delta)) { 
            Globals.bloodStains[i].destroy(); 
            Globals.bloodStains.splice(i, 1); 
        }
    }
    for (let i = Globals.enemies.length - 1; i >= 0; i--) { 
        Globals.enemies[i].update(delta, time); 
        if (Globals.enemies[i].isDead) Globals.enemies.splice(i, 1); 
    }
    // 柱状敌人的子弹（直线飞行 + 到期自动消失；当前仅测试，不造成玩家伤害）
    if (Globals.pillarBullets && Globals.pillarBullets.length > 0) {
        for (let i = Globals.pillarBullets.length - 1; i >= 0; i--) {
            if (!Globals.pillarBullets[i].update(delta, time)) {
                Globals.pillarBullets.splice(i, 1);
            }
        }
    }
    updateWave4Mode(delta);
    // Idempotent safety net: once the player has re-entered movement and
    // covered the configured distance since that stop, make sure every
    // deployed feather is being recalled. triggerRecallSequence() itself
    // skips feathers that are already pending/recalling, so calling it
    // every eligible frame is cheap.
    if (shouldTriggerRecallWhileMoving()) {
        triggerRecallSequence();
    }

    // Push the current recall-progress state onto the foot-ring indicator.
    // The inner ring is fully decoupled from weapon state: it's a pure
    // movement gauge.
    //   * shown   = isMoving (visible only while the player walks)
    //   * filled  = recallMoveDistanceSinceStop / recallMoveDistanceAfterStop
    // The recall trigger happens exactly when the gauge fills (because both
    // are driven by the same accumulator + threshold), but that's a happy
    // alignment — the indicator itself doesn't read weapon state at all.
    // So: the moment the player stops walking the ring fades out, regardless
    // of whether weapons are still flying / deployed / being recalled.
    if (Globals.player && typeof Globals.player.setIndicatorRecallProgress === 'function') {
        const threshold = Math.max(0, CONFIG.recallMoveDistanceAfterStop ?? 0);
        let progress;
        if (!isMoving) {
            progress = 0;
        } else if (threshold <= 0) {
            // Threshold of 0 means "any movement instantly recalls", so the
            // gauge has no meaningful range to fill — clamp to full.
            progress = 1;
        } else {
            progress = Math.min(1, recallMoveDistanceSinceStop / threshold);
        }
        // Pass isMoving as the second argument: it now drives the show/hide
        // envelope directly (no longer "hasDeployed").
        Globals.player.setIndicatorRecallProgress(progress, isMoving);
    }

    for (let i = Globals.feathers.length - 1; i >= 0; i--) {
        Globals.feathers[i].update(delta);
    }

    // Update OutlinePass selection: 复用同一个 array，避免每帧 new 数组 + spread。
    // OutlinePass 内部不会保存 selectedObjects 的引用快照，每帧直接读这个数组即可。
    //
    // 注意：敌人故意不加入 OutlinePass。
    //   OutlinePass 后处理用自己的 depth/edge 渲染目标重新绘制描边，但它使用的内部材质替换不会
    //   执行我们注入到敌人材质上的 onBeforeCompile vertex 形变（squash & stretch + bend）。
    //   结果就是描边总是按"原始几何"绘制，敌人形变后描边和身体严重错位 —— 看起来很怪。
    //   保留障碍物 / 羽毛的描边（它们没有顶点形变，描边是稳定的）。
    if (Globals.outlinePass) {
        const selection = Globals.outlinePass.selectedObjects;
        selection.length = 0;
        if (obstacleGroup) {
            const children = obstacleGroup.children;
            for (let i = 0; i < children.length; i++) selection.push(children[i]);
        }
        const feathers = Globals.feathers;
        for (let i = 0; i < feathers.length; i++) {
            const f = feathers[i];
            if (f.mesh) selection.push(f.mesh);
        }
    }
    if (Globals.playerCreasePass) {
        Globals.playerCreasePass.update();
    }
    
    Globals.scene.traverse(darkenNonBloomed);
    if (Globals.composer) Globals.composer.render();
    Globals.scene.traverse(restoreMaterial);
    
    if (Globals.finalComposer) {
        Globals.finalComposer.render();
    } else {
        Globals.renderer.render(Globals.scene, Globals.camera);
    }
}

function onWindowResize() { 
    const w = document.getElementById('game-wrapper'); 
    updateCameraFrustum();
    // 跨屏拖动等情形下 devicePixelRatio 可能变化，重新同步一次像素比，避免画面糊在旧 DPR 上。
    const pr = getEffectivePixelRatio();
    Globals.renderer.setPixelRatio(pr);
    if (Globals.composer) Globals.composer.setPixelRatio(pr);
    if (Globals.finalComposer) Globals.finalComposer.setPixelRatio(pr);
    Globals.renderer.setSize(w.clientWidth, w.clientHeight); 
    if (Globals.composer) Globals.composer.setSize(w.clientWidth, w.clientHeight);
    if (Globals.finalComposer) Globals.finalComposer.setSize(w.clientWidth, w.clientHeight);
    updateVisibleGroundBounds();
    refreshInputLayout();
}

// 启动入口
init();
