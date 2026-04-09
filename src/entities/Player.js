import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Globals } from '../utils.js';

export class PlayerCharacter {
    constructor() {
        this.mesh = new THREE.Group();
        const skinMat = new THREE.MeshBasicMaterial({ color: 0xfff5e6 });
        const shirtMat = new THREE.MeshBasicMaterial({ color: 0xfff5e6 });
        const limbMat = new THREE.MeshBasicMaterial({ color: 0xfff5e6 }); // 统一颜色，消除腿部与身体的突兀分割线
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x362c28 }); 
        
        const faceMat = new THREE.MeshBasicMaterial({ color: 0xfff5e6 });
        const backMat = new THREE.MeshBasicMaterial({ color: 0xfff5e6 }); // 统一后脑勺、背部、耳朵背面的颜色
        const detailMat = new THREE.MeshBasicMaterial({ color: 0x362c28 });
        const innerEarMat = new THREE.MeshBasicMaterial({ color: 0xff9eab }); 
        
        // Let all primary player meshes write to stencil 1 to prevent X-Ray from overlapping the player itself
        const applyStencil = (mat) => {
            mat.stencilWrite = true;
            mat.stencilRef = 1;
            mat.stencilFunc = THREE.AlwaysStencilFunc;
            mat.stencilZPass = THREE.ReplaceStencilOp;
            mat.stencilZFail = THREE.KeepStencilOp;
            mat.stencilFail = THREE.KeepStencilOp;
        };
        [skinMat, shirtMat, limbMat, eyeMat, faceMat, backMat, detailMat, innerEarMat].forEach(applyStencil);

        this.bodyGroup = new THREE.Group();
        this.bodyGroup.position.y = 0.25; 
        this.mesh.add(this.bodyGroup);
        
        // Torso
        const torsoGeo = new THREE.CapsuleGeometry(0.12, 0.12, 4, 16);
        const torso = new THREE.Mesh(torsoGeo, backMat);
        torso.position.y = 0.08;
        torso.castShadow = true;
        this.bodyGroup.add(torso);
        
        // Head (Refined Cartoon Cat)
        this.headGroup = new THREE.Group();
        this.headGroup.position.y = 0.26; 

        // 1. Cranium (Top part of the head, slightly flattened)
        const craniumGeo = new THREE.SphereGeometry(0.16, 32, 32);
        const cranium = new THREE.Mesh(craniumGeo, faceMat);
        cranium.scale.set(1.2, 0.8, 1.1);
        cranium.position.set(0, 0.06, 0.02);
        this.headGroup.add(cranium);

        // 2. Back of the head (Darker color for facing direction)
        const backHeadGeo = new THREE.SphereGeometry(0.17, 32, 32);
        const backHead = new THREE.Mesh(backHeadGeo, backMat);
        backHead.scale.set(1.25, 0.85, 1.1);
        backHead.position.set(0, 0.02, -0.04);
        this.headGroup.add(backHead);

        // 3. Cheeks / Jowls (Makes the face wide at the bottom)
        const cheekGeo = new THREE.SphereGeometry(0.11, 32, 32);
        const cheekL = new THREE.Mesh(cheekGeo, faceMat);
        cheekL.scale.set(0.9, 0.75, 0.95);
        cheekL.position.set(0.09, -0.04, 0.05);
        this.headGroup.add(cheekL);
        
        const cheekR = new THREE.Mesh(cheekGeo, faceMat);
        cheekR.scale.set(0.9, 0.75, 0.95);
        cheekR.position.set(-0.09, -0.04, 0.05);
        this.headGroup.add(cheekR);

        // 4. Ears (Flattened cones with inner ear depth)
        const earGeo = new THREE.ConeGeometry(0.08, 0.18, 16);
        const innerEarGeo = new THREE.ConeGeometry(0.04, 0.12, 16);

        const earL = new THREE.Mesh(earGeo, backMat);
        earL.scale.set(1, 1, 0.5);
        earL.position.set(0.13, 0.16, -0.02);
        earL.rotation.set(-0.1, 0.15, -0.35);
        const innerEarL = new THREE.Mesh(innerEarGeo, innerEarMat);
        innerEarL.position.set(0, -0.01, 0.03);
        earL.add(innerEarL);
        this.headGroup.add(earL);

        const earR = new THREE.Mesh(earGeo, backMat);
        earR.scale.set(1, 1, 0.5);
        earR.position.set(-0.13, 0.16, -0.02);
        earR.rotation.set(-0.1, -0.15, 0.35);
        const innerEarR = new THREE.Mesh(innerEarGeo, innerEarMat);
        innerEarR.position.set(0, -0.01, 0.03);
        earR.add(innerEarR);
        this.headGroup.add(earR);

        // 5. Eyes (Big cute ovals)
        const eyeGeo = new THREE.CapsuleGeometry(0.018, 0.04, 8, 16);
        const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
        eyeL.position.set(0.09, 0.02, 0.16);
        eyeL.rotation.z = -0.1;
        const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
        eyeR.position.set(-0.09, 0.02, 0.16);
        eyeR.rotation.z = 0.1;
        this.headGroup.add(eyeL);
        this.headGroup.add(eyeR);

        // 6. Nose (Tiny triangle)
        const noseGeo = new THREE.ConeGeometry(0.02, 0.025, 3);
        const nose = new THREE.Mesh(noseGeo, innerEarMat);
        nose.position.set(0, -0.04, 0.17);
        nose.rotation.set(Math.PI / 2, Math.PI, 0);
        this.headGroup.add(nose);

        // 7. Whiskers (3 thin lines on each side)
        const whiskerGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.14, 4);
        const wL1 = new THREE.Mesh(whiskerGeo, detailMat);
        wL1.position.set(0.18, -0.02, 0.12);
        wL1.rotation.set(0, 0, Math.PI / 2 - 0.15);
        const wL2 = new THREE.Mesh(whiskerGeo, detailMat);
        wL2.position.set(0.19, -0.05, 0.12);
        wL2.rotation.set(0, 0, Math.PI / 2);
        const wL3 = new THREE.Mesh(whiskerGeo, detailMat);
        wL3.position.set(0.18, -0.08, 0.12);
        wL3.rotation.set(0, 0, Math.PI / 2 + 0.15);
        this.headGroup.add(wL1, wL2, wL3);

        const wR1 = new THREE.Mesh(whiskerGeo, detailMat);
        wR1.position.set(-0.18, -0.02, 0.12);
        wR1.rotation.set(0, 0, Math.PI / 2 + 0.15);
        const wR2 = new THREE.Mesh(whiskerGeo, detailMat);
        wR2.position.set(-0.19, -0.05, 0.12);
        wR2.rotation.set(0, 0, Math.PI / 2);
        const wR3 = new THREE.Mesh(whiskerGeo, detailMat);
        wR3.position.set(-0.18, -0.08, 0.12);
        wR3.rotation.set(0, 0, Math.PI / 2 - 0.15);
        this.headGroup.add(wR1, wR2, wR3);

        this.bodyGroup.add(this.headGroup);

        // Tail (to clearly show the back of the character)
        this.tailGroup = new THREE.Group();
        this.tailGroup.position.set(0, 0.0, -0.08); // Attached to lower back
        
        const tailGeo = new THREE.CapsuleGeometry(0.025, 0.2, 8, 16);
        this.tailMesh = new THREE.Mesh(tailGeo, backMat);
        this.tailMesh.position.set(0, 0.1, -0.1);
        this.tailMesh.rotation.x = -0.6;
        
        this.tailGroup.add(this.tailMesh);
        this.bodyGroup.add(this.tailGroup);
        
        // Arms
        const armGeo = new THREE.CapsuleGeometry(0.04, 0.12, 4, 16);
        
        this.leftArm = new THREE.Group();
        const armMeshL = new THREE.Mesh(armGeo, faceMat);
        armMeshL.position.y = -0.06; 
        armMeshL.castShadow = true;
        this.leftArm.add(armMeshL);
        this.leftArm.position.set(0.16, 0.10, 0); 
        this.bodyGroup.add(this.leftArm);
        
        this.rightArm = new THREE.Group();
        const armMeshR = new THREE.Mesh(armGeo, faceMat);
        armMeshR.position.y = -0.06;
        armMeshR.castShadow = true;
        this.rightArm.add(armMeshR);
        this.rightArm.position.set(-0.16, 0.10, 0); 
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
            color: 0x91c53a,
            transparent: true,
            opacity: 0.22,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const indicatorCoreMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
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
            color: 0x5e55a2,
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

        // Debug Collision Mesh
        const collGeo = new THREE.CylinderGeometry(1, 1, 1, 16);
        const collMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false });
        this.collisionDebugMesh = new THREE.Mesh(collGeo, collMat);
        this.collisionDebugMesh.visible = false;
        this.mesh.add(this.collisionDebugMesh);

        const segmentCount = 6;
        const dashThickness = 0.05;
        const dashArc = (Math.PI * 2 * baseRadius / segmentCount) * 0.45;
        const dashGeo = new THREE.BoxGeometry(dashArc, dashThickness, dashThickness);
        const dashMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
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
         
        // Setup X-Ray Silhouette for occlusion
        const xrayMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: 0.6,
            depthFunc: THREE.GreaterDepth,
            depthWrite: false,
            stencilWrite: true,
            stencilRef: 1,
            stencilFunc: THREE.NotEqualStencilFunc,
            stencilZPass: THREE.ReplaceStencilOp,
            stencilZFail: THREE.KeepStencilOp,
            stencilFail: THREE.KeepStencilOp
        });

        this.xrayMeshes = [];
        const applyXRay = (group) => {
            const meshes = [];
            group.traverse((child) => {
                if (child.isMesh) meshes.push(child);
            });
            meshes.forEach((mesh) => {
                const xray = new THREE.Mesh(mesh.geometry, xrayMat);
                this.xrayMeshes.push(xray);
                mesh.add(xray);
            });
        };

        applyXRay(this.bodyGroup);
        applyXRay(this.leftLeg);
        applyXRay(this.rightLeg);

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

        // 原来是 1.35，现在我们要求它在手指滑到更远时（magnitude=1.8）达到 1.0 倍身位
        // 因此最大范围 1.0 身位，发生在 magnitude=1.8 时
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
        const scale = CONFIG.playerScale * (0.65 + magnitude * 0.35); // 缩小整体尺寸的基准乘数
        this.moveIndicator.scale.setScalar(scale);
    }
    
    updateAnimation(delta, time, isMoving, currentVelocity) {
        if (this.xrayMeshes) {
            this.xrayMeshes.forEach(mesh => {
                mesh.visible = !!CONFIG.xrayEnabled;
            });
        }

        if (!CONFIG.showCollisionBox) {
            this.collisionDebugMesh.visible = false;
        } else {
            this.collisionDebugMesh.visible = true;
            if (CONFIG.useCustomCollision) {
                const r = CONFIG.customCollisionRadius;
                this.collisionDebugMesh.scale.set(r, 0.4, r);
                this.collisionDebugMesh.position.set(0, 0.2, 0); // Full cylinder centered at feet
            } else {
                const rx = 0.08 * CONFIG.playerScale;
                const rz = 0.05 * CONFIG.playerScale;
                this.collisionDebugMesh.scale.set(rx, 0.4, rz);
                this.collisionDebugMesh.position.set(0, 0.2, rz / 2); // Shifted to match the lower half logic
            }
        }

        if (this.isAttacking) { 
            this.attackTimer -= delta; 
            if (this.attackTimer <= 0) this.isAttacking = false; 
        }
        
        let speedMagnitude = 0;
        if (isMoving && currentVelocity) {
            speedMagnitude = currentVelocity.length();
            this.walkPhase += delta * speedMagnitude * 1.5;
            this.smokeTrailDistance += speedMagnitude * delta;
            
            const legSwing = Math.sin(this.walkPhase) * 0.7 * (speedMagnitude / 10);
            
            this.leftLeg.rotation.x = legSwing; 
            this.rightLeg.rotation.x = -legSwing;
            
            this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, 0.15, delta * 15); 
            
            // Tail wags when walking
            if (this.tailGroup) {
                this.tailGroup.rotation.y = Math.sin(this.walkPhase * 1.8) * 0.4;
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
            
            // Idle tail wag
            if (this.tailGroup) {
                this.tailGroup.rotation.y = Math.sin(time * 2.5) * 0.15;
            }
            
            this.bodyGroup.position.y = 0.25 + Math.sin(time * idleSpeed) * 0.03;
        }
        
        const idleSpeed2 = 3;
        const armSpeed = this.isAttacking ? 20 : (isMoving ? 8 : 10);
        
        if (isMoving) {
            const targetArmL = -Math.sin(this.walkPhase) * 0.5;
            const targetArmR = Math.sin(this.walkPhase) * 0.5;
            this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, targetArmL, delta * armSpeed);
            this.leftArm.rotation.z = THREE.MathUtils.lerp(this.leftArm.rotation.z, 0, delta * armSpeed);
            if (this.isAttacking) {
                this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, -0.8, delta * 20);
                this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, 0, delta * 20);
            } else {
                this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, targetArmR, delta * armSpeed);
                this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, 0, delta * armSpeed);
            }
        } else {
            this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, delta * armSpeed);
            this.leftArm.rotation.z = 0.1 + Math.sin(time * idleSpeed2) * 0.02;
            
            if (this.isAttacking) { 
                this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, -Math.PI * 0.7, delta * 20); 
                this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, -0.3, delta * 20); 
            } else { 
                this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, 0, delta * armSpeed); 
                this.rightArm.rotation.z = -0.1 - Math.sin(time * idleSpeed2) * 0.02; 
            }
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
