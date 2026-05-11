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

export class Enemy {
    constructor(spawnPosition = null, isDummy = false) {
        this.isDummy = isDummy;
        this.mesh = new THREE.Group(); 
        this.mesh.position.y = 0.4; 
        this.knockbackVelocity = new THREE.Vector3(0, 0, 0); 
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
        this.hitReaction = new HitReaction();

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
        
        this.hp = this.isDummy
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
        this.mesh.scale.setScalar(CONFIG.enemyScale);

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
                _scratchDir.multiplyScalar(1 / Math.sqrt(lenSq));
                const baseSpd = (typeof CONFIG.enemyMoveSpeedBase === 'number') ? CONFIG.enemyMoveSpeedBase : 2.5;
                const randSpd = (typeof CONFIG.enemyMoveSpeedRandom === 'number') ? CONFIG.enemyMoveSpeedRandom : 1.5;
                const curSpeed = Math.max(0, baseSpd + this.speedBias * randSpd);
                this.mesh.position.addScaledVector(_scratchDir, curSpeed * delta);
            }
            // 用 atan2 替代 lookAt：敌人只需要 Y 轴旋转，避免 lookAt 内部矩阵分解开销
            const dx = playerPos.x - this.mesh.position.x;
            const dz = playerPos.z - this.mesh.position.z;
            this.mesh.rotation.y = Math.atan2(dx, dz);
        }
        
        const bounce = this.isDummy ? 0 : Math.abs(Math.sin(time * 6 + this.animOffset));
        this.bodyMesh.position.y = bounce * 0.15;
        this.bodyMesh.scale.set(1.15 - bounce * 0.1, 0.9 + bounce * 0.15, 1.1 - bounce * 0.1);
        
        // 仅在确实有击退时才 lerp，避免对零向量做无意义的 lerp(new Vector3())
        if (this.knockbackVelocity.lengthSq() > 0.01) {
            this.mesh.position.addScaledVector(this.knockbackVelocity, delta);
            this.knockbackVelocity.lerp(_ZERO_VEC, delta * 10);
        }

        // 把敌人 clamp 在"玩家可移动范围"内：连续被击退会把敌人推出玩家走不到的区域，
        // 这里做边界约束。撞到边界后还要把"指向墙外"的速度分量清零，否则击退向量会
        // 持续顶在墙上、让 hitReaction 的弯曲形变和位置插值长时间停在边界上。
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
                if (this.knockbackVelocity.x < 0) this.knockbackVelocity.x = 0;
            } else if (px > maxX) {
                this.mesh.position.x = maxX;
                if (this.knockbackVelocity.x > 0) this.knockbackVelocity.x = 0;
            }
            if (pz < minZ) {
                this.mesh.position.z = minZ;
                if (this.knockbackVelocity.z < 0) this.knockbackVelocity.z = 0;
            } else if (pz > maxZ) {
                this.mesh.position.z = maxZ;
                if (this.knockbackVelocity.z > 0) this.knockbackVelocity.z = 0;
            }
        }

        // 受击闪白 + 形变弹性系统更新
        if (this.hitReaction) this.hitReaction.update(delta);
    }
    
    applyKnockback(direction, force) { 
        if (!this.isDummy) {
            // 复用 scratch 避免 direction.clone()
            _scratchKnockback.copy(direction).multiplyScalar(force);
            this.knockbackVelocity.add(_scratchKnockback);
            // 触发"被推弯曲"形变（与 takeDamage 的 squash 通道独立运行；
            // squash 是命中瞬间的对称压扁，bend 是被推的方向性弯曲，两者叠加更有冲击感）
            if (this.hitReaction) {
                this.hitReaction.triggerBend(direction, force);
            }
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

        // 受击反馈：闪白 + 弹性凹陷形变（参数来自 CONFIG.hitFlash* / hitDeform*）
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
