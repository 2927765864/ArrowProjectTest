import * as THREE from 'three';
import { Globals, disposeObject3D } from '../utils.js';
import { CONFIG } from '../config.js';

function clamp01(value) {
    return THREE.MathUtils.clamp(value, 0, 1);
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t) {
    return t * t * t;
}

function easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) * 0.5;
}

function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
}

function easeInQuart(t) {
    return t * t * t * t;
}

// 用于从 A 姿态平滑过渡到 B 姿态的 S 曲线（开始/结束导数均为 0）
function smoothstep(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
}

function cloneModelDeep(source) {
    const clone = source.clone(true);
    clone.traverse((child) => {
        if (!child.isMesh) return;
        if (child.geometry) child.geometry = child.geometry.clone();
        if (child.material) child.material = child.material.clone();
    });
    return clone;
}

// ===== 模块级 scratch（所有 RecallCourierEffect 实例共享，update 内复用避免每帧 GC）=====
const _UP_Y = new THREE.Vector3(0, 1, 0);
const _scratchRhWindupPos = new THREE.Vector3();
const _scratchRhFinalPos = new THREE.Vector3();
const _scratchLhWindupPos = new THREE.Vector3();
const _scratchLhFinalPos = new THREE.Vector3();
const _scratchWeaponWorldPos = new THREE.Vector3();
const _scratchAimDir = new THREE.Vector3();
const _scratchHorizontalAxis = new THREE.Vector3();
const _scratchTargetWorldQuat = new THREE.Quaternion();
const _scratchSpinQuat = new THREE.Quaternion();
const _scratchParentWorldQuat = new THREE.Quaternion();
const _scratchAlignDir = new THREE.Vector3();
const _scratchPitchQuat = new THREE.Quaternion();

export class RecallCourierEffect {
    constructor(feather) {
        this.feather = feather;
        this.elapsed = 0;
        this.throwTriggered = false;
        this.destroyed = false;
        // 独立于动画之外的消失渐隐状态
        this.fading = false;       // 是否进入"动画已完成、等待渐隐"阶段
        this.fadeElapsed = 0;       // 渐隐阶段已用时长
        this._fadeMaterials = null; // 一次性收集的材质列表，避免每帧 traverse + needsUpdate
        
        this.group = new THREE.Group();
        this.group.position.copy(feather.mesh.position);
        this.group.position.y = 0.03;
        this.group.scale.setScalar(feather.isSpecial ? CONFIG.recallCourierScaleSpecial : CONFIG.recallCourierScale);

        this.materials = [];

        const dirtMat = new THREE.MeshBasicMaterial({ color: 0x0e0b1c });
        const dirtDarkMat = new THREE.MeshBasicMaterial({ color: 0x050410 });
        const furMat = new THREE.MeshBasicMaterial({ color: 0xfff5e6 });
        const furBackMat = new THREE.MeshBasicMaterial({ color: 0xe0d2bf });
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x362c28 });
        const noseMat = new THREE.MeshBasicMaterial({ color: 0xff9eab });
        this.materials.push(dirtMat, dirtDarkMat, furMat, furBackMat, eyeMat, noseMat);

        const mound = new THREE.Mesh(new THREE.CircleGeometry(0.55, 32), dirtMat);
        mound.rotation.x = -Math.PI / 2;
        mound.position.y = 0.01;
        this.group.add(mound);

        const hole = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.25, 24), dirtDarkMat);
        hole.rotation.x = -Math.PI / 2;
        hole.position.y = 0.012;
        this.group.add(hole);
        this.hole = hole;

        const ridge = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), dirtMat.clone());
        ridge.scale.set(1.7, 0.34, 1.25);
        ridge.position.set(0, 0.06, 0.02);
        this.group.add(ridge);
        this.materials.push(ridge.material);

        this.dirtClumps = [];
        for (let i = 0; i < 5; i++) {
            const clump = new THREE.Mesh(new THREE.SphereGeometry(0.06 + Math.random() * 0.025, 10, 10), dirtMat.clone());
            const angle = (i / 5) * Math.PI * 2 + Math.random() * 0.5;
            const radius = 0.23 + Math.random() * 0.14;
            clump.position.set(Math.cos(angle) * radius, 0.03, Math.sin(angle) * radius);
            clump.scale.y = 0.5;
            this.group.add(clump);
            this.materials.push(clump.material);
            this.dirtClumps.push({ mesh: clump, angle, radius });
        }

        this.root = new THREE.Group();
        this.root.position.y = -0.68;
        this.group.add(this.root);

        this.bodyPivot = new THREE.Group();
        this.bodyPivot.position.y = -0.1; // Base anchor
        this.root.add(this.bodyPivot);

        this.spineMid = new THREE.Group();
        this.spineMid.position.y = 0.18; // Absolute Y: 0.08
        this.bodyPivot.add(this.spineMid);

        this.spineTop = new THREE.Group();
        this.spineTop.position.y = 0.12; // Absolute Y: 0.20
        this.spineMid.add(this.spineTop);

        const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.26, 10, 16), furBackMat);
        torso.scale.set(1.12, 1.58, 1.08);
        torso.position.set(0, 0.08, -0.03);
        this.bodyPivot.add(torso);

        const chest = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 18), furMat);
        chest.scale.set(1.22, 1.0, 1.12);
        chest.position.set(0, 0.04, 0.04);
        this.spineMid.add(chest);

        const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), furMat);
        shoulder.scale.set(1.65, 0.88, 1.18);
        shoulder.position.set(0, 0, -0.02);
        this.spineTop.add(shoulder);

        this.headGroup = new THREE.Group();
        this.headGroup.position.y = 0.14;
        this.spineTop.add(this.headGroup);

        const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 20), furMat);
        cranium.scale.set(1.22, 0.88, 1.1);
        cranium.position.set(0, 0.03, 0.01);
        this.headGroup.add(cranium);

        const backHead = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 20), furBackMat);
        backHead.scale.set(1.18, 0.82, 1.05);
        backHead.position.set(0, 0.0, -0.035);
        this.headGroup.add(backHead);

        const cheekGeo = new THREE.SphereGeometry(0.085, 18, 18);
        const cheekL = new THREE.Mesh(cheekGeo, furMat);
        cheekL.scale.set(1, 0.72, 0.92);
        cheekL.position.set(0.09, -0.06, 0.08);
        this.headGroup.add(cheekL);
        const cheekR = new THREE.Mesh(cheekGeo, furMat);
        cheekR.scale.set(1, 0.72, 0.92);
        cheekR.position.set(-0.09, -0.06, 0.08);
        this.headGroup.add(cheekR);

        const earGeo = new THREE.ConeGeometry(0.08, 0.18, 12);
        const earL = new THREE.Mesh(earGeo, furBackMat);
        earL.scale.set(1, 1, 0.55);
        earL.position.set(0.12, 0.14, -0.02);
        earL.rotation.set(-0.16, 0.18, -0.34);
        this.headGroup.add(earL);
        const earR = new THREE.Mesh(earGeo, furBackMat);
        earR.scale.set(1, 1, 0.55);
        earR.position.set(-0.12, 0.14, -0.02);
        earR.rotation.set(-0.16, -0.18, 0.34);
        this.headGroup.add(earR);

        const eyeGeo = new THREE.SphereGeometry(0.018, 10, 10);
        const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
        eyeL.position.set(0.07, -0.015, 0.16);
        eyeL.scale.set(1, 1.3, 0.8);
        this.headGroup.add(eyeL);
        const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
        eyeR.position.set(-0.07, -0.015, 0.16);
        eyeR.scale.set(1, 1.3, 0.8);
        this.headGroup.add(eyeR);

        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.028, 3), noseMat);
        nose.position.set(0, -0.07, 0.16);
        nose.rotation.set(Math.PI / 2, Math.PI, 0);
        this.headGroup.add(nose);

        const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.08, 8, 12), furMat);
        neck.scale.set(1.0, 1.15, 0.95);
        neck.position.set(0, -0.06, -0.02);
        this.spineTop.add(neck);

        // ============================================================
        // 极简肢体：左右手各一个球体（彻底移除上臂/前臂/肘关节/关节球结构）
        // ------------------------------------------------------------
        // 结构：
        //   spineTop
        //     ├─ leftHand  (Group, 球体挂其下；整个 Group 的 position 驱动动作)
        //     └─ rightHand (Group, 球体挂其下；武器挂在该 Group 下随之移动)
        //
        // 坐标系说明（在 spineTop 局部）：
        //   +Y 向上，-Y 向下；+Z 指向小猫猫前方（由 group.rotation.y 对齐玩家）
        //   +X 为小猫猫左手一侧，-X 为右手一侧
        // ============================================================
        // 肩膀参考点（用于左手静止位 & 右手起始位）
        this.leftShoulder = new THREE.Vector3(0.15, 0, 0.02);
        this.rightShoulder = new THREE.Vector3(-0.15, 0, 0.02);

        const handRadius = 0.075; // 手球半径（比原爪子略大，避免看起来像小圆点）
        const handGeo = new THREE.SphereGeometry(handRadius, 18, 16);

        // --- 左手（单球，静止配重） ---
        this.leftHand = new THREE.Group();
        this.leftHand.position.set(this.leftShoulder.x, -0.08, 0.06);
        this.spineTop.add(this.leftHand);
        const leftHandMesh = new THREE.Mesh(handGeo, furMat);
        this.leftHand.add(leftHandMesh);

        // --- 右手（单球，投掷主动） ---
        this.rightHand = new THREE.Group();
        this.rightHand.position.set(this.rightShoulder.x, -0.08, 0.06);
        this.spineTop.add(this.rightHand);
        const rightHandMesh = new THREE.Mesh(handGeo, furMat);
        this.rightHand.add(rightHandMesh);

        // 武器挂点：跟随右手移动
        this.weaponAnchor = new THREE.Group();
        this.weaponAnchor.position.set(0, 0, 0);
        this.rightHand.add(this.weaponAnchor);

        // 定义右手在各关键阶段的 spineTop 局部坐标，update 中做插值
        // 参考：头顶在 spineTop 局部系 y≈0.30（headGroup.y=0.14 + cranium 顶 ~0.16）
        this._rightHandKeyPos = {
            rest:   new THREE.Vector3(this.rightShoulder.x, -0.08, 0.06),   // 手自然垂在身侧
            windup: new THREE.Vector3(this.rightShoulder.x * 0.55, 0.48, -0.04), // 高过头顶，略偏后且靠近身体中线
            throw:  new THREE.Vector3(this.rightShoulder.x * 0.7,  0.10,  0.26), // 向前甩出，略低于肩
        };
        this._leftHandKeyPos = {
            rest:   new THREE.Vector3(this.leftShoulder.x, -0.08, 0.06),
            windup: new THREE.Vector3(this.leftShoulder.x + 0.02, 0.02, 0.14), // 蓄力时略微前抬保持身体平衡
            throw:  new THREE.Vector3(this.leftShoulder.x + 0.06, -0.04, 0.02), // 投掷时后撤，顺势挥开
        };

        // =====================================================================
        // 示意武器（完全自建、独立于真 feather 模型）
        // 在 weapon 本地坐标系中：+Y 方向 = 视觉枪尖（shaft 细尖），玩家认知的"朝向"
        //                        -Y 方向 = 双叉 prong 尾
        // 挂在 weaponAnchor 下时，weaponAnchor 局部 -Y 指向前臂延伸方向（手掌外），
        // 所以默认 weapon 的 -Y 对齐手掌外，我们再给一个 π 的 X 轴翻转让 +Y（枪尖）朝外。
        // =====================================================================
        this.weapon = this.buildStylizedSpear(feather.isSpecial);
        const wScale = feather.baseModelScale * (feather.isSpecial ? CONFIG.recallCourierWeaponScaleSpecial : CONFIG.recallCourierWeaponScale);
        this.weapon.scale.setScalar(wScale);
        // 基础朝向：绕 X 轴 π，让 weapon 本地 +Y（视觉枪尖）朝 weaponAnchor 局部 -Y（手掌外）
        this.weapon.rotation.set(Math.PI, 0, 0);
        this.weapon.position.set(0, 0, 0);
        this.weaponAnchor.add(this.weapon);

        this.group.traverse((child) => {
            if (child.isMesh) child.layers.enable(1);
        });

        Globals.scene.add(this.group);

        if (Globals.particleManager) {
            const burstPos = feather.mesh.position.clone();
            burstPos.y = 0.08;
            Globals.particleManager.spawnBurst(burstPos, new THREE.Vector3(0, 1, 0), 6, 0x5e55a2, false, 0.45, [1, 3]);
        }
    }

    /**
     * 构建一把完全独立、面向演出的示意矛。
     * 本地坐标系约定：+Y 方向 = 视觉枪尖（玩家主观认知的"尖"）；-Y = 双叉尾部。
     * 整体长度约 3 单位（+Y 方向 2，-Y 方向 1），配合 wScale 缩放成合适尺寸。
     */
    buildStylizedSpear(isSpecial) {
        const group = new THREE.Group();
        const color = isSpecial ? 0xd4ff99 : 0x91c53a;
        const mat = new THREE.MeshBasicMaterial({ color });
        this.materials.push(mat);

        // 主杆（shaft）：从 y=-0.3 到 y=+1.7，约 2 单位长，顶端略收窄
        const shaftGeo = new THREE.CylinderGeometry(0.05, 0.08, 2.0, 10);
        const shaft = new THREE.Mesh(shaftGeo, mat);
        shaft.position.y = 0.7;
        group.add(shaft);

        // 枪尖（+Y 端）：尖锥，朝 +Y 延伸
        const tipGeo = new THREE.ConeGeometry(0.05, 0.5, 10);
        const tip = new THREE.Mesh(tipGeo, mat);
        tip.position.y = 1.95;
        group.add(tip);

        // 枪尖后的小装饰环（让枪尖和主杆分离感更强）
        const ringGeo = new THREE.TorusGeometry(0.08, 0.018, 8, 14);
        const ring = new THREE.Mesh(ringGeo, mat);
        ring.position.y = 1.65;
        ring.rotation.x = Math.PI / 2;
        group.add(ring);

        // 双叉尾部（-Y 端）：两根小叉向斜后方伸出，模仿 feather 的 prong
        const prongGeo = new THREE.CylinderGeometry(0.018, 0.032, 0.8, 6);
        const prongL = new THREE.Mesh(prongGeo, mat);
        prongL.position.set(0.12, -0.6, 0);
        prongL.rotation.z = 0.35;
        group.add(prongL);
        const prongR = new THREE.Mesh(prongGeo, mat);
        prongR.position.set(-0.12, -0.6, 0);
        prongR.rotation.z = -0.35;
        group.add(prongR);

        // 把手（中段稍微加个握把，强调"小猫猫握着"）
        const gripGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.22, 10);
        const gripMat = new THREE.MeshBasicMaterial({ color: 0x5a3a22 });
        this.materials.push(gripMat);
        const grip = new THREE.Mesh(gripGeo, gripMat);
        grip.position.y = 0.0;
        group.add(grip);

        group.traverse((child) => {
            if (child.isMesh) child.layers.enable(1);
        });
        return group;
    }

    /**
     * 将 weapon 在世界空间中对齐到指定朝向，使其本地 +Y 轴指向 worldDir。
     * 由于 weapon 的父节点（rightHand）会在投掷过程中大幅移动，这里用逆父变换
     * 主动抵消父级的世界旋转，保证长矛始终稳定指向玩家（带轻微上下偏移）。
     *
     * @param {THREE.Vector3} worldDir 世界空间朝向（未归一化也可，内部归一化）
     * @param {number} spin 绕矛身长轴的自旋（弧度），用于增加动势
     */
    alignWeaponToWorldDir(worldDir, spin = 0) {
        if (!this.weapon || !this.weapon.parent) return;
        this.weapon.parent.updateWorldMatrix(true, false);

        // 复用 scratch：避免每帧 new Vector3 / Quaternion
        _scratchAlignDir.copy(worldDir).normalize();

        // 目标世界四元数：将 +Y 旋转到 dir
        _scratchTargetWorldQuat.setFromUnitVectors(_UP_Y, _scratchAlignDir);

        // 加上绕矛身长轴的自旋
        if (spin !== 0) {
            _scratchSpinQuat.setFromAxisAngle(_UP_Y, spin);
            _scratchTargetWorldQuat.multiply(_scratchSpinQuat);
        }

        // weapon.quaternion = parentWorldQuat^-1 * targetWorldQuat
        this.weapon.parent.getWorldQuaternion(_scratchParentWorldQuat);
        _scratchParentWorldQuat.invert();
        this.weapon.quaternion.copy(_scratchParentWorldQuat).multiply(_scratchTargetWorldQuat);
    }
    update(delta) {
        if (this.destroyed) return false;

        // === 独立渐隐阶段 ===
        // 主动画播完后，小猫猫保持在动画最后一帧不动，仅推进渐隐计时器。
        // 这段渐隐不计入任何动画时长，完成后才销毁；且不受 feather.phase 变化影响，
        // 保证即使 feather 已进入下一阶段也能把淡出演出完整放完。
        if (this.fading) {
            this.fadeElapsed += delta;
            const fadeDur = Math.max(0.001, CONFIG.recallCourierFadeDur);
            const t = clamp01(this.fadeElapsed / fadeDur);
            const opacity = 1 - t;

            // 第一次进入 fade 时，一次性收集所有材质并把 transparent / depthWrite 配置到位 +
            // 触发一次 needsUpdate（强制 shader 重新编译以支持透明）。之后每帧只赋 opacity，
            // 既不 traverse 也不 needsUpdate=true，避免每帧 GPU 管线 re-bind。
            if (!this._fadeMaterials) {
                const collected = [];
                const seen = new Set();
                this.group.traverse((child) => {
                    if (!child.isMesh || !child.material) return;
                    const m = child.material;
                    const arr = Array.isArray(m) ? m : [m];
                    for (let i = 0; i < arr.length; i++) {
                        const mat = arr[i];
                        if (!mat || seen.has(mat)) continue;
                        seen.add(mat);
                        mat.transparent = true;
                        mat.depthWrite = false;
                        mat.needsUpdate = true; // 仅此一次
                        collected.push(mat);
                    }
                });
                this._fadeMaterials = collected;
            }
            const mats = this._fadeMaterials;
            for (let i = 0; i < mats.length; i++) {
                mats[i].opacity = opacity;
            }

            if (t >= 1) {
                this.destroy();
                return false;
            }
            return true;
        }

        // 主动画阶段仍受 feather 状态控制（feather 异常消失就直接销毁）
        if (!this.feather || this.feather.phase !== 'recalling') {
            this.destroy();
            return false;
        }

        this.elapsed += delta;

        this.group.scale.setScalar(this.feather.isSpecial ? CONFIG.recallCourierScaleSpecial : CONFIG.recallCourierScale);
        this.weapon.scale.setScalar(this.feather.baseModelScale * (this.feather.isSpecial ? CONFIG.recallCourierWeaponScaleSpecial : CONFIG.recallCourierWeaponScale));

        // Stage timings（主动画：emerge → windup → throw → hold，无下潜）
        const emergeDur = CONFIG.recallCourierEmergeDur;
        const windupDur = CONFIG.recallCourierWindupDur;
        const throwDur = CONFIG.recallCourierThrowDur;
        const holdDur = CONFIG.recallCourierHoldDur;

        const emergeEnd = emergeDur;
        const windupEnd = emergeEnd + windupDur;
        const throwEnd = windupEnd + throwDur;
        const holdEnd = throwEnd + holdDur;
        const totalDuration = holdEnd;

        const targetPos = Globals.player?.mesh.position;
        if (targetPos) {
            const dx = targetPos.x - this.group.position.x;
            const dz = targetPos.z - this.group.position.z;
            this.group.rotation.y = Math.atan2(dx, dz);
        }

        // Animation phases (0 to 1)
        const emergePhase = clamp01(this.elapsed / emergeDur);
        const windupPhase = clamp01((this.elapsed - emergeEnd) / windupDur);
        const throwPhase = clamp01((this.elapsed - windupEnd) / throwDur);
        const holdPhase = clamp01((this.elapsed - throwEnd) / holdDur);

        // Easing
        const emerge = easeOutBack(emergePhase);
        const windup = easeInOutSine(windupPhase);
        const throwAnim = easeOutQuint(throwPhase);

        // 1. Root Y（只保留 emerge 钻出，不再下潜）
        this.root.position.y = THREE.MathUtils.lerp(-0.68, 0.14, emerge);

        // 2. Body exaggeration (Squash & Stretch & Bend)
        // Windup: lean back heavily
        // Throw: snap forward
        const leanBack = windup * (1 - throwAnim); // Leans back during windup, resets when throwing
        const leanForward = throwAnim;              // Snaps forward

        // 夸张化：加大躯干弯曲与挺伸幅度
        const bend = -leanBack * 1.9 + leanForward * 1.2;
        this.bodyPivot.rotation.x = bend * 0.28;
        this.spineMid.rotation.x = bend * 0.42;
        this.spineTop.rotation.x = bend * 0.48;

        // Stretch & Squash
        const stretchY = 1.0 - leanBack * 0.18 + leanForward * 0.32;
        const stretchXZ = 1.0 + leanBack * 0.18 - leanForward * 0.18;
        this.bodyPivot.scale.set(stretchXZ, stretchY, stretchXZ);
        this.bodyPivot.position.z = -leanBack * 0.12 + leanForward * 0.14;

        // 头部联动：蓄力缩头后仰，投掷探头前冲
        this.headGroup.rotation.x = -leanBack * 0.7 - leanForward * 0.55;
        this.headGroup.position.z = 0.02 + leanBack * 0.07 - leanForward * 0.08;
        this.headGroup.position.y = -leanBack * 0.03 + leanForward * 0.05;

        // ===== 3. Right Hand 轨迹（持矛手） =====
        // 关键点：rest（身侧垂下）→ windup（高过头顶略偏后）→ throw（向前下方甩出）
        // 用 windupPhase 的缓动作为 rest→windup 插值，用 throwPhase 作为 windup→throw 插值
        const rhRest = this._rightHandKeyPos.rest;
        const rhWindup = this._rightHandKeyPos.windup;
        const rhThrow = this._rightHandKeyPos.throw;

        // 先插值到蓄力顶点：windup 缓动值（0→1，蓄力过程）
        const rhWindupBlend = windup;
        // 再插值到投掷终点：throw 缓动值（0→1，投掷过程）
        const rhThrowBlend = throwAnim;

        // 两段混合：rest → windup → throw（复用 scratch 避免每帧分配）
        _scratchRhWindupPos.lerpVectors(rhRest, rhWindup, rhWindupBlend);
        _scratchRhFinalPos.lerpVectors(_scratchRhWindupPos, rhThrow, rhThrowBlend);
        this.rightHand.position.copy(_scratchRhFinalPos);

        // ===== 4. Left Hand 轨迹（配合手，幅度小） =====
        const lhRest = this._leftHandKeyPos.rest;
        const lhWindup = this._leftHandKeyPos.windup;
        const lhThrow = this._leftHandKeyPos.throw;

        _scratchLhWindupPos.lerpVectors(lhRest, lhWindup, rhWindupBlend);
        _scratchLhFinalPos.lerpVectors(_scratchLhWindupPos, lhThrow, rhThrowBlend);
        this.leftHand.position.copy(_scratchLhFinalPos);

        // ===== 5. 武器挂点（挂在右手球下，跟随右手轨迹） =====
        // weaponAnchor 挂在 rightHand 下，位置偏移可通过 CONFIG 微调
        this.weaponAnchor.position.set(
            CONFIG.recallCourierWeaponOffsetX,
            CONFIG.recallCourierWeaponOffsetY,
            CONFIG.recallCourierWeaponOffsetZ
        );
        this.weapon.position.set(0, 0, 0);

        // ===== 6. 长矛世界空间朝向：始终指向玩家（带轻微上下偏移） =====
        // 计算世界空间中从武器位置指向玩家的方向向量（复用 scratch）
        this.weaponAnchor.updateWorldMatrix(true, false);
        this.weaponAnchor.getWorldPosition(_scratchWeaponWorldPos);

        if (targetPos) {
            _scratchAimDir.set(
                targetPos.x - _scratchWeaponWorldPos.x,
                (targetPos.y + 0.6) - _scratchWeaponWorldPos.y,
                targetPos.z - _scratchWeaponWorldPos.z
            );
            if (_scratchAimDir.lengthSq() < 1e-6) _scratchAimDir.set(0, 0, 1);
        } else {
            _scratchAimDir.set(0, 0, 1);
        }
        _scratchAimDir.normalize();
        const aimDir = _scratchAimDir;

        // 轻微上下偏移：蓄力时矛尖略微上翘（蓄势），投掷时矛尖略微下压（发劲）
        // 偏移限制在约 ±15° 以内，保证"整体仍指向玩家"
        const pitchOffset =
            0.28 * windup * (1 - throwAnim) -   // 蓄力时上翘 ~16°
            0.22 * throwAnim;                    // 投掷时下压 ~12°
        // 将 pitchOffset 应用到 aimDir：绕与 aimDir 和世界 Y 轴都垂直的水平轴旋转（复用 scratch）
        _scratchHorizontalAxis.crossVectors(_UP_Y, aimDir);
        const haxLenSq = _scratchHorizontalAxis.lengthSq();
        if (haxLenSq > 1e-6) {
            _scratchHorizontalAxis.multiplyScalar(1 / Math.sqrt(haxLenSq));
            aimDir.applyAxisAngle(_scratchHorizontalAxis, pitchOffset);
        }

        // 绕矛身长轴的轻微自旋（投掷瞬间给点动势）
        const spin = throwAnim * 0.6;

        this.alignWeaponToWorldDir(aimDir, spin);

        // Hole scaling（仅受 emerge 影响）
        this.hole.scale.setScalar(1 + emergePhase * 0.18);
        for (let i = 0; i < this.dirtClumps.length; i++) {
            const clump = this.dirtClumps[i];
            const burst = Math.sin(emergePhase * Math.PI);
            clump.mesh.position.x = Math.cos(clump.angle) * (clump.radius + burst * 0.1);
            clump.mesh.position.z = Math.sin(clump.angle) * (clump.radius + burst * 0.1);
            clump.mesh.position.y = 0.03 + burst * 0.065;
        }

        // 5. Decoupled throw logic
        // 主动画（emerge → windup → throw → hold）播完后，触发真武器开始回收飞行
        if (!this.throwTriggered && this.elapsed >= totalDuration) {
            this.throwTriggered = true;
            const releasePos = this.feather.mesh.position.clone();
            releasePos.y = 0.6; // Hover slightly above hole

            this.feather.releaseFromCourier(releasePos);
        }
        
        // Hide dummy weapon when the throw is done
        if (holdPhase > 0) {
            this.weapon.visible = false;
        }

        // 主动画播完 → 进入独立渐隐阶段（不销毁，保持当前姿态直到 fade 完成）
        if (this.elapsed >= totalDuration) {
            this.fading = true;
            this.fadeElapsed = 0;
        }

        return true;
    }

destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.feather) {
            // 通知 feather：小猫的整段演出（含 fade）已彻底结束。
            // 落点指示器在此刻才真正消失（之前一直陪着小猫渐隐到 0）。
            this.feather.recallCourierActive = false;
            if (this.feather.deploymentRing) {
                this.feather.deploymentRing.visible = false;
            }
            // 重置落点指示器材质的 opacity，避免 feather 实例若被复用
            // （或下一次进入 deployed 阶段）时残留 fade 末态的 0 透明度。
            if (this.feather.deploymentRingMaterial) {
                this.feather.deploymentRingMaterial.opacity = this.feather.isSpecial
                    ? CONFIG.deployRingOpacitySpecial
                    : CONFIG.deployRingOpacityNormal;
            }
            if (this.feather.deploymentArrowMaterial) {
                this.feather.deploymentArrowMaterial.opacity = CONFIG.deployArrowOpacity;
            }
            if (this.feather.recallCourierEffect === this) {
                this.feather.recallCourierEffect = null;
            }
        }
        disposeObject3D(this.group);
        Globals.scene.remove(this.group);
        this._fadeMaterials = null;
    }
}
