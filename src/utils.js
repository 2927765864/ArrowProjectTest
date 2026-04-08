import * as THREE from 'three';

// 全局变量容器
export const Globals = {
    scene: null,
    camera: null,
    renderer: null,
    composer: null,
    finalComposer: null,
    bloomPass: null,
    audioManager: null,
    player: null,
    enemies: [],
    feathers: [],
    bloodStains: [],
    launchEffects: [],
    slashEffects: [],
    spawnEffects: [],
    interruptEffects: [],
    obstacles: [],
    targetIndicator: null,
    particleManager: null,
    uiLayer: null,
    cameraOffset: new THREE.Vector3(0, 30, 20),
    baseCamPos: new THREE.Vector3(0, 30, 20),
    baseCamTarget: new THREE.Vector3(0, 0, 0),
    clock: new THREE.Clock()
};

export const SVG = {
    shield: `<svg class="dmg-icon" viewBox="0 0 12 14"><path d="M6 0 L0 2 L0 6 C0 10 5 13 6 14 C7 13 12 10 12 6 L12 2 Z"/></svg>`,
    explode: `<svg class="dmg-icon" viewBox="0 0 16 16"><path d="M8 0 L10.5 5.5 L16 3 L12.5 8 L16 13 L10.5 10.5 L8 16 L5.5 10.5 L0 13 L3.5 8 L0 3 L5.5 5.5 Z"/></svg>`
};

let shakeTimeLeft = 0;
let currentShakeIntensity = 0;

export function triggerShake(intensity, duration) {
    currentShakeIntensity = intensity;
    shakeTimeLeft = duration;
}

export function updateShake(delta) {
    if (!Globals.camera) return;

    if (shakeTimeLeft > 0) {
        shakeTimeLeft -= delta;
        Globals.camera.position.set(
            Globals.baseCamPos.x + (Math.random() - 0.5) * currentShakeIntensity,
            Globals.baseCamPos.y + (Math.random() - 0.5) * currentShakeIntensity,
            Globals.baseCamPos.z + (Math.random() - 0.5) * currentShakeIntensity
        );
    } else {
        Globals.camera.position.copy(Globals.baseCamPos);
    }

    Globals.camera.lookAt(Globals.baseCamTarget);
}

export function showFloatingText(position, text, cssClass) {
    if (!Globals.uiLayer || !Globals.camera) return;
    const v = position.clone(); 
    v.y += 2.0; 
    v.x += (Math.random() - 0.5) * 2.5; 
    v.z += (Math.random() - 0.5) * 2.5; 
    v.project(Globals.camera);
    
    const w = document.getElementById('game-wrapper'); 
    if (!w) return;

    const div = document.createElement('div'); 
    div.className = `floating-text ${cssClass}`; 
    div.innerHTML = text;
    div.style.left = `${(v.x * .5 + .5) * w.clientWidth}px`; 
    div.style.top = `${(v.y * -.5 + .5) * w.clientHeight}px`; 
    Globals.uiLayer.appendChild(div);
    
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 950);
}

export function getClosestEnemy() {
    let closest = null, minDist = Infinity;
    Globals.enemies.forEach(e => { 
        if (e.isDead) return; 
        const d = Globals.player.mesh.position.distanceTo(e.mesh.position); 
        if (d < minDist) { minDist = d; closest = e; } 
    });
    return closest;
}
