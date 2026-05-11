import * as THREE from 'three';
import { Globals } from '../utils.js';
import { CONFIG } from '../config.js';

/**
 * HitSparkEffect — 流星火花受击特效
 *
 * 用途：玩家主动攻击（low 伤害）武器击中敌人时，在矛尖刺入点生成的短促火花爆点。
 *
 * 视觉构成（三层）：
 *   1. 中心闪光 core flash    —— 命中第 0 帧的白色亮斑，迅速放大并衰减（0~0.08s）。
 *   2. 流星火花条 spark streaks —— 多条细长亮线沿命中反方向 + 侧向扇形喷射，
 *                                运动方向被拉伸为"流星拖尾"，颜色由白绿渐变到深绿。
 *   3. 飘散光点 embers         —— 少量小光点慢速飘散并轻微下坠，增加质感。
 *
 * 颜色风格：呼应项目整体绿色主色调（0x91c53a / 0xd4ff99）。
 * 总时长：约 0.35 秒（爆发快、消散快，突出"命中瞬间"）。
 *
 * 用法：
 *   Globals.hitSparkEffects.push(new HitSparkEffect(hitPointWorld, hitDirection));
 *   并在主循环中 update(delta)，返回 false 时移除。
 */

// ---- 颜色常量（项目主色调） ----
const COLOR_CORE = new THREE.Color(0xffffff);      // 中心闪光：白
const COLOR_SPARK_HOT = new THREE.Color(0xeaffc4); // 火花起始：亮白绿
const COLOR_SPARK_MID = new THREE.Color(0xd4ff99); // 火花中段：亮黄绿（项目 special 色）
const COLOR_SPARK_END = new THREE.Color(0x4a8a1f); // 火花末端：深绿
const COLOR_EMBER     = new THREE.Color(0xb6f06a); // 光点碎屑：偏黄绿

// ---- 共享几何（构造一次，所有实例复用） ----
// 流星条：圆锥，本地 +Y 顶点（尖端 = 流星头/前进方向，粗），-Y 尾端（细，作为拖尾）。
// 注意：THREE.ConeGeometry 默认 +Y 是顶点(0 半径)、-Y 是底面(radius)；
// 为了符合"流星头粗、拖尾尖"的视觉，我们手动用 CylinderGeometry(radiusTop, radiusBottom, height, ...)，
// 把 +Y 端做粗（radiusTop=1）、-Y 端做尖（radiusBottom=0），这样 height 方向上的"粗细渐变"自然形成拖尾效果。
const _streakGeo = new THREE.CylinderGeometry(1, 0, 1, 8, 1, false);
// 平移让原点在 +Y 端（流星头），便于按"头部位置"定位、沿 -Y 拉伸为尾巴
_streakGeo.translate(0, -0.5, 0);
const _emberGeo  = new THREE.IcosahedronGeometry(1, 0); // 小光点用低面数球，叠加渲染时观感为圆点
// 中心闪光用细分球：Additive 后呈圆形发光，无方角
let _flashGeoInner = null;
let _flashGeoOuter = null;
function getFlashGeoInner() {
    if (!_flashGeoInner) _flashGeoInner = new THREE.IcosahedronGeometry(1, 3);
    return _flashGeoInner;
}
function getFlashGeoOuter() {
    if (!_flashGeoOuter) _flashGeoOuter = new THREE.IcosahedronGeometry(1, 2);
    return _flashGeoOuter;
}

export class HitSparkEffect {
    /**
     * @param {THREE.Vector3} position    刺入点世界坐标
     * @param {THREE.Vector3} direction   武器入射方向（默认：火花朝其反方向 + 侧向扇形喷出）
     * @param {Object}        [opts]
     * @param {number}        [opts.scale=1]       整体缩放
     * @param {number}        [opts.streakCount=14] 流星火花条数
     * @param {number}        [opts.emberCount=6]  飘散光点数
     * @param {boolean}       [opts.reverseDir=false] true 时反转主喷射方向（朝 +direction 喷出而非 -direction）
     * @param {Object}        [opts.params]        可选参数覆盖（不传时全部从 CONFIG 读取）。
     *                                              用于让"玩家攻击瞬间火花"使用一组独立的 attackSpark* 参数，
     *                                              而不与"敌人受击火花"共享 hitSpark* 配置。
     */
    constructor(position, direction, opts = {}) {
        const scale       = opts.scale ?? 1;
        const reverseDir  = !!opts.reverseDir;
        // params 提供完整的参数覆盖（同名键即可），未覆盖部分仍走 CONFIG.hitSpark*
        const P = opts.params || {};
        const pick = (key, fallback) => (P[key] !== undefined ? P[key] : (CONFIG[key] !== undefined ? CONFIG[key] : fallback));
        const streakCount = opts.streakCount ?? pick('hitSparkStreakCount', 14);
        const emberCount  = opts.emberCount  ?? pick('hitSparkEmberCount',  6);

        this.life = 0;
        // 总时长由参数控制；中心闪光 = 总时长 × 0.26，保证爆点"快闪即逝"
        this.maxLife   = pick('hitSparkLifetime', 0.45);
        this.flashLife = this.maxLife * 0.26;
        // 消散开始进度（从此进度开始整体缩小并从尾巴吃到头）
        this.vanishStart = THREE.MathUtils.clamp(pick('hitSparkVanishStart', 0.55), 0.05, 0.95);
        // 物理参数（构造时快照，避免每帧读取 CONFIG）
        this.gravity = pick('hitSparkGravity', 9.0);
        this.drag    = pick('hitSparkDrag',    1.6);
        // 中心闪光峰值半径（世界单位）— 故意设得很小，避免变成"大方块"
        this.flashCoreRadius = 0.18 * scale;
        this.flashGlowRadius = 0.34 * scale;

        this.scale = scale;
        this.group = new THREE.Group();
        this.group.position.copy(position);

        // 入射方向 → 主喷射方向：
        //   reverseDir=false（默认）：outDir = -direction（火花朝武器入射方向反向飞溅，例如朝玩家方向）
        //   reverseDir=true：outDir = +direction（火花朝武器入射方向正向飞溅，例如远离玩家）
        const inDir = direction.clone();
        if (inDir.lengthSq() < 1e-6) inDir.set(0, 0, 1);
        inDir.normalize();
        this.outDir = reverseDir ? inDir.clone() : inDir.clone().negate();

        // 资源记录，便于销毁
        this._materials = [];

        // ---- 1. 中心闪光：内核（白）+ 外圈光晕（黄绿），均为细分小球，叠加为圆形发光 ----
        const flashCoreMat = new THREE.MeshBasicMaterial({
            color: COLOR_CORE,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        this._materials.push(flashCoreMat);
        this.flashCoreMesh = new THREE.Mesh(getFlashGeoInner(), flashCoreMat);
        this.flashCoreMesh.scale.setScalar(0.001); // 起始几乎不可见
        this.flashCoreMesh.layers.enable(1);
        this.group.add(this.flashCoreMesh);

        const flashGlowMat = new THREE.MeshBasicMaterial({
            color: COLOR_SPARK_MID,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        this._materials.push(flashGlowMat);
        this.flashGlowMesh = new THREE.Mesh(getFlashGeoOuter(), flashGlowMat);
        this.flashGlowMesh.scale.setScalar(0.001);
        this.flashGlowMesh.layers.enable(1);
        this.group.add(this.flashGlowMesh);

        // ---- 2. 流星火花条 ----
        // 圆锥角度（参数中以"度"为单位，便于直观调）
        const coneHalf       = THREE.MathUtils.degToRad(pick('hitSparkConeAngle', 28));
        const verticalDamp   = pick('hitSparkVerticalDamp', 0.55);
        const upwardBias     = pick('hitSparkUpwardBias',   0.05);
        const speedMin       = pick('hitSparkSpeedMin',     14);
        const speedMax       = pick('hitSparkSpeedMax',     26);
        const baseThickness  = pick('hitSparkThickness',    0.085);
        const baseLength     = pick('hitSparkLength',       1.0);
        this.streaks = [];
        for (let i = 0; i < streakCount; i++) {
            // 在 outDir 周围生成收束的圆锥扇形分布
            const dir = randomInCone(this.outDir, coneHalf);
            // 抑制朝下/朝上的偏移分量；并加一点点轻微上扬，平衡重力下坠
            dir.y = dir.y * verticalDamp + upwardBias;
            dir.normalize();
            // 速度不受 opts.scale 影响（只视觉尺寸缩放，不改窜出距离感）
            const speed = THREE.MathUtils.randFloat(speedMin, speedMax);

            const mat = new THREE.MeshBasicMaterial({
                color: COLOR_SPARK_HOT.clone(),
                transparent: true,
                opacity: 1.0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            });
            this._materials.push(mat);
            const mesh = new THREE.Mesh(_streakGeo, mat);
            mesh.layers.enable(1);
            this.group.add(mesh);

            this.streaks.push({
                mesh,
                mat,
                velocity: dir.clone().multiplyScalar(speed),
                travelled: 0,
                // 每条粒子有独立的"早死"扰动，让消散错落有致
                lifeScale: THREE.MathUtils.randFloat(0.85, 1.15),
                // 流星头(粗端)半径；拖尾(尖端)半径=0，整条线天然头粗尾尖。±25% 随机
                thickness: baseThickness * THREE.MathUtils.randFloat(0.75, 1.25) * scale,
                maxLength: baseLength    * THREE.MathUtils.randFloat(0.75, 1.25) * scale
            });
        }

        // ---- 3. 飘散光点 embers ----
        this.embers = [];
        for (let i = 0; i < emberCount; i++) {
            // 光点也大致朝喷射方向，但更随机、速度更小
            const dir = randomInCone(this.outDir, Math.PI * 0.6); // ~108°
            const speed = THREE.MathUtils.randFloat(2.5, 5.5) * scale;

            const mat = new THREE.MeshBasicMaterial({
                color: COLOR_EMBER.clone(),
                transparent: true,
                opacity: 1.0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            });
            this._materials.push(mat);
            const mesh = new THREE.Mesh(_emberGeo, mat);
            const sz = THREE.MathUtils.randFloat(0.06, 0.11) * scale;
            mesh.scale.setScalar(sz);
            mesh.layers.enable(1);
            this.group.add(mesh);

            this.embers.push({
                mesh,
                mat,
                velocity: dir.clone().multiplyScalar(speed),
                // embers 受到流星重力 ~40%（更轻盈、慢慢飘落）
                gravity: -this.gravity * 0.4,
                baseSize: sz,
                lifeScale: THREE.MathUtils.randFloat(0.85, 1.2)
            });
        }

        Globals.scene.add(this.group);
    }

    /**
     * @param {number} delta 秒
     * @returns {boolean} 是否继续存活（false 时调用方应移除并 destroy）
     */
    update(delta) {
        this.life += delta;
        const t = this.life / this.maxLife; // 0..1 总进度

        // ---- 中心闪光：0~flashLife 内：极快放大到峰值再衰减；内核小、外圈稍大 ----
        {
            const ft = Math.min(this.life / this.flashLife, 1);
            // 内核：0~0.25 放大到 1.0R，0.25~1 衰减到 0
            let coreS;
            if (ft < 0.25) {
                coreS = THREE.MathUtils.lerp(0.2, 1.0, ft / 0.25) * this.flashCoreRadius;
            } else {
                coreS = THREE.MathUtils.lerp(1.0, 0.0, (ft - 0.25) / 0.75) * this.flashCoreRadius;
            }
            this.flashCoreMesh.scale.setScalar(Math.max(0.001, coreS));
            this.flashCoreMesh.material.opacity = (1 - ft) * 1.0;

            // 外圈光晕：放大稍慢，最大半径稍大，整体更柔
            let glowS;
            if (ft < 0.35) {
                glowS = THREE.MathUtils.lerp(0.3, 1.0, ft / 0.35) * this.flashGlowRadius;
            } else {
                glowS = THREE.MathUtils.lerp(1.0, 0.1, (ft - 0.35) / 0.65) * this.flashGlowRadius;
            }
            this.flashGlowMesh.scale.setScalar(Math.max(0.001, glowS));
            this.flashGlowMesh.material.opacity = (1 - ft) * 0.7;
        }

        // ---- 流星火花条 ----
        // 物理：每帧 v += g·dt，再 v *= exp(-drag·dt)；位置 += v·dt
        // 消散：从 vanishStart 进度起，长度先缩（尾巴吃到头），粗细稍后缩，最后只剩流星头一点点
        const vanishStart = this.vanishStart;
        for (let i = 0; i < this.streaks.length; i++) {
            const s = this.streaks[i];
            const localT = Math.min(this.life / (this.maxLife * s.lifeScale), 1);

            // ---- 物理积分 ----
            s.velocity.y -= this.gravity * delta;                      // 重力下坠
            s.velocity.multiplyScalar(Math.exp(-this.drag * delta));   // 空气阻力
            s.mesh.position.addScaledVector(s.velocity, delta);
            s.travelled += s.velocity.length() * delta;

            // ---- 长度因子：分三阶段 ----
            //   起始 0~0.18：从 0 快速拉伸到峰值（流星刚甩出拖尾）
            //   维持 0.18~vanishStart：保持峰值长度
            //   消散 vanishStart~1：长度按非线性曲线衰减到 0（"尾巴被吃到头"，先慢后快）
            let lenFactor;
            if (localT < 0.18) {
                lenFactor = localT / 0.18;
            } else if (localT < vanishStart) {
                lenFactor = 1.0;
            } else {
                const k = (localT - vanishStart) / (1 - vanishStart);
                // 用 1 - k^1.6 让尾部"先慢后快"地被吃掉，视觉上更像拖尾自然湮灭
                lenFactor = Math.max(0, 1 - Math.pow(k, 1.6));
            }
            const length = s.maxLength * lenFactor;

            // ---- 粗细因子：消散阶段比长度晚一点开始缩，整体缩到 0 ----
            //   维持 0~vanishThickStart：保持基准粗细
            //   消散 vanishThickStart~1：粗细按曲线缩到 0
            // vanishThickStart = vanishStart + (1-vanishStart)*0.25 → 长度先缩 25% 后才轮到粗细
            const vanishThickStart = vanishStart + (1 - vanishStart) * 0.25;
            let thickFactor;
            if (localT < vanishThickStart) {
                thickFactor = 1.0;
            } else {
                const k = (localT - vanishThickStart) / (1 - vanishThickStart);
                // 用 (1-k)^1.4 让粗细收尾时再加速一点，整体"缩成一点光"
                thickFactor = Math.max(0, Math.pow(1 - k, 1.4));
            }
            const thickness = s.thickness * thickFactor;

            // ---- 朝向：让本地 +Y（流星头/粗端）对齐当前速度方向 ----
            const v = s.velocity;
            if (v.lengthSq() > 1e-6) {
                _tmpVel.copy(v).normalize();
                s.mesh.quaternion.setFromUnitVectors(_unitY, _tmpVel);
            }
            s.mesh.scale.set(
                Math.max(0.0001, thickness),
                Math.max(0.01,   length),
                Math.max(0.0001, thickness)
            );

            // ---- 颜色：白绿 -> 亮黄绿 -> 深绿 ----
            if (localT < 0.5) {
                s.mat.color.copy(COLOR_SPARK_HOT).lerp(COLOR_SPARK_MID, localT / 0.5);
            } else {
                s.mat.color.copy(COLOR_SPARK_MID).lerp(COLOR_SPARK_END, (localT - 0.5) / 0.5);
            }
            // 不再用透明度做主消散（避免"简单渐隐"的廉价感）；
            // 仅在 localT 接近 1 时给一点点尾衰，保证彻底消失
            s.mat.opacity = localT < 0.9 ? 1.0 : Math.max(0, (1 - localT) / 0.1);
        }

        // ---- 飘散光点：轻微下坠 + 缩小淡出 ----
        for (let i = 0; i < this.embers.length; i++) {
            const e = this.embers[i];
            const localT = Math.min(this.life / (this.maxLife * e.lifeScale), 1);
            e.velocity.y += e.gravity * delta;
            e.mesh.position.addScaledVector(e.velocity, delta);

            // 大小：先轻微涨一下，再衰减
            const grow = localT < 0.2
                ? THREE.MathUtils.lerp(0.7, 1.15, localT / 0.2)
                : THREE.MathUtils.lerp(1.15, 0.25, (localT - 0.2) / 0.8);
            e.mesh.scale.setScalar(e.baseSize * grow);

            // 颜色：从亮黄绿渐入深绿
            e.mat.color.copy(COLOR_EMBER).lerp(COLOR_SPARK_END, localT);
            e.mat.opacity = localT < 0.6 ? 1.0 : Math.max(0, 1 - (localT - 0.6) / 0.4);
        }

        if (t >= 1) return false;
        return true;
    }

    destroy() {
        Globals.scene.remove(this.group);
        // 几何体共享，不销毁；材质每实例独立创建，全部 dispose
        for (const m of this._materials) m.dispose();
        this._materials.length = 0;
        this.streaks.length = 0;
        this.embers.length = 0;
    }
}

// ---- 工具：在以 axis 为中轴、张角为 maxAngle 的圆锥内取均匀方向 ----
const _tmpTarget = new THREE.Vector3();
const _tmpAxis   = new THREE.Vector3();
const _tmpPerp1  = new THREE.Vector3();
const _tmpPerp2  = new THREE.Vector3();
const _tmpVel    = new THREE.Vector3();
const _unitY     = new THREE.Vector3(0, 1, 0);
function randomInCone(axis, maxAngle) {
    _tmpAxis.copy(axis).normalize();
    // 构造一组与 axis 正交的基
    if (Math.abs(_tmpAxis.y) < 0.95) _tmpPerp1.set(0, 1, 0);
    else                              _tmpPerp1.set(1, 0, 0);
    _tmpPerp1.crossVectors(_tmpAxis, _tmpPerp1).normalize();
    _tmpPerp2.crossVectors(_tmpAxis, _tmpPerp1).normalize();

    // 圆锥内均匀采样：cos(theta) ∈ [cos(maxAngle), 1]
    const cosMax = Math.cos(maxAngle);
    const cosTheta = THREE.MathUtils.lerp(cosMax, 1, Math.random());
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = Math.random() * Math.PI * 2;

    const out = new THREE.Vector3();
    out.copy(_tmpAxis).multiplyScalar(cosTheta);
    out.addScaledVector(_tmpPerp1, sinTheta * Math.cos(phi));
    out.addScaledVector(_tmpPerp2, sinTheta * Math.sin(phi));
    return out.normalize();
}
