import * as THREE from 'three';
import { Globals } from '../utils.js';

export class ParticleManager {
    constructor() { 
        this.particles = []; 
        this.geo = new THREE.BoxGeometry(0.12, 0.12, 0.12); 
        this.dustGeo = new THREE.IcosahedronGeometry(0.1, 2);
    }

    spawnDustPuff(position, moveDirection, baseScale = 0.75) {
        const dir = moveDirection.clone();
        if (dir.lengthSq() > 0.0001) dir.normalize();

        const mat = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: 0.34,
            depthWrite: false,
            toneMapped: false
        });
        const mesh = new THREE.Mesh(this.dustGeo, mat);
        mesh.position.copy(position);
        mesh.position.y += 0.08;

        const velocity = new THREE.Vector3(0, 0.42, 0).add(
            dir.clone().multiplyScalar(-0.12)
        );

        Globals.scene.add(mesh);
        this.particles.push({
            mesh: mesh,
            velocity: velocity,
            life: 1.0,
            decay: 2.15,
            gravity: -0.12,
            baseScale: baseScale * 1.28,
            baseOpacity: 0.4,
            spin: 0.6,
            puffScale: {
                peakAt: 0.22,
                start: 0.98,
                peak: 1.45,
                end: 0.34
            }
        });
    }
    
    spawnBurst(position, direction, count, colorHex, isExit, baseScale = 1.0, speedRange = [4, 12]) {
        for (let i = 0; i < count; i++) {
            const mat = new THREE.MeshBasicMaterial({
                color: colorHex,
                transparent: true,
                opacity: 0.95,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            });
            const mesh = new THREE.Mesh(this.geo, mat);
            mesh.position.copy(position);
            mesh.position.y += 0.4; 
            mesh.layers.enable(1);
            
            const spread = new THREE.Vector3(
                (Math.random() - 0.5) * 2, 
                (Math.random() - 0.5) * 2, 
                (Math.random() - 0.5) * 2
            ).normalize();
            
            if (isExit) spread.add(direction.clone().multiplyScalar(1.5)).normalize();
            else spread.add(direction.clone().multiplyScalar(-0.5)).normalize();
            
            Globals.scene.add(mesh);
            this.particles.push({ 
                mesh: mesh, 
                velocity: spread.multiplyScalar(Math.random() * (speedRange[1]-speedRange[0]) + speedRange[0]), 
                life: 1.0, 
                baseScale: baseScale * 1.15,
                baseOpacity: 0.95,
                spin: 18 + Math.random() * 8
            });
        }
    }

    update(delta) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i]; 
            p.life -= delta * (p.decay || 3);
            if (p.life <= 0) { 
                Globals.scene.remove(p.mesh); 
                p.mesh.material.dispose(); 
                this.particles.splice(i, 1); 
            } else { 
                p.velocity.y += delta * (p.gravity !== undefined ? p.gravity : -15); 
                p.mesh.position.addScaledVector(p.velocity, delta); 
                let size;
                if (p.puffScale) {
                    const progress = 1 - p.life;
                    if (progress < p.puffScale.peakAt) {
                        const t = progress / p.puffScale.peakAt;
                        size = p.baseScale * THREE.MathUtils.lerp(p.puffScale.start, p.puffScale.peak, t);
                    } else {
                        const t = (progress - p.puffScale.peakAt) / (1 - p.puffScale.peakAt);
                        size = p.baseScale * THREE.MathUtils.lerp(p.puffScale.peak, p.puffScale.end, t);
                    }
                } else {
                    size = p.baseScale * ((1 - p.life) * (p.grow || 1) + p.life);
                }
                p.mesh.scale.setScalar(size); 
                p.mesh.rotation.x += delta * (p.spin || 15); 
                p.mesh.rotation.y += delta * (p.spin || 15); 
                if (p.mesh.material) p.mesh.material.opacity = p.life * (p.baseOpacity || 1);
            }
        }
    }
}
