import * as THREE from 'three';
import { Globals } from '../utils.js';

export class TargetIndicator {
    constructor() {
        this.group = new THREE.Group();
        this.group.visible = false;
        
        const baseRadius = 0.85;

        // Pale black background circle
        const baseGeo = new THREE.CircleGeometry(baseRadius * 0.95, 32);
        const baseMat = new THREE.MeshBasicMaterial({
            color: 0x5e55a2,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            toneMapped: false
        });
        this.baseMesh = new THREE.Mesh(baseGeo, baseMat);
        this.baseMesh.rotation.x = -Math.PI / 2;
        this.baseMesh.position.y = 0.02;
        this.group.add(this.baseMesh);

        // Segmented red dashed ring
        this.ringGroup = new THREE.Group();
        this.group.add(this.ringGroup);

        const segmentCount = 6;
        const thickness = 0.06;
        const dashArc = (Math.PI * 2 * baseRadius / segmentCount) * 0.45;
        const dashGeo = new THREE.BoxGeometry(dashArc, thickness, thickness);
        const dashMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });

        for (let i = 0; i < segmentCount; i++) {
            const dash = new THREE.Mesh(dashGeo, dashMat);
            dash.layers.enable(1); // Bloom glow
            
            const angle = (i / segmentCount) * Math.PI * 2;
            dash.position.set(Math.cos(angle) * baseRadius, 0.03, Math.sin(angle) * baseRadius);
            
            const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
            dash.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
            
            this.ringGroup.add(dash);
        }

        Globals.scene.add(this.group);
    }

    update(targetPos, delta) {
        if (!targetPos) {
            this.group.visible = false;
            return;
        }

        this.group.visible = true;
        this.group.position.x = targetPos.x;
        this.group.position.z = targetPos.z;
        
        this.ringGroup.rotation.y += delta * 2.5;
        
        // Slight breathing scale
        const scale = 1.0 + Math.sin(Globals.clock.getElapsedTime() * 5) * 0.05;
        this.group.scale.set(scale, 1, scale);
    }
}