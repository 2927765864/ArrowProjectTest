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
        
        const applyStencilAndOrder = (mat) => {
            mat.stencilWrite = true;
            mat.stencilRef = 1;
            mat.stencilFunc = THREE.AlwaysStencilFunc;
            mat.stencilZPass = THREE.ReplaceStencilOp;
            mat.stencilZFail = THREE.KeepStencilOp;
            mat.stencilFail = THREE.KeepStencilOp;
        };
        [skinMat, shirtMat, limbMat, eyeMat, faceMat, backMat, detailMat, innerEarMat].forEach(applyStencilAndOrder);

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
        const earGeo = new THREE.ConeGeometry(0.112, 0.252, 16);
        const innerEarGeo = new THREE.ConeGeometry(0.056, 0.168, 16);

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
        const eyeGeo = new THREE.CapsuleGeometry(0.025, 0.056, 8, 16);
        const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
        eyeL.position.set(0.09, 0.02, 0.16);
        eyeL.rotation.z = -0.1;
        const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
        eyeR.position.set(-0.09, 0.02, 0.16);
        eyeR.rotation.z = 0.1;
        this.headGroup.add(eyeL);
        this.headGroup.add(eyeR);

        // 6. Nose (Tiny triangle)
        const noseGeo = new THREE.ConeGeometry(0.028, 0.035, 3);
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

        // --- NEW PROCEDURAL IK TAIL ---
        this.tailWorldGroup = new THREE.Group();
        this.tailPoints = [];
        this.tailMeshes = [];
        this.numTailSegments = 6;
        this.tailSegLength = CONFIG.tailSegLength !== undefined ? CONFIG.tailSegLength : 0.07; // Length between joints
        this.currentTailRadius = CONFIG.tailRadius !== undefined ? CONFIG.tailRadius : 0.04;
        
        // Initialize position history points
        for (let i = 0; i <= this.numTailSegments; i++) {
            this.tailPoints.push(new THREE.Vector3());
        }
        
        for (let i = 0; i < this.numTailSegments; i++) {
            // Keep thickness perfectly uniform across all segments
            const radius = this.currentTailRadius; 
            // The capsule's cylindrical part will be segLength long, ends capped by spheres of `radius`
            const geo = new THREE.CapsuleGeometry(radius, this.tailSegLength, 8, 8);
            geo.rotateX(Math.PI / 2); // Align along Z axis for lookAt
            const mesh = new THREE.Mesh(geo, backMat);
            this.tailMeshes.push(mesh);
            this.tailWorldGroup.add(mesh);
        }
        this.tailInitialized = false;
        // ------------------------------
        
        // Arms
        this.leftArm = new THREE.Group();
        this.leftArm.position.set(0.105, 0.10, 0); // Moved inward from 0.16 to embed into torso
        this.bodyGroup.add(this.leftArm);

        // Left Upper Arm
        const upperArmGeoL = new THREE.CapsuleGeometry(0.045, 0.07, 4, 16); // Slightly thicker & longer
        const upperArmMeshL = new THREE.Mesh(upperArmGeoL, faceMat);
        upperArmMeshL.position.y = -0.035;
        upperArmMeshL.castShadow = true;
        this.leftArm.add(upperArmMeshL);
        
        // Left Shoulder Joint
        const shoulderJointGeo = new THREE.SphereGeometry(0.045, 16, 16);
        const shoulderJointL = new THREE.Mesh(shoulderJointGeo, faceMat);
        this.leftArm.add(shoulderJointL);

        // Left Forearm (Elbow joint)
        this.leftForearm = new THREE.Group();
        this.leftForearm.position.set(0, -0.07, 0); 
        this.leftArm.add(this.leftForearm);

        // Left Lower Arm
        const lowerArmGeoL = new THREE.CapsuleGeometry(0.045, 0.07, 4, 16);
        const lowerArmMeshL = new THREE.Mesh(lowerArmGeoL, faceMat);
        lowerArmMeshL.position.y = -0.035;
        lowerArmMeshL.castShadow = true;
        this.leftForearm.add(lowerArmMeshL);
        
        // Left Elbow Joint
        const elbowJointL = new THREE.Mesh(shoulderJointGeo, faceMat);
        this.leftForearm.add(elbowJointL);

        this.rightArm = new THREE.Group();
        this.rightArm.position.set(-0.105, 0.10, 0); 
        this.bodyGroup.add(this.rightArm);

        // Upper arm
        const upperArmGeo = new THREE.CapsuleGeometry(0.045, 0.07, 4, 16);
        const upperArmMesh = new THREE.Mesh(upperArmGeo, faceMat);
        upperArmMesh.position.y = -0.035;
        upperArmMesh.castShadow = true;
        this.rightArm.add(upperArmMesh);
        
        // Right Shoulder Joint
        const shoulderJointR = new THREE.Mesh(shoulderJointGeo, faceMat);
        this.rightArm.add(shoulderJointR);

        // Forearm (Elbow joint)
        this.rightForearm = new THREE.Group();
        this.rightForearm.position.set(0, -0.07, 0); 
        this.rightArm.add(this.rightForearm);

        // Lower arm
        const lowerArmGeo = new THREE.CapsuleGeometry(0.045, 0.07, 4, 16);
        const lowerArmMesh = new THREE.Mesh(lowerArmGeo, faceMat);
        lowerArmMesh.position.y = -0.035;
        lowerArmMesh.castShadow = true;
        this.rightForearm.add(lowerArmMesh);
        
        // Right Elbow Joint
        const elbowJointR = new THREE.Mesh(shoulderJointGeo, faceMat);
        this.rightForearm.add(elbowJointR);

        // Weapon Mesh (Spear)
        this.weaponGroup = new THREE.Group();
        const spearMat = new THREE.MeshBasicMaterial({ color: 0x91c53a });
        const shaftGeo = new THREE.CylinderGeometry(0.12, 0.0, 7.0, 16, 128);
        const posAttribute = shaftGeo.attributes.position;
        for (let i = 0; i < posAttribute.count; i++) {
            let x = posAttribute.getX(i); let y = posAttribute.getY(i); let z = posAttribute.getZ(i);
            z *= 0.25;
            const ht = (3.5 - y) / 7.0;
            const twistAngle = ht * Math.PI * 2 * 28;
            const nx = x * Math.cos(twistAngle) - z * Math.sin(twistAngle);
            const nz = x * Math.sin(twistAngle) + z * Math.cos(twistAngle);
            posAttribute.setXYZ(i, nx, y, nz);
        }
        shaftGeo.computeVertexNormals();
        const shaft = new THREE.Mesh(shaftGeo, spearMat);
        shaft.position.y = -3.5;
        this.weaponGroup.add(shaft);

        const ptsR = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0.3, 0.5, 0),
            new THREE.Vector3(0.14, 0.8, 0),
            new THREE.Vector3(0.28, 1.2, 0),
            new THREE.Vector3(0.015, 6.0, 0)
        ];
        const widths = [0.12, 0.1, 0.1, 0.08, 0.01];
        const buildProng = (points, side) => {
            const group = new THREE.Group();
            const sign = side === 'left' ? -1 : 1;
            for(let i = 0; i < points.length; i++) {
                const p = points[i].clone(); p.x *= sign;
                const jointGeo = new THREE.SphereGeometry(widths[i], 16, 16);
                const joint = new THREE.Mesh(jointGeo, spearMat);
                joint.position.copy(p); joint.scale.z = 0.3; group.add(joint);
                if (i < points.length - 1) {
                    const pNext = points[i+1].clone(); pNext.x *= sign;
                    const dist = p.distanceTo(pNext);
                    const segGeo = new THREE.CylinderGeometry(widths[i+1], widths[i], dist, 16);
                    const seg = new THREE.Mesh(segGeo, spearMat);
                    const dir = new THREE.Vector3().subVectors(pNext, p).normalize();
                    seg.position.copy(p).add(pNext).multiplyScalar(0.5);
                    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
                    seg.scale.z = 0.3; group.add(seg);
                }
            }
            return group;
        };
        this.weaponGroup.add(buildProng(ptsR, 'right'));
        this.weaponGroup.add(buildProng(ptsR, 'left'));
        
        this.weaponGroup.scale.setScalar(0.08); // Reduced size
        this.weaponGroup.position.set(0, -0.03, 0.1); // Attached slightly lower on forearm
        this.weaponGroup.rotation.set(Math.PI / 2 + 0.3, 0, 0); 
        this.rightForearm.add(this.weaponGroup);
        
        // Also attach a weapon on the back for "sheathed" state (used during catch animation)
        this.weaponBackGroup = this.weaponGroup.clone();
        this.weaponBackGroup.scale.setScalar(0.08); // Reduced size
        this.weaponBackGroup.position.set(0, 0.0, -0.16); // Move to lower back, push out slightly
        this.weaponBackGroup.rotation.set(Math.PI / 2, 0, Math.PI / 4); // Slung flat across the back
        this.weaponBackGroup.visible = false;
        this.bodyGroup.add(this.weaponBackGroup);

        // 3 tiny weapons as pendants on the waist
        this.backWeapons = [];
        for (let i = 0; i < 3; i++) {
            const backWeapon = this.weaponGroup.clone();
            backWeapon.scale.setScalar(0.035); // Small pendant size
            const offsetX = (i - 1) * 0.08; // Spread out horizontally
            backWeapon.position.set(offsetX, -0.02, -0.14); // Lower back/waist level
            // Pointing downwards, flat against the back, slightly fanned out
            backWeapon.rotation.set(Math.PI - 0.15, 0, -offsetX * 3);
            this.bodyGroup.add(backWeapon);
            this.backWeapons.push(backWeapon);
        }

        this.catchTimer = 0;
        this.isCatching = false;
        
        // Legs
        this.leftLeg = new THREE.Group();
        this.leftLeg.position.set(0.055, -0.05, 0); // Moved inward and slightly up to embed in torso
        this.bodyGroup.add(this.leftLeg);

        // Left Upper Leg (Thigh)
        const upperLegGeo = new THREE.CapsuleGeometry(0.05, 0.08, 4, 16); // Slightly longer to compensate for higher pivot
        const upperLegMeshL = new THREE.Mesh(upperLegGeo, limbMat);
        upperLegMeshL.position.y = -0.04;
        upperLegMeshL.castShadow = true;
        this.leftLeg.add(upperLegMeshL);
        
        // Left Hip Joint
        const hipJointGeo = new THREE.SphereGeometry(0.05, 16, 16);
        const hipJointL = new THREE.Mesh(hipJointGeo, limbMat);
        this.leftLeg.add(hipJointL);

        // Left Lower Leg (Calf + Knee)
        this.leftLowerLeg = new THREE.Group();
        this.leftLowerLeg.position.set(0, -0.08, 0);
        this.leftLeg.add(this.leftLowerLeg);

        const lowerLegGeo = new THREE.CapsuleGeometry(0.05, 0.08, 4, 16);
        const lowerLegMeshL = new THREE.Mesh(lowerLegGeo, limbMat);
        lowerLegMeshL.position.y = -0.04;
        lowerLegMeshL.castShadow = true;
        this.leftLowerLeg.add(lowerLegMeshL);
        
        // Left Knee Joint
        const kneeJointL = new THREE.Mesh(hipJointGeo, limbMat);
        this.leftLowerLeg.add(kneeJointL);
        
        this.rightLeg = new THREE.Group();
        this.rightLeg.position.set(-0.055, -0.05, 0); 
        this.bodyGroup.add(this.rightLeg);

        // Right Upper Leg (Thigh)
        const upperLegMeshR = new THREE.Mesh(upperLegGeo, limbMat);
        upperLegMeshR.position.y = -0.04;
        upperLegMeshR.castShadow = true;
        this.rightLeg.add(upperLegMeshR);
        
        // Right Hip Joint
        const hipJointR = new THREE.Mesh(hipJointGeo, limbMat);
        this.rightLeg.add(hipJointR);

        // Right Lower Leg (Calf + Knee)
        this.rightLowerLeg = new THREE.Group();
        this.rightLowerLeg.position.set(0, -0.08, 0);
        this.rightLeg.add(this.rightLowerLeg);

        const lowerLegMeshR = new THREE.Mesh(lowerLegGeo, limbMat);
        lowerLegMeshR.position.y = -0.04;
        lowerLegMeshR.castShadow = true;
        this.rightLowerLeg.add(lowerLegMeshR);
        
        // Right Knee Joint
        const kneeJointR = new THREE.Mesh(hipJointGeo, limbMat);
        this.rightLowerLeg.add(kneeJointR);

        // Player Blob Shadow
        const shadowGeo = new THREE.CircleGeometry(0.22, 32);
        const shadowMat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            toneMapped: false
        });
        this.shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
        this.shadowMesh.rotation.x = -Math.PI / 2;
        this.shadowMesh.position.y = 0.01; // Slightly above ground to prevent z-fighting
        this.mesh.add(this.shadowMesh);

        const indicatorGlowMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: 0.80,
            blending: THREE.NormalBlending,
            depthWrite: false,
            depthTest: false,
            toneMapped: false
        });
        const indicatorCoreMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: 1.0,
            blending: THREE.NormalBlending,
            depthWrite: false,
            depthTest: false,
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
        this.moveIndicatorGlow.renderOrder = 999;
        this.moveIndicatorCore.renderOrder = 999;
        this.moveIndicator.add(this.moveIndicatorGlow);
        this.moveIndicator.add(this.moveIndicatorCore);
        this.moveIndicatorOffset = new THREE.Vector3();

        // ------------------ COMPLETELY NEW X-RAY IMPLEMENTATION ------------------
        this.xrayMeshes = [];
        const xrayMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true, // Transparent queue so it renders after opaques
            opacity: 1.0, // Solid color to prevent internal overlap patches
            depthTest: false, // Force draw over walls
            depthWrite: false, // Do not mess up depth for subsequent passes
            // To prevent multiple X-Ray meshes (like Arm and Torso) from overlapping EACH OTHER
            // and causing Z-fighting artifacts, we let the FIRST X-Ray mesh that draws write to the stencil.
            // Subsequent X-Ray meshes will see Stencil = 1 and abort!
            stencilWrite: true,
            stencilRef: 1,
            stencilFunc: THREE.NotEqualStencilFunc, // Draw ONLY if stencil is not 1
            stencilZPass: THREE.ReplaceStencilOp, // Set stencil to 1 so no other X-Ray overlaps us!
            stencilZFail: THREE.ReplaceStencilOp, // Same here, though depthTest=false so Z always passes
            stencilFail: THREE.KeepStencilOp
        });

        const setupXRay = (group) => {
            const originalMeshes = [];
            group.traverse(child => {
                if (child.isMesh && child !== this.collisionDebugMesh) {
                    originalMeshes.push(child);
                }
            });
            originalMeshes.forEach(mesh => {
                mesh.renderOrder = 1; 
                const xray = new THREE.Mesh(mesh.geometry, xrayMat);
                xray.renderOrder = 2; 
                xray.userData.isXray = true; // Crucial: tell main.js to hide this during Bloom/Outline!
                this.xrayMeshes.push(xray);
                mesh.add(xray);
            });
        };

        setupXRay(this.bodyGroup);
        setupXRay(this.leftLeg);
        setupXRay(this.leftLowerLeg);
        setupXRay(this.rightLeg);
        setupXRay(this.rightLowerLeg);
        setupXRay(this.leftArm);
        setupXRay(this.leftForearm);
        setupXRay(this.rightArm);
        setupXRay(this.rightForearm);
        // --------------------------------------------------------------------------

        // Trajectory feature
        this.trajectoryPoints = []; 
        this.trajectoryLineGeo = new THREE.BufferGeometry();
        this.trajectoryLineMat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 });
        this.trajectoryLine = new THREE.Line(this.trajectoryLineGeo, this.trajectoryLineMat);
        // Added to scene in main.js or here conditionally if scene exists
        if (Globals.scene) Globals.scene.add(this.trajectoryLine);

        this.attackTimer = 0;
        this.isAttacking = false;
        this.attackPhase = 'none'; // 'windup', 'recover'
        this.windupDuration = 0.1;
        this.recoverDuration = 0.2;
        this.lastMoveDirection = null;
        this.walkPhase = 0;
        this.smokeTrailDistance = 0;
    }
    
    playAttack(windupDuration = 0.1, recoverDuration = 0.2, isSpecial = false) { 
        this.isAttacking = true; 
        this.attackPhase = 'windup';
        this.attackTimer = windupDuration;
        this.windupDuration = windupDuration;
        this.recoverDuration = recoverDuration;
        this.isSpecialAttack = isSpecial;
    }

    playCatch() {
        this.isCatching = true;
        this.catchTimer = 0.3; // Make it a snappy 0.3s reaction
        // Store initial position slightly up and rotated back for recoil effect
        if (this.bodyGroup) {
            this.bodyGroup.position.y += 0.05; // tiny hop
            this.bodyGroup.rotation.x = -0.15; // lean back slightly
        }
    }

    updateMoveIndicator(worldPosition, inputX, inputZ, delta) {
        const input = new THREE.Vector2(inputX, inputZ);
        const inputMag = input.length();
        const magnitude = Math.min(inputMag, CONFIG.indicatorMaxInput); // 允许最大延伸力度
        if (magnitude > 0.001) input.normalize().multiplyScalar(magnitude);

        // 我们要求它在手指滑到更远时（magnitude=CONFIG.indicatorMaxInput）达到 CONFIG.indicatorMaxRange 倍身位
        const maxOffsetBase = CONFIG.indicatorMaxRange / CONFIG.indicatorMaxInput * CONFIG.playerScale; 
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

        // Fixed opacity and scale regardless of distance
        this.moveIndicatorGlow.material.opacity = 0.80;
        this.moveIndicatorCore.material.opacity = 1.0;
        const scale = CONFIG.playerScale; // Use player scale directly
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
            if (this.attackTimer <= 0) {
                if (this.attackPhase === 'windup') {
                    this.attackPhase = 'recover';
                    this.attackTimer = this.recoverDuration;
                    // Provide a callback or let main.js poll for this phase change
                } else {
                    this.isAttacking = false; 
                    this.attackPhase = 'none';
                }
            }
        } 
        
        let speedMagnitude = 0;
        let isSharpTurning = false;
        let wp = this.walkPhase;

        if (isMoving && currentVelocity) {
            speedMagnitude = currentVelocity.length();
            
            // 为了实现在原地“单点触发移动动画”，当速度极小时，强制给予一个虚拟的动画速度
            let animSpeed = speedMagnitude;
            if (animSpeed < 0.1) {
                animSpeed = 8.0; 
            }
            
            // 检查是否正在进行大幅度转身（比较当前的物理速度方向与摇杆的意图方向）
            if (this.lastMoveDirection && this.lastMoveDirection.lengthSq() > 0 && speedMagnitude > 0.1) {
                const currentDir = currentVelocity.clone().normalize();
                const intendedDir = this.lastMoveDirection.clone().normalize();
                const dot = currentDir.dot(intendedDir);
                
                // 如果实际运动方向和摇杆意图方向夹角大于 60 度 (dot < 0.5)，说明处于大幅度转弯或急停反转滑动阶段
                if (dot < 0.5) {
                    isSharpTurning = true;
                }
            }

            // 只有在非大幅度转身时才推进步伐相位，防止转身时抽搐
            if (!isSharpTurning) {
                const stepFreq = CONFIG.runStepFreq !== undefined ? CONFIG.runStepFreq : 1.5;
                this.walkPhase += delta * animSpeed * stepFreq;
            }
            this.smokeTrailDistance += speedMagnitude * delta;
            
            const burst = CONFIG.runBurst !== undefined ? CONFIG.runBurst : 0.2;
            wp = this.walkPhase + burst * Math.sin(this.walkPhase * 2.0);
            
            const legSwingAmplitude = CONFIG.runLegSwing !== undefined ? CONFIG.runLegSwing : 0.7;
            const legSwing = Math.sin(wp) * legSwingAmplitude * (animSpeed / 10);
            
            this.leftLeg.rotation.x = legSwing; 
            this.rightLeg.rotation.x = -legSwing;
            
            // Add natural knee bending when walking
            this.leftLowerLeg.rotation.x = Math.max(0, -legSwing * 1.5);
            this.rightLowerLeg.rotation.x = Math.max(0, legSwing * 1.5);
            
            let targetBodyRotX = 0.15;
            let targetBodyRotY = 0; // New Y-axis torso rotation
            if (this.isAttacking) {
                const leanBackX = this.isSpecialAttack ? -0.5 : -0.3;
                const twistBackY = this.isSpecialAttack ? -1.0 : -0.6;
                const throwForwardX = this.isSpecialAttack ? 0.7 : 0.5;
                const throwTwistY = this.isSpecialAttack ? 0.6 : 0.4;

                if (this.attackPhase === 'windup') {
                    const progress = 1 - (this.attackTimer / this.windupDuration); // 0 to 1
                    targetBodyRotX = THREE.MathUtils.lerp(0.15, leanBackX, progress); // Lean back more
                    targetBodyRotY = THREE.MathUtils.lerp(0, twistBackY, progress); // Twist right side back
                } else if (this.attackPhase === 'recover') {
                    const progress = 1 - (this.attackTimer / this.recoverDuration); // 0 to 1
                    if (progress < 0.3) {
                        // Snap forward (throw)
                        targetBodyRotX = THREE.MathUtils.lerp(leanBackX, throwForwardX, progress / 0.3);
                        targetBodyRotY = THREE.MathUtils.lerp(twistBackY, throwTwistY, progress / 0.3); // Follow through twist
                    } else {
                        // Recover to normal
                        targetBodyRotX = THREE.MathUtils.lerp(throwForwardX, 0.15, (progress - 0.3) / 0.7);
                        targetBodyRotY = THREE.MathUtils.lerp(throwTwistY, 0, (progress - 0.3) / 0.7);
                    }
                }
            }
            if (!this.isAttacking) {
                const upShake = CONFIG.runBodyUpShake !== undefined ? CONFIG.runBodyUpShake : 0.15;
                const swayAmount = CONFIG.runBodySway !== undefined ? CONFIG.runBodySway : 0.15;
                const twistAmount = CONFIG.runBodyTwist !== undefined ? CONFIG.runBodyTwist : 0.15;
                
                targetBodyRotX -= Math.abs(Math.sin(wp)) * upShake;
                targetBodyRotY += Math.sin(wp) * twistAmount;
                const bodySwayZ = Math.sin(wp) * swayAmount;
                this.bodyGroup.rotation.z = THREE.MathUtils.lerp(this.bodyGroup.rotation.z, bodySwayZ, delta * 15);
            } else {
                const bodySwayZ = -Math.sin(wp) * 0.15;
                this.bodyGroup.rotation.z = THREE.MathUtils.lerp(this.bodyGroup.rotation.z, bodySwayZ, delta * 15);
            }
            
            this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, targetBodyRotX, delta * 20); 
            this.bodyGroup.rotation.y = THREE.MathUtils.lerp(this.bodyGroup.rotation.y, targetBodyRotY, delta * 20);
            
            // 大幅增强弹跳感：增加 bounce 的振幅。
            // 当进行大幅度转身时，强行将 bounce 压低至 0，使其贴近地面滑步转身
            const targetBounce = isSharpTurning ? 0 : Math.abs(Math.sin(wp)) * (CONFIG.playerBounce !== undefined ? CONFIG.playerBounce : 0.18);
            this.bodyGroup.position.y = THREE.MathUtils.lerp(this.bodyGroup.position.y, 0.25 + targetBounce, delta * 20);
            
            // 让腿部跟随身体一起弹跳，避免脱节
            // this.leftLeg.position.y = THREE.MathUtils.lerp(this.leftLeg.position.y, 0.15 + targetBounce, delta * 20);
            // this.rightLeg.position.y = THREE.MathUtils.lerp(this.rightLeg.position.y, 0.15 + targetBounce, delta * 20);
            
            // Let new physics tail handle walking wag
            if (!this.tailSegments && this.tailGroup) {
                this.tailGroup.rotation.y = Math.sin(wp * 1.8) * 0.4;
            }

            if (this.lastStepPhaseIndex === undefined) this.lastStepPhaseIndex = 0;
            const currentStepIndex = Math.floor(this.walkPhase / Math.PI);

            if (!this.bounceMonitorEl) {
                this.bounceMonitorEl = document.getElementById('bounce-indicator-light');
            }
            if (this.bounceMonitorEl) {
                if (isSharpTurning) {
                    this.bounceMonitorEl.style.background = '#444';
                    this.bounceMonitorEl.style.boxShadow = 'inset 0 2px 4px rgba(0,0,0,0.5)';
                    this.bounceMonitorEl.style.transform = 'scale(1)';
                } else {
                    const intensity = Math.abs(Math.sin(wp));
                    const r = Math.floor(100 + 155 * intensity);
                    const g = Math.floor(200 + 55 * intensity);
                    this.bounceMonitorEl.style.background = `rgb(${r}, ${g}, 50)`;
                    this.bounceMonitorEl.style.boxShadow = `0 0 ${12 * intensity}px rgb(${r}, ${g}, 50)`;
                    this.bounceMonitorEl.style.transform = `scale(${1 + 0.4 * intensity})`;
                }
            }

            if (Globals.particleManager && speedMagnitude > 2.5 && currentStepIndex > this.lastStepPhaseIndex) {
                const moveDir = currentVelocity.clone().normalize();
                // 将烟团生成位置向玩家中心偏移拉近（从 -0.32 缩小到 -0.05），贴合脚底
                const smokePos = this.mesh.position.clone()
                    .addScaledVector(moveDir, -0.05 * CONFIG.playerScale);
                Globals.particleManager.spawnDustPuff(smokePos, moveDir, 0.5 * CONFIG.playerScale);
                this.lastStepPhaseIndex = currentStepIndex;
            }
        } else {
            this.walkPhase = 0;
            this.smokeTrailDistance = 0;
            this.lastStepPhaseIndex = 0;
            const idleSpeed = 3;
            this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0, delta * 10);
            this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0, delta * 10);
            this.leftLowerLeg.rotation.x = THREE.MathUtils.lerp(this.leftLowerLeg.rotation.x, 0, delta * 10);
            this.rightLowerLeg.rotation.x = THREE.MathUtils.lerp(this.rightLowerLeg.rotation.x, 0, delta * 10);
            
            let targetBodyRotX = 0;
            let targetBodyRotY = 0;
            if (this.isAttacking) {
                const leanBackX = this.isSpecialAttack ? -0.5 : -0.3;
                const twistBackY = this.isSpecialAttack ? -1.0 : -0.6;
                const throwForwardX = this.isSpecialAttack ? 0.7 : 0.5;
                const throwTwistY = this.isSpecialAttack ? 0.6 : 0.4;

                if (this.attackPhase === 'windup') {
                    const progress = 1 - (this.attackTimer / this.windupDuration); // 0 to 1
                    targetBodyRotX = THREE.MathUtils.lerp(0, leanBackX, progress); 
                    targetBodyRotY = THREE.MathUtils.lerp(0, twistBackY, progress); 
                } else if (this.attackPhase === 'recover') {
                    const progress = 1 - (this.attackTimer / this.recoverDuration); // 0 to 1
                    if (progress < 0.3) {
                        targetBodyRotX = THREE.MathUtils.lerp(leanBackX, throwForwardX, progress / 0.3);
                        targetBodyRotY = THREE.MathUtils.lerp(twistBackY, throwTwistY, progress / 0.3); 
                    } else {
                        targetBodyRotX = THREE.MathUtils.lerp(throwForwardX, 0, (progress - 0.3) / 0.7);
                        targetBodyRotY = THREE.MathUtils.lerp(throwTwistY, 0, (progress - 0.3) / 0.7);
                    }
                }
            } else if (!this.isCatching) {
                // If catching, the catch recoil animation handles X rotation below, so don't override it here
                targetBodyRotX = 0;
            }
            
            // Only update rotation.x here if not catching, because catching recoil relies on this
            if (!this.isCatching && !this.isAttacking) {
                this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, 0, delta * 10);
                this.bodyGroup.rotation.y = THREE.MathUtils.lerp(this.bodyGroup.rotation.y, 0, delta * 10);
            } else if (this.isAttacking) {
                this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, targetBodyRotX, delta * 20);
                this.bodyGroup.rotation.y = THREE.MathUtils.lerp(this.bodyGroup.rotation.y, targetBodyRotY, delta * 20);
            }
            
            this.bodyGroup.rotation.z = THREE.MathUtils.lerp(this.bodyGroup.rotation.z, 0, delta * 10);
            
            if (!this.bounceMonitorEl) {
                this.bounceMonitorEl = document.getElementById('bounce-indicator-light');
            }
            if (this.bounceMonitorEl) {
                this.bounceMonitorEl.style.background = '#444';
                this.bounceMonitorEl.style.boxShadow = 'inset 0 2px 4px rgba(0,0,0,0.5)';
                this.bounceMonitorEl.style.transform = 'scale(1)';
            }
            
            // Let new physics tail handle idle wag
            if (!this.tailSegments && this.tailGroup) {
                this.tailGroup.rotation.y = Math.sin(time * 2.5) * 0.15;
            }
            
            const targetIdleY = 0.25 + Math.sin(time * idleSpeed) * 0.03;
            this.bodyGroup.position.y = THREE.MathUtils.lerp(this.bodyGroup.position.y, targetIdleY, delta * 10);
            
            // 待机时腿部高度复位
            // this.leftLeg.position.y = THREE.MathUtils.lerp(this.leftLeg.position.y, 0.15, delta * 10);
            // this.rightLeg.position.y = THREE.MathUtils.lerp(this.rightLeg.position.y, 0.15, delta * 10);
        }
        
        // Procedural IK Tail Update (World Space)
        if (this.tailWorldGroup) {
            // Check for config changes to rebuild dynamically
            const targetSegLength = CONFIG.tailSegLength !== undefined ? CONFIG.tailSegLength : 0.07;
            const targetRadius = CONFIG.tailRadius !== undefined ? CONFIG.tailRadius : 0.04;
            if (this.tailSegLength !== targetSegLength || this.currentTailRadius !== targetRadius) {
                this.tailSegLength = targetSegLength;
                this.currentTailRadius = targetRadius;
                // Rebuild geometries
                for (let i = 0; i < this.numTailSegments; i++) {
                    const mesh = this.tailMeshes[i];
                    mesh.geometry.dispose();
                    const geo = new THREE.CapsuleGeometry(this.currentTailRadius, this.tailSegLength, 8, 8);
                    geo.rotateX(Math.PI / 2);
                    mesh.geometry = geo;
                }
            }

            // Ensure the world group is in the scene
            if (!this.tailWorldGroup.parent && Globals.scene) {
                Globals.scene.add(this.tailWorldGroup);
            }
            
            // Sync visibility
            this.tailWorldGroup.visible = this.mesh.visible;
            
            // Get base position in world space
            this.bodyGroup.updateMatrixWorld();
            const basePos = new THREE.Vector3(0, -0.01, -0.08);
            this.bodyGroup.localToWorld(basePos);
            
            // Handle initialization or teleportation (if the player moved too far instantly)
            if (!this.tailInitialized || this.tailPoints[0].distanceToSquared(basePos) > 4.0) {
                for (let i = 0; i <= this.numTailSegments; i++) {
                    this.tailPoints[i].copy(basePos);
                }
                this.tailInitialized = true;
            }
            
            // Apply walking/idle wag to the attachment point
            let wagOffset = new THREE.Vector3();
            let rightDir = new THREE.Vector3(1, 0, 0);
            rightDir.transformDirection(this.mesh.matrixWorld).normalize();
            
            if (isMoving) {
                let wagAmount = Math.sin(wp * 2.0) * 0.08;
                wagOffset.copy(rightDir).multiplyScalar(wagAmount);
            } else {
                let wagAmount = Math.sin(time * 2.5) * 0.02;
                wagOffset.copy(rightDir).multiplyScalar(wagAmount);
            }
            
            this.tailPoints[0].copy(basePos).add(wagOffset);
            
            // Inverse Kinematics / Distance Constraints
            for (let i = 1; i <= this.numTailSegments; i++) {
                let curr = this.tailPoints[i];
                let prev = this.tailPoints[i - 1];
                
                let dir = new THREE.Vector3().subVectors(curr, prev);
                let dist = dir.length();
                
                if (dist > 0.0001) {
                    dir.normalize();
                    
                    // Add slight stiffness by blending the direction with the backward vector
                    // This prevents the tail from whipping perfectly to the side instantly
                    let playerBackward = new THREE.Vector3(0, 0, -1);
                    playerBackward.transformDirection(this.mesh.matrixWorld).normalize();
                    // Mix in some backward intent
                    dir.lerp(playerBackward, 0.05);
                    
                    // Add tiny gravity droop
                    dir.y -= 0.01;
                    dir.normalize();
                    
                    // Enforce exact distance constraint
                    curr.copy(prev).add(dir.multiplyScalar(this.tailSegLength));
                }
            }
            
            // Update Mesh positions and rotations
            for (let i = 0; i < this.numTailSegments; i++) {
                let p1 = this.tailPoints[i];
                let p2 = this.tailPoints[i + 1];
                let mesh = this.tailMeshes[i];
                
                // Position mesh precisely halfway between the joints
                mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
                // Aim +Z axis towards the leading joint
                mesh.lookAt(p1);
            }
        }
        
        if (this.isCatching) {
            this.catchTimer -= delta;
            if (this.catchTimer <= 0) {
                this.isCatching = false;
                this.weaponBackGroup.visible = false;
                this.weaponGroup.visible = true;
            }
        }

        const idleSpeed2 = 3;
        const armSpeed = this.isAttacking ? 20 : (isMoving ? 8 : 10);
        
        const isRecallingAny = Globals.feathers && Globals.feathers.some(f => f.phase === 'recalling');
        const activeFeathersCount = Globals.feathers ? Globals.feathers.length : 0;
        const weaponsInInventory = Math.max(0, 4 - activeFeathersCount);
        const hasWeaponInHand = weaponsInInventory > 0;
        const weaponsOnBackCount = Math.max(0, weaponsInInventory - 1);
        
        // Hide weapon in hand during catching animation (if we put it on back)
        if (CONFIG.hideVisualDistractors) {
            this.weaponGroup.visible = false;
            this.weaponBackGroup.visible = false;
            if (this.backWeapons) {
                for (let i = 0; i < 3; i++) {
                    this.backWeapons[i].visible = false;
                }
            }
        } else {
            if (this.isCatching && this.catchTimer < 0.2) {
                this.weaponGroup.visible = false;
                this.weaponBackGroup.visible = true;
            } else if (!this.isCatching) {
                this.weaponGroup.visible = hasWeaponInHand;
                this.weaponBackGroup.visible = false;
            }

            // Update back weapons visibility
            if (this.backWeapons) {
                for (let i = 0; i < 3; i++) {
                    // Determine if this pendant should be visible based on inventory
                    this.backWeapons[i].visible = (i < weaponsOnBackCount);
                }
            }
        }

        if (isMoving) {
            const armSwing = CONFIG.runArmSwing !== undefined ? CONFIG.runArmSwing : 0.8;
            const armSpread = CONFIG.runArmSpread !== undefined ? CONFIG.runArmSpread : 0.3;
            const targetArmL = -Math.sin(wp) * armSwing;
            const targetArmR = Math.sin(wp) * armSwing;
            this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, targetArmL, delta * armSpeed);
            this.leftArm.rotation.z = THREE.MathUtils.lerp(this.leftArm.rotation.z, armSpread, delta * armSpeed);
            this.leftForearm.rotation.x = THREE.MathUtils.lerp(this.leftForearm.rotation.x, Math.max(0, -targetArmL), delta * armSpeed); // Add natural elbow bending

                if (this.isAttacking) {
                let swingAngleX = 0;
                let swingAngleZ = 0;
                let swingAngleY = 0;
                let forearmAngleX = 0;

                const armPullX = this.isSpecialAttack ? Math.PI * 0.9 : Math.PI * 0.75; // Much higher (over shoulder)
                const armAngleZ = this.isSpecialAttack ? 0.3 : 0.2; // Less angle out, more straight up/back
                const armThrowX = this.isSpecialAttack ? -Math.PI * 0.6 : -Math.PI * 0.5; // Throw forward downwards
                const elbowBendPull = this.isSpecialAttack ? -Math.PI * 0.7 : -Math.PI * 0.6; // Bend elbow heavily during windup
                const elbowBendThrow = this.isSpecialAttack ? -Math.PI * 0.1 : -Math.PI * 0.1; // Extend fully when throwing

                if (this.attackPhase === 'windup') {
                    const progress = 1 - (this.attackTimer / this.windupDuration); // 0 to 1
                    // Pull arm back and raise spear OVER THE SHOULDER
                    swingAngleX = THREE.MathUtils.lerp(this.rightArm.rotation.x, armPullX, progress); 
                    swingAngleZ = THREE.MathUtils.lerp(this.rightArm.rotation.z, armAngleZ, progress); 
                    swingAngleY = THREE.MathUtils.lerp(this.rightArm.rotation.y, Math.PI * 0.1, progress);
                    forearmAngleX = THREE.MathUtils.lerp(0, elbowBendPull, progress);
                } else if (this.attackPhase === 'recover') {
                    const progress = 1 - (this.attackTimer / this.recoverDuration); // 0 to 1
                    if (progress < 0.25) {
                        // Snap throw! Ultra fast
                        const throwProgress = progress / 0.25;
                        swingAngleX = THREE.MathUtils.lerp(armPullX, armThrowX, throwProgress);
                        swingAngleZ = THREE.MathUtils.lerp(armAngleZ, -0.1, throwProgress);
                        swingAngleY = THREE.MathUtils.lerp(Math.PI * 0.1, -0.1, throwProgress);
                        forearmAngleX = THREE.MathUtils.lerp(elbowBendPull, elbowBendThrow, throwProgress);
                    } else {
                        // Slowly recover
                        const recovProgress = (progress - 0.2) / 0.8;
                        swingAngleX = THREE.MathUtils.lerp(armThrowX, targetArmR, recovProgress);
                        swingAngleZ = THREE.MathUtils.lerp(-0.2, 0, recovProgress);
                        swingAngleY = THREE.MathUtils.lerp(-0.1, 0, recovProgress);
                        forearmAngleX = THREE.MathUtils.lerp(elbowBendThrow, 0, recovProgress);
                    }
                }
                
                // For instant snap, use high lerp or direct assignment for throwing phase
                if (this.attackPhase === 'recover' && (1 - (this.attackTimer / this.recoverDuration)) < 0.25) {
                     this.rightArm.rotation.x = swingAngleX;
                     this.rightArm.rotation.z = swingAngleZ;
                     this.rightArm.rotation.y = swingAngleY;
                     this.rightForearm.rotation.x = forearmAngleX;
                } else {
                    this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, swingAngleX, delta * 30);
                    this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, swingAngleZ, delta * 30);
                    this.rightArm.rotation.y = THREE.MathUtils.lerp(this.rightArm.rotation.y, swingAngleY, delta * 30);
                    this.rightForearm.rotation.x = THREE.MathUtils.lerp(this.rightForearm.rotation.x, forearmAngleX, delta * 30);
                }

            } else {
                this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, targetArmR, delta * armSpeed);
                this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, -armSpread, delta * armSpeed);
                this.rightArm.rotation.y = THREE.MathUtils.lerp(this.rightArm.rotation.y, 0, delta * armSpeed);
                this.rightForearm.rotation.x = THREE.MathUtils.lerp(this.rightForearm.rotation.x, 0, delta * armSpeed);
            }
        } else {
            if (this.isCatching) {
                // Animation of absorbing/catching weapon
                const catchProgress = 1 - (this.catchTimer / 0.3); // 0 to 1
                
                // Body recoil recovery
                this.bodyGroup.position.y = THREE.MathUtils.lerp(this.bodyGroup.position.y, 0.25, delta * 15);
                this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, 0, delta * 15);

                if (catchProgress < 0.5) {
                    // Pull back quickly (recoil)
                    this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, delta * 20);
                    this.leftForearm.rotation.x = THREE.MathUtils.lerp(this.leftForearm.rotation.x, 0, delta * 20);
                    this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, Math.PI * 0.4, delta * 20); // Arm goes back
                    this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, Math.PI * 0.1, delta * 20);
                    this.rightForearm.rotation.x = THREE.MathUtils.lerp(this.rightForearm.rotation.x, -Math.PI * 0.3, delta * 20);
                } else {
                    // Return to idle stance
                    this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, delta * 15);
                    this.leftForearm.rotation.x = THREE.MathUtils.lerp(this.leftForearm.rotation.x, 0, delta * 15);
                    this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, 0, delta * 15);
                    this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, -0.1, delta * 15);
                    this.rightForearm.rotation.x = THREE.MathUtils.lerp(this.rightForearm.rotation.x, 0, delta * 15);
                }
            } else if (isRecallingAny && !this.isAttacking) {
                // Standing still and recalling -> hands reach forward to catch
                this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, -Math.PI * 0.4, delta * 15);
                this.leftArm.rotation.z = THREE.MathUtils.lerp(this.leftArm.rotation.z, 0.1, delta * 15);
                this.leftForearm.rotation.x = THREE.MathUtils.lerp(this.leftForearm.rotation.x, -Math.PI * 0.2, delta * 15);
                
                this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, -Math.PI * 0.4, delta * 15);
                this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, -0.1, delta * 15);
                this.rightForearm.rotation.x = THREE.MathUtils.lerp(this.rightForearm.rotation.x, -Math.PI * 0.2, delta * 15);
            } else {
                this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, delta * armSpeed);
                this.leftArm.rotation.z = 0.1 + Math.sin(time * idleSpeed2) * 0.02;
                this.leftForearm.rotation.x = THREE.MathUtils.lerp(this.leftForearm.rotation.x, 0, delta * armSpeed);
                
                if (this.isAttacking) { 
                    let swingAngleX = 0;
                    let swingAngleZ = 0;
                    let swingAngleY = 0;
                    let forearmAngleX = 0;

                    const armPullX = this.isSpecialAttack ? Math.PI * 0.9 : Math.PI * 0.75; // Much higher
                    const armAngleZ = this.isSpecialAttack ? 0.3 : 0.2; 
                    const armThrowX = this.isSpecialAttack ? -Math.PI * 0.6 : -Math.PI * 0.5;
                    const elbowBendPull = this.isSpecialAttack ? -Math.PI * 0.7 : -Math.PI * 0.6; // Bend elbow heavily during windup
                    const elbowBendThrow = this.isSpecialAttack ? -Math.PI * 0.1 : -Math.PI * 0.1; // Extend fully when throwing

                    if (this.attackPhase === 'windup') {
                        const progress = 1 - (this.attackTimer / this.windupDuration); 
                        swingAngleX = THREE.MathUtils.lerp(this.rightArm.rotation.x, armPullX, progress); 
                        swingAngleZ = THREE.MathUtils.lerp(this.rightArm.rotation.z, armAngleZ, progress); 
                        swingAngleY = THREE.MathUtils.lerp(this.rightArm.rotation.y, Math.PI * 0.1, progress);
                        forearmAngleX = THREE.MathUtils.lerp(0, elbowBendPull, progress);
                    } else if (this.attackPhase === 'recover') {
                        const progress = 1 - (this.attackTimer / this.recoverDuration); 
                        if (progress < 0.25) {
                            const throwProgress = progress / 0.25;
                            swingAngleX = THREE.MathUtils.lerp(armPullX, armThrowX, throwProgress);
                            swingAngleZ = THREE.MathUtils.lerp(armAngleZ, -0.1, throwProgress);
                            swingAngleY = THREE.MathUtils.lerp(Math.PI * 0.1, -0.1, throwProgress);
                            forearmAngleX = THREE.MathUtils.lerp(elbowBendPull, elbowBendThrow, throwProgress);
                        } else {
                            const recovProgress = (progress - 0.2) / 0.8;
                            swingAngleX = THREE.MathUtils.lerp(armThrowX, 0, recovProgress);
                            swingAngleZ = THREE.MathUtils.lerp(-0.2, -0.1 - Math.sin(time * idleSpeed2) * 0.02, recovProgress);
                            swingAngleY = THREE.MathUtils.lerp(-0.1, 0, recovProgress);
                            forearmAngleX = THREE.MathUtils.lerp(elbowBendThrow, 0, recovProgress);
                        }
                    }

                    if (this.attackPhase === 'recover' && (1 - (this.attackTimer / this.recoverDuration)) < 0.25) {
                         this.rightArm.rotation.x = swingAngleX;
                         this.rightArm.rotation.z = swingAngleZ;
                         this.rightArm.rotation.y = swingAngleY;
                         this.rightForearm.rotation.x = forearmAngleX;
                    } else {
                        this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, swingAngleX, delta * 30);
                        this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, swingAngleZ, delta * 30);
                        this.rightArm.rotation.y = THREE.MathUtils.lerp(this.rightArm.rotation.y, swingAngleY, delta * 30);
                        this.rightForearm.rotation.x = THREE.MathUtils.lerp(this.rightForearm.rotation.x, forearmAngleX, delta * 30);
                    }

                } else { 
                    this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, 0, delta * armSpeed); 
                    this.rightArm.rotation.z = -0.1 - Math.sin(time * idleSpeed2) * 0.02; 
                    this.rightArm.rotation.y = THREE.MathUtils.lerp(this.rightArm.rotation.y, 0, delta * armSpeed);
                    this.rightForearm.rotation.x = THREE.MathUtils.lerp(this.rightForearm.rotation.x, 0, delta * armSpeed);
                }
            }
        }
        
        // Ensure base ring stays flat despite player rotation
        if (this.baseRingGroup) {
            this.baseRingGroup.visible = !CONFIG.hideVisualDistractors;
            this.baseRingGroup.quaternion.copy(this.mesh.quaternion).invert();
            if (this.dashRing) this.dashRing.rotation.y += delta * 1.5;
            const ringScale = 1.0 + Math.sin(time * 4) * 0.03;
            this.baseRingGroup.scale.set(ringScale, 1, ringScale);
        }

        if (this.shadowMesh) {
            // bodyGroup rests around 0.25 on Y axis.
            // When bouncing, it goes higher. We use this height offset to scale the shadow.
            const heightOffset = Math.max(0, this.bodyGroup.position.y - 0.25);
            
            // As height increases, shadow shrinks and becomes more transparent
            const shadowScale = Math.max(0.4, 1.0 - heightOffset * 2.0);
            const shadowOpacity = Math.max(0.05, 0.35 - heightOffset * 0.8);
            
            this.shadowMesh.scale.set(shadowScale, shadowScale, shadowScale);
            this.shadowMesh.material.opacity = shadowOpacity;
        }
    }

    updateTrajectory(delta) {
        if (!CONFIG.showPlayerTrajectory) {
            if (this.trajectoryLine.visible) {
                this.trajectoryLine.visible = false;
                this.trajectoryPoints = [];
            }
            return;
        }

        if (!this.trajectoryLine.parent && Globals.scene) {
            Globals.scene.add(this.trajectoryLine);
        }

        this.trajectoryLine.visible = true;

        this.trajectoryTime = (this.trajectoryTime || 0) + delta;

        // Record current position
        const p = this.mesh.position.clone();
        p.y = 0.05; // Slightly above ground
        this.trajectoryPoints.push({ pos: p, time: this.trajectoryTime });

        // Remove points older than 3 seconds
        while (this.trajectoryPoints.length > 0 && this.trajectoryTime - this.trajectoryPoints[0].time > 3.0) {
            this.trajectoryPoints.shift();
        }

        // Update geometry
        const positions = new Float32Array(this.trajectoryPoints.length * 3);
        for (let i = 0; i < this.trajectoryPoints.length; i++) {
            positions[i * 3] = this.trajectoryPoints[i].pos.x;
            positions[i * 3 + 1] = this.trajectoryPoints[i].pos.y;
            positions[i * 3 + 2] = this.trajectoryPoints[i].pos.z;
        }
        this.trajectoryLineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.trajectoryLineGeo.computeBoundingSphere();
    }
}
