import * as THREE from 'three';
import { Globals } from '../utils.js';

function createStarShape(radiusOuter, radiusInner) {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + i * (Math.PI / 5);
        const radius = i % 2 === 0 ? radiusOuter : radiusInner;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
}

export class SpawnTelegraphEffect {
    constructor(position, scale = 1) {
        this.life = 3;
        this.maxLife = 3;
        this.group = new THREE.Group();
        this.group.position.copy(position);
        this.group.position.y = 0.06;

        const ringScale = scale * 0.24;

        const haloGeo = new THREE.CircleGeometry(1.16 * ringScale, 48);
        const haloMat = new THREE.MeshBasicMaterial({
            color: 0x5e55a2,
            transparent: true,
            opacity: 0.32,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        this.halo = new THREE.Mesh(haloGeo, haloMat);
        this.halo.rotation.x = -Math.PI / 2;

        const outerRingGeo = new THREE.RingGeometry(0.9 * ringScale, 1.08 * ringScale, 48);
        const outerRingMat = new THREE.MeshBasicMaterial({
            color: 0x5e55a2,
            transparent: true,
            opacity: 0.92,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        this.outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
        this.outerRing.rotation.x = -Math.PI / 2;

        const innerRingGeo = new THREE.RingGeometry(0.52 * ringScale, 0.62 * ringScale, 40);
        const innerRingMat = outerRingMat.clone();
        innerRingMat.color.setHex(0x5e55a2);
        innerRingMat.opacity = 0.82;
        this.innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
        this.innerRing.rotation.x = -Math.PI / 2;

        const starGeo = new THREE.ShapeGeometry(createStarShape(0.6 * ringScale, 0.24 * ringScale));
        const starMat = new THREE.MeshBasicMaterial({
            color: 0x91c53a,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false
        });
        this.star = new THREE.Mesh(starGeo, starMat);
        this.star.rotation.x = -Math.PI / 2;

        this.halo.layers.enable(1);
        this.outerRing.layers.enable(1);
        this.innerRing.layers.enable(1);
        this.star.layers.enable(1);

        this.group.add(this.halo);
        this.group.add(this.outerRing);
        this.group.add(this.innerRing);
        this.group.add(this.star);
        Globals.scene.add(this.group);

        Globals.audioManager?.playTelegraph();
    }

    update(delta) {
        this.life -= delta;
        const alpha = Math.max(this.life / this.maxLife, 0);
        const pulse = 0.92 + Math.sin((1 - alpha) * Math.PI * 8) * 0.12;

        this.group.rotation.y += delta * 0.55;
        this.halo.material.opacity = (0.16 + (1 - alpha) * 0.2) * pulse;
        this.outerRing.material.opacity = (0.58 + (1 - alpha) * 0.26) * pulse;
        this.innerRing.material.opacity = (0.44 + (1 - alpha) * 0.22) * pulse;
        this.star.material.opacity = (0.68 + (1 - alpha) * 0.22) * pulse;

        if (this.life <= 0) {
            Globals.scene.remove(this.group);
            this.group.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            return false;
        }

        return true;
    }
}

export class SpawnBeamEffect {
    constructor(position, scale = 1, options = {}) {
        this.life = options.life ?? 0.35; 
        this.maxLife = this.life;
        this.group = new THREE.Group();
        this.group.position.copy(position);

        // 保持小巧精致的尺寸
        const radius = 0.2 * scale; 
        this.height = 6; 

        // 恢复为光滑规整的圆柱体 (16边面，看起来是圆的)
        const geo = new THREE.CylinderGeometry(radius, radius, this.height, 16, 1, true);
        geo.translate(0, this.height / 2, 0); 

        const mat = new THREE.MeshBasicMaterial({
            color: options.color ?? 0x5e55a2, 
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        this.beam = new THREE.Mesh(geo, mat);
        this.beam.layers.enable(1); 

        const innerGeo = new THREE.CylinderGeometry(radius * 0.4, radius * 0.4, this.height, 8, 1, true);
        innerGeo.translate(0, this.height / 2, 0);
        const innerMat = new THREE.MeshBasicMaterial({
            color: 0xa89fdf,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        this.innerBeam = new THREE.Mesh(innerGeo, innerMat);
        this.innerBeam.layers.enable(1); 

        this.group.add(this.beam);
        this.group.add(this.innerBeam);

        // 初始高度为0，准备从地面冲出
        this.beam.scale.set(1, 0, 1);
        this.innerBeam.scale.set(1, 0, 1);
        this.beam.position.y = 0;
        this.innerBeam.position.y = 0;

        Globals.scene.add(this.group);
        Globals.audioManager?.playSpawn();
    }

    update(delta) {
        this.life -= delta;
        const alpha = Math.max(this.life / this.maxLife, 0);

        if (alpha > 0.8) { 
            // 冲出地面阶段
            const riseProgress = (1.0 - alpha) / 0.2; 
            const easeOut = 1 - Math.pow(1 - riseProgress, 3);
            
            this.beam.scale.set(1.0, easeOut, 1.0);
            this.innerBeam.scale.set(1.0, easeOut, 1.0);
            
            this.beam.material.opacity = 0.8;
            this.innerBeam.material.opacity = 0.8;
        } else {
            // 平滑收束消散阶段
            const fadeAlpha = alpha / 0.8; 
            
            const scaleX = fadeAlpha * 1.0;
            this.beam.scale.set(scaleX, 1.0, scaleX);
            this.innerBeam.scale.set(scaleX, 1.0, scaleX);
            
            this.beam.material.opacity = fadeAlpha * 0.8;
            this.innerBeam.material.opacity = fadeAlpha * 0.8;
        }

        if (this.life <= 0) {
            Globals.scene.remove(this.group);
            this.group.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            return false;
        }

        return true;
    }
}

export class SpawnScanEffect {
    constructor(position, scale = 1, options = {}) {
        this.life = options.life ?? 0.45; 
        this.maxLife = this.life;
        this.group = new THREE.Group();
        this.group.position.copy(position);

        this.rings = [];
        const ringCount = 3;
        
        // 匹配预警法阵的大小，大约是 0.35
        const radius = 0.35 * scale; 
        const color = options.color ?? 0xa89fdf; // 使用较亮的高级紫
        
        for (let i = 0; i < ringCount; i++) {
            // 使用 TorusGeometry 制作极细的光环 (扫描线)
            // radius, tube, radialSegments, tubularSegments
            const geo = new THREE.TorusGeometry(radius, 0.012 * scale, 8, 32);
            geo.rotateX(Math.PI / 2); // 平放
            
            const mat = new THREE.MeshBasicMaterial({
                color: color, 
                transparent: true,
                opacity: 0.0, // 初始全透明
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            
            const mesh = new THREE.Mesh(geo, mat);
            mesh.layers.enable(1); // 开启辉光
            
            this.group.add(mesh);
            
            this.rings.push({
                mesh: mesh,
                delay: i * 0.08, // 每个光环延迟触发，形成上升梯队
                maxHeight: (1.2 + Math.random() * 0.3) * scale // 扫描达到的高度
            });
        }

        Globals.scene.add(this.group);
        Globals.audioManager?.playSpawn();
    }

    update(delta) {
        this.life -= delta;
        const elapsed = this.maxLife - this.life;

        for (const ring of this.rings) {
            if (elapsed >= ring.delay) {
                // 计算当前光环自身的进度 (0.0 to 1.0)
                const ringElapsed = elapsed - ring.delay;
                const duration = this.maxLife - ring.delay;
                const progress = Math.min(ringElapsed / duration, 1.0);
                
                // 扫描线匀速向上移动
                ring.mesh.position.y = progress * ring.maxHeight;
                
                // 透明度渐变：先淡入，中间保持，最后淡出
                let opacity = 0;
                if (progress < 0.2) {
                    opacity = progress / 0.2; // 0~20% 快速淡入
                } else if (progress > 0.8) {
                    opacity = (1.0 - progress) / 0.2; // 80~100% 快速淡出
                } else {
                    opacity = 1.0; // 中间段保持明亮
                }
                
                // 尺寸稍微有呼吸感，上升时向内收缩一点点
                const currentScale = 1.0 - (progress * 0.15);
                ring.mesh.scale.set(currentScale, currentScale, currentScale);
                
                ring.mesh.material.opacity = opacity * 0.85; 
            }
        }

        if (this.life <= 0) {
            Globals.scene.remove(this.group);
            this.group.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            return false;
        }

        return true;
    }
}
