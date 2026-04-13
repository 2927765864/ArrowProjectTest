import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AudioManager } from './audio/AudioManager.js';
import { CONFIG } from './config.js';
import { Globals, updateShake, triggerShake, getClosestEnemy, showFloatingText, updateFloatingTexts } from './utils.js';
import { keys, joystick, initInput, refreshInputLayout } from './Input.js';
import { InterruptBurstEffect } from './effects/InterruptBurstEffect.js';
import { TargetIndicator } from './effects/TargetIndicator.js';
import { ParticleManager } from './effects/ParticleManager.js';
import { SpawnBeamEffect, SpawnTelegraphEffect } from './effects/EnemySpawnEffects.js';
import { FeatherLaunchEffect } from './effects/FeatherLaunchEffect.js';
import { WindRingEffect } from './effects/WindRingEffect.js';
import { PlayerCharacter } from './entities/Player.js';
import { Enemy } from './entities/Enemy.js';
import { Feather } from './entities/Feather.js';
import { setupControlPanel } from './ui/ControlPanel.js';
import { Telemetry } from './ui/Charts.js';

let isMoving = false;
let lastShootTime = 0;
const MAX_FEATHERS = 4;
let recallTimers = [];
const currentVelocity = new THREE.Vector3();
const ARENA_HEIGHT = 48;
const ARENA_WIDTH = ARENA_HEIGHT * 9 / 16;
const visibleGroundBounds = {
    minX: -ARENA_WIDTH * 0.5,
    maxX: ARENA_WIDTH * 0.5,
    minZ: -ARENA_HEIGHT * 0.5,
    maxZ: ARENA_HEIGHT * 0.5
};
const pendingEnemySpawns = [];
let boundaryGroup = null;
let arenaFloor = null;
let solidFloorMat = null;
let checkerboardFloorMat = null;
let obstacleGroup = null;

function createRenderer() {
    return new THREE.WebGLRenderer({ antialias: true, stencil: true });
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

function init() {
    Globals.uiLayer = document.getElementById('ui-layer');
    Globals.scene = new THREE.Scene();
    Globals.scene.background = new THREE.Color(0x1a1532);
    // // Globals.scene.fog = new THREE.Fog(0x8a8e94, 18, 56);
    
    const wrapper = document.getElementById('game-wrapper');
    Globals.camera = createOrthographicCamera(wrapper.clientWidth / wrapper.clientHeight);
    
    const camDist = 60;
    const angleX = THREE.MathUtils.degToRad(55);
    const angleY = THREE.MathUtils.degToRad(0);
    Globals.baseCamPos.set(
        Math.sin(angleY) * Math.cos(angleX) * camDist,
        Math.sin(angleX) * camDist,
        Math.cos(angleY) * Math.cos(angleX) * camDist
    );
    Globals.cameraOffset.copy(Globals.baseCamPos);
    Globals.baseCamTarget.set(0, 0, 0);
    Globals.camera.position.copy(Globals.baseCamPos);
    Globals.camera.lookAt(Globals.baseCamTarget);
    
    Globals.renderer = createRenderer();
    Globals.renderer.setPixelRatio(window.devicePixelRatio);
    Globals.renderer.setSize(wrapper.clientWidth, wrapper.clientHeight);
    Globals.renderer.shadowMap.enabled = true;
    Globals.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('canvas-container').appendChild(Globals.renderer.domElement);

    const pixelRatio = window.devicePixelRatio;
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
    const renderPass = new RenderPass(Globals.scene, Globals.camera);
    Globals.composer.addPass(renderPass);

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
    Globals.finalComposer.addPass(renderPass);
    Globals.finalComposer.addPass(mixPass);

    Globals.outlinePass = new OutlinePass(
        new THREE.Vector2(wrapper.clientWidth, wrapper.clientHeight),
        Globals.scene,
        Globals.camera
    );
    Globals.outlinePass.edgeStrength = 4.0;
    Globals.outlinePass.edgeGlow = 0.0;
    Globals.outlinePass.edgeThickness = 1.0;
    Globals.outlinePass.pulsePeriod = 0;
    // 藤紫色边缘给怪物/环境，钛啡绿色边缘给玩家，
    // 由于 OutlinePass 不能轻易针对不同物体设置不同颜色（需要分组渲染），
    // 我们可以默认采用钛啡绿 0x1a1532（非常深的紫黑）或者亮色作为通用轮廓线
    Globals.outlinePass.visibleEdgeColor.setHex(0x1a1532);
    Globals.outlinePass.hiddenEdgeColor.setHex(0x1a1532);
    
    // Wrap OutlinePass render to hide X-Ray meshes (prevents Z-fighting internal lines)
    const originalOutlineRender = Globals.outlinePass.render.bind(Globals.outlinePass);
    Globals.outlinePass.render = function(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
        if (Globals.player && Globals.player.xrayMeshes) {
            Globals.player.xrayMeshes.forEach(m => m.visible = false);
        }
        originalOutlineRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
        if (Globals.player && Globals.player.xrayMeshes) {
            Globals.player.xrayMeshes.forEach(m => m.visible = !!CONFIG.xrayEnabled);
        }
    };
    
    Globals.finalComposer.addPass(Globals.outlinePass);

    Globals.finalComposer.addPass(outputPass);
    
    const ambientLight = new THREE.AmbientLight(0x5e55a2, 1.2);
    Globals.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0x91c53a, 1.8);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.left = -22;
    dirLight.shadow.camera.right = 22;
    dirLight.shadow.camera.top = 28;
    dirLight.shadow.camera.bottom = -28;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 120;
    dirLight.shadow.bias = -0.00015;
    dirLight.shadow.normalBias = 0.02;
    dirLight.shadow.camera.updateProjectionMatrix();
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

    const arenaFloorGeo = new THREE.PlaneGeometry(1, 1);
    arenaFloor = new THREE.Mesh(arenaFloorGeo, CONFIG.floorStyle === 'checkerboard' ? checkerboardFloorMat : solidFloorMat);
    arenaFloor.rotation.x = -Math.PI / 2;
    arenaFloor.position.y = 0;
    arenaFloor.receiveShadow = true;
    Globals.scene.add(arenaFloor);
    
    Globals.particleManager = new ParticleManager();
    Globals.audioManager = new AudioManager();
    Globals.targetIndicator = new TargetIndicator();
    
    Globals.player = new PlayerCharacter();
    Globals.outlinePass.selectedObjects.push(Globals.player.mesh);
    Globals.player.mesh.scale.setScalar(CONFIG.playerScale);
    Globals.scene.add(Globals.player.mesh);
    Globals.scene.add(Globals.player.moveIndicator);
    updateCameraFollow();
    setupObstacles();
    
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
        mesh.castShadow = true;
        mesh.receiveShadow = true;
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

function createOrthographicCamera(aspect) {
    const targetWidth = ARENA_WIDTH * 1.05 * CONFIG.cameraViewScale; 
    const halfWidth = targetWidth * 0.5;
    const halfHeight = halfWidth / aspect;
    return new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 200);
}

function updateOrthographicFrustum() {
    const wrapper = document.getElementById('game-wrapper');
    const aspect = wrapper.clientWidth / wrapper.clientHeight;
    const targetWidth = ARENA_WIDTH * 1.05 * CONFIG.cameraViewScale; 
    const halfWidth = targetWidth * 0.5;
    const halfHeight = halfWidth / aspect;
    Globals.camera.left = -halfWidth;
    Globals.camera.right = halfWidth;
    Globals.camera.top = halfHeight;
    Globals.camera.bottom = -halfHeight;
    Globals.camera.updateProjectionMatrix();
}

function updateVisibleGroundBounds() {
    visibleGroundBounds.minX = -ARENA_WIDTH * 0.5;
    visibleGroundBounds.maxX = ARENA_WIDTH * 0.5;
    visibleGroundBounds.minZ = -ARENA_HEIGHT * 0.5;
    visibleGroundBounds.maxZ = ARENA_HEIGHT * 0.5;
    updateBoundaryVisual();
}

function updateCameraFollow() {
    if (!Globals.player) return;

    if (!CONFIG.cameraFollowEnabled) {
        Globals.baseCamTarget.set(0, 0, 0);
        Globals.baseCamPos.copy(Globals.cameraOffset);
        return;
    }

    const marginZ = 0.8 * CONFIG.playerScale;
    const playerMinZ = visibleGroundBounds.minZ + marginZ;
    const playerMaxZ = visibleGroundBounds.maxZ - marginZ;
    const maxPlayerOffset = Math.max(0, Math.min(Math.abs(playerMinZ), Math.abs(playerMaxZ)));
    const followLimit = Math.max(0, maxPlayerOffset - CONFIG.cameraVerticalDeadZone);
    const focusZ = THREE.MathUtils.clamp(Globals.player.mesh.position.z, -followLimit, followLimit);

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
        }
        arenaFloor.material = CONFIG.floorStyle === 'checkerboard' ? checkerboardFloorMat : solidFloorMat;
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
    updateOrthographicFrustum();
    updateBoundaryVisual();
    updateCameraFollow();
    setupObstacles();
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

function queueEnemySpawn() {
    const position = getSpawnPositionInView();
    Globals.spawnEffects.push(new SpawnTelegraphEffect(position, CONFIG.enemyScale));
    pendingEnemySpawns.push({ position, timeLeft: 3 });
}

function updatePendingEnemySpawns(delta) {
    for (let i = pendingEnemySpawns.length - 1; i >= 0; i--) {
        const pending = pendingEnemySpawns[i];
        pending.timeLeft -= delta;
        if (pending.timeLeft <= 0) {
            new Enemy(pending.position);
            Globals.spawnEffects.push(new SpawnBeamEffect(pending.position, CONFIG.enemyScale));
            pendingEnemySpawns.splice(i, 1);
        }
    }
}

function shootFeather() {
    const activeOnField = Globals.feathers.filter(f => f.phase !== 'recalling').length; 
    if (activeOnField >= MAX_FEATHERS) return;
    
    const target = getClosestEnemy(); 
    if (target) {
        const isSpecial = activeOnField === MAX_FEATHERS - 1; 
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
        launchPos.addScaledVector(rightDir, 0.35); // 偏移到右手侧
        Globals.launchEffects.push(new FeatherLaunchEffect(launchPos, facingDir, {
            life: isSpecial ? 0.18 : 0.14,
            count: isSpecial ? 5 : 3,
            color: isSpecial ? 0x91c53a : 0x91c53a,
            speed: isSpecial ? 24 : 19,
            lengthMin: isSpecial ? 2.2 : 1.6,
            lengthMax: isSpecial ? 3.4 : 2.4,
            thicknessMin: isSpecial ? 0.065 : 0.05,
            thicknessMax: isSpecial ? 0.11 : 0.075,
            sideSpawn: isSpecial ? 0.6 : 0.42,
            verticalSpawn: isSpecial ? 0.22 : 0.18,
            forwardOffset: 0.2,
            inheritedVelocity: currentVelocity.clone() // 传入玩家惯性
        }));

        const ringPos = ptPos.clone();
        ringPos.y += 1.0;
        ringPos.addScaledVector(facingDir, 0.4); // 靠后一点，让中心尖刺穿透感更强
        ringPos.addScaledVector(rightDir, 0.35); // 偏移到右手侧
        Globals.launchEffects.push(new WindRingEffect(ringPos, facingDir, {
            color: 0x91c53a,
            speed: isSpecial ? 35 : 22,
            radius: isSpecial ? 0.8 : 0.45,
            life: isSpecial ? 0.15 : 0.12,
            inheritedVelocity: currentVelocity.clone() // 传入玩家惯性
        }));
        
        Globals.feathers.push(new Feather(target, isSpecial, launchPos)); 
        Globals.player.playAttack(); 
        Globals.audioManager?.playShoot(isSpecial);
    }
}

function triggerRecallSequence() {
    const deployed = Globals.feathers.filter(f => f.phase !== 'recalling'); 
    if (deployed.length === 0) return;
    Globals.audioManager?.playRecallStart();
    
    let delay = 0; 
    deployed.forEach((feather, index) => {
        const timerId = setTimeout(() => { 
            if (Globals.feathers.includes(feather)) feather.startRecall(index); 
        }, delay); 
        recallTimers.push(timerId);
        delay += (feather.isSpecial) ? CONFIG.finalRecallDelay : CONFIG.recallInterval;
    });
}

function updatePlayerMovement(delta) {
    const inputVelocity = new THREE.Vector3(0, 0, 0); 
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

    if (hasInputIntent) {
        if (inputVelocity.lengthSq() > 0) {
            inputVelocity.normalize(); 
            Globals.player.lastMoveDirection = inputVelocity.clone();
        }
        
        const targetVelocityX = inputVelocity.x * CONFIG.maxMoveSpeedX;
        const targetVelocityZ = inputVelocity.z * CONFIG.maxMoveSpeedZ;
        
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
        currentVelocity.x = THREE.MathUtils.lerp(currentVelocity.x, 0, delta * CONFIG.moveFriction);
        currentVelocity.z = THREE.MathUtils.lerp(currentVelocity.z, 0, delta * CONFIG.moveFriction);
        
        if (currentVelocity.lengthSq() < 0.1) {
            currentVelocity.set(0, 0, 0);
            isMoving = false;
        } else {
            isMoving = true;
        }
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

        // AABB Collision with obstacles
        if (Globals.obstacles && Globals.obstacles.length > 0) {
            for (const obs of Globals.obstacles) {
                // Check X movement
                // Z logic: Check the collision volume matching player pos
                if (nextX + colMaxX > obs.minX && nextX + colMinX < obs.maxX &&
                    Globals.player.mesh.position.z + colMaxZ > obs.minZ && Globals.player.mesh.position.z + colMinZ < obs.maxZ) {
                    hitX = true;
                }
                // Check Z movement
                if (Globals.player.mesh.position.x + colMaxX > obs.minX && Globals.player.mesh.position.x + colMinX < obs.maxX &&
                    nextZ + colMaxZ > obs.minZ && nextZ + colMinZ < obs.maxZ) {
                    hitZ = true;
                }
            }
        }

        if (hitX) currentVelocity.x = 0;
        if (hitZ) currentVelocity.z = 0;

        Globals.player.mesh.position.addScaledVector(currentVelocity, delta);
    }

    const marginX = 0.6 * CONFIG.playerScale;
    const marginZ = 0.8 * CONFIG.playerScale;
    Globals.player.mesh.position.x = THREE.MathUtils.clamp(Globals.player.mesh.position.x, visibleGroundBounds.minX + marginX, visibleGroundBounds.maxX - marginX);
    Globals.player.mesh.position.z = THREE.MathUtils.clamp(Globals.player.mesh.position.z, visibleGroundBounds.minZ + marginZ, visibleGroundBounds.maxZ - marginZ);
    Globals.player.updateMoveIndicator(Globals.player.mesh.position, indicatorInputX, indicatorInputZ, delta);
    
    if (isMoving) { 
        if (!wasMoving) { 
            recallTimers.forEach(id => clearTimeout(id)); 
            recallTimers = []; 
            let interruptedRecall = false;
            for (let i = Globals.feathers.length - 1; i >= 0; i--) {
                const feather = Globals.feathers[i];
                if (feather.phase === 'recalling') {
                    interruptedRecall = true;
                    Globals.interruptEffects.push(new InterruptBurstEffect(feather.mesh.position.clone(), feather.isSpecial));
                }
                feather.destroy();
            }
            if (interruptedRecall) {
                Globals.audioManager?.playInterrupt();
                showFloatingText(Globals.player.mesh.position.clone(), '中断回收', 'text-interrupt');
            }
        }
        const now = Globals.clock.getElapsedTime(); 
        if (now - lastShootTime > CONFIG.shootCooldown) { 
            shootFeather(); 
            lastShootTime = now; 
        } 
    } else if (wasMoving && !isMoving) {
        triggerRecallSequence();
    }
}

let currentGlobalUpperAngle = null;

function updatePlayerFacing(delta, hasTargetLock, target) {
    let moveDirection = null;
    if (CONFIG.moveFacingMode === 'decoupled' && Globals.player.lastMoveDirection?.lengthSq() > 0.0001) {
        moveDirection = Globals.player.lastMoveDirection;
    } else if (CONFIG.moveFacingMode === 'faceMoveDirection' && isMoving && currentVelocity.lengthSq() > 0.1) {
        moveDirection = currentVelocity;
    }

    if (hasTargetLock && target) {
        const pPos = Globals.player.mesh.position;
        const tPos = target.mesh.position;
        
        // 1. Target Absolute Angle for Upper Body (Facing Enemy)
        const targetUpperAngle = Math.atan2(tPos.x - pPos.x, tPos.z - pPos.z);
        
        if (currentGlobalUpperAngle === null) {
            const euler = new THREE.Euler().setFromQuaternion(Globals.player.mesh.quaternion, 'YXZ');
            currentGlobalUpperAngle = euler.y;
        }

        // Smoothly interpolate the global upper body angle towards the enemy
        let diffUpper = targetUpperAngle - currentGlobalUpperAngle;
        while (diffUpper > Math.PI) diffUpper -= Math.PI * 2;
        while (diffUpper < -Math.PI) diffUpper += Math.PI * 2;
        currentGlobalUpperAngle += diffUpper * delta * CONFIG.turnSpeed;
        
        // Normalize
        while (currentGlobalUpperAngle > Math.PI) currentGlobalUpperAngle -= Math.PI * 2;
        while (currentGlobalUpperAngle < -Math.PI) currentGlobalUpperAngle += Math.PI * 2;

        // 2. Target Absolute Angle for Lower Body (Movement + Constraint)
        let targetLowerAngle = currentGlobalUpperAngle; // Default to facing enemy if not moving
        if (moveDirection) {
            targetLowerAngle = Math.atan2(moveDirection.x, moveDirection.z);
            
            // Constraint: Lower body cannot deviate more than 90 degrees from upper body
            let diffLower = targetLowerAngle - currentGlobalUpperAngle;
            while (diffLower > Math.PI) diffLower -= Math.PI * 2;
            while (diffLower < -Math.PI) diffLower += Math.PI * 2;
            
            const maxDeviation = Math.PI / 2; // 90 degrees constraint
            if (diffLower > maxDeviation) diffLower = maxDeviation;
            if (diffLower < -maxDeviation) diffLower = -maxDeviation;
            
            targetLowerAngle = currentGlobalUpperAngle + diffLower;
        }

        // 3. Apply Lower Body (Mesh) Rotation
        const currentLowerRot = Globals.player.mesh.quaternion.clone();
        const targetLowerQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetLowerAngle);
        Globals.player.mesh.quaternion.copy(currentLowerRot).slerp(targetLowerQuat, delta * CONFIG.turnSpeed);

        // 4. Apply Upper Body (bodyGroup) Local Twist Compensation
        const actualLowerEuler = new THREE.Euler().setFromQuaternion(Globals.player.mesh.quaternion, 'YXZ');
        let localTwist = currentGlobalUpperAngle - actualLowerEuler.y;
        while (localTwist > Math.PI) localTwist -= Math.PI * 2;
        while (localTwist < -Math.PI) localTwist += Math.PI * 2;
        
        Globals.player.bodyGroup.rotation.y = localTwist;

        // Update Target Indicator
        const targetPos = tPos.clone();
        targetPos.y = pPos.y;
        Globals.targetIndicator.update(targetPos, delta);
        
    } else {
        // No Target (Normal Mode)
        currentGlobalUpperAngle = null;
        
        if (moveDirection) {
            const targetPos = Globals.player.mesh.position.clone().add(moveDirection);
            const currentRot = Globals.player.mesh.quaternion.clone();
            Globals.player.mesh.lookAt(targetPos);
            const targetRot = Globals.player.mesh.quaternion.clone();
            Globals.player.mesh.quaternion.copy(currentRot).slerp(targetRot, delta * CONFIG.turnSpeed);
        }

        // Smoothly return upper body to neutral (0 twist)
        Globals.player.bodyGroup.rotation.y = THREE.MathUtils.lerp(Globals.player.bodyGroup.rotation.y, 0, delta * 15);
        
        Globals.targetIndicator.update(null, delta);
    }
}

function updatePlayerHUD() {
    const v = Globals.player.mesh.position.clone(); 
    v.y += 1.6; 
    v.project(Globals.camera);
    
    const w = document.getElementById('game-wrapper'); 
    const hud = document.getElementById('player-hud');
    hud.style.left = `${(v.x * .5 + .5) * w.clientWidth}px`; 
    hud.style.top = `${(v.y * -.5 + .5) * w.clientHeight}px`;
    
    const activeCountOnField = Globals.feathers.filter(f => f.phase !== 'recalling').length;
    const icons = hud.children;
    
    for (let i = 0; i < 4; i++) {
        const isUsed = i < activeCountOnField;
        icons[i].style.opacity = isUsed ? '0.15' : '1';
        icons[i].style.transform = isUsed ? 'scale(0.7)' : 'scale(1)';
    }
}

function animate() {
    const delta = Globals.clock.getDelta(), time = Globals.clock.getElapsedTime();
    const target = getClosestEnemy();
    const hasFeathers = Globals.feathers.length < MAX_FEATHERS || Globals.feathers.some(f => f.phase === 'recalling');

    updatePlayerMovement(delta);
    updatePlayerFacing(delta, isMoving && hasFeathers && !!target, target);
    updateCameraFollow();
    updateShake(delta);
    Globals.player.updateAnimation(delta, time, isMoving, currentVelocity);
    Globals.player.updateTrajectory(delta);
    Telemetry.update(currentVelocity.length(), Globals.player.mesh.position.x, Globals.player.mesh.position.y, Globals.player.mesh.position.z);
    updatePlayerHUD(); 
    updatePendingEnemySpawns(delta);
    updateFloatingTexts(delta);
    
    if(Globals.particleManager) Globals.particleManager.update(delta);
    
    for (let i = Globals.launchEffects.length - 1; i >= 0; i--) {
        if (!Globals.launchEffects[i].update(delta)) Globals.launchEffects.splice(i, 1);
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
    for (let i = Globals.feathers.length - 1; i >= 0; i--) {
        Globals.feathers[i].update(delta);
    }
    
    // Update OutlinePass selection
    if (Globals.outlinePass) {
        const selection = [];
        if (Globals.player && Globals.player.mesh) selection.push(Globals.player.mesh);
        if (obstacleGroup) selection.push(...obstacleGroup.children);
        for (const e of Globals.enemies) if (e.mesh) selection.push(e.mesh);
        for (const f of Globals.feathers) if (f.mesh) selection.push(f.mesh);
        Globals.outlinePass.selectedObjects = selection;
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
    updateOrthographicFrustum();
    Globals.renderer.setSize(w.clientWidth, w.clientHeight); 
    if (Globals.composer) Globals.composer.setSize(w.clientWidth, w.clientHeight);
    if (Globals.finalComposer) Globals.finalComposer.setSize(w.clientWidth, w.clientHeight);
    updateVisibleGroundBounds();
    refreshInputLayout();
}

// 启动入口
init();
