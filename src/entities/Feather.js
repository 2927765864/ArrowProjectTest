import * as THREE from 'three';
import { Globals, triggerShake } from '../utils.js';
import { CONFIG } from '../config.js';

export class Feather {
    constructor(targetEnemy, isSpecial = false) {
        this.phase = 'shooting'; 
        this.index = 0; 
        this.speed = CONFIG.deploySpeed; 
        this.hitEnemies = new Set(); 
        this.isSpecial = isSpecial; 
        this.hitStopTimer = 0; 
        this.deploymentRingRotation = 0;

        this.tetherLine = new THREE.Group();
        this.tetherLine.visible = false;
        this.tetherSegments = [];
        this.tetherDashLength = isSpecial ? CONFIG.specialTetherDashLength : CONFIG.tetherDashLength;
        this.tetherGapLength = isSpecial ? CONFIG.specialTetherGapLength : CONFIG.tetherGapLength;
        this.tetherThickness = isSpecial ? CONFIG.specialTetherThickness : CONFIG.tetherThickness;
        this.tetherSegmentGeometry = new THREE.BoxGeometry(1, 1, 1);
        this.tetherBaseMaterial = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: isSpecial ? 0.95 : 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const tetherSegmentCount = isSpecial ? CONFIG.specialTetherSegmentCount : CONFIG.tetherSegmentCount;
        this.ensureTetherSegments(tetherSegmentCount);
        Globals.scene.add(this.tetherLine);

        this.deploymentRing = new THREE.Group();
        this.deploymentRing.visible = false;
        this.deploymentRingSegments = [];
        this.deploymentRingGeometry = new THREE.BoxGeometry(1, 1, 1);
        this.deploymentRingMaterial = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: isSpecial ? 1.0 : 0.82,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        Globals.scene.add(this.deploymentRing);
        
        this.mesh = new THREE.Group(); 
        this.modelGroup = new THREE.Group(); 
        this.mesh.add(this.modelGroup);
        
        
        const quillMat = new THREE.MeshBasicMaterial({ 
            color: 0x91c53a 
        });
        const tipMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a
        });
        
        // Spear of Longinus Model
        const spearMat = new THREE.MeshBasicMaterial({ color: 0x91c53a });
        const darkMat = new THREE.MeshBasicMaterial({ color: 0x5e55a2 });

        // 1. Long Shaft
        const shaftGeo = new THREE.CylinderGeometry(0.025, 0.045, 2.8, 8);
        const shaft = new THREE.Mesh(shaftGeo, spearMat);
        shaft.position.y = -0.2;
        this.modelGroup.add(shaft);

        // 2. Base Pommel / Grip details
        const pommelGeo = new THREE.CapsuleGeometry(0.06, 0.25, 4, 8);
        const pommel = new THREE.Mesh(pommelGeo, darkMat);
        pommel.position.y = -1.6;
        this.modelGroup.add(pommel);

        const guardGeo = new THREE.TorusGeometry(0.08, 0.025, 8, 16);
        const guard = new THREE.Mesh(guardGeo, spearMat);
        guard.position.y = -1.4;
        guard.rotation.x = Math.PI / 2;
        this.modelGroup.add(guard);

        // 3. Double Helix and Forked Prongs
        class LonginusCurve extends THREE.Curve {
            constructor(phase) {
                super();
                this.phase = phase;
            }
            getPoint(t, optionalTarget = new THREE.Vector3()) {
                let x = 0, y = 0, z = 0;
                // t goes from 0 to 1
                if (t < 0.6) {
                    // Twisting helix part (60% of curve length)
                    const ht = t / 0.6; // 0 to 1
                    y = 1.2 + ht * 1.8;  // Starts at 1.2 (end of shaft), ends at 3.0
                    const turns = 3.0; // More twists
                    const angle = ht * Math.PI * 2 * turns + this.phase;
                    
                    let r = 0.055; // Tighter radius (closer to shaft)
                    // Smooth taper out from the center shaft at the base
                    if (ht < 0.1) r = 0.015 + (ht / 0.1) * 0.04;
                    // Taper back in before diverging
                    if (ht > 0.9) r = 0.055 - ((ht - 0.9) / 0.1) * 0.04;
                    
                    x = Math.cos(angle) * r;
                    z = Math.sin(angle) * r;
                } else {
                    // Forked prongs (40% of curve length)
                    const pt = (t - 0.6) / 0.4; // 0 to 1
                    y = 3.0 + pt * 3.0; // Prongs are much longer (extends 3.0 units)
                    
                    // Final angle of the helix determines the spread direction
                    const finalAngle = 1.0 * Math.PI * 2 * 3.0 + this.phase;
                    
                    let r = 0.015 + pt * 0.22; // Spreads out from center
                    // Curve slightly inwards at the very tip for the classic look
                    if (pt > 0.8) {
                        r -= ((pt - 0.8) / 0.2) * 0.08;
                    }
                    
                    x = Math.cos(finalAngle) * r;
                    z = Math.sin(finalAngle) * r;
                }
                return optionalTarget.set(x, y, z);
            }
        }
        
        // Use high tubularSegments to ensure the twist is smooth
        const tube1Geo = new THREE.TubeGeometry(new LonginusCurve(0), 128, 0.025, 8, false);
        const tube1 = new THREE.Mesh(tube1Geo, spearMat);
        this.modelGroup.add(tube1);
        
        const tube2Geo = new THREE.TubeGeometry(new LonginusCurve(Math.PI), 128, 0.025, 8, false);
        const tube2 = new THREE.Mesh(tube2Geo, spearMat);
        this.modelGroup.add(tube2);
        
        // Ensure scale is correct for gameplay (Feather was smaller)
        this.modelGroup.scale.setScalar(0.65);

        // Fix direction: Rotate +Y (tip) to align with +Z (forward direction of lookAt)
        this.modelGroup.rotateX(Math.PI / 2);
        if (isSpecial) this.mesh.scale.set(1.4, 1.4, 1.4);
        
        this.mesh.position.copy(Globals.player.mesh.position); 
        this.mesh.position.y = 1; 
        Globals.scene.add(this.mesh);
        
        const pt = Globals.player.mesh.position.clone(); pt.y = 1; 
        const et = targetEnemy.mesh.position.clone(); et.y = 1;
        const dir = new THREE.Vector3().subVectors(et, pt).normalize(); 
        this.direction = dir;
        this.mesh.lookAt(this.mesh.position.clone().add(dir));
        this.targetPos = et.clone().addScaledVector(dir, 1.5);
    }
    
    update(delta) {
        if (this.hitStopTimer > 0) {
            if (this.phase === 'deployed' || this.phase === 'recalling') this.updateTetherLine();
            this.hitStopTimer -= delta;
            return;
        }
        if (this.phase !== 'deployed') this.modelGroup.rotateY(15 * delta);
        
        if (this.phase === 'shooting') {
            const dist = this.mesh.position.distanceTo(this.targetPos); 
            const step = this.speed * delta;
            if (dist <= step) { 
                this.mesh.position.copy(this.targetPos); 
                this.phase = 'deployed'; 
                this.tetherLine.visible = true; 
                this.mesh.position.y = 0.2 + Math.random() * 0.2; 
                const stabTarget = this.mesh.position.clone()
                    .addScaledVector(this.direction, 0.2)
                    .add(new THREE.Vector3(0, -4, 0));
                this.mesh.lookAt(stabTarget);
                this.mesh.rotateZ((Math.random() - 0.5) * 0.35);
                this.updateDeploymentRing();
                Globals.audioManager?.playDeploy(this.isSpecial);
            } else {
                this.mesh.position.addScaledVector(this.direction, step);
            }
            this.checkCollision('low', 5);
        } else if (this.phase === 'deployed') {
            this.deploymentRingRotation += delta * (this.isSpecial ? 1.8 : 1.2);
            this.updateTetherLine();
            this.updateDeploymentRing();
        } else if (this.phase === 'recalling') {
            const pt = Globals.player.mesh.position.clone(); pt.y = 1; 
            const dir = new THREE.Vector3().subVectors(pt, this.mesh.position).normalize();
            this.mesh.lookAt(this.mesh.position.clone().sub(dir));
            const dist = this.mesh.position.distanceTo(pt); 
            const step = this.speed * delta;
            if (dist <= step || dist < 1.0) {
                Globals.audioManager?.playRecallComplete();
                this.destroy();
            } else {
                this.mesh.position.addScaledVector(dir, step);
            }
            this.updateTetherLine();
            this.deploymentRing.visible = false;
            let dmg = 10, type = 'high';
            if (this.isSpecial) { dmg = 80; type = 'special'; } 
            this.checkCollision(type, dmg);
        }
    }

    updateTetherLine() {
        this.tetherDashLength = this.isSpecial ? CONFIG.specialTetherDashLength : CONFIG.tetherDashLength;
        this.tetherGapLength = this.isSpecial ? CONFIG.specialTetherGapLength : CONFIG.tetherGapLength;
        this.tetherThickness = this.isSpecial ? CONFIG.specialTetherThickness : CONFIG.tetherThickness;
        const start = new THREE.Vector3(Globals.player.mesh.position.x, 1.0, Globals.player.mesh.position.z);
        const end = new THREE.Vector3(this.mesh.position.x, this.mesh.position.y, this.mesh.position.z);
        const direction = new THREE.Vector3().subVectors(end, start);
        const distance = direction.length();
        if (distance < 0.001) {
            this.tetherSegments.forEach((segment) => { segment.visible = false; });
            return;
        }

        direction.normalize();
        const step = this.tetherDashLength + this.tetherGapLength;
        const requiredSegments = Math.max(
            this.isSpecial ? CONFIG.specialTetherSegmentCount : CONFIG.tetherSegmentCount,
            Math.ceil(distance / step)
        );
        this.ensureTetherSegments(requiredSegments);
        const alignment = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction);

        this.tetherSegments.forEach((segment, index) => {
            const dashStart = index * step;
            if (dashStart >= distance) {
                segment.visible = false;
                return;
            }

            const dashLength = Math.min(this.tetherDashLength, distance - dashStart);
            segment.visible = true;
            segment.position.copy(start).addScaledVector(direction, dashStart + dashLength * 0.5);
            segment.quaternion.copy(alignment);
            segment.scale.set(dashLength, this.tetherThickness, this.tetherThickness);
        });

        this.tetherLine.visible = true;
    }

    updateDeploymentRing() {
        const radius = this.isSpecial ? 0.78 : 0.58;
        const dashLength = this.isSpecial ? CONFIG.specialTetherDashLength : CONFIG.tetherDashLength;
        const gapLength = this.isSpecial ? CONFIG.specialTetherGapLength : CONFIG.tetherGapLength;
        const thickness = this.isSpecial ? Math.max(0.07, CONFIG.specialTetherThickness) : Math.max(0.05, CONFIG.tetherThickness * 1.35);
        const circumference = Math.PI * 2 * radius;
        const step = Math.max(0.08, dashLength + gapLength);
        const segmentCount = Math.max(6, Math.ceil(circumference / step));
        this.ensureDeploymentRingSegments(segmentCount);

        for (let i = 0; i < this.deploymentRingSegments.length; i++) {
            const segment = this.deploymentRingSegments[i];
            if (i >= segmentCount) {
                segment.visible = false;
                continue;
            }

            const dashArc = Math.min(dashLength, circumference / segmentCount * 0.9);
            const dashAngle = dashArc / radius;
            const angle = (i / segmentCount) * Math.PI * 2 + this.deploymentRingRotation;
            segment.visible = true;
            segment.position.set(
                this.mesh.position.x + Math.cos(angle) * radius,
                0.08,
                this.mesh.position.z + Math.sin(angle) * radius
            );
            const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
            segment.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
            segment.scale.set(dashArc, thickness, thickness);
        }

        this.deploymentRing.visible = true;
    }

    ensureTetherSegments(count) {
        while (this.tetherSegments.length < count) {
            const segment = new THREE.Mesh(this.tetherSegmentGeometry, this.tetherBaseMaterial.clone());
            segment.layers.enable(1);
            segment.visible = false;
            this.tetherLine.add(segment);
            this.tetherSegments.push(segment);
        }
    }

    ensureDeploymentRingSegments(count) {
        while (this.deploymentRingSegments.length < count) {
            const segment = new THREE.Mesh(this.deploymentRingGeometry, this.deploymentRingMaterial.clone());
            segment.layers.enable(1);
            segment.visible = false;
            this.deploymentRing.add(segment);
            this.deploymentRingSegments.push(segment);
        }
    }
    
    checkCollision(damageType, damageAmount) {
        for (let i = Globals.enemies.length - 1; i >= 0; i--) {
            const enemy = Globals.enemies[i]; 
            if (enemy.isDead) continue;
            
            if (this.mesh.position.distanceTo(enemy.mesh.position) < 1.5) {
                if (!this.hitEnemies.has(enemy)) {
                    this.hitEnemies.add(enemy);
                    let currentDir = new THREE.Vector3();
                    if (this.phase === 'shooting') currentDir.copy(this.direction);
                    else { 
                        const pt = Globals.player.mesh.position.clone(); pt.y = 1; 
                        currentDir.subVectors(pt, this.mesh.position).normalize(); 
                    }
                    
                    enemy.takeDamage(damageAmount, damageType, currentDir);
                    const offset = 0.4 * CONFIG.enemyScale;
                    const entryPos = enemy.mesh.position.clone().addScaledVector(currentDir, -offset);
                    const exitPos = enemy.mesh.position.clone().addScaledVector(currentDir, offset);
                    
                    if (damageType === 'low') {
                        Globals.audioManager?.playHit('low');
                        enemy.applyKnockback(currentDir, 10);
                        Globals.particleManager.spawnBurst(entryPos, currentDir, 4, 0x91c53a, false, 0.7);
                        Globals.particleManager.spawnBurst(exitPos, currentDir, 8, 0x91c53a, true, 0.7);
                    } else {
                        const isSpec = damageType === 'special';
                        Globals.audioManager?.playHit(isSpec ? 'special' : 'high');
                        this.hitStopTimer = isSpec ? 0.18 : 0.06;
                        enemy.applyStun(0.15);
                        if (isSpec) triggerShake(CONFIG.shakeIntensityFinal, CONFIG.shakeDuration); 
                        else triggerShake(CONFIG.shakeIntensityRecall, 0.1);
                        Globals.particleManager.spawnBurst(entryPos, currentDir, 8, 0x5e55a2, false, 2.5);
                        Globals.particleManager.spawnBurst(exitPos, currentDir, 16, 0x5e55a2, true, 2.5);
                    }
                }
            }
        }
    }
    
    startRecall(index) {
        this.phase = 'recalling'; 
        this.index = index; 
        this.hitEnemies.clear(); 
        this.deploymentRing.visible = false;
        if (this.isSpecial) { 
            this.mesh.scale.set(2.2, 2.2, 2.2); 
             
            this.speed = CONFIG.finalRecallSpeed; 
        } else {
            this.speed = CONFIG.baseRecallSpeed + index * 5;
        }
    }
    
    destroy() { 
        Globals.scene.remove(this.mesh); 
        Globals.scene.remove(this.tetherLine); 
        Globals.scene.remove(this.deploymentRing);
        this.tetherLine.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        this.deploymentRing.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        const idx = Globals.feathers.indexOf(this); 
        if (idx > -1) Globals.feathers.splice(idx, 1); 
    }
}
