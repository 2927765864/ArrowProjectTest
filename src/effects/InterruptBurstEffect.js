import * as THREE from 'three';
import { Globals } from '../utils.js';

// ===== 共享几何（two flavors: special / normal）=====
// 之前每次触发都 new 4×PlaneGeometry + 1×CircleGeometry —— 大量分配 + 大量小 BufferGeometry 上传。
// 改为模块级缓存：每种 flavor 5 个共享几何。
function _makeStreakGeos(lengths, thickness) {
    return lengths.map(l => new THREE.PlaneGeometry(l, thickness));
}
function _makeStreakCoreGeos(lengths, thickness) {
    return lengths.map(l => new THREE.PlaneGeometry(l * 0.72, thickness * 0.42));
}

const _SPECIAL_STREAK_LENS = [2.2, 1.8, 1.45, 1.2];
const _NORMAL_STREAK_LENS  = [1.7, 1.4, 1.15, 0.92];

const _SHARED_GEOS = {
    special: {
        glow: _makeStreakGeos(_SPECIAL_STREAK_LENS, 0.2),
        core: _makeStreakCoreGeos(_SPECIAL_STREAK_LENS, 0.2),
        flare: new THREE.CircleGeometry(0.28, 20),
    },
    normal: {
        glow: _makeStreakGeos(_NORMAL_STREAK_LENS, 0.15),
        core: _makeStreakCoreGeos(_NORMAL_STREAK_LENS, 0.15),
        flare: new THREE.CircleGeometry(0.22, 20),
    },
};

export class InterruptBurstEffect {
    constructor(position, isSpecial = false) {
        this.life = 0.28;
        this.maxLife = 0.28;
        this.group = new THREE.Group();
        this.group.position.copy(position);
        this.group.position.y = 0.12;
        this.group.rotation.x = -Math.PI / 2;

        const flavor = isSpecial ? _SHARED_GEOS.special : _SHARED_GEOS.normal;
        const streakLengths = isSpecial ? _SPECIAL_STREAK_LENS : _NORMAL_STREAK_LENS;

        // 材质保持 per-instance：opacity 每实例独立衰减，不能共享
        this.streaks = [];
        for (let i = 0; i < 4; i++) {
            const angle = (Math.PI / 4) * i;
            const glowMat = new THREE.MeshBasicMaterial({
                color: 0x91c53a, transparent: true, opacity: 1,
                blending: THREE.AdditiveBlending, depthWrite: false,
                side: THREE.DoubleSide, toneMapped: false
            });
            const coreMat = new THREE.MeshBasicMaterial({
                color: 0x91c53a, transparent: true, opacity: 1,
                blending: THREE.AdditiveBlending, depthWrite: false,
                side: THREE.DoubleSide, toneMapped: false
            });
            const glow = new THREE.Mesh(flavor.glow[i], glowMat);
            const core = new THREE.Mesh(flavor.core[i], coreMat);
            glow.rotation.z = angle;
            core.rotation.z = angle;
            glow.layers.enable(1);
            core.layers.enable(1);
            this.group.add(glow);
            this.group.add(core);
            this.streaks.push({ glow, core, baseLength: streakLengths[i] });
        }

        const flareMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a, transparent: true, opacity: 1,
            blending: THREE.AdditiveBlending, depthWrite: false,
            side: THREE.DoubleSide, toneMapped: false
        });
        const flare = new THREE.Mesh(flavor.flare, flareMat);
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
            // 几何共享，只 dispose 材质
            this.group.traverse((child) => {
                if (child.material) child.material.dispose();
            });
            return false;
        }

        return true;
    }
}
