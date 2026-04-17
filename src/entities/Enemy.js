import * as THREE from 'three';
import { Globals, SVG, showFloatingText, triggerShake, triggerHaptic } from '../utils.js';
import { CONFIG } from '../config.js';
import { BloodStain } from '../effects/BloodStain.js';
import { SlashFlashEffect } from '../effects/SlashFlashEffect.js';

export class Enemy {
    constructor(spawnPosition = null, isDummy = false) {
        this.isDummy = isDummy;
        this.mesh = new THREE.Group(); 
        this.mesh.position.y = 0.4; 
        this.knockbackVelocity = new THREE.Vector3(0, 0, 0); 
        this.stunTimer = 0; 
        
        let bodyColor = 0x5e55a2;
        let eyeColor = 0x91c53a;
        let hornColor = 0x5e55a2;
        
        if (this.isDummy) {
            bodyColor = 0xc2824e; // Wooden brown
            eyeColor = 0x4a3219;  // Dark wood
            hornColor = 0xa36c3e; // Slightly darker wood
        }
        
        const bodyMat = new THREE.MeshBasicMaterial({ color: bodyColor });
        const eyeMat = new THREE.MeshBasicMaterial({ color: eyeColor });
        const hornMat = new THREE.MeshBasicMaterial({ color: hornColor });
        this.materials = [bodyMat, eyeMat, hornMat];
        this.flashTimeoutId = null;
        this.materials.forEach((mat) => {
            mat.userData.baseColor = mat.color.getHex();
        });
        
        const bodyGeo = new THREE.SphereGeometry(0.38, 32, 32);
        this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        this.bodyMesh.scale.set(1.15, 0.9, 1.1);
        this.mesh.add(this.bodyMesh);
        
        const eyeGeo = new THREE.CapsuleGeometry(0.04, 0.08, 8, 16);
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(0.16, 0.1, 0.32); leftEye.rotation.z = -0.3; leftEye.rotation.x = 0.2; leftEye.layers.enable(1); this.bodyMesh.add(leftEye);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(-0.16, 0.1, 0.32); rightEye.rotation.z = 0.3; rightEye.rotation.x = 0.2; rightEye.layers.enable(1); this.bodyMesh.add(rightEye);
        
        const earGeo = new THREE.ConeGeometry(0.12, 0.22, 16);
        const leftEar = new THREE.Mesh(earGeo, hornMat);
        leftEar.position.set(0.25, 0.28, 0); leftEar.rotation.z = -0.4; leftEar.rotation.x = -0.1;
        this.bodyMesh.add(leftEar);
        const rightEar = new THREE.Mesh(earGeo, hornMat);
        rightEar.position.set(-0.25, 0.28, 0); rightEar.rotation.z = 0.4; rightEar.rotation.x = -0.1;
        this.bodyMesh.add(rightEar);
        
        this.animOffset = Math.random() * 10;
        if (spawnPosition) {
            this.mesh.position.x = spawnPosition.x;
            this.mesh.position.z = spawnPosition.z;
        }
        
        this.hp = this.isDummy ? Infinity : 160; 
        this.speed = this.isDummy ? 0 : 2.5 + Math.random() * 1.5; 
        this.isDead = false; 
        this.mesh.scale.setScalar(CONFIG.enemyScale);
        
        Globals.scene.add(this.mesh); 
        Globals.enemies.push(this);
    }
    
    update(delta, time) {
        if (this.isDead) return;
        if (this.stunTimer > 0) this.stunTimer -= delta;
        else if (!this.isDummy) {
            const dir = new THREE.Vector3().subVectors(Globals.player.mesh.position, this.mesh.position);
            dir.y = 0; dir.normalize(); 
            this.mesh.position.addScaledVector(dir, this.speed * delta);
            this.mesh.lookAt(Globals.player.mesh.position.x, this.mesh.position.y, Globals.player.mesh.position.z);
        }
        
        const bounce = this.isDummy ? 0 : Math.abs(Math.sin(time * 6 + this.animOffset));
        this.bodyMesh.position.y = bounce * 0.15;
        this.bodyMesh.scale.set(1.15 - bounce * 0.1, 0.9 + bounce * 0.15, 1.1 - bounce * 0.1);
        
        if (this.knockbackVelocity.lengthSq() > 0.01) { 
            this.mesh.position.addScaledVector(this.knockbackVelocity, delta); 
            this.knockbackVelocity.lerp(new THREE.Vector3(0, 0, 0), delta * 10); 
        }
    }
    
    applyKnockback(direction, force) { 
        if (!this.isDummy) {
            this.knockbackVelocity.add(direction.clone().multiplyScalar(force)); 
        }
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
        triggerHaptic('die');
        triggerShake(CONFIG.shakeIntensityDeath, CONFIG.shakeDuration); 
        const pos = this.mesh.position.clone(); 
        const dir = direction || new THREE.Vector3(0,0,1);

        Globals.audioManager?.playEnemyDeath();

        Globals.slashEffects.push(new SlashFlashEffect(pos, dir, CONFIG.enemyScale));
        
        if (this.isDummy) {
            Globals.particleManager.spawnBurst(pos, dir, 30, 0xc2824e, true, 5.0); 
            Globals.particleManager.spawnBurst(pos, new THREE.Vector3(0,1,0), 10, 0x4a3219, true, 4.0); 
        } else {
            Globals.particleManager.spawnBurst(pos, dir, 30, 0x5e55a2, true, 5.0); 
            Globals.particleManager.spawnBurst(pos, new THREE.Vector3(0,1,0), 10, 0x2e2a52, true, 4.0); 
            Globals.bloodStains.push(new BloodStain(pos)); 
        }
        
        Globals.scene.remove(this.mesh);
    }
}
