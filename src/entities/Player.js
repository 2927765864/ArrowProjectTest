import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Globals } from '../utils.js';
import { createWeaponModel } from './Feather.js';

// ===== 模块级 scratch（所有 Player 实例共享，update 复用）=====
// 仅 1 个 Player 实例，但 update 每帧调用 60 次，需要消除 GC 压力。
const _UNIT_X = new THREE.Vector3(1, 0, 0);
const _UNIT_Y = new THREE.Vector3(0, 1, 0);
const _scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _scratchQYawInv = new THREE.Quaternion();
const _scratchQTilt = new THREE.Quaternion();
const _scratchQYaw = new THREE.Quaternion();
const _scratchTailV1 = new THREE.Vector3();
const _scratchTailV2 = new THREE.Vector3();
const _scratchTailV3 = new THREE.Vector3();
const _scratchTailV4 = new THREE.Vector3();
const _scratchTailV5 = new THREE.Vector3();
const _scratchHudVec = new THREE.Vector3();

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

        // tiltGroup: 中间层，专门承载模型倾斜和高度偏移，不影响逻辑层(mesh)和动画层(bodyGroup)
        this.tiltGroup = new THREE.Group();
        this.mesh.add(this.tiltGroup);

        // hipPivotGroup: 攻击时让【上半身 + 胯部视觉】围绕左脚转动的轴心层。
        // 注意：双腿【不】挂在这里面（见下方的 legsAnchorGroup），所以脚根
        // 不会被 hipPivotGroup 的扭转带走，满足"双脚站定"的需求。
        this.hipPivotGroup = new THREE.Group();
        this.hipPivotGroup.rotation.order = 'YXZ';
        // 默认左脚大致在 bodyGroup 局部 (0.055, -0.25, 0)（左胯水平 + 站立高度下降）。
        // 在 tiltGroup 局部下，地面即 y=0。
        const leftFootPivotX = CONFIG.attackLeftFootPivotX ?? 0.055;
        const leftFootPivotZ = CONFIG.attackLeftFootPivotZ ?? 0.0;
        this.hipPivotGroup.position.set(leftFootPivotX, 0, leftFootPivotZ);
        this.tiltGroup.add(this.hipPivotGroup);

        this.bodyGroup = new THREE.Group();
        this.bodyGroup.rotation.order = 'YXZ';
        // 反向偏移，使 bodyGroup 原点（身体正中/胯中）在 tiltGroup 局部仍
        // 位于 (0, 0.25, 0)：效果上 idle 站姿保持不变。
        this.bodyGroup.position.set(-leftFootPivotX, 0.25, -leftFootPivotZ);
        this.hipPivotGroup.add(this.bodyGroup);

        // legsAnchorGroup: 双腿的挂载锚点，直接挂在 tiltGroup 下，
        // 【完全不受 hipPivotGroup 的攻击扭转 / bodyGroup 的 dip-lift 影响】。
        // 原点设在原本 bodyGroup 的"胯部中心"等效位置 (0, 0.25, 0)，让
        // leftLeg/rightLeg 保留它们在 bodyGroup 局部的 (±0.055, -0.05, 0) 位置。
        // 这样 leg 根节点 (胯) 在 tiltGroup 局部为 (±0.055, 0.2, 0)，世界位置
        // 固定不动。脚的站姿/攻击摆动只通过大腿/小腿的旋转实现。
        this.legsAnchorGroup = new THREE.Group();
        this.legsAnchorGroup.position.set(0, 0.25, 0);
        this.tiltGroup.add(this.legsAnchorGroup);

        this.upperBodyGroup = new THREE.Group();
        this.upperBodyGroup.rotation.order = 'YXZ';
        this.bodyGroup.add(this.upperBodyGroup);
        
        // Torso
        const torsoGeo = new THREE.CapsuleGeometry(0.12, 0.12, 4, 16);
        const torso = new THREE.Mesh(torsoGeo, backMat);
        torso.position.y = 0.08;
        torso.castShadow = true;
        torso.userData.partId = 1; // 躯干
        this.upperBodyGroup.add(torso);
        
        // Head (Refined Cartoon Cat)
        this.headGroup = new THREE.Group();
        this.headGroup.position.y = 0.26; 

        // 1. Cranium (Top part of the head, slightly flattened)
        const craniumGeo = new THREE.SphereGeometry(0.16, 32, 32);
        const cranium = new THREE.Mesh(craniumGeo, faceMat);
        cranium.scale.set(1.2, 0.8, 1.1);
        cranium.position.set(0, 0.06, 0.02);
        cranium.userData.partId = 2; // 头部
        this.headGroup.add(cranium);

        // 2. Back of the head (Darker color for facing direction)
        const backHeadGeo = new THREE.SphereGeometry(0.17, 32, 32);
        const backHead = new THREE.Mesh(backHeadGeo, backMat);
        backHead.scale.set(1.25, 0.85, 1.1);
        backHead.position.set(0, 0.02, -0.04);
        backHead.userData.partId = 2; // 头部
        this.headGroup.add(backHead);

        // 3. Cheeks / Jowls (Makes the face wide at the bottom)
        const cheekGeo = new THREE.SphereGeometry(0.11, 32, 32);
        const cheekL = new THREE.Mesh(cheekGeo, faceMat);
        cheekL.scale.set(0.9, 0.75, 0.95);
        cheekL.position.set(0.09, -0.04, 0.05);
        cheekL.userData.partId = 2; // 头部
        this.headGroup.add(cheekL);
        
        const cheekR = new THREE.Mesh(cheekGeo, faceMat);
        cheekR.scale.set(0.9, 0.75, 0.95);
        cheekR.position.set(-0.09, -0.04, 0.05);
        cheekR.userData.partId = 2; // 头部
        this.headGroup.add(cheekR);

        // 4. Ears (Flattened cones with inner ear depth)
        const earGeo = new THREE.ConeGeometry(0.112, 0.252, 16);
        const innerEarGeo = new THREE.ConeGeometry(0.056, 0.168, 16);

        const earL = new THREE.Mesh(earGeo, backMat);
        earL.scale.set(1, 1, 0.5);
        earL.position.set(0.13, 0.16, -0.02);
        earL.rotation.set(-0.1, 0.15, -0.35);
        earL.userData.partId = 2; // 头部
        const innerEarL = new THREE.Mesh(innerEarGeo, innerEarMat);
        innerEarL.position.set(0, -0.01, 0.03);
        // innerEar 不参与 (partId=0)，保留 detail 颜色
        earL.add(innerEarL);
        this.headGroup.add(earL);

        const earR = new THREE.Mesh(earGeo, backMat);
        earR.scale.set(1, 1, 0.5);
        earR.position.set(-0.13, 0.16, -0.02);
        earR.rotation.set(-0.1, -0.15, 0.35);
        earR.userData.partId = 2; // 头部
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

        this.upperBodyGroup.add(this.headGroup);

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
            mesh.userData.partId = 11; // 尾巴整体一个 ID
            this.tailMeshes.push(mesh);
            this.tailWorldGroup.add(mesh);
        }
        this.tailInitialized = false;
        // ------------------------------
        
        // Arms
        this.leftArm = new THREE.Group();
        this.leftArm.rotation.order = 'YXZ';
        this.leftArm.position.set(0.105, 0.10, 0); // Moved inward from 0.16 to embed into torso
        this.upperBodyGroup.add(this.leftArm);

        // Left Upper Arm
        const upperArmGeoL = new THREE.CapsuleGeometry(0.045, 0.07, 4, 16); // Slightly thicker & longer
        const upperArmMeshL = new THREE.Mesh(upperArmGeoL, faceMat);
        upperArmMeshL.position.y = -0.035;
        upperArmMeshL.castShadow = true;
        upperArmMeshL.userData.partId = 3; // 左上臂
        this.leftArm.add(upperArmMeshL);
        
        // Left Shoulder Joint （关节球作为缓冲带：partId=0）
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
        lowerArmMeshL.userData.partId = 4; // 左前臂
        this.leftForearm.add(lowerArmMeshL);
        
        // Left Elbow Joint （partId=0 缓冲）
        const elbowJointL = new THREE.Mesh(shoulderJointGeo, faceMat);
        this.leftForearm.add(elbowJointL);

        // Held weapon — attached to the player root mesh (not the forearm),
        // so it follows the player's facing direction and stays parallel to
        // the ground regardless of arm/elbow rotation during the windup pose.
        // The legacy 'heldWeaponLeft' field is kept (null) for any defensive
        // checks elsewhere; only one weapon mesh is needed in the scene.
        this.heldWeaponLeft = null;

        this.rightArm = new THREE.Group();
        this.rightArm.rotation.order = 'YXZ';
        this.rightArm.position.set(-0.105, 0.10, 0); 
        this.upperBodyGroup.add(this.rightArm);

        // Upper arm
        const upperArmGeo = new THREE.CapsuleGeometry(0.045, 0.07, 4, 16);
        const upperArmMesh = new THREE.Mesh(upperArmGeo, faceMat);
        upperArmMesh.position.y = -0.035;
        upperArmMesh.castShadow = true;
        upperArmMesh.userData.partId = 5; // 右上臂
        this.rightArm.add(upperArmMesh);
        
        // Right Shoulder Joint （partId=0 缓冲）
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
        lowerArmMesh.userData.partId = 6; // 右前臂
        this.rightForearm.add(lowerArmMesh);
        
        // Right Elbow Joint （partId=0 缓冲）
        const elbowJointR = new THREE.Mesh(shoulderJointGeo, faceMat);
        this.rightForearm.add(elbowJointR);

        // Held weapon — attached to the player root mesh.
        //
        // 设计意图：
        //   - 武器在蓄力期间需要紧贴玩家手部，且【始终平行于地面，尖端指向
        //     玩家正前方】。
        //   - 如果挂在 forearm 上，前臂在蓄力期间会做大幅旋转（armPullX/Y/Z
        //     和 elbowBendPull 都不为 0），武器会跟着前臂一起翻转，违反
        //     "尖端指向正前方"的设计要求。
        //   - 因此挂在 this.mesh（玩家根 Group）下：mesh 的旋转只包含
        //     "玩家朝向" 的 yaw（main.js 的 player.mesh.quaternion.slerp
        //     仅围绕 Y 轴旋转），不会受到攻击姿态的躯干扭转、手臂动作影响。
        //
        // 模型基轴对齐：
        //   createWeaponModel() 内部默认会做 rotation.set(PI/2, 0, 0)，使尖端
        //   指向 +Z。但玩家“正前方” = -Z，因此把内部 modelGroup 的轴向重置为
        //   单位四元数，再由外层 heldWeaponRight 通过 RotY=PI 把尖端转向 -Z。
        //   这样默认就拿在手上、平行地面、尖端朝前。
        this.heldWeaponRight = new THREE.Group();
        const rightWeaponModel = createWeaponModel(0.08);
        rightWeaponModel.position.set(0, 0, 0);
        rightWeaponModel.rotation.set(0, 0, 0);
        this.heldWeaponRight.add(rightWeaponModel);

        // 默认值由 CONFIG 提供（attackWeaponHoldPos*/Rot*），这里只挂载到
        // mesh 下，每帧由 _updateAnimation 末尾应用最新参数。
        this.heldWeaponRight.visible = false;
        this.mesh.add(this.heldWeaponRight);

        // 已移除玩家手上、背上的所有武器模型显示（hand/back weapon meshes removed）

        this.catchTimer = 0;
        this.isCatching = false;
        
        // Legs — parented to legsAnchorGroup (NOT bodyGroup) so feet stay
        // planted while the upper body does attack rotations. The y offset
        // stays -0.05 to preserve the exact idle visual (leg root at the
        // same world height as before).
        this.leftLeg = new THREE.Group();
        this.leftLeg.position.set(0.055, -0.05, 0);
        this.legsAnchorGroup.add(this.leftLeg);

        // Left Upper Leg (Thigh)
        const upperLegGeo = new THREE.CapsuleGeometry(0.05, 0.08, 4, 16); // Slightly longer to compensate for higher pivot
        const upperLegMeshL = new THREE.Mesh(upperLegGeo, limbMat);
        upperLegMeshL.position.y = -0.04;
        upperLegMeshL.castShadow = true;
        upperLegMeshL.userData.partId = 7; // 左大腿
        this.leftLeg.add(upperLegMeshL);
        
        // Left Hip Joint （partId=0 缓冲）
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
        lowerLegMeshL.userData.partId = 8; // 左小腿
        this.leftLowerLeg.add(lowerLegMeshL);
        
        // Left Knee Joint （partId=0 缓冲）
        const kneeJointL = new THREE.Mesh(hipJointGeo, limbMat);
        this.leftLowerLeg.add(kneeJointL);
        
        this.rightLeg = new THREE.Group();
        this.rightLeg.position.set(-0.055, -0.05, 0);
        this.legsAnchorGroup.add(this.rightLeg);

        // Right Upper Leg (Thigh)
        const upperLegMeshR = new THREE.Mesh(upperLegGeo, limbMat);
        upperLegMeshR.position.y = -0.04;
        upperLegMeshR.castShadow = true;
        upperLegMeshR.userData.partId = 9; // 右大腿
        this.rightLeg.add(upperLegMeshR);
        
        // Right Hip Joint （partId=0 缓冲）
        const hipJointR = new THREE.Mesh(hipJointGeo, limbMat);
        this.rightLeg.add(hipJointR);

        // Right Lower Leg (Calf + Knee)
        this.rightLowerLeg = new THREE.Group();
        this.rightLowerLeg.position.set(0, -0.08, 0);
        this.rightLeg.add(this.rightLowerLeg);

        const lowerLegMeshR = new THREE.Mesh(lowerLegGeo, limbMat);
        lowerLegMeshR.position.y = -0.04;
        lowerLegMeshR.castShadow = true;
        lowerLegMeshR.userData.partId = 10; // 右小腿
        this.rightLowerLeg.add(lowerLegMeshR);
        
        // Right Knee Joint （partId=0 缓冲）
        const kneeJointR = new THREE.Mesh(hipJointGeo, limbMat);
        this.rightLowerLeg.add(kneeJointR);

        // Player Blob Shadow
        // 半径由 CONFIG.playerShadowRadius 控制，可在参数面板实时调整
        // （运行时改半径会通过 ControlPanel 重建几何体替换 shadowMesh.geometry）。
        this._shadowSegments = 32;
        const shadowRadius = (CONFIG.playerShadowRadius !== undefined) ? CONFIG.playerShadowRadius : 0.22;
        const shadowGeo = new THREE.CircleGeometry(shadowRadius, this._shadowSegments);
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

        // Player base ring indicator (3 arcs + inner thick ring = weapon ammo gauge)
        // The 3 arcs represent the first 3 normal weapons. The inner thick ring
        // represents the final special weapon. A gap between the arcs is kept
        // aligned with the player's facing direction (no continuous spin).
        this.baseRingGroup = new THREE.Group();
        this.baseRingGroup.position.y = 0.02;
        this.mesh.add(this.baseRingGroup);

        // The inner (yellow) progress ring lives in a SEPARATE world-aligned
        // group so it does NOT inherit the player mesh's facing rotation.
        // The outer arcs (in baseRingGroup) still rotate with the player so
        // their forward gap stays aimed where the player is looking; the
        // inner ring's "9 o'clock" anchor must instead stay locked to the
        // world (= screen) left edge regardless of facing.
        // This group is parented to the scene by main.js right after the
        // player itself is added (PlayerCharacter has no scene reference),
        // and its XZ position is synced to the player every frame.
        this.innerRingGroup = new THREE.Group();
        this.innerRingGroup.position.copy(this.mesh.position);
        this.innerRingGroup.position.y = 0.02;

        // 淡紫色底盘：半径由 CONFIG.baseRingBgRadius 控制，可在参数面板实时调整
        // （实际渲染半径 = baseRingBgRadius * 0.95，与原硬编码值 0.45 兼容）。
        this._baseRingBgSegments = 32;
        const baseRadius = (CONFIG.baseRingBgRadius !== undefined) ? CONFIG.baseRingBgRadius : 0.45;
        const bgGeo = new THREE.CircleGeometry(baseRadius * 0.95, this._baseRingBgSegments);
        const bgMat = new THREE.MeshBasicMaterial({
            color: 0x5e55a2,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            toneMapped: false
        });
        this.baseRingBgMesh = new THREE.Mesh(bgGeo, bgMat);
        this.baseRingBgMesh.rotation.x = -Math.PI / 2;
        this.baseRingGroup.add(this.baseRingBgMesh);
        this._baseRingGeomCacheBgRadius = baseRadius;

        // Debug Collision Mesh
        const collGeo = new THREE.CylinderGeometry(1, 1, 1, 16);
        const collMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false });
        this.collisionDebugMesh = new THREE.Mesh(collGeo, collMat);
        this.collisionDebugMesh.visible = false;
        this.mesh.add(this.collisionDebugMesh);

        // Ammo arcs + special ring are built by buildBaseRing(), which is also
        // called whenever the geometry params (radius / thickness) change at
        // runtime. Opacity & color are driven per-frame so each piece owns its
        // own Material instance (no sharing).
        this.ammoArcs = [];
        this.specialRing = null;
        // Per-piece animated state (opacity + rgb) and last-built params cache.
        this._baseRingAnim = {
            arcs: [],        // [{opacity, r, g, b}] x3
            special: null,   // {opacity, r, g, b}
        };
        this._baseRingGeomCache = {
            arcOuterR: -1,
            arcThickness: -1,
            innerRingOuterR: -1,
            innerRingThickness: -1,
        };
        this.buildBaseRing();

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

        // Trajectory feature —— 预分配最大容量的 buffer，避免每帧 new Float32Array + new BufferAttribute。
        // 每帧最多记录 1 个点，3 秒最多 3*60 = 180 个点；给 256 个余量。
        this.trajectoryPoints = [];
        this.TRAJECTORY_MAX_POINTS = 256;
        this.trajectoryLineGeo = new THREE.BufferGeometry();
        this._trajectoryPositions = new Float32Array(this.TRAJECTORY_MAX_POINTS * 3);
        this._trajectoryAttribute = new THREE.BufferAttribute(this._trajectoryPositions, 3);
        this._trajectoryAttribute.setUsage(THREE.DynamicDrawUsage);
        this.trajectoryLineGeo.setAttribute('position', this._trajectoryAttribute);
        this.trajectoryLineGeo.setDrawRange(0, 0);
        this.trajectoryLineMat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 });
        this.trajectoryLine = new THREE.Line(this.trajectoryLineGeo, this.trajectoryLineMat);
        // Added to scene in main.js or here conditionally if scene exists
        if (Globals.scene) Globals.scene.add(this.trajectoryLine);

        this.attackTimer = 0;
        this.isAttacking = false;
        this.attackPhase = 'none'; // 'windup', 'recover'
        this.windupDuration = 0.1;
        this.recoverDuration = 0.2;
        // Configured "weapon spawn delay" for the current attack: extra time
        // between windup-end and the actual feather spawn. The held-weapon
        // pose animation (stayRatio + Z-offset) treats (windupDuration +
        // throwSpawnDelay) as the unified animation window so the held
        // weapon stays visible all the way until the feather actually
        // launches. Pure visual; logical attack phases are unaffected.
        this.throwSpawnDelay = 0;
        this.throwSpawnDelayActive = false;
        this.throwSpawnDelayElapsed = 0;
        // 武器“弹性出现”缩放动画 — 跟踪上一帧 visible 状态以检测显示边沿，
        // 边沿出现时把 popElapsed 归零并在后续每帧前进。超过 popDuration
        // 之后保持 targetScale。仅 scale 受影响，位置 / Z 位移动画独立运行。
        this._heldWeaponWasVisible = false;
        this.heldWeaponPopElapsed = 0;
        this.attackFacingAngle = null;
        this.attackHand = 'right';
        this.nextAttackHand = 'right';
        this.lastMoveDirection = null;
        this.walkPhase = 0;
        this.smokeTrailDistance = 0;
        this._attackCountInSequence = 0; // incremented per playAttack, reset by resetAttackSequence

        // Foot-ring ammo indicator: reference count of in-flight weapons per
        // slot. The field limit can exceed 4, so multiple deployed weapons
        // can share the same slot. Each entry is incremented at
        // throw time (main.js executeThrow) and decremented when the
        // feather fully returns to hand (Feather.destroy). The indicator
        // treats any nonzero count as "used". Indices: 0..2 = the three
        // outer arcs (cycle position 0..2); 3 = inner special ring.
        this.ammoSlotsInFlight = [0, 0, 0, 0];
        // Cycle-position preview used by the foot-ring indicator.
        // Range: 0..4 where:
        //   0 = fully stocked
        //   1..3 = first 1..3 normal pips consumed
        //   4 = the 4th throw consumed the special ring as well
        // The visual reset happens on the NEXT throw after 4, so throw 5
        // shows "reset + first normal pip consumed" in one step. Movement
        // does not reset it; the 4-throw cycle is global across stop/move.
        this.indicatorCyclePos = 0;

        // Foot-ring inner (yellow) progress driver. Set every frame from
        // main.js. Decoupled from weapon state — purely a movement gauge.
        // - progress (0..1): how full the ring should be drawn. Driven by
        //   recallMoveDistanceSinceStop / threshold.
        // - shown: whether the ring should be visible at all. Currently
        //   simply == isMoving, so the ring fades out the instant the
        //   player stops walking, regardless of whether the recall has
        //   actually triggered.
        this.indicatorRecallProgress = 0;
        this.indicatorShown = false;
    }

    // Called once per frame (from main.js). Stashes the values; the
    // per-frame visual update happens in _updateAnimation_shared.
    setIndicatorRecallProgress(progress, shown) {
        this.indicatorRecallProgress = Math.max(0, Math.min(1, progress || 0));
        this.indicatorShown = !!shown;
    }

    // Build or rebuild the ammo gauge meshes (3 arcs + inner special ring)
    // from current CONFIG radius/thickness values. Safe to call at runtime.
    // Geometry alignment:
    //   * RingGeometry lives in local XY, with theta=0 pointing at local +X.
    //   * We rotate each mesh by -PI/2 around X to lay it flat in XZ.
    //   * Player mesh's local forward is +Z (eyes/nose at +Z). After the
    //     -PI/2 X-rotation, world +Z corresponds to the ring's original
    //     local -Y in XY plane, i.e. theta = -PI/2.
    //   So we center the forward gap on theta = -PI/2 so it aligns with
    //   player.mesh's lower-body facing automatically (group is parented
    //   to the mesh, no inversion).
    buildBaseRing() {
        if (!this.baseRingGroup) return;

        // Dispose previous pieces if any
        if (this.ammoArcs && this.ammoArcs.length) {
            for (const arc of this.ammoArcs) {
                this.baseRingGroup.remove(arc);
                arc.geometry?.dispose();
                arc.material?.dispose();
            }
        }
        if (this.specialRing) {
            // The inner ring lives under innerRingGroup (world-aligned),
            // not baseRingGroup. Detach from whichever parent currently
            // owns it (defensive against partial re-parenting during a
            // hot rebuild).
            this.specialRing.parent?.remove(this.specialRing);
            this.specialRing.geometry?.dispose();
            this.specialRing.material?.dispose();
            this.specialRing = null;
        }

        const arcOuterR = Math.max(0.05, CONFIG.baseRingArcOuterR ?? 0.35);
        const arcThickness = Math.max(0.005, CONFIG.baseRingArcThickness ?? 0.035);
        const arcInnerR = Math.max(0.01, arcOuterR - arcThickness);

        const innerOuterR = Math.max(0.02, CONFIG.baseRingInnerRingOuterR ?? 0.24);
        const innerThickness = Math.max(0.005, CONFIG.baseRingInnerRingThickness ?? 0.065);
        const innerInnerR = Math.max(0.005, innerOuterR - innerThickness);

        const perGap = THREE.MathUtils.degToRad(22);
        const arcLen = (Math.PI * 2 - perGap * 3) / 3;

        // --- Outer: three arcs (ammo for the first 3 normal weapons) ---
        this.ammoArcs = [];
        this._baseRingAnim.arcs = [];
        // Arc 0 starts right after the forward gap (going counter-clockwise in theta),
        // i.e. theta = -PI/2 + perGap/2.
        let cursor = -Math.PI / 2 + perGap / 2;
        for (let i = 0; i < 3; i++) {
            const arcGeo = new THREE.RingGeometry(arcInnerR, arcOuterR, 48, 1, cursor, arcLen);
            // Per-arc material instance so each can fade independently.
            const arcMat = new THREE.MeshBasicMaterial({
                color: 0x91c53a,
                transparent: true,
                opacity: 0.9,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false,
                side: THREE.DoubleSide
            });
            const arcMesh = new THREE.Mesh(arcGeo, arcMat);
            arcMesh.rotation.x = -Math.PI / 2;
            arcMesh.position.y = 0.01;
            arcMesh.layers.enable(1);
            this.baseRingGroup.add(arcMesh);
            this.ammoArcs.push(arcMesh);
            this._baseRingAnim.arcs.push({
                opacity: arcMat.opacity,
                r: arcMat.color.r, g: arcMat.color.g, b: arcMat.color.b
            });
            cursor += arcLen + perGap;
        }

        // --- Inner: progress arc that fills clockwise from the 9 o'clock
        // position as the player walks toward the recall threshold. The arc
        // geometry is rebuilt each frame in _updateAnimation_shared with the
        // current progress thetaLength; here we just create an empty mesh
        // and stash the radii for the per-frame rebuild.
        // NormalBlending (not Additive) on purpose: see the spokes-artifact
        // notes below in _rebuildInnerRingGeometry / the bloom-layer comment.
        // Opacity is intentionally <1 so the ground/grass shows through —
        // restores the "soft pale yellow" look the original Additive+Bloom
        // version had, now that we no longer get a bloom boost.
        const specialMat = new THREE.MeshBasicMaterial({
            // Brighter, paler yellow than the original 0xffc84a so the ring
            // reads clearly without the bloom boost (it's no longer on the
            // bloom layer — see note further down on RingGeometry spokes).
            color: 0xfff0a0,
            transparent: true,
            opacity: 0.85,
            blending: THREE.NormalBlending,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide
        });
        // Start with a full ring; per-frame code will swap in a partial-arc
        // geometry whenever the progress isn't 1.
        const specialGeo = new THREE.RingGeometry(innerInnerR, innerOuterR, 48);
        this.specialRing = new THREE.Mesh(specialGeo, specialMat);
        this.specialRing.rotation.x = -Math.PI / 2;
        // innerRingGroup itself sits at y=0.02; keep the ring just below
        // the outer arcs (which sit at baseRingGroup.y=0.02 + arc.y=0.01).
        this.specialRing.position.y = 0;
        // NOTE: Deliberately NOT calling this.specialRing.layers.enable(1).
        // Layer 1 is the project-wide bloom layer (UnrealBloomPass). Bloom
        // amplifies the per-segment radial seams of RingGeometry's
        // triangulation into clearly visible "spokes" radiating from the
        // centre — especially on a large, fully-lit ring like this one.
        // The decorative outer arcs still bloom (small, narrow, fine);
        // the progress ring stays unbloomed so it reads as a clean disc.
        this.innerRingGroup.add(this.specialRing);
        this._baseRingAnim.special = {
            opacity: specialMat.opacity,
            r: specialMat.color.r, g: specialMat.color.g, b: specialMat.color.b
        };
        // Track currently-baked progress so we don't regenerate the same
        // geometry every frame (only when the visible fraction actually
        // changes by a meaningful step). _bakedProgress = -1 forces the
        // first build.
        this._innerRingBakedProgress = -1;
        this._innerRingRadii = { innerR: innerInnerR, outerR: innerOuterR };

        // Cache params for change detection
        this._baseRingGeomCache.arcOuterR = arcOuterR;
        this._baseRingGeomCache.arcThickness = arcThickness;
        this._baseRingGeomCache.innerRingOuterR = innerOuterR;
        this._baseRingGeomCache.innerRingThickness = innerThickness;
    }

    // Rebuild the inner (yellow) ring geometry to display the given
    // [0..1] progress, filling clockwise starting at the 9 o'clock
    // position. progress<=0 -> empty, progress>=1 -> full ring.
    // Reuses the previous geometry when the visible fraction hasn't
    // meaningfully changed, to avoid per-frame churn.
    _rebuildInnerRingGeometry(progress) {
        if (!this.specialRing || !this._innerRingRadii) return;
        const clamped = Math.max(0, Math.min(1, progress));
        // Quantise to ~1° steps so we don't rebuild the geometry on every
        // sub-pixel input change.
        const quant = Math.round(clamped * 360) / 360;
        if (quant === this._innerRingBakedProgress) return;
        this._innerRingBakedProgress = quant;

        const { innerR, outerR } = this._innerRingRadii;
        const oldGeo = this.specialRing.geometry;

        if (quant >= 1) {
            // Full ring: use a true closed RingGeometry (no explicit
            // thetaStart/thetaLength). A partial ring with thetaLength=2π
            // still emits two coincident radial edges at thetaStart, which
            // under AdditiveBlending paint a faint radial seam from center
            // to rim — visible as a "spoke" artefact at the 9 o'clock
            // anchor. The default constructor produces a ring whose first
            // and last vertex columns are stitched together, eliminating
            // that seam.
            this.specialRing.geometry = new THREE.RingGeometry(innerR, outerR, 64);
        } else {
            // Partial ring. The inner ring lives in a world-aligned group,
            // so its local axes match world axes (after the -PI/2 X-rotation).
            // Local +X = world +X (screen right), local -X = world -X
            // (screen left = "9 o'clock"). RingGeometry sweeps theta CCW
            // in its local XY plane, but the -PI/2 X-rotation makes us see
            // its back face from the top-down camera, so a positive
            // thetaLength reads as CCW on screen. To fill clockwise we
            // sweep with a NEGATIVE thetaLength from thetaStart=PI.
            const thetaStart = Math.PI;
            const thetaLength = -quant * Math.PI * 2;
            // Scale segment count with the visible fraction so a sliver of
            // arc still has enough subdivisions to look smooth without paying
            // the cost of a 64-segment ring when only a few degrees show.
            const segments = Math.max(8, Math.ceil(64 * Math.max(quant, 0.05)));
            this.specialRing.geometry = new THREE.RingGeometry(
                innerR, outerR, segments, 1, thetaStart, thetaLength
            );
        }
        oldGeo?.dispose();
    }

    playAttack(windupDuration = 0.1, recoverDuration = 0.2, isSpecial = false, throwSpawnDelay = 0) {
        this.attackHand = 'right';
        this.nextAttackHand = 'right';
        this.isAttacking = true; 
        this.attackPhase = 'windup';
        this.attackTimer = windupDuration;
        this.windupDuration = windupDuration;
        this.recoverDuration = recoverDuration;
        // Visual-only: extends the held-weapon pose animation window so
        // stayRatio is interpreted over (windupDuration + throwSpawnDelay).
        // The flag flips to true the moment windup ends and stays true
        // until executeThrow() (or a cancel) resets it via clearThrowSpawnDelay().
        this.throwSpawnDelay = Math.max(0, throwSpawnDelay);
        this.throwSpawnDelayActive = false;
        this.throwSpawnDelayElapsed = 0;
        this.isSpecialAttack = isSpecial;
        this._attackCountInSequence = (this._attackCountInSequence || 0) + 1;
    }

    // Called by main.js the moment the windup ends and the configured
    // "weapon spawn delay" window begins. Keeps the held-weapon visual
    // animation running smoothly across windup-end into the delay.
    beginThrowSpawnDelay() {
        this.throwSpawnDelayActive = true;
        this.throwSpawnDelayElapsed = 0;
    }

    // Called by main.js when the spawn-delay window ends — either because
    // executeThrow() finally fired, or because the throw was cancelled /
    // interrupted. Pose animation collapses back to its non-delayed form.
    clearThrowSpawnDelay() {
        this.throwSpawnDelay = 0;
        this.throwSpawnDelayActive = false;
        this.throwSpawnDelayElapsed = 0;
    }

    // Reset the attack sequence counter (always uses right hand).
    resetAttackSequence() {
        this.nextAttackHand = 'right';
        this._attackCountInSequence = 0;
    }

    // Abort the current recover (backswing) phase immediately so a new attack can start
    // on the same frame. Only safe to call during 'recover' — windup must never be
    // interrupted because that is when the weapon is actually thrown.
    // Returns true if an interruption actually happened.
    interruptRecover() {
        if (this.isAttacking && this.attackPhase === 'recover') {
            this.isAttacking = false;
            this.attackPhase = 'none';
            this.attackTimer = 0;
            this.attackFacingAngle = null;
            this.throwSpawnDelay = 0;
            this.throwSpawnDelayActive = false;
            this.throwSpawnDelayElapsed = 0;
            return true;
        }
        return false;
    }

    // Hard-snap the player out of any attack pose. Unlike interruptRecover(),
    // which only flips state flags and lets the next-frame lerp unwind the
    // pose smoothly, this method also resets every rotation/position that the
    // attack branch manipulates directly to its neutral value — so on the
    // very next animation frame the running branch starts blending from a
    // clean T-pose rather than from the middle of a windup crouch. The
    // caller is main.js at the moment the player switches from stationary
    // to moving; we want zero visual overlap between attack and run.
    //
    // NOTE: this does NOT touch main.js's windupTimer / isWindupActive. Those
    // are independent; if a throw was pending, main.js will either commit it
    // (only if isMoving is false when the windup timer elapses) or cancel
    // it via _cancelPendingThrow(). Resetting isAttacking here just makes
    // _updateAnimation_main treat the player as "not attacking" from this
    // frame onward so the running gait can own the pose.
    snapOutOfAttackPose() {
        const wasAttacking = this.isAttacking;
        // Clear logical attack state.
        this.isAttacking = false;
        this.attackPhase = 'none';
        this.attackTimer = 0;
        this.attackFacingAngle = null;
        this.isCatching = false;
        this.catchTimer = 0;
        // Also clear the held-weapon pose-extension state so the weapon
        // model (if any) hides immediately when the player breaks out of
        // the attack pose.
        this.throwSpawnDelay = 0;
        this.throwSpawnDelayActive = false;
        this.throwSpawnDelayElapsed = 0;

        if (!wasAttacking) return;

        // Hard-reset all joints that the attack branch drives. Running
        // branch will immediately start lerping these toward the gait
        // targets, so a single frame of "T-pose" is functionally invisible
        // and far better than the ugly cross-fade of attack→run poses.
        this.upperBodyGroup.rotation.set(0, 0, 0);
        this.hipPivotGroup.rotation.set(0, 0, 0);
        this.bodyGroup.position.y = 0.25; // neutral standing height
        this.legsAnchorGroup.position.y = 0.25; // keep hip anchor glued to body
        this.legsAnchorGroup.rotation.set(0, 0, 0); // clear hip-follow twist/lean

        this.leftArm.rotation.set(0, 0, 0);
        this.rightArm.rotation.set(0, 0, 0);
        this.leftForearm.rotation.set(0, 0, 0);
        this.rightForearm.rotation.set(0, 0, 0);

        // Also clear the fencing-stance leg rotations so the running gait
        // doesn't briefly inherit the stance on the first moving frame.
        // (Leg-root Z spread is left to the running branch to lerp back to
        //  zero smoothly; snapping it here would pop the feet together.)
        this.leftLeg.rotation.set(0, 0, 0);
        this.rightLeg.rotation.set(0, 0, 0);
        this.leftLowerLeg.rotation.set(0, 0, 0);
        this.rightLowerLeg.rotation.set(0, 0, 0);

        // 已移除手上、背上的武器模型组（无需再处理武器位姿）。
    }

    // Read attack-posture parameters from CONFIG for current attack variant (special vs normal).
    // attackSide: +1 for right-hand throw, -1 for left-hand throw (mirrors Y twist / Z lean).
    _getAttackPostureParams(attackSide) {
        const s = this.isSpecialAttack;
        return {
            // Upper-body rotation targets (lerp'd onto upperBodyGroup.rotation)
            leanBackX:    s ? (CONFIG.attackLeanBackXSpecial    ?? -0.95) : (CONFIG.attackLeanBackX    ?? -0.65),
            twistBackY:  (s ? (CONFIG.attackTwistBackYSpecial   ?? -1.45) : (CONFIG.attackTwistBackY   ?? -1.05)) * attackSide,
            leanSideZ:   (s ? (CONFIG.attackLeanSideZSpecial    ??  0.38) : (CONFIG.attackLeanSideZ    ??  0.28)) * attackSide,
            throwForwardX:s ? (CONFIG.attackThrowForwardXSpecial ?? 1.18) : (CONFIG.attackThrowForwardX ?? 0.95),
            throwTwistY: (s ? (CONFIG.attackThrowTwistYSpecial  ??  1.02) : (CONFIG.attackThrowTwistY  ??  0.78)) * attackSide,
            throwSideZ:  (s ? (CONFIG.attackThrowSideZSpecial   ?? -0.30) : (CONFIG.attackThrowSideZ   ?? -0.22)) * attackSide,
            burstRatio:   s ? (CONFIG.attackBurstRatioSpecial   ??  0.42) : (CONFIG.attackBurstRatio   ??  0.38),
            // Body vertical dip/lift amplitudes (bodyGroup.y delta relative to 0.25)
            bodyDipWindup: s ? (CONFIG.attackBodyDipWindupSpecial ?? 0.08) : (CONFIG.attackBodyDipWindup ?? 0.05),
            bodyLiftThrow: s ? (CONFIG.attackBodyLiftThrowSpecial ?? 0.13) : (CONFIG.attackBodyLiftThrow ?? 0.08),
            // Hip (bodyGroup) rotation: partial twist/lean that propagates to legs & tail
            hipTwistBackY:  (s ? (CONFIG.attackHipTwistBackYSpecial  ?? -0.32) : (CONFIG.attackHipTwistBackY  ?? -0.22)) * attackSide,
            hipLeanSideZ:   (s ? (CONFIG.attackHipLeanSideZSpecial   ??  0.15) : (CONFIG.attackHipLeanSideZ   ??  0.10)) * attackSide,
            hipThrowTwistY: (s ? (CONFIG.attackHipThrowTwistYSpecial ??  0.25) : (CONFIG.attackHipThrowTwistY ??  0.18)) * attackSide,
            hipThrowSideZ:  (s ? (CONFIG.attackHipThrowSideZSpecial  ?? -0.12) : (CONFIG.attackHipThrowSideZ  ?? -0.08)) * attackSide,
        };
    }

    // Returns an eased 0..1 progress for the windup phase that:
    // 1. Rapidly rises to 1 within the "rise" portion (1 - holdRatio)
    // 2. Stays pinned at 1 during the final "hold" portion (holdRatio)
    // This emphasizes the javelin-style held-high moment before the throw.
    getWindupEased() {
        const raw = 1 - (this.attackTimer / this.windupDuration);
        const holdRatio = this.isSpecialAttack
            ? (CONFIG.attackWindupHoldRatioSpecial ?? 0.55)
            : (CONFIG.attackWindupHoldRatio ?? 0.45);
        const riseEnd = Math.max(0.001, 1 - holdRatio);
        if (raw >= riseEnd) return 1;
        const riseProgress = raw / riseEnd;
        // easeOutCubic on the rise portion (snappy climb)
        return 1 - Math.pow(1 - riseProgress, 3);
    }

    playCatch() {
        this.isCatching = true;
        this.catchTimer = 0.3; // 仅用于武器从手上切到背上的过渡时机
        // 已移除"弹一下"接住反冲动画（身体上跳 + 上身后仰 + 接住手臂动作）
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
    
    // =======================================================================
    // Public entry point for all per-frame character animation.
    //
    // Design:
    //   * Player moves XOR attacks — they are mutually exclusive. Moving cancels
    //     any in-flight attack (-> recall), and attacking fires only when stopped.
    //   * Upper and lower body share one orientation (both face the locked enemy
    //     while attacking, both face the joystick direction while moving).
    //   * The attack animation is one unified gesture: body winds up (dip + lean
    //     back), then snaps forward (lift + throw + lunging step), then settles.
    //
    // Flow:
    //   1. _updateAnimation_preamble()  -> xray / collision debug visibility
    //   2. _updateAnimation_main()      -> all gait / pose / arm / body logic
    //   3. _updateAnimation_shared()    -> ammo ring / shadow / model tilt
    // =======================================================================
    updateAnimation(delta, time, isMoving, currentVelocity) {
        this._updateAnimation_preamble();
        this._updateAnimation_main(delta, time, isMoving, currentVelocity);
        this._updateAnimation_shared(delta, time);

        // ===== 手持武器（蓄力时）位姿与显隐 =====
        //
        // 武器挂在 this.mesh 之下，因此其变换的“参考系”就是“玩家整体朝向”
        //   - mesh 的 quaternion 仅围绕 Y 轴旋转（来自 main.js 的 facing slerp）
        //   - 所以下面写的 (position, rotation) 都解释为 “在玩家正前方为 -Z 的局部坐标系下”
        //
        // 默认朝向：让武器尖端指向 -Z（玩家正前方）、躯干平行地面。
        // createWeaponModel 内部默认的 +Z 朝尖端，所以这里用 RotY = PI 把它转 180°。
        //
        // 蓄力期间（含蓄力结束后的“武器生成延后”窗口）的 Z 轴位移动画：
        //   动画总时长 = windupDuration + throwSpawnDelay
        //     · windupDuration  = 玩家蓄力的时长
        //     · throwSpawnDelay = 蓄力结束到武器实体真正生成飞出的额外延后
        //       （即“武器生成延后时间”参数）
        //   总时长划分为两段——
        //     [0, stayRatio]      → 武器停在【默认位置】(pzBase)，静止
        //     [stayRatio, 1]      → 武器沿 Z 从默认位置滑到 (pzBase + offsetZ)，
        //                            到达总时长结束（= 真正出手）时正好抵达终点
        //   stayRatio = 0 全程都在移动；stayRatio = 1 全程静止（关闭动画）。
        //   offsetZ > 0 终点更靠后；offsetZ < 0 终点更靠前。
        //
        // 关键：把“生成延后”纳入参考时间后，武器在蓄力刚结束、还在等延后期间
        // 仍然可见且继续推进位移；直到 main.js 真正调用 executeThrow()
        // （此时 throwSpawnDelayActive 被外部清掉、attackPhase 也已是 recover）
        // 才彻底消失。
        if (this.heldWeaponRight) {
            const targetScale = this.isSpecialAttack ? 1.4 : 1.0;
            const px = CONFIG.attackWeaponHoldPosX ?? 0.10;
            const py = CONFIG.attackWeaponHoldPosY ?? 0.45;
            const pzBase = CONFIG.attackWeaponHoldPosZ ?? -0.05;
            const rx = CONFIG.attackWeaponHoldRotX ?? 0;
            const ry = CONFIG.attackWeaponHoldRotY ?? Math.PI;
            const rz = CONFIG.attackWeaponHoldRotZ ?? 0;

            const offsetZ = CONFIG.attackWeaponHoldOffsetZ ?? 0.4;
            const stayRatio = THREE.MathUtils.clamp(CONFIG.attackWeaponHoldStayRatio ?? 0.5, 0, 1);

            // 统一“蓄力进度”分母：windupDuration + throwSpawnDelay
            //   - 蓄力期间：分子 = windupDuration - attackTimer（已蓄力时间）
            //   - 延后期间：分子 = windupDuration + throwSpawnDelayElapsed
            //   - 其它阶段：进度无意义（武器也不可见）
            // throwSpawnDelay 为 0 时此分母退化为 windupDuration，行为与改前一致。
            let windupProgress = 0;
            let weaponShouldShow = false;
            const animTotal = (this.windupDuration || 0) + (this.throwSpawnDelay || 0);
            if (animTotal > 1e-6) {
                if (this.isAttacking && this.attackPhase === 'windup') {
                    const elapsedWindup = Math.max(0, this.windupDuration - this.attackTimer);
                    windupProgress = THREE.MathUtils.clamp(elapsedWindup / animTotal, 0, 1);
                    weaponShouldShow = true;
                } else if (this.throwSpawnDelayActive && this.throwSpawnDelay > 0) {
                    // 蓄力已结束、正处于“武器生成延后”窗口。
                    // 此时 attackPhase 已经是 'recover'，但视觉上武器仍要继续
                    // 沿原动画轨迹滑向终点偏移，直到真正出手为止。
                    const elapsed = (this.windupDuration || 0) + this.throwSpawnDelayElapsed;
                    windupProgress = THREE.MathUtils.clamp(elapsed / animTotal, 0, 1);
                    weaponShouldShow = true;
                }
            }

            // 在 [stayRatio, 1] 之间把 progress 重映射到 [0, 1] 作为位移进度。
            // 移动段总占比 = (1 - stayRatio)。
            //
            // 用 smoothstep（x²·(3 − 2x)）代替 easeOutCubic，原因：
            //   * easeOutCubic 在 t = 0 处导数 = 3，导致武器在 stayRatio
            //     边界从静止瞬间获得一个不小的初速度——肉眼会看到“猛动
            //     一下”的闪烁感（位置数学上连续，但速度从 0 跳到非零）。
            //   * smoothstep 在两端导数均为 0，速度无突变，过渡视觉柔和。
            //   * 终点抵达值仍是 1，与原版语义保持一致（蓄力总时长结束 =
            //     正好抵达 pzBase + offsetZ）。
            // 注：仍要 clamp linear——如果 stayRatio 极大（如 0.96）+
            // windupDur 极短，单帧步进会跨过整个移动段，clamp 兜底是必要的。
            let advance = 0;
            const moveSpan = 1 - stayRatio;
            if (moveSpan > 1e-4 && windupProgress > stayRatio) {
                const linear = THREE.MathUtils.clamp((windupProgress - stayRatio) / moveSpan, 0, 1);
                advance = linear * linear * (3 - 2 * linear); // smoothstep
            }
            // 当前 Z = 默认位置 (pzBase) → 终点 (pzBase + offsetZ) 的插值
            const pz = pzBase + offsetZ * advance;

            this.heldWeaponRight.position.set(px, py, pz);
            this.heldWeaponRight.rotation.set(rx, ry, rz);

            // 检测 hidden→visible 显示边沿：归零弹性计时器；
            // 持续显示期间累加 delta 推进弹性进度。
            // 离开显示状态时不重置（下次出现自然会触发新一轮归零）。
            if (weaponShouldShow && !this._heldWeaponWasVisible) {
                this.heldWeaponPopElapsed = 0;
            } else if (weaponShouldShow) {
                this.heldWeaponPopElapsed += delta;
            }
            this._heldWeaponWasVisible = weaponShouldShow;

            this.heldWeaponRight.visible = weaponShouldShow;
            if (this.heldWeaponRight.visible) {
                // ----- 出现弹性缩放 -----
                //
                // 在 hidden→visible 边沿把 popElapsed 归零并启动两段 easeOut：
                //   * 前 50% 时长：0 → overshoot×targetScale（快速膨胀）
                //   * 后 50% 时长：overshoot×targetScale → 1.0×targetScale（回落）
                // 路径示例 (overshoot=1.2, targetScale=1)：0 → 1.2 → 1.0
                // 关闭弹性 / 时长结束后：直接锁到 targetScale。
                //
                // 选择 easeOut（1 − (1 − t)²）让两段都“开始快、结束慢”——
                // 这样在峰值附近视觉上有“反弹卡顿”的弹性感，比线性更生动。
                const popOn = !!CONFIG.attackWeaponHoldPopEnabled;
                const popDur = Math.max(0, CONFIG.attackWeaponHoldPopDuration ?? 0);
                const overshoot = Math.max(1.0, CONFIG.attackWeaponHoldPopOvershoot ?? 1.0);
                let scaleMult = 1.0;
                if (popOn && popDur > 1e-4 && this.heldWeaponPopElapsed < popDur) {
                    const t = THREE.MathUtils.clamp(this.heldWeaponPopElapsed / popDur, 0, 1);
                    if (t < 0.5) {
                        // 前段 0..0.5 映射到 0..1，0 → overshoot
                        const a = t * 2;
                        const eased = 1 - (1 - a) * (1 - a); // easeOutQuad
                        scaleMult = overshoot * eased;
                    } else {
                        // 后段 0.5..1 映射到 0..1，overshoot → 1
                        const a = (t - 0.5) * 2;
                        const eased = 1 - (1 - a) * (1 - a); // easeOutQuad
                        scaleMult = overshoot + (1.0 - overshoot) * eased;
                    }
                }
                this.heldWeaponRight.scale.setScalar(targetScale * scaleMult);
            }
        }
    }

    // Neutral helper: xray + collision-debug visibility. Reads only
    // visual-debug CONFIG keys (xrayEnabled / showCollisionBox /
    // useCustomCollision / customCollisionRadius / playerScale).
    _updateAnimation_preamble() {
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
                this.collisionDebugMesh.position.set(0, 0.2, 0);
            } else {
                const rx = 0.08 * CONFIG.playerScale;
                const rz = 0.05 * CONFIG.playerScale;
                this.collisionDebugMesh.scale.set(rx, 0.4, rz);
                this.collisionDebugMesh.position.set(0, 0.2, rz / 2);
            }
        }
    }

    // Neutral shared tail: ammo gauge ring + blob shadow + model tilt.
    // Reads only visual / geometry CONFIG keys (showPlayerBaseRing,
    // baseRing*, modelTiltAngle, modelHeightOffset). None of these are
    // attack-mode-specific. Called after the active mode's animation.
    _updateAnimation_shared(delta, time) {
        // Ammo gauge ring: stays locked to player facing so the forward gap
        // remains in front of the player automatically (group is parented to
        // mesh and we DO NOT invert its rotation).
        if (this.baseRingGroup) {
            const visible = CONFIG.showPlayerBaseRing !== false;
            this.baseRingGroup.visible = visible;
            const ringScale = 1.0 + Math.sin(time * 4) * 0.03;
            this.baseRingGroup.scale.set(ringScale, 1, ringScale);

            // Keep the world-aligned inner-ring group glued to the player's
            // XZ position. We DON'T copy mesh.quaternion onto it (that's the
            // whole point: the inner ring must stay world-aligned so its
            // 9 o'clock anchor stays at the screen-left side regardless of
            // which way the player faces). We do copy the player's world
            // scale so the ring scales together with playerScale config.
            if (this.innerRingGroup) {
                this.innerRingGroup.visible = visible;
                this.innerRingGroup.position.x = this.mesh.position.x;
                this.innerRingGroup.position.z = this.mesh.position.z;
                // Y kept slightly above the ground, matching baseRingGroup.
                this.innerRingGroup.position.y = this.mesh.position.y + 0.02 * (this.mesh.scale.y || 1);
                const playerScaleX = this.mesh.scale.x || 1;
                const playerScaleZ = this.mesh.scale.z || 1;
                this.innerRingGroup.scale.set(
                    ringScale * playerScaleX,
                    1,
                    ringScale * playerScaleZ
                );
            }

            // Rebuild geometry if any radius/thickness CONFIG changed (live tuning).
            const cache = this._baseRingGeomCache;
            const liveArcOuterR = CONFIG.baseRingArcOuterR ?? 0.35;
            const liveArcThick = CONFIG.baseRingArcThickness ?? 0.035;
            const liveInnerOuterR = CONFIG.baseRingInnerRingOuterR ?? 0.24;
            const liveInnerThick = CONFIG.baseRingInnerRingThickness ?? 0.065;
            if (cache.arcOuterR !== liveArcOuterR ||
                cache.arcThickness !== liveArcThick ||
                cache.innerRingOuterR !== liveInnerOuterR ||
                cache.innerRingThickness !== liveInnerThick) {
                this.buildBaseRing();
            }

            // Live tuning of the underlying bg disc (lavender base plate) radius.
            const liveBgRadius = CONFIG.baseRingBgRadius ?? 0.45;
            if (this.baseRingBgMesh && this._baseRingGeomCacheBgRadius !== liveBgRadius) {
                const segs = this._baseRingBgSegments || 32;
                const oldGeo = this.baseRingBgMesh.geometry;
                this.baseRingBgMesh.geometry = new THREE.CircleGeometry(liveBgRadius * 0.95, segs);
                if (oldGeo && typeof oldGeo.dispose === 'function') oldGeo.dispose();
                this._baseRingGeomCacheBgRadius = liveBgRadius;
            }

            // --- New foot-ring behaviour ---
            // Outer 3 green arcs: pure decoration, always lit at full
            // opacity. They no longer respond to the throw cycle.
            // Inner yellow ring: behaves as a recall-progress gauge.
            //   * No weapons deployed       -> full ring, fully lit (idle)
            //   * Weapons deployed, progress=0 (standing still after throw)
            //                               -> hidden
            //   * 0 < progress < 1          -> fills clockwise from 9 o'clock
            //   * progress >= 1             -> full ring (recall just triggered)

            const fadeDur = Math.max(0.01, CONFIG.baseRingFadeDuration ?? 0.25);
            const alpha = 1 - Math.exp(-delta / (fadeDur * 0.5));
            const lerp = THREE.MathUtils.lerp;

            const normalArcColor = new THREE.Color(0x91c53a);
            const specialColor = new THREE.Color(0xfff0a0);
            const activeOpacity = 0.9;
            const activeSpecialOpacity = 0.85;

            // Outer arcs: always at activeOpacity, green.
            if (this.ammoArcs && this._baseRingAnim.arcs.length === this.ammoArcs.length) {
                for (let i = 0; i < this.ammoArcs.length; i++) {
                    const state = this._baseRingAnim.arcs[i];
                    state.opacity = lerp(state.opacity, activeOpacity, alpha);
                    state.r = lerp(state.r, normalArcColor.r, alpha);
                    state.g = lerp(state.g, normalArcColor.g, alpha);
                    state.b = lerp(state.b, normalArcColor.b, alpha);
                    const mat = this.ammoArcs[i].material;
                    mat.opacity = state.opacity;
                    mat.color.setRGB(state.r, state.g, state.b);
                    this.ammoArcs[i].visible = true;
                }
            }

            // Inner ring: pure movement-progress gauge.
            //   * shown    = main.js sends true while the player is moving
            //   * progress = how full the arc is right now (0..1)
            // When fading out (shown=false) we keep displaying the LAST
            // drawn arc so the geometry doesn't snap back to 0% before the
            // alpha envelope finishes; the next reveal naturally takes over.
            if (this.specialRing && this._baseRingAnim.special) {
                const shown = !!this.indicatorShown;
                const progress = Math.max(0, Math.min(1, this.indicatorRecallProgress || 0));

                let drawnProgress;
                if (shown) {
                    drawnProgress = progress;
                } else {
                    drawnProgress = this._innerRingBakedProgress > 0
                        ? this._innerRingBakedProgress
                        : progress;
                }

                this._rebuildInnerRingGeometry(drawnProgress);

                // Smooth visibility envelope (0..1) using the same
                // framerate-independent exponential lerp as the color/opacity
                // channels, but with a slightly longer time-constant so the
                // fade reads as deliberate rather than as a hidden lag.
                const state = this._baseRingAnim.special;
                if (state.visibility === undefined) {
                    state.visibility = shown ? 1 : 0;
                }
                const visFadeDur = Math.max(0.01, (CONFIG.baseRingFadeDuration ?? 0.25) * 1.4);
                const visAlpha = 1 - Math.exp(-delta / (visFadeDur * 0.5));
                state.visibility = lerp(state.visibility, shown ? 1 : 0, visAlpha);

                state.opacity = lerp(state.opacity, activeSpecialOpacity, alpha);
                state.r = lerp(state.r, specialColor.r, alpha);
                state.g = lerp(state.g, specialColor.g, alpha);
                state.b = lerp(state.b, specialColor.b, alpha);

                const mat = this.specialRing.material;
                mat.opacity = state.opacity * state.visibility;
                mat.color.setRGB(state.r, state.g, state.b);

                // Cull the mesh once it's effectively invisible to avoid
                // paying for a fully-transparent additive draw call.
                this.specialRing.visible = state.visibility > 0.005;
            }
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

        // --- 模型倾斜（tiltGroup）：在世界空间中始终朝屏幕上方（-Z）方向倾斜，不随玩家Y轴旋转变化 ---
        if (this.tiltGroup) {
            const tiltDeg = CONFIG.modelTiltAngle || 0;
            const heightOff = CONFIG.modelHeightOffset || 0;

            if (tiltDeg !== 0) {
                const tiltRad = THREE.MathUtils.degToRad(tiltDeg);
                // 提取 mesh 的 Y 轴旋转角（yaw）；复用模块 scratch
                _scratchEuler.setFromQuaternion(this.mesh.quaternion, 'YXZ');
                const meshYaw = _scratchEuler.y;
                _scratchQYawInv.setFromAxisAngle(_UNIT_Y, -meshYaw);
                _scratchQTilt.setFromAxisAngle(_UNIT_X, tiltRad);
                _scratchQYaw.setFromAxisAngle(_UNIT_Y, meshYaw);
                this.tiltGroup.quaternion.copy(_scratchQYawInv).multiply(_scratchQTilt).multiply(_scratchQYaw);
            } else {
                this.tiltGroup.quaternion.identity();
            }

            // 模型离地高度偏移
            this.tiltGroup.position.y = heightOff;
        }
    }

    // =======================================================================
    // Main per-frame character animation.
    //
    // Branches:
    //   A) isMoving && !isAttacking  (running)
    //      -> Gait loop (legs swing, body bob, arms pump). No attack overlay.
    //   B) otherwise                 (stationary or attacking)
    //      -> Idle or attack. Upper AND lower body drive the attack gesture:
    //         windup: dip + lean back + plant-leg loads + rear leg plants
    //         burst : snap forward + lift + plant leg straightens + rear
    //                 leg kicks forward (lunging step)
    //         settle: relax back to a neutral standing pose
    //
    // Moving and attacking are mutually exclusive by design (see main.js),
    // so the two branches never run the same frame.
    // =======================================================================
    _updateAnimation_main(delta, time, isMoving, currentVelocity) {
        // --- Attack-timer tick ---
        if (this.isAttacking) {
            this.attackTimer -= delta;
            if (this.attackTimer <= 0) {
                if (this.attackPhase === 'windup') {
                    this.attackPhase = 'recover';
                    this.attackTimer = this.recoverDuration;
                } else {
                    this.isAttacking = false;
                    this.attackPhase = 'none';
                    this.attackFacingAngle = null;
                }
            }
        }
        // While main.js is holding the weapon-spawn-delay window open
        // (between windup-end and the actual feather spawn), advance the
        // elapsed counter so the held-weapon pose animation can use it
        // as the tail of its unified (windupDur + spawnDelay) window.
        if (this.throwSpawnDelayActive && this.throwSpawnDelay > 0) {
            this.throwSpawnDelayElapsed = Math.min(
                this.throwSpawnDelay,
                this.throwSpawnDelayElapsed + delta
            );
        }

        const isRunning = isMoving && !this.isAttacking;

        if (isRunning) {
            // --- Advance walk phase with raw step frequency. ---
            let speedMagnitude = 0;
            let isSharpTurning = false;
            const maxMoveAnimSpeed = ((CONFIG.maxMoveSpeedX ?? 8.0) + (CONFIG.maxMoveSpeedZ ?? 8.0)) * 0.5;
            if (currentVelocity) {
                speedMagnitude = currentVelocity.length();
                let animSpeed = speedMagnitude;
                if (animSpeed < 0.1) animSpeed = maxMoveAnimSpeed;

                if (this.lastMoveDirection && this.lastMoveDirection.lengthSq() > 0 && speedMagnitude > 0.1) {
                    const currentDir = currentVelocity.clone().normalize();
                    const intendedDir = this.lastMoveDirection.clone().normalize();
                    if (currentDir.dot(intendedDir) < 0.5) isSharpTurning = true;
                }

                if (!isSharpTurning) {
                    const stepFreq = CONFIG.runStepFreq !== undefined ? CONFIG.runStepFreq : 1.5;
                    this.walkPhase += delta * animSpeed * stepFreq;
                }
                this.smokeTrailDistance += speedMagnitude * delta;
            } else {
                // No velocity data: gentle phase advance so idle-walking
                // doesn't freeze if called with null velocity.
                this.walkPhase += delta * maxMoveAnimSpeed;
            }

            const burst = CONFIG.runBurst !== undefined ? CONFIG.runBurst : 0.2;
            const wp = this.walkPhase + burst * Math.sin(this.walkPhase * 2.0);
            const sinVal = Math.sin(wp);
            const cosVal = Math.cos(wp);
            const animSpeedForScale = speedMagnitude < 0.1 ? maxMoveAnimSpeed : speedMagnitude;
            const animScale = animSpeedForScale / 10;

            const forwardAmp  = (CONFIG.runLegSwingForward  !== undefined ? CONFIG.runLegSwingForward  : 1.2) * animScale;
            const backwardAmp = (CONFIG.runLegSwingBackward !== undefined ? CONFIG.runLegSwingBackward : 0.5) * animScale;

            // --- Reset leg-root positions to default (no fencing stance while running) ---
            // The stationary branch sets leftLeg/rightLeg.position.z to spread
            // the feet front-to-back. When we start running those offsets
            // are lerped back to 0 so the feet smoothly close rather than
            // snapping together.
            this.leftLeg.position.x = 0.055;
            this.leftLeg.position.y = -0.05;
            this.leftLeg.position.z = THREE.MathUtils.lerp(this.leftLeg.position.z, 0, delta * 18);
            this.rightLeg.position.x = -0.055;
            this.rightLeg.position.y = -0.05;
            this.rightLeg.position.z = THREE.MathUtils.lerp(this.rightLeg.position.z, 0, delta * 18);

            // --- Legs swing ---
            const legSwingL = (sinVal < 0 ? sinVal * forwardAmp : sinVal * backwardAmp);
            const kneeBendL = Math.max(0, -cosVal * 1.8 * animScale);
            const sinR = -sinVal, cosR = -cosVal;
            const legSwingR = (sinR < 0 ? sinR * forwardAmp : sinR * backwardAmp);
            const kneeBendR = Math.max(0, -cosR * 1.8 * animScale);
            this.leftLeg.rotation.x = legSwingL;
            this.rightLeg.rotation.x = legSwingR;
            this.leftLowerLeg.rotation.x = kneeBendL;
            this.rightLowerLeg.rotation.x = kneeBendR;

            // --- Upper body sway (running; no attack posture since !isAttacking) ---
            const upShake    = CONFIG.runBodyUpShake !== undefined ? CONFIG.runBodyUpShake : 0.15;
            const swayAmount = CONFIG.runBodySway   !== undefined ? CONFIG.runBodySway    : 0.15;
            const twistAmt   = CONFIG.runBodyTwist  !== undefined ? CONFIG.runBodyTwist   : 0.15;
            let targetBodyRotX = 0.15 - Math.abs(Math.sin(wp)) * upShake;
            let targetBodyRotY = Math.sin(wp) * twistAmt;
            let targetBodyRotZ = Math.sin(wp) * swayAmount;

            if (!this.isCatching) {
                this.upperBodyGroup.rotation.x = THREE.MathUtils.lerp(this.upperBodyGroup.rotation.x, targetBodyRotX, delta * 20);
                this.upperBodyGroup.rotation.y = THREE.MathUtils.lerp(this.upperBodyGroup.rotation.y, targetBodyRotY, delta * 20);
                this.upperBodyGroup.rotation.z = THREE.MathUtils.lerp(this.upperBodyGroup.rotation.z, targetBodyRotZ, delta * 22);
            }

            // --- Bounce (body vertical) + reset hip pivot rotation from attack ---
            const targetBounce = isSharpTurning ? 0 : Math.abs(Math.cos(wp)) * (CONFIG.playerBounce !== undefined ? CONFIG.playerBounce : 0.18);
            this.bodyGroup.position.y = THREE.MathUtils.lerp(this.bodyGroup.position.y, 0.25 + targetBounce, delta * 22);
            // Keep legs glued to the body vertically so the pelvis doesn't
            // gap open as the run bounce pushes the torso up and down.
            this.legsAnchorGroup.position.y = this.bodyGroup.position.y;
            this.hipPivotGroup.rotation.y = THREE.MathUtils.lerp(this.hipPivotGroup.rotation.y, 0, delta * 16);
            this.hipPivotGroup.rotation.z = THREE.MathUtils.lerp(this.hipPivotGroup.rotation.z, 0, delta * 16);
            // Also lerp legsAnchorGroup rotation back to 0 (may have been
            // non-zero from the stationary branch's hip-follow coupling).
            this.legsAnchorGroup.rotation.y = THREE.MathUtils.lerp(this.legsAnchorGroup.rotation.y, 0, delta * 16);
            this.legsAnchorGroup.rotation.z = THREE.MathUtils.lerp(this.legsAnchorGroup.rotation.z, 0, delta * 16);

            // --- Arms: run swing (no attack overlay) ---
            const armSpeed = 8;
            const armSwing  = CONFIG.runArmSwing  !== undefined ? CONFIG.runArmSwing  : 0.8;
            const armSpread = CONFIG.runArmSpread !== undefined ? CONFIG.runArmSpread : 0.3;
            const targetArmL = -Math.sin(wp) * armSwing;
            const targetArmR =  Math.sin(wp) * armSwing;
            this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, targetArmL, delta * armSpeed);
            this.leftArm.rotation.z = THREE.MathUtils.lerp(this.leftArm.rotation.z, armSpread, delta * armSpeed);
            this.leftArm.rotation.y = THREE.MathUtils.lerp(this.leftArm.rotation.y, 0, delta * armSpeed);
            this.leftForearm.rotation.x = THREE.MathUtils.lerp(this.leftForearm.rotation.x, Math.min(0, targetArmL * 0.8), delta * armSpeed);
            this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, targetArmR, delta * armSpeed);
            this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, -armSpread, delta * armSpeed);
            this.rightArm.rotation.y = THREE.MathUtils.lerp(this.rightArm.rotation.y, 0, delta * armSpeed);
            this.rightForearm.rotation.x = THREE.MathUtils.lerp(this.rightForearm.rotation.x, Math.min(0, targetArmR * 0.8), delta * armSpeed);

            // Bounce indicator light (debug HUD)
            if (!this.bounceMonitorEl) {
                this.bounceMonitorEl = document.getElementById('bounce-indicator-light');
            }
            if (this.bounceMonitorEl) {
                if (isSharpTurning) {
                    this.bounceMonitorEl.style.background = '#444';
                    this.bounceMonitorEl.style.boxShadow = 'inset 0 2px 4px rgba(0,0,0,0.5)';
                    this.bounceMonitorEl.style.transform = 'scale(1)';
                } else {
                    const intensity = Math.abs(Math.cos(wp));
                    const r = Math.floor(100 + 155 * intensity);
                    const g = Math.floor(200 + 55 * intensity);
                    this.bounceMonitorEl.style.background = `rgb(${r}, ${g}, 50)`;
                    this.bounceMonitorEl.style.boxShadow = `0 0 ${12 * intensity}px rgb(${r}, ${g}, 50)`;
                    this.bounceMonitorEl.style.transform = `scale(${1 + 0.4 * intensity})`;
                }
            }

            // Step dust puffs
            if (this.lastStepPhaseIndex === undefined) this.lastStepPhaseIndex = 0;
            const currentStepIndex = Math.floor(this.walkPhase / Math.PI);
            if (Globals.particleManager && speedMagnitude > 2.5 && currentStepIndex > this.lastStepPhaseIndex) {
                const moveDir = currentVelocity.clone().normalize();
                const smokePos = this.mesh.position.clone()
                    .addScaledVector(moveDir, -0.05 * CONFIG.playerScale);
                Globals.particleManager.spawnDustPuff(smokePos, moveDir, 0.5 * CONFIG.playerScale);
                this.lastStepPhaseIndex = currentStepIndex;
            }

            // Tail IK + catch timer + weapon visibility
            this._updateAnimation_tail(delta, time, /*wasRunningBranch*/ true);
            return;
        }

        // ================ STATIONARY BRANCH (attack / idle in place) ================

        this.walkPhase = 0;
        this.smokeTrailDistance = 0;
        this.lastStepPhaseIndex = 0;

        // --- Read posture params for current attack variant ---
        const attackSide = this.attackHand === 'left' ? -1 : 1;
        const posture = this._getAttackPostureParams(attackSide);

        // Pre-compute phase helpers for later leg/body sections so we
        // don't duplicate the progress math.
        // phaseKind: 'idle' | 'windup' | 'burst' | 'settle'
        // phaseT:    0..1 progress within the current phase
        let phaseKind = 'idle';
        let phaseT = 0;
        if (this.isAttacking) {
            if (this.attackPhase === 'windup') {
                phaseKind = 'windup';
                phaseT = this.getWindupEased();
            } else if (this.attackPhase === 'recover') {
                const progress = 1 - (this.attackTimer / this.recoverDuration);
                if (progress < posture.burstRatio) {
                    phaseKind = 'burst';
                    phaseT = progress / posture.burstRatio;
                } else {
                    phaseKind = 'settle';
                    phaseT = (progress - posture.burstRatio) / Math.max(0.001, 1 - posture.burstRatio);
                }
            }
        }

        // --- Legs: lunge stance with bent knees ---
        //
        // Design (per user spec):
        //   1. Idle stance = forward lunge: FRONT thigh tilts forward and
        //      its knee bends sharply, so the shin comes back down and the
        //      foot lands forward of the hip. REAR thigh tilts slightly
        //      back with mild knee bend; the rear foot rests behind. This
        //      naturally produces a visible "bow stance" with clear knee
        //      flexion (not two stiff sticks).
        //   2. During attack, thighs and knees are allowed to move on top
        //      of the stance base, BUT the extra amplitude is kept small
        //      and the knee bends in lockstep with the thigh so the foot
        //      only drifts by a small amount relative to the hip.
        //   3. The leg root nodes stay at their rig defaults (±0.055, -0.05,
        //      0). The visible front-back foot separation comes entirely
        //      from thigh rotation, NOT from translating the hip sideways.
        //
        // plantLeg = leg opposite throwing hand = FRONT leg;
        // rearLeg  = leg on throwing-hand side  = REAR leg.
        const plantLegIsLeft = attackSide === 1;
        const plantLeg       = plantLegIsLeft ? this.leftLeg : this.rightLeg;
        const plantKnee      = plantLegIsLeft ? this.leftLowerLeg : this.rightLowerLeg;
        const rearLeg        = plantLegIsLeft ? this.rightLeg : this.leftLeg;
        const rearKnee       = plantLegIsLeft ? this.rightLowerLeg : this.leftLowerLeg;

        // Leg root positions: back to rig defaults (no Z spread trick).
        // Lerp position.z so stationary→running transitions smoothly if any
        // residual Z offset exists from older animation state.
        plantLeg.position.x = plantLegIsLeft ? 0.055 : -0.055;
        plantLeg.position.y = -0.05;
        plantLeg.position.z = THREE.MathUtils.lerp(plantLeg.position.z, 0, delta * 20);
        rearLeg.position.x  = plantLegIsLeft ? -0.055 : 0.055;
        rearLeg.position.y  = -0.05;
        rearLeg.position.z  = THREE.MathUtils.lerp(rearLeg.position.z, 0, delta * 20);

        // --- Stance base angles (idle posture) ---
        //
        // SIGN CONVENTION (user-facing, all params are positive = intuitive):
        //   stanceFrontThigh > 0  → front foot goes forward
        //   stanceFrontKnee  > 0  → front knee bends (shin folds back toward hip)
        //   stanceRearThigh  > 0  → rear foot goes backward
        //   stanceRearKnee   > 0  → rear knee bends (mild)
        //
        // In Three.js: leg.rotation.x > 0 rotates the leg so the FOOT ends up
        // at -Z (i.e. BACKWARD, since the character faces +Z). So to make
        // the front foot go forward, we apply a NEGATIVE rotation, and to
        // make the rear foot go backward, we apply a POSITIVE rotation.
        // The knee (lowerLeg) is the opposite: front knee bend needs the
        // shin to rotate so its free end goes BACK toward the hip → positive
        // rotation.x.
        const stanceFrontThigh = CONFIG.attackStanceFrontThigh ?? 0.32;
        const stanceFrontKnee  = CONFIG.attackStanceFrontKnee  ?? 0.55;
        const stanceRearThigh  = CONFIG.attackStanceRearThigh  ?? 0.15;
        const stanceRearKnee   = CONFIG.attackStanceRearKnee   ?? 0.25;

        const plantBaseThigh = -stanceFrontThigh;  // foot forward  (-x rotation)
        const plantBaseKnee  = +stanceFrontKnee;   // shin folds back toward hip
        const rearBaseThigh  = +stanceRearThigh;   // foot backward (+x rotation)
        const rearBaseKnee   = +stanceRearKnee;    // shin folds back toward hip (mild)

        // --- Attack overlay deltas (user-facing sign convention) ---
        //   windupThigh/Knee > 0  → weight shifts BACK + deeper coil (both knees bend more)
        //   throwThigh/Knee  > 0  → weight drives FORWARD + knees straighten (extension push)
        const windupThighD = CONFIG.attackLegWindupThigh ?? 0.08;
        const windupKneeD  = CONFIG.attackLegWindupKnee  ?? 0.10;
        const throwThighD  = CONFIG.attackLegThrowThigh  ?? 0.10;
        const throwKneeD   = CONFIG.attackLegThrowKnee   ?? 0.18;

        // weightShift: +1.0 = fully back (windup peak), -1.0 = fully forward (throw peak)
        // kneeCoil:    +1.0 = deeply bent (windup peak), -1.0 = fully extended (throw peak)
        let weightShift = 0, kneeCoil = 0;
        if (phaseKind === 'windup') {
            weightShift = THREE.MathUtils.lerp(0, +windupThighD, phaseT);
            kneeCoil    = THREE.MathUtils.lerp(0, +windupKneeD,  phaseT);
        } else if (phaseKind === 'burst') {
            const eased = phaseT * (2 - phaseT);
            weightShift = THREE.MathUtils.lerp(+windupThighD, -throwThighD, eased);
            kneeCoil    = THREE.MathUtils.lerp(+windupKneeD,  -throwKneeD,  eased);
        } else if (phaseKind === 'settle') {
            const eased = phaseT * (2 - phaseT);
            weightShift = THREE.MathUtils.lerp(-throwThighD, 0, eased);
            kneeCoil    = THREE.MathUtils.lerp(-throwKneeD,  0, eased);
        }

        // Apply deltas:
        //   weightShift > 0 (back) → front foot lifts a bit (thigh rotates
        //     less negative = +x delta on plant thigh); rear foot digs in
        //     (thigh rotates more positive = +x delta on rear thigh too).
        //     So BOTH thighs shift in +x by weightShift.
        //   kneeCoil > 0 (deeper) → both knees bend more = +x delta on both
        //     lower legs (plant knee more positive, rear knee more positive).
        const targetPlantThigh = plantBaseThigh + weightShift;
        const targetPlantKnee  = plantBaseKnee  + kneeCoil;
        const targetRearThigh  = rearBaseThigh  + weightShift;
        const targetRearKnee   = rearBaseKnee   + kneeCoil * 0.5; // rear knee less reactive

        const legLerp = (phaseKind === 'burst') ? 26 : 18;
        plantLeg.rotation.x  = THREE.MathUtils.lerp(plantLeg.rotation.x,  targetPlantThigh, delta * legLerp);
        plantKnee.rotation.x = THREE.MathUtils.lerp(plantKnee.rotation.x, targetPlantKnee,  delta * legLerp);
        rearLeg.rotation.x   = THREE.MathUtils.lerp(rearLeg.rotation.x,   targetRearThigh,  delta * legLerp);
        rearKnee.rotation.x  = THREE.MathUtils.lerp(rearKnee.rotation.x,  targetRearKnee,   delta * legLerp);

        // --- Upper body rotation targets ---
        let targetBodyRotX = 0;
        let targetBodyRotY = 0;
        let targetBodyRotZ = 0;

        // --- Hip (bodyGroup) rotation targets: partial follow of upper-body twist/lean ---
        // This drives the pelvis, which propagates to legs and tail base.
        let targetHipRotY = 0;
        let targetHipRotZ = 0;

        if (phaseKind === 'windup') {
            targetBodyRotX = THREE.MathUtils.lerp(0, posture.leanBackX, phaseT);
            targetBodyRotY = THREE.MathUtils.lerp(0, posture.twistBackY, phaseT);
            targetBodyRotZ = THREE.MathUtils.lerp(0, posture.leanSideZ, phaseT);
            targetHipRotY  = THREE.MathUtils.lerp(0, posture.hipTwistBackY, phaseT);
            targetHipRotZ  = THREE.MathUtils.lerp(0, posture.hipLeanSideZ, phaseT);
        } else if (phaseKind === 'burst') {
            const eased = phaseT * phaseT;
            targetBodyRotX = THREE.MathUtils.lerp(posture.leanBackX, posture.throwForwardX, eased);
            targetBodyRotY = THREE.MathUtils.lerp(posture.twistBackY, posture.throwTwistY, eased);
            targetBodyRotZ = THREE.MathUtils.lerp(posture.leanSideZ, posture.throwSideZ, eased);
            targetHipRotY  = THREE.MathUtils.lerp(posture.hipTwistBackY, posture.hipThrowTwistY, eased);
            targetHipRotZ  = THREE.MathUtils.lerp(posture.hipLeanSideZ, posture.hipThrowSideZ, eased);
        } else if (phaseKind === 'settle') {
            const eased = phaseT * (2 - phaseT);
            targetBodyRotX = THREE.MathUtils.lerp(posture.throwForwardX, 0, eased);
            targetBodyRotY = THREE.MathUtils.lerp(posture.throwTwistY, 0, eased);
            targetBodyRotZ = THREE.MathUtils.lerp(posture.throwSideZ, 0, eased);
            targetHipRotY  = THREE.MathUtils.lerp(posture.hipThrowTwistY, 0, eased);
            targetHipRotZ  = THREE.MathUtils.lerp(posture.hipThrowSideZ, 0, eased);
        }
        // else idle: stays at 0.

        // Apply upper-body rotation (catch recoil takes over rotation.x in catching branch below)
        if (!this.isCatching) {
            this.upperBodyGroup.rotation.x = THREE.MathUtils.lerp(this.upperBodyGroup.rotation.x, targetBodyRotX, delta * 20);
            this.upperBodyGroup.rotation.y = THREE.MathUtils.lerp(this.upperBodyGroup.rotation.y, targetBodyRotY, delta * 20);
            this.upperBodyGroup.rotation.z = THREE.MathUtils.lerp(this.upperBodyGroup.rotation.z, targetBodyRotZ, delta * 22);
        }

        // Apply hip rotation on the hipPivotGroup: twist and side-lean that carries
        // upper body, legs & tail — pivoting around the LEFT FOOT (planted foot),
        // not the body center. This produces a more natural throwing motion.
        // Also keep pivot offset synced with runtime CONFIG (so it stays tunable).
        const lfx = CONFIG.attackLeftFootPivotX ?? 0.055;
        const lfz = CONFIG.attackLeftFootPivotZ ?? 0.0;
        if (this.hipPivotGroup.position.x !== lfx || this.hipPivotGroup.position.z !== lfz) {
            this.hipPivotGroup.position.x = lfx;
            this.hipPivotGroup.position.z = lfz;
            // counter-translate bodyGroup so neutral pose is unchanged
            this.bodyGroup.position.x = -lfx;
            this.bodyGroup.position.z = -lfz;
        }
        this.hipPivotGroup.rotation.y = THREE.MathUtils.lerp(this.hipPivotGroup.rotation.y, targetHipRotY, delta * 16);
        this.hipPivotGroup.rotation.z = THREE.MathUtils.lerp(this.hipPivotGroup.rotation.z, targetHipRotZ, delta * 16);

        // --- Body vertical: subtle idle breathing, plus attack pose dip/lift ---
        const idleShakeY   = CONFIG.idleBodyShakeY   ?? 0.03;
        const idleShakeSpd = CONFIG.idleBodyShakeSpeed ?? 3.0;
        let targetBodyY = 0.25 + Math.sin(time * idleShakeSpd) * idleShakeY;
        if (phaseKind === 'windup') {
            targetBodyY -= THREE.MathUtils.lerp(0.01, posture.bodyDipWindup, phaseT);
        } else if (phaseKind === 'burst') {
            // Lift during burst (eased, peaks near end of burst).
            const liftT = phaseT * (2 - phaseT);
            targetBodyY += THREE.MathUtils.lerp(0.025, posture.bodyLiftThrow, liftT);
        } else if (phaseKind === 'settle') {
            // Return to ground level smoothly.
            const eased = phaseT * (2 - phaseT);
            targetBodyY += THREE.MathUtils.lerp(posture.bodyLiftThrow, 0, eased);
        }
        this.bodyGroup.position.y = THREE.MathUtils.lerp(this.bodyGroup.position.y, targetBodyY, delta * 10);

        // Keep the legs' hip anchor glued to the body vertically so the
        // pelvis doesn't gap open when the body breathes / dips / lifts.
        this.legsAnchorGroup.position.y = this.bodyGroup.position.y;

        // --- Hip follow: partial rotation coupling between upper body and legs ---
        // Without this, the upper body twists / leans but the legs stay
        // locked → the waist visually snaps apart. With full 1.0 coupling
        // the feet would get swept around by the hip rotation (the original
        // problem we fixed by separating legsAnchorGroup). The fix is a
        // partial follow factor: the leg anchor inherits a FRACTION of the
        // hip's twist/lean. Feet trace a small arc (feels like the pelvis
        // delivering force down to the ground) but don't slide visibly.
        //
        // We also initialize rotation.order='YXZ' on legsAnchorGroup the
        // first time we touch it so Y-twist composes cleanly with Z-lean
        // (same convention as hipPivotGroup).
        if (this.legsAnchorGroup.rotation.order !== 'YXZ') {
            this.legsAnchorGroup.rotation.order = 'YXZ';
        }
        const hipFollowY = CONFIG.attackHipFollowY ?? 0.40; // how much the pelvis twists with the upper body
        const hipFollowZ = CONFIG.attackHipFollowZ ?? 0.35; // how much the pelvis side-leans with the upper body
        const targetAnchorY = this.hipPivotGroup.rotation.y * hipFollowY;
        const targetAnchorZ = this.hipPivotGroup.rotation.z * hipFollowZ;
        // Lerp so the anchor eases into / out of the rotation instead of
        // snapping, which further softens the foot arc.
        this.legsAnchorGroup.rotation.y = THREE.MathUtils.lerp(
            this.legsAnchorGroup.rotation.y, targetAnchorY, delta * 14
        );
        this.legsAnchorGroup.rotation.z = THREE.MathUtils.lerp(
            this.legsAnchorGroup.rotation.z, targetAnchorZ, delta * 14
        );

        // --- Bounce indicator: no gait bounce while stationary, keep dim ---
        if (!this.bounceMonitorEl) {
            this.bounceMonitorEl = document.getElementById('bounce-indicator-light');
        }
        if (this.bounceMonitorEl) {
            this.bounceMonitorEl.style.background = '#444';
            this.bounceMonitorEl.style.boxShadow = 'inset 0 2px 4px rgba(0,0,0,0.5)';
            this.bounceMonitorEl.style.transform = 'scale(1)';
        }

        // --- Tail IK + catch timer + weapon visibility ---
        const isRecallingAny = this._updateAnimation_tail(delta, time, /*wasRunningBranch*/ false);

        // --- Arms ---
        const armSpeed = this.isAttacking ? 20 : 10;
        const idleSpeed2 = 3;

        // 已移除 isCatching 期间的"弹一下"回弹动画（身体回落 + 接住手臂姿态）
        if (isRecallingAny && !this.isAttacking) {
            // Recall pose (hands reach forward to catch)
            this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, -Math.PI * 0.4, delta * 15);
            this.leftArm.rotation.z = THREE.MathUtils.lerp(this.leftArm.rotation.z, 0.1, delta * 15);
            this.leftForearm.rotation.x = THREE.MathUtils.lerp(this.leftForearm.rotation.x, -Math.PI * 0.2, delta * 15);
            this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, -Math.PI * 0.4, delta * 15);
            this.rightArm.rotation.z = THREE.MathUtils.lerp(this.rightArm.rotation.z, -0.1, delta * 15);
            this.rightForearm.rotation.x = THREE.MathUtils.lerp(this.rightForearm.rotation.x, -Math.PI * 0.2, delta * 15);
        } else if (this.isAttacking) {
            const throwArm = attackSide === 1 ? this.rightArm : this.leftArm;
            const throwForearm = attackSide === 1 ? this.rightForearm : this.leftForearm;
            const supportArm = attackSide === 1 ? this.leftArm : this.rightArm;
            const supportForearm = attackSide === 1 ? this.leftForearm : this.rightForearm;
            const supportIdleZ = attackSide * (0.1 + Math.sin(time * idleSpeed2) * 0.02);
            const throwIdleZ = -supportIdleZ;

            // Javelin wind-up tuning (Solved inversely from mesh-space targets):
            //   The body is heavily twisted during windup (~60deg Y rotation), so the arm's
            //   local rotations must COMPENSATE for that twist to achieve the desired pose
            //   in the CHARACTER-FACING frame.
            //   Target (in mesh/character frame, facing -Z):
            //     upper arm   = (-1, 0, 0)        - horizontal, pointing to character's right
            //                                       (parallel to the body's front plane, outward)
            //     forearm     = (0, 0.71, 0.71)   - at 90deg to upper arm, pointing upper-back
            //                                       (obtuse angle with forward face direction)
            //   These rotations were solved numerically with the YXZ + XYZ composition.
            //   Exposed through CONFIG.attackArmPull* for runtime tuning.
            const armPullX = this.isSpecialAttack
                ? (CONFIG.attackArmPullXSpecial ?? -Math.PI * 0.25)
                : (CONFIG.attackArmPullX        ?? -Math.PI * 0.17);
            const armPullY = (this.isSpecialAttack
                ? (CONFIG.attackArmPullYSpecial ??  Math.PI * 0.42)
                : (CONFIG.attackArmPullY        ??  Math.PI * 0.36)) * attackSide;
            const armPullZ = (this.isSpecialAttack
                ? (CONFIG.attackArmPullZSpecial ?? -Math.PI * 0.28)
                : (CONFIG.attackArmPullZ        ?? -Math.PI * 0.39)) * attackSide;

            const armThrowX = this.isSpecialAttack ? -Math.PI * 0.7 : -Math.PI * 0.58;
            const armThrowZ = -0.16 * attackSide;
            const armThrowY = -0.2 * attackSide;

            // Elbow bend (forearm perpendicular to upper arm); tunable via CONFIG.
            const elbowBendPull = this.isSpecialAttack
                ? (CONFIG.attackElbowBendPullSpecial ?? -Math.PI * 0.5)
                : (CONFIG.attackElbowBendPull        ?? -Math.PI * 0.5);
            const elbowBendThrow = 0.12;

            // --- Support arm (non-throwing hand) windup + throw-back poses ---
            // Solved inversely so that in the CHARACTER mesh frame:
            //   WINDUP: upper arm points forward, forearm horizontal across chest
            //   THROW : upper arm swings back behind the torso, forearm trails
            // Sign convention: the shoulder side of the support arm is always opposite the
            // throwing side. Y and Z rotations are mirrored via (-attackSide); X is symmetric.
            const suppWindX = this.isSpecialAttack
                ? (CONFIG.attackSupportArmWindupXSpecial ?? 0.09)
                : (CONFIG.attackSupportArmWindupX        ?? 0.0);
            const suppWindY = (this.isSpecialAttack
                ? (CONFIG.attackSupportArmWindupYSpecial ?? 0.0)
                : (CONFIG.attackSupportArmWindupY        ?? 0.0)) * (-attackSide);
            const suppWindZ = (this.isSpecialAttack
                ? (CONFIG.attackSupportArmWindupZSpecial ?? -1.31)
                : (CONFIG.attackSupportArmWindupZ        ?? -1.48)) * (-attackSide);
            const suppWindElbow = this.isSpecialAttack
                ? (CONFIG.attackSupportElbowWindupSpecial ?? -1.73)
                : (CONFIG.attackSupportElbowWindup        ?? -1.73);

            const suppThrowX = this.isSpecialAttack
                ? (CONFIG.attackSupportArmThrowXSpecial ?? -0.35)
                : (CONFIG.attackSupportArmThrowX        ?? 0.0);
            const suppThrowY = (this.isSpecialAttack
                ? (CONFIG.attackSupportArmThrowYSpecial ?? 0.0)
                : (CONFIG.attackSupportArmThrowY        ?? 0.09)) * (-attackSide);
            const suppThrowZ = (this.isSpecialAttack
                ? (CONFIG.attackSupportArmThrowZSpecial ?? -0.87)
                : (CONFIG.attackSupportArmThrowZ        ?? -1.22)) * (-attackSide);
            const suppThrowElbow = this.isSpecialAttack
                ? (CONFIG.attackSupportElbowThrowSpecial ?? -0.94)
                : (CONFIG.attackSupportElbowThrow        ?? -0.94);

            let supportArmX = 0, supportArmY = 0, supportArmZ = 0, supportForearmX = 0;
            let swingAngleX = 0, swingAngleZ = 0, swingAngleY = 0, forearmAngleX = 0;

            if (this.attackPhase === 'windup') {
                const eased = this.getWindupEased();
                supportArmX = THREE.MathUtils.lerp(0, suppWindX, eased);
                supportArmY = THREE.MathUtils.lerp(0, suppWindY, eased);
                supportArmZ = THREE.MathUtils.lerp(supportIdleZ, suppWindZ, eased);
                supportForearmX = THREE.MathUtils.lerp(0, suppWindElbow, eased);
                swingAngleX = THREE.MathUtils.lerp(throwArm.rotation.x, armPullX, eased);
                swingAngleZ = THREE.MathUtils.lerp(throwArm.rotation.z, armPullZ, eased);
                swingAngleY = THREE.MathUtils.lerp(throwArm.rotation.y, armPullY, eased);
                forearmAngleX = THREE.MathUtils.lerp(throwForearm.rotation.x, elbowBendPull, eased);
            } else {
                const progress = 1 - (this.attackTimer / this.recoverDuration);
                if (progress < 0.14) {
                    const bp = progress / 0.14;
                    const eased = bp * bp;
                    const whip = Math.pow(bp, 3);
                    // Burst phase: support arm snaps from windup pose to throw-back pose
                    supportArmX = THREE.MathUtils.lerp(suppWindX, suppThrowX, bp);
                    supportArmY = THREE.MathUtils.lerp(suppWindY, suppThrowY, bp);
                    supportArmZ = THREE.MathUtils.lerp(suppWindZ, suppThrowZ, bp);
                    supportForearmX = THREE.MathUtils.lerp(suppWindElbow, suppThrowElbow, bp);
                    swingAngleX = THREE.MathUtils.lerp(armPullX, armThrowX, eased);
                    swingAngleZ = THREE.MathUtils.lerp(armPullZ, armThrowZ, eased);
                    swingAngleY = THREE.MathUtils.lerp(armPullY, armThrowY, eased);
                    forearmAngleX = THREE.MathUtils.lerp(elbowBendPull, elbowBendThrow, whip);
                } else {
                    const sp = (progress - 0.14) / 0.86;
                    // Settle phase: ease support arm back to idle
                    supportArmX = THREE.MathUtils.lerp(suppThrowX, 0, sp);
                    supportArmY = THREE.MathUtils.lerp(suppThrowY, 0, sp);
                    supportArmZ = THREE.MathUtils.lerp(suppThrowZ, supportIdleZ, sp);
                    supportForearmX = THREE.MathUtils.lerp(suppThrowElbow, 0, sp);
                    swingAngleX = THREE.MathUtils.lerp(armThrowX, 0, sp);
                    swingAngleZ = THREE.MathUtils.lerp(armThrowZ, throwIdleZ, sp);
                    swingAngleY = THREE.MathUtils.lerp(armThrowY, 0, sp);
                    forearmAngleX = THREE.MathUtils.lerp(elbowBendThrow, 0, sp);
                }
            }

            supportArm.rotation.x = THREE.MathUtils.lerp(supportArm.rotation.x, supportArmX, delta * 24);
            supportArm.rotation.y = THREE.MathUtils.lerp(supportArm.rotation.y, supportArmY, delta * 24);
            supportArm.rotation.z = THREE.MathUtils.lerp(supportArm.rotation.z, supportArmZ, delta * 24);
            supportForearm.rotation.x = THREE.MathUtils.lerp(supportForearm.rotation.x, supportForearmX, delta * 24);

            if (this.attackPhase === 'recover' && (1 - (this.attackTimer / this.recoverDuration)) < 0.14) {
                throwArm.rotation.x = swingAngleX;
                throwArm.rotation.z = swingAngleZ;
                throwArm.rotation.y = swingAngleY;
                throwForearm.rotation.x = forearmAngleX;
            } else {
                throwArm.rotation.x = THREE.MathUtils.lerp(throwArm.rotation.x, swingAngleX, delta * 34);
                throwArm.rotation.z = THREE.MathUtils.lerp(throwArm.rotation.z, swingAngleZ, delta * 34);
                throwArm.rotation.y = THREE.MathUtils.lerp(throwArm.rotation.y, swingAngleY, delta * 34);
                throwForearm.rotation.x = THREE.MathUtils.lerp(throwForearm.rotation.x, forearmAngleX, delta * 36);
            }
        } else {
            // Idle: relaxed arms at sides with soft breathing sway
            this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, delta * armSpeed);
            this.leftArm.rotation.z = 0.1 + Math.sin(time * idleSpeed2) * 0.02;
            this.leftArm.rotation.y = THREE.MathUtils.lerp(this.leftArm.rotation.y, 0, delta * armSpeed);
            this.leftForearm.rotation.x = THREE.MathUtils.lerp(this.leftForearm.rotation.x, 0, delta * armSpeed);
            this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, 0, delta * armSpeed);
            this.rightArm.rotation.z = -0.1 - Math.sin(time * idleSpeed2) * 0.02;
            this.rightArm.rotation.y = THREE.MathUtils.lerp(this.rightArm.rotation.y, 0, delta * armSpeed);
            this.rightForearm.rotation.x = THREE.MathUtils.lerp(this.rightForearm.rotation.x, 0, delta * armSpeed);
        }
    }

    // Shared tail helper: tail IK + catch-recoil timer + weapon visibility.
    // Called from both branches of _updateAnimation_main. `isRunning`
    // selects the tail wag mode (true = walk-cycle wag, false = idle wag).
    // Returns whether any feather is currently recalling (used by the
    // stationary arm-animation branch to pick the recall pose).
    _updateAnimation_tail(delta, time, isRunning) {
        // --- Procedural IK Tail update ---
        if (this.tailWorldGroup) {
            const targetSegLength = CONFIG.tailSegLength !== undefined ? CONFIG.tailSegLength : 0.07;
            const targetRadius = CONFIG.tailRadius !== undefined ? CONFIG.tailRadius : 0.04;
            if (this.tailSegLength !== targetSegLength || this.currentTailRadius !== targetRadius) {
                this.tailSegLength = targetSegLength;
                this.currentTailRadius = targetRadius;
                for (let i = 0; i < this.numTailSegments; i++) {
                    const mesh = this.tailMeshes[i];
                    mesh.geometry.dispose();
                    const geo = new THREE.CapsuleGeometry(this.currentTailRadius, this.tailSegLength, 8, 8);
                    geo.rotateX(Math.PI / 2);
                    mesh.geometry = geo;
                }
            }
            if (!this.tailWorldGroup.parent && Globals.scene) {
                Globals.scene.add(this.tailWorldGroup);
            }
            this.tailWorldGroup.visible = this.mesh.visible;

            this.bodyGroup.updateMatrixWorld();
            // 复用模块 scratch 替代每帧 new Vector3
            const basePos = _scratchTailV1.set(0, -0.01, -0.08);
            this.bodyGroup.localToWorld(basePos);

            if (!this.tailInitialized || this.tailPoints[0].distanceToSquared(basePos) > 4.0) {
                for (let i = 0; i <= this.numTailSegments; i++) this.tailPoints[i].copy(basePos);
                this.tailInitialized = true;
            }

            // Wag amount: walk-cycle-driven when running, gentle time-based when idle.
            const wagOffset = _scratchTailV2;
            const rightDir = _scratchTailV3.set(1, 0, 0).transformDirection(this.mesh.matrixWorld).normalize();
            const wagAmount = isRunning
                ? Math.sin(this.walkPhase * 2.0) * 0.08
                : Math.sin(time * 2.5) * 0.02;
            wagOffset.copy(rightDir).multiplyScalar(wagAmount);
            this.tailPoints[0].copy(basePos).add(wagOffset);

            // playerBackward 在循环内是常量（mesh.matrixWorld 在循环内不变）→ 提到循环外
            const playerBackward = _scratchTailV4.set(0, 0, -1).transformDirection(this.mesh.matrixWorld).normalize();
            const tailSegLength = this.tailSegLength;
            for (let i = 1; i <= this.numTailSegments; i++) {
                const curr = this.tailPoints[i];
                const prev = this.tailPoints[i - 1];
                const dir = _scratchTailV5.subVectors(curr, prev);
                const dist = dir.length();
                if (dist > 0.0001) {
                    dir.multiplyScalar(1 / dist);
                    dir.lerp(playerBackward, 0.05);
                    dir.y -= 0.01;
                    dir.normalize();
                    curr.copy(prev).addScaledVector(dir, tailSegLength);
                }
            }
            for (let i = 0; i < this.numTailSegments; i++) {
                const p1 = this.tailPoints[i];
                const p2 = this.tailPoints[i + 1];
                const mesh = this.tailMeshes[i];
                mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
                mesh.lookAt(p1);
            }
        }

        // --- Catch-recoil timer ---
        // 仅保留计时状态推进，武器模型已移除，故无需切换可见性
        if (this.isCatching) {
            this.catchTimer -= delta;
            if (this.catchTimer <= 0) {
                this.isCatching = false;
            }
        }

        const isRecallingAny = Globals.feathers && Globals.feathers.some(f => f.phase === 'recalling');
        return isRecallingAny;
    }

    // Reset all transient attack / animation state. Safe to call after
    // any interruption so the next frame starts from a clean slate.
    resetAttackState() {
        this.isAttacking = false;
        this.attackPhase = 'none';
        this.attackTimer = 0;
        this.attackFacingAngle = null;
        this.attackHand = 'right';
        this.nextAttackHand = 'right';
        this.isSpecialAttack = false;
        this._attackCountInSequence = 0;
        this.walkPhase = 0;
        this.smokeTrailDistance = 0;
        this.lastStepPhaseIndex = 0;
        this.throwSpawnDelay = 0;
        this.throwSpawnDelayActive = false;
        this.throwSpawnDelayElapsed = 0;
        this._heldWeaponWasVisible = false;
        this.heldWeaponPopElapsed = 0;
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

        // Record current position（push 仍 new 一个对象，但每帧 1 次远比每帧整数组分配代价低；
        // 真正大头是下面写 BufferAttribute——已改为 in-place 写入预分配 buffer）
        const p = this.mesh.position.clone();
        p.y = 0.05;
        this.trajectoryPoints.push({ pos: p, time: this.trajectoryTime });

        // Remove points older than 3 seconds
        while (this.trajectoryPoints.length > 0 && this.trajectoryTime - this.trajectoryPoints[0].time > 3.0) {
            this.trajectoryPoints.shift();
        }
        // 安全限制：超出预分配上限时强制 drop 头部
        while (this.trajectoryPoints.length > this.TRAJECTORY_MAX_POINTS) {
            this.trajectoryPoints.shift();
        }

        // Update geometry —— in-place 写入预分配 Float32Array，仅 needsUpdate + setDrawRange
        const positions = this._trajectoryPositions;
        const n = this.trajectoryPoints.length;
        for (let i = 0; i < n; i++) {
            const tp = this.trajectoryPoints[i].pos;
            positions[i * 3]     = tp.x;
            positions[i * 3 + 1] = tp.y;
            positions[i * 3 + 2] = tp.z;
        }
        this._trajectoryAttribute.needsUpdate = true;
        this.trajectoryLineGeo.setDrawRange(0, n);
        this.trajectoryLineGeo.computeBoundingSphere();
    }
}
