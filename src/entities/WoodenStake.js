import * as THREE from 'three';
import { Globals, showRecallDamageText, disposeObject3D } from '../utils.js';
import { CONFIG } from '../config.js';
import { HitReaction } from '../effects/HitReaction.js';

/**
 * WoodenStake - 真实的木桩模型（用于木桩训练模式）
 *
 * 视觉结构：
 *   root(Group, 注册到 enemies 列表)
 *     └── pivot(Group, 位于地面, 作为"弯曲"的旋转原点)
 *           └── stakeGroup(Group, 整根可弯曲的杆子)
 *                 ├── 主立柱(Cylinder)
 *                 ├── 木纹(3 条横向暗色细圆柱)
 *                 ├── 顶部切面(Cylinder, 浅色, 被"砍平"感)
 *                 ├── 顶绳(Torus)
 *                 └── 底部土堆(Cone, 隶属 pivot 不跟随弯曲)
 *
 * 受击弹性弯曲动画（spring-damper）：
 *   - bendAngle 是一个 2D 向量 (x, z) 表示 pivot 的 X/Z 轴弯曲角度
 *   - 弹簧方程: accel = -k * angle - c * vel  (胡克定律 + 阻尼)
 *   - 受击时给 bendAngleVel 一个沿"击退方向"的冲量，pivot 会被推弯后自然摆动并回正
 *
 * 对外接口（鸭子类型，兼容 Feather.checkCollision）：
 *   mesh, isDead, takeDamage(amount, type, dir, hitPointWorld), applyKnockback(dir, force),
 *   applyStun(duration), update(delta, time)
 */
export class WoodenStake {
    constructor(spawnPosition = null) {
        this.isDummy = true; // 兼容其它系统对 isDummy 的判断
        this.isDead = false;
        this.hp = Infinity;
        this.speed = 0;
        this.knockbackVelocity = new THREE.Vector3(0, 0, 0); // 占位，木桩不会位移
        this.stunTimer = 0;

        // ---------- 根节点 ----------
        // 为了与 Feather 飞行高度(~0.8~1)对齐，mesh.position.y 抬到 ~0.7（杆子中段）
        // 这样 Feather.checkCollision 用 3D 距离判定时命中更稳定
        // 子节点位置全部以"根"为原点，向下偏移到地面
        this.mesh = new THREE.Group();
        const ROOT_Y = 0.7;
        if (spawnPosition) {
            this.mesh.position.set(spawnPosition.x, ROOT_Y, spawnPosition.z);
        } else {
            this.mesh.position.y = ROOT_Y;
        }
        // GROUND_Y 表示"地面"相对于根的本地 Y 坐标
        const GROUND_Y = -ROOT_Y;

        // ---------- 底部土堆（不随木桩弯曲） ----------
        const moundGeo = new THREE.ConeGeometry(0.55, 0.22, 24, 1, true);
        const moundMat = new THREE.MeshBasicMaterial({ color: 0x4a3a28 });
        const mound = new THREE.Mesh(moundGeo, moundMat);
        mound.position.y = GROUND_Y + 0.02; // 略高于地面，避免 z-fighting
        mound.rotation.x = Math.PI; // 开口朝下，成"圆丘"
        this.mesh.add(mound);

        // 土堆上的一圈深色土
        const ringGeo = new THREE.TorusGeometry(0.42, 0.08, 8, 24);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x3a2c1c });
        const dirtRing = new THREE.Mesh(ringGeo, ringMat);
        dirtRing.rotation.x = Math.PI / 2;
        dirtRing.position.y = GROUND_Y + 0.04;
        this.mesh.add(dirtRing);

        // ---------- pivot：弯曲的枢轴（位于土面） ----------
        this.pivot = new THREE.Group();
        this.pivot.position.y = GROUND_Y + 0.05;
        this.mesh.add(this.pivot);

        // ---------- 杆子主体 ----------
        this.deformGroup = new THREE.Group();
        this.pivot.add(this.deformGroup);

        this.stakeGroup = new THREE.Group();
        this.deformGroup.add(this.stakeGroup);

        const WOOD_LIGHT = 0xc2824e;
        const WOOD_DARK = 0x8b5a32;
        const WOOD_TOP = 0xd9a66e; // 被砍的顶面（更浅）
        const ROPE = 0xdcc27a;

        const bodyMat = new THREE.MeshBasicMaterial({ color: WOOD_LIGHT });
        const darkMat = new THREE.MeshBasicMaterial({ color: WOOD_DARK });
        const topMat = new THREE.MeshBasicMaterial({ color: WOOD_TOP });
        const ropeMat = new THREE.MeshBasicMaterial({ color: ROPE });
        this.materials = [bodyMat, darkMat, topMat, ropeMat];
        this.materials.forEach(m => { m.userData.baseColor = m.color.getHex(); });

        // 受击反馈：闪白走 HitReaction，默认 configKey='hit' —— 与 PillarEnemy（柱状）
        // 共用一组 hitFlash* 参数（手感统一；木桩与史莱姆 hitS* 分组独立）。
        // 但形变完全独立——HitReaction 用 flashOnly 模式启动，不会驱动 shader 形变 uniforms；
        // 木桩自己跑一个本地弹簧（见 _applyBendImpulse + update），参数从 CONFIG.stakeDeform* 读取，
        // 与 hitDeform*/hitSDeform* 互不干扰。这样调任意一组敌人参数都不影响木桩。
        this.hitReaction = new HitReaction({ flashOnly: true, configKey: 'hit' });
        this.materials.forEach(m => this.hitReaction.attach(m));

        // 主立柱（底略粗、顶略细）
        const STAKE_HEIGHT = 1.35;
        const stakeGeo = new THREE.CylinderGeometry(0.16, 0.20, STAKE_HEIGHT, 16);
        const stake = new THREE.Mesh(stakeGeo, bodyMat);
        stake.position.y = STAKE_HEIGHT / 2;
        this.stakeGroup.add(stake);
        this.stakeMesh = stake;
        this.stakeHeight = STAKE_HEIGHT;

        // 三条暗色横纹（模拟木纹/绑带）
        const bandGeo = new THREE.CylinderGeometry(0.205, 0.205, 0.04, 16);
        const bandYs = [0.35, 0.75, 1.10];
        bandYs.forEach(y => {
            const band = new THREE.Mesh(bandGeo, darkMat);
            band.position.y = y;
            this.stakeGroup.add(band);
        });

        // 顶部切面（略大于主立柱顶径，营造"被砍平"感）
        const topCapGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.03, 16);
        const topCap = new THREE.Mesh(topCapGeo, topMat);
        topCap.position.y = STAKE_HEIGHT + 0.01;
        this.stakeGroup.add(topCap);

        // 顶部绑绳
        const ropeGeo = new THREE.TorusGeometry(0.18, 0.035, 6, 18);
        const rope = new THREE.Mesh(ropeGeo, ropeMat);
        rope.rotation.x = Math.PI / 2;
        rope.position.y = STAKE_HEIGHT - 0.1;
        this.stakeGroup.add(rope);

        // 顶部一个小方块（稻草人风格的受击标记 - 红心）
        const markGeo = new THREE.BoxGeometry(0.12, 0.12, 0.02);
        const markMat = new THREE.MeshBasicMaterial({ color: 0xc94b3b });
        markMat.userData.baseColor = markMat.color.getHex();
        this.materials.push(markMat);
        const mark = new THREE.Mesh(markGeo, markMat);
        mark.position.set(0, STAKE_HEIGHT * 0.72, 0.18);
        this.stakeGroup.add(mark);

        // ---------- 弯曲动力学状态 ----------
        // 弯曲用"2D 角度" (x, z)：
        //   bendAngle.x  => pivot 绕世界 X 轴旋转（向前/向后弯）
        //   bendAngle.y  => pivot 绕世界 Z 轴旋转（向左/向右弯）
        // 注：把 vec.y 用作 Z 轴只是方便用一个 Vector2 存储，不代表实际 Y 轴。
        this.bendAngle = new THREE.Vector2(0, 0);
        this.bendAngleVel = new THREE.Vector2(0, 0);
        // 弹簧常数 / 阻尼 / 最大角全部从 CONFIG.stakeBend* 读取（实时调参生效）。
        // 自然频率 ω = sqrt(stiffness)；阻尼比 ζ = damping / (2*ω)。

        // 整体弹性形变：对包含主干/木纹/顶盖/绑绳/标记的 deformGroup 生效，避免部件分离。
        // 木桩独立弹簧（与球形/柱状敌人完全隔离，参数读 CONFIG.stakeDeform*）。
        // 弹簧位移 _deformX：有符号；+ = squash 阶段（被压扁），- = stretch 阶段（过冲拉长）。
        // 受击瞬间设 _deformX = 1.0，弹簧 ẍ=-k*x-c*v 自然过冲到负值再衰减回 0。
        this._deformX = 0;
        this._deformV = 0;
        this._deformTime = 0;
        this._deformActive = false;
        this.deformAxisAngle = 0;

        // 缩放
        this.mesh.scale.setScalar(CONFIG.enemyScale);

        // 绑定 hitReaction 的参考坐标系。flashOnly 模式下 deformTarget 仅用于
        // 闪白通道的 onBeforeCompile 注入；形变 uniforms 不会被驱动。
        this.hitReaction.setTargets(this.mesh, this.stakeMesh);

        Globals.scene.add(this.mesh);
        Globals.enemies.push(this);
    }

    // —————— 对外接口：与 Enemy 保持一致，便于 Feather/技能复用 ——————

    /**
     * 把一次"击打冲量"施加到 pivot 的弯曲速度上。
     * @param {THREE.Vector3} direction 击退方向（世界空间，通常是攻击飞来的方向）
     * @param {number} impulse          弯曲角速度冲量（rad/s）
     */
    _applyBendImpulse(direction, impulse) {
        if (!direction) return;
        // 来向的反方向（即击退方向 direction）= 杆子被推弯的方向
        // 绕 X 轴的分量由击退的 Z 分量决定（朝 +Z 推 => 杆子向前倾 => rotation.x > 0）
        // 绕 Z 轴的分量由击退的 X 分量决定（朝 +X 推 => 杆子向右倾 => rotation.z < 0）
        this.bendAngleVel.x += direction.z * impulse;
        this.bendAngleVel.y += -direction.x * impulse;

        // 形变 yaw 对齐：把 deformGroup 旋到"命中方向 = local +Z"，
        // 这样 update() 里只需对 (X, Y, Z) 做非均匀缩放即可：Z 是命中轴方向，X 是横向。
        // stakeGroup 反向旋转抵消，使 mesh 的实际世界朝向不变。
        //
        // 形变总开关：木桩跟随"敌人受击反馈（柱状敌人）"分组的 hitDeformEnabled。
        // （木桩的形变数值用 stakeDeform*；这里只复用 enabled 开关，避免给木桩单独加一个）
        if (CONFIG.hitDeformEnabled ?? true) {
            const horizontalLenSq = direction.x * direction.x + direction.z * direction.z;
            if (horizontalLenSq > 1e-6) {
                this.deformAxisAngle = Math.atan2(direction.x, direction.z);
                this.deformGroup.rotation.y = this.deformAxisAngle;
                this.stakeGroup.rotation.y = -this.deformAxisAngle;
            }
            // 启动木桩本地弹簧：x=+1（squash 峰值），v=0。
            // 后续 ẍ=-k*x-c*v 会驱动它过冲到 stretch 阶段再衰减回 0（参数读 CONFIG.stakeDeform*）。
            this._deformX = 1.0;
            this._deformV = 0;
            this._deformTime = 0;
            this._deformActive = true;
        }
    }

    applyKnockback(direction, force) {
        // 木桩不会被推走，转化成"弯曲冲量"。换算系数从 CONFIG.stakeKnockbackBendScale 读取。
        const scale = CONFIG.stakeKnockbackBendScale ?? 3.5;
        const impulse = scale * Math.min(force, 20) / 10;
        this._applyBendImpulse(direction, impulse);
    }

    applyStun(_duration) {
        // 木桩无需眩晕，留空接口（hitStunDuration / hitSStunDuration 由柱状/史莱姆敌人各自使用）
    }

    takeDamage(amount, type, direction, hitPointWorld, isCrit = false) {
        // 闪白反馈：走 HitReaction 通道，与 Enemy / PillarEnemy 共用 hitFlashDuration / hitFlashIntensity
        if (this.hitReaction) {
            this.hitReaction.trigger(hitPointWorld || null, direction || null);
        }

        // 浮动伤害数字（基于木桩顶部位置）
        const textPos = this.mesh.position.clone();
        textPos.y += this.stakeHeight * 0.5; // 大约到杆子顶端
        showRecallDamageText(this, textPos, amount, type, direction, isCrit);

        // 按伤害类型施加弯曲冲量（CONFIG.stakeBendImpulse* 可调）。
        //   注：发射穿刺命中（type='low'）时 Feather 还会额外调用 applyKnockback(hitKnockbackForce)，
        //       经 stakeKnockbackBendScale 换算后叠加，使发射与回收都有明显弯曲反馈。
        let impulse;
        if (type === 'special') impulse = CONFIG.stakeBendImpulseSpecial ?? 6.5;
        else if (type === 'low') impulse = CONFIG.stakeBendImpulseLow ?? 2.0;
        else impulse = CONFIG.stakeBendImpulseHigh ?? 4.5; // high（普通回收）
        this._applyBendImpulse(direction, impulse);
    }

    // 场景清理时会统一调用 die()，我们直接移除自身即可（没有死亡特效）
    die(_direction) {
        if (this.isDead) return;
        this.isDead = true;
        if (this.hitReaction) this.hitReaction.reset();
        // 重置本地形变弹簧
        this._deformX = 0;
        this._deformV = 0;
        this._deformActive = false;
        // 释放木桩的 ~10 个独立几何与材质
        disposeObject3D(this.mesh);
        Globals.scene.remove(this.mesh);
    }

    // —————— 每帧更新：弹簧-阻尼驱动弯曲回弹 ——————

    update(delta, _time) {
        if (this.isDead) return;

        // clamp delta 防止卡顿后积分爆炸
        const dt = Math.min(delta, 1 / 30);

        // 受击闪白衰减（HitReaction 内部驱动闪白通道；木桩不走 shader 顶点凹陷，所以 hitDepth 始终为 0）
        if (this.hitReaction) this.hitReaction.update(dt);

        // 半隐式欧拉 (symplectic Euler) 更稳定：
        // v += a*dt; x += v*dt
        // 弯曲参数从 CONFIG.stakeBend* 读取（实时调参生效）
        const k = CONFIG.stakeBendStiffness ?? 110;
        const c = CONFIG.stakeBendDamping ?? 2.6;

        // ax = -k * x - c * v
        const ax = -k * this.bendAngle.x - c * this.bendAngleVel.x;
        const ay = -k * this.bendAngle.y - c * this.bendAngleVel.y;

        this.bendAngleVel.x += ax * dt;
        this.bendAngleVel.y += ay * dt;

        this.bendAngle.x += this.bendAngleVel.x * dt;
        this.bendAngle.y += this.bendAngleVel.y * dt;

        // 限幅，防止穿透地面或翻转
        const maxA = CONFIG.stakeBendMaxAngle ?? 0.9;
        if (Math.abs(this.bendAngle.x) > maxA) {
            this.bendAngle.x = Math.sign(this.bendAngle.x) * maxA;
            this.bendAngleVel.x *= -0.3; // 碰到极限微弹回
        }
        if (Math.abs(this.bendAngle.y) > maxA) {
            this.bendAngle.y = Math.sign(this.bendAngle.y) * maxA;
            this.bendAngleVel.y *= -0.3;
        }

        // 应用到 pivot：pivot 围绕其原点(地面位置)做 2 轴弯曲
        this.pivot.rotation.x = this.bendAngle.x;
        this.pivot.rotation.z = this.bendAngle.y;

        // ===== Squash & Stretch 形变（木桩独立参数 stakeDeform*，与 hitDeform* 完全独立）=====
        // 弹簧由本地 _deformX/V 驱动，这里跑积分 + 应用到 deformGroup.scale。
        // 因为 _applyBendImpulse 已经把 deformGroup yaw 旋到"命中方向 = local +Z"，
        // 所以：local Z 轴 = 命中轴；local X 轴 = 横向（与命中轴垂直的水平方向）；local Y = 纵向。
        if (!(CONFIG.hitDeformEnabled ?? true)) {
            this._deformX = 0;
            this._deformV = 0;
            this._deformActive = false;
        }

        if (this._deformActive) {
            this._deformTime += dt;
            const stiffness = CONFIG.stakeDeformStiffness ?? 260;
            const damping = CONFIG.stakeDeformDamping ?? 6.0;
            // 子步长积分（与 HitReaction 一致，6 步保稳定）
            const steps = 6;
            const subDt = dt / steps;
            for (let i = 0; i < steps; i++) {
                const a = -stiffness * this._deformX - damping * this._deformV;
                this._deformV += a * subDt;
                this._deformX += this._deformV * subDt;
            }

            const maxDur = CONFIG.stakeDeformDuration ?? 1.2;
            const nearRest = Math.abs(this._deformX) < 0.005 && Math.abs(this._deformV) < 0.05;
            if (this._deformTime >= maxDur || nearRest) {
                this._deformX = 0;
                this._deformV = 0;
                this._deformActive = false;
            }
        }

        const s = this._deformX;
        if (Math.abs(s) < 1e-4) {
            this.deformGroup.scale.set(1, 1, 1);
        } else {
            const sPos = Math.max(s, 0);  // squash 阶段（被压扁）
            const sNeg = Math.max(-s, 0); // stretch 阶段（被拉长）

            // 沿命中轴（local Z）的缩放：squash 时被压短（<1），stretch 时被拉长（>1）
            const squashAxis  = CONFIG.stakeDeformSquashAxis  ?? 0.5;
            const stretchAxis = CONFIG.stakeDeformStretchAxis ?? 0.6;
            const factorAxis = 1 - sPos * squashAxis + sNeg * stretchAxis;

            // 横向（local X）：squash 时鼓起（>1），stretch 时收缩（<1）
            const squashBulge  = CONFIG.stakeDeformSquashBulge  ?? 0.5;
            const stretchPinch = CONFIG.stakeDeformStretchPinch ?? 0.3;
            const factorPerpHoriz = 1 + sPos * squashBulge - sNeg * stretchPinch;

            // 纵向（local Y）：用 stakeDeformVerticalScale 系数弱化（默认 0.6）。
            // squash 时纵向也微胀（被压扁挤出来）；stretch 时纵向微收缩。
            const verticalScale = CONFIG.stakeDeformVerticalScale ?? 0.6;
            const factorPerpVert = 1
                + sPos * squashBulge * verticalScale
                - sNeg * stretchPinch * verticalScale;

            // 限幅，防止参数极端时缩放跑飞
            const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
            this.deformGroup.scale.set(
                clamp(factorPerpHoriz, 0.2, 3.5), // X = 横向
                clamp(factorPerpVert,  0.3, 2.5), // Y = 纵向
                clamp(factorAxis,      0.2, 3.5)  // Z = 命中轴
            );
        }
    }
}
