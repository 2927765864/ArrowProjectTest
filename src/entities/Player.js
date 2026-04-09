import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Globals } from '../utils.js';

export class PlayerCharacter {
    constructor() {
        this.mesh = new THREE.Group();
        const skinMat = new THREE.MeshStandardMaterial({ color: 0xffe0bd, roughness: 0.6 });
        const shirtMat = new THREE.MeshStandardMaterial({ color: 0x44aaff, roughness: 0.8 }); 
        const limbMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 }); 
        
        this.bodyGroup = new THREE.Group();
        this.bodyGroup.position.y = 0.25; 
        this.mesh.add(this.bodyGroup);
        
        // Torso
        const torsoGeo = new THREE.CapsuleGeometry(0.12, 0.12, 4, 16);
        const torso = new THREE.Mesh(torsoGeo, shirtMat);
        torso.position.y = 0.08;
        torso.castShadow = true;
        this.bodyGroup.add(torso);
        
        // Head
        this.headGroup = new THREE.Group();
        this.headGroup.position.y = 0.30; 
        const headGeo = new THREE.SphereGeometry(0.22, 32, 32);
        const head = new THREE.Mesh(headGeo, skinMat);
        head.castShadow = true;
        this.headGroup.add(head);

        // Eyes
        const eyeGeo = new THREE.SphereGeometry(0.025, 16, 16);
        const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
        eyeL.position.set(0.08, 0.05, 0.2);
        const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
        eyeR.position.set(-0.08, 0.05, 0.2);
        this.headGroup.add(eyeL);
        this.headGroup.add(eyeR);
        
        // Hat (Red Baseball Cap)
        const hatMat = new THREE.MeshStandardMaterial({ color: 0xcc1111, roughness: 0.7 });
        
        const hatDomeGeo = new THREE.SphereGeometry(0.225, 32, 16, 0, Math.PI * 2, 0, Math.PI / 1.8);
        const hatDome = new THREE.Mesh(hatDomeGeo, hatMat);
        hatDome.position.y = 0.03;
        hatDome.castShadow = true;
        this.headGroup.add(hatDome);

        const brimGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.02, 32);
        const hatBrim = new THREE.Mesh(brimGeo, hatMat);
        hatBrim.scale.z = 0.65; 
        hatBrim.position.set(0, 0.03, 0.22);
        hatBrim.rotation.x = -0.12; 
        hatBrim.castShadow = true;
        this.headGroup.add(hatBrim);

        this.bodyGroup.add(this.headGroup);
        
        // Arms
        const armGeo = new THREE.CapsuleGeometry(0.04, 0.12, 4, 16);
        
        this.leftArm = new THREE.Group();
        const armMeshL = new THREE.Mesh(armGeo, skinMat);
        armMeshL.position.y = -0.06; 
        armMeshL.castShadow = true;
        this.leftArm.add(armMeshL);
        this.leftArm.position.set(0.18, 0.18, 0); 
        this.bodyGroup.add(this.leftArm);
        
        this.rightArm = new THREE.Group();
        const armMeshR = new THREE.Mesh(armGeo, skinMat);
        armMeshR.position.y = -0.06;
        armMeshR.castShadow = true;
        this.rightArm.add(armMeshR);
        this.rightArm.position.set(-0.18, 0.18, 0); 
        this.bodyGroup.add(this.rightArm);
        
        // Legs
        const legGeo = new THREE.CapsuleGeometry(0.05, 0.12, 4, 16);
        
        this.leftLeg = new THREE.Group();
        const legMeshL = new THREE.Mesh(legGeo, limbMat);
        legMeshL.position.y = -0.08;
        legMeshL.castShadow = true;
        this.leftLeg.add(legMeshL);
        this.leftLeg.position.set(0.07, 0.15, 0); 
        this.mesh.add(this.leftLeg);
        
        this.rightLeg = new THREE.Group();
        const legMeshR = new THREE.Mesh(legGeo, limbMat);
        legMeshR.position.y = -0.08;
        legMeshR.castShadow = true;
        this.rightLeg.add(legMeshR);
        this.rightLeg.position.set(-0.07, 0.15, 0); 
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
        const inputMag = input.length();
        const magnitude = Math.min(inputMag, 1.8); // 允许最大延伸力度 1.8
        if (magnitude > 0.001) input.normalize().multiplyScalar(magnitude);

        // 原来是 1.35，现在我们要求它在全速移动时（magnitude=1）达到某个范围
        // 然后在手指滑到更远时（magnitude=1.8）达到 1.5 倍身位
        // 因此最大范围 1.5 身位，发生在 magnitude=1.8 时
        // 当 magnitude=1 时，大概是 1.5 / 1.8 = 0.83 身位，更紧凑
        const maxOffsetBase = 1.5 / 1.8 * CONFIG.playerScale; 
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
            
            this.bodyGroup.position.y = 0.25 + Math.abs(Math.sin(this.walkPhase)) * 0.1 * (speedMagnitude / 10);
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
            
            this.bodyGroup.position.y = 0.25 + Math.sin(time * idleSpeed) * 0.03;
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
