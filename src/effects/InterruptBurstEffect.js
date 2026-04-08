import * as THREE from 'three';
import { Globals } from '../utils.js';

export class InterruptBurstEffect {
    constructor(position, isSpecial = false) {
        this.life = 0.28;
        this.maxLife = 0.28;
        this.group = new THREE.Group();
        this.group.position.copy(position);
        this.group.position.y = 0.12;
        this.group.rotation.x = -Math.PI / 2;

        const glowMat = new THREE.MeshBasicMaterial({
            color: isSpecial ? 0xffcf7a : 0x9cecff,
            transparent: true,
            opacity: 1,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        const coreMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });

        this.streaks = [];
        const streakLengths = isSpecial ? [2.2, 1.8, 1.45, 1.2] : [1.7, 1.4, 1.15, 0.92];
        const streakThickness = isSpecial ? 0.2 : 0.15;
        for (let i = 0; i < 4; i++) {
            const angle = (Math.PI / 4) * i;
            const glow = new THREE.Mesh(new THREE.PlaneGeometry(streakLengths[i], streakThickness), glowMat.clone());
            const core = new THREE.Mesh(new THREE.PlaneGeometry(streakLengths[i] * 0.72, streakThickness * 0.42), coreMat.clone());
            glow.rotation.z = angle;
            core.rotation.z = angle;
            glow.layers.enable(1);
            core.layers.enable(1);
            this.group.add(glow);
            this.group.add(core);
            this.streaks.push({ glow, core, baseLength: streakLengths[i] });
        }

        const flare = new THREE.Mesh(new THREE.CircleGeometry(isSpecial ? 0.28 : 0.22, 20), coreMat.clone());
        flare.layers.enable(1);
        this.group.add(flare);
        this.flare = flare;
        Globals.scene.add(this.group);
    }

    update(delta) {
        this.life -= delta;
        const alpha = Math.max(this.life / this.maxLife, 0);
        const progress = 1 - alpha;
        const burst = progress < 0.3 ? progress / 0.3 : 1 - (progress - 0.3) / 0.7;

        for (const streak of this.streaks) {
            const scale = Math.max(0.2, burst * (1.4 + progress * 0.25));
            streak.glow.scale.x = scale;
            streak.core.scale.x = scale * 0.88;
            streak.glow.material.opacity = alpha;
            streak.core.material.opacity = alpha;
        }

        this.flare.scale.setScalar(0.7 + burst * 1.25);
        this.flare.material.opacity = alpha;

        if (this.life <= 0) {
            Globals.scene.remove(this.group);
            this.group.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            return false;
        }

        return true;
    }
}
