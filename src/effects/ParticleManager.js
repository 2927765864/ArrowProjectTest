import * as THREE from 'three';
import { Globals } from '../utils.js';

/**
 * 粒子对象池：粒子销毁后不真销毁，把 mesh+material 收回 pool 重用。
 * 由于每个 burst 粒子需要独立 color/opacity（色彩多样、生命周期独立），
 * 我们仍然让每个粒子拥有自己的材质实例，但材质实例从 pool 中取，
 * 而不是每次 new。
 *
 * dust puff 使用同一种材质模板（黄绿色），可以从一个 dust pool 取；
 * burst 使用另一个 pool。
 */
const _scratchDir = new THREE.Vector3();
const _scratchSpread = new THREE.Vector3();

export class ParticleManager {
    constructor() {
        this.particles = [];
        // 共享几何（永不 dispose）
        this.geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
        this.dustGeo = new THREE.IcosahedronGeometry(0.1, 2);
        // 对象池：保存"已死亡可复用"的 (mesh, material) pair
        this._dustPool = [];
        this._burstPool = [];
        // 限制池大小，避免极端情况下池无限增长占内存
        this._poolMax = 96;
    }

    _acquireDustParticle() {
        const pooled = this._dustPool.pop();
        if (pooled) return pooled;
        const mat = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: 0.34,
            depthWrite: false,
            toneMapped: false
        });
        const mesh = new THREE.Mesh(this.dustGeo, mat);
        return { mesh, mat };
    }

    _acquireBurstParticle(colorHex) {
        const pooled = this._burstPool.pop();
        if (pooled) {
            pooled.mat.color.setHex(colorHex);
            return pooled;
        }
        const mat = new THREE.MeshBasicMaterial({
            color: colorHex,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        const mesh = new THREE.Mesh(this.geo, mat);
        mesh.layers.enable(1);
        return { mesh, mat };
    }

    _releaseParticle(p) {
        // 移出场景但保留 mesh+material 用于复用
        Globals.scene.remove(p.mesh);
        const pool = p._isDust ? this._dustPool : this._burstPool;
        if (pool.length < this._poolMax) {
            pool.push({ mesh: p.mesh, mat: p.mesh.material });
        } else {
            // 超出池容量时才真正释放
            p.mesh.material.dispose();
        }
    }

    spawnDustPuff(position, moveDirection, baseScale = 0.75) {
        _scratchDir.copy(moveDirection);
        if (_scratchDir.lengthSq() > 0.0001) _scratchDir.normalize();

        const { mesh, mat } = this._acquireDustParticle();
        // 重置外观：opacity / scale / rotation / color
        mat.opacity = 0.34;
        mesh.scale.setScalar(1);
        mesh.rotation.set(0, 0, 0);
        mesh.position.copy(position);
        mesh.position.y += 0.08;

        // velocity = (0, 0.42, 0) + dir * -0.12 —— 这里只在 spawn 时分配一次 Vector3，
        // 不能用模块 scratch 因为粒子状态需要保留多帧。
        const velocity = new THREE.Vector3(
            -0.12 * _scratchDir.x,
            0.42,
            -0.12 * _scratchDir.z
        );

        Globals.scene.add(mesh);
        this.particles.push({
            _isDust: true,
            mesh: mesh,
            velocity: velocity,
            life: 1.0,
            decay: 2.15,
            gravity: -0.12,
            baseScale: baseScale * 1.28,
            baseOpacity: 0.4,
            spin: 0.6,
            puffScale: {
                peakAt: 0.22,
                start: 0.98,
                peak: 1.45,
                end: 0.34
            }
        });
    }

    spawnBurst(position, direction, count, colorHex, isExit, baseScale = 1.0, speedRange = [4, 12]) {
        for (let i = 0; i < count; i++) {
            const { mesh, mat } = this._acquireBurstParticle(colorHex);
            mat.opacity = 0.95;
            mesh.scale.setScalar(1);
            mesh.rotation.set(0, 0, 0);
            mesh.position.copy(position);
            mesh.position.y += 0.4;

            // 这里 spread 是粒子的状态（每帧推进），所以保留 new Vector3
            const spread = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
            ).normalize();

            if (isExit) {
                _scratchSpread.copy(direction).multiplyScalar(1.5);
                spread.add(_scratchSpread).normalize();
            } else {
                _scratchSpread.copy(direction).multiplyScalar(-0.5);
                spread.add(_scratchSpread).normalize();
            }

            Globals.scene.add(mesh);
            this.particles.push({
                _isDust: false,
                mesh: mesh,
                velocity: spread.multiplyScalar(Math.random() * (speedRange[1] - speedRange[0]) + speedRange[0]),
                life: 1.0,
                baseScale: baseScale * 1.15,
                baseOpacity: 0.95,
                spin: 18 + Math.random() * 8
            });
        }
    }

    update(delta) {
        const particles = this.particles;
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life -= delta * (p.decay || 3);
            if (p.life <= 0) {
                this._releaseParticle(p);
                particles.splice(i, 1);
            } else {
                p.velocity.y += delta * (p.gravity !== undefined ? p.gravity : -15);
                p.mesh.position.addScaledVector(p.velocity, delta);
                let size;
                if (p.puffScale) {
                    const progress = 1 - p.life;
                    if (progress < p.puffScale.peakAt) {
                        const t = progress / p.puffScale.peakAt;
                        size = p.baseScale * THREE.MathUtils.lerp(p.puffScale.start, p.puffScale.peak, t);
                    } else {
                        const t = (progress - p.puffScale.peakAt) / (1 - p.puffScale.peakAt);
                        size = p.baseScale * THREE.MathUtils.lerp(p.puffScale.peak, p.puffScale.end, t);
                    }
                } else {
                    size = p.baseScale * ((1 - p.life) * (p.grow || 1) + p.life);
                }
                p.mesh.scale.setScalar(size);
                p.mesh.rotation.x += delta * (p.spin || 15);
                p.mesh.rotation.y += delta * (p.spin || 15);
                if (p.mesh.material) p.mesh.material.opacity = p.life * (p.baseOpacity || 1);
            }
        }
    }
}
