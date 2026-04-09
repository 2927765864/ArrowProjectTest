import * as THREE from 'three';

// 全局变量容器
export const Globals = {
    scene: null,
    camera: null,
    renderer: null,
    composer: null,
    finalComposer: null,
    outlinePass: null,
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
    floatingTexts: [],
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
    const worldPos = position.clone(); 
    worldPos.y += 2.0; 
    worldPos.x += (Math.random() - 0.5) * 2.5; 
    worldPos.z += (Math.random() - 0.5) * 2.5; 
    
    const w = document.getElementById('game-wrapper'); 
    if (!w) return;

    const div = document.createElement('div'); 
    div.className = `floating-text ${cssClass}`; 
    div.innerHTML = text;
    Globals.uiLayer.appendChild(div);
    
    // Set initial position immediately to prevent a 1-frame jump
    const v = worldPos.clone();
    v.project(Globals.camera);
    div.style.left = `${(v.x * 0.5 + 0.5) * w.clientWidth}px`;
    div.style.top = `${(v.y * -0.5 + 0.5) * w.clientHeight}px`;
    
    Globals.floatingTexts.push({
        worldPos: worldPos,
        element: div,
        life: 0.95
    });
}

export function updateFloatingTexts(delta) {
    if (!Globals.camera) return;
    const w = document.getElementById('game-wrapper');
    if (!w) return;
    
    for (let i = Globals.floatingTexts.length - 1; i >= 0; i--) {
        const txt = Globals.floatingTexts[i];
        txt.life -= delta;
        
        if (txt.life <= 0) {
            if (txt.element.parentNode) txt.element.parentNode.removeChild(txt.element);
            Globals.floatingTexts.splice(i, 1);
            continue;
        }
        
        // Project world position to screen continuously
        const v = txt.worldPos.clone();
        v.project(Globals.camera);
        
        // Hide if behind camera
        if (v.z > 1.0) {
            txt.element.style.display = 'none';
        } else {
            txt.element.style.display = '';
            txt.element.style.left = `${(v.x * 0.5 + 0.5) * w.clientWidth}px`;
            txt.element.style.top = `${(v.y * -0.5 + 0.5) * w.clientHeight}px`;
        }
    }
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
