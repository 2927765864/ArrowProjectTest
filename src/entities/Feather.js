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
        // 回收小猫"完整生命周期"标志：从 startRecall 开始，到 RecallCourierEffect.destroy()
        // （fade 也走完）才置 false。用于让落点指示器(deploymentRing)在小猫主动画 + fade
        // 全部演完之前继续显示，并跟随小猫一起渐隐，而不是回收一启动就立刻消失。
        this.recallCourierActive = false;

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
            // 关闭深度测试 + 高 renderOrder，让指示器始终绘制在地上"小猫黑影"
            // （回收特效里的 mound / hole / dirtClumps，颜色 0x0e0b1c）之上，
            // 不会再被它们遮挡。与 Player.moveIndicator 的层级处理保持一致。
            depthTest: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        
        const ringMesh = new THREE.Mesh(ringGeo, this.deploymentRingMaterial);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.renderOrder = 999;
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
            // 同 ring：关闭深度测试，绘制顺序拔高，避免被小猫地面阴影/土堆遮挡
            depthTest: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        this.arrowMesh = new THREE.Mesh(arrowGeo, this.deploymentArrowMaterial);
        this.arrowMesh.rotation.x = -Math.PI / 2;
        this.arrowMesh.position.z = radius; // Place on the edge of the ring
        this.arrowMesh.scale.set(CONFIG.deployArrowScale, CONFIG.deployArrowScale * CONFIG.deployArrowLength, 1);
        this.arrowMesh.renderOrder = 1000; // 略高于 ring，保证箭头压在 ring 上而不是被 ring 自身遮
        
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

        // === 解析"穿透后落点距离"：支持基于玩家-敌人距离的动态映射 ===
        // 在投出瞬间一次性计算并缓存到实例上，保证整段飞行使用同一落点距离，
        // 避免参数面板中途调节或玩家移动影响已经发出的武器。
        this._resolvedPierceDistBeforeDrop = this._resolvePierceDistBeforeDrop(this.distanceToTarget);

        this.javelinVfx = new JavelinVFX();
        this.javelinVfx.start(this.mesh.position, this.direction);
        // 飞行期间同时显示实体武器模型（三叉戟）+ JavelinVFX 特效
        this.modelGroup.visible = true;

        // 武器尖端在 modelGroup 内部的 Y 坐标（见几何定义：ptsR 末点 (0.015, 6.0, 0)）
        // 经过 modelGroup 的 scale 与 rotation.set(PI/2,0,0) 变换后，映射到 this.mesh 局部的 +Z 方向
        // 再叠加 modelGroup.position.z = 0.35 得到尖端在 this.mesh 局部坐标系的 Z 距离
        this._weaponTipLocalZ = 6.0 * this.baseModelScale + 0.35;
    }

    /**
     * 根据玩家与目标敌人的距离，解析本次穿透后的落点距离（世界单位）。
     * - 未启用动态时，返回 CONFIG.pierceDistBeforeDrop（向后兼容）。
     * - 启用动态时：玩家越近敌人 → 落点越远；越远 → 落点越近。
     *
     *   d = distToEnemy（玩家到目标敌人的水平距离）
     *   d ≤ pierceTriggerNearDist  →  pierceDistMax （最远落点，玩家近时落得远）
     *   d ≥ pierceTriggerFarDist   →  pierceDistMin （最近落点，玩家远时落得近）
     *   两者之间在 [pierceDistMax → pierceDistMin] 之间线性插值
     */
    _resolvePierceDistBeforeDrop(distToEnemy) {
        if (!CONFIG.pierceDistDynamicEnabled) {
            return Math.max(0.1, CONFIG.pierceDistBeforeDrop ?? 1.5);
        }

        const nearTrig = CONFIG.pierceTriggerNearDist ?? 2.0;
        const farTrig = CONFIG.pierceTriggerFarDist ?? 12.0;
        const dropMax = CONFIG.pierceDistMax ?? 4.0; // 玩家近时使用
        const dropMin = CONFIG.pierceDistMin ?? 1.0; // 玩家远时使用

        // 退化保护：若两个阈值反了或相等，按"<= 中点取最大、否则取最小"处理
        const span = farTrig - nearTrig;
        let drop;
        if (span <= 1e-4) {
            drop = distToEnemy <= nearTrig ? dropMax : dropMin;
        } else if (distToEnemy <= nearTrig) {
            drop = dropMax;
        } else if (distToEnemy >= farTrig) {
            drop = dropMin;
        } else {
            // 线性插值：t=0 时取 dropMax（近端），t=1 时取 dropMin（远端）
            const t = (distToEnemy - nearTrig) / span;
            drop = THREE.MathUtils.lerp(dropMax, dropMin, t);
        }
        return Math.max(0.1, drop);
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
        // 飞行 (shooting) 阶段叠加 vfxFlightModelScale 倍率，仅影响实体武器模型外观；
        // 其它阶段（deployed/recalling）保持 baseModelScale，不影响落地三叉戟与召回缩小动画。
        if (this.phase === 'shooting') {
            const flightScale = Math.max(0.001, CONFIG.vfxFlightModelScale ?? 1.0);
            this.modelGroup.scale.setScalar(this.baseModelScale * flightScale);
        }
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
                // 使用投出瞬间已解析好的落点距离（支持动态映射），保证飞行中不受参数变化干扰
                const maxPostDist = Math.max(0.1, this._resolvedPierceDistBeforeDrop ?? CONFIG.pierceDistBeforeDrop);
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
                    // 落地：撤销飞行期间的 vfxFlightModelScale 倍率，恢复为基础尺寸
                    this.modelGroup.scale.setScalar(this.baseModelScale);
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
                // recallIntroActive 期间小猫正在演 emerge→windup→throw→hold。
                // 落点指示器保持显示，并实时更新箭头指向玩家位置。
                // 真正的隐藏交给 RecallCourierEffect.destroy() 在 fade 走完后执行。
                this._syncDeploymentRingWithCourier();
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
            // recallIntroActive 已结束，但 RecallCourierEffect 可能还在 fade。
            // 此时 feather 实体已开始飞回玩家，落点指示器仍要继续陪着小猫的 fade
            // 一起渐隐，直到 RecallCourierEffect.destroy() 把它彻底隐藏。
            this._syncDeploymentRingWithCourier();
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

    /**
     * 回收期间同步落点指示器与小猫的演出节奏：
     * - 小猫主动画阶段（emerge→windup→throw→hold）：完整不透明度显示，箭头实时指向玩家
     * - 小猫 fade 阶段：ring/箭头不透明度按相同进度从基础值线性降到 0
     * - 小猫已 destroy / 不再活跃：直接隐藏
     *
     * 由 update() 在 recalling 分支调用，不直接复用 updateDeploymentRing()，
     * 因为后者每帧会把 opacity 重置回 CONFIG 配置值，覆盖我们想做的渐隐插值。
     */
    _syncDeploymentRingWithCourier() {
        const courier = this.recallCourierEffect;
        // 兜底：标志没置或者小猫已 destroy → 直接隐藏。
        if (!this.recallCourierActive || !courier || courier.destroyed) {
            this.deploymentRing.visible = false;
            return;
        }

        // 跟着武器实际位置走（fade 期间武器可能已经在飞回玩家）。
        this.deploymentRing.position.set(this.mesh.position.x, 0.08, this.mesh.position.z);

        // 按 CONFIG 同步几何/外观（与 updateDeploymentRing 等价的部分）。
        const currentRadius = this.isSpecial ? CONFIG.deployRingRadiusSpecial : CONFIG.deployRingRadiusNormal;
        const baseRingOpacity = this.isSpecial ? CONFIG.deployRingOpacitySpecial : CONFIG.deployRingOpacityNormal;
        const baseArrowOpacity = CONFIG.deployArrowOpacity;
        this.arrowMesh.scale.set(CONFIG.deployArrowScale, CONFIG.deployArrowScale * CONFIG.deployArrowLength, 1);
        if (this.baseRingRadius !== currentRadius) {
            const ringGeo = new THREE.RingGeometry(currentRadius - 0.04, currentRadius + 0.04, 64);
            this.deploymentRing.children[0].geometry.dispose();
            this.deploymentRing.children[0].geometry = ringGeo;
            this.baseRingRadius = currentRadius;
            this.arrowMesh.position.z = currentRadius;
        }

        // 计算渐隐系数：小猫还没进入 fade → 1；fade 中 → (1 - fadeElapsed/fadeDur)。
        let fadeFactor = 1;
        if (courier.fading) {
            const fadeDur = Math.max(0.001, CONFIG.recallCourierFadeDur);
            const t = Math.min(1, Math.max(0, (courier.fadeElapsed || 0) / fadeDur));
            fadeFactor = 1 - t;
        }

        this.deploymentRingMaterial.opacity = baseRingOpacity * fadeFactor;
        this.deploymentArrowMaterial.opacity = baseArrowOpacity * fadeFactor;

        // 箭头继续实时指向玩家（用户要求保留这个语义）。
        if (Globals.player && Globals.player.mesh) {
            this.arrowContainer.lookAt(Globals.player.mesh.position.x, 0.08, Globals.player.mesh.position.z);
        }

        this.deploymentRing.visible = true;
    }

    // Removed ensureTetherSegments and ensureDeploymentRingSegments

    
    checkCollision(damageType, damageAmount) {
        const isRecallType = (damageType === 'high' || damageType === 'special');
        for (let i = Globals.enemies.length - 1; i >= 0; i--) {
            const enemy = Globals.enemies[i]; 
            if (enemy.isDead) continue;
            // 濒死缓冲期：仅"回收命中"可继续穿过吸收命中（用于贯穿数字 / 爆体合并）；
            // 主动攻击 (low) 把濒死敌人视作已死，避免在死亡视觉上再扣血/再播受击反馈。
            if (enemy.isPendingDeath && !isRecallType) continue;
            
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
                    // ---- 暴击 roll：仅作用于"主动攻击"（damageType='low'），不影响回收 ----
                    // 在 takeDamage 之前决定 isCrit 与最终伤害值，让伤害数字、伤害结算
                    // 都用同一份数据，避免显示与逻辑割裂。
                    // 斩杀保底：若敌人当前 HP 已不超过暴击伤害，则必定暴击直接斩杀
                    // （Infinity HP 的木桩/dummy 永远不会满足条件，无需额外判断）。
                    let finalDamage = damageAmount;
                    let isCrit = false;
                    if (damageType === 'low' && CONFIG.critEnabled !== false) {
                        const critDmg = CONFIG.critDamage ?? 480;
                        const lethalCrit = enemy.hp > 0 && enemy.hp <= critDmg;
                        if (lethalCrit || Math.random() < (CONFIG.critChance ?? 0)) {
                            isCrit = true;
                            finalDamage = critDmg;
                        }
                    }
                    enemy.takeDamage(finalDamage, damageType, currentDir, hitPointWorld, isCrit);

                    if (damageType === 'low') {
                        // 主动攻击 · 飞行穿刺（前三根普通 / 第4根特殊各自独立）
                        triggerHaptic('hit');
                        Globals.audioManager?.playHit('low');
                        // ===== 击退 =====
                        // 史莱姆敌人才会真的"位移"，走新的 4 参数模型（距离/初速度/末速度/曲线）：
                        //   · 普通命中 → applyKnockback(dir)，敌人内部读 CONFIG.hitSKnockback*
                        //   · 暴击命中 → applyKnockback(dir, { 用 critKnockback* 覆盖 })
                        // 柱状/木桩不真的位移，applyKnockback 走"力/冲量"语义，仍传旧的 force 数值：
                        //   · 柱状 → 内部只换算 bend 形变强度
                        //   · 木桩 → 内部按 stakeKnockbackBendScale 换算成弯曲冲量
                        if (enemy.isPillar || enemy.isDummy) {
                            const knockForce = isCrit
                                ? (CONFIG.critKnockbackForce ?? 30)
                                : (CONFIG.hitKnockbackForce ?? 10);
                            enemy.applyKnockback(currentDir, knockForce);
                        } else {
                            // 史莱姆：暴击时用 critKnockback* 一组参数覆盖，否则用默认 hitSKnockback*
                            if (isCrit) {
                                enemy.applyKnockback(currentDir, {
                                    distance:   CONFIG.critKnockbackDistance,
                                    startSpeed: CONFIG.critKnockbackStartSpeed,
                                    endSpeed:   CONFIG.critKnockbackEndSpeed,
                                    curve:      CONFIG.critKnockbackCurve,
                                });
                            } else {
                                enemy.applyKnockback(currentDir);
                            }
                        }
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

                        // ---- 暴击附加：复用"回收命中爆体特效"（EnemyHitBurstEffect）----
                        // 只有敌人未被击杀时才生成（与回收路径同样的"击杀豁免"原则：
                        // 死亡爆体由 Enemy.die() 自己生成，避免视觉过载）。
                        // 完全独立于 enemy._recallBurstMerge 状态——暴击是单次独立爆点，
                        // 不参与回收命中的同帧合并。
                        if (isCrit && !enemy.isDead) {
                            const enemyBaseColor = enemy.materials?.[0]?.userData?.baseColor;
                            const burst = new EnemyHitBurstEffect(
                                enemy.mesh.position.clone(),
                                enemyBaseColor,
                                { scale: CONFIG.critBurstScale ?? 1.0 }
                            );
                            const mc = Math.max(1, Math.floor(CONFIG.critBurstMergeCount ?? 1));
                            if (mc > 1) burst.addBurst(mc);
                            Globals.enemyHitBurstEffects.push(burst);
                        }
                    } else {
                        // 回收 · 穿刺（普通 high / 特殊 special 各自独立）
                        const isSpec = damageType === 'special';
                        if (isSpec) triggerHaptic('recall_hit_special');
                        else triggerHaptic('recall_hit');
                        Globals.audioManager?.playHit(isSpec ? 'special' : 'high');
                        this.hitStopTimer = isSpec ? 0.18 : 0.06;
                        // 眩晕时长：按敌人类型选用 hit*/hitS* 对应字段
                        //   柱状/木桩 → hitStunDuration；史莱姆 → hitSStunDuration
                        const stunDur = enemy.isPillar || enemy.isDummy
                            ? (CONFIG.hitStunDuration ?? 0.15)
                            : (CONFIG.hitSStunDuration ?? 0.15);
                        enemy.applyStun(stunDur);
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
        // 注意：这里不再立刻隐藏 deploymentRing。
        // 落点指示器需要陪着回收小猫演出整个生命周期（emerge→windup→throw→hold→fade）
        // 完整结束后再消失，并在 fade 阶段跟随小猫同步降低 opacity。
        // 由 update() 里的 recalling 分支负责保持/同步显示，
        // 由 RecallCourierEffect.destroy() 负责最终隐藏。
        this.recallCourierActive = true;
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
        // 注意：这里不再立刻把 recallCourierEffect 置 null。
        // 落点指示器需要继续读取 courier.fading / fadeElapsed 来跟随小猫一起渐隐，
        // 所以必须保留引用，直到 RecallCourierEffect.destroy() 自己把它清掉
        // （destroy 内部已有 `if (this.feather?.recallCourierEffect === this) ... = null`）。
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
        this.recallCourierActive = false;
        if (this.recallCourierEffect) {
            this.recallCourierEffect.destroy();
            this.recallCourierEffect = null;
        }
        // 兜底：把落点指示器隐掉并重置 opacity（避免下次复用材质时残留淡出值）。
        if (this.deploymentRing) this.deploymentRing.visible = false;
        if (this.deploymentRingMaterial) {
            this.deploymentRingMaterial.opacity = this.isSpecial
                ? CONFIG.deployRingOpacitySpecial
                : CONFIG.deployRingOpacityNormal;
        }
        if (this.deploymentArrowMaterial) {
            this.deploymentArrowMaterial.opacity = CONFIG.deployArrowOpacity;
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
