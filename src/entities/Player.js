import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Globals } from '../utils.js';

export class PlayerCharacter {
    constructor() {
        this.mesh = new THREE.Group();
        
        const bodyMat = new THREE.MeshBasicMaterial({ color: 0x91c53a });
        const darkMat = new THREE.MeshBasicMaterial({ color: 0x5e55a2 });
        const blushMat = new THREE.MeshBasicMaterial({ color: 0x7aa531 });

        this.bodyGroup = new THREE.Group();
        this.bodyGroup.position.y = 0.3; 
        this.mesh.add(this.bodyGroup);
        
        // 1. Bongo Cat Body (Squishy Dome Blob)
        const bodyGeo = new THREE.SphereGeometry(0.35, 32, 32);
        this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        this.bodyMesh.scale.set(1.2, 0.9, 1.1);
        this.bodyMesh.castShadow = true;
        this.bodyGroup.add(this.bodyMesh);

        // 2. Ears
        const earGeo = new THREE.ConeGeometry(0.08, 0.18, 16);
        const earL = new THREE.Mesh(earGeo, bodyMat);
        earL.position.set(0.22, 0.26, 0);
        earL.rotation.set(-0.1, 0, -0.3);
        this.bodyGroup.add(earL);

        const earR = new THREE.Mesh(earGeo, bodyMat);
        earR.position.set(-0.22, 0.26, 0);
        earR.rotation.set(-0.1, 0, 0.3);
        this.bodyGroup.add(earR);

        // 3. Face Details (Black dots for eyes, little W mouth)
        const eyeGeo = new THREE.SphereGeometry(0.025, 16, 16);
        const eyeL = new THREE.Mesh(eyeGeo, darkMat);
        eyeL.position.set(0.14, 0.08, 0.36);
        const eyeR = new THREE.Mesh(eyeGeo, darkMat);
        eyeR.position.set(-0.14, 0.08, 0.36);
        this.bodyGroup.add(eyeL, eyeR);

        // Mouth (Made of two tiny tilted capsules to form a cute '3' or 'w')
        const mouthGeo = new THREE.CapsuleGeometry(0.008, 0.03, 4, 8);
        const mouth1 = new THREE.Mesh(mouthGeo, darkMat);
        mouth1.position.set(0.015, 0.02, 0.38);
        mouth1.rotation.set(0, 0, -1.0);
        const mouth2 = new THREE.Mesh(mouthGeo, darkMat);
        mouth2.position.set(-0.015, 0.02, 0.38);
        mouth2.rotation.set(0, 0, 1.0);
        this.bodyGroup.add(mouth1, mouth2);

        // Blush (Cute rosy cheeks)
        const blushGeo = new THREE.SphereGeometry(0.035, 16, 16);
        const blushL = new THREE.Mesh(blushGeo, blushMat);
        blushL.position.set(0.24, 0.04, 0.30);
        blushL.scale.set(1.5, 0.8, 1);
        const blushR = new THREE.Mesh(blushGeo, blushMat);
        blushR.position.set(-0.24, 0.04, 0.30);
        blushR.scale.set(1.5, 0.8, 1);
        this.bodyGroup.add(blushL, blushR);

        // 4. Bongo Paws (Floating beans in front)
        const pawGeo = new THREE.CapsuleGeometry(0.06, 0.12, 8, 8);
        this.leftArm = new THREE.Mesh(pawGeo, bodyMat);
        this.leftArm.position.set(0.22, -0.05, 0.35);
        this.leftArm.rotation.x = Math.PI / 2;

        this.rightArm = new THREE.Mesh(pawGeo, bodyMat);
        this.rightArm.position.set(-0.22, -0.05, 0.35);
        this.rightArm.rotation.x = Math.PI / 2;

        this.bodyGroup.add(this.leftArm, this.rightArm);

        // 5. Tiny Legs (Hidden underneath, purely for technical logic preservation if needed)
        const legGeo = new THREE.CapsuleGeometry(0.05, 0.08, 8, 8);
        this.leftLeg = new THREE.Mesh(legGeo, bodyMat);
        this.leftLeg.position.set(0.15, -0.22, 0);
        this.rightLeg = new THREE.Mesh(legGeo, bodyMat);
        this.rightLeg.position.set(-0.15, -0.22, 0);
        this.bodyGroup.add(this.leftLeg, this.rightLeg);

        // 6. Tiny Nub Tail
        const tailGeo = new THREE.CapsuleGeometry(0.04, 0.12, 8, 8);
        this.tailGroup = new THREE.Group();
        this.tailGroup.position.set(0, -0.15, -0.35);
        this.tailMesh = new THREE.Mesh(tailGeo, bodyMat);
        this.tailMesh.position.set(0, 0.08, -0.05);
        this.tailMesh.rotation.x = -0.5;
        this.tailGroup.add(this.tailMesh);
        this.bodyGroup.add(this.tailGroup);

        // Indicator Rings
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x5e55a2, transparent: true, opacity: 0.6 });
        this.baseRingGroup = new THREE.Group();
        this.baseRingGroup.position.y = -0.28;
        
        const outerRing = new THREE.Mesh(new THREE.RingGeometry(0.48, 0.52, 32), ringMat);
        outerRing.rotation.x = -Math.PI / 2;
        this.baseRingGroup.add(outerRing);
        
        this.dashRing = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.42, 32, 1, 0, Math.PI * 0.4), ringMat);
        this.dashRing.rotation.x = -Math.PI / 2;
        this.baseRingGroup.add(this.dashRing);
        
        this.mesh.add(this.baseRingGroup);

        // Move indicator
        const indicatorGlowMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false
        });
        const indicatorCoreMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a, transparent: true, opacity: 0.4, depthWrite: false
        });
        
        this.moveIndicator = new THREE.Group();
        this.moveIndicator.position.y = 0.05;
        this.moveIndicatorGlow = new THREE.Mesh(new THREE.CircleGeometry(0.078, 20), indicatorGlowMat);
        this.moveIndicatorCore = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16), indicatorCoreMat);
        this.moveIndicatorGlow.rotation.x = -Math.PI / 2;
        this.moveIndicatorCore.rotation.x = -Math.PI / 2;
        this.moveIndicator.add(this.moveIndicatorGlow, this.moveIndicatorCore);
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
        const inputMag = input.length();
        const magnitude = Math.min(inputMag, 1.8);
        if (magnitude > 0.001) input.normalize().multiplyScalar(magnitude);

        const maxOffsetBase = 1.0 / 1.8 * CONFIG.playerScale; 
        const targetOffset = new THREE.Vector3(input.x * maxOffsetBase, 0, input.y * maxOffsetBase);
        
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
        const scale = CONFIG.playerScale * (0.65 + magnitude * 0.35);
        this.moveIndicator.scale.setScalar(scale);
    }
    
    updateAnimation(delta, time, isMoving, currentVelocity) {
        if (this.isAttacking) { 
            this.attackTimer -= delta; 
            if (this.attackTimer <= 0) this.isAttacking = false; 
        }
        
        let speedMagnitude = 0;
        if (isMoving && currentVelocity) {
            speedMagnitude = currentVelocity.length();
            this.walkPhase += delta * speedMagnitude * 1.5;
            this.smokeTrailDistance += speedMagnitude * delta;
            
            // Leg scurry (mostly hidden but kept for logic)
            const legSwing = Math.sin(this.walkPhase * 2) * 0.4;
            this.leftLeg.rotation.x = legSwing; 
            this.rightLeg.rotation.x = -legSwing;
            
            // Juicy Squash & Stretch bounce when moving
            const bounce = Math.abs(Math.sin(this.walkPhase * 1.5));
            const squashY = 1.0 - bounce * 0.15;
            const stretchXZ = 1.0 + bounce * 0.08;
            this.bodyMesh.scale.set(1.2 * stretchXZ, 0.9 * squashY, 1.1 * stretchXZ);
            this.bodyGroup.position.y = 0.3 + bounce * 0.05;

            // Tail wag when running
            this.tailGroup.rotation.y = Math.sin(this.walkPhase * 2) * 0.5;

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
            
            // Idle breathing (gentle squash and stretch)
            const breath = Math.sin(time * 3);
            this.bodyMesh.scale.set(1.2 + breath * 0.02, 0.9 - breath * 0.03, 1.1 + breath * 0.02);
            this.bodyGroup.position.y = 0.3;

            this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0, delta * 10);
            this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0, delta * 10);
            
            // Idle tail wag
            this.tailGroup.rotation.y = Math.sin(time * 2.5) * 0.15;
        }
        
        // Bongo Paws Animation!
        const armSpeed = this.isAttacking ? 25 : (isMoving ? 15 : 8);
        
        if (this.isAttacking) {
            // Rapid bongo slap down (Right paw slams)
            this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, Math.PI / 2 + 0.8, delta * armSpeed);
            this.rightArm.position.y = THREE.MathUtils.lerp(this.rightArm.position.y, 0.05, delta * armSpeed);
            
            // Left paw rests or goes slightly up
            this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, Math.PI / 2 - 0.2, delta * armSpeed);
            this.leftArm.position.y = THREE.MathUtils.lerp(this.leftArm.position.y, -0.05, delta * armSpeed);
        } else if (isMoving) {
            // Alternating bongo taps while running (left, right, left, right)
            const tapL = Math.sin(this.walkPhase * 2) > 0 ? 0.6 : 0;
            const tapR = Math.sin(this.walkPhase * 2 + Math.PI) > 0 ? 0.6 : 0;
            
            this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, Math.PI / 2 + tapL, delta * armSpeed);
            this.leftArm.position.y = THREE.MathUtils.lerp(this.leftArm.position.y, -0.05 + tapL * 0.1, delta * armSpeed);
            
            this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, Math.PI / 2 + tapR, delta * armSpeed);
            this.rightArm.position.y = THREE.MathUtils.lerp(this.rightArm.position.y, -0.05 + tapR * 0.1, delta * armSpeed);
        } else {
            // Idle paws gently resting on the invisible "table"
            const breatheArms = Math.sin(time * 3) * 0.02;
            this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, Math.PI / 2, delta * armSpeed);
            this.leftArm.position.y = THREE.MathUtils.lerp(this.leftArm.position.y, -0.05 + breatheArms, delta * armSpeed);
            
            this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, Math.PI / 2, delta * armSpeed);
            this.rightArm.position.y = THREE.MathUtils.lerp(this.rightArm.position.y, -0.05 + breatheArms, delta * armSpeed);
        }
        
        // Ensure base ring stays flat despite player rotation
        if (this.baseRingGroup) {
            this.baseRingGroup.quaternion.copy(this.mesh.quaternion).invert();
            if (this.dashRing) this.dashRing.rotation.y += delta * 1.5;
            const ringScale = 1.0 + Math.sin(time * 4) * 0.03;
            this.baseRingGroup.scale.set(ringScale, 1, ringScale);
        }
    }
}
