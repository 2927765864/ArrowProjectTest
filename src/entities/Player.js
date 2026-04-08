import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Globals } from '../utils.js';

export class PlayerCharacter {
    constructor() {
        this.mesh = new THREE.Group();
        const skinMat = new THREE.MeshStandardMaterial({ color: 0xcca47c, roughness: 0.9, flatShading: true });
        const shirtMat = new THREE.MeshStandardMaterial({ color: 0x00aaff, roughness: 0.9, flatShading: true }); 
        const pantsMat = new THREE.MeshStandardMaterial({ color: 0x3d3db8, roughness: 0.9, flatShading: true }); 
        const shoeMat = new THREE.MeshStandardMaterial({ color: 0x6e6e6e, roughness: 0.9, flatShading: true }); 
        
        this.bodyGroup = new THREE.Group();
        this.bodyGroup.position.y = 0.6; 
        this.mesh.add(this.bodyGroup);
        
        // Torso (Shirt)
        const torsoGeo = new THREE.BoxGeometry(0.4, 0.6, 0.2);
        const torso = new THREE.Mesh(torsoGeo, shirtMat);
        torso.position.y = 0.3;
        torso.castShadow = true;
        this.bodyGroup.add(torso);
        
        // Head
        this.headGroup = new THREE.Group();
        this.headGroup.position.y = 0.8; 
        const headGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        const head = new THREE.Mesh(headGeo, skinMat);
        head.castShadow = true;
        
        // Hair (Dark brown block on top/back)
        const hairMat = new THREE.MeshStandardMaterial({ color: 0x4a2a18, roughness: 0.9, flatShading: true });
        const hairGeo = new THREE.BoxGeometry(0.42, 0.1, 0.42);
        const hairTop = new THREE.Mesh(hairGeo, hairMat);
        hairTop.position.y = 0.16;
        
        this.headGroup.add(head);
        this.headGroup.add(hairTop);
        this.bodyGroup.add(this.headGroup);
        
        // Arms (Skin with short sleeve)
        const armGroupL = new THREE.Group();
        const sleeveGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        const sleeveL = new THREE.Mesh(sleeveGeo, shirtMat);
        sleeveL.position.y = 0.1;
        const lowerArmGeo = new THREE.BoxGeometry(0.2, 0.4, 0.2);
        const lowerArmL = new THREE.Mesh(lowerArmGeo, skinMat);
        lowerArmL.position.y = -0.2;
        armGroupL.add(sleeveL);
        armGroupL.add(lowerArmL);
        
        this.leftArm = armGroupL;
        this.leftArm.position.set(0.3, 0.5, 0); 
        this.bodyGroup.add(this.leftArm);
        
        const armGroupR = new THREE.Group();
        const sleeveR = new THREE.Mesh(sleeveGeo, shirtMat);
        sleeveR.position.y = 0.1;
        const lowerArmR = new THREE.Mesh(lowerArmGeo, skinMat);
        lowerArmR.position.y = -0.2;
        armGroupR.add(sleeveR);
        armGroupR.add(lowerArmR);
        
        this.rightArm = armGroupR;
        this.rightArm.position.set(-0.3, 0.5, 0); 
        this.bodyGroup.add(this.rightArm);
        
        // Legs (Pants + Shoes)
        const legGroupL = new THREE.Group();
        const pantGeo = new THREE.BoxGeometry(0.2, 0.45, 0.2);
        const pantL = new THREE.Mesh(pantGeo, pantsMat);
        pantL.position.y = -0.125;
        const shoeGeo = new THREE.BoxGeometry(0.2, 0.15, 0.2);
        const shoeL = new THREE.Mesh(shoeGeo, shoeMat);
        shoeL.position.y = -0.425;
        legGroupL.add(pantL);
        legGroupL.add(shoeL);
        
        this.leftLeg = legGroupL;
        this.leftLeg.position.set(0.1, 0.6, 0); 
        this.mesh.add(this.leftLeg);
        
        const legGroupR = new THREE.Group();
        const pantR = new THREE.Mesh(pantGeo, pantsMat);
        pantR.position.y = -0.125;
        const shoeR = new THREE.Mesh(shoeGeo, shoeMat);
        shoeR.position.y = -0.425;
        legGroupR.add(pantR);
        legGroupR.add(shoeR);
        
        this.rightLeg = legGroupR;
        this.rightLeg.position.set(-0.1, 0.6, 0); 
        this.mesh.add(this.rightLeg);

        const indicatorGlowMat = new THREE.MeshBasicMaterial({
            color: 0x32c8ff,
            transparent: true,
            opacity: 0.22,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const indicatorCoreMat = new THREE.MeshBasicMaterial({
            color: 0xe5fbff,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });

        // Player base ring indicator (blue dashed with dark base)
        this.baseRingGroup = new THREE.Group();
        this.baseRingGroup.position.y = 0.02;
        this.mesh.add(this.baseRingGroup);

        const baseRadius = 0.45;
        const bgGeo = new THREE.CircleGeometry(baseRadius * 0.95, 32);
        const bgMat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            toneMapped: false
        });
        const bgMesh = new THREE.Mesh(bgGeo, bgMat);
        bgMesh.rotation.x = -Math.PI / 2;
        this.baseRingGroup.add(bgMesh);

        this.dashRing = new THREE.Group();
        this.baseRingGroup.add(this.dashRing);

        const segmentCount = 6;
        const dashThickness = 0.05;
        const dashArc = (Math.PI * 2 * baseRadius / segmentCount) * 0.45;
        const dashGeo = new THREE.BoxGeometry(dashArc, dashThickness, dashThickness);
        const dashMat = new THREE.MeshBasicMaterial({
            color: 0x00bfff,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });

        for (let i = 0; i < segmentCount; i++) {
            const dash = new THREE.Mesh(dashGeo, dashMat);
            dash.layers.enable(1); 
            const angle = (i / segmentCount) * Math.PI * 2;
            dash.position.set(Math.cos(angle) * baseRadius, 0.01, Math.sin(angle) * baseRadius);
            const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
            dash.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
            this.dashRing.add(dash);
        }

        this.moveIndicator = new THREE.Group();
        this.moveIndicator.position.y = 0.05;
        this.moveIndicatorGlow = new THREE.Mesh(new THREE.CircleGeometry(0.078, 20), indicatorGlowMat);
        this.moveIndicatorCore = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16), indicatorCoreMat);
        this.moveIndicatorGlow.rotation.x = -Math.PI / 2;
        this.moveIndicatorCore.rotation.x = -Math.PI / 2;
        this.moveIndicator.add(this.moveIndicatorGlow);
        this.moveIndicator.add(this.moveIndicatorCore);
        this.moveIndicatorOffset = new THREE.Vector3();
         
        this.attackTimer = 0;
        this.isAttacking = false;
        this.lastMoveDirection = null;
        this.walkPhase = 0;
        this.smokeTrailDistance = 0;
    }
    
    playAttack() { 
        this.isAttacking = true; 
        this.attackTimer = 0.2; 
    }

    updateMoveIndicator(worldPosition, inputX, inputZ, delta) {
        const input = new THREE.Vector2(inputX, inputZ);
        const magnitude = Math.min(input.length(), 1);
        if (magnitude > 0.001) input.normalize().multiplyScalar(magnitude);

        const maxOffset = 1.35 * CONFIG.playerScale;
        const targetOffset = new THREE.Vector3(input.x * maxOffset, 0, input.y * maxOffset);
        if (magnitude > 0.001) {
            this.moveIndicatorOffset.copy(targetOffset);
        } else {
            this.moveIndicatorOffset.lerp(targetOffset, 1 - Math.exp(-delta * 14));
        }
        this.moveIndicator.position.set(
            worldPosition.x + this.moveIndicatorOffset.x,
            0.05,
            worldPosition.z + this.moveIndicatorOffset.z
        );

        const alpha = 0.18 + magnitude * 0.82;
        this.moveIndicatorGlow.material.opacity = 0.08 + alpha * 0.22;
        this.moveIndicatorCore.material.opacity = 0.18 + alpha * 0.7;
        const scale = CONFIG.playerScale * (0.85 + magnitude * 0.45);
        this.moveIndicator.scale.setScalar(scale);
    }
    
    updateAnimation(delta, time, isMoving, currentVelocity) {
        if (this.isAttacking) { 
            this.attackTimer -= delta; 
            if (this.attackTimer <= 0) this.isAttacking = false; 
        }
        
        if (isMoving && currentVelocity) {
            const speedMagnitude = currentVelocity.length();
            this.walkPhase += delta * speedMagnitude * 1.5;
            this.smokeTrailDistance += speedMagnitude * delta;
            
            const legSwing = Math.sin(this.walkPhase) * 0.7 * (speedMagnitude / 10);
            
            this.leftLeg.rotation.x = legSwing; 
            this.rightLeg.rotation.x = -legSwing;
            
            this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, 0.15, delta * 15); 
            
            this.bodyGroup.position.y = 0.6 + Math.abs(Math.sin(this.walkPhase)) * 0.1 * (speedMagnitude / 10);
            this.leftArm.rotation.x = -legSwing * 0.8; 
            this.leftArm.rotation.z = 0.1;
            if (this.isAttacking) { 
                this.rightArm.rotation.x = -Math.PI * 0.7; 
                this.rightArm.rotation.z = -0.3; 
            } else { 
                this.rightArm.rotation.x = legSwing * 0.8; 
                this.rightArm.rotation.z = -0.1; 
            }

            if (Globals.particleManager && speedMagnitude > 2.5 && this.smokeTrailDistance >= 1.35 * CONFIG.playerScale) {
                const moveDir = currentVelocity.clone().normalize();
                const smokePos = this.mesh.position.clone()
                    .addScaledVector(moveDir, -0.32 * CONFIG.playerScale);
                Globals.particleManager.spawnDustPuff(smokePos, moveDir, 0.6 * CONFIG.playerScale);
                this.smokeTrailDistance = 0;
            }
        } else {
            this.walkPhase = 0;
            this.smokeTrailDistance = 0;
            const idleSpeed = 3;
            this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0, delta * 10);
            this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0, delta * 10);
            
            this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, 0, delta * 10);
            
            this.bodyGroup.position.y = 0.6 + Math.sin(time * idleSpeed) * 0.03;
            this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, delta * 10);
            this.leftArm.rotation.z = 0.1 + Math.sin(time * idleSpeed) * 0.02;
            if (this.isAttacking) { 
                this.rightArm.rotation.x = -Math.PI * 0.7; 
                this.rightArm.rotation.z = -0.3; 
            } else { 
                this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, 0, delta * 10); 
                this.rightArm.rotation.z = -0.1 - Math.sin(time * idleSpeed) * 0.02; 
            }
        }
        
        // Ensure base ring stays flat despite player rotation
        this.baseRingGroup.quaternion.copy(this.mesh.quaternion).invert();
        this.dashRing.rotation.y += delta * 1.5;
        const ringScale = 1.0 + Math.sin(time * 4) * 0.03;
        this.baseRingGroup.scale.set(ringScale, 1, ringScale);
    }
}
