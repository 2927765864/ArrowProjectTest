import * as THREE from 'three';
import { Globals } from '../utils.js';
import { CONFIG } from '../config.js';

// ============================================================================
// JavelinVFX
// 标枪飞行 4 大发射器特效合集：
//   1) Core Projectile  核心抛射体
//   2) Mach Rings       音障/冲击波环
//   3) Ribbon Trail     核心拖尾
//   4) Sparks / Debris  飞溅粒子
//
// 生命周期是 自驱 的：
//   - 武器持有者每帧调用 follow(pos, velocity) 同步发射点；
//   - 武器命中 / 销毁时调用 detach()，特效不会立即消失，
//     而是停止生成新粒子，并将已有的环 / 火花 / 尾迹播完后才自销毁。
//   - 自身被注册在 Globals.javelinVfxEffects 中，由 main.js 主循环统一驱动。
// ============================================================================

const MAX_TRAIL_POINTS = 60;
const _Z = new THREE.Vector3(0, 0, 1);
const _scratchVec = new THREE.Vector3();
const _scratchVec2 = new THREE.Vector3();

// --------------------------------------------------------------------
// 共享几何
// --------------------------------------------------------------------
const coreGeo = new THREE.OctahedronGeometry(1, 0);
coreGeo.rotateX(Math.PI / 2);

const ringGeo = new THREE.PlaneGeometry(1, 1);

const sparkGeo = new THREE.PlaneGeometry(0.1, 0.5);
sparkGeo.rotateX(Math.PI / 2);

// --------------------------------------------------------------------
// 工具
// --------------------------------------------------------------------
function buildCoreMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            coreColor: { value: new THREE.Color(1.0, 1.0, 1.0) },
            edgeColor: { value: new THREE.Color(1.0, 0.8, 0.0) },
            intensity: { value: 12.0 },
            fresnelPow: { value: 1.5 },
            opacity:    { value: 1.0 }
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 coreColor;
            uniform vec3 edgeColor;
            uniform float intensity;
            uniform float fresnelPow;
            uniform float opacity;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            void main() {
                vec3 normal = normalize(vNormal);
                vec3 viewDir = normalize(vViewPosition);
                float fresnel = clamp(dot(normal, viewDir), 0.0, 1.0);
                float mixFactor = pow(fresnel, fresnelPow);
                vec3 finalColor = mix(edgeColor, coreColor, mixFactor);
                gl_FragColor = vec4(finalColor * intensity, opacity);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
}

function buildRingMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            color:     { value: new THREE.Color(1.0, 0.85, 0.1) },
            opacity:   { value: 1.0 },
            intensity: { value: 8.0 },
            innerRadius: { value: 0.42 },
            outerRadius: { value: 0.5 },
            softness:    { value: 0.05 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 color;
            uniform float opacity;
            uniform float intensity;
            uniform float innerRadius;
            uniform float outerRadius;
            uniform float softness;
            varying vec2 vUv;
            void main() {
                float dist = distance(vUv, vec2(0.5));
                float inner = smoothstep(innerRadius - softness, innerRadius, dist);
                float outer = 1.0 - smoothstep(outerRadius, outerRadius + softness, dist);
                float alpha = inner * outer;
                gl_FragColor = vec4(color * intensity, alpha * opacity);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
}

function buildTrailMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            time:        { value: 0 },
            colorHead:   { value: new THREE.Color(1.0, 1.0, 0.6) },
            colorTail:   { value: new THREE.Color(1.0, 0.4, 0.0) },
            intensity:   { value: 8.0 },
            opacity:     { value: 1.0 },
            noiseScale:  { value: 20.0 },
            noiseSpeed:  { value: 10.0 },
            noiseAmount: { value: 0.4 },
            edgeSoftness:{ value: 0.6 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float time;
            uniform vec3 colorHead;
            uniform vec3 colorTail;
            uniform float intensity;
            uniform float opacity;
            uniform float noiseScale;
            uniform float noiseSpeed;
            uniform float noiseAmount;
            uniform float edgeSoftness;
            varying vec2 vUv;
            float rand(vec2 co){ return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }
            float noise(vec2 p) {
                vec2 ip = floor(p); vec2 u = fract(p); u = u*u*(3.0-2.0*u);
                float res = mix(
                    mix(rand(ip), rand(ip+vec2(1.0,0.0)), u.x),
                    mix(rand(ip+vec2(0.0,1.0)), rand(ip+vec2(1.0,1.0)), u.x), u.y);
                return res*res;
            }
            void main() {
                float alpha = vUv.x;
                float n = noise(vec2(vUv.x * noiseScale - time * noiseSpeed, vUv.y * 5.0));
                float edgeDist = abs(vUv.y - 0.5) * 2.0;
                if (edgeDist > edgeSoftness + n * noiseAmount) discard;
                vec3 finalColor = mix(colorTail, colorHead, vUv.x);
                gl_FragColor = vec4(finalColor * intensity, alpha * opacity);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
}

function buildSparkMaterial() {
    return new THREE.MeshBasicMaterial({
        color: 0xffdd44,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
}

// ============================================================================
// 主类
// ============================================================================
export class JavelinVFX {
    constructor() {
        this.group = new THREE.Group();
        Globals.scene.add(this.group);

        // Core
        this.coreMat = buildCoreMaterial();
        this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat);
        this.group.add(this.coreMesh);

        // Trail
        this.trailMat = buildTrailMaterial();
        this.trailGeo = new THREE.BufferGeometry();
        this.trailVertices = new Float32Array(MAX_TRAIL_POINTS * 2 * 3);
        this.trailUVs = new Float32Array(MAX_TRAIL_POINTS * 2 * 2);
        const trailIndices = [];
        for (let i = 0; i < MAX_TRAIL_POINTS - 1; i++) {
            const base = i * 2;
            trailIndices.push(base, base + 1, base + 2);
            trailIndices.push(base + 1, base + 3, base + 2);
        }
        this.trailGeo.setIndex(trailIndices);
        this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailVertices, 3).setUsage(THREE.DynamicDrawUsage));
        this.trailGeo.setAttribute('uv', new THREE.BufferAttribute(this.trailUVs, 2));
        this.trailMesh = new THREE.Mesh(this.trailGeo, this.trailMat);
        // 修复：trailMesh 直接挂在 scene 上，本地 transform 一直在原点，
        // 而 trailVertices 初始为全 0，导致 BufferGeometry 自动计算的
        // boundingSphere 始终是 (origin, r=0)。当玩家/相机距离世界原点较远
        // （例如玩家位于敌人上方、攻击方向接近 +Z 轴时），世界原点常常落在
        // 视锥外，trailMesh 被错误剔除，核心拖尾就会"消失"。
        // 由于 ribbon 顶点跨度大且每帧重建，关闭视锥剔除是最稳妥的方式。
        this.trailMesh.frustumCulled = false;
        Globals.scene.add(this.trailMesh);

        // State
        this.attached = true;          // 武器是否仍然挂着特效
        this.alive = true;             // 整个特效是否还活着
        this.position = new THREE.Vector3();
        this.lastPos = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.distanceSinceLastRing = 0;
        this.distanceSinceLastSpark = 0;

        // Trail fade after detach
        this.detachAge = 0;            // 自分离后过了多久
        this.trailFadeDuration = 0.6;
        this.coreFadeDuration = 0.18;

        // Emitter particle pools
        this.rings = [];
        this.sparks = [];
        this.trailPositions = [];

        // Per-emitter spawn gates. 武器穿透敌人后，业务侧会调 setRingsEnabled(false)
        // 来停止生成新的音障环。已经存在的环会按自己的寿命正常播完。
        this.ringsEnabled = true;

        // Apply initial CONFIG
        this._applyConfigToShared();
    }

    _applyConfigToShared() {
        // Core
        this.coreMat.uniforms.intensity.value = CONFIG.vfxCoreIntensity ?? 12.0;
        this.coreMat.uniforms.fresnelPow.value = CONFIG.vfxCoreFresnelPow ?? 1.5;
        this.coreMat.uniforms.coreColor.value.setHex(CONFIG.vfxCoreColor ?? 0xffffff);
        this.coreMat.uniforms.edgeColor.value.setHex(CONFIG.vfxCoreEdgeColor ?? 0xffcc00);
        this.coreMesh.scale.set(
            CONFIG.vfxCoreScaleX ?? 0.25,
            CONFIG.vfxCoreScaleY ?? 0.25,
            CONFIG.vfxCoreScaleZ ?? 2.5
        );
        // Trail (only the ones that don't change every frame)
        this.trailMat.uniforms.intensity.value = CONFIG.vfxTrailIntensity ?? 8.0;
        this.trailMat.uniforms.colorHead.value.setHex(CONFIG.vfxTrailColorHead ?? 0xffff99);
        this.trailMat.uniforms.colorTail.value.setHex(CONFIG.vfxTrailColorTail ?? 0xff6600);
        this.trailMat.uniforms.noiseScale.value = CONFIG.vfxTrailNoiseScale ?? 20.0;
        this.trailMat.uniforms.noiseSpeed.value = CONFIG.vfxTrailNoiseSpeed ?? 10.0;
        this.trailMat.uniforms.noiseAmount.value = CONFIG.vfxTrailNoiseAmount ?? 0.4;
        this.trailMat.uniforms.edgeSoftness.value = CONFIG.vfxTrailEdgeSoftness ?? 0.6;

        this.trailFadeDuration = CONFIG.vfxTrailFadeDuration ?? 0.6;
        this.coreFadeDuration = CONFIG.vfxCoreFadeDuration ?? 0.18;
    }

    // 由 Feather 在构造时调用，给一个起点 + 方向
    start(position, direction) {
        this.position.copy(position);
        this.lastPos.copy(position);
        this.velocity.copy(direction).normalize();
        this.coreMesh.position.copy(position);
        this.coreMesh.quaternion.setFromUnitVectors(_Z, this.velocity);
        // 注册到全局，让 main.js 自驱
        Globals.javelinVfxEffects.push(this);
    }

    // 业务侧用来控制是否继续生成新的音障环。
    // 武器穿透敌人后调用 setRingsEnabled(false)：
    //   - 停止 spawn-per-distance 的环生成；
    //   - 已经在场的环不会被销毁，会播完自己的寿命动画。
    setRingsEnabled(enabled) {
        this.ringsEnabled = !!enabled;
    }

    // 由 Feather 在飞行阶段每帧调用，传入当前 pos + 速度向量（包含速度大小）
    follow(currentPos, velocityVec) {
        if (!this.attached) return;
        this.position.copy(currentPos);
        this.velocity.copy(velocityVec);
    }

    // 武器消失/命中时调用：让特效进入"播完动画再死亡"的尾态
    detach() {
        if (!this.attached) return;
        this.attached = false;
        this.detachAge = 0;
        // 立即隐藏 core
        this.coreMesh.visible = false;
    }

    // main.js 每帧调度。返回 false 表示已经播完，可以销毁。
    update(delta) {
        if (!this.alive) return false;
        // Hot-reload Config to shared mats every frame (cheap; allows live tuning)
        this._applyConfigToShared();

        if (this.attached) {
            this._spawnPhase(delta);
        } else {
            this.detachAge += delta;
        }

        this._tickRings(delta);
        this._tickSparks(delta);
        this._tickTrail(delta);

        // Decide if we are still alive
        if (!this.attached) {
            const trailDone = this.detachAge >= this.trailFadeDuration;
            const noEmitters = this.rings.length === 0 && this.sparks.length === 0;
            if (trailDone && noEmitters) {
                this.alive = false;
                return false;
            }
        }
        return true;
    }

    // ====================================================================
    // 1) attached 时：跟随武器同步 + 生成新粒子
    // ====================================================================
    _spawnPhase(delta) {
        const speed = this.velocity.length();
        const dir = _scratchVec.copy(this.velocity);
        if (speed > 0.0001) dir.multiplyScalar(1.0 / speed);

        // Update core transform
        this.coreMesh.position.copy(this.position);
        if (speed > 0.1) {
            this.coreMesh.quaternion.setFromUnitVectors(_Z, dir);
        }

        // Distance accumulation (use absolute movement so we don't depend on delta)
        const moveDist = this.position.distanceTo(this.lastPos);
        this.distanceSinceLastRing += moveDist;
        this.distanceSinceLastSpark += moveDist;

        // 2) Mach rings: spawn-per-distance
        // 当 ringsEnabled = false（武器穿过敌人后）就不再生成新的音障环。
        // 已经在场上的环不受影响，会按自己的寿命继续放大 + 淡出。
        const ringDist = CONFIG.vfxRingSpawnDist ?? 1.5;
        if (this.ringsEnabled && ringDist > 0) {
            while (this.distanceSinceLastRing > ringDist) {
                this._spawnRing(this.position, dir, speed);
                this.distanceSinceLastRing -= ringDist;
            }
        } else {
            // 关闭后清掉累计距离，避免重新启用时一次性 burst 出多个
            this.distanceSinceLastRing = 0;
        }

        // 4) Sparks: spawn-per-distance + per-frame probability
        const sparkDist = CONFIG.vfxSparkSpawnDist ?? 0.4;
        if (sparkDist > 0) {
            while (this.distanceSinceLastSpark > sparkDist) {
                if (Math.random() < (CONFIG.vfxSparkProb ?? 0.7)) {
                    this._spawnSpark(this.position, dir, speed);
                }
                this.distanceSinceLastSpark -= sparkDist;
            }
        }

        // 3) Append a trail point
        this.trailPositions.push({ pos: this.position.clone(), dir: dir.clone(), age: 0 });
        const maxLen = Math.max(2, Math.min(MAX_TRAIL_POINTS, Math.floor(CONFIG.vfxTrailLength ?? 30)));
        while (this.trailPositions.length > maxLen) this.trailPositions.shift();

        this.lastPos.copy(this.position);
    }

    // ====================================================================
    // 2) Mach Ring
    // ====================================================================
    _spawnRing(pos, dir, currentSpeed) {
        const mat = buildRingMaterial();
        mat.uniforms.color.value.setHex(CONFIG.vfxRingColor ?? 0xffd820);
        mat.uniforms.intensity.value = CONFIG.vfxRingIntensity ?? 8.0;
        mat.uniforms.innerRadius.value = CONFIG.vfxRingInner ?? 0.42;
        mat.uniforms.outerRadius.value = CONFIG.vfxRingOuter ?? 0.5;
        mat.uniforms.softness.value = CONFIG.vfxRingSoftness ?? 0.05;

        const mesh = new THREE.Mesh(ringGeo, mat);
        mesh.position.copy(pos);
        mesh.quaternion.setFromUnitVectors(_Z, dir);
        const startScale = CONFIG.vfxRingStartScale ?? 0.2;
        mesh.scale.setScalar(startScale);
        this.group.add(mesh);

        // Optional inherited backward velocity
        const inherit = CONFIG.vfxRingInheritVel ?? -0.15;
        const drift = dir.clone().multiplyScalar(currentSpeed * inherit);

        this.rings.push({
            mesh, mat,
            life: 1.0,
            lifeDuration: Math.max(0.05, CONFIG.vfxRingLife ?? 0.25),
            velocity: drift,
            startScale,
            endScale: CONFIG.vfxRingEndScale ?? 2.0
        });
    }

    _tickRings(delta) {
        for (let i = this.rings.length - 1; i >= 0; i--) {
            const r = this.rings[i];
            r.life -= delta / r.lifeDuration;
            if (r.life <= 0) {
                this.group.remove(r.mesh);
                r.mat.dispose();
                this.rings.splice(i, 1);
                continue;
            }
            r.mesh.position.addScaledVector(r.velocity, delta);
            const t = 1.0 - r.life;
            const scale = r.startScale + (r.endScale - r.startScale) * (1.0 - Math.pow(1.0 - t, 3));
            r.mesh.scale.setScalar(scale);
            r.mat.uniforms.opacity.value = r.life;
        }
    }

    // ====================================================================
    // 3) Ribbon Trail
    //
    // 抗抖动设计：
    // - "右轴 (right)" 不再用 cross(tangent, toCamera)，因为 toCamera 受相机抖动
    //   (Camera Shake) 干扰，且当 tangent 接近平行于 toCamera 时（俯视近垂直情况）
    //   叉乘退化为接近 0 的向量，被 normalize 后方向会左右翻转，导致丝带宽度方向
    //   疯狂抖动 —— 尤其是穿透阶段武器位姿剧烈变化时。
    // - 改用世界 UP 作为参考：right = normalize(cross(tangent, worldUp))。
    //   这给出一个 "始终与水平面平行" 的稳定右轴；丝带是横躺在 XZ 面上的扁面，
    //   俯视角下视觉宽度刚好可见，并且完全不依赖相机位置，零抖动。
    // - tangent 用 "相邻两点的几何切线" (positions[i+1] - positions[i-1])，
    //   而不是各自存的速度方向，这避免了穿透下坠阶段速度向量与位置走向不一致
    //   带来的扭曲。
    // ====================================================================
    _tickTrail(delta) {
        this.trailMat.uniforms.time.value += delta;
        const len = this.trailPositions.length;
        if (len < 2) {
            this.trailMat.uniforms.opacity.value = 0;
            return;
        }
        // Age all trail points; if detached, reduce front-tip opacity over time
        for (const p of this.trailPositions) p.age += delta;

        const positions = this.trailGeo.attributes.position.array;
        const uvs = this.trailGeo.attributes.uv.array;
        const headWidth = CONFIG.vfxTrailWidth ?? 0.4;
        const tailWidth = CONFIG.vfxTrailTailWidth ?? 0.0;

        // Up reference (world up). 用一个稳定的世界轴而不是相机相关向量。
        const upRef = _Z; // placeholder, real upRef declared below
        const worldUp = new THREE.Vector3(0, 1, 0);

        // Pre-compute geometric tangents at each point
        const tangents = [];
        for (let i = 0; i < len; i++) {
            const prev = this.trailPositions[Math.max(0, i - 1)].pos;
            const next = this.trailPositions[Math.min(len - 1, i + 1)].pos;
            const tan = new THREE.Vector3().subVectors(next, prev);
            if (tan.lengthSq() < 1e-8) {
                // 相邻点重合，退回到该点存的方向
                tan.copy(this.trailPositions[i].dir);
            }
            tan.normalize();
            tangents.push(tan);
        }

        // 缓存上一帧的 right 用于解决与 worldUp 平行时的二义性翻转
        if (!this._lastRight) this._lastRight = new THREE.Vector3(1, 0, 0);
        const lastRight = this._lastRight;

        for (let i = 0; i < len; i++) {
            const p = this.trailPositions[i];
            const t = i / (len - 1); // 0=tail, 1=head
            const width = THREE.MathUtils.lerp(tailWidth, headWidth, t);

            const tangent = tangents[i];

            // right = normalize(tangent × worldUp)
            // 当 tangent 与 worldUp 几乎平行时叉乘接近 0；此时改用上一帧的 right
            // 以避免方向翻转。
            const right = _scratchVec2.crossVectors(tangent, worldUp);
            const rightLen2 = right.lengthSq();
            if (rightLen2 < 1e-6) {
                right.copy(lastRight);
            } else {
                right.multiplyScalar(1.0 / Math.sqrt(rightLen2));
                // 与上一次同向（防止 180° 翻转）
                if (right.dot(lastRight) < 0) right.multiplyScalar(-1);
            }
            // 记录最新方向
            lastRight.copy(right);
            right.multiplyScalar(width);

            positions[i * 6 + 0] = p.pos.x + right.x;
            positions[i * 6 + 1] = p.pos.y + right.y;
            positions[i * 6 + 2] = p.pos.z + right.z;

            positions[i * 6 + 3] = p.pos.x - right.x;
            positions[i * 6 + 4] = p.pos.y - right.y;
            positions[i * 6 + 5] = p.pos.z - right.z;

            uvs[i * 4 + 0] = t;
            uvs[i * 4 + 1] = 0;
            uvs[i * 4 + 2] = t;
            uvs[i * 4 + 3] = 1;
        }
        // Hide unused vertices by collapsing them to the last point
        for (let i = len; i < MAX_TRAIL_POINTS; i++) {
            positions[i * 6 + 0] = positions[(len - 1) * 6 + 0];
            positions[i * 6 + 1] = positions[(len - 1) * 6 + 1];
            positions[i * 6 + 2] = positions[(len - 1) * 6 + 2];
            positions[i * 6 + 3] = positions[(len - 1) * 6 + 3];
            positions[i * 6 + 4] = positions[(len - 1) * 6 + 4];
            positions[i * 6 + 5] = positions[(len - 1) * 6 + 5];
        }
        this.trailGeo.attributes.position.needsUpdate = true;
        this.trailGeo.attributes.uv.needsUpdate = true;

        // Trail global opacity: fades over detachAge
        if (!this.attached && this.trailFadeDuration > 0) {
            const fadeT = Math.min(1, this.detachAge / this.trailFadeDuration);
            this.trailMat.uniforms.opacity.value = 1.0 - fadeT;
            // Also progressively cut points from the head (so it visibly trails off)
            const cutCount = Math.floor(fadeT * len);
            for (let i = 0; i < cutCount; i++) this.trailPositions.shift();
        } else {
            this.trailMat.uniforms.opacity.value = 1.0;
        }
    }

    // ====================================================================
    // 4) Sparks
    // ====================================================================
    _spawnSpark(pos, dir, currentSpeed) {
        const backwardDir = _scratchVec.copy(dir).multiplyScalar(-1);
        const coneAngle = THREE.MathUtils.degToRad(CONFIG.vfxSparkConeAngle ?? 35);
        // Random direction inside cone
        const phi = Math.random() * Math.PI * 2;
        const cosTheta = Math.cos(coneAngle) + (1 - Math.cos(coneAngle)) * Math.random();
        const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
        // Build orthonormal basis from backwardDir
        const tmpUp = Math.abs(backwardDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const sideX = new THREE.Vector3().crossVectors(backwardDir, tmpUp).normalize();
        const sideY = new THREE.Vector3().crossVectors(backwardDir, sideX).normalize();
        const sparkDir = new THREE.Vector3()
            .addScaledVector(backwardDir, cosTheta)
            .addScaledVector(sideX, Math.cos(phi) * sinTheta)
            .addScaledVector(sideY, Math.sin(phi) * sinTheta)
            .normalize();

        const mat = buildSparkMaterial();
        mat.color.setHex(CONFIG.vfxSparkColor ?? 0xffdd44);
        const mesh = new THREE.Mesh(sparkGeo, mat);
        mesh.position.copy(pos);
        this.group.add(mesh);

        const speedBase = (CONFIG.vfxSparkBaseSpeed ?? 3.0);
        const speedRand = (CONFIG.vfxSparkSpeedRand ?? 5.0);
        const inherit = (CONFIG.vfxSparkInheritVel ?? 0.3);
        const speedMult = CONFIG.vfxSparkSpeed ?? 1.0;
        const finalSpeed = (currentSpeed * inherit + speedBase + Math.random() * speedRand) * speedMult;

        this.sparks.push({
            mesh, mat,
            life: 1.0,
            lifeDuration: Math.max(0.02, CONFIG.vfxSparkLife ?? 0.18),
            velocity: sparkDir.multiplyScalar(finalSpeed),
            stretch: CONFIG.vfxSparkStretch ?? 0.2,
            sizeBase: CONFIG.vfxSparkSize ?? 0.5
        });
    }

    _tickSparks(delta) {
        const drag = Math.pow(CONFIG.vfxSparkDrag ?? 0.9, delta * 60.0); // per-second-ish
        const gravity = CONFIG.vfxSparkGravity ?? -2.0;
        for (let i = this.sparks.length - 1; i >= 0; i--) {
            const s = this.sparks[i];
            s.life -= delta / s.lifeDuration;
            if (s.life <= 0) {
                this.group.remove(s.mesh);
                s.mat.dispose();
                this.sparks.splice(i, 1);
                continue;
            }
            s.velocity.multiplyScalar(drag);
            s.velocity.y += gravity * delta;
            s.mesh.position.addScaledVector(s.velocity, delta);
            const vlen = s.velocity.length();
            if (vlen > 0.01) {
                const sdir = _scratchVec.copy(s.velocity).multiplyScalar(1.0 / vlen);
                s.mesh.quaternion.setFromUnitVectors(_Z, sdir);
                s.mesh.scale.set(s.sizeBase, s.sizeBase, Math.max(0.5, vlen * s.stretch));
            }
            // Flicker
            const flickerLow = CONFIG.vfxSparkFlickerLow ?? 0.5;
            s.mat.opacity = s.life * (flickerLow + (1.0 - flickerLow) * Math.random());
        }
    }

    destroy() {
        // 真正的资源释放（被 main.js 调用）
        this.alive = false;
        for (const r of this.rings) r.mat.dispose();
        for (const s of this.sparks) s.mat.dispose();
        this.rings.length = 0;
        this.sparks.length = 0;
        Globals.scene.remove(this.group);
        Globals.scene.remove(this.trailMesh);
        this.coreMat.dispose();
        this.trailMat.dispose();
        this.trailGeo.dispose();
    }
}
