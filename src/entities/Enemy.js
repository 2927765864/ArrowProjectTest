import * as THREE from 'three';
import { Globals, showRecallDamageText, triggerShake, triggerHaptic, disposeObject3D } from '../utils.js';
import { CONFIG } from '../config.js';
import { BloodStain } from '../effects/BloodStain.js';
import { SlashFlashEffect } from '../effects/SlashFlashEffect.js';
import { HitReaction } from '../effects/HitReaction.js';
import { EnemyHitBurstEffect } from '../effects/EnemyHitBurstEffect.js';

// ===== 共享几何（所有敌人复用，避免每个敌人独占一份）=====
// 这些几何与每个敌人无关，构建一次后所有敌人指向同一 GPU 缓冲。
// 注意：dispose 这些几何会让所有共享它的敌人失效；由于这是模块级常量，整个 app 生命周期都需要它们，
// 所以 dispose 时必须 SKIP 这些（disposeObject3D 仍会调用，但 Three.js 对已 dispose 的 buffer 容忍）。
// 我们改成：dispose 时只 dispose 材质（每实例独有）+ 不 dispose 共享几何。下方 die() 自定义。
const SHARED_BODY_GEO = new THREE.SphereGeometry(0.38, 16, 16); // 32→16，球面 segs 减半视觉无差但顶点数 1/4
const SHARED_EYE_GEO  = new THREE.CapsuleGeometry(0.04, 0.08, 4, 8); // 8/16 → 4/8
const SHARED_EAR_GEO  = new THREE.ConeGeometry(0.12, 0.22, 8); // 16 → 8

// scratch (模块级，所有 Enemy 共享，update 中复用避免每帧分配)
const _scratchDir = new THREE.Vector3();
const _ZERO_VEC = new THREE.Vector3(0, 0, 0); // lerp 目标用
const _scratchKnockback = new THREE.Vector3();
// 击退积分 scratch：每帧计算"剩余位移"和"本帧位移增量"用
const _scratchKbStep = new THREE.Vector3();

export class Enemy {
    constructor(spawnPosition = null, isDummy = false, options = {}) {
        this.isDummy = isDummy;
        // stationary = 站桩史莱姆：外观与普通史莱姆完全一致，但永远不追玩家、HP 无限。
        // 注意：与 isDummy 区别在于不改变颜色、不改变击退/眩晕参数组（仍走 hitS*），
        // 只关闭"主动 AI 朝玩家移动"这一项；其它（受击形变、击退、bounce）保持普通史莱姆行为。
        this.stationary = !!options.stationary;
        this.mesh = new THREE.Group(); 
        this.mesh.position.y = 0.4; 
        // ===== 击退状态（新模型：位移 + 速度曲线）=====
        // 旧模型用 knockbackVelocity（冲量+指数衰减），存在"力小则始终低速"的弊端。
        // 新模型用一组明确状态描述击退过程，详见 config.js 中 hitSKnockback* 的注释。
        //   · _kbDir       : 方向（单位向量）
        //   · _kbDistance  : 本次击退要走的总位移（米）
        //   · _kbStart/End : 初/末速度
        //   · _kbCurve     : 进度重映射指数 p (t' = t^p)
        //   · _kbDuration  : 由 2*Distance/(Start+End) 反推的持续时间
        //   · _kbElapsed   : 已经过的时间
        //   · _kbActive    : 当前是否处于击退过程
        this._kbDir = new THREE.Vector3();
        this._kbDistance = 0;
        this._kbStart = 0;
        this._kbEnd = 0;
        this._kbCurve = 1;
        this._kbDuration = 0;
        this._kbElapsed = 0;
        this._kbActive = false;
        this.stunTimer = 0; 
        
        let bodyColor = 0x5e55a2;
        let eyeColor = 0x91c53a;
        let hornColor = 0x5e55a2;
        
        if (this.isDummy) {
            bodyColor = 0xc2824e; // Wooden brown
            eyeColor = 0x4a3219;  // Dark wood
            hornColor = 0xa36c3e; // Slightly darker wood
        }
        
        // 材质 per-mesh：HitReaction.attach 会给每个材质打 onBeforeCompile patch + 注入 uChildPivot
        // uniform，让子 mesh 在 deformTarget 局部空间下作为整体跟随身体形变。
        // 眼睛/耳朵不能两侧共享材质（uChildPivot 是 per-material 的，共享会让左右眼互相覆盖位置）。
        const bodyMat = new THREE.MeshBasicMaterial({ color: bodyColor });
        const leftEyeMat  = new THREE.MeshBasicMaterial({ color: eyeColor });
        const rightEyeMat = new THREE.MeshBasicMaterial({ color: eyeColor });
        const leftEarMat  = new THREE.MeshBasicMaterial({ color: hornColor });
        const rightEarMat = new THREE.MeshBasicMaterial({ color: hornColor });
        this.materials = [bodyMat, leftEyeMat, rightEyeMat, leftEarMat, rightEarMat];
        this.materials.forEach((mat) => {
            mat.userData.baseColor = mat.color.getHex();
        });

        // 受击反馈（闪白 + 弹性形变），先创建实例，attach 留到知道 childPivot 后调用
        // 史莱姆使用独立的一组 hitS* CONFIG 字段（与柱状敌人的 hit* 完全隔离）
        this.hitReaction = new HitReaction({ configKey: 'hitS' });

        // 主身体：childPivot = (0,0,0)，因为 bodyMesh 自身的顶点就在 deformTarget 局部空间
        this.bodyMesh = new THREE.Mesh(SHARED_BODY_GEO, bodyMat);
        this.bodyMesh.scale.set(1.15, 0.9, 1.1);
        this.mesh.add(this.bodyMesh);
        this.hitReaction.attach(bodyMat); // 主 mesh，pivot 默认 (0,0,0)

        // 子 mesh：childPivot 必须等于"该 mesh 在 deformTarget(=bodyMesh) 局部空间下的中心位置"，
        // 也就是它的 mesh.position（因为子 mesh 直接挂在 bodyMesh 下）。
        const leftEye = new THREE.Mesh(SHARED_EYE_GEO, leftEyeMat);
        leftEye.position.set(0.16, 0.1, 0.32); leftEye.rotation.z = -0.3; leftEye.rotation.x = 0.2; leftEye.layers.enable(1); this.bodyMesh.add(leftEye);
        this.hitReaction.attach(leftEyeMat, leftEye.position);

        const rightEye = new THREE.Mesh(SHARED_EYE_GEO, rightEyeMat);
        rightEye.position.set(-0.16, 0.1, 0.32); rightEye.rotation.z = 0.3; rightEye.rotation.x = 0.2; rightEye.layers.enable(1); this.bodyMesh.add(rightEye);
        this.hitReaction.attach(rightEyeMat, rightEye.position);

        const leftEar = new THREE.Mesh(SHARED_EAR_GEO, leftEarMat);
        leftEar.position.set(0.25, 0.28, 0); leftEar.rotation.z = -0.4; leftEar.rotation.x = -0.1;
        this.bodyMesh.add(leftEar);
        this.hitReaction.attach(leftEarMat, leftEar.position);

        const rightEar = new THREE.Mesh(SHARED_EAR_GEO, rightEarMat);
        rightEar.position.set(-0.25, 0.28, 0); rightEar.rotation.z = 0.4; rightEar.rotation.x = -0.1;
        this.bodyMesh.add(rightEar);
        this.hitReaction.attach(rightEarMat, rightEar.position);
        
        this.animOffset = Math.random() * 10;
        if (spawnPosition) {
            this.mesh.position.x = spawnPosition.x;
            this.mesh.position.z = spawnPosition.z;
        }
        
        this.hp = (this.isDummy || this.stationary)
            ? Infinity
            : ((typeof CONFIG.enemyHP === 'number') ? CONFIG.enemyHP : 160); 
        // speedBias: [0,1)，每个敌人固定的随机偏向；实际速度 = base + bias * random幅度（每帧从 CONFIG 读）
        this.speedBias = Math.random();
        this.isDead = false;
        // ===== 濒死缓冲期（lethal grace window）=====
        // 当回收命中 (high/special) 把 hp 打到 ≤0 时，进入濒死缓冲期：
        //   - isPendingDeath = true，但 isDead 仍为 false（不被 main.js 从 Globals.enemies 移除）
        //   - _pendingDeathTimer 倒计时，归零后才调 die()
        //   - 期间 update() 提前 return（不再追击玩家、不再播 bounce）
        //   - 期间 takeDamage() 仍调 showRecallDamageText，让贯穿数字继续累加
        // 设计目的：让"血量很低被多把武器同时击中"也能完整呈现 240 ×5贯穿 的合并效果。
        this.isPendingDeath = false;
        this._pendingDeathTimer = 0;
        this._pendingDeathDir = null;
        // 史莱姆视觉大小 = enemyScale × slimeScaleMul（slimeScaleMul 仅这一类生效）
        this.mesh.scale.setScalar(CONFIG.enemyScale * (CONFIG.slimeScaleMul ?? 1));

        // 绑定 hitReaction 参考坐标系：命中位置转换基于 this.mesh（根 Group），形变应用在 bodyMesh 上
        this.hitReaction.setTargets(this.mesh, this.bodyMesh);

        Globals.scene.add(this.mesh); 
        Globals.enemies.push(this);
    }
    
    update(delta, time) {
        if (this.isDead) return;
        // 濒死缓冲：倒计时、停止 AI / 移动 / bounce，等同于"已死视觉，但仍可吸收命中"。
        // hitReaction 仍允许更新（让最后几次穿刺的闪白/形变播完更顺滑）。
        if (this.isPendingDeath) {
            this._pendingDeathTimer -= delta;
            if (this._pendingDeathTimer <= 0) {
                const dir = this._pendingDeathDir;
                this._pendingDeathDir = null;
                this.die(dir);
            } else if (this.hitReaction) {
                this.hitReaction.update(delta);
            }
            return;
        }
        if (this.stunTimer > 0) this.stunTimer -= delta;
        else if (!this.isDummy) {
            // 复用 scratchDir，避免每帧每敌人 new Vector3
            const playerPos = Globals.player.mesh.position;
            _scratchDir.subVectors(playerPos, this.mesh.position);
            _scratchDir.y = 0;
            const lenSq = _scratchDir.lengthSq();
            if (lenSq > 1e-8) {
                // stationary = 站桩史莱姆：跳过位移这一步，但仍保留下方"朝玩家转身"，
                // 让视觉与普通史莱姆一致（眼睛/耳朵朝向玩家），只是身体不前进。
                if (!this.stationary) {
                    _scratchDir.multiplyScalar(1 / Math.sqrt(lenSq));
                    const baseSpd = (typeof CONFIG.enemyMoveSpeedBase === 'number') ? CONFIG.enemyMoveSpeedBase : 2.5;
                    const randSpd = (typeof CONFIG.enemyMoveSpeedRandom === 'number') ? CONFIG.enemyMoveSpeedRandom : 1.5;
                    const curSpeed = Math.max(0, baseSpd + this.speedBias * randSpd);
                    this.mesh.position.addScaledVector(_scratchDir, curSpeed * delta);
                }
            }
            // 用 atan2 替代 lookAt：敌人只需要 Y 轴旋转，避免 lookAt 内部矩阵分解开销
            const dx = playerPos.x - this.mesh.position.x;
            const dz = playerPos.z - this.mesh.position.z;
            this.mesh.rotation.y = Math.atan2(dx, dz);
        }
        
        const bounce = this.isDummy ? 0 : Math.abs(Math.sin(time * 6 + this.animOffset));
        this.bodyMesh.position.y = bounce * 0.15;
        this.bodyMesh.scale.set(1.15 - bounce * 0.1, 0.9 + bounce * 0.15, 1.1 - bounce * 0.1);
        
        // ===== 击退积分（新模型：位移 + 速度曲线）=====
        // 模型说明见 applyKnockback() 及 config.js 的 hitSKnockback* 注释。
        // 每帧根据进度 t∈[0,1] 计算瞬时速度 v(t) = lerp(start, end, t^curve)，
        // 然后位移增量 = v(t) * delta。当 _kbElapsed ≥ _kbDuration 时结束。
        if (this._kbActive) {
            this._kbElapsed += delta;
            const T = this._kbDuration;
            // 计算本帧使用的"中点进度"——用 t = (_kbElapsed - delta/2) / T 比首/尾点采样更准
            // （梯形积分思想），尤其在 curve 偏离 1 时能让总位移更接近设定 Distance。
            let tMid = (this._kbElapsed - delta * 0.5) / T;
            if (tMid < 0) tMid = 0;
            if (tMid > 1) tMid = 1;
            const remap = (this._kbCurve === 1) ? tMid : Math.pow(tMid, this._kbCurve);
            const v = this._kbStart + (this._kbEnd - this._kbStart) * remap;
            // 本帧位移 = v * dt（注意收尾帧不要走超时间）
            const dt = Math.min(delta, T - (this._kbElapsed - delta));
            if (dt > 0 && v > 0) {
                this.mesh.position.addScaledVector(this._kbDir, v * dt);
            }
            if (this._kbElapsed >= T) {
                this._kbActive = false;
                this._kbDistance = 0;
            }
        }

        // 把敌人 clamp 在"玩家可移动范围"内：连续被击退会把敌人推出玩家走不到的区域，
        // 这里做边界约束。撞到边界后还要把"指向墙外"的位移方向分量清零，否则击退
        // 会持续顶在墙上、让 hitReaction 的弯曲形变和位置插值长时间停在边界上。
        // 注意：玩家可达区域 = visibleGroundBounds 缩进 (0.6*playerScale, 0.8*playerScale)，
        // 见 main.js 中玩家位置 clamp。这里和玩家用同一套 margin，再额外加敌人自身半径
        // 让敌人身体也不会越出玩家可达范围。
        const bounds = Globals.visibleGroundBounds;
        if (bounds && bounds.maxX > bounds.minX) {
            const playerScale = (typeof CONFIG.playerScale === 'number') ? CONFIG.playerScale : 2.5;
            const enemyRadius = 0.45 * (typeof CONFIG.enemyScale === 'number' ? CONFIG.enemyScale : 1);
            const marginX = 0.6 * playerScale + enemyRadius;
            const marginZ = 0.8 * playerScale + enemyRadius;
            const px = this.mesh.position.x;
            const pz = this.mesh.position.z;
            const minX = bounds.minX + marginX;
            const maxX = bounds.maxX - marginX;
            const minZ = bounds.minZ + marginZ;
            const maxZ = bounds.maxZ - marginZ;
            if (px < minX) {
                this.mesh.position.x = minX;
                if (this._kbDir.x < 0) this._kbDir.x = 0;
            } else if (px > maxX) {
                this.mesh.position.x = maxX;
                if (this._kbDir.x > 0) this._kbDir.x = 0;
            }
            if (pz < minZ) {
                this.mesh.position.z = minZ;
                if (this._kbDir.z < 0) this._kbDir.z = 0;
            } else if (pz > maxZ) {
                this.mesh.position.z = maxZ;
                if (this._kbDir.z > 0) this._kbDir.z = 0;
            }
        }

        // 受击闪白 + 形变弹性系统更新
        if (this.hitReaction) this.hitReaction.update(delta);
    }
    
    /**
     * 新模型击退：4 参数（总位移 / 初速度 / 末速度 / 速度曲线指数）。
     *
     * @param {THREE.Vector3} direction 击退方向（不必归一化，本方法会自动归一）
     * @param {object} [params] 可选；不传时使用 CONFIG.hitSKnockback* 默认值
     * @param {number} [params.distance]   总位移（米）
     * @param {number} [params.startSpeed] 初速度（米/秒）
     * @param {number} [params.endSpeed]   末速度（米/秒）
     * @param {number} [params.curve]      速度曲线指数 p（t' = t^p；<1 前快后慢，>1 前慢后快）
     *
     * 叠加规则（已在击退过程中再次命中）：
     *   - 进度被重置为 0
     *   - 新方向 = 上次"剩余位移向量" + "新位移向量"，再归一化
     *   - 新 distance = 该合成向量的长度
     *   - StartSpeed/EndSpeed/Curve 取本次的新值（让每次命中都能感受到完整的"初速度爆发"）
     *
     * 同时触发 HitReaction 的 bend 形变；force 参数用 distance 作为"等效冲量"传给它
     * （bend 内部按 force 大小注入弹簧初值，distance 越大形变越夸张，符合直觉）。
     */
    applyKnockback(direction, params) {
        if (this.isDummy) return;

        // 从 CONFIG 读默认值；params 中提供的字段覆盖默认
        const distance = (params && typeof params.distance === 'number')
            ? params.distance
            : (typeof CONFIG.hitSKnockbackDistance === 'number' ? CONFIG.hitSKnockbackDistance : 1.0);
        const startSpeed = (params && typeof params.startSpeed === 'number')
            ? params.startSpeed
            : (typeof CONFIG.hitSKnockbackStartSpeed === 'number' ? CONFIG.hitSKnockbackStartSpeed : 12.0);
        const endSpeed = (params && typeof params.endSpeed === 'number')
            ? params.endSpeed
            : (typeof CONFIG.hitSKnockbackEndSpeed === 'number' ? CONFIG.hitSKnockbackEndSpeed : 2.0);
        const curve = (params && typeof params.curve === 'number')
            ? params.curve
            : (typeof CONFIG.hitSKnockbackCurve === 'number' ? CONFIG.hitSKnockbackCurve : 1.0);

        // 退化情况：距离为 0 或两个速度都为 0 → 仅触发 bend 形变，不做位移
        const avgSpeed = (startSpeed + endSpeed) * 0.5;
        if (distance <= 1e-6 || avgSpeed <= 1e-6) {
            if (this.hitReaction) {
                this.hitReaction.triggerBend(direction, distance);
            }
            return;
        }

        // 归一化方向（容错：零向量直接跳过）
        _scratchKnockback.copy(direction);
        _scratchKnockback.y = 0; // 击退只发生在水平面，避免任何 Y 分量把敌人顶上天
        const dirLenSq = _scratchKnockback.lengthSq();
        if (dirLenSq < 1e-8) return;
        _scratchKnockback.multiplyScalar(1 / Math.sqrt(dirLenSq));

        // ===== 叠加：方向合成 =====
        // 若上一次击退还在进行中，把"剩余位移向量"和"新位移向量"合成。
        let combinedDist = distance;
        if (this._kbActive) {
            // 用 (1 - 进度) 估算剩余位移占比；这里用 elapsed/duration 作为时间进度的近似
            // （严格来说应该按 ∫v(t)dt 算剩余位移，但对手感影响很小，简化处理）
            const tProg = Math.min(1, this._kbElapsed / Math.max(this._kbDuration, 1e-6));
            const remainFrac = 1 - tProg;
            const remainDist = this._kbDistance * remainFrac;

            // 剩余位移向量 + 新位移向量
            _scratchKbStep.copy(this._kbDir).multiplyScalar(remainDist);
            _scratchKbStep.addScaledVector(_scratchKnockback, distance);

            const combLenSq = _scratchKbStep.lengthSq();
            if (combLenSq > 1e-8) {
                combinedDist = Math.sqrt(combLenSq);
                _scratchKnockback.copy(_scratchKbStep).multiplyScalar(1 / combinedDist);
            }
        }

        // 写入击退状态，进度重置为 0
        this._kbDir.copy(_scratchKnockback);
        this._kbDistance = combinedDist;
        this._kbStart = Math.max(0, startSpeed);
        this._kbEnd = Math.max(0, endSpeed);
        this._kbCurve = Math.max(0.01, curve);
        // 持续时间：T = 2 * Distance / (Start + End)（梯形面积反推匀加/减速时长）
        // 注意：曲线指数 ≠ 1 时实际积分位移 ≈ Distance 而非严格等于，差异通常 <5%。
        this._kbDuration = (2 * combinedDist) / (this._kbStart + this._kbEnd);
        this._kbElapsed = 0;
        this._kbActive = true;

        // 触发"被推弯曲"形变（与 takeDamage 的 squash 通道独立运行；
        // squash 是命中瞬间的对称压扁，bend 是被推的方向性弯曲，两者叠加更有冲击感）
        // 这里用 distance 作为传给 bend 的"等效冲量大小"——distance 越大，弯曲越强。
        if (this.hitReaction) {
            this.hitReaction.triggerBend(direction, distance);
        }
    }
    
    applyStun(duration) { 
        this.stunTimer = Math.max(this.stunTimer, duration); 
    }
    
    takeDamage(amount, type, direction, hitPointWorld, isCrit = false) {
        // 濒死缓冲期内：不再扣血、不再触发受击形变（视觉已处于"将死"），
        // 但仍走 showRecallDamageText —— 让后续武器的命中累加到同一个跳字的贯穿数上。
        // 这是实现"低血量被多武器同时击中也显示 240 ×N贯穿"的关键路径。
        if (this.isPendingDeath) {
            showRecallDamageText(this, this.mesh.position, amount, type, direction, isCrit);
            return;
        }

        this.hp -= amount;

        // 受击反馈：闪白 + 弹性凹陷形变（史莱姆专用参数 CONFIG.hitSFlash* / hitSDeform*）
        if (this.hitReaction) {
            this.hitReaction.trigger(hitPointWorld || null, direction || null);
        }

        showRecallDamageText(this, this.mesh.position, amount, type, direction, isCrit);

        if (this.hp <= 0 && !this.isDead) {
            // 致命一击：仅"回收命中(high/special)"进入濒死缓冲，让后续武器有机会合并；
            // 主动攻击 (low) 与暴击维持原有"立即死亡"行为，保证手感不变。
            const isRecall = (type === 'high' || type === 'special');
            const window = Math.max(0, CONFIG.dmgRecMergeWindow ?? 0);
            if (isRecall && window > 0) {
                this.isPendingDeath = true;
                this._pendingDeathTimer = window;
                this._pendingDeathDir = direction ? direction.clone() : null;
            } else {
                this.die(direction);
            }
        }
    }
    
    die(direction) {
        this.isDead = true;
        // 离开濒死缓冲态（无论是被计时器自然 trigger 还是被外部强制 die）
        this.isPendingDeath = false;
        this._pendingDeathTimer = 0;
        this._pendingDeathDir = null;
        if (this.hitReaction) this.hitReaction.reset();
        triggerHaptic('die');
        triggerShake(CONFIG.shakeIntensityDeath, CONFIG.shakeDuration); 
        const pos = this.mesh.position.clone(); 
        const dir = direction || new THREE.Vector3(0,0,1);

        Globals.audioManager?.playEnemyDeath();

        Globals.slashEffects.push(new SlashFlashEffect(pos, dir, CONFIG.enemyScale));

        // ===== 死亡爆体特效（细节注释保持原状）=====
        if (this._recallBurstMerge && this._recallBurstMerge.effect) {
            this._recallBurstMerge.effect.destroy?.();
            this._recallBurstMerge = null;
        }
        const enemyBaseColor = this.materials?.[0]?.userData?.baseColor;
        const deathBurst = new EnemyHitBurstEffect(pos, enemyBaseColor);
        if (deathBurst.alive) {
            const maxCount = Math.max(1, CONFIG.recallHitBurstCountForMax ?? 10);
            deathBurst.addBurst(maxCount);
            Globals.enemyHitBurstEffects.push(deathBurst);
        }

        if (!this.isDummy) {
            Globals.bloodStains.push(new BloodStain(pos));
        }

        // 只 dispose 材质（每实例独有），不动共享几何（SHARED_BODY_GEO 等）。
        // disposeObject3D 会一并 dispose 几何，所以这里手写：
        for (let i = 0; i < this.materials.length; i++) {
            const m = this.materials[i];
            if (m && typeof m.dispose === 'function') m.dispose();
        }
        Globals.scene.remove(this.mesh);
    }
}
