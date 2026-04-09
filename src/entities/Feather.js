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
        
        // Spear of Longinus Model (Highly accurate EVA stylized)
        const spearMat = new THREE.MeshBasicMaterial({ color: 0x91c53a });

        // The spear has three main parts: 
        // 1. The straight base shaft (25%)
        // 2. The tightly wound double helix body (50%)
        // 3. The massive sweeping forked prongs (25%)
        
        // 1. Base Shaft
        // The tail end of Longinus has a few segmented rings and tapers to a point
        const tailGeo = new THREE.CylinderGeometry(0.01, 0.08, 0.5, 8);
        const tail = new THREE.Mesh(tailGeo, spearMat);
        tail.position.y = -1.25;
        this.modelGroup.add(tail);

        const ringGeo = new THREE.TorusGeometry(0.08, 0.02, 8, 16);
        const ring = new THREE.Mesh(ringGeo, spearMat);
        ring.position.y = -1.0;
        ring.rotation.x = Math.PI / 2;
        this.modelGroup.add(ring);

        const shaftGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.5, 8);
        const shaft = new THREE.Mesh(shaftGeo, spearMat);
        shaft.position.y = -0.25;
        this.modelGroup.add(shaft);

        // 2. Tightly Wound Double Helix & 3. Forked Prongs
        class LonginusCurve extends THREE.Curve {
            constructor(phase) {
                super();
                this.phase = phase;
            }
            getPoint(t, optionalTarget = new THREE.Vector3()) {
                let x = 0, y = 0, z = 0;
                
                // Total length: y goes from 0.5 (end of shaft) to ~6.0
                if (t < 0.65) {
                    // Helix section
                    const ht = t / 0.65; // 0 -> 1
                    y = 0.5 + ht * 4.0;  // 0.5 to 4.5
                    
                    const turns = 3.5; 
                    const angle = ht * Math.PI * 2 * turns + this.phase;
                    
                    // The helix is extremely tight. 
                    // To look like two vines twisting, the radius is very small.
                    let r = 0.055; 
                    
                    // At the bottom, it tapers seamlessly from the shaft
                    if (ht < 0.05) {
                        r = 0.0 + (ht / 0.05) * 0.055;
                    }
                    // At the top, it widens just before splitting into the prongs
                    if (ht > 0.9) {
                        r = 0.055 + ((ht - 0.9) / 0.1) * 0.06;
                    }
                    
                    x = Math.cos(angle) * r;
                    z = Math.sin(angle) * r;
                } else {
                    // Prong section
                    const pt = (t - 0.65) / 0.35; // 0 -> 1
                    y = 4.5 + pt * 2.5; // 4.5 to 7.0
                    
                    // The prongs stay locked at the final angle of the helix
                    const finalAngle = 1.0 * Math.PI * 2 * 3.5 + this.phase;
                    
                    // The classic Longinus fork: bows out massively, then curves back in parallel
                    let r;
                    if (pt < 0.4) {
                        // Bows outward strongly
                        const bowT = pt / 0.4;
                        // quadratic easing out
                        r = 0.115 + (0.45 * (1 - Math.pow(1 - bowT, 2))); 
                    } else if (pt < 0.8) {
                        // Remains roughly parallel, slightly tapering inward
                        const midT = (pt - 0.4) / 0.4;
                        r = 0.565 - midT * 0.08;
                    } else {
                        // Curves sharply inward to a tip
                        const tipT = (pt - 0.8) / 0.2;
                        r = 0.485 - (tipT * 0.3); 
                    }
                    
                    x = Math.cos(finalAngle) * r;
                    z = Math.sin(finalAngle) * r;
                }
                
                return optionalTarget.set(x, y, z);
            }
        }

        // We use a flattened profile for the tube to mimic the "bladed" feel of the prongs
        const profileShape = new THREE.Shape();
        profileShape.ellipse(0, 0, 0.035, 0.06, 0, Math.PI * 2);

        const extrudeSettings = {
            steps: 128,
            bevelEnabled: false,
            extrudePath: new LonginusCurve(0)
        };
        const prong1Geo = new THREE.ExtrudeGeometry(profileShape, extrudeSettings);
        const prong1 = new THREE.Mesh(prong1Geo, spearMat);
        this.modelGroup.add(prong1);

        const extrudeSettings2 = {
            steps: 128,
            bevelEnabled: false,
            extrudePath: new LonginusCurve(Math.PI)
        };
        const prong2Geo = new THREE.ExtrudeGeometry(profileShape, extrudeSettings2);
        const prong2 = new THREE.Mesh(prong2Geo, spearMat);
        this.modelGroup.add(prong2);

        // Center the whole model so the origin is roughly at the grip
        this.modelGroup.position.y = -1.5;
        
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
