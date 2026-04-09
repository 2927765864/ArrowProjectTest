import * as THREE from 'three';
import { Globals } from '../utils.js';

function createStarShape(radiusOuter, radiusInner) {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + i * (Math.PI / 5);
        const radius = i % 2 === 0 ? radiusOuter : radiusInner;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
}

export class SpawnTelegraphEffect {
    constructor(position, scale = 1) {
        this.life = 3;
        this.maxLife = 3;
        this.group = new THREE.Group();
        this.group.position.copy(position);
        this.group.position.y = 0.06;

        const ringScale = scale * 0.24;

        const haloGeo = new THREE.CircleGeometry(1.16 * ringScale, 48);
        const haloMat = new THREE.MeshBasicMaterial({
            color: 0x5e55a2,
            transparent: true,
            opacity: 0.32,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        this.halo = new THREE.Mesh(haloGeo, haloMat);
        this.halo.rotation.x = -Math.PI / 2;

        const outerRingGeo = new THREE.RingGeometry(0.9 * ringScale, 1.08 * ringScale, 48);
        const outerRingMat = new THREE.MeshBasicMaterial({
            color: 0x5e55a2,
            transparent: true,
            opacity: 0.92,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        this.outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
        this.outerRing.rotation.x = -Math.PI / 2;

        const innerRingGeo = new THREE.RingGeometry(0.52 * ringScale, 0.62 * ringScale, 40);
        const innerRingMat = outerRingMat.clone();
        innerRingMat.color.setHex(0x5e55a2);
        innerRingMat.opacity = 0.82;
        this.innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
        this.innerRing.rotation.x = -Math.PI / 2;

        const starGeo = new THREE.ShapeGeometry(createStarShape(0.6 * ringScale, 0.24 * ringScale));
        const starMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        this.star = new THREE.Mesh(starGeo, starMat);
        this.star.rotation.x = -Math.PI / 2;

        this.halo.layers.enable(1);
        this.outerRing.layers.enable(1);
        this.innerRing.layers.enable(1);
        this.star.layers.enable(1);

        this.group.add(this.halo);
        this.group.add(this.outerRing);
        this.group.add(this.innerRing);
        this.group.add(this.star);
        Globals.scene.add(this.group);

        Globals.audioManager?.playTelegraph();
    }

    update(delta) {
        this.life -= delta;
        const alpha = Math.max(this.life / this.maxLife, 0);
        const pulse = 0.92 + Math.sin((1 - alpha) * Math.PI * 8) * 0.12;

        this.group.rotation.y += delta * 0.55;
        this.halo.material.opacity = (0.16 + (1 - alpha) * 0.2) * pulse;
        this.outerRing.material.opacity = (0.58 + (1 - alpha) * 0.26) * pulse;
        this.innerRing.material.opacity = (0.44 + (1 - alpha) * 0.22) * pulse;
        this.star.material.opacity = (0.68 + (1 - alpha) * 0.22) * pulse;

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

export class SpawnSmokeEffect {
    constructor(position, scale = 1, options = {}) {
        this.life = options.life ?? 0.75;
        this.maxLife = this.life;
        this.group = new THREE.Group();
        this.puffs = [];
        this.group.position.copy(position);
        this.group.position.y = options.height ?? 0.2;

        const puffCount = options.puffCount ?? 12;
        const color = options.color ?? 0x050505;
        const opacity = options.opacity ?? 0.85;
        const spread = options.spread ?? 0.9;
        const rise = options.rise ?? [1.5, 2.7];
        const drift = options.drift ?? 1.5;
        const size = options.size ?? [0.2, 0.38];
        const growth = options.growth ?? [1.0, 1.6];
        for (let i = 0; i < puffCount; i++) {
            const geo = new THREE.IcosahedronGeometry((size[0] + Math.random() * (size[1] - size[0])) * scale, 0);
            const mat = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set((Math.random() - 0.5) * spread * scale, Math.random() * 0.3 * scale, (Math.random() - 0.5) * spread * scale);
            mesh.layers.enable(1);
            this.group.add(mesh);
            this.puffs.push({
                mesh,
                velocity: new THREE.Vector3((Math.random() - 0.5) * drift, rise[0] + Math.random() * (rise[1] - rise[0]), (Math.random() - 0.5) * drift),
                growth: growth[0] + Math.random() * (growth[1] - growth[0])
            });
        }

        Globals.scene.add(this.group);
        Globals.audioManager?.playSpawn();
    }

    update(delta) {
        this.life -= delta;
        const alpha = Math.max(this.life / this.maxLife, 0);
        for (const puff of this.puffs) {
            puff.mesh.position.addScaledVector(puff.velocity, delta);
            puff.mesh.scale.setScalar(1 + (1 - alpha) * puff.growth);
            puff.mesh.material.opacity = alpha * 0.85;
        }

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
