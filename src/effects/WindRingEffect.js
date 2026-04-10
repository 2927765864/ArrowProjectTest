import * as THREE from 'three';
import { Globals } from '../utils.js';

// 生成四角星形（Diamond Star）的几何体
function createStarGeometry(size) {
    const shape = new THREE.Shape();
    const inset = size * 0.25;
    shape.moveTo(0, size);
    shape.lineTo(inset, inset);
    shape.lineTo(size, 0);
    shape.lineTo(inset, -inset);
    shape.lineTo(0, -size);
    shape.lineTo(-inset, -inset);
    shape.lineTo(-size, 0);
    shape.lineTo(-inset, inset);
    shape.lineTo(0, size);
    return new THREE.ShapeGeometry(shape);
}

export class WindRingEffect {
    constructor(originPos, direction, options = {}) {
        // 生命周期缩短，让残影感更脆
        this.life = options.life ? options.life * 1.6 : 0.22; 
        this.maxLife = this.life;
        this.direction = direction.clone().normalize();
        
        // 保存惯性速度，如果没有则设为0
        this.inheritedVelocity = options.inheritedVelocity ?? new THREE.Vector3(0, 0, 0);
        
        // 让特效拥有明显向前的推进感，而不再是仅仅停在原地放大
        this.driftSpeed = options.speed ? options.speed * 0.4 : 10.0; 
        
        const color = options.color ?? 0x91c53a;
        const radius = options.radius ?? 0.6; 

        this.group = new THREE.Group();
        this.group.position.copy(originPos);
        // 面向投掷方向
        this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.direction);

        // ==========================================
        // 参照图片的特效构建：光带圆环 + 四角星星
        // ==========================================

        const ribbonHeight = 0.3;

        // 1. 发光的宽带圆柱（Ribbon Body）- 表现出圆环的“厚度”和渐变发光面
        const ribbonGeom = new THREE.CylinderGeometry(radius, radius * 0.85, ribbonHeight, 32, 1, true);
        ribbonGeom.rotateX(Math.PI / 2); // 让圆柱开口朝向Z轴
        const ribbonMat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.25, // 降低透明度 (原 0.45)
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        this.ribbon = new THREE.Mesh(ribbonGeom, ribbonMat);

        // 2. 前置亮边（Front Rim）- 表现出圆环边缘的高亮光晕
        const rimGeom1 = new THREE.TorusGeometry(radius * 0.85, 0.02, 8, 32);
        const rimMat1 = new THREE.MeshBasicMaterial({
            color: 0xffffff, // 纯白高亮
            transparent: true,
            opacity: 0.6, // 降低透明度 (原 0.9)
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        this.rim1 = new THREE.Mesh(rimGeom1, rimMat1);
        this.rim1.position.z = ribbonHeight / 2;

        // 3. 后置亮边（Back Rim）- 略粗一点的底层亮边
        const rimGeom2 = new THREE.TorusGeometry(radius, 0.035, 8, 32);
        const rimMat2 = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.5, // 降低透明度 (原 0.8)
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false
        });
        this.rim2 = new THREE.Mesh(rimGeom2, rimMat2);
        this.rim2.position.z = -ribbonHeight / 2;

        this.group.add(this.ribbon);
        this.group.add(this.rim1);
        this.group.add(this.rim2);

        // 4. 悬浮的四角星芒粒子（Floating Star Particles）
        this.stars = [];
        const starGeom = createStarGeometry(0.15);
        const starMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });

        for (let i = 0; i < 7; i++) {
            const star = new THREE.Mesh(starGeom, starMat);
            // 在圆环边缘随机生成
            const angle = Math.random() * Math.PI * 2;
            const r = radius * (0.7 + Math.random() * 0.6);
            star.position.set(Math.cos(angle) * r, Math.sin(angle) * r, (Math.random() - 0.5) * 0.6);
            
            // 随机的自转角度
            star.rotation.z = Math.random() * Math.PI;

            this.stars.push({
                mesh: star,
                // 向外缓慢扩散
                vx: Math.cos(angle) * (0.8 + Math.random()),
                vy: Math.sin(angle) * (0.8 + Math.random()),
                vz: (Math.random() - 0.5) * 1.5,
                rotSpeed: (Math.random() - 0.5) * 3,
                scaleStart: 0.3 + Math.random() * 0.7
            });
            this.group.add(star);
        }

        // 初始大小较小
        this.group.scale.set(0.4, 0.4, 0.6);

        // 启用辉光图层
        this.group.traverse(child => {
            if (child.isMesh) child.layers.enable(1);
        });

        Globals.scene.add(this.group);
    }

    update(delta) {
        this.life -= delta;
        const progress = 1 - Math.max(this.life / this.maxLife, 0); 

        // 加上玩家惯性的位移
        this.group.position.addScaledVector(this.inheritedVelocity, delta);
        // 极缓慢地向前漂移（滞留感）
        this.group.position.addScaledVector(this.direction, this.driftSpeed * delta);

        // 先放大再缩小的缩放逻辑
        let currentScale, depthScale;
        if (progress < 0.4) {
            // 前 40% 生命周期：快速放大 (从 0.4 到 1.2)
            const p = progress / 0.4;
            const easeOut = 1 - Math.pow(1 - p, 3);
            currentScale = 0.4 + easeOut * 0.8;
            depthScale = 0.6 + easeOut * 0.4;
        } else {
            // 后 60% 生命周期：平滑缩小 (从 1.2 回落到 0.0)
            const p = (progress - 0.4) / 0.6;
            const easeIn = p * p; // 二次缓入，结尾收缩更快
            currentScale = 1.2 * (1 - easeIn);
            depthScale = 1.0 * (1 - easeIn);
        }

        this.group.scale.set(currentScale, currentScale, depthScale);

        // 透明度淡出 (前 20% 保持清晰，随后逐渐淡出)
        const alpha = progress < 0.2 ? 1 : 1 - (progress - 0.2) / 0.8;
        
        // 动态更新时也对应降低最大透明度乘数
        this.ribbon.material.opacity = alpha * 0.25;
        this.rim1.material.opacity = alpha * 0.6;
        this.rim2.material.opacity = alpha * 0.5;

        // 更新星芒粒子
        for (const s of this.stars) {
            s.mesh.position.x += s.vx * delta;
            s.mesh.position.y += s.vy * delta;
            s.mesh.position.z += s.vz * delta;
            s.mesh.rotation.z += s.rotSpeed * delta;
            
            // 星星自身的闪烁微调（整体已被 Group 缩小）
            const starScale = s.scaleStart * (1 - progress * 0.2); 
            s.mesh.scale.set(starScale, starScale, starScale);
            s.mesh.material.opacity = alpha;
        }

        if (this.life <= 0) {
            Globals.scene.remove(this.group);
            this.ribbon.geometry.dispose();
            this.rim1.geometry.dispose();
            this.rim2.geometry.dispose();
            
            this.ribbon.material.dispose();
            this.rim1.material.dispose();
            this.rim2.material.dispose();

            if (this.stars.length > 0) {
                this.stars[0].mesh.geometry.dispose();
                this.stars[0].mesh.material.dispose();
            }
            return false;
        }

        return true;
    }
}
