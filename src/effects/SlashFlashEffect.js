import * as THREE from 'three';
import { Globals } from '../utils.js';
import { CONFIG } from '../config.js';

/**
 * SlashFlashEffect — 敌人死亡时贴地的"刀光闪现"特效
 *
 * 视觉构成：
 *   两层共 mesh：外层 glow（厚一点、半透明）+ 内层 core（细一点、几乎不透明），
 *   都使用 AdditiveBlending，营造"刀光剧烈高光 + 边缘柔光晕"的双层质感。
 *
 * 形状：
 *   xy 平面上的"两端尖中间鼓"的纺锤形 Shape（quadraticCurveTo 描点，不是简单椭圆），
 *   随后旋转 -π/2 到 xz 平面贴地。
 *
 * 出现动画：
 *   x 方向 scale 从 0.01 拉到 1（"出鞘"），y 方向先膨胀再回收，
 *   后段 alpha 衰减到 0。整个过程由单一 life 计时控制。
 *
 * ★ 全部参数从 CONFIG.slashFlash* 读取（命中时一次性快照到实例）
 *   —— 命中后再调参不会影响已经在播放的旧实例（避免半路变色变粗），
 *      但下一次新生成时立即生效。
 *
 * @param {THREE.Vector3} position    敌人 mesh.position
 * @param {THREE.Vector3} direction   死亡方向（来源于击杀来向 direction），用于决定刀光朝向
 * @param {number}        [scale=1]   外部缩放（一般传 CONFIG.enemyScale）
 */

// 几何缓存：键为量化后的 (length, width)。
// 实测 enemyScale 几乎固定，所有死亡特效 length/width 落到极少数桶里，缓存命中率极高。
// 命中后 createSlashShape 不再做 Bezier 三角化，CPU 节省显著。
const _slashGeoCache = new Map();
function _quantize(v) { return Math.round(v * 100) / 100; }

function createSlashShape(length, width) {
    const key = _quantize(length) + ':' + _quantize(width);
    const cached = _slashGeoCache.get(key);
    if (cached) return cached;

    const mid = length * 0.5;
    const halfWidth = width * 0.5;
    const shape = new THREE.Shape();

    shape.moveTo(0, 0);
    shape.quadraticCurveTo(length * 0.18, halfWidth, mid, halfWidth * 1.15);
    shape.quadraticCurveTo(length * 0.82, halfWidth, length, 0);
    shape.quadraticCurveTo(length * 0.82, -halfWidth, mid, -halfWidth * 1.15);
    shape.quadraticCurveTo(length * 0.18, -halfWidth, 0, 0);

    const geo = new THREE.ShapeGeometry(shape, 24);
    // 限制缓存大小（极少会到这个上限）
    if (_slashGeoCache.size > 32) {
        const firstKey = _slashGeoCache.keys().next().value;
        const firstGeo = _slashGeoCache.get(firstKey);
        if (firstGeo && firstGeo.dispose) firstGeo.dispose();
        _slashGeoCache.delete(firstKey);
    }
    _slashGeoCache.set(key, geo);
    return geo;
}

export class SlashFlashEffect {
    constructor(position, direction, scale = 1) {
        // ★ 读取 CONFIG 快照（带 fallback，保持单元测试 / 旧 preset 兼容）
        const duration   = CONFIG.slashFlashDuration         ?? 0.18;
        const lengthBase = CONFIG.slashFlashLength           ?? 3.1;
        const glowW      = CONFIG.slashFlashGlowWidth        ?? 0.34;
        const coreW      = CONFIG.slashFlashCoreWidth        ?? 0.12;
        const coreLenK   = CONFIG.slashFlashCoreLengthRatio  ?? 0.96;
        const yOffset    = CONFIG.slashFlashHeightOffset     ?? 0.55;
        const color      = CONFIG.slashFlashColor            ?? 0x91c53a;
        const glowOp     = CONFIG.slashFlashGlowOpacity      ?? 0.82;
        const coreOp     = CONFIG.slashFlashCoreOpacity      ?? 1.0;
        // 动画曲线参数（保留为 CONFIG 项，方便手感调试）
        const revealRatio = CONFIG.slashFlashRevealRatio     ?? 0.28;
        const fadeStart   = CONFIG.slashFlashFadeStart       ?? 0.55;

        this.life = duration;
        this.maxLife = duration;
        this.revealRatio = THREE.MathUtils.clamp(revealRatio, 0.01, 0.99);
        this.fadeStart   = THREE.MathUtils.clamp(fadeStart,   0.01, 0.99);
        this.baseGlowOpacity = glowOp;
        this.baseCoreOpacity = coreOp;

        this.group = new THREE.Group();
        this.length = lengthBase * scale;

        const flatDir = direction.clone();
        flatDir.y = 0;
        if (flatDir.lengthSq() < 0.0001) flatDir.set(1, 0, 0);
        flatDir.normalize();

        const glowGeometry = createSlashShape(this.length, glowW * scale);
        const coreGeometry = createSlashShape(this.length * coreLenK, coreW * scale);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: glowOp,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        const coreMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: coreOp,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });

        this.glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        this.coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
        this.glowMesh.rotation.x = -Math.PI / 2;
        this.coreMesh.rotation.x = -Math.PI / 2;
        this.glowMesh.layers.enable(1);
        this.coreMesh.layers.enable(1);
        this.group.add(this.glowMesh);
        this.group.add(this.coreMesh);

        this.group.position.copy(position);
        this.group.position.y += yOffset * scale;
        this.group.position.addScaledVector(flatDir, -this.length * 0.5);
        this.group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), flatDir);

        this.glowMesh.scale.set(0.01, 1, 1);
        this.coreMesh.scale.set(0.01, 1, 1);

        Globals.scene.add(this.group);
    }

    update(delta) {
        this.life -= delta;
        const alpha = Math.max(this.life / this.maxLife, 0);
        const progress = 1 - alpha;

        const reveal     = progress < this.revealRatio ? progress / this.revealRatio : 1;
        const fade       = progress < this.fadeStart ? 1 : Math.max(0, 1 - (progress - this.fadeStart) / (1 - this.fadeStart));
        const widthTaper = progress < 0.2 ? 0.7 + progress * 1.5 : Math.max(0.72, 1 - (progress - 0.2) * 0.25);

        this.glowMesh.scale.x = Math.max(0.01, reveal);
        this.coreMesh.scale.x = Math.max(0.01, reveal * 0.98);
        this.glowMesh.scale.y = widthTaper;
        this.coreMesh.scale.y = widthTaper * 0.82;
        this.glowMesh.material.opacity = fade * this.baseGlowOpacity;
        this.coreMesh.material.opacity = fade * this.baseCoreOpacity;

        if (this.life <= 0) {
            Globals.scene.remove(this.group);
            // 几何来自共享缓存，不能 dispose；只 dispose 材质（每实例独有）。
            this.glowMesh.material.dispose();
            this.coreMesh.material.dispose();
            return false;
        }

        return true;
    }
}
