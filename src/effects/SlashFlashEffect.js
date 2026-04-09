import * as THREE from 'three';
import { Globals } from '../utils.js';

function createSlashShape(length, width) {
    const mid = length * 0.5;
    const halfWidth = width * 0.5;
    const shape = new THREE.Shape();

    shape.moveTo(0, 0);
    shape.quadraticCurveTo(length * 0.18, halfWidth, mid, halfWidth * 1.15);
    shape.quadraticCurveTo(length * 0.82, halfWidth, length, 0);
    shape.quadraticCurveTo(length * 0.82, -halfWidth, mid, -halfWidth * 1.15);
    shape.quadraticCurveTo(length * 0.18, -halfWidth, 0, 0);

    return new THREE.ShapeGeometry(shape, 24);
}

export class SlashFlashEffect {
    constructor(position, direction, scale = 1) {
        this.life = 0.18;
        this.maxLife = 0.18;
        this.group = new THREE.Group();
        this.length = 3.1 * scale;

        const flatDir = direction.clone();
        flatDir.y = 0;
        if (flatDir.lengthSq() < 0.0001) flatDir.set(1, 0, 0);
        flatDir.normalize();

        const glowGeometry = createSlashShape(this.length, 0.34 * scale);
        const coreGeometry = createSlashShape(this.length * 0.96, 0.12 * scale);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: 0.82,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        const coreMaterial = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: 1,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });

        this.glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        this.coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
        this.glowMesh.rotation.x = -Math.PI / 2;
        this.coreMesh.rotation.x = -Math.PI / 2;
        this.glowMesh.layers.enable(1);
        this.coreMesh.layers.enable(1);
        this.group.add(this.glowMesh);
        this.group.add(this.coreMesh);

        this.group.position.copy(position);
        this.group.position.y += 0.55 * scale;
        this.group.position.addScaledVector(flatDir, -this.length * 0.5);
        this.group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), flatDir);

        this.glowMesh.scale.set(0.01, 1, 1);
        this.coreMesh.scale.set(0.01, 1, 1);

        Globals.scene.add(this.group);
    }

    update(delta) {
        this.life -= delta;
        const alpha = Math.max(this.life / this.maxLife, 0);
        const progress = 1 - alpha;

        const reveal = progress < 0.28 ? progress / 0.28 : 1;
        const fade = progress < 0.55 ? 1 : Math.max(0, 1 - (progress - 0.55) / 0.45);
        const widthTaper = progress < 0.2 ? 0.7 + progress * 1.5 : Math.max(0.72, 1 - (progress - 0.2) * 0.25);

        this.glowMesh.scale.x = Math.max(0.01, reveal);
        this.coreMesh.scale.x = Math.max(0.01, reveal * 0.98);
        this.glowMesh.scale.y = widthTaper;
        this.coreMesh.scale.y = widthTaper * 0.82;
        this.glowMesh.material.opacity = fade * 0.82;
        this.coreMesh.material.opacity = fade;

        if (this.life <= 0) {
            Globals.scene.remove(this.group);
            this.glowMesh.geometry.dispose();
            this.coreMesh.geometry.dispose();
            this.glowMesh.material.dispose();
            this.coreMesh.material.dispose();
            return false;
        }

        return true;
    }
}
