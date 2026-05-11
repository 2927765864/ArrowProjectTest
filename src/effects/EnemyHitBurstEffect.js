import * as THREE from 'three';
import { Globals } from '../utils.js';
import { CONFIG } from '../config.js';

/**
 * EnemyHitBurstEffect — 回收命中·敌人爆体粒子特效
 *
 * 用途：
 *   玩家"回收武器命中敌人"（damageType='high'/'special'）瞬间，从敌人身体中心爆发的爆体粒子。
 *   仅在回收命中触发，不与主动攻击的 HitSparkEffect 冲突。
 *
 * 视觉构成（两层）：
 *   1. 低位密集组（Low*） —— 大量小粒子向四周喷洒，受重力下坠，高度低，模拟"碎屑/血肉/能量块"飞溅
 *   2. 高位稀疏组（High*）—— 少量粒子向上方斜上方冲射，飞过敌人头顶再落下，强化爆炸冲击感
 *
 * 颜色：
 *   从敌人 bodyMat.userData.baseColor 采样（fallback 到 CONFIG.recallHitBurstFixedColor），
 *   每颗粒子在 HSL 空间做色相/明度随机扰动（幅度由 *ColorJitter 控制），让爆体颜色"统一基调但不死板"。
 *
 * 渲染：
 *   MeshBasicMaterial + 普通 alpha 透明（不开 AdditiveBlending），
 *   IcosahedronGeometry(1, 1) 为基础几何，scale 控制实际大小。
 *
 * ★ 合并机制（与回收伤害数字 showRecallDamageText 同款）：
 *   多把武器同帧 / 在 recallHitBurstMergeWindow 时间窗口内命中同一敌人时，
 *   不会创建多个特效，而是把后续命中"叠加"到同一个 effect 实例上：
 *     - mergeCount 自增
 *     - 调用 addBurst() 在原起爆点追加一批新粒子
 *     - 新粒子的所有参数按 mergeCount 在 *@1* 与 *@max* 双端点之间插值
 *   结果：1 把 = 小型迸发；逐渐合并 → 体积/数量/速度/寿命同步加大；≥CountForMax 把 = 巨型爆点。
 *
 * 生命周期：
 *   每颗粒子独立 life；effect.update(delta) 返回 false 时所有粒子都已消亡，可由 main 移除。
 *   注意：合并时只追加新粒子，不会延长已有粒子寿命。effect 整体存活到"最后一颗粒子"消亡。
 *
 * 用法：
 *   // 首次命中
 *   const eff = new EnemyHitBurstEffect(enemyCenterPos, baseColorHex);
 *   Globals.enemyHitBurstEffects.push(eff);
 *   // 同帧 / 时间窗口内的额外命中
 *   eff.addBurst(newMergeCount);
 */

// ---- 共享几何（所有实例复用，避免每次命中都重建 buffer） ----
let _sharedGeo = null;
function getSharedGeo() {
    if (!_sharedGeo) _sharedGeo = new THREE.IcosahedronGeometry(1, 1);
    return _sharedGeo;
}

// ---- 全局粒子池（mesh+material 复用）----
// addBurst 触发时合并命中会清空 + 重建大量粒子；池化后绝大多数情况下不再 new 材质。
const _PARTICLE_POOL = [];
const _PARTICLE_POOL_MAX = 256;
function _acquireParticle(colorObj, opacity) {
    let p = _PARTICLE_POOL.pop();
    if (!p) {
        const mat = new THREE.MeshBasicMaterial({
            color: colorObj,
            transparent: true,
            opacity,
            depthWrite: false,
            toneMapped: false,
        });
        const mesh = new THREE.Mesh(getSharedGeo(), mat);
        mesh.layers.enable(1);
        return { mesh, mat };
    }
    p.mat.color.copy(colorObj);
    p.mat.opacity = opacity;
    return p;
}
function _releaseParticle(particle) {
    Globals.scene.remove(particle.mesh);
    if (_PARTICLE_POOL.length < _PARTICLE_POOL_MAX) {
        _PARTICLE_POOL.push({ mesh: particle.mesh, mat: particle.mat });
    } else {
        particle.mat.dispose();
    }
}

// 模块级 scratch（update 复用）
const _scratchSpinQuat = new THREE.Quaternion();

// ===== 命中数 → 强度 t 的曲线（与 utils.js 的 dmgCountStrength 相同接口）=====
// 输入：mergeCount（合并命中数，≥1）
// 输出：t ∈ [0, 1]，0 = 用 @1 端点，1 = 用 @max 端点
function burstCountStrength(mergeCount) {
    const countForMax = Math.max(1, CONFIG.recallHitBurstCountForMax ?? 10);
    if (mergeCount <= 1) return 0;
    if (mergeCount >= countForMax) return 1;
    const linear = (mergeCount - 1) / (countForMax - 1);
    const curveType = CONFIG.recallHitBurstCountCurve ?? 0;
    switch (curveType) {
        case 1: // smoothstep
            return linear * linear * (3 - 2 * linear);
        case 2: // smootherstep
            return linear * linear * linear * (linear * (linear * 6 - 15) + 10);
        case 3: // easeOutQuad
            return 1 - (1 - linear) * (1 - linear);
        case 0: // linear（默认，用户偏好）
        default:
            return linear;
    }
}

// ====== 曲线模式（方案 B）核心工具 ======
// 三次贝塞尔（端点固定 (0,0)/(1,1)，控制点 p1/p2 ∈ [0,1]² 区间）求值。
// 用牛顿-拉夫森迭代求出 x=t 对应的参数 u，再用 u 计算 y。
// 5 次迭代足够保证 1e-6 精度，性能可忽略。
function evalCubicBezier(p1, p2, t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const cx = 3 * p1.x;
    const bx = 3 * (p2.x - p1.x) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * p1.y;
    const by = 3 * (p2.y - p1.y) - cy;
    const ay = 1 - cy - by;
    // 求 u 使 bezierX(u) = t
    let u = t;
    for (let i = 0; i < 5; i++) {
        const x = ((ax * u + bx) * u + cx) * u;
        const dx = (3 * ax * u + 2 * bx) * u + cx;
        if (Math.abs(dx) < 1e-6) break;
        const next = u - (x - t) / dx;
        u = Math.max(0, Math.min(1, next));
    }
    // 计算 y(u)
    return ((ay * u + by) * u + cy) * u;
}

// 将 *AtMax 后缀（去掉 Low/High 前缀后的部分）映射到三个语义类别
//   density  → Count, LifeMin, LifeMax
//   motion   → SpeedMin, SpeedMax, UpBias, Gravity, Drag
//   visual   → SizeMin, SizeMax, Opacity, ColorJitter, Spin
function classifyBurstSuffix(suffix) {
    // 去 Layer 前缀
    let s = suffix;
    if (s.startsWith('Low'))       s = s.slice(3);
    else if (s.startsWith('High')) s = s.slice(4);
    if (s === 'Count' || s === 'LifeMin' || s === 'LifeMax') return 'density';
    if (s === 'SpeedMin' || s === 'SpeedMax' || s === 'UpBias' || s === 'Gravity' || s === 'Drag') return 'motion';
    return 'visual'; // SizeMin, SizeMax, Opacity, ColorJitter, Spin
}

// 归一化合并命中数到 [0,1]
function normalizeMergeCount(mergeCount) {
    const countForMax = Math.max(1, CONFIG.recallHitBurstCountForMax ?? 10);
    if (mergeCount <= 1) return 0;
    if (mergeCount >= countForMax) return 1;
    return (mergeCount - 1) / (countForMax - 1);
}

// 按 mergeCount 在双端点之间插值读取一个 recallHitBurst* 参数。
// 两种模式：
//   1) 曲线模式（recallHitBurstUseCurves=true，默认）：
//      final = baseValue * lerp(startScale, endScale, cubicBezier(p1, p2, tNorm))
//   2) 旧滑条模式（兜底）：
//      final = lerp(@1端点值, @max端点值, burstCountStrength(mergeCount))
// 缺 *AtMax 时退化为单值（向后兼容）。
function burstParamLerp(suffix, fallback, mergeCount) {
    const a = CONFIG['recallHitBurst' + suffix];
    if (a === undefined) return fallback;

    // ---- 曲线模式（方案 B）----
    if (CONFIG.recallHitBurstUseCurves) {
        const curves = CONFIG.recallHitBurstCurves;
        if (curves) {
            const category = classifyBurstSuffix(suffix);
            const curve = curves[category];
            if (curve && curve.enabled !== false) {
                const tNorm = normalizeMergeCount(mergeCount);
                const shapeT = evalCubicBezier(curve.p1, curve.p2, tNorm);
                const startScale = curve.startScale ?? 1.0;
                const endScale = curve.endScale ?? 1.0;
                const scale = startScale + (endScale - startScale) * shapeT;
                return a * scale;
            }
        }
        // 曲线找不到 / 该曲线被禁用 → 退回 @1 端点原值
        return a;
    }

    // ---- 旧滑条模式（双端点直插值）----
    const b = CONFIG['recallHitBurst' + suffix + 'AtMax'];
    if (b === undefined) return a;
    const t = burstCountStrength(mergeCount);
    return a + (b - a) * t;
}

// 工具函数：从基色生成"扰动后"的新颜色
// jitter ∈ [0, 1]：
//   - 色相 hue   随机偏移 ±0.06 * jitter（一圈 = 1.0，避免色相漂太远脱离基调）
//   - 饱和度 s   随机 ±0.20 * jitter
//   - 明度   l   随机 ±0.25 * jitter
function jitterColor(baseHex, jitter) {
    const c = new THREE.Color(baseHex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    const j = THREE.MathUtils.clamp(jitter, 0, 1);
    hsl.h = (hsl.h + (Math.random() - 0.5) * 0.12 * j + 1) % 1;
    hsl.s = THREE.MathUtils.clamp(hsl.s + (Math.random() - 0.5) * 0.40 * j, 0, 1);
    hsl.l = THREE.MathUtils.clamp(hsl.l + (Math.random() - 0.5) * 0.50 * j, 0.05, 0.95);
    c.setHSL(hsl.h, hsl.s, hsl.l);
    return c;
}

// 工具函数：生成"中心向外、可控上抛偏置"的随机方向
//   upBias ∈ [0, 1]：0 = 纯水平，1 = 完全向上
function makeBurstDirection(upBias) {
    const theta = Math.random() * Math.PI * 2;
    const u = Math.random();
    const polarRaw = (u - 0.5) * 2;                       // [-1, 1]
    const polar = polarRaw * (1 - upBias) + (u * upBias); // upBias=1 时全为 [0,1] = 上半球
    const phi = polar * Math.PI * 0.5;                    // [-π/2, π/2]
    const cosPhi = Math.cos(phi);
    return new THREE.Vector3(
        Math.cos(theta) * cosPhi,
        Math.sin(phi),
        Math.sin(theta) * cosPhi
    );
}

export class EnemyHitBurstEffect {
    /**
     * @param {THREE.Vector3} centerPos    敌人身体中心世界坐标（已包含 enemy.mesh.position）
     * @param {number}        [baseColor]  基础采样色（敌人 bodyColor）；缺省时回退 CONFIG.recallHitBurstFixedColor
     * @param {Object}        [opts]
     * @param {number}        [opts.scale=1]  外部额外缩放（如特殊 isSpec 命中时放大）
     */
    constructor(centerPos, baseColor, opts = {}) {
        this.particles = [];
        this.alive = true;
        // 起爆点缓存：合并 addBurst 时复用，同时供外部判定"特效是否仍在原地继续累积"
        this.origin = null;
        // 外部 scale 也缓存，addBurst 时重用
        this.extraScale = opts.scale ?? 1;
        // 颜色源缓存：合并的后续命中沿用首次创建时确定的颜色基（同一个敌人色）
        this.baseColorHex = null;
        // 当前合并数；外部每次合并要先 ++ 再 addBurst(this.mergeCount)
        this.mergeCount = 1;

        if (!CONFIG.recallHitBurstEnabled) {
            // 总开关关闭时构造空特效，update 立即返回 false
            this.alive = false;
            return;
        }

        // 起爆原点：敌人 mesh.position + originY 偏移
        this.origin = centerPos.clone();
        this.origin.y += CONFIG.recallHitBurstOriginY ?? 0.4;

        // 颜色源选择
        if ((CONFIG.recallHitBurstColorSource ?? 'enemy') === 'fixed') {
            this.baseColorHex = CONFIG.recallHitBurstFixedColor ?? 0x5e55a2;
        } else {
            this.baseColorHex = (baseColor !== undefined && baseColor !== null)
                ? baseColor
                : (CONFIG.recallHitBurstFixedColor ?? 0x5e55a2);
        }

        // 首次爆发：mergeCount = 1（@1 端点）
        this._spawnLayer(/*high=*/false, this.mergeCount);
        this._spawnLayer(/*high=*/true,  this.mergeCount);
    }

    /**
     * 合并入口：当一次新的命中合并到当前 effect 上时调用。
     * 同帧 / 时间窗口内的多次命中应当依次调用此方法，而不是 new 多个 effect。
     *
     * 【重建式】：调用时会先销毁当前所有粒子，再按新 mergeCount 在 @1 / @max 双端点
     * 之间插值出来的参数重新生成一批。这样保证：粒子总量、速度、寿命、大小等
     * 所有参数严格等于双端点插值结果（例如 Count 配置 30→40 时，10 把同时击中
     * 必然只生成 40 颗，而不是累加到 355 颗）。
     *
     * 视觉上同一帧内的销毁+重建肉眼几乎看不到，因为旧粒子才刚生成 0~1 帧。
     *
     * @param {number} newMergeCount 当前累计命中数（≥2）；用于按双端点插值生成新粒子参数
     */
    addBurst(newMergeCount) {
        if (!this.alive || !this.origin) return;
        this.mergeCount = Math.max(this.mergeCount, newMergeCount);
        // 1) 销毁所有现存粒子（包括已经在飞行中的旧批次）
        this._clearParticles();
        // 2) 按当前 mergeCount 重新生成两层粒子
        this._spawnLayer(/*high=*/false, this.mergeCount);
        this._spawnLayer(/*high=*/true,  this.mergeCount);
    }

    /**
     * 内部：清空当前所有粒子（保留 effect 实例本身存活）
     * 与 destroy() 的区别：destroy 会把整个 effect 标记为 alive=false 由 main 移除；
     * _clearParticles 只清粒子，effect 还会被 addBurst 立即填充新粒子。
     */
    _clearParticles() {
        for (const p of this.particles) {
            _releaseParticle(p);
        }
        this.particles.length = 0;
    }

    /**
     * 内部：按 mergeCount 插值后的参数生成一批粒子（单层）
     */
    _spawnLayer(isHigh, mergeCount) {
        const prefix = isHigh ? 'High' : 'Low';
        const masterScale = (CONFIG.recallHitBurstScale ?? 1) * this.extraScale;

        // 所有参数都通过 burstParamLerp 取双端点插值后的"当前等效值"
        const countRaw = burstParamLerp(`${prefix}Count`,      isHigh ? 8   : 26, mergeCount);
        const count    = Math.max(0, Math.round(countRaw));
        const spdMin   = burstParamLerp(`${prefix}SpeedMin`,   isHigh ? 7   : 3,  mergeCount);
        const spdMax   = burstParamLerp(`${prefix}SpeedMax`,   isHigh ? 13  : 8,  mergeCount);
        const upBias   = burstParamLerp(`${prefix}UpBias`,     isHigh ? 0.75: 0.25, mergeCount);
        const gravity  = burstParamLerp(`${prefix}Gravity`,    isHigh ? 22  : 18, mergeCount);
        const lifeMin  = burstParamLerp(`${prefix}LifeMin`,    isHigh ? 0.7 : 0.45, mergeCount);
        const lifeMax  = burstParamLerp(`${prefix}LifeMax`,    isHigh ? 1.2 : 0.85, mergeCount);
        const sizeMin  = burstParamLerp(`${prefix}SizeMin`,    isHigh ? 0.10: 0.06, mergeCount);
        const sizeMax  = burstParamLerp(`${prefix}SizeMax`,    isHigh ? 0.22: 0.16, mergeCount);
        const opacity  = burstParamLerp(`${prefix}Opacity`,    isHigh ? 0.9 : 0.85, mergeCount);
        const jitter   = burstParamLerp(`${prefix}ColorJitter`,isHigh ? 0.45: 0.35, mergeCount);
        const spin     = burstParamLerp(`${prefix}Spin`,       isHigh ? 6   : 8, mergeCount);
        const drag     = burstParamLerp(`${prefix}Drag`,       isHigh ? 0.5 : 1.2, mergeCount);

        for (let i = 0; i < count; i++) {
            const dir = makeBurstDirection(upBias);
            const speed = THREE.MathUtils.lerp(spdMin, spdMax, Math.random());
            const velocity = dir.multiplyScalar(speed);

            const lifeMax_i = THREE.MathUtils.lerp(lifeMin, lifeMax, Math.random());
            const sizeBase  = THREE.MathUtils.lerp(sizeMin, sizeMax, Math.random()) * masterScale;

            const color = jitterColor(this.baseColorHex, jitter);

            // 从对象池取（pool 命中率高时几乎零分配）
            const { mesh, mat } = _acquireParticle(color, opacity);
            mesh.position.copy(this.origin);
            // 起始位置加一点点散布，避免所有粒子从同一点出发显得太规整
            mesh.position.x += (Math.random() - 0.5) * 0.08 * masterScale;
            mesh.position.z += (Math.random() - 0.5) * 0.08 * masterScale;
            mesh.position.y += (Math.random() - 0.5) * 0.05 * masterScale;
            mesh.scale.setScalar(sizeBase);
            mesh.rotation.set(
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2
            );

            Globals.scene.add(mesh);

            this.particles.push({
                mesh,
                mat,
                velocity,
                gravity,
                drag,
                spin: spin * (0.6 + Math.random() * 0.8),
                spinAxis: new THREE.Vector3(
                    Math.random() - 0.5,
                    Math.random() - 0.5,
                    Math.random() - 0.5
                ).normalize(),
                age: 0,
                life: lifeMax_i,
                baseOpacity: opacity,
                baseSize: sizeBase,
                grounded: false,
            });
        }
    }

    /**
     * @param {number} delta
     * @returns {boolean} 是否仍存活（false 时 main 应当 destroy 并 splice）
     */
    update(delta) {
        if (!this.alive) return false;
        if (this.particles.length === 0) {
            this.alive = false;
            return false;
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.age += delta;

            if (p.age >= p.life) {
                _releaseParticle(p);
                this.particles.splice(i, 1);
                continue;
            }

            // 物理：阻力（水平）+ 重力（向下）
            const dragFactor = Math.exp(-p.drag * delta);
            p.velocity.x *= dragFactor;
            p.velocity.z *= dragFactor;
            p.velocity.y -= p.gravity * delta;

            p.mesh.position.addScaledVector(p.velocity, delta);

            // 落地检测
            const groundY = p.baseSize * 0.5;
            if (p.mesh.position.y < groundY) {
                p.mesh.position.y = groundY;
                if (p.velocity.y < 0) {
                    p.velocity.y = 0;
                    p.velocity.x *= 0.4;
                    p.velocity.z *= 0.4;
                    p.grounded = true;
                }
            }

            // 自转（复用 scratchQuat 避免每帧每粒子 new Quaternion）
            _scratchSpinQuat.setFromAxisAngle(p.spinAxis, p.spin * delta);
            p.mesh.quaternion.multiplyQuaternions(_scratchSpinQuat, p.mesh.quaternion);

            // 透明度衰减
            const t = p.age / p.life;
            const fadeStart = 0.6;
            let opacity = p.baseOpacity;
            if (t > fadeStart) {
                const ft = (t - fadeStart) / (1 - fadeStart);
                opacity = p.baseOpacity * (1 - ft);
            }
            p.mat.opacity = opacity;

            // 体积轻微收缩（落地后更明显）
            const sizeMul = p.grounded
                ? THREE.MathUtils.lerp(1, 0.8, THREE.MathUtils.clamp((t - 0.5) * 2, 0, 1))
                : 1;
            p.mesh.scale.setScalar(p.baseSize * sizeMul);
        }

        if (this.particles.length === 0) {
            this.alive = false;
            return false;
        }
        return true;
    }

    destroy() {
        for (const p of this.particles) {
            _releaseParticle(p);
        }
        this.particles.length = 0;
        this.alive = false;
    }
}
