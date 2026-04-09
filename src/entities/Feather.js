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
        
        // Spear of Longinus Model (Highly accurate EVA proportions based on reference)
        const spearMat = new THREE.MeshBasicMaterial({ color: 0x91c53a });

        // 1. The ultra-tight double helix base (Tapered twisted shaft)
        // We use a cylinder that shrinks to 0 at the bottom, then severely flatten it
        // and twist the vertices programmatically to create tight spiral grooves.
        const shaftGeo = new THREE.CylinderGeometry(0.12, 0.0, 7.0, 16, 128);
        const posAttribute = shaftGeo.attributes.position;
        for (let i = 0; i < posAttribute.count; i++) {
            let x = posAttribute.getX(i);
            let y = posAttribute.getY(i);
            let z = posAttribute.getZ(i);
            
            // Flatten to simulate two strands
            z *= 0.25; 
            
            // y goes from 3.5 (top) to -3.5 (bottom)
            const ht = (3.5 - y) / 7.0; 
            // Extremely tight winding (28 full turns)
            const twistAngle = ht * Math.PI * 2 * 28; 
            
            const nx = x * Math.cos(twistAngle) - z * Math.sin(twistAngle);
            const nz = x * Math.sin(twistAngle) + z * Math.cos(twistAngle);
            
            posAttribute.setXYZ(i, nx, y, nz);
        }
        shaftGeo.computeVertexNormals();
        const shaft = new THREE.Mesh(shaftGeo, spearMat);
        shaft.position.y = -3.5; // Top is exactly at Y=0
        this.modelGroup.add(shaft);

        // 2. The iconic Zig-Zag diamond cutouts and extremely long straight prongs
        // We build the prongs segment by segment to guarantee sharp, mechanical bends
        const ptsR = [
            new THREE.Vector3(0, 0, 0),         // Split start
            new THREE.Vector3(0.3, 0.5, 0),     // Sharp outward bend
            new THREE.Vector3(0.14, 0.8, 0),    // Sharp inward bend
            new THREE.Vector3(0.28, 1.2, 0),    // Sharp outward bend again
            new THREE.Vector3(0.015, 6.0, 0)    // Extends EXTREMELY far forward to a sharp tip
        ];
        const widths = [0.12, 0.1, 0.1, 0.08, 0.01];

        const buildProng = (points, side) => {
            const group = new THREE.Group();
            const sign = side === 'left' ? -1 : 1;
            
            for(let i = 0; i < points.length; i++) {
                const p = points[i].clone();
                p.x *= sign;
                
                // Joint sphere for sharp, seamless elbows
                const jointGeo = new THREE.SphereGeometry(widths[i], 16, 16);
                const joint = new THREE.Mesh(jointGeo, spearMat);
                joint.position.copy(p);
                joint.scale.z = 0.3; // Flatten into a blade profile
                group.add(joint);
                
                // Straight segment
                if (i < points.length - 1) {
                    const pNext = points[i+1].clone();
                    pNext.x *= sign;
                    
                    const dist = p.distanceTo(pNext);
                    const segGeo = new THREE.CylinderGeometry(widths[i+1], widths[i], dist, 16);
                    const seg = new THREE.Mesh(segGeo, spearMat);
                    
                    const dir = new THREE.Vector3().subVectors(pNext, p).normalize();
                    seg.position.copy(p).add(pNext).multiplyScalar(0.5);
                    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
                    seg.scale.z = 0.3; // Flatten into a blade profile
                    
                    group.add(seg);
                }
            }
            return group;
        };

        this.modelGroup.add(buildProng(ptsR, 'right'));
        this.modelGroup.add(buildProng(ptsR, 'left'));

        // Center the overall mass of the weapon for rotation
        this.modelGroup.position.y = 1.0; 

        // Scale to gameplay size (Total length is ~13, scaled by 0.35 gives ~4.5)
        this.modelGroup.scale.setScalar(0.35);

        // Correct direction: +Y (tip) rotates to exactly -Z (lookAt target forward)
        this.modelGroup.rotation.set(-Math.PI / 2, 0, 0);
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
        
        if (this.phase === 'shooting') {
            // Keep straight forward orientation to target
            this.mesh.lookAt(this.mesh.position.clone().add(this.direction));

            const dist = this.mesh.position.distanceTo(this.targetPos); 
            const step = this.speed * delta;
            if (dist <= step) { 
                this.mesh.position.copy(this.targetPos); 
                this.phase = 'deployed'; 
                this.tetherLine.visible = true; 
                this.mesh.position.y = 1.6; // Raise the center slightly so it stands tall
                
                // Point UP to the sky when deployed on the ground
                const standTarget = this.mesh.position.clone()
                    .add(new THREE.Vector3(0, 4, 0)) 
                    .addScaledVector(this.direction, 0.2); // Slightly lean forward
                this.mesh.lookAt(standTarget);
                
                // Remove the random Z rotation so it stands perfectly straight and solemn
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
            
            // Look AT player = tip pointing inwards (towards player)
            this.mesh.lookAt(this.mesh.position.clone().add(dir));
            
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
