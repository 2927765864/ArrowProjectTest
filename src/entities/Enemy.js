import * as THREE from 'three';
import { Globals, SVG, showFloatingText, triggerShake } from '../utils.js';
import { CONFIG } from '../config.js';
import { BloodStain } from '../effects/BloodStain.js';
import { SlashFlashEffect } from '../effects/SlashFlashEffect.js';

export class Enemy {
    constructor(spawnPosition = null) {
        this.mesh = new THREE.Group(); 
        this.mesh.position.y = 0.4; 
        this.knockbackVelocity = new THREE.Vector3(0, 0, 0); 
        this.stunTimer = 0; 
        
        const bodyMat = new THREE.MeshBasicMaterial({ color: 0x5e55a2 });
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x91c53a });
        const hornMat = new THREE.MeshBasicMaterial({ color: 0x5e55a2 });
        this.materials = [bodyMat, eyeMat, hornMat];
        this.flashTimeoutId = null;
        this.materials.forEach((mat) => {
            mat.userData.baseColor = mat.color.getHex();
        });
        
        const bodyGeo = new THREE.IcosahedronGeometry(0.4, 0); 
        this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat); 
        this.mesh.add(this.bodyMesh);
        
        const eyeGeo = new THREE.BoxGeometry(0.15, 0.08, 0.1);
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat); 
        leftEye.position.set(0.15, 0.1, 0.32); leftEye.rotation.z = -0.2; leftEye.layers.enable(1); this.bodyMesh.add(leftEye);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat); 
        rightEye.position.set(-0.15, 0.1, 0.32); rightEye.rotation.z = 0.2; rightEye.layers.enable(1); this.bodyMesh.add(rightEye);
        
        const hornGeo = new THREE.ConeGeometry(0.08, 0.25, 4);
        const leftHorn = new THREE.Mesh(hornGeo, hornMat); 
        leftHorn.position.set(0.25, 0.35, 0.1); leftHorn.rotation.z = -0.5; leftHorn.rotation.x = -0.2;
        this.bodyMesh.add(leftHorn);
        const rightHorn = new THREE.Mesh(hornGeo, hornMat); 
        rightHorn.position.set(-0.25, 0.35, 0.1); rightHorn.rotation.z = 0.5; rightHorn.rotation.x = -0.2;
        this.bodyMesh.add(rightHorn);
        
        this.animOffset = Math.random() * 10;
        if (spawnPosition) {
            this.mesh.position.x = spawnPosition.x;
            this.mesh.position.z = spawnPosition.z;
        }
        
        this.hp = 160; 
        this.speed = 2.5 + Math.random() * 1.5; 
        this.isDead = false; 
        this.mesh.scale.setScalar(CONFIG.enemyScale);
        
        Globals.scene.add(this.mesh); 
        Globals.enemies.push(this);
    }
    
    update(delta, time) {
        if (this.isDead) return;
        if (this.stunTimer > 0) this.stunTimer -= delta;
        else {
            const dir = new THREE.Vector3().subVectors(Globals.player.mesh.position, this.mesh.position);
            dir.y = 0; dir.normalize(); 
            this.mesh.position.addScaledVector(dir, this.speed * delta);
            this.mesh.lookAt(Globals.player.mesh.position.x, this.mesh.position.y, Globals.player.mesh.position.z);
        }
        
        this.bodyMesh.position.y = Math.sin(time * 5 + this.animOffset) * 0.1;
        const scalePulse = 1 + Math.sin(time * 8 + this.animOffset) * 0.05;
        this.bodyMesh.scale.set(scalePulse, scalePulse, scalePulse);
        
        if (this.knockbackVelocity.lengthSq() > 0.01) { 
            this.mesh.position.addScaledVector(this.knockbackVelocity, delta); 
            this.knockbackVelocity.lerp(new THREE.Vector3(0, 0, 0), delta * 10); 
        }
    }
    
    applyKnockback(direction, force) { 
        this.knockbackVelocity.add(direction.clone().multiplyScalar(force)); 
    }
    
    applyStun(duration) { 
        this.stunTimer = Math.max(this.stunTimer, duration); 
    }
    
    takeDamage(amount, type, direction) {
        this.hp -= amount; 
        this.materials.forEach(mat => { 
            mat.color.setHex(0xffffff); 
        });
        if (this.flashTimeoutId) clearTimeout(this.flashTimeoutId);
        this.flashTimeoutId = setTimeout(() => {
            if (!this.isDead) {
                this.materials.forEach((mat) => {
                    mat.color.setHex(mat.userData.baseColor);
                });
            }
            this.flashTimeoutId = null;
        }, 100);
        
        showFloatingText(
            this.mesh.position, 
            `<div class="dmg-flex">${type === 'low' ? SVG.shield : SVG.explode}<span>${amount}</span></div>`, 
            type === 'low' ? 'text-low' : (type === 'special' ? 'text-crit' : 'text-high')
        );
        
        if (this.hp <= 0 && !this.isDead) { this.die(direction); }
    }
    
    die(direction) {
        this.isDead = true; 
        if (this.flashTimeoutId) {
            clearTimeout(this.flashTimeoutId);
            this.flashTimeoutId = null;
        }
        triggerShake(CONFIG.shakeIntensityDeath, CONFIG.shakeDuration); 
        const pos = this.mesh.position.clone(); 
        const dir = direction || new THREE.Vector3(0,0,1);

        Globals.audioManager?.playEnemyDeath();

        Globals.slashEffects.push(new SlashFlashEffect(pos, dir, CONFIG.enemyScale));
        
        Globals.particleManager.spawnBurst(pos, dir, 30, 0x5e55a2, true, 5.0); 
        Globals.particleManager.spawnBurst(pos, new THREE.Vector3(0,1,0), 10, 0x2e2a52, true, 4.0); 
        
        Globals.bloodStains.push(new BloodStain(pos)); 
        Globals.scene.remove(this.mesh);
    }
}
