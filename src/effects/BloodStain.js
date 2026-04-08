import * as THREE from 'three';
import { Globals } from '../utils.js';
import { CONFIG } from '../config.js';

function createOrganicShape(radius, irregularity = 0.35, segments = 20) {
    const shape = new THREE.Shape();
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const wave = 1 + Math.sin(angle * 3 + Math.random() * 0.4) * 0.1;
        const r = radius * wave * (1 - irregularity + Math.random() * irregularity * 2);
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
}

export class BloodStain {
    constructor(position) {
        this.group = new THREE.Group(); 
        this.group.position.copy(position); 
        this.group.position.y = 0.01 + Math.random() * 0.05;
        
        const baseColor = 0x3d000a;
        const mat = new THREE.MeshStandardMaterial({ 
            color: baseColor, transparent: true, opacity: 0.8, 
            depthWrite: false, roughness: 1, metalness: 0 
        });
        
        const shape = new THREE.Shape(); 
        const segments = 12; 
        const radius = 1.0 + Math.random() * 1.5;
        
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2; 
            const r = radius * (0.8 + Math.random() * 0.4);
            const x = Math.cos(angle) * r; 
            const y = Math.sin(angle) * r;
            if (i === 0) shape.moveTo(x, y); 
            else shape.lineTo(x, y);
        }
        shape.closePath(); 
        
        const mainGeo = new THREE.ShapeGeometry(shape); 
        const mainPool = new THREE.Mesh(mainGeo, mat);
        mainPool.rotation.x = -Math.PI / 2; 
        this.group.add(mainPool);
        
        const splatterCount = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < splatterCount; i++) {
            const sRadius = 0.1 + Math.random() * 0.3; 
            const sGeo = new THREE.CircleGeometry(sRadius, 6); 
            const sMesh = new THREE.Mesh(sGeo, mat);
            const angle = Math.random() * Math.PI * 2; 
            const dist = radius * (1.2 + Math.random() * 0.8);
            sMesh.position.set(Math.cos(angle) * dist, 0.001, Math.sin(angle) * dist); 
            sMesh.rotation.x = -Math.PI / 2; 
            this.group.add(sMesh);
        }
        
        Globals.scene.add(this.group); 
        this.life = CONFIG.bloodLinger;
    }
    
    update(delta) {
        this.life -= delta; 
        const alpha = Math.min(1.0, this.life / 1.0);
        this.group.traverse(child => { 
            if (child.material) child.material.opacity = alpha * 0.8; 
        });
        return this.life > 0;
    }
    
    destroy() { 
        this.group.traverse(child => { 
            if (child.geometry) child.geometry.dispose(); 
            if (child.material) child.material.dispose(); 
        }); 
        Globals.scene.remove(this.group); 
    }
}
