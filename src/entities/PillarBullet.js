import * as THREE from 'three';
import { Globals } from '../utils.js';

/**
 * PillarBullet - PillarEnemy 吐出的球形子弹
 *
 * 行为：
 *   - 出生时方向锁定，之后沿该方向匀速直线飞行（不跟踪）
 *   - 存在 life 秒后自动消失
 *   - 临终 0.4s 会做一个"渐隐 + 缩小"的淡出
 *   - 当前仅测试用，不对玩家造成伤害
 *
 * 管理：
 *   - 由 Globals.pillarBullets[] 统一在 main.js animate() 中更新
 *   - update() 返回 false 表示该帧之后应从列表中移除
 */
export class PillarBullet {
    constructor(position, direction, speed, lifetime, radius) {
        this.isDead = false;
        this.maxLife = lifetime;
        this.life = lifetime;
        this.speed = speed;
        this.radius = radius;

        this.direction = direction.clone().normalize();
        // 水平约束（射击源已保证水平，但做双保险）
        this.direction.y = 0;
        if (this.direction.lengthSq() < 1e-6) this.direction.set(0, 0, 1);
        this.direction.normalize();

        // ---------- 视觉：球体 + 外层 glow halo（叠加辉光层）----------
        const group = new THREE.Group();
        group.position.copy(position);

        const coreMat = new THREE.MeshBasicMaterial({
            color: 0xff7a45,
            transparent: true,
            opacity: 1.0,
            toneMapped: false
        });
        const coreGeo = new THREE.SphereGeometry(radius, 20, 16);
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.layers.enable(1); // 辉光层
        group.add(core);

        const haloMat = new THREE.MeshBasicMaterial({
            color: 0xffc49a,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false
        });
        const halo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.6, 20, 14), haloMat);
        halo.layers.enable(1);
        group.add(halo);

        this.mesh = group;
        this.core = core;
        this.halo = halo;
        this.coreMat = coreMat;
        this.haloMat = haloMat;

        Globals.scene.add(this.mesh);

        if (!Globals.pillarBullets) Globals.pillarBullets = [];
        Globals.pillarBullets.push(this);
    }

    update(delta, _time) {
        if (this.isDead) return false;

        // 位移
        this.mesh.position.addScaledVector(this.direction, this.speed * delta);

        // 寿命递减
        this.life -= delta;

        // 临终淡出（最后 0.4s）
        const fadeStart = 0.4;
        if (this.life <= fadeStart) {
            const t = Math.max(0, this.life / fadeStart); // 1→0
            this.coreMat.opacity = t;
            this.haloMat.opacity = 0.45 * t;
            const s = 0.3 + 0.7 * t;
            this.mesh.scale.setScalar(s);
        }

        if (this.life <= 0) {
            this.destroy();
            return false;
        }
        return true;
    }

    destroy() {
        if (this.isDead) return;
        this.isDead = true;
        Globals.scene.remove(this.mesh);
        this.core.geometry.dispose();
        this.halo.geometry.dispose();
        this.coreMat.dispose();
        this.haloMat.dispose();
    }
}
