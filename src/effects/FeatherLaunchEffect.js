import * as THREE from 'three';
import { Globals } from '../utils.js';

// 生成四角星形几何体
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

const STREAK_GEOMETRY = new THREE.BoxGeometry(0.06, 1, 0.06);
const STAR_GEOMETRY = createStarGeometry(0.12);

export class FeatherLaunchEffect {
    constructor(originPos, direction, options = {}) {
        this.life = options.life ? options.life * 1.5 : 0.2; // 稍微增加存在时间让星星拖尾更好看
        this.maxLife = this.life;
        this.group = new THREE.Group();
        this.lines = [];
        this.stars = [];
        
        // 记录继承的速度惯性
        this.inheritedVelocity = options.inheritedVelocity ?? new THREE.Vector3(0, 0, 0);

        const basis = this.createBasis(direction);
        // 图片中没有粗糙的线条，我们大幅减少或者彻底保留细微的速度线
        const count = Math.max(1, Math.floor((options.count ?? 4) / 2)); 
        const color = options.color ?? 0x91c53a;
        const speed = options.speed ?? 18;
        const lengthMin = options.lengthMin ?? 1.4;
        const lengthMax = options.lengthMax ?? 2.2;
        const thicknessMin = options.thicknessMin ?? 0.045;
        const thicknessMax = options.thicknessMax ?? 0.075;

        // 1. 保留极少量的细速度线作为底层冲击感
        for (let i = 0; i < count; i++) {
            const material = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.5,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            });

            const mesh = new THREE.Mesh(STREAK_GEOMETRY, material);
            mesh.position.copy(originPos)
                .addScaledVector(basis.right, (Math.random() - 0.5) * 0.2)
                .addScaledVector(basis.up, (Math.random() - 0.5) * 0.2);

            const streakLength = lengthMin + Math.random() * (lengthMax - lengthMin);
            const streakThickness = (thicknessMin + Math.random() * (thicknessMax - thicknessMin)) * 0.5;
            mesh.scale.set(streakThickness, 0.01, streakThickness);
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), basis.forward);
            mesh.layers.enable(1);

            this.group.add(mesh);
            this.lines.push({
                mesh,
                direction: basis.forward.clone(),
                speed: speed * (0.9 + Math.random() * 0.2),
                baseLength: streakLength,
                baseThickness: streakThickness
            });
        }

        // 2. 重点新增：沿轨道的悬浮四角星芒拖尾
        const starMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });

        // 沿轨道分布生成星星拖尾
        for (let i = 0; i < 5; i++) {
            const star = new THREE.Mesh(STAR_GEOMETRY, starMat);
            // 将星星分布在发射前方的轨道上
            const forwardOffset = Math.random() * speed * this.life * 0.6; 
            
            star.position.copy(originPos)
                .addScaledVector(basis.forward, forwardOffset)
                .addScaledVector(basis.right, (Math.random() - 0.5) * 0.15)
                .addScaledVector(basis.up, (Math.random() - 0.5) * 0.15);
            
            // 随机旋转
            star.rotation.z = Math.random() * Math.PI;
            
            // 将发光层打开
            star.layers.enable(1);

            this.group.add(star);
            this.stars.push({
                mesh: star,
                // 星星留在原地或极其缓慢地飘动
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                vz: (Math.random() - 0.5) * 0.5,
                rotSpeed: (Math.random() - 0.5) * 4,
                scaleStart: 0.15 + Math.random() * 0.5,
                delay: forwardOffset / speed // 根据距离计算出现的延迟
            });
        }

        Globals.scene.add(this.group);
    }

    createBasis(direction) {
        const forward = direction.clone().normalize();
        const helperUp = Math.abs(forward.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(forward, helperUp).normalize();
        const up = new THREE.Vector3().crossVectors(right, forward).normalize();
        return { forward, right, up };
    }

    update(delta) {
        this.life -= delta;
        const progress = 1 - Math.max(this.life / this.maxLife, 0);

        for (const line of this.lines) {
            // 基础向前飞行速度
            line.mesh.position.addScaledVector(line.direction, line.speed * delta);
            // 叠加玩家移动的惯性速度
            line.mesh.position.addScaledVector(this.inheritedVelocity, delta);

            let lengthFactor;
            if (progress < 0.28) {
                lengthFactor = progress / 0.28;
            } else if (progress < 0.72) {
                lengthFactor = 1;
            } else {
                lengthFactor = 1 - (progress - 0.72) / 0.28;
            }

            const opacity = progress < 0.18
                ? progress / 0.18
                : progress > 0.78
                    ? Math.max(0, 1 - (progress - 0.78) / 0.22)
                    : 1;

            line.mesh.scale.set(
                line.baseThickness,
                Math.max(0.01, line.baseLength * lengthFactor),
                line.baseThickness
            );
            line.mesh.material.opacity = opacity;
        }

        // 更新拖尾星星
        for (const s of this.stars) {
            // 时间没到延迟线时先不显示
            if (progress * this.maxLife < s.delay) {
                s.mesh.material.opacity = 0;
                continue;
            }
            
            // 星星自身的生命周期进度
            const starLifeProgress = (progress * this.maxLife - s.delay) / (this.maxLife - s.delay);

            s.mesh.position.x += s.vx * delta;
            s.mesh.position.y += s.vy * delta;
            s.mesh.position.z += s.vz * delta;
            // 叠加玩家移动的惯性速度
            s.mesh.position.addScaledVector(this.inheritedVelocity, delta);
            
            s.mesh.rotation.z += s.rotSpeed * delta;

            // 星星先闪亮，然后消失
            const alpha = 1 - Math.pow(starLifeProgress, 2);
            s.mesh.material.opacity = Math.max(0, alpha);
            
            const starScale = s.scaleStart * (1 - starLifeProgress * 0.5);
            s.mesh.scale.set(starScale, starScale, starScale);
        }

        if (this.life <= 0) {
            Globals.scene.remove(this.group);
            for (const line of this.lines) {
                line.mesh.material.dispose();
            }
            // 星星共享几何体，只需dispose material
            for (const s of this.stars) {
                s.mesh.material.dispose();
            }
            return false;
        }

        return true;
    }
}
