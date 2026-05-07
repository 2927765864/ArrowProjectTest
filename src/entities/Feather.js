import * as THREE from 'three';
import { Globals, triggerShake, triggerHaptic, disposeObject3D } from '../utils.js';
import { CONFIG } from '../config.js';
import { RecallCourierEffect } from '../effects/RecallCourierEffect.js';
import { HitSparkEffect } from '../effects/HitSparkEffect.js';
import { EnemyHitBurstEffect } from '../effects/EnemyHitBurstEffect.js';
import { JavelinVFX } from '../effects/JavelinVFX.js';

const HELD_WEAPON_SCALE_BASE = 0.08;
const FEATHER_MODEL_SCALE_BASE = 0.35;

// ===== 模块级 scratch（所有 Feather 实例共享，热路径复用避免每帧 GC）=====
const _scratchCurrentDir = new THREE.Vector3();
const _scratchPlayerPt = new THREE.Vector3();
const _scratchEntryPos = new THREE.Vector3();
const _scratchExitPos = new THREE.Vector3();
const _scratchHitPointWorld = new THREE.Vector3();
const _scratchMeshFwd = new THREE.Vector3();
const _scratchTipPos = new THREE.Vector3();
const _scratchToTip = new THREE.Vector3();
const _scratchSparkHitPoint = new THREE.Vector3();

export function createWeaponModel(scale = 0.35) {
    const modelGroup = new THREE.Group();
    const spearMat = new THREE.MeshBasicMaterial({ color: 0x91c53a });

    const shaftGeo = new THREE.CapsuleGeometry(0.18, 6.64, 2, 6);
    const shaft = new THREE.Mesh(shaftGeo, spearMat);
    shaft.position.y = -3.5;
    shaft.scale.z = 0.8;
    modelGroup.add(shaft);

    const ptsR = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.35, 0.5, 0),
        new THREE.Vector3(0.2, 1.0, 0),
        new THREE.Vector3(0.3, 1.5, 0),
        new THREE.Vector3(0.15, 4.0, 0)
    ];
    const widths = [0.18, 0.16, 0.16, 0.14, 0.12];

    const buildProng = (points, side) => {
        const group = new THREE.Group();
        const sign = side === 'left' ? -1 : 1;
        
        for(let i = 0; i < points.length; i++) {
            const p = points[i].clone();
            p.x *= sign;
            
            const jointGeo = new THREE.SphereGeometry(widths[i], 6, 4);
            const joint = new THREE.Mesh(jointGeo, spearMat);
            joint.position.copy(p);
            joint.scale.z = 0.8;
            group.add(joint);
            
            if (i < points.length - 1) {
                const pNext = points[i+1].clone();
                pNext.x *= sign;
                
                const dist = p.distanceTo(pNext);
                const segGeo = new THREE.CylinderGeometry(widths[i+1], widths[i], dist, 6);
                const seg = new THREE.Mesh(segGeo, spearMat);
                
                const dir = new THREE.Vector3().subVectors(pNext, p).normalize();
                seg.position.copy(p).add(pNext).multiplyScalar(0.5);
                seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
                seg.scale.z = 0.8;
                
                group.add(seg);
            }
        }
        return group;
    };

    modelGroup.add(buildProng(ptsR, 'right'));
    modelGroup.add(buildProng(ptsR, 'left'));

    modelGroup.position.set(0, 0, 0.35);
    modelGroup.scale.setScalar(scale);
    modelGroup.rotation.set(Math.PI / 2, 0, 0);

    return modelGroup;
}

export class Feather {
    constructor(targetEnemy, isSpecial = false, originPos = null) {
        this.phase = 'shooting'; 
        this.index = 0; 
        this.speed = CONFIG.deployInitialSpeed; 
        this.hitEnemies = new Set(); 
        this.isSpecial = isSpecial; 
        this.hitStopTimer = 0; 
        this.baseModelScale = this._getConfiguredModelScale();
        this.recallIntroActive = false;
        this.recallCourierEffect = null;
        this.recallPending = false;

        this.deploymentRing = new THREE.Group();
        this.deploymentRing.visible = false;
        
        const radius = isSpecial ? CONFIG.deployRingRadiusSpecial : CONFIG.deployRingRadiusNormal;
        this.baseRingRadius = radius;
        const ringGeo = new THREE.RingGeometry(radius - 0.04, radius + 0.04, 64);
        this.deploymentRingMaterial = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: isSpecial ? CONFIG.deployRingOpacitySpecial : CONFIG.deployRingOpacityNormal,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        
        const ringMesh = new THREE.Mesh(ringGeo, this.deploymentRingMaterial);
        ringMesh.rotation.x = -Math.PI / 2;
        this.deploymentRing.add(ringMesh);

        this.arrowContainer = new THREE.Group();
        
        const arrowShape = new THREE.Shape();
        arrowShape.moveTo(0, -0.15); // Tip pointing down (-Y)
        arrowShape.quadraticCurveTo(0.08, -0.03, 0.18, 0.1); 
        arrowShape.quadraticCurveTo(0.05, 0.01, 0.0, 0.05); 
        arrowShape.quadraticCurveTo(-0.05, 0.01, -0.18, 0.1); 
        arrowShape.quadraticCurveTo(-0.08, -0.03, 0, -0.15);

        const arrowGeo = new THREE.ShapeGeometry(arrowShape);
        this.deploymentArrowMaterial = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: CONFIG.deployArrowOpacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        this.arrowMesh = new THREE.Mesh(arrowGeo, this.deploymentArrowMaterial);
        this.arrowMesh.rotation.x = -Math.PI / 2;
        this.arrowMesh.position.z = radius; // Place on the edge of the ring
        this.arrowMesh.scale.set(CONFIG.deployArrowScale, CONFIG.deployArrowScale * CONFIG.deployArrowLength, 1);
        
        this.arrowContainer.add(this.arrowMesh);
        this.deploymentRing.add(this.arrowContainer);

        Globals.scene.add(this.deploymentRing);
        
        this.mesh = new THREE.Group(); 
        this.modelGroup = new THREE.Group(); 
        this.mesh.add(this.modelGroup);
        
        
        const quillMat = new THREE.MeshBasicMaterial({ 
            color: 0x91c53a 
        });
        const tipMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a
        });
        
        const tempModel = createWeaponModel(this.baseModelScale);
        while(tempModel.children.length > 0) {
            this.modelGroup.add(tempModel.children[0]);
        }
        this.modelGroup.position.copy(tempModel.position);
        this.modelGroup.rotation.copy(tempModel.rotation);
        this.modelGroup.scale.copy(tempModel.scale);

        if (isSpecial) this.mesh.scale.set(1.4, 1.4, 1.4);
        
        if (originPos) {
            this.mesh.position.copy(originPos);
        } else {
            this.mesh.position.copy(Globals.player.mesh.position); 
            this.mesh.position.y = 1; 
        }
        Globals.scene.add(this.mesh);
        
        this.originPos = this.mesh.position.clone();
        const pt = this.originPos.clone();
        const et = targetEnemy.mesh.position.clone(); et.y = pt.y;
        const dir = new THREE.Vector3().subVectors(et, pt).normalize(); 
        this.direction = dir;
        this.mesh.lookAt(this.mesh.position.clone().add(dir));
        
        // 记录基础的纯水平姿态（用于后续插值）
        this.baseQuat = this.mesh.quaternion.clone();
        
        this.distanceToTarget = pt.distanceTo(et);
        this.traveledDistance = 0;
        this.startY = pt.y;

        this.javelinVfx = new JavelinVFX();
        this.javelinVfx.start(this.mesh.position, this.direction);
        this.modelGroup.visible = false;

        // 武器尖端在 modelGroup 内部的 Y 坐标（见几何定义：ptsR 末点 (0.015, 6.0, 0)）
        // 经过 modelGroup 的 scale 与 rotation.set(PI/2,0,0) 变换后，映射到 this.mesh 局部的 +Z 方向
        // 再叠加 modelGroup.position.z = 0.35 得到尖端在 this.mesh 局部坐标系的 Z 距离
        this._weaponTipLocalZ = 6.0 * this.baseModelScale + 0.35;
    }

    _getConfiguredModelScale() {
        const heldScale = Math.max(0.001, CONFIG.attackHeldWeaponScale ?? HELD_WEAPON_SCALE_BASE);
        return FEATHER_MODEL_SCALE_BASE * (heldScale / HELD_WEAPON_SCALE_BASE);
    }

    _syncConfiguredModelScale() {
        const nextBaseModelScale = this._getConfiguredModelScale();
        if (Math.abs(nextBaseModelScale - this.baseModelScale) < 0.0001) return;
        const currentScaleFactor = this.baseModelScale > 0
            ? (this.modelGroup.scale.x / this.baseModelScale)
            : 1;
        this.baseModelScale = nextBaseModelScale;
        this.modelGroup.scale.setScalar(this.baseModelScale * currentScaleFactor);
    }
    
    update(delta) {
        this._syncConfiguredModelScale();
        let stepDelta = delta;
        if (this.hitStopTimer > 0) {
            const pausedDelta = Math.min(stepDelta, this.hitStopTimer);
            this.hitStopTimer -= pausedDelta;
            stepDelta -= pausedDelta;
            if (stepDelta <= 0) return;
        }
        
        if (this.phase === 'shooting') {
            this.speed = Math.max(CONFIG.deployMinSpeed, this.speed - CONFIG.deployFriction * stepDelta);
            const fullTravelStep = this.speed * stepDelta;
            const postPierceSpeedScale = Math.max(0.01, CONFIG.attackPostPierceSpeedScale ?? 0.3);
            let travelStep = fullTravelStep;
            if (this.traveledDistance >= this.distanceToTarget) {
                travelStep = fullTravelStep * postPierceSpeedScale;
            } else if (this.traveledDistance + fullTravelStep > this.distanceToTarget) {
                const prePierceStep = this.distanceToTarget - this.traveledDistance;
                const postPierceStep = fullTravelStep - prePierceStep;
                travelStep = prePierceStep + postPierceStep * postPierceSpeedScale;
            }
            this.traveledDistance += travelStep;
            
            // 纯粹的运动学计算：X和Z直接由水平匀减速距离计算得出，不再依赖速度向量积分
            // 注意：这里先算出"武器整体参考点"的目标位置（即没有绕尖端补偿时的 mesh 位置），
            // 再在尖端旋转时加上补偿，让尖端保持在该参考轨迹上，整体看起来像"被头尖牵引下坠"。
            const baseX = this.originPos.x + this.direction.x * this.traveledDistance;
            const baseZ = this.originPos.z + this.direction.z * this.traveledDistance;

            const postPierceDist = this.traveledDistance - this.distanceToTarget;

            if (postPierceDist > 0) {
                // 已穿透敌人，开始进入落地滑行/下坠抛物线
                const maxPostDist = Math.max(0.1, CONFIG.pierceDistBeforeDrop);
                const t = Math.min(1.0, postPierceDist / maxPostDist);
                
                // Y轴插值：平滑下降，随进度呈平方加速 (抛物线效果)
                const baseY = THREE.MathUtils.lerp(this.startY, 0.8, t * t);
                
                // 倾角插值：直接转换为弧度。缓动曲线采用 t^1.5，实现先缓后急的扎地低头效果
                const currentPitchDeg = THREE.MathUtils.lerp(0, CONFIG.groundInsertPitch, Math.pow(t, 1.5));
                const currentPitchRad = THREE.MathUtils.degToRad(currentPitchDeg);
                
                // 基于水平基准姿态，进行局部 X 轴的正向旋转（使武器前端向下）
                const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), currentPitchRad); 
                this.mesh.quaternion.copy(this.baseQuat).multiply(pitchQuat);

                // === 绕头尖旋转：位置补偿 ===
                // 思路：当 pitchQuat 绕 mesh 局部 X 轴旋转角 θ 时，若不做补偿，
                // 位于 mesh 局部 (0, 0, L) 处的尖端会运动到 (0, -L*sinθ, L*cosθ)。
                // 为让尖端始终停在"未旋转时的位置"，需要把 mesh 自身向后位移
                // deltaLocal = (0, L*sinθ, L*(1-cosθ))，再通过 baseQuat 旋到世界空间并乘 mesh.scale。
                // tipBias 控制支点从"武器中心"(0) 到"武器头尖"(1) 的平滑切换，可超过 1。
                const tipBias = CONFIG.attackPitchPivotTipBias ?? 1.0;
                const tipOffset = CONFIG.attackPitchPivotTipOffset ?? 0.0;
                const L = tipBias * this._weaponTipLocalZ + tipOffset;
                const sinP = Math.sin(currentPitchRad);
                const cosP = Math.cos(currentPitchRad);
                const meshScale = this.mesh.scale.x; // mesh 是统一缩放
                const deltaLocal = new THREE.Vector3(0, L * sinP, L * (1 - cosP)).multiplyScalar(meshScale);
                // 把局部补偿转换到世界空间（this.mesh 目前的朝向是 baseQuat * pitchQuat，
                // 但补偿的目的是让 pitch 前后尖端位置相同，因此应只使用 baseQuat 做变换参考）
                const deltaWorld = deltaLocal.applyQuaternion(this.baseQuat);

                this.mesh.position.set(baseX + deltaWorld.x, baseY + deltaWorld.y, baseZ + deltaWorld.z);

                // 判断是否真正着地 (t达到1)
                if (t >= 1.0) {
                    this.phase = 'deployed';
                    this.modelGroup.visible = true;
                    if (this.javelinVfx) {
                        // 武器落地：分离特效，让它自己播完
                        this.javelinVfx.detach();
                        this.javelinVfx = null;
                    }
                    this.updateDeploymentRing();
                    Globals.audioManager?.playDeploy(this.isSpecial);
                }
            } else {
                // 还未穿透敌人前，保持水平飞行
                this.mesh.position.set(baseX, this.startY, baseZ);
                this.mesh.quaternion.copy(this.baseQuat);
            }
            
            if (this.javelinVfx) {
                // 仅同步位置/速度，不再每帧驱动其生命周期
                this.javelinVfx.follow(this.mesh.position, this.direction.clone().multiplyScalar(this.speed));
                // 武器穿过敌人后停止生成新的音障环（已生成的会自然播完）
                if (this.traveledDistance >= this.distanceToTarget) {
                    this.javelinVfx.setRingsEnabled(false);
                }
            }

            this.checkCollision('low', CONFIG.playerAttackDamage);
        } else if (this.phase === 'deployed') {
            // this.updateTetherLine();
            this.updateDeploymentRing();
        } else if (this.phase === 'recalling') {
            if (this.recallIntroActive) {
                this.mesh.visible = false;
                this.deploymentRing.visible = false;
                return;
            }

            const pt = Globals.player.mesh.position.clone(); pt.y = 1; 
            const dir = new THREE.Vector3().subVectors(pt, this.mesh.position).normalize();
            
            // Look AT player = tip pointing inwards (towards player)
            this.mesh.lookAt(this.mesh.position.clone().add(dir));
            
            const dist = this.mesh.position.distanceTo(pt); 
            const step = this.speed * stepDelta;
            
            // Animation for getting absorbed
            if (dist < 3.0) {
                const p = dist / 3.0; // 1.0 down to 0.0
                const scale = Math.max(0.01, p);
                this.modelGroup.scale.setScalar(this.baseModelScale * scale); // Shrink rapidly
                
                // Become brighter green and additive
                this.modelGroup.traverse(child => {
                    if (child.isMesh && child.material) {
                        child.material.color.lerp(new THREE.Color(0xd4ff99), 1.0 - p); // Bright yellowish green
                        child.material.transparent = true;
                        child.material.blending = THREE.AdditiveBlending;
                    }
                });
            }

            if (dist <= step || dist < 0.5) {
                Globals.audioManager?.playRecallComplete();
                if (Globals.player && Globals.player.playCatch) {
                    Globals.player.playCatch();
                    // 武器回到玩家身处时的粒子已移除，待重构
                }
                this.destroy();
            } else {
                this.mesh.position.addScaledVector(dir, step);
            }
            // this.updateTetherLine();
            this.deploymentRing.visible = false;
            let dmg = CONFIG.playerRecallDamage, type = 'high';
            if (this.isSpecial) { dmg = CONFIG.playerRecallDamageSpecial; type = 'special'; }
            this.checkCollision(type, dmg);
        }
    }

    restoreRecallVisuals() {
        this.modelGroup.scale.setScalar(this.baseModelScale);
        this.modelGroup.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            child.material.color.setHex(0x91c53a);
            child.material.transparent = false;
            child.material.opacity = 1;
            child.material.blending = THREE.NormalBlending;
        });
    }

    updateDeploymentRing() {
        this.deploymentRing.position.set(this.mesh.position.x, 0.08, this.mesh.position.z);
        
        // Sync parameters in real-time
        const currentRadius = this.isSpecial ? CONFIG.deployRingRadiusSpecial : CONFIG.deployRingRadiusNormal;
        this.deploymentRingMaterial.opacity = this.isSpecial ? CONFIG.deployRingOpacitySpecial : CONFIG.deployRingOpacityNormal;
        this.deploymentArrowMaterial.opacity = CONFIG.deployArrowOpacity;
        this.arrowMesh.scale.set(CONFIG.deployArrowScale, CONFIG.deployArrowScale * CONFIG.deployArrowLength, 1);
        
        // Update ring radius dynamically by scaling the ring mesh.
        // Base geometry was created with a specific radius.
        // To find the scale factor, we divide current by base radius.
        // A simple way is to just recreate the geometry if radius changes, or store base radius.
        // Let's store base radius in the constructor.
        if (this.baseRingRadius !== currentRadius) {
            const ringGeo = new THREE.RingGeometry(currentRadius - 0.04, currentRadius + 0.04, 64);
            this.deploymentRing.children[0].geometry.dispose();
            this.deploymentRing.children[0].geometry = ringGeo;
            this.baseRingRadius = currentRadius;
            this.arrowMesh.position.z = currentRadius;
        }
        
        // Rotate the arrow to point to the player
        if (Globals.player && Globals.player.mesh) {
            // Use the ring's world Y to avoid tilting the arrow container up/down
            this.arrowContainer.lookAt(Globals.player.mesh.position.x, 0.08, Globals.player.mesh.position.z);
        }

        this.deploymentRing.visible = true;
    }

    // Removed ensureTetherSegments and ensureDeploymentRingSegments

    
    checkCollision(damageType, damageAmount) {
        for (let i = Globals.enemies.length - 1; i >= 0; i--) {
            const enemy = Globals.enemies[i]; 
            if (enemy.isDead) continue;
            
            if (this.mesh.position.distanceTo(enemy.mesh.position) < 1.5) {
                if (!this.hitEnemies.has(enemy)) {
                    this.hitEnemies.add(enemy);
                    // 复用模块 scratch，避免每次命中 ~10 个 Vector3 分配
                    const currentDir = _scratchCurrentDir;
                    if (this.phase === 'shooting') {
                        currentDir.copy(this.direction);
                    } else {
                        const pt = _scratchPlayerPt.copy(Globals.player.mesh.position);
                        pt.y = 1;
                        currentDir.subVectors(pt, this.mesh.position).normalize();
                    }

                    const offset = 0.4 * CONFIG.enemyScale;
                    const entryPos = _scratchEntryPos.copy(enemy.mesh.position).addScaledVector(currentDir, -offset);
                    // exitPos 暂未使用，但保留语义；写入 scratch 后丢弃即可
                    _scratchExitPos.copy(enemy.mesh.position).addScaledVector(currentDir, offset);
                    // 命中点用"入射点"的世界坐标，作为弹性形变的凹陷中心
                    const hitPointWorld = _scratchHitPointWorld.copy(entryPos);
                    // ---- 击中火花特效的视觉刺入点 ----
                    const meshFwd = _scratchMeshFwd.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
                    const tipPos = _scratchTipPos.copy(this.mesh.position).addScaledVector(meshFwd, this._weaponTipLocalZ);
                    const enemyRadius = 0.45 * CONFIG.enemyScale;
                    const toTip = _scratchToTip.copy(tipPos).sub(enemy.mesh.position);
                    const along = toTip.dot(currentDir);
                    const clampedAlong = THREE.MathUtils.clamp(along, -enemyRadius, enemyRadius);
                    const sparkHitPoint = _scratchSparkHitPoint
                        .copy(enemy.mesh.position)
                        .addScaledVector(currentDir, clampedAlong);
                    sparkHitPoint.y = tipPos.y;
                    enemy.takeDamage(damageAmount, damageType, currentDir, hitPointWorld);
                    
                    if (damageType === 'low') {
                        // 主动攻击 · 飞行穿刺（前三根普通 / 第4根特殊各自独立）
                        triggerHaptic('hit');
                        Globals.audioManager?.playHit('low');
                        enemy.applyKnockback(currentDir, CONFIG.hitKnockbackForce ?? 10);
                        this.hitStopTimer = this.isSpecial
                            ? (CONFIG.attackHitVisualPauseSpecial ?? 0.03)
                            : (CONFIG.attackHitVisualPause ?? 0.02);
                        if (this.isSpecial) triggerShake(CONFIG.shakeIntensityThrowSpecial, CONFIG.shakeDurationThrowSpecial);
                        else triggerShake(CONFIG.shakeIntensityThrow, CONFIG.shakeDurationThrow);
                        // 主动攻击命中：在矛尖刺入点生成"流星火花"受击特效
                        // hitSparkReverseDir：默认 false（朝玩家方向飞溅），true 则朝敌人身后飞溅
                        Globals.hitSparkEffects.push(new HitSparkEffect(
                            sparkHitPoint,
                            currentDir,
                            {
                                scale: this.isSpecial ? 1.25 : 1.0,
                                reverseDir: !!CONFIG.hitSparkReverseDir
                            }
                        ));
                    } else {
                        // 回收 · 穿刺（普通 high / 特殊 special 各自独立）
                        const isSpec = damageType === 'special';
                        if (isSpec) triggerHaptic('recall_hit_special');
                        else triggerHaptic('recall_hit');
                        Globals.audioManager?.playHit(isSpec ? 'special' : 'high');
                        this.hitStopTimer = isSpec ? 0.18 : 0.06;
                        enemy.applyStun(CONFIG.hitStunDuration ?? 0.15);
                        if (isSpec) triggerShake(CONFIG.shakeIntensityFinal, CONFIG.shakeDurationFinal);
                        else triggerShake(CONFIG.shakeIntensityRecall, CONFIG.shakeDurationRecall);
                        // 回收命中 · 爆体粒子特效（两层：低位密集 + 高位稀疏）
                        // 颜色采样：取敌人 bodyMat 基色（未染色时 = 怪物本色），由 EnemyHitBurstEffect 内部做扰动
                        // ★ 合并机制：与 showRecallDamageText 同款 —— 同帧 frameId / 时间窗口 recallHitBurstMergeWindow
                        //   内的多次命中只生成一个 effect，后续命中调用 effect.addBurst() 叠加新粒子，
                        //   且新粒子参数按 mergeCount 在 *@1* / *@max* 双端点之间插值。
                        //   合并状态挂在 enemy._recallBurstMerge 上，与目标共生共死。
                        // ★ 击杀豁免：若本次回收命中触发的 takeDamage 直接造成击杀（enemy.isDead 已置位），
                        //   跳过命中爆体生成 —— 死亡爆体由 Enemy.die() 自己生成 @max 端点的爆体，
                        //   两者重叠会让死亡瞬间视觉过于杂乱。
                        if (!enemy.isDead) {
                            const enemyBaseColor = enemy.materials?.[0]?.userData?.baseColor;
                            const m = enemy._recallBurstMerge;
                            let canMergeBurst = false;
                            if (m && m.effect && m.effect.alive) {
                                if (m.frameId === Globals.frameId) {
                                    canMergeBurst = true;
                                } else {
                                    const winSec = Math.max(0, CONFIG.recallHitBurstMergeWindow ?? 0);
                                    if (winSec > 0 && (performance.now() - m.createdAt) <= winSec * 1000) {
                                        canMergeBurst = true;
                                    }
                                }
                            }
                            if (canMergeBurst) {
                                // 叠加：mergeCount++，effect 内部按新 count 插值生成新一批粒子
                                m.count += 1;
                                m.effect.addBurst(m.count);
                            } else {
                                // 首次命中（或上一轮已过期）：新建 effect 并登记合并状态
                                const effect = new EnemyHitBurstEffect(
                                    enemy.mesh.position.clone(),
                                    enemyBaseColor,
                                    { scale: isSpec ? 1.35 : 1.0 }
                                );
                                Globals.enemyHitBurstEffects.push(effect);
                                enemy._recallBurstMerge = {
                                    effect,
                                    count: 1,
                                    frameId: Globals.frameId,
                                    createdAt: performance.now(),
                                };
                            }
                        }
                    }
                }
            }
        }
    }
    
    startRecall(index) {
        this.recallPending = false;
        this.phase = 'recalling'; 
        this.index = index; 
        this.hitEnemies.clear(); 
        this.deploymentRing.visible = false;
        this.restoreRecallVisuals();
        if (this.isSpecial) { 
            this.mesh.scale.set(2.2, 2.2, 2.2); 
             
            this.speed = CONFIG.finalRecallSpeed; 
        } else {
            this.mesh.scale.set(1, 1, 1);
            this.speed = CONFIG.baseRecallSpeed + index * 5;
        }

        this.recallIntroActive = true;
        this.mesh.visible = false;
        this.recallCourierEffect?.destroy();
        this.recallCourierEffect = new RecallCourierEffect(this);
        Globals.recallEffects.push(this.recallCourierEffect);
    }

    releaseFromCourier(worldPosition) {
        if (this.phase !== 'recalling') return;
        this.recallIntroActive = false;
        this.recallCourierEffect = null;
        this.restoreRecallVisuals();
        this.mesh.visible = true;
        this.mesh.position.copy(worldPosition);

        const pt = Globals.player.mesh.position.clone();
        pt.y = 1;
        const dir = new THREE.Vector3().subVectors(pt, this.mesh.position);
        if (dir.lengthSq() < 0.0001) dir.set(0, 0, 1);
        dir.normalize();
        this.mesh.lookAt(this.mesh.position.clone().add(dir));
        // this.updateTetherLine();
    }
    
    destroy() { 
        if (this.javelinVfx) {
            // 武器被销毁/回收：分离特效让其播完动画再自销毁，
            // 而不是直接 destroy。VFX 自身会被注册在 Globals.javelinVfxEffects
            // 中，由 main.js 主循环统一驱动。
            this.javelinVfx.detach();
            this.javelinVfx = null;
        }
        this.recallPending = false;
        this.recallIntroActive = false;
        if (this.recallCourierEffect) {
            this.recallCourierEffect.destroy();
            this.recallCourierEffect = null;
        }
        // 释放整把矛模型 (shaftGeo + 2×prong joints/segments + 所有材质)。
        // 这是历史上最大的内存泄漏点：每丢一发就漏 ~50 个 geometry。
        disposeObject3D(this.mesh);
        Globals.scene.remove(this.mesh);
        disposeObject3D(this.deploymentRing);
        Globals.scene.remove(this.deploymentRing);
        // Decrement the in-flight reference count on the player. Since the
        // field limit can exceed 4, multiple feathers may share the same
        // slot index (one per 4-weapon cycle), so the slot is a count not a
        // boolean. Done at destroy() time (i.e. when the weapon fully
        // returns to hand). The foot-ring indicator no longer depends on
        // this value for its display (it follows the cycle counter
        // instead), but the count is still maintained so other systems
        // can query "how many of my weapons are currently out".
        const player = Globals.player;
        if (player && player.ammoSlotsInFlight && typeof this.slotIndex === 'number') {
            const n = (player.ammoSlotsInFlight[this.slotIndex] || 0) - 1;
            player.ammoSlotsInFlight[this.slotIndex] = Math.max(0, n);
        }
        const idx = Globals.feathers.indexOf(this); 
        if (idx > -1) Globals.feathers.splice(idx, 1); 
    }
}
