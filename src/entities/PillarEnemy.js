import * as THREE from 'three';
import { Globals, showRecallDamageText, triggerShake, triggerHaptic, disposeObject3D } from '../utils.js';
import { CONFIG } from '../config.js';
import { BloodStain } from '../effects/BloodStain.js';
import { SlashFlashEffect } from '../effects/SlashFlashEffect.js';
import { PillarBullet } from './PillarBullet.js';
import { HitReaction } from '../effects/HitReaction.js';
import { EnemyHitBurstEffect } from '../effects/EnemyHitBurstEffect.js';

/**
 * PillarEnemy - 柱状敌人
 *
 * 特点：
 *   - 生成后保持在原地不动（静止）
 *   - 周期性向玩家方向吐出缓慢移动的球形子弹
 *   - 子弹初始方向锁定朝玩家，出射后直线飞行一段时间自动消失
 *   - 不对玩家造成伤害（仅测试用）
 *
 * 视觉结构：
 *   mesh(Group)
 *     ├── base       底座（宽扁圆柱）
 *     ├── pillar     主柱体
 *     ├── topCap     顶部切面
 *     ├── eye        顶部发光眼（子弹从此处出射）
 *     └── bands      装饰环
 */
export class PillarEnemy {
    constructor(spawnPosition = null) {
        this.isDummy = false;
        this.isPillar = true;
        this.isDead = false;
        // 濒死缓冲期（lethal grace window）—— 详见 Enemy.js 同名字段注释。
        // 只有"回收命中(high/special)"在斩杀时进入此状态，期间继续吸收命中用于贯穿合并。
        this.isPendingDeath = false;
        this._pendingDeathTimer = 0;
        this._pendingDeathDir = null;
        this.hp = (typeof CONFIG.pillarEnemyHP === 'number') ? CONFIG.pillarEnemyHP : 160;
        this.stunTimer = 0;
        // 柱体不会被击退也不会位移，knockbackVelocity 保留为 0 占位
        this.knockbackVelocity = new THREE.Vector3(0, 0, 0);

        // ---------- 根节点 ----------
        // mesh.position.y 抬到柱子中段高度（与其他敌人中心参考一致），
        // 视觉上用子物体偏移回到地面。这样 Feather.checkCollision 用 3D 距离命中更稳
        this.mesh = new THREE.Group();
        const ROOT_Y = 0.6;
        if (spawnPosition) {
            this.mesh.position.set(spawnPosition.x, ROOT_Y, spawnPosition.z);
        } else {
            this.mesh.position.y = ROOT_Y;
        }
        const GROUND_Y = -ROOT_Y;

        // ---------- 配色：冷色金属 / 紫黑 ----------
        const BASE_COLOR = 0x3a3560;   // 底座深紫灰
        const BODY_COLOR = 0x5e55a2;   // 主柱紫色（与障碍物一致）
        const BAND_COLOR = 0x2a2548;   // 环带暗色
        const TOP_COLOR  = 0x7a71c0;   // 顶盖亮一点
        const EYE_COLOR  = 0xff5f3c;   // 眼 / 发射口：暖橙红，明显与其他敌人区分

        // 材质 per-mesh：与 Enemy 类相同的设计——每个跟随形变的子 mesh 必须有独立材质，
        // 因为 HitReaction 给每个材质注入独立的 uChildPivot uniform（共享会让多个 mesh 互相覆盖位置）。
        const baseMat     = new THREE.MeshBasicMaterial({ color: BASE_COLOR });
        const bodyMat     = new THREE.MeshBasicMaterial({ color: BODY_COLOR });
        const band1Mat    = new THREE.MeshBasicMaterial({ color: BAND_COLOR });
        const band2Mat    = new THREE.MeshBasicMaterial({ color: BAND_COLOR });
        const topMat      = new THREE.MeshBasicMaterial({ color: TOP_COLOR });
        const eyeMat      = new THREE.MeshBasicMaterial({ color: EYE_COLOR });
        this.materials = [baseMat, bodyMat, band1Mat, band2Mat, topMat, eyeMat];
        this.materials.forEach(m => { m.userData.baseColor = m.color.getHex(); });

        // 受击反馈（闪白 + 弹性形变）：先 new 实例，attach 留到知道 childPivot 后逐个调用
        // 柱状敌人使用 hit* 这组 CONFIG 字段（"敌人受击反馈（柱状敌人）" 面板分类）
        this.hitReaction = new HitReaction({ configKey: 'hit' });

        // ---------- 底座 ----------
        // 底座视为"地基"：不参与形变（柱身被推弯时，地面这一节应该稳定不动）。
        // 但仍然 attach 闪白通道（让它能被打白），用 flashOnly 等价的方式：直接 attach 默认 pivot=0，
        // 但这样它会跟随形变。所以更好的做法：根本不 attach 它。代价是：受击瞬间 base 不会闪白。
        // 视觉上 base 隐藏在 pillar 阴影下，不闪白几乎察觉不到。
        const baseGeo = new THREE.CylinderGeometry(0.55, 0.65, 0.18, 20);
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = GROUND_Y + 0.09;
        this.mesh.add(base);

        // ---------- 主柱（矮短版）----------
        // 设计目标：柱体顶端的"眼"作为出球点，在 enemyScale = 2.0 下世界高度约 1.0，
        // 大致贴近玩家角色腰/胸中部。公式：世界Y = ROOT_Y + localY * enemyScale。
        const PILLAR_HEIGHT = 0.4;
        const pillarGeo = new THREE.CylinderGeometry(0.35, 0.40, PILLAR_HEIGHT, 20);
        const pillar = new THREE.Mesh(pillarGeo, bodyMat);
        pillar.position.y = GROUND_Y + 0.18 + PILLAR_HEIGHT / 2;
        this.mesh.add(pillar);
        this.pillarHeight = PILLAR_HEIGHT;
        this.pillar = pillar;
        // 主柱 = deformTarget，自身顶点已经在 deformTarget 局部空间，pivot = (0,0,0)
        this.hitReaction.attach(bodyMat);

        // ---------- 装饰环（两条），改挂到 pillar 下，让它们跟随 pillar 一起形变 ----------
        // 关键改动：以前挂在 this.mesh 上，受击形变时 pillar 在动而 band 不动 → 视觉错位。
        // 现在挂在 pillar 下，band.position 直接就是"在 pillar 局部空间下的位置" = childPivot。
        const bandGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20);
        const bandLocalYs = [
            (GROUND_Y + 0.18 + 0.12) - pillar.position.y,  // ≈ -0.08
            (GROUND_Y + 0.18 + 0.30) - pillar.position.y,  // ≈ +0.10
        ];
        const bandMats = [band1Mat, band2Mat];
        bandLocalYs.forEach((yLocal, i) => {
            const band = new THREE.Mesh(bandGeo, bandMats[i]);
            band.position.y = yLocal;
            pillar.add(band);
            this.hitReaction.attach(bandMats[i], band.position);
        });

        // ---------- 顶部切面 ----------
        const topCapGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.08, 20);
        const topCap = new THREE.Mesh(topCapGeo, topMat);
        topCap.position.y = (GROUND_Y + 0.18 + PILLAR_HEIGHT + 0.04) - pillar.position.y;
        pillar.add(topCap);
        this.hitReaction.attach(topMat, topCap.position);

        // ---------- 顶部"眼"（发射口），使用 bloomLayer 使其轻微发光 ----------
        // 眼的中心 = 出球点；世界Y ≈ ROOT_Y + (GROUND_Y + 0.18 + PILLAR_HEIGHT + 0.2) * enemyScale
        //        = 0.6 + (-0.6 + 0.18 + 0.4 + 0.2) * 2.0 = 0.6 + 0.18 * 2 ≈ 0.96
        const eyeGeo = new THREE.SphereGeometry(0.2, 20, 16);
        this.eye = new THREE.Mesh(eyeGeo, eyeMat);
        this.eye.position.y = (GROUND_Y + 0.18 + PILLAR_HEIGHT + 0.2) - pillar.position.y;
        // 启用 bloom layer（场景中约定 layer 1 = 辉光层）
        this.eye.layers.enable(1);
        pillar.add(this.eye);
        this.hitReaction.attach(eyeMat, this.eye.position);

        // 发射口世界坐标缓存（每次使用前重新计算）
        this._muzzleWorld = new THREE.Vector3();

        // ---------- 射击节奏 ----------
        // 初始延迟让玩家有反应时间，随后按 CONFIG.pillarEnemyFireInterval 节奏持续射击
        const initDelay = (typeof CONFIG.pillarEnemyFireInitDelay === 'number')
            ? CONFIG.pillarEnemyFireInitDelay : 1.2;
        // 给每个柱子一个小的相位随机，避免同时齐射
        this.fireCooldown = initDelay + Math.random() * 0.4;

        // 攻击"蓄力闪烁"阶段的剩余时间（视觉提示）
        this.windupTimer = 0;

        // ---------- 缩放 ----------
        // 柱状视觉大小 = enemyScale × pillarScaleMul（pillarScaleMul 仅这一类生效）
        this.mesh.scale.setScalar(CONFIG.enemyScale * (CONFIG.pillarScaleMul ?? 1));

        // 绑定 hitReaction 的参考坐标系：柱体主体 pillar 作为形变目标
        this.hitReaction.setTargets(this.mesh, this.pillar);

        Globals.scene.add(this.mesh);
        Globals.enemies.push(this);
    }

    update(delta, time) {
        if (this.isDead) return;
        // 濒死缓冲：倒计时归零后才 die()；期间停止开火/旋转 AI，仅维护 hitReaction
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

        // 柱体静止不动，但顶部眼微微呼吸 + 永远朝玩家
        const player = Globals.player;
        if (player) {
            // 让整个 mesh 绕 Y 轴缓慢朝向玩家（仅柱体 yaw，视觉上好看）
            const dx = player.mesh.position.x - this.mesh.position.x;
            const dz = player.mesh.position.z - this.mesh.position.z;
            const targetYaw = Math.atan2(dx, dz);
            // 平滑旋转
            const curYaw = this.mesh.rotation.y;
            let diff = targetYaw - curYaw;
            // 规范化到 [-PI, PI]
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            this.mesh.rotation.y = curYaw + diff * Math.min(1, delta * 4);
        }

        // 顶部眼呼吸缩放
        const breathe = 1 + Math.sin(time * 3.5) * 0.08;
        this.eye.scale.setScalar(breathe);

        // 眩晕期间不进入开火逻辑
        if (this.stunTimer > 0) return;

        // ---------- 射击逻辑 ----------
        this.fireCooldown -= delta;

        // 当距离下次开火还有短暂时间（<= windup 时长）时，进入"蓄力"阶段：眼睛变亮 + 放大
        const windupDur = (typeof CONFIG.pillarEnemyFireWindup === 'number')
            ? CONFIG.pillarEnemyFireWindup : 0.35;

        if (this.fireCooldown <= windupDur && this.fireCooldown > 0) {
            // 蓄力期间眼睛额外脉动（在 breathe 之上叠加）
            const k = 1 - this.fireCooldown / Math.max(0.0001, windupDur); // 0→1
            const pulse = 1 + Math.sin(time * 22) * 0.2 * k;
            this.eye.scale.setScalar(breathe * (1 + 0.4 * k) * pulse);
        }

        if (this.fireCooldown <= 0) {
            this._fireBullet();
            const interval = (typeof CONFIG.pillarEnemyFireInterval === 'number')
                ? CONFIG.pillarEnemyFireInterval : 1.8;
            // 加一点小抖动，避免完全机械
            this.fireCooldown = Math.max(0.15, interval + (Math.random() - 0.5) * 0.1);
        }

        // 受击闪白 + 形变弹性系统更新
        if (this.hitReaction) this.hitReaction.update(delta);
    }

    _fireBullet() {
        const player = Globals.player;
        if (!player) return;

        // 发射口 = 顶部眼的世界坐标
        this.eye.getWorldPosition(this._muzzleWorld);

        // 瞄准玩家中心（略抬高以避开地面）
        const target = player.mesh.position.clone();
        target.y = Math.max(target.y, this._muzzleWorld.y); // 尽量水平
        const dir = new THREE.Vector3().subVectors(target, this._muzzleWorld);
        dir.y = 0; // 只在水平面飞行，简单且好控制
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
        dir.normalize();

        const speed = (typeof CONFIG.pillarBulletSpeed === 'number') ? CONFIG.pillarBulletSpeed : 4.0;
        const life  = (typeof CONFIG.pillarBulletLifetime === 'number') ? CONFIG.pillarBulletLifetime : 3.0;
        const radius = (typeof CONFIG.pillarBulletRadius === 'number') ? CONFIG.pillarBulletRadius : 0.25;

        // 从眼的前缘出射（沿 dir 再偏移一点，避免子弹出现在柱体内）
        const muzzle = this._muzzleWorld.clone().addScaledVector(dir, 0.35);

        new PillarBullet(muzzle, dir, speed, life, radius);
        // 未来可以加一个专用发射音效；当前测试阶段不加，避免复用死亡音效产生听觉误导
    }

    applyKnockback(direction, force) {
        // 柱体固定在地面，不会真的位移，但仍然让它"被推弯"——
        // 这样与位移敌人的视觉反馈一致，玩家能感到"打中了、推了一下"的冲击感。
        if (this.hitReaction && direction && force > 0) {
            this.hitReaction.triggerBend(direction, force);
        }
    }

    applyStun(duration) {
        this.stunTimer = Math.max(this.stunTimer, duration);
    }

    takeDamage(amount, type, direction, hitPointWorld, isCrit = false) {
        // 濒死缓冲期：不再扣血/不再触发受击形变，但仍走 showRecallDamageText 累加贯穿数。
        if (this.isPendingDeath) {
            const textPos = this.mesh.position.clone();
            textPos.y += this.pillarHeight * 0.6;
            showRecallDamageText(this, textPos, amount, type, direction, isCrit);
            return;
        }

        this.hp -= amount;

        // 受击反馈（闪白 + 弹性形变）
        if (this.hitReaction) {
            this.hitReaction.trigger(hitPointWorld || null, direction || null);
        }

        const textPos = this.mesh.position.clone();
        textPos.y += this.pillarHeight * 0.6;
        showRecallDamageText(this, textPos, amount, type, direction, isCrit);

        if (this.hp <= 0 && !this.isDead) {
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
        // 离开濒死缓冲态
        this.isPendingDeath = false;
        this._pendingDeathTimer = 0;
        this._pendingDeathDir = null;
        if (this.hitReaction) this.hitReaction.reset();
        triggerHaptic('die');
        triggerShake(CONFIG.shakeIntensityDeath, CONFIG.shakeDuration);

        const pos = this.mesh.position.clone();
        const dir = direction || new THREE.Vector3(0, 0, 1);

        Globals.audioManager?.playEnemyDeath();

        Globals.slashEffects.push(new SlashFlashEffect(pos, dir, CONFIG.enemyScale));

        // ===== 死亡爆体特效：复用回收命中爆体 EnemyHitBurstEffect 的 @max 端点效果 =====
        // 详见 Enemy.die() 中的等价注释。
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

        Globals.bloodStains.push(new BloodStain(pos));

        // 释放 5+ Cylinder/Sphere 几何与材质
        disposeObject3D(this.mesh);
        Globals.scene.remove(this.mesh);
    }
}
