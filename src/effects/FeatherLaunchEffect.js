import * as THREE from 'three';
import { Globals } from '../utils.js';

const STREAK_GEOMETRY = new THREE.BoxGeometry(0.06, 1, 0.06);

export class FeatherLaunchEffect {
    constructor(originPos, direction, options = {}) {
        this.life = options.life ?? 0.14;
        this.maxLife = this.life;
        this.group = new THREE.Group();
        this.lines = [];

        const basis = this.createBasis(direction);
        const count = options.count ?? 4;
        const color = options.color ?? 0xe7fbff;
        const speed = options.speed ?? 18;
        const lengthMin = options.lengthMin ?? 1.4;
        const lengthMax = options.lengthMax ?? 2.2;
        const thicknessMin = options.thicknessMin ?? 0.045;
        const thicknessMax = options.thicknessMax ?? 0.075;
        const sideSpawn = options.sideSpawn ?? 0.22;
        const verticalSpawn = options.verticalSpawn ?? 0.18;
        const forwardOffset = options.forwardOffset ?? 0.1;

        for (let i = 0; i < count; i++) {
            const material = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 1,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            });

            const mesh = new THREE.Mesh(STREAK_GEOMETRY, material);
            mesh.position.copy(originPos)
                .addScaledVector(basis.forward, forwardOffset * Math.random())
                .addScaledVector(basis.right, (Math.random() - 0.5) * sideSpawn)
                .addScaledVector(basis.up, (Math.random() - 0.5) * verticalSpawn);

            const streakLength = lengthMin + Math.random() * (lengthMax - lengthMin);
            const streakThickness = thicknessMin + Math.random() * (thicknessMax - thicknessMin);
            mesh.scale.set(streakThickness, 0.01, streakThickness);
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), basis.forward);
            mesh.layers.enable(1);

            this.group.add(mesh);
            this.lines.push({
                mesh,
                direction: basis.forward.clone(),
                speed: speed * (0.9 + Math.random() * 0.2),
                baseLength: streakLength,
                baseThickness: streakThickness
            });
        }

        Globals.scene.add(this.group);
    }

    createBasis(direction) {
        const forward = direction.clone().normalize();
        const helperUp = Math.abs(forward.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(forward, helperUp).normalize();
        const up = new THREE.Vector3().crossVectors(right, forward).normalize();
        return { forward, right, up };
    }

    update(delta) {
        this.life -= delta;
        const alpha = Math.max(this.life / this.maxLife, 0);
        const progress = 1 - alpha;

        for (const line of this.lines) {
            line.mesh.position.addScaledVector(line.direction, line.speed * delta);

            let lengthFactor;
            if (progress < 0.28) {
                lengthFactor = progress / 0.28;
            } else if (progress < 0.72) {
                lengthFactor = 1;
            } else {
                lengthFactor = 1 - (progress - 0.72) / 0.28;
            }

            const opacity = progress < 0.18
                ? progress / 0.18
                : progress > 0.78
                    ? Math.max(0, 1 - (progress - 0.78) / 0.22)
                    : 1;

            line.mesh.scale.set(
                line.baseThickness,
                Math.max(0.01, line.baseLength * lengthFactor),
                line.baseThickness
            );
            line.mesh.material.opacity = opacity;
        }

        if (this.life <= 0) {
            Globals.scene.remove(this.group);
            for (const line of this.lines) {
                line.mesh.material.dispose();
            }
            return false;
        }

        return true;
    }
}
