import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AudioManager } from './audio/AudioManager.js';
import { CONFIG } from './config.js';
import { Globals, updateShake, triggerShake, getClosestEnemy, showFloatingText } from './utils.js';
import { keys, joystick, initInput, refreshInputLayout } from './Input.js';
import { InterruptBurstEffect } from './effects/InterruptBurstEffect.js';
import { TargetIndicator } from './effects/TargetIndicator.js';
import { ParticleManager } from './effects/ParticleManager.js';
import { SpawnSmokeEffect, SpawnTelegraphEffect } from './effects/EnemySpawnEffects.js';
import { FeatherLaunchEffect } from './effects/FeatherLaunchEffect.js';
import { PlayerCharacter } from './entities/Player.js';
import { Enemy } from './entities/Enemy.js';
import { Feather } from './entities/Feather.js';
import { setupControlPanel } from './ui/ControlPanel.js';
import { SpeedChart } from './ui/SpeedChart.js';

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
    return new THREE.WebGLRenderer({ antialias: true });
}

const BLOOM_SCENE = 1;
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_SCENE);

const darkMaterial = new THREE.MeshBasicMaterial({ color: 'black' });
const materials = {};

function darkenNonBloomed(obj) {
    if (obj.isMesh && bloomLayer.test(obj.layers) === false) {
        materials[obj.uuid] = obj.material;
        obj.material = darkMaterial;
    }
}

function restoreMaterial(obj) {
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

    Globals.composer = new EffectComposer(Globals.renderer);
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

    Globals.finalComposer = new EffectComposer(Globals.renderer);
    Globals.finalComposer.addPass(renderPass);
    Globals.finalComposer.addPass(mixPass);
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
    const backdropMat = new THREE.MeshStandardMaterial({ color: 0x1a1532, roughness: 1, metalness: 0.02, depthWrite: false });
    const backdropPlane = new THREE.Mesh(backdropGeo, backdropMat);
    backdropPlane.rotation.x = -Math.PI / 2;
    backdropPlane.position.y = -0.02;
    Globals.scene.add(backdropPlane);

    solidFloorMat = new THREE.MeshStandardMaterial({ color: 0x2d2952, roughness: 0.95, metalness: 0.02 });
    
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
    
    checkerboardFloorMat = new THREE.MeshStandardMaterial({ map: checkerTexture, roughness: 0.8, metalness: 0.1 });

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
    Globals.player.mesh.scale.setScalar(CONFIG.playerScale);
    Globals.scene.add(Globals.player.mesh);
    Globals.scene.add(Globals.player.moveIndicator);
    updateCameraFollow();
    setupObstacles();
    
    initInput(wrapper);
    setupControlPanel();
    SpeedChart.init();
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
            if (child.material) child.material.dispose();
        });
        obstacleGroup = null;
    }
    Globals.obstacles = [];
    if (CONFIG.sceneMode !== 'obstacles') return;

    obstacleGroup = new THREE.Group();
    Globals.scene.add(obstacleGroup);

    const boxMat = new THREE.MeshStandardMaterial({ color: 0x5e55a2, roughness: 0.7, metalness: 0.1 });
    const createBox = (x, z, w, d) => {
        const h = 2.0; // Box height
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), boxMat);
        mesh.position.set(x, h / 2, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
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
    createBox(0, 0, 8, 2);
    createBox(-8, 6, 2, 6);
    createBox(8, 6, 2, 6);
    createBox(0, 10, 2, 4);
}

export function clearSceneEntities() {
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
            Globals.spawnEffects.push(new SpawnSmokeEffect(pending.position, CONFIG.enemyScale));
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
        
        const launchPos = ptPos.clone();
        launchPos.y += 1.0;
        launchPos.addScaledVector(facingDir, 0.55);
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
            forwardOffset: 0.2
        }));

        const rearBurstPos = ptPos.clone();
        rearBurstPos.y += 0.9;
        rearBurstPos.addScaledVector(backDir, 0.45);
        Globals.particleManager.spawnBurst(
            rearBurstPos,
            backDir,
            isSpecial ? 16 : 11,
            isSpecial ? 0x91c53a : 0x91c53a,
            true,
            isSpecial ? 1.25 : 0.95,
            isSpecial ? [7, 14] : [6, 11]
        );
        
        Globals.feathers.push(new Feather(target, isSpecial)); 
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
    if (inputVelocity.lengthSq() > 0) {
        inputVelocity.normalize(); 
        Globals.player.lastMoveDirection = inputVelocity.clone();
        
        currentVelocity.x = THREE.MathUtils.lerp(currentVelocity.x, inputVelocity.x * CONFIG.maxMoveSpeed, delta * CONFIG.moveAcceleration);
        currentVelocity.z = THREE.MathUtils.lerp(currentVelocity.z, inputVelocity.z * CONFIG.maxMoveSpeed, delta * CONFIG.moveAcceleration);
        
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
        
        // Use a much smaller radius that represents the character's physical torso/head (roughly 0.22)
        // rather than the visual blue dashed indicator ring on the ground (which is 0.45).
        const playerRadius = 0.2 * CONFIG.playerScale; 
        
        let hitX = false;
        let hitZ = false;

        // AABB Collision with obstacles
        if (Globals.obstacles && Globals.obstacles.length > 0) {
            for (const obs of Globals.obstacles) {
                // Check X movement
                if (nextX + playerRadius > obs.minX && nextX - playerRadius < obs.maxX &&
                    Globals.player.mesh.position.z + playerRadius > obs.minZ && Globals.player.mesh.position.z - playerRadius < obs.maxZ) {
                    hitX = true;
                }
                // Check Z movement
                if (Globals.player.mesh.position.x + playerRadius > obs.minX && Globals.player.mesh.position.x - playerRadius < obs.maxX &&
                    nextZ + playerRadius > obs.minZ && nextZ - playerRadius < obs.maxZ) {
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

function updatePlayerFacing(delta, hasTargetLock, target) {
    if (hasTargetLock && target) {
        const targetPos = target.mesh.position.clone();
        targetPos.y = Globals.player.mesh.position.y;
        const currentRot = Globals.player.mesh.quaternion.clone();
        Globals.player.mesh.lookAt(targetPos);
        const targetRot = Globals.player.mesh.quaternion.clone();
        Globals.player.mesh.quaternion.copy(currentRot).slerp(targetRot, delta * CONFIG.turnSpeed);
        Globals.targetIndicator.update(targetPos, delta);
        return;
    }

    let facingDirection = null;
    if (CONFIG.moveFacingMode === 'decoupled' && Globals.player.lastMoveDirection?.lengthSq() > 0.0001) {
        facingDirection = Globals.player.lastMoveDirection;
    } else if (CONFIG.moveFacingMode === 'faceMoveDirection' && isMoving && currentVelocity.lengthSq() > 0.1) {
        facingDirection = currentVelocity;
    }

    if (facingDirection) {
        const targetPos = Globals.player.mesh.position.clone().add(facingDirection);
        const currentRot = Globals.player.mesh.quaternion.clone();
        Globals.player.mesh.lookAt(targetPos);
        const targetRot = Globals.player.mesh.quaternion.clone();
        Globals.player.mesh.quaternion.copy(currentRot).slerp(targetRot, delta * CONFIG.turnSpeed);
    }

    Globals.targetIndicator.update(null, delta);
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
    updatePlayerFacing(delta, hasFeathers && !!target, target);
    updateCameraFollow();
    updateShake(delta);
    Globals.player.updateAnimation(delta, time, isMoving, currentVelocity);
    SpeedChart.update(currentVelocity.length());
    updatePlayerHUD(); 
    updatePendingEnemySpawns(delta);
    
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
